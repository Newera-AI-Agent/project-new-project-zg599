# /v1/embeddings multimodal ContentPart arrays are uncapped — the 32-input batch limit applies only to string arrays, so one request can trigger an unbounded remote-media fetch fan-out (per-part 20 MiB, no shared budget, no timeout)

**Severity: medium-high (authenticated DoS + egress amplification; API key required).**

**Found: 2026-10-25. Code-verified and live-verified (40-part array accepted end-to-end; cost kept to a single text embedding).**

## Summary

`POST /v1/embeddings` caps **string** input arrays at 32 entries, but **ContentPart arrays have no count limit at all** — not in the zod schema, not in the normalizer, and not in the Gemini part conversion, where every `image_url`/`video_url` part triggers a fresh `fetchUserImage` with its own 20 MiB cap, no shared byte budget, and **no fetch timeout**. A ~700 KB JSON body holding 10,000 URLs becomes up to 10,000 sequential remote fetches (≈200 GB of egress amplification if each URL serves 20 MiB), or an isolate OOM at roughly 5 parts (128 MiB isolate; every part is additionally retained as a 1.33× base64 string), or an indefinite hang when the URLs point at slow-loris servers — while the request's coordinator/key-budget state is held.

Live verification (2026-10-25, `openai/text-embedding-3-small`, text parts to keep cost at one embedding):

```
[control]   33 strings       -> HTTP 400 :: zod "input" field error (batch cap enforced)
[exploit]   40 ContentParts  -> HTTP 200 :: data.length=1, dims=1536
```

The 40-part request **passed validation and executed** — the batch cap simply does not exist for ContentPart arrays. (An earlier probe against `google/gemini-embedding-2` with 40 parts returned 402 "Insufficient balance" — paid-only model, paid balance 0 — which proves the request clears zod validation and reaches the billing gate before any part-count check.)

## The three missing caps (all verified in code)

1. **Schema — no `.max()` on the parts branch** (`gen.pollinations.ai/src/schemas/embeddings.ts:64-70`):

```ts
input: z.union([
    z.string(),
    z.array(z.string()).max(MAX_EMBEDDING_BATCH_SIZE),  // 32 — capped
    ContentPartSchema,
    z.array(ContentPartSchema),   // ← no .max()
])
```

2. **Normalizer — the length check only runs for string arrays** (`src/embeddings/input.ts:211-226`):

```ts
if (typeof input[0] === "string") {
    if (input.length > MAX_EMBEDDING_BATCH_SIZE) {
        badRequest(`Embedding batch size exceeds ${MAX_EMBEDDING_BATCH_SIZE} inputs`);
    }
    return input as string[];
}
return [input as ContentPart[]];   // ← count never checked
```

3. **Conversion — every URL part is a fresh 20 MiB fetch with no timeout** (`src/embeddings/input.ts:97-127`): `inputToGeminiParts` iterates all parts; each `image_url` → `imageUrlToInlineData` and each `video_url` → `urlToInlineData` calls `fetchUserImage(url)` with **no options** — no `AbortSignal`, no shared `totalBytes` budget. The correct pattern already exists on the chat path (`src/text/transforms/imageUrlToBase64Transform.ts:11, 94-107`): a per-request `maxImages` (default 8, model-declared) **and** a shared `MAX_IMAGE_SIZE - context.totalBytes` budget across all parts. The embeddings path got neither.

## Attacker scenario (authenticated — anonymous calls are 401)

```json
POST /v1/embeddings
{ "model": "google/gemini-embedding-2",
  "input": [ {"type":"video_url","video_url":{"url":"https://attacker/clip.mp4"}},
             … × 10,000 ] }
```

Three amplification modes from one ~700 KB request body:
- **Egress fan-out**: 10,000 sequential fetches × up to 20 MiB each ≈ 200 GB of platform-paid egress (plus Vertex/Gemini token spend far above the admission estimate once the parts are inlined — negative-balance amplifier).
- **Isolate OOM**: each part is fetched, then retained as a base64 string (~1.33×) in the parts array; the 128 MiB isolate dies around the 5th×20 MiB part, killing the request only after ~100 MiB has been pulled.
- **Indefinite hang**: no timeout on `fetchUserImage` — URLs pointing at a tarpit server stall the request while holding the API-key budget reservation (if a key budget applies) and the Worker invocation.

`inputToGeminiParts`'s loop is `await`-sequential, which caps per-request parallelism but makes the hang mode strictly worse (each hung part blocks all subsequent ones, extending the request's lifetime under a single reservation).

## Fix (minimal)

1. Add `.max(MAX_EMBEDDING_BATCH_SIZE)` (or a parts-specific cap, e.g. 32 parts) to the `z.array(ContentPartSchema)` branch in `schemas/embeddings.ts`, and mirror the check in `normalizeInputs` for non-string arrays (it currently only checks `input[0]` type).
2. Port the chat transform's shared byte budget (`context.totalBytes` vs `MAX_IMAGE_SIZE`) and a `maxImages`-style part cap into `inputToGeminiParts`.
3. Give every `fetchUserImage` call in this path a timeout (the audio path already does this — `fetchReferenceAudio`'s 30 s `AbortSignal.timeout`, `audio.ts:246`) and `redirect: "manual"` like the chat transform.

## Companion notes (same path, below reporting threshold)

- The schema docstrings claim "Max 180s"/"Max 120s" for audio/video parts (`schemas/embeddings.ts:38-40`) — no code enforces either (bounds-drift class, cf. issue 13).
- Issue 30 fixed the **per-URL** size/policy for `video_url` but not the **count** of parts; this issue is the count side and applies to `image_url`, `input_audio` (no fetch) and `video_url` alike.
