# Community endpoint URL trust model: hostname blocklist is string-only (nip.io-dash/localtest.me/metadata.google.internal pass; *.pollinations.ai allowed), the text and video serve paths never revalidate the stored baseUrl, and baseUrl/bearer/upstreamModel changes take effect immediately — the 3-hour publication delay is pricing-only

**Severity: medium (hardening/policy gap; practical SSRF on Workers is bounded by platform egress, but the origin-spoofing primitive and the update-timing bypass are structural).**

**Found: 2026-10-25. Code-verified; blocklist behavior re-verified empirically in Node ( WHATWG URL parsing + the exact `isBlockedHostname` function).**

## Summary

Three weaknesses compound in `validateCommunityEndpointUrl` → `isBlockedHostname` (`shared/community-endpoint-urls.ts:107-140`) and the update flow (`enter.pollinations.ai/src/routes/community-endpoints.ts:1164-1178`).

### (a) The blocklist inspects the hostname *string*, not what it resolves to

The function checks literal prefixes (`127.`, `10.`, `169.254.`, `192.168.`, `172.16-31.`, `100.64-127.`, `0.x`, `≥224.x`, `198.18/19.`) and names (`localhost`, `.local`). Empirically verified to **pass** today:

- `https://localtest.me/` (wildcard DNS → 127.0.0.1)
- `https://10-0-0-5.nip.io/` and `sslip.io` dash forms (→ 10.0.0.5; the dotted forms `10.0.0.5.nip.io` *are* caught by the `startsWith("10.")` check — the dash forms are not)
- `https://metadata.google.internal/` (publicly resolves to 169.254.169.254)
- any custom domain whose A record points at a private/link-local IP

(Literal encodings are handled well — WHATWG URL normalizes `0177.0.0.1`, `0x7f.1`, `2130706433`, `[::ffff:...]` to blocked forms, and credentials/fragments/`http:` are rejected.)

### (b) `*.pollinations.ai` and other first-party hostnames are not blocked

A community model's endpoint can be registered pointing at `https://<anything>.pollinations.ai`. On Workers, RFC1918/link-local targets are generally not routable (which blunts classic metadata SSRF), but the residual risks are real: requests egress **from Pollinations' infrastructure IPs** with a publisher-controlled JSON body (`model` = arbitrary ≤253-char `upstreamModel`, `messages` = the caller's conversation) and a publisher-controlled `Authorization` header — an origin-spoofing/allowlist-bypass primitive against anything that trusts Pollinations egress, plus a way to make platform services receive traffic attributed to Pollinations.

### (c) Validation runs only at write time; the text and video serve paths fetch the raw stored `baseUrl` with no revalidation

Compare:
- image/audio/embeddings re-validate at serve via `communityImageGenerationsUrl(...)` etc. (`gen.../src/image/communityEndpoint.ts:55-57`, `audio/...:53,137`, `embeddings/...:36`) — each calls `validateCommunityEndpointUrl`;
- text uses the raw string (`text/communityEndpoint.ts:140-141`) and video uses the raw string (`image/communityEndpoint.ts:115-117`) — fine as long as the DB value is trusted, but it means **zero defense in depth on the highest-traffic path**.

### (d) The 3-hour publication delay does not cover the URL

BYOM.md:62: *"Publishing a model or changing its public prices takes effect after 3 hours."* In the update route:

```ts
// enter.../routes/community-endpoints.ts:1172-1178
const url = input.url ?? input.baseUrl;
if (url !== undefined) {
    update.baseUrl = validateInputEndpointUrl(url);   // ← effective immediately
}
if (input.upstreamModel !== undefined) {
    update.upstreamModel = input.upstreamModel;      // ← immediate
}
```

`bearerTokenCiphertext` is likewise written straight into the active payload (`:1164-1170`). `applyPendingProxyPricing` (`shared/community-endpoints.ts:864-877`) only delays `paidOnly`, `imagePricing`, `prices` (plus the private→public visibility transition). No re-probe or review is triggered when an already-public, approved model is repointed — the URL that was health-probed and approved can be swapped for any validated-shape host and serve caller traffic within the ~60 s catalog cache window (`gen.../src/community-models.ts:38-39`).

## Concrete scenario

Approved publisher registers `https://gpu.example.com/v1/chat/completions`, builds caller traffic, then updates to `https://internal-api.pollinations.ai/whatever` (or a fresh domain that resolves into private space) — effective within ~60 s, carrying caller prompts and an attacker-chosen `Authorization` header, from Pollinations egress IPs. (The caller-prompt confidentiality angle is inherently granted to publishers per BYOM's Trust Boundary, so the marginal gain is the *target* and *origin*, not the content.)

## Fix (minimal)

1. Resolve-and-pin at registration: reject hostnames whose resolution is private at write time (and re-probe periodically), not just string prefixes — or keep the string blocklist but add the DNS-rebinding-resistant wildcard services (`*.nip.io`, `*.sslip.io`, `localtest.me`, `metadata.*.internal`).
2. Block first-party domains (`pollinations.ai`, `pollinations.app`, Cloudflare internal hostnames) as community endpoints.
3. Re-validate `endpoint.baseUrl` at serve in the text/video paths (reuse `communityChatCompletionsUrl`).
4. Route `baseUrl`/`bearerToken`/`upstreamModel` changes through the same pending/delay mechanism as pricing, or require a passing probe before activation.

## Verification notes for what was checked and held

- **Redirect-following / bearer forwarding on redirects: clean** — every fetch of a publisher URL uses `redirect: "manual"` (probe, text, image/video, audio, embeddings, media URLs); a 3xx becomes a 502 and the Authorization header is never replayed to a redirect target.
- **Bearer storage: clean** — encrypted (`encryptSecret`, `BETTER_AUTH_SECRET`), never logged (debug logs print header key *names* only), never echoed in errors (errors carry `requestUrl`, not headers; `collectUpstreamHeaders` redacts auth/cookie/api-key/token/secret-shaped response headers), stripped from API responses by the presenter.
- **Response header injection: clean** — gen always constructs fresh `Response` objects; the only upstream value relayed is the speech `Content-Type`, validated to `audio/*`.
- **Usage suppression: enforced** — non-stream responses throw 502 on missing usage; streams fail at `[DONE]`/EOF and the billing stream sees the same error event the client sees (the inverse of issue 58's inflation is closed by design).
