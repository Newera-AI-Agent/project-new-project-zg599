# Community text-proxy upstream fetches have no timeout — the documented 300 s control (COMMUNITY_ENDPOINT_TIMEOUT_MS) is unimplemented on the highest-traffic modality; any authenticated account can hang requests indefinitely via a private model, and hung attempts also defeat declared fallbacks

**Severity: medium-high (availability + design-control bypass; cheapest account tier; zero publisher allowlist needed).**

**Found: 2026-10-25. Code-verified (control, serve paths, and fallback interaction all read).**

## Summary

`shared/community-endpoints.ts:72-77` defines the control and states its purpose in its own comment:

```ts
// How long we wait on a community endpoint before giving up. ... Workers impose
// no wall-clock limit of their own, so without this a hung endpoint would hold
// the request open until the caller disconnects.
export const COMMUNITY_ENDPOINT_TIMEOUT_MS = 300_000;
```

Every community serve path **except text** applies it: image (`gen.pollinations.ai/src/image/communityEndpoint.ts:262-266`), video (`fetchWithTimeout`), speech/transcription (`gen.pollinations.ai/src/audio/communityEndpoint.ts:58-74, 162-172`), embeddings (`gen.pollinations.ai/src/embeddings/communityEndpoint.ts:53-71`), media URL fetches (`shared/community-media.ts:157-160, 192-195`), and all enter registration probes (`enter.pollinations.ai/src/services/community-endpoint-openai.ts:90-94, 543-547`).

The **text** path — where a community model's stored `baseUrl` is handed verbatim to the fetcher (`gen.pollinations.ai/src/text/communityEndpoint.ts:135-142`) — never attaches a signal:

```ts
// gen.pollinations.ai/src/text/genericOpenAIClient.ts:354-361
response = await fetcher(endpointUrl, {
    method: "POST",
    redirect: "manual",
    headers,
    body: JSON.stringify(requestBody),
});          // ← no signal, no deadline
```

The responses-API branch has the same gap (`src/text/responses/client.ts:202-214`), and `generateTextPortkey.ts:78-93` confirms direct-endpoint models also miss the `x-portkey-request-timeout` header (290 s) that first-party Portkey models get (`generateTextPortkey.ts:26, 86-91`).

## Attack (no publisher allowlist needed)

Publishing is allowlist-gated, but **private models are not** — `enforcePublishingAccess` returns early for non-public visibility (`enter.../routes/community-endpoints.ts:293-300`: `if (visibility !== "public") return;`), and BYOM.md:58 states any signed-in user may register and call a private model. So *any authenticated account*:

1. `POST https://enter.pollinations.ai/account/my-models/` with `{"name":"hang","modality":"text","api":"chat_completions","url":"https://my-tarpit.example/v1/chat/completions","bearerToken":"x","visibility":"private"}` — the URL is the attacker's own tarpit (accepts TCP, sends headers, never responds).
2. Opens N parallel `POST https://gen.pollinations.ai/v1/chat/completions` with `model=community/<me>/hang`.
3. Each request hangs **until the attacker's own client disconnects** — they control both ends, so indefinitely — each holding a Worker invocation, an upstream connection, and the request's admission/billing state. Even without an attacker, a legitimate publisher's merely-dead endpoint does this to real callers.

**Fallbacks are defeated too**: `withModelFallback` (`gen.../src/fallback.ts:376-419`) awaits the hung attempt, so a healthy declared fallback is never tried — the timeout is what would trigger rescue. The test suite documents the intended bound (*"the extras are dropped rather than the request spending an unbounded number of upstream timeouts"*, `test/community-endpoints.test.ts:9942`): intended worst case 4 × 300 s; actual: ∞.

## Fix (minimal)

Pass `signal: AbortSignal.timeout(COMMUNITY_ENDPOINT_TIMEOUT_MS)` in both text-path fetches (mirror the image/media paths), or wrap per-attempt deadlines in `withModelFallback`.

## Companion notes (same audit, same surface)

1. **Serve-path response caps lag the registration probe**: the enter probe caps every upstream body at `MAX_COMMUNITY_MEDIA_RESPONSE_BYTES` (~26.7 MB, `shared/community-media.ts:7-12`), but the gen serve paths do not — `embeddings/communityEndpoint.ts:82` calls `response.json()` with **no size cap at all** (a publisher answering with one embedding of tens of millions of floats OOMs the isolate before the schema can reject it), `genericOpenAIClient.ts:367-385, :429` buffer error bodies unbounded via `response.text()`, and `shared/community-media.ts:58-66` decodes `b64_json` images without the pre-decode length check its own video sibling has (`community-media.ts:103-112`).
2. **Publisher upstream host + full error body are disclosed to every caller** of a public community model that 5xxs (`shared/error.ts:413-427`: `upstreamHost: error.requestUrl?.hostname`, `upstreamBody` unredacted) — the mechanism is already reported in issues 4 and 2 for official providers; the new victim class is third-party publishers, whose real self-hosted backend hostnames (e.g. `home-gpu.someone.net`) have no reason to be public.
