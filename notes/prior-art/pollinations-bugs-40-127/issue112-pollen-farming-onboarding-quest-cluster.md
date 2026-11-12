# Pollen farming I — the onboarding quest cluster is a self-seeding mint: `use_app` is satisfiable with two of your own keys, the five usage quests are satisfiable with quest-granted tier pollen via ~1e-5-pollen micro-charges, and the multi-account baseline is ~2.75-4.75 tier pollen per fresh GitHub identity with no signup velocity control anywhere in the platform

**Severity: medium (aggregate platform-funded compute exposure; each individual vector is small, but the cluster is closed-loop, self-funded by the platform's own grants, and has no per-IP/per-device friction).**

**Found: 2026-10-25. Code-verified end-to-end (quest definitions → completion pipes → attribution minting). No farming was performed: the chain was verified against the code and telemetry definitions only.**

## Summary — three findings, one economics picture

### 1. `use_app` (0.25 tier) pays for two of your own keys and no app, no usage, no third party

The quest's completion check is only that a key with BYOP attribution **exists** (`enter.pollinations.ai/src/services/quests/groups/account-setup.ts:206-213`):

```sql
SELECT apikey.user_id AS userId FROM apikey
WHERE apikey.user_id = ${user.id}
  AND apikey.byop_client_key_id IS NOT NULL
LIMIT 1
```

The attribution is mintable entirely through `POST /api/account/keys`: (1) create a `publishable` key → own `pk_`; (2) create a `secret` key with `consent: {requestedClientId: <own pk_>, redirectUri: <registered cb>}` — `validateClientRedirectBinding` (`shared/auth/api-key-creation.ts:135-208`) only checks the pk_ is valid and the redirectUri is in its allowlist, then stamps `byopClientKeyId` (`:297-299`). (3) `POST /api/account/quests/check` → proposal → claim. The quest's own description ("Log in to any app in the apps directory") is never enforced — **no app exists, no request is ever made through the key**. (Issue 58 Addendum 1 used this plumbing as billing-drain step 3; the quest-integrity defect itself is unfiled until now.)

### 2. The five usage quests are bucket-agnostic — the platform's own 0.25 grant funds the "paid usage" that earns 1.25 more

The completion pipes require a *billed, successful* call, never **which bucket** paid:

- `quest_model_modalities_populate.pipe:19-28` — `WHERE … AND total_price > 0` (no meter/bucket filter) for `used_text/image/audio/video`.
- `quest_agent_usage_populate.pipe:2-5` — *"successful top-level prompt, code and endpoint agent calls, **including zero-cost agents**"* — so `use_agent` (0.25) costs one call to any free public agent.
- `used_community_model` requires `total_price > 0` — and the community price floor is `MIN_COMMUNITY_PRICE_PER_MILLION_TOKENS = 0.000001` (`shared/community-endpoints.ts:54`), i.e. a ~1e-5-pollen call.

Attack arithmetic: fresh account → create first key (auto-claims `first_api_key` 0.25) → with that 0.25 tier pollen, make five micro-billed calls (tiny text, tiny image, 1-second audio, minimal video, one min-priced community model) → all five flags set → claim `use_text/image/audio/video_model` (0.25×4) + `use_community_model` (0.25). **The 0.25 grant seeds 1.25-1.5 more**, cost to the platform ≈ 0.00005 pollen of its own grant plus provider-side minimums. The loop is closed: the platform pays the seed that pays the usage that pays the reward.

### 3. The multi-account baseline: ~2.75-4.75 tier pollen per fresh identity, zero platform-side friction

Day-0 per fresh GitHub/Google identity (all self-serve, no maintainer, no third party): `first_api_key` 0.25 + `use_app` 0.25 (finding 1) + `use_agent` 0.25 + five usage quests 1.25 (finding 2) + `connect_polli_cli` 1.00 (the check is a `byop_client_key_id = POLLI_CLIENT_KEY_ID` key row + **account age ≥ 3 days** — `account-setup.ts:216-225` — "installing the CLI" is never verified) + `join_discord` 1.00+ (per **Discord** identity — the relink-cycling half is issue 84). ≈2.75 day-0, ≈3.75 at day 3, ≈4.75 with a Discord account.

Signup itself grants nothing and email/password signup is disabled (better-auth `emailAndPassword` defaults false, never enabled; Discord sign-up hard-blocked — `enter/src/auth.ts:152-157, 214-222`) — so the cost of one account is one GitHub/Google identity. But **nothing in the repo rate-limits the farm**: `check-fraud-bans.mjs` only reacts to Stripe fraud; the only IP usage at signup is analytics (`visitorCountry`); the only quest-side throttle is the per-account 60 s check throttle. Tier (Quest) pollen buys every non-paid-only model — **real provider spend** — so 1,000 farmed identities ≈ 3,000-4,750 pollen of platform-funded compute, before any of the value-multiplier compositions (issue 58's community loop, issue 82's quest-field bounties).

## Impact

- Platform-funded provider spend scaling linearly with identity minting, with zero marginal cost beyond captchas the IdPs themselves enforce.
- Every farmed account also carries the standing attack surface of the rest of the platform (realtime issue 85 needs only tier pollen above a median; e2b/agents/MCP surfaces likewise).

## Why this is not a duplicate

- **Issue 84** covers Discord relink cycling on *one* account and the promo-redeem throttle — not the aggregate multi-account baseline, not `use_app`, not the tier-funded usage quests.
- **Issue 82** covers quest *bounty misrouting* on app submissions — different quests, different mechanism.
- **Issue 88** covers the quests endpoint's quota burn — availability, not economics.
- **Issue 58** covers forged *usage billing* — this is granted-quest economics.

## Fix (minimal)

1. `use_app`: require attribution with **usage** (a billed call through the attributed key — the Tinybird flag pattern the agent pipe already uses), not mere key existence.
2. Usage quests: require a minimum real spend per modality (e.g. ≥0.01 pollen) or pack-bucket spend, closing the tier-seeds-tier loop.
3. `connect_polli_cli`: verify an actual CLI-originated usage event, not key existence + account age.
4. Signup velocity: per-IP/per-device friction on OAuth account creation (the repo already trusts `cf-connecting-ip` for analytics), plus an aggregate alert on `first_api_key` claims per IP range.

## Verified-solid companions (checked and held — do not re-audit)

- Tier→pack laundering through community/BYOP rewards is **closed**: `creditCommunityOwner`/`creditDev` credit the payer's deduction bucket (`track-helpers.ts:273-275, 445-476`), the bucket ladder picks tier first (`deduction.ts:63-95`), rewards are suppressed on negative payer buckets (`:293-306`), self-calls excluded (`:226`). A tier-paying colluder pair farms only tier, at a ≥25% loss.
- x402 crediting is exactly-once (`x402-keys.ts:109-123`, `x402-key-purchases.ts:141-190`).
- Promo codes: admin-created only, 40-bit Crockford, uniform 404 (no oracle), one redemption per GitHub identity per event, no stacking.
- Referrals (`routes/referral.ts:54-76`) are telemetry-only — no pollen.
- Account deletion + recreate cannot re-earn (rewards idempotency keys survive; `rewards.userId onDelete: "set null"`).
- No free-credit endpoints exist in apps/, MCP servers, e2b, sites, media, or the polli CLI; the only balance-seeding script is dev-only (`gen.../scripts/seed-local-key.mjs`).
- No cron quest-checker exists (enter exports `fetch` only); checks are user-initiated (throttled 60 s) or the key-creation hook.
