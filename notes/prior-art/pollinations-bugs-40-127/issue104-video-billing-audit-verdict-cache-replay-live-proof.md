# Video-generation billing audit (verdict + new live evidence): the fresh-generation path is airtight across all 23 official models — but the media-cache replay leg of issue 73 is now LIVE-PROVEN on the same adapter that serves /video (keyless 200 `X-Cache: HIT`, garbage key accepted), the OpenAI /v1/images/generations route accepts video models (uncharted but billed correctly), and the dedup join semantics let a second authenticated account receive an identical in-flight video at zero charge

**Severity: this is primarily a VERDICT issue (negative result on "free unlimited fresh video generation") plus live evidence that upgrades issue 73's media leg from code-claimed to live-proven, plus three companion observations.**

**Found: 2026-10-25. Full chain code-audited (admission → generation → usage extraction → settlement) + live control tests.**

## The question, and the answer

*"Always free unlimited video generation"* — audited end-to-end because it was asked explicitly. **No fresh-generation free-video bug exists in the official model path.** The chain is airtight in a way worth recording so it is not re-audited:

1. **All 23 video models are `paidOnly`** (registry sweep: veo, gemini-omni, seedance×5, wan×6, grok×4, kling, happyhorse, heygen, minimax×3, pruna, kandinsky, mirelo). Admission goes through `checkBalance → requireFunds(…, paidOnly=true)` → `canCoverEstimatedCharge` requires `packBalance > estimate` (`shared/billing/bucket-selection.ts:36-40` — "a positive-balance requirement rather than a cost-coverage one. A paid-only model is never free").
2. **Anonymous callers never reach generation** (`generationAccess → auth.requireUser()` → 401; live-verified).
3. **Every delivery path must carry usage** — `buildTrackingHeaders` (`image/utils/trackingHeaders.ts:23-31`) **throws** `Missing billable usage for <model>` if a `VideoGenerationResult` lacks usage; every model bills from provider-reported metrics where providers report them (kling `falBillableUnits`, xai `video.duration`, seedance/wan/pruna `videoOutputDurationSeconds`, alibaba provider-reported `outputSeconds`, gemini-omni `output_tokens_by_modality`, fal `providerBilling` units×live-price), with requested-duration fallbacks only when the metric is absent.
4. **track refuses to bill without parseable usage** and returns `notBilled` only for cache HITs, content-type mismatches (video guard accepts all `video/*`), or missing-usage failures that also **fail the response** — and for media the usage headers are load-bearing (`x-usage-completion-video-seconds`), so a delivered 200 without usage cannot happen on the official path.
5. **Community video models** are the publisher-funded surface — tier balance can call them, but the platform pays nothing either (the issue-58 self-billing composition covers that world, incl. its price floor of 1e-6/unit).

Live controls (2026-10-25, tier-balance account, paid=0): `GET /video/…?model=google/veo-3.1-fast` with sk_ → **402** ("costs ~0.6000 pollen, available paid balance 0.0000"); anonymous → **401**; `POST /v1/images/generations {model: video}` → **402** (passes validation, blocked at balance).

## What IS free about video (the real answer to the question)

### A. The media-cache replay leg of issue 73 — now LIVE-PROVEN (the upgrade this issue files)

`/image/:prompt` and `/video/:prompt` share one adapter and one mount order: `track → imageCache → generationAccess → …` — the cache lookup runs **before auth and balance**. Live evidence on the shared adapter (2026-10-25):

| Step | Auth | Result |
|---|---|---|
| Warm | `Bearer sk_…` (tier) | `200`, `X-Cache: MISS`, billed 0.002 pollen |
| Replay, **no key at all** | none | `200`, **`X-Cache: HIT`**, identical bytes, **0 pollen** |
| Replay, **garbage key** | `Bearer sk_totally-invalid-garbage` | `200`, **`X-Cache: HIT`** — the invalid key was never even looked at |

The adapter covers `["image/", "video/"]` and the cache key is the full request URL minus `nofeed`/`no-cache`/`key`/`stream` (`utils/media-cache.ts: EXCLUDED_PARAMS`) — **identity-free by construction**. Consequence for video: any video any paying user ever generated is replayable, keylessly, unlimited times, by anyone who can reconstruct the exact URL (prompt + params; seed makes outputs reproducible and docs/example URLs guessable). This is issue 73's documented media leg — this issue adds the live proof and the video-specific reading. Reproduction script: `scripts/live-verify-media-replay.mjs` (in the report bundle).

### B. Dedup-join: the second caller of an identical in-flight video is never billed

`deduplicateGeneration`'s `startAndWait` joins concurrent identical requests (same cache key ⇒ same URL; the API key is excluded) to one upstream generation, and the executor bills **only the first submitter's auth snapshot**. The route docs state the design ("Identical requests share one upstream generation and one charge") — but note the second caller can be a *different account*: it must pass `generationAccess` (so it needs paid balance for paidOnly models) yet is charged nothing for a video it receives. Companion observation, not a standalone exploit (needs exact-URL knowledge + admission funds).

### C. Timeouts (issue 91) remain the only "fresh render for free" paths — and the caller receives nothing

Poll-timeout paths abandon provider jobs and bill 0 — but the caller gets a 504, not a video. That's platform loss, not caller gain (issue 91 covers it).

## Companion observations (small, filed here to keep the video audit complete)

1. **`POST /v1/images/generations` accepts video models** (live-verified reaching the balance check). The OpenAI-shape route bills correctly via `responseImageUsage` re-emitting the inner media response's usage headers, so this is an uncharted-but-safe route×model combination — worth a doc note that the "images" API returns videos when a video model is named (the OpenAI `size` param maps oddly onto `resolution`/`aspectRatio`).
2. **Underbilling fallbacks**: `seedanceV2/wan/pruna` use `actualDurationSeconds ?? requestedDuration` — if a provider omits the metric, the platform bills the requested duration (never more); `openRouterVideoModel` bills the *requested* `duration` outright (`usage: { completionVideoSeconds: duration }`, three call sites). If a provider ever returns longer-than-requested output, that seconds-gap is unbilled — bounded, informational.
3. **`GET /video/models` filter** (`filterEntriesByPermissions` + `hasPaidBalance`) hides paid-only models from zero-pack accounts in *listing* only — cosmetic, admission is the real gate.

## Fix direction (the free-replay leg)

The identity-blind media cache is issue 73's core; for the video surface specifically: either include a caller-identity component in the media cache key (breaking anonymous replay), or keep public replay but make HITs billable to authenticated callers (the current `if (cacheHit) return notBilled()` in `track.ts:726-728`), or at minimum exclude paid-only-model media from keyless HITs (gate the HIT path on `auth.user` when `definition.paidOnly`).
