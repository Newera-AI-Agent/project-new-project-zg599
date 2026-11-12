# The usage/earnings/health Tinybird read pipes are unthrottled and uncached per user (50,000-row exports, 90-day windows, full-pipe aggregations per request) — any free account can saturate the shared Tinybird workspace that every dashboard, community-model health view, and the realtime admission median depend on

**Severity: medium (shared-analytics-workspace starvation — the read-side sibling of issue 63's write-side ingest abuse; platform already carries a dedicated `TinybirdRateLimitError` deprecation path, proving the failure mode is real). NOT load-tested.**

**Found: 2026-10-25. Code-verified (routes → pipe parameters → no cache/throttle → shared dependencies).**

## Summary

- `GET /api/account/usage` (`enter.pollinations.ai/src/routes/account.ts:1369-1453`) → `respondDetailedUsage` (`:751-800`) → `fetchTinybirdRows("/v0/pipes/activity_usage_transactions.json", …, { limit, … })` with `MAX_USAGE_EXPORT_ROWS = 50_000` (`account.ts:65`, schema `:472-478`). No cache, no per-user throttle. Same family: `/usage/daily` (`:1455+`), earnings (`:1562+`, `:1642+`), `/account/key/usage` (`:2270+`).
- `GET /api/account/my-models/:id/health` (`routes/community-endpoints.ts:891-971`) — one Tinybird pipe query per request, unthrottled (ownership only).

The platform's own code documents the shared-workspace failure mode (`enter/src/services/tinybird.ts:7-15`):

```ts
/**
 * Thrown when Tinybird returns 429 (rate limit / vCPU budget exceeded). This is
 * transient, so read-only usage endpoints should degrade gracefully ...
 */
export class TinybirdRateLimitError extends Error {
```

Tinybird pipes are shared by: every user's dashboards, community-model health views, and — most critically — `getEstimatedPrice`, the **median-price lookup used for realtime session admission** (`shared/utils/model-stats.ts` — itself KV-cached 1 h, but fed by the same workspace). Saturation therefore degrades (a) all dashboards platform-wide and (b) the realtime admission path's pricing input, while running up Tinybird compute cost.

## Attack description (for the controlled window — NOT executed)

Any registered account (or an `sk_` with `account:usage`):

```
while true; do
  curl -s -o /dev/null "https://enter.pollinations.ai/api/account/usage?limit=50000&days=90" \
    -H "Authorization: Bearer sk_…"
done
```

Each hit is a dashboard-refresh-equivalent aggregation over up to 90 days × 50k rows. **~20-100 req/s authenticated** from one account (well under the documented edge-limiter ceiling) is the aggressiveness band; the observable signal is Tinybird 429 rates and dashboard latency for other users. Anonymous users cannot reach these (auth required) — the surface is account-tier-free but not anonymous.

## Why this is not a duplicate

- **Issue 63** is the write side (unauthenticated analytics ingest beacons); this is the authenticated read side on different endpoints.
- **Issue 88** is the quests GraphQL fan-out (GitHub quota, not Tinybird).
- The `MAX_USAGE_EXPORT_ROWS` cap limits *rows returned*, not *request frequency*.

## Fix (minimal)

1. Per-user throttle (e.g. 1/5 s) on the usage/earnings/health family.
2. A short shared cache (KV, 20-60 s) keyed by user+query — the dashboard pattern.
3. Alert on `TinybirdRateLimitError` rates.

## Companion note (same class, unauthenticated)

`POST /api/referral?ref=image` (`routes/referral.ts:52-73`) is unauthenticated and spends a better-auth **session lookup (D1 read) + Tinybird ingest** per hit — a write-side amplifier in the issue-63 class, adding the session-lookup read. `GET /api/app-lookup` (`routes/app-lookup.ts:72-137`) is likewise unauthenticated/unthrottled D1 reads (2-3 queries per hit: verifyApiKey + apikey + user rows); its embedded client-metadata fetch is properly bounded (5 s timeout, 5 KB cap, blocked hosts — `services/client-metadata.ts:7-8, 39-51`), only the route-level D1 reads are the issue.
