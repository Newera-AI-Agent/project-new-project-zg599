# mcp.pollinations.ai `transcribeAudio` is an unauthenticated arbitrary-URL fetch primitive — the bearer token is checked for presence only, the worker fetches and fully buffers the caller's URL before the key is ever validated, with no size cap, no timeout, and no rate limit

**Severity: medium-low (unauthenticated server-side request/bandwidth primitive from platform egress + isolate-pinning DoS; blind — response not returned to caller; public-URL space only).**

**Found: 2026-10-25. LIVE-VERIFIED anonymously (fake bearer, fetch observed twice).**

## Summary

`mcp.pollinations.ai` (the public, custom-domain MCP worker, `apps/mcp/`) gates every request on **token presence, not validity**:

```js
// apps/mcp/worker.js:12-22 — readBearerToken: any "Bearer <anything>" passes
// apps/mcp/worker.js:62-64 — if (!token) return unauthorizedResponse();  ← presence only

// packages/mcp/src/utils/authUtils.js:10-17
export function requireApiKey(context) {
    if (!resolveApiKey(context)) {   // ← non-empty string == "resolved"
        throw new Error("API key required...");
    }
}
```

The tool handler then performs the attacker's fetch **before** any downstream validation of the key (the key is only ever forwarded to gen, which would 401 it — after the fetch):

```js
// packages/mcp/src/services/audioService.js:40-72
requireApiKey(context);                          // presence check
const source = publicAudioUrl(params.source);   // https, no literal IP/localhost
response = await fetch(source, { redirect: "manual" });   // ← no AbortSignal
...
form.append("file", await response.blob(), ...);          // ← unbounded buffer
```

The worker is a plain `ExportedHandler` — no Hono, no `edgeRateLimit`, nothing between the internet and the fetch. The domain is public (`apps/mcp/wrangler.jsonc`: `mcp.pollinations.ai`), and its own test suite confirms stateless no-session tool calls (`apps/mcp/worker.test.js:81-100`).

## Live verification (2026-10-25, fully anonymous)

- `POST https://mcp.pollinations.ai/` with `Authorization: Bearer totally-fake-key-xyz-123` and `transcribeAudio {source: "https://nonexistent-host-abc123xyz.example.com/audio.mp3"}` → HTTP 200, tool error: **"Source returned HTTP 530"** — the worker actually attempted the DNS lookup and connection and relayed the upstream 530. The fake key was never the obstacle.
- Same fake bearer with a real media URL (GitHub raw, which redirects) → **"Source audio URL redirects..."** — the fetch completed far enough to observe the 3xx.

So: anyone, with no account, can make this worker issue GET requests to arbitrary public HTTPS URLs and buffer the entire body into isolate memory.

## Impact

1. **Unauthenticated fetch primitive from platform egress** — origin attribution to Pollinations, bandwidth consumption, blind reachability probing (error-string oracle: DNS failure / 530 / redirect / HTTP status / content-type checks all distinguishable).
2. **Isolate pinning / DoS**: no `AbortSignal` means a slow-drip server holds the isolate for as long as it drips; `response.blob()` with no size cap means the buffer grows to the isolate limit (128 MB) — the caller can pick both, and there is no rate limiter to bound repetition. The same absence turns any huge target file into memory pressure on the worker.
3. Mitigations already present (why this is not classic SSRF): `publicAudioUrl` requires https, refuses literal IPs/localhost, refuses redirects, and the worker runs with Cloudflare's public-only fetch enforcement — so private-IP targets are out of scope; the primitive is public-URL only and blind (nothing is echoed back beyond error strings).

## Fix (minimal)

1. Validate the bearer **before** the fetch: a cheap `GET /account/key` against gen (or a service-binding auth check) with the forwarded token, rejecting 401s before any outbound request.
2. Add `signal: AbortSignal.timeout(...)` and a size cap (`response.body` length-checked streaming, like `FFMPEG_MAX_MEDIA_BYTES` in ffmpeg-mcp).
3. Put the route behind the same edge rate limiting gen applies to `/mcp/*`.

Note for triage: the sibling worker `apps/mcp` is also the code shared by any other plain-MCP deployment; the fix belongs in `readBearerToken`/`requireApiKey`, not in one route.
