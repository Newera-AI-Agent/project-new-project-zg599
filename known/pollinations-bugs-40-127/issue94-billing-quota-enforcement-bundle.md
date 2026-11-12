# Billing/quota enforcement bundle — Bedrock guardrail calls are unbilled amplification (blocked requests cost the platform, caller pays zero); sites storage quota is client-declared and ~128× bypassable; the `image` parameter bypasses the user-media URL policy that its sibling `reference_*` params enforce

**Severity: medium-low family (three distinct enforcement gaps, each verified in code).**

**Found: 2026-10-25. Code-verified.**

## 1. Bedrock guardrail invocations are per-request unbilled amplification

`gen.pollinations.ai/src/middleware/safety.ts:75-121` + the chain in `routes/proxy.ts:219-231` (cache lookup → auth/admission → budget reservation → handler → **`applySafetyToInput` (Bedrock call)** → generation):

```ts
// safety.ts:94-98, 116-121
response = await applyGuardrail(guardrailInputs.map((i) => i.text), "INPUT", guardrailEnv);
...
if (blockedFeatures.size > 0) {
    throw new UpstreamError(400, { message: `Request blocked by safety filter: ...` });
}
```

- Every cache **MISS** with `safe` set (or a model with `requiredSafetyFeatures`) triggers one AWS Bedrock `ApplyGuardrail` call scanning up to 50,000 chars (`SAFETY_MAX_TEXT_CHARS`, safety.ts:29).
- Requests **blocked** by the guardrail throw before any generation → no usage recorded, no pollen deducted — **the caller pays zero while the platform pays AWS for every attempt**.
- The safety call is skipped on cache HITs, so an attacker maximizes cost with unique prompts (append a random token per request).
- Any authenticated user can opt in (`?safe=true`) on any model; on models with required features it's not even opt-in.

Same economic class as issues 52/91 (unbilled provider spend), distinct mechanism: the *moderation* call itself is the unbilled resource. Note the cache-key layering is correct — `safe` is part of the cache identity (`utils/text-cache.ts:120-202`; a `safe=true` request cannot be served an unfiltered cache entry — issue 41's bypass is the trailing-window case only). Fix: bill a fixed guardrail surcharge per checked request (or count guardrail calls as rate-limiter spend).

## 2. Sites storage quota is client-declared and never verified

`enter.pollinations.ai/src/routes/sites.ts:76-103` — `ManifestSchema` validates only the **self-reported** `size` per file and their sum:

```ts
size: z.number().int().min(0).max(SITE_LIMITS.bytesPerFile, ...)
...
.refine((manifest) => Object.values(manifest).reduce((sum, file) => sum + file.size, 0)
    <= SITE_LIMITS.bytesPerSite, `A site can be at most ${megabytes(SITE_LIMITS.bytesPerSite)}`)
```

`startSiteUpload` (`services/sites.ts:93-124`) forwards this manifest to Cloudflare's `/assets-upload-session`; the **actual bytes are uploaded by the client directly to Cloudflare** and matched by **hash only** — nothing in enter ever measures real content size. (Only the inline path, `prepareInlineFiles`, `services/sites.ts:129-158`, computes sizes honestly; the two-step path — the CLI/mcp `deploySite` contract, `polli-cli/src/commands/sites.ts:127-152` — trusts the client.)

**Attack:** a modified CLI does `POST /api/account/sites/{name}/upload` with a manifest declaring 1000 files of `size: 1` (total 1000 bytes — passes every limit), then uploads the real files (up to Cloudflare's 25 MiB per-file cap) to the returned `uploadUrl`, then `PUT`s the completion JWT. Result: a live site holding up to **1000 × 25 MiB ≈ 25 GiB** against the documented `bytesPerSite: 200 MB` limit (×5 sites per account, unlimited free accounts). The file *count* cannot be lied about (each manifest key requires an upload), but the total-size quota is pure client assertion. Fix: verify the script's real asset total at publish time (Cloudflare's dispatch-script settings API reports asset sizes) or track cumulative uploaded bytes server-side.

## 3. The `image` parameter bypasses the user-media URL policy that `reference_*` params enforce

`gen.pollinations.ai/src/image/params.ts:96-107` — `image: z.union([z.array(z.string()), z.string(), ...])` with **no `validateUserMediaUrl`**, in direct contrast to `reference_images/videos/audios` 40 lines above (`params.ts:50-60`, `referenceUrl`: *"Reference media must use public HTTP(S) URLs without credentials or literal IP hosts"*). The GET route only checks a scheme prefix (`schemas/image.ts:61-74`). The shared policy claims universality — `shared/user-media-url.ts:28-31`: *"Apply the same URL policy to every user-supplied media fetch: HTTP(S) only, with credenti aled hosts, loopback names, and literal IP addresses refused."*

The raw URLs are forwarded to providers verbatim (no local download, no validation): `klingVideoModel.ts:97-99` (`start_image_url`/`end_image_url` → fal), `xaiVideoModel.ts:98-99` and `xaiModel.ts:56-61` (`image: {url}` / `images: [{url}]` → api.x.ai), `openRouterVideoModel.ts:99-107, 151-159, 240-248` (`frame_images` → OpenRouter), `falFallbackMediaModel.ts:104, 274`, `alibabaVideoModel.ts:62-67, 83` (`media`/`img_url` → DashScope), `minimaxH3Model.ts:343-347`, `wan3FalVideoModel.ts:98-103`.

**Attack:** `GET /video/x?model=kwaivgi/kling-v3.0-std&image=http://user:pass@evil.com/a.jpg` (or `http://169.254.169.254/...`) is accepted while the identical value in `reference_videos=` is rejected 400. Pollinations itself never fetches these (all local downloads go through the validated `fetchUserImage`), but the **provider** is made to fetch attacker-chosen credentialed/internal URLs from *its* network, with provider error bodies relayed back to the caller (`shared/error.ts:423`, `upstreamBody`) as a partial oracle. Severity capped at low/medium because the SSRF lands on third-party networks; the concrete defect is the bypass of the platform's own stated universal policy on its most exposed parameter. Fix: apply `referenceUrl`'s `superRefine` to `image` entries.

## Smaller hardening notes from the same audit (fold into triage)

1. **`gen.myceli.ai` advertises itself as its OAuth authorization server** (`gen/src/routes/well-known.ts:142-157`): the literal `.replace("gen.pollinations.ai", ...)` does not match the production alias domain, so RFC 9728 `oauth-protected-resource` metadata on the alias returns `authorization_servers: ["https://gen.myceli.ai"]` — the resource pointing at itself, a host that serves no AS metadata. One-line fix: reuse enter's `url.hostname.replace(/(^|\.)enter\./, "$1gen.")` mapping.
2. **`DELETE /api/account/sites/:name` is the only sites route without `SiteNameSchema`** (`routes/sites.ts:402-405`) — not exploitable (exact-match PK + ownership + `encodeURIComponent`), defense-in-depth only.
3. **`normalizeCommunityProviderUrl` skips the private-host blocklist** (`shared/community-endpoints.ts:1085-1095` — `https://169.254.169.254/` accepted as a provider's public "service link") and `shared/community-endpoint-urls.ts:32-37` permits plain-`http:` community image URLs when same-host as the endpoint — downgrade, no credentials ride the fetch.
