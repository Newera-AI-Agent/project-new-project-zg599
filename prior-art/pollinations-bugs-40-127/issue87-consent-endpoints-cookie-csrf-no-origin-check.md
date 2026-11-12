# Consent endpoints take session cookies with no Origin check — their only CSRF defense is SameSite=Lax, which every attacker-controlled *.pollinations.ai subdomain defeats

**Severity: medium (silent device approval with attacker-chosen key + scope, chaining issues 53/62; write-only CSRF, responses not readable).**

**Found: 2026-10-25. Code-verified (full chain read; not executed against a victim).**

## Summary

Four state-changing Hono routes on `enter.pollinations.ai` authenticate **session cookies** and perform **no Origin/Referer validation whatsoever**:

- `POST /api/device/approve` and `POST /api/device/deny` — `enter.pollinations.ai/src/routes/device.ts:175-242` (`auth({ allowApiKey: false, allowSessionCookie: true })`)
- `POST /api/oauth/code` — `src/routes/oauth.ts:87-149` (same cookie-only auth)
- `POST /api/session-token` — `src/routes/session-token.ts:14-23`

The shared `auth()` middleware (`src/middleware/auth.ts:47-138`) authenticates but contains no origin check (verified: no `origin`/`csrf` match in the file). Contrast with better-auth's own router, which wraps **every** `/api/auth/**` route in `originCheckMiddleware` (`node_modules/better-auth/dist/api/index.mjs:157-160`). The session cookie is `__Secure-better-auth.session_token`, `SameSite=Lax` — which blocks **cross-site** POSTs but **attaches automatically to any same-site subdomain request** (site = `pollinations.ai`).

The platform has repeatedly demonstrated attacker-controlled same-site content hosts: `media.pollinations.ai` serving HTML inline (issue 31), user apps on `*.pollinations.app`/shared domains (issue 76), websim HTML (issues 78, 80), agent-published assets (issue 77). Any of those pages can silently drive the victim's session through `/api/device/approve`.

## The two halves of the chain

1. **The endpoint trusts the cookie and nothing else** (device.ts:175-207): it reads the victim's session, looks up the *attacker's* pending device by `userCode`, and writes the approved credential straight into KV:

```ts
.post("/approve", auth({ allowApiKey: false, allowSessionCookie: true }),
    validator("json", ApproveDeviceSchema),
    async (c) => {
        const user = c.var.auth.requireUser();     // victim's session
        const body = c.req.valid("json");           // attacker's userCode + apiKey + scope
        const device = await requirePendingDevice(db, body.userCode);
        await Promise.all([
            c.env.KV.put(`device-key:${device.deviceCode}`, JSON.stringify({
                key: body.apiKey, keyId: body.apiKeyId,
                expiresIn: body.expiresIn ?? null,
                scope: body.scope ?? null,          // attacker-chosen, may exceed the row's
            }), { expirationTtl: KV_TTL }),
            ...
```

2. **The request reaches the endpoint without a preflight.** A cross-origin JSON POST normally dies at the CORS preflight (`cors({ origin: "*", allowHeaders: [] })` in `src/index.ts:37-43` returns `Access-Control-Allow-Origin: *`, which is never valid for credentialed requests). But Hono's `validator("json")` → `c.req.json()` follows the Fetch spec — **`Request.json()` parses the body regardless of the Content-Type header**. So the CSRF request is a CORS *simple request*:

```js
// runs on any attacker-controlled *.pollinations.ai page
fetch("https://enter.pollinations.ai/api/device/approve", {
    method: "POST",
    credentials: "include",                        // SameSite=Lax + same-site -> cookie sent
    headers: { "content-type": "text/plain" },     // simple request: NO preflight
    body: JSON.stringify({
        userCode: "ATTACKER-PENDING-CODE",          // attacker initiated this device flow
        apiKey: "sk_victim_or_attacker_chosen",     // attacker-chosen credential
        apiKeyId: "...", scope: "keys profile",     // attacker-chosen scope
    }),
});
```

`POST /api/device/deny` accepts `application/x-www-form-urlencoded` explicitly (`parseFormOrJsonBody`, device.ts:220), so it is CSRF-able with a plain HTML form. `POST /api/oauth/code` and `POST /api/session-token` share the same validator-ignores-content-type property.

## Attack scenario

1. Attacker starts a device flow (or crafts an OAuth code request) and has a pending `userCode` awaiting approval.
2. Attacker hosts the fetch above on any same-site content origin the platform currently exposes (media upload serve, an app page, websim output — issues 31/76/78/80 documents these; their fix status is pending verification).
3. A signed-in victim visits the attacker page. Their session silently approves the attacker's device with an attacker-chosen `apiKey` and `scope` — no consent screen, no XSS required.
4. The attacker's device flow now exchanges the approval for a credential against the **victim's** account. This is the issue-53 outcome (device approve trusts client-sent `apiKey`) achieved through a **CSRF** instead of the issue-40 XSS that the current fixes were built against.

Secondary effects: `POST /api/device/deny` can kill any of the victim's pending CLI logins ( nuisance/DoS), and `POST /api/session-token` can be spammed (response unreadable cross-origin without credentials, so the token itself is not directly stolen — but the write executes).

## Why the existing issues don't cover this

- **Issue 32** analyzed better-auth's `/api/auth/*` wildcard-origin problem and asserted "the Hono routes under `/api/account/*` are safe because they are Bearer-only" — true for `/api/account/*` (verified `allowSessionCookie: false`), but these four routes are cookie-authenticated Hono routes, a different surface in the same app.
- **Issue 53** fixed ownership of the device being approved; the CSRF here has the attacker approving *their own* device with the *victim's* session, which passes that ownership check by design.
- **Issue 83** hardened throttling/ownership on the same routes and explicitly concluded "SameSite=Lax cookies block the cross-site POST" — correct for cross-site, wrong for the same-site subdomain content the platform itself hosts.

## Fix (minimal)

Add an Origin allowlist check to the shared Hono `auth()` middleware for cookie-authenticated mutations (reject when `Origin`/`Referer` is absent or not in `{https://enter.pollinations.ai, https://pollinations.ai}`) — one place, covers all four routes and any future ones. Keep better-auth's `originCheckMiddleware` for `/api/auth/*` as-is.

## Companion note (same surface)

`src/auth.ts:356-367` unconditionally trusts `http://localhost:3000` and `http://127.0.0.1:3000` in **production** (the non-prod ports 3457/4180/4000 are correctly env-gated). Any attacker content served from the victim's own localhost:3000 passes better-auth's own origin check and can drive the cookie-authenticated `/api/auth/*` mutations (update-user, unlink-account, sign-out, revoke-sessions; delete-user is freshness-gated). Requires a local foothold, hence low on its own — fold into the same fix pass.
