# issue 83 — auth-surface hardening bundle: device-flow D1 write amplification with no row GC or throttle; `approve` accepts an unvalidated `apiKey`; `sess_` minting is unthrottled per-session; model-key permission is not re-checked on fallback candidates

**Severity: low (hardening; each item verified in code, several live-confirmed 2026-10-25 — none individually exploitable past the platform's existing cookie/CORS defaults, but each removes a defense-in-depth layer)**
**Status: code-verified on `origin/main`; `POST /api/device/code` live-confirmed unauthenticated (2026-10-25)**

## Summary

A full pass over the previously-unaudited authentication surfaces (`src/routes/device.ts`, `src/routes/oauth.ts`, `src/routes/session-token.ts`, the `/authorize` + `/device` consent pages, and gen's fallback loop) found the core flows solid — PKCE S256 with burn-before-validate, `SameSite=Lax` session-cookie defaults that block the CSRF chains, HMAC-verified webhooks, reflected-header CORS without `credentials`. The residual weaknesses below are defense-in-depth gaps worth closing.

### 1. `POST /api/device/code` — unthrottled, unauthenticated, permanent D1 row growth

`device.ts:110-143`: every call inserts a `deviceCode` row (live-confirmed without credentials). Rows are deleted **only** on successful token exchange (`device.ts:335-340`); expired and abandoned flows accumulate forever — there is no cleanup job and no `expiresAt`-based sweep. The route also has no rate limiter (compare the quest-check KV throttle), so an unauthenticated loop grows the table at line rate (write-amplification DoS on D1 storage/quotas — the write-side sibling of issue 66's x402 read-burn note). `GET /api/device/info` and `POST /api/device/token` add unthrottled unauthenticated D1 reads (validation oracle for user/device codes — 8×log32(2) ≈ 40 bits for user codes, infeasible to brute-force, but unthrottled enumeration still lets an attacker map live flows at request speed).

### 2. `POST /api/device/approve` accepts any `apiKey` — no ownership validation

`device.ts:175-214`: the endpoint stores `body.apiKey`/`body.apiKeyId` in KV verbatim and never checks the key belongs to the approving session's user. The consent page is currently the only writer (it mints the key itself, `frontend/src/components/auth/authorize.tsx:335-360`), so this is not reachable today: `SameSite=Lax` cookies block the cross-site POST, and a same-site XSS with cookie access could already act as the user. But the same gap exists in `POST /api/oauth/code` (`oauth.ts:86-149`, `apiKey: z.string().min(1)` with no ownership check). One shared `assertKeyBelongsToUser(user, body.apiKeyId)` in both handlers would make the invariant structural instead of incidental.

### 3. `POST /api/session-token` — unthrottled minting of a full-owner bearer

`session-token.ts`: any session can mint `sess_` tokens (15-minute, survives sign-out, "acts as the account owner with no key restrictions" per `shared/auth/session-token.ts`) with no per-session throttle. A compromised or malicious dashboard-adjacent page that holds a session can mint them in a loop, each extending the window of off-browser access. A per-session re-mint throttle (e.g. one per 60s) bounds this.

### 4. `requireModelAccess` is not re-run per fallback candidate

`gen/src/routes/generation-handlers.ts:178` passes `(candidate) => enforceModelRateLimit(c, candidate)` as the fallback `beforeAttempt` hook — rate limits are re-checked per candidate, but `keyAllowsModel` is not. Today this is benign: platform registry fallback chains are same-model provider routes (`shared/registry/text-fallbacks.ts` etc. — every entry re-registers the *same* model on a second provider), and community fallback chains are price/balance-gated at link time (`gen/src/fallback.ts:305-312` — `isCommunityFallbackBalanceAllowed` + `isCommunityFallbackPricingAllowed`). But the loop permits cross-model targets, and the first cross-model chain that ships would silently serve models the key never allowed. Adding `c.var.auth.requireModelAccess()`-equivalent for the candidate id (or asserting candidate.modelId === requested) makes the invariant hold by construction.

### 5. CORS posture note (informational)

`enter/src/index.ts:37-44`: `cors({ origin: "*", allowHeaders: [], ... })` — Hono's middleware **reflects** `Access-Control-Request-Headers` verbatim when `allowHeaders` is empty (`node_modules/hono/dist/middleware/cors/index.js:60-68`), so any header (including `Authorization`) is allowed cross-origin from any origin. Cookie-authenticated reads remain blocked because `credentials` is unset (`Access-Control-Allow-Credentials` absent — verified against the same code path). Key-authenticated API calls being cross-origin is the intended design for browser apps; recording it here because the reflection behavior is non-obvious and should stay deliberate.

## Fix (minimal)

1. Throttle `POST /api/device/code` (per-IP KV limiter, e.g. 10/min) and add a scheduled sweep deleting `expiresAt < now - 1 day` rows; consider the same limiter class for `/info` and `/token`.
2. Validate `apiKeyId` ownership against the approving user in `/api/device/approve` and `/api/oauth/code`.
3. Per-session throttle on `POST /api/session-token`.
4. Re-check model-key permission (or assert same-model identity) inside the fallback `beforeAttempt` hook.

## Verification notes (what was checked and found solid)

- OAuth code flow: PKCE S256 enforced both client- and server-side, code burned before validation, exact redirect matching, metadata-document clients require `https://` client ids (`oauth.ts:65-73,103-128,194-213`); the issue-71 fragment flow is the untouched legacy path.
- CSRF on the consent chain: blocked by default `SameSite=Lax` session cookies (no `cookieOptions`/`defaultCookieAttributes` overrides in `src/auth.ts`), and the `/authorize` page never mints a key before client-side validation completes.
- `sess_` JWT: HS256 with issuer/audience/`exp`/`sub` required claims, 15-minute TTL, key derived with a versioned prefix (`shared/auth/session-token.ts`).
- polli webhook server: HMAC-SHA256 with `compare_digest`, rejects all traffic when the secret is unset (`apps/polli/src/integrations/webhook_server.py:42-65`); polli-cli stores credentials `0600`/`0700`.
- Product analytics beacons are `Origin`-checked; the composio integrations proxy is permission-gated (`account:keys`) with encoded path parameters.
- Device-flow phishing via `verification_uri_complete` auto-redirect is the RFC 8628 standard pattern; the consent screen still requires explicit user action.
