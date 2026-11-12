# ffmpeg-mcp `runFfmpeg` `args` bypass the validated `sources` policy — `file://` inputs read arbitrary container files and the output is uploaded to public media with the URL returned to the caller (live-proven exfil of /etc/passwd); `sources` itself is uncapped with fetches that never time out

**Severity: medium-low (policy bypass + container-filesystem read → public-URL exfil chain; bounded by `enableInternet:false` inside the container and by per-second billing; no secrets currently live in the image).**

**Found: 2026-10-25. LIVE-VERIFIED end-to-end (container files exfiltrated to public media URLs, contents fetched back).**

## Summary

The tool validates `sources` strictly — public HTTPS, no credentials, no literal IPs (`apps/ffmpeg-mcp/worker.js:199-206`) — but passes `args` to ffmpeg with **no content restriction**:

```js
// apps/ffmpeg-mcp/worker.js:213-214
args: z.array(z.string().min(1).max(1024)).min(2).max(64)
// (any ffmpeg arguments — protocols included)

// apps/ffmpeg-mcp/container-runtime.js:54-67
const process = await runtime.exec(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
     ...args, outputPath],      // ← raw
    { cwd: WORK_DIR, stdout: "ignore" },
);
```

ffmpeg's own protocol handlers (`file:`, `concat:`, `subfile:`, `crypto:`, …) therefore read anything the container process can reach, regardless of what `sources` was checked for. On success the output is uploaded to public media and the URL returned (`worker.js:125-134`); on failure `result.stderr` is returned verbatim (`:119-121`), giving a blind error oracle too.

## Live verification (2026-10-25)

Call (via `https://gen.pollinations.ai/mcp/ffmpeg`, one cover source that is never referenced):

```
tools/call runFfmpeg {
  sources: ["https://github.com/anars/blank-audio/raw/master/1-second-of-silence.mp3"],
  args: ["-f","u8","-ar","8000","-ac","1","-i","file:///etc/passwd","-c","copy","-f","u8"],
  outputExtension: "raw"
}
→ 200 {"uri":"https://media.pollinations.ai/0e7528f6-..."}
```

Fetching that URL returns the container's **`/etc/passwd`** verbatim (`root:x:0:0:root:/root:/bin/sh …`); same for `/etc/os-release` (`NAME="Alpine Linux" VERSION_ID="3.24.2"`). Byte-for-byte passthrough is achieved by treating the file as raw 8-bit PCM — no media format needed. (A first attempt with `-f data` showed the input *was* opened; the failure was only the data muxer requiring a stream, confirming the protocol handler executes.)

Current image is alpine + ffmpeg, non-root, no platform secrets (verified `Dockerfile`), and the container runs with `enableInternet:false` (`apps/ffmpeg-mcp/container.js:5,10`), so `http://`/`tcp://` handlers cannot reach the network from inside. The chain that *is* live: **any file in the container → public media URL → caller**, plus protocol/error-based probing.

## Secondary: `sources` unbounded and unfetched-with-deadline

- `sources: z.array(...).min(1)` has **no `.max()`** (contrast `args`' 64) — `apps/ffmpeg-mcp/worker.js:197-207`.
- Each source is fetched worker-side with `fetchImpl(url, { redirect: "manual" })` and **no `AbortSignal`**, all in `Promise.all` before the container starts (`worker.js:44-60, 85-93`) — a trickling server pins the invocation indefinitely; N trickling sources pin N parallel fetches. The 110 s `FFMPEG_MAX_RUN_MS` deadline covers `container.run` only, not the pre-run fetches.
- Completed sources flood the container disk: the documented cap is 100 MB *per source*, with no whole-request budget — N × 100 MB into `/work` (N bounded today only by the caller's patience and pollen).

## Fix (minimal)

1. Constrain `args` to the documented contract: reject any element matching `^[a-z]+://` / containing `/` at an argument position that isn't `inputN`/`output` — or, more robustly, run ffmpeg with a **protocol whitelist**: add `-protocol_whitelist file,pipe,tcp` is *not* the fix (file is still needed for /work); the correct move is chroot-style isolation of `/work` plus denying absolute paths in `-i` (only `inputN` names allowed — the tool's own instructions already say exactly that, but nothing enforces it).
2. Cap `sources` (e.g. `.max(16)`), attach `AbortSignal.timeout(...)` to `fetchSource`, and enforce a whole-request byte budget across sources.
3. Consider stripping `stderr` from responses or truncating harder (currently 8 KB) — it doubles as a network probe oracle for the container.
