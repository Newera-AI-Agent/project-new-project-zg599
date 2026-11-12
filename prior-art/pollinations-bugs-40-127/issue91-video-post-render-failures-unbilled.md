# Video generations that fail after the provider rendered them are unbilled on every route except one — the `billedUsage` mechanism exists (track.ts) and one fal path uses it, but the direct xAI route deterministically gives away moderation-rejected renders for free, and five poll-timeout/alarm paths leave accepted provider jobs uncharged

**Severity: medium (attacker-amplifiable platform-funded provider spend at $0.03–$0.28/video-second with zero caller charge).**

**Found: 2026-10-25. Code-verified (billing mechanism, all six failure paths, and the one protected route read end-to-end).**

## Summary

A failed (non-2xx) generation is billed *only* when the thrown `UpstreamError` carries `billedUsage`:

```ts
// gen.pollinations.ai/src/middleware/track.ts:731-740
if (!response.ok) {
    // A failure is billed only when the provider charged for it, which the
    // handler reports on the error (an xAI video rejected after generation).
    const usage =
        error instanceof UpstreamError ? error.billedUsage : undefined;
    if (!usage) {
        return notBilled({ modelUsed });
    }
```

Exactly **one** production path attaches it — the fal-routed Grok video rejected by xAI moderation *after* generation (`image/models/falFallbackMediaModel.ts:300-309`, `billsRejectedVideos`, comment: *"fal bills a video that xAI's moderation rejects after generating it"*; `isRejectedAfterGeneration` at `:316-327`). Every sibling path drops the charge:

### 1a. Deterministic: xAI direct moderation 400 (sharpest)

```ts
// gen.pollinations.ai/src/image/models/xaiVideoModel.ts:124-133
const completed = await pollXaiVideo(submitted.request_id, apiKey);
const video = completed.video;
if (video?.respect_moderation === false) {
    throw UpstreamError.fromProvider(400, {
        message: "xAI filtered the generated video by moderation",
        errorCode: "content_policy_violation",
        responseBody: JSON.stringify(completed),
        requestUrl: new URL(submitUrl),
    });                              // ← no billedUsage
}
```

The poll has already returned `status: "done"` **with a rendered video object** — xAI generated (and bills) the clip, then flagged it. No `billedUsage` is attached, so `track.ts:736` bills nothing. The fal-routed *base* model bills this exact scenario (`falFallbackMediaModel.ts:301-306` attaches `billedUsage: usage`); the direct `x-ai/grok-imagine-video-1.5-lite` route gives it away free. The caller controls the prompt, so landing reliably in "rendered-then-filtered" territory is a prompt-engineering problem, repeatable at will:

```
POST /v1/images/generations
{"model":"x-ai/grok-imagine-video-1.5-lite","prompt":"<prompt xAI renders then filters>","duration":15,"resolution":"1080p"}
→ 400 content_policy_violation, caller charged 0 pollen; xAI bills Pollen for a finished 15s 1080p render
```

### 1b. Poll-timeout paths: generation accepted and billed by the provider, client gets 504/503, nobody billed

- `image/models/veoVideoModel.ts:314` (`maxAttempts = 90; // 3 minutes max`) + `:404-408` — Vertex `predictLongRunning` has **no cancel call** anywhere in `pollVeoOperation`; on the 504 the operation keeps running and Google bills for the completed render.
- `image/models/openRouterVideoModel.ts:341-384` — `pollVideo` deadline (HappyHorse/HeyGen 5 min, Grok 3 min) → 504, no cancel, no `billedUsage`; OpenRouter has already accepted (and bills) the job.
- `xaiVideoModel.ts:18, 67-70` — 3-minute `POLL_TIMEOUT_MS` → 504, no cancel, no `billedUsage`.
- `image/utils/replicateClient.ts:128-135` — deadline → cancel + 504 `ReplicateError`, no `billedUsage`. Replicate bills per output-second **including partially generated output before cancel** (`video_output_duration_seconds` proves partial renders are metered), so a wan-pro 1080p render canceled at minute 14 of 15 still costs the platform.
- `image/models/minimaxH3Model.ts:179-189` — a missing/invalid `x-fal-billable-units` header throws 502 **after** the video was generated; no `billedUsage`.

### 1c. Alarm-interruption paths

`klingVideoModel.ts:142` (`while (true)`), `model3d/models/falClient.ts:81-94`, `minimaxH3Model.ts:148-172`, `wan3FalVideoModel.ts:131-152`, `utils/alibabaClient.ts:67-98` poll with **no local deadline**, bounded only by the coordinator alarm; `durable-objects/GenerationCoordinator.ts:212-227` then fails the job (`"Detached generation was interrupted"`, 503, no billing) while the provider job keeps running — `falClient.ts:79-80` admits it: *"Fal still runs and bills a job we stop polling."*

## Impact

Attacker-amplifiable provider spend with zero caller charge: 1a at will; 1b/1c by choosing slow configs (grok base 15 s, wan-pro 1080p with its 15-minute deadline, veo 8 s 1080p+audio). Free-tier reachable (models are not paidOnly). Same economic class as issue 52 (AssemblyAI unbilled transcription) but across the video surface and with a deterministic zero-cost primitive on the xAI direct route.

## Fix (minimal)

Attach `billedUsage` (requested duration × registry rate, or provider-reported units where available) to every post-submission failure/timeout the way `falFallbackMediaModel.ts:301-307` already does — start with `xaiVideoModel.ts:126-133`. Cancel Vertex/OpenRouter/xAI jobs on timeout (Replicate already does).

## Companion note

`model3d/models/falClient.ts:36-38, 81-94` never handles the fal queue's `FAILED` status (every sibling poller has a branch): a failed job polls every 5 s until the DO alarm 503s, the real provider error is lost, and if fal surfaces a post-generation xAI rejection as `FAILED` instead of a 422 on the result fetch, the one currently-protected `billedUsage` path (`falFallbackMediaModel.ts:316-327` keys on a 422 `FalError`) never triggers — silently re-opening the gap on the protected route.
