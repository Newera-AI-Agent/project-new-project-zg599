# done GET /api/account/quests is uncached and unthrottled, and each call runs the full GitHub-App GraphQL fan-out — one authenticated user can starve quest payouts and code-agent creation platform-wide

**Severity: medium-low (authenticated availability/integrity attack on the reward pipeline; errors are swallowed so failures are silent).**

**Found: 2026-10-25. Code-verified (route, service, and GraphQL cost chain all read; no load test was run against the shared quota).**

## Summary

The authenticated dashboard route `GET /api/account/quests` calls `listQuestCards` on **every request** with no cache and no rate limit — and `listQuestCards` is one of the most expensive things the platform runs against its shared GitHub App installation token:

```ts
// enter.pollinations.ai/src/routes/account.ts:1161-1174
.get("/quests", ... async (c) => {
    await c.var.auth.requireAuthorization();
    const user = c.var.auth.requireUser();
    requireAccountPermission(c.var.auth.apiKey, "usage");
    const [cards, rewardRows] = await Promise.all([
        listQuestCards({ db, env: c.env }),   // ← full fan-out, no cache, no throttle
        ...
```

`listQuestCards` (`src/services/quests/index.ts:27-34`) fans out over every quest group; the GitHub groups run `loadQuestIssues` — the expensive nested GraphQL search the code itself warns about (`src/services/github-contributions.ts:220-238`: *"adding commit authors to the issue search multiplies its rate-limit cost about 200 times"*) — plus one `COMMIT_AUTHORS_QUERY` per app-publish PR (:415-422). A single call costs on the order of hundreds of GraphQL points.

The asymmetry that makes this an attack surface: the **unauthenticated** twin `GET /api/quests/catalog` is KV-cached for 60 seconds (`src/routes/quests.ts:69-76`, `CACHE_TTL = 60`), so anonymous traffic is bounded to one fan-out per minute. The **authenticated** route has nothing — and enter has no rate-limiting middleware at all (`src/index.ts:34-73` mounts only CORS/requestId/logger; the only KV throttles in the app are `quest-check` at 60 s, `account.ts:1259-1276`, and `code-agent-sync` at 30 s).

Even the throttled `POST /api/account/quests/check` runs the entire `evaluateUser` per check (`github-contributions.ts:565-584`: `loadQuestIssues` + `hasMergedPr` + paginated `reportedIssueProposals` + two `answeredSurvey` searches ≈ 5+ GraphQL searches), ~60 checks/hour/account.

## Attacker scenario

```bash
# any registered account (or any sk_/session credential with account:usage)
while true; do
  curl -s -H "Authorization: Bearer sk_..." \
    https://enter.pollinations.ai/api/account/quests > /dev/null
done
```

Installation tokens carry ~15,000 GraphQL points/hour, shared by **all** quest checks, the quest catalog builder, and `resolveCodeAgentRepository` (code-agent creation, `src/services/code-agent.ts:42-96`). At hundreds of points per call, a single loop exhausts the budget within minutes. Consequences:

1. **All GitHub-derived quests silently stop being credited for every user** — `evaluateGroup` swallows GitHub errors and returns `proposals: []` (`src/services/quest-checker.ts:165-179`), so the POLLEN-QUEST bounty ledger, merged-PR, reported-issue, and survey rewards all read as unearned until the quota resets. No error surfaces anywhere.
2. `POST /api/account/agents` (code-agent creation) fails via `resolveCodeAgentRepository` 502s.
3. Organic dashboard traffic (which already rides close to this budget) collapses into the same degraded state.

## Fix (minimal)

- Serve the authenticated route from the same 60 s KV cache the public catalog uses (the quest catalog is not user-specific until `rewardRows` is merged in — cache the GitHub-derived half, keep the per-user rewards query live).
- Add a per-user KV throttle to `GET /api/account/quests` (e.g. 6/min, matching the `quest-check` pattern already in the file).
- Optionally cache `loadQuestIssues` per repository with a short shared TTL so the checker and the catalog stop re-paying the same search.
