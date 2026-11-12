# Credential-scope and comparison hardening bundle — gen's billing middleware holds the full admin token it never needs; two production localhost trusted origins; unsubscribe HMACs never expire; D1-export digest compared non-constant-time

**Severity: low (each item is a hardening gap; none is remotely exploitable on its own — but item 1 converts any single gen-side token leak into unlimited pollen minting).**

**Found: 2026-10-25. Code-verified.**

## 1. `PLN_ENTER_TOKEN` conflates "internal automation trigger" with full admin

The same secret authenticates two very different grants:

- `enter.pollinations.ai/src/routes/stripe.ts:524-535` — `isInternalRequest()` accepts `PLN_ENTER_TOKEN` for `POST /api/stripe/auto-top-up/trigger`
- `enter.pollinations.ai/src/routes/admin.ts:24-52` — the **same** token authenticates the entire `/api/admin/*` surface

And the token's widest holder is **gen's billing middleware**, which needs only the first grant:

```ts
// gen.pollinations.ai/src/middleware/track.ts:604-623 — holds PLN_ENTER_TOKEN
// solely to fire the auto-top-up trigger
```

Any exposure of gen's environment (this repo already documents live token-exposure classes: issue 46 agents running with ambient live tokens, issue 57 secret keys in world-readable logs, issue 81 agent-run tokens with full account permissions) converts directly into unrestricted pollen minting with zero Stripe involvement:

```bash
curl -X POST https://enter.pollinations.ai/api/admin/promo-codes \
  -H "Authorization: Bearer $PLN_ENTER_TOKEN" -H 'content-type: application/json' \
  -d '{"eventId":"x","title":"x","pollenAmount":10000,"maxRedemptions":99,
       "expiresAt":"2026-12-01T00:00:00Z"}'
```

(`POST /api/admin/promo-codes` creates codes worth up to `MAX_REWARD_AMOUNT = 10_000` pollen each, unlimited count; `POST /api/admin/quest-grants` grants directly by GitHub username.)

**Fix:** mint a dedicated `PLN_AUTO_TOPUP_TOKEN` scoped to the trigger route only (or a service-binding HMAC scoped to `userId`), and keep `PLN_ENTER_TOKEN` exclusively for human operators.

## 2. `http://localhost:3000` / `http://127.0.0.1:3000` are trusted origins in production

`enter.pollinations.ai/src/auth.ts:356-367`:

```ts
trustedOrigins: [
    ...AUTH_TRUSTED_ORIGINS,
    "http://localhost:3000",           // unconditional, all environments
    "http://127.0.0.1:3000",
    ...(env.ENVIRONMENT === "production" ? [] : [ "http://localhost:3457", ... ]),
```

The non-prod ports are correctly env-gated; the two production localhost entries are the outliers. Any page an attacker can get served from the victim's own `localhost:3000` passes better-auth's origin check and can drive cookie-authenticated `/api/auth/*` mutations (`update-user`, `unlink-account`, `sign-out`, `revoke-sessions`; `delete-user` is additionally freshness-gated). Requires a local foothold — low on its own, but the gating bug is one line.

**Fix:** move both entries inside the non-production spread.

## 3. Unsubscribe links are HMAC-signed but never expire

`enter.pollinations.ai/src/services/account-notices.ts:66-82` signs the bare `userId` with no timestamp/expiry claim; `src/routes/unsubscribe.ts:16-51` verifies with `timingSafeEqual` (correctly) but accepts the link forever. A leaked/intercepted `?u=<id>&s=<sig>` URL works for the life of the account, including via RFC 8058 one-click `POST` (fired by Gmail without the user seeing the page). Impact is bounded to `email_unsubscribed_at` (suppressing balance alerts), hence low.

**Fix:** include an issued-at claim and reject after e.g. 180 days.

## 4. D1-export token digest compared with `===`

`enter.pollinations.ai/src/routes/admin.ts:42-48`:

```ts
const exportTokenHash = c.env.D1_EXPORT_TOKEN_SHA256;
if (exportTokenHash && c.req.path.endsWith("/trigger-d1-sync") &&
    (await sha256(providedKey)) === exportTokenHash) {   // plain string compare
```

The main admin token on the same file uses `secretEquals` (`admin.ts:37`); this one compares a digest of attacker-controlled input with `===`. Practically unexploitable (leaks only prefix bits of a stored SHA-256; preimage-infeasible), but inconsistent with the platform's own constant-time discipline on a grant that exposes full table exports (`d1-tinybird-sync.ts`).

**Fix:** `secretEquals(await sha256(providedKey), exportTokenHash)`.

## Verification notes for what was checked and held

- **Stripe webhook signatures, event replay, cross-user crediting, amount manipulation, checkout pricing, reward idempotency, x402, and refund/reversal paths were re-audited end-to-end and found solid** (primary-key dedup on `stripe_checkout_credits.session_id`, `changes()=1` batch gating on claims, server-side `metadata.userId`, fixed server pricing, `assertRewardAmount` bounds, x402 triple-gated crediting) — no new findings beyond issue 54's already-filed discount scope and issue 72's already-filed refund gap.
- better-auth's in-memory per-isolate rate-limit storage (`rateLimit.storage` defaults to `memory` on Workers) makes the 100/10s and 3/10s caps per-isolate — noted here rather than as its own issue since the documented exposure is bounded by per-isolate dispersion.
- The `chars[byte % 62]` modulo bias in key generation (`device.ts:65-69`, `api-key.ts:142-157`) costs ≈2% of ~190 bits of entropy — negligible, noted to preempt re-reporting.
