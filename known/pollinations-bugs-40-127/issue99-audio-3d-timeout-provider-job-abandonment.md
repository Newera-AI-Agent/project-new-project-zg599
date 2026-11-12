# Post-render provider-job abandonment: Stable Audio 3's poll budget (180 s) is smaller than its own duration schema (≤380 s, default 190) and the 504 settles nothing — the caller gets a free render the platform pays Stability for; the InferencePort 3D client has the identical shape (300 s job timeout, no cancel, no billedUsage on the 504)

**Severity: medium (deterministic free-render money leak for funded callers; companions to issues 52/91 — this documents the two provider clients those issues did not cover).**

**Found: 2026-10-25. Code-verified. Live reproduction requires a paid-balance account (the model is paidOnly; our quest-tier test key is correctly refused at admission with HTTP 402 "Insufficient balance. This request costs ~0.2600 pollen" — the admission itself works, the leak is past it).**

## 1. Stable Audio 3 Large (`gen.pollinations.ai/src/routes/audio.ts`)

The schema allows far more audio than the poller will ever wait for:

```ts
// audio.ts:100-104
duration: z.number().min(0.5).max(380).optional(),   // 380 s allowed
// audio.ts:3318
seconds = 190,                                       // ← default ALREADY > budget
// audio.ts:3401
const maxPollTime = 180_000;                         // 180 s poll budget
```

A render the provider completes at t=181..380 s is billed to the platform but delivered to nobody:

```ts
// audio.ts:3436-3438 — usage headers only on the 200 path
const usageHeaders = buildUsageHeaders("stability-ai/stable-audio-3", {...});
// audio.ts:3455-3457 — the timeout throw carries nothing
throw new UpstreamError(504, { message: "Stable Audio 3 Large generation timed out" });
```

No `billedUsage` is attached to the 504 (the `track.ts:731-740` mechanism bills failures only when the error carries it), and **no cancel/DELETE of the Stability generation is attempted** — the provider finishes server-side on the platform's `STABILITY_API_KEY` either way. `POST /v1/audio/speech {model:"stability-ai/stable-audio-3", duration:380}` from any paid-balance account is therefore a deterministic free render (repeatable at rate-limit speed). The same shape affects any legitimately slow render, which is the normal case for 6-minute audio.

## 2. InferencePort 3D (`gen.pollinations.ai/src/model3d/models/inferenceportClient.ts`)

```ts
// inferenceportClient.ts:20-21
const JOB_TIMEOUT_MS = 5 * 60 * 1_000;                 // 300 s
// inferenceportClient.ts:162-165 — timeout → plain 504
if (signal.aborted || Date.now() >= deadline) throw new InferenceportError(TIMEOUT_MESSAGE, 504);
```

The submitted `/3d/generations` job is never cancelled on timeout, and `model3d/handler.ts:132-140` (`throw3dError`) attaches no `billedUsage` — so a trellis-2 / asset-harvester job that outlives 300 s costs InferencePort money ($0.24-0.35/render list) while the caller's 504 settles zero pollen. Issue 91's file list covered the fal 3D client; this is the direct-API client.

## Why this is not a duplicate

- Issue 52 (AssemblyAI transcription) and issue 91 (video) document the *billedUsage-on-failure* mechanism and several provider paths; this issue adds the two provider clients their audits did not list, plus the aggravating schema-vs-budget mismatch (a **default parameter** already outside the poll window, and a documented max twice the window).

## Fix (minimal)

1. Attach `billedUsage` (estimated from `duration`/model rate) to the timeout `UpstreamError`, as the fal fallback path in issue 91's fix does.
2. Cancel the provider job (`DELETE /generations/{id}` for InferencePort; Stability equivalent) when abandoning it.
3. Raise `maxPollTime` to `maxDuration + slack` (or poll past the response via the existing async job system) so the documented parameter range is actually deliverable.
