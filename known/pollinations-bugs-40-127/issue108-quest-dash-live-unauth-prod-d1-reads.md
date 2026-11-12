# The `quest-dash-live` operations worker serves an unauthenticated `/data` endpoint (default `workers.dev` host, no routes, no `workers_dev = false`) that reads the production `enter-prod` D1: per-event reward feeds with users' GitHub usernames, display names and avatar URLs, plus three unthrottled full-table `GROUP BY` aggregates per request against the same database that backs the production enter API

**Severity: medium-high (unauthenticated production-DB cost/DoS surface + PII-lite disclosure; a workers.dev host that scanners routinely enumerate).**

**Found: 2026-10-25. Code-verified from the committed wrangler.toml + worker.js. The live host name was not probed (would confirm deployment state; the config itself is the finding).**

## Summary

`operations/quest-dashboard/wrangler.toml` deploys a worker with:

- **No routes** and **no `workers_dev = false`** — so it is served on the account's default `quest-dash-live.<account-subdomain>.workers.dev` subdomain (account id committed in the toml: `b6ec751c0862027ba269faf7029b2501`).
- **No auth binding of any kind** — its own header comment: *"No build step, no secrets: D1 binds by id at the account level."*
- A direct binding to the **production** database: `database_name = "enter-prod"`, `database_id = "fc771b05-4e24-48bf-980c-d09f21279bd1"` — the same D1 that serves the enter API's auth, billing and keys.

The handler (`operations/quest-dashboard/worker.js:239-249`) serves `/data` with **no authentication and no rate limit**, `cache-control: no-store`:

```js
if (url.pathname === "/data") {
    const data = await snapshot(env);
    return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
```

`snapshot(env)` (`worker.js:57-74`) batches **four queries per request**, three of which are unbounded aggregates over the whole `rewards` table:

- `FEED_SQL` — the 40 most recent reward events **joined to `user`** and returning `github_username, name, image` (display name + avatar URL), quest title, pollen amount, balance bucket, exact earn/claim timestamps.
- `AGG_SQL` — per-quest `GROUP BY` over the full table (no LIMIT).
- `TOT_SQL` — full-table COUNT/SUM aggregates.
- `TOP_SQL` — top-8 earners with the same user PII.

## Impact

1. **Disclosure beyond the public leaderboard's intent.** The public quest leaderboard API deliberately exposes only lowercase GitHub logins and aggregates; this feed adds **display names, avatar URLs, per-event timing, amounts and buckets**. The rewards ledger is growing (every quest claim platform-wide), so this surfaces users who never opted into any public standings page.
2. **Unauthenticated production-DB cost/DoS.** Every `/data` hit runs 3 full-table scans + a join against `enter-prod`, uncached (`no-store`) and unthrottled. A trivial loop burns D1 rows-read quota and adds latency to **the same database the production enter API uses** — the same "unthrottled reads on a shared production resource" class as issue 88, but on a host with **no authentication at all** (issue 88's endpoint at least required a session). D1 pricing is per-rows-read; a rewards table with 10⁵+ rows makes each request a measurable bill.
3. **Host exposure.** Default `workers.dev` subdomains appear in deploy logs and are routinely enumerated by scanners; the worker also ships `account_id` and the prod `database_id` in the repo.

## Why this is not a duplicate

- **Issue 63** (unauthenticated analytics/agent sync) and **issue 88** (unthrottled `/api/account/quests`) are enter-worker endpoints requiring a session; this is a separate `operations/quest-dashboard` worker, never mentioned in any filed issue.
- **Issue 64** (unauthenticated GPU worker registry leak) is the same *class* (unauth internal ops data, different service and data) — this is the D1-bound sibling.

## Fix (minimal)

1. Put the `@pollinations/auth` admin gate in front (the pattern `operations/kpi`, `economics` and `observability` already use — `packages/auth/src/server.ts:235` enforces `user.role === "admin"`), or delete the worker if retired.
2. Set `workers_dev = false` and serve on an internal route.
3. Cache the snapshot for ~20 s (matching the page's poll interval) — `no-store` on a full-aggregate query is the worst case for both cost and DB load.

## Verification note

Static verification only: the committed config is the evidence. The default host was **not** probed to confirm it is live (that check belongs to the maintainers; if it 404s because `workers_dev` was disabled post-commit, the committed state is still a one-line-away regression).
