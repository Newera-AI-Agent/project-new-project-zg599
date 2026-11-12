# The `community_endpoint` table is uncapped, and the shared catalog KV value it feeds has a 25 MiB ceiling whose overflow is silently swallowed — past the ceiling, every gen isolate falls back to a full-table D1 join on every 60 s expiry (5 s once degraded), turning a free account's insert loop into a platform-wide model-registry and D1 outage that persists with zero further attacker traffic

**Severity: high (platform-wide availability of the core generation path; D1 is shared by gen + enter + media; attacker cost ≈ 0 pollen; strictly larger blast radius than issue 69).**

**Found: 2026-10-25. Code-verified end-to-end (insert routes → catalog cache → silent-overflow path → per-isolate full-scan fallback → degraded retry loop). NOT load-tested — per the responsible-disclosure protocol the platform asked for, the PoC below is provided for the maintainers' own controlled test window and was never executed.**

## Summary

Issue 69 established the "cheap request → platform lag → DB struggle" class. This finding is the same class with a much larger multiplier: **one free account, spending zero pollen, can plant rows that make every model resolution on every gen isolate run a full-table join against a table whose size the attacker chooses — forever, with no further requests.**

The chain:

### 1. The insert side is uncapped, unthrottled, and free

Three create routes write `community_endpoint` rows with **no per-account count cap and no rate limit** (enter mounts no rate-limiting middleware at all — `enter.pollinations.ai/src/index.ts:34-73` mounts only CORS + requestId + logger):

- `POST /api/account/my-models/` — "Create My Model" (`enter.../routes/community-endpoints.ts:637-732`): gates are `requireUser` + `requireAccountPermission(apiKey, "keys")` + `requireOwnerGithubUsername` + name-uniqueness (`ensureModelNameAvailable`). `enforcePublishingAccess` (`:293-300`) returns early for **private** visibility — the publisher allowlist only applies to public listings, but private rows still enter the gen catalog.
- `POST /api/account/my-models/endpoint-agents` (`:564-636`) — same shape.
- `POST /api/account/agents` (`enter.../routes/agents.ts:388-489`) — **a prompt agent is a pure D1 insert**: no Cloudflare call, no GitHub call; `serializePromptAgentConfig(input)` stores a `systemPrompt` of up to **8,000 characters** (`shared/community-endpoints.ts:715`) — i.e. ~8 KB of attacker-chosen text per row, plus title/description fields.

Only the owner deletes rows; enter defines **no cron** at all (`enter.pollinations.ai/wrangler.toml:107-111` — `crons = []`), so there is no GC either.

### 2. The rows feed one shared KV value with a hard ceiling — and the overflow is swallowed

Every gen isolate loads the community catalog through one cached value whose own comments say it exists because the scan was already the bottleneck (`gen.pollinations.ai/src/community-models.ts:34-53`):

```ts
// One shared copy of the catalog for every gen isolate: each isolate running
// the full-table query on its own 60s expiry was most of the D1 load. ...
const COMMUNITY_CATALOG_CACHE_KEY = "community-catalog:v2";
const COMMUNITY_CATALOG_CACHE_TTL_SECONDS = 60;

const cached = await env.KV.get(...).catch(() => null);
if (cached) return cached;
const entries = await queryCommunityModelRegistryEntries(env.DB);
await env.KV.put(COMMUNITY_CATALOG_CACHE_KEY, JSON.stringify(entries), {
    expirationTtl: COMMUNITY_CATALOG_TTL_SECONDS,
}).catch(() => {});            // ← the failure is swallowed
```

Workers KV has a **25 MiB per-value limit**. At ~1.5-3 KB of JSON per registry entry (22 selected columns + payload + pendingPayload), the serialized catalog approaches that ceiling in the **tens of thousands of rows** — a volume one account reaches in minutes of looping the prompt-agent insert. When the `put` fails, the `.catch(() => {})` **silently discards the error** and returns the entries — the code proceeds as if the cache worked.

### 3. The miss path is an unbounded full-table join, and it runs per isolate per TTL

