# One shared Cloudflare API token fronts every site deploy, publish, code-agent deploy/delete and account-deletion cleanup — and the routes that spend it are unthrottled, so a single free account can pin the platform's shared 1,200-requests/5-min Cloudflare API quota and make all deploys, agent creates and deletion cleanup fail platform-wide

**Severity: medium-high (cross-user platform outage of the sites/agents surface; attacker cost 0 pollen; shared-quota class). NOT load-tested — PoC provided for the maintainers' controlled window only.**

**Found: 2026-10-25. Code-verified (token concentration → unthrottled routes → 429-to-502 propagation → co-tenant blast radius).**

## Summary

Every privileged deployment operation in enter goes out through **one** Cloudflare API token — `CODE_AGENT_DEPLOY_API_TOKEN`:

- `startSiteUpload` (`enter.pollinations.ai/src/services/sites.ts:93-124`) — `POST ${dispatchScriptUrl(...)}/assets-upload-session` with `Authorization: Bearer ${token}`.
- `publishSite` (`sites.ts:188-217`) — script `PUT` with the same token.
- `deployCodeAgent` / `deleteCodeAgent` (`services/code-agent.ts:159-225`) — same token.
- `removeUserSites` (`sites.ts:232-252`) — **account-deletion site cleanup** — same token.

The routes that trigger these calls are authenticated but **unthrottled** (enter has no rate-limit middleware; gen's `/account/*` proxy at `gen/src/index.ts:252-258` forwards without `edgeRateLimit`):

- `POST /api/account/sites/:name/upload` (`routes/sites.ts:241-297`) — auth is `auth({allowSessionCookie:false, allowApiKey:true})` + `requireAccountPermission(apiKey, "machines")`, then `claimSite` (a D1 read after the first claim), then **one Cloudflare API call**. The per-account cap of 5 sites (`sites.ts:22-23, 165-186`) caps *distinct names*, not call frequency — re-uploading the same site repeats the CF call every time.
- `PUT /api/account/sites/:name` (inline deploy, `sites.ts:299-381`) — up to **3 Cloudflare API calls per request** (upload-session + asset-upload + script PUT).
- `POST /api/account/agents` (code agent, `routes/agents.ts:388-489`) — 2 GitHub REST calls (shared installation token, `services/github-api.ts:14-29`) + 1 CF PUT + 1 raw.githubusercontent fetch.

`requireCloudflareSuccess` (`services/dispatch-script.ts:33-47`) converts a CF 429 into a 502 for the caller — and the quota is **shared across every user's deploys**.

## Attack description (for the controlled window — NOT executed)

A free account (session cookie, or a self-minted `sk_` with `machines`) loops the upload route with a minimal manifest:

```
while true; do
  curl -s -o /dev/null -X POST \
    "https://enter.pollinations.ai/api/account/sites/my-site/upload" \
    -H "Authorization: Bearer sk_…machines…" \
    -H "Content-Type: application/json" \
    -d '{"manifest":{"/index.html":{"hash":"00000000000000000000000000000000","size":12}}}'
  # ~4 req/s sustained; the inline PUT path spends 3 CF calls per request,
  # so short bursts suffice
done
```

Cloudflare's API token budget is **1,200 requests / 5 minutes**; ~4 req/s (or a burst through the inline `PUT` path at 3× per request) keeps the shared quota permanently exhausted. Every other user's `polli sites deploy`, app publish, code-agent create/sync/delete, and even **account-deletion site cleanup** then 502s until the window resets. The GitHub REST leg of the same loop also burns the 15k/hr installation REST budget that quests and agent resolution depend on — the REST sibling of issue 88's GraphQL burn.

**Aggressiveness for the controlled test:** 4-10 req/s from one account is enough to observe CF 429s surfacing as 502s on a second account's deploy. The signal to measure: `requireCloudflareSuccess` failure counts and CF dashboard API-token request rates.

## Why this is not a duplicate

- **Issue 63 §2** covers the *unauthenticated* agent-sync route — which is throttled 1/30 s per agent; these authenticated deploy routes have **no throttle at all** and burn a *Cloudflare* quota, not GitHub.
- **Issue 88** is the quests GraphQL endpoint (session-required, different quota).
- **Issue 94 §2** is the sites *storage* quota (R2 bytes), not the deploy API quota.

## Fix (minimal)

1. Per-account deploy throttle (e.g. 1 per 5 s) on `POST /account/sites/:name/upload`, `PUT /account/sites/:name`, and the code-agent create path.
2. A shared-budget counter (KV/DO) around every `CODE_AGENT_DEPLOY_API_TOKEN` spend with 429-on-exhaustion instead of a raw CF 429→502 for co-tenants.
3. Alert on the token's 429 rate in the Cloudflare dashboard.

## Companion notes (same surface)

- `DELETE /api/account/sites/:name` (`sites.ts:402-404`) validates the `name` param with plain `z.string()` where siblings use `SiteNameSchema` — not exploitable (ownership lookup + `encodeURIComponent` on the dispatch URL) but a validation-consistency nit.
- Sites live on `*.pollinations.app` (not a better-auth trusted origin) — re-verified solid.
