# Anonymous, unthrottled OpenAPI schema regeneration fans one public request into heavy schema generation across three production workers — gen's `/openapi.json` re-fetches enter's schema (regenerated per request, not memoized) and media's schema (a real network fetch, also regenerated per request) on every hit, all mounted before the edge-limited proxy and uncached

**Severity: medium (anonymous CPU + subrequest amplification across the three workers serving all paid traffic; free to the attacker). NOT load-tested — PoC for the maintainers' controlled window only.**

**Found: 2026-10-25. Code-verified (route order, per-request fan-out, missing memoization and cache headers).**

## Summary

`GET https://gen.pollinations.ai/openapi.json` (`gen/src/index.ts:289-292`) runs `buildMergedOpenApiSpec(c, app)` per request. The merge (`gen/src/routes/docs.ts:1084-1105`) combines:

1. gen's own schema — memoized per isolate only (`getGenerationSchema`, `docs.ts:769-776` — `generationSchemaPromise ??=`), so **every cold isolate pays the full zod→JSON-Schema build once**, then per-request cheap.
2. **enter's schema — fetched on every request**: `fetchEnterSchema` (`docs.ts:810-825`) does `c.env.ENTER.fetch(...)` to `/api/docs/open-api/generate-schema`, where enter runs `openAPIRouteHandler(apiRouter)` (`enter/src/routes/docs.ts:17-28`) — **full zod→JSON-Schema generation, not memoized**, on a route with **no auth and no rate limit** (`enter/src/index.ts:54`).
3. **media's schema — a real network fetch on every request**: `fetchMediaSchema` (`docs.ts:827-862`) fetches `https://media.pollinations.ai/openapi.json`, where media's `GET /openapi.json` (`media/src/index.ts:1149-1176`) **also regenerates the full spec per request**, with no cache header, and the media worker has no rate-limit binding at all (issue 65 verified none exists).

`GET /docs/open-api/generate-schema` (`docs.ts:1211-1218`) — same merge, public; `?format=yaml` adds a `yamlStringify` of the entire merged spec on top.

None of these responses set `Cache-Control`, so Cloudflare does not cache them; and `/openapi.json` + `/docs` are registered in gen **before** `.route("/", proxyRoutes)` (`index.ts:277-302`), so the edge limiter living inside `proxyRoutes` (`routes/proxy.ts:430`) never applies (and per issue 14 the edge limiter is 1,000 req/s/IP anyway). Issue 9's spoofable IP makes per-IP limits moot.

## Attack description (for the controlled window — NOT executed)

Anonymous, from any number of IPs:

```
# three independent surfaces, all free:
while true; do curl -s -o /dev/null https://gen.pollinations.ai/openapi.json & done
while true; do curl -s -o /dev/null https://enter.pollinations.ai/api/docs/open-api/generate-schema & done
while true; do curl -s -o /dev/null https://media.pollinations.ai/openapi.json & done
```

Per gen request: 1 service-binding subrequest (enter executes its full spec build) + 1 network fetch (media executes its full spec build) + gen's own merge CPU. Meaningful pressure at **~10-50 req/s spread across the three endpoints** — each is independently exposed, tripling the surface. Blast radius: CPU-limit resets on isolates serving co-tenant paid traffic across all three workers, plus subrequest consumption. The YAML variant doubles CPU per request.

## Why this is not a duplicate

No filed issue touches docs/OpenAPI routes (issue 96 = exa MCP OOM; issue 69 = media upload HTML processing; issue 88 = quests GraphQL — different surfaces).

## Fix (minimal)

1. Memoize enter's and media's `/openapi.json` per isolate like gen does (one line each — the pattern exists in `docs.ts:769-776`).
2. Set `Cache-Control: public, max-age=300` on the merged responses, or generate at deploy time.
3. Move `/openapi.json` + `/docs/open-api/generate-schema` behind the edge limiter.