`queryCommunityModelRegistryEntries` (`community-models.ts:66-96`) is a `SELECT` of 22 columns (including both `payload` and `pendingPayload`) `FROM community_endpoint INNER JOIN user … WHERE githubUsername IS NOT NULL` — **no LIMIT, no pagination**. The catalog is loaded by `getGenerationModelRegistry` on **every model resolution** (every generation request), cached per isolate for 60 s (`model-registry.ts:30-33, 289-314`; the code's own comment: *"Racing a few cheap SELECTs on cache expiry is the better trade"*). Per row, `parseListingPayload` + `communityModelDefinition` + `modelInfoFromDefinition` run in-worker (`community-models.ts:97-290`) — CPU that scales linearly with the attacker's row count.

### 4. The degraded path makes it worse, and it never recovers on its own

If the D1 read itself throws, `loadGenerationModelRegistry` swallows it and serves a **static-only registry** — every community model and every agent silently disappears platform-wide — with `DEGRADED_REGISTRY_TTL_MS = 5_000` (`model-registry.ts:35-39, 264-287`): the retry loop keeps hitting D1 every 5 seconds per isolate while the table stays oversized. The D1 database is **the same `database_id` bound by gen, enter and media** (all three `wrangler.toml`s) — the contention competes with auth, billing, keys, and the media catalog.

Secondary load on the same table:
- `GET /api/account/my-models/:id/fallback-candidates` (`community-endpoints.ts:533-542`) runs the same unbounded join per authenticated call.
- The daily D1→Tinybird export pages through the table 5,000 rows at a time (`enter.../services/d1-tinybird-sync.ts:11, 46-60`).
- `/models` responses and the per-isolate KV reads grow into the megabytes.

## Attack description (for the maintainers' controlled window — NOT executed)

One free account (GitHub-linked, `account:keys` key), zero pollen spent:

```
for i in $(seq 1 30000):
    POST /api/account/agents
      {"type":"prompt_agent","name":"filler-$i","title":"f","description":"f",
       "systemPrompt":"<8KB of padding>","baseModel":"openai-fast",
       "visibility":"private"}
```

Each request is one D1 insert — no upstream, no throttle, no per-account ceiling. Sustained ~20-50 req/s plants 40-100k rows in 10-30 minutes (well under the gen edge limiter's 1,000 req/s/IP documented in issue 14). Damage then **persists with the attacker silent**: every gen isolate, every 60 s (5 s in degraded mode), re-runs the full join and re-pays the per-row parse CPU. Expected platform effects, in order: `/models` latency and size growth → gen isolate CPU-limit resets on the fleet → D1 latency for all co-tenants (gen auth/billing + enter + media) → static-only registry (all community models and agents vanish) with a 5 s retry storm keeping D1 hot.

**Aggressiveness for the controlled test:** the insert loop above at 20-50 req/s for 10-30 min is sufficient; the measurable signal is (a) the serialized size of `community-catalog:v2` approaching 25 MiB (KV write errors in logs — today they are invisible), (b) registry-load latency per isolate, (c) D1 `queryCommunityModelRegistryEntries` latency. A cheaper canary variant for a low-traffic window: plant ~5-10k rows and watch registry-load latency double before touching the ceiling.

## Why this is not a duplicate

- **Issue 88** is the quests GitHub-GraphQL fan-out (different upstream, different endpoint, requires session).
- **Issue 90** is the community *proxy fetch* timeout (outbound hang, not table growth).
- **Issue 94 §2** is the sites *storage* quota bypass (R2, not D1, not this table).
- **Issue 100 §2** covers unbounded *apikey* rows and paused e2b storage — a different table and a different resource (and it notes /account/keys littering, not the catalog cache).
- No filed issue covers `community_endpoint` row caps, the `community-catalog:v2` 25 MiB ceiling, the `.catch(() => {})` on the cache write, or the full-scan-per-isolate fallback.

## Fix (minimal)

1. **Cap rows per account** on all three create routes (e.g. 25 private + N public per user), with a 429 on the cap.
2. **Stop swallowing the KV write failure**: log/alert on `KV.put` failure of the catalog key — the 25 MiB overflow currently produces zero telemetry.
3. **Bound the scan**: `LIMIT`/keyset pagination + a platform-wide row ceiling in `queryCommunityModelRegistryEntries`; or split the catalog into per-owner KV values.
4. Consider a periodic GC/audit job (enter has `crons = []` today) for orphaned private rows.

## Verified-solid companion notes (same surface, checked and held)

- `POST /my-models/models` (upstream probe) is throttled 1/30 s per account (`community-endpoints.ts` probe route).
- The KV **throttle** keys used elsewhere (`quest-check`, `code-agent-sync`, community probe) all carry TTLs — the gap here is the *table*, not KV hygiene.
- Media gallery pagination is properly bounded (`MAX_LIMIT = 100`, keyset cursor) — the pattern to copy.
