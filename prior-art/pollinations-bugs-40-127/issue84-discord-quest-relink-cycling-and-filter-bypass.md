# Discord quest rewards re-earnable on one Pollinations account by cycling linked Discord accounts + quest-dedupe filter clause that bypasses the per-user `earned` set

**Severity: low (bounded by Discord Sybil costs) — but it breaks the platform's stated once-per-account quest invariant, and the same filter clause is a standing hazard for every future per-identity quest.**

**Found: 2026-10-25. Code-verified (all four links of the chain are in the repo; no live Discord accounts were created).**

## Summary

The quest system documents and enforces the invariant *"An account earns each per-user quest once, even when its reward identity changes (a Google user connecting GitHub)"* (`enter.pollinations.ai/src/services/quest-checker.ts:59-60`). That invariant is implemented by an `earned` set — every `rewards.questId` the account already has — and a filter that drops proposals for already-earned quests. **Discord quests are the exception that bypasses it**: their proposals always carry a per-Discord-identity `idempotencyKey`, and the filter's first clause (`proposal.idempotencyKey ||`) lets any key-carrying proposal through regardless of the `earned` set. Since a Pollinations account may unlink and relink Discord accounts (only GitHub is unlink-blocked), each newly linked Discord account re-pays the same account:

```
// quest-checker.ts:69-76 — the bypass
const proposals = sourceResults
    .flatMap((entry) => entry.proposals)
    .filter((proposal) =>
        proposal.idempotencyKey ||            // ← Discord proposals always pass here
        proposal.quest.scope === "once" ||
        !earned.has(proposal.quest.id),       // ← the per-user dedup, skipped for them
    );

// groups/discord-community.ts:88-90 — the per-identity key
idempotencyKey: `quest:${quest.id}:discord:${member.discordId}`,
// "Once per Discord account: relinking one Discord account to other
//  Pollinations accounts earns nothing more."
```

The dedupe that actually runs for Discord quests is the database unique constraint on `idempotencyKey` — i.e. **once per Discord account**, not once per Pollinations account.

## The four links (all verified in code)

1. **Discord can be unlinked and relinked.** The unlink guard blocks GitHub only (`auth.ts:214-222` — `/unlink-account` with `providerId === "github"` → `GITHUB_ACCOUNT_CANNOT_BE_DISCONNECTED`; Discord and Google are unlinkable). The one-per-provider check (`auth.ts:187-198`, `hasAccount`) only rejects a **simultaneous** second link, not sequential cycling. Discord link requires an explicit authenticated `link-social` (`auth.ts:152-157` blocks Discord sign-in; `disableSignUp: true`), which the account owner can perform for any Discord account they control.
2. **The quest evaluation follows the currently linked account.** `getPollinationsDiscordMember` (`enter.pollinations.ai/src/services/discord.ts:47-58`) reads `account.provider_id = 'discord'` for the user — after relinking, that is the new Discord id, and `quest_agent`-style proposals are re-emitted for the same `userId`.
3. **The filter bypasses the per-user `earned` set** for every proposal carrying an `idempotencyKey` override (quest-checker.ts:71-76). Today only `discord-community.ts:90` sets one, so the Discord quests (`join_discord` 1 pollen, `discord_level_10` 2, `discord_level_20` 5, all `scope: "perUser"`) are re-payable to the same account.
4. **`recordRewards` inserts fresh rows** because the unique key (`quest:join_discord:discord:<id>`) differs per Discord account (`shared/billing/rewards.ts:108-121`, `onConflictDoNothing` on `idempotencyKey` only), and both rows are claimable by the same user (`claimReward` gates on `rewards.userId`).

## Impact

- `join_discord` (1 tier pollen) is re-earnable per **new** Discord account that joins the server; the level quests add 2 / 5 pollen but require genuine Arcane XP grinding on each account, which bounds practical abuse.
- The invariant break is structural: the comment at quest-checker.ts:59-60 states the intended semantics, and the code contradicts it for exactly the quest family that uses identity-keyed rewards. Any future quest that adopts `proposal.idempotencyKey` (the field's docstring invites it: *"Replaces the scope-derived key, e.g. to pay once per Discord account"*) silently inherits the same per-account re-earn behavior.
- Bounded today, cheap to fix, and worth closing before per-identity quests spread.

## Fix (minimal)

- In `checkQuestsForUser`, apply the per-user dedupe to key-carrying proposals too: drop a proposal when `earned.has(proposal.quest.id)` **unless** the quest is intentionally cross-account (if the "once per Discord account, across Pollinations accounts" behavior is wanted, encode it explicitly in the quest definition, e.g. `scope: "perIdentity"`, and keep the `earned` check for `perUser` scope).
- If cross-account payment is *not* wanted either, key Discord quests on the Pollinations `userId` (scope-derived `rewardKey`) — the per-Discord-account keying only exists to stop one Discord account enriching many Pollinations accounts; a two-column guard (`userId`-per-quest **and** `discordId`-per-quest) covers both directions.

## Companion hardening notes (same audit, same surface)

1. **Promo-code redeem is unthrottled** (`enter.pollinations.ai/src/routes/promo-codes.ts:94-167`): every attempt is a KV read and, on hit, D1 reads + a possible reward insert. Codes are 40-bit random Crockford base32 (8 chars) so brute force is impractical (~2^40), but there is no per-account or per-IP rate limit and no lockout on repeated failures — add one (e.g. 10 attempts / minute / account) before an event code with a high `pollenAmount` and `maxRedemptions` is ever leaked partially. Redemption is otherwise well-guarded (per-GitHub-identity idempotency via `rewardKey`, apiKey callers rejected, count-then-insert acknowledged to overshoot slightly).
2. **`quest_agent_usage` pipe takes `github_username` as a client-supplied query parameter** (`groups/agent-usage.ts:92` — `{ user_id, github_username }`). The server-side client re-filters rows by `userId`, which is the load-bearing guard; the username parameter should either be removed or documented as pipe-side-untrusted, because a future pipe revision that keys `create_used_community_model`-style completions on the username string (community model IDs are `community/<username>/<name>`) would make historical spend attributable to whoever currently holds a recycled username.
3. Cross-reference (already filed): `hasMergedPr` trusts a username-based GitHub search without a `databaseId` re-check, unlike its siblings (`github-contributions.ts:502-512`) — noted in issue 82's companion section; same family of string-identity trust.

## Verification notes for what was checked and held

- **Google cycling is blocked**: proposals for `perUser` quests without `idempotencyKey` overrides hit the `!earned.has(quest.id)` clause, so unlinking Google and relinking another does not re-pay (the `earned` set is keyed on the Pollinations `userId`, which survives identity changes).
- **GitHub cycling is blocked twice over**: `/unlink-account` hard-blocks GitHub, and `githubId`/`githubUsername` are `input: false` additional fields written only by the OAuth callback (`auth.ts:316-331`) — verified that better-auth's update-user path cannot set them (401 for API-key callers; session-only, and the field config rejects the input anyway).
- **Delete-and-recreate does not re-earn**: `rewards.userId` is `onDelete: "set null"` (`shared/db/better-auth.ts:492-493`) so rows survive account deletion with their unique `idempotencyKey` intact, exactly as the ToS states.
