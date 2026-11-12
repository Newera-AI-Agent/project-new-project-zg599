# Pollen farming III (compositions) — `top_up_since_launch` (5 tier) pays on ANY `stripe_checkout_credits` row regardless of amount paid, so the issue-54 100%-off promo checkout and the issue-72 buy-refund-keep loop each convert into quest pollen on top of their own bugs; plus the colluder exchange rate on `app_pollen_10` (3 pack in → 10 tier + 3 pack kickbacks out)

**Severity: low-medium as standalone (composition multiplier on two filed criticals; the colluder math is an economics observation).**

**Found: 2026-10-25. Code-verified (quest source query → composition inputs). No purchases, promos or refunds were performed.**

## Summary

### 1. `top_up_since_launch` credits on checkout-credit *existence*, not amount

`enter.pollinations.ai/src/services/quests/groups/account-setup.ts:110-118` defines the quest (5 tier pollen); the proposal source (`:186-204`) is:

```sql
SELECT stripe_checkout_credits.user_id AS userId,
       SUM(stripe_checkout_credits.pollen_credited) AS totalPollen
FROM stripe_checkout_credits
WHERE stripe_checkout_credits.user_id = ${user.id}
  AND (… created_at > launch cutoffs …)
GROUP BY stripe_checkout_credits.user_id
LIMIT 1
```

Any post-launch row qualifies — there is no `amount_total > 0` join. Compositions:

- **With issue 54** (the 100%-off promo-code checkout credits the full pack for `amount_subtotal`): a $0 checkout that credits pollen also **satisfies this quest (+5 tier)** — and a $0 "p100"-class checkout would also fire `top_up_100_since_launch` (+50).
- **With issue 72** (refunds/chargebacks never reverse credited pollen): buy → quest pays +5 → refund → everything retained. (Issue 72 already notes the quest-tier interaction; this documents the exact trigger rows and the per-identity once-ness — the amplification is per farmed account, per issue 112's baseline.)
- Asymmetry note: **x402 purchases and auto-top-up invoices do not count** (different tables), but auto-top-up rows *do* count toward `pollenBought` for the paused Honey Census (`github-contributions.ts:553-563`).

### 2. The colluder exchange rate on `app_pollen_10` and `create_used_community_model`

`app_pollen_10` pays **10 tier** when *others* spend 3 paid pollen in your apps (`app-growth.ts:72-83`); `create_used_community_model` pays **2 tier** for 0.5 pollen of other-user spend; the community reward loop returns **0.75× to the model owner** and BYOP markup another **0.25× to the app owner** (`track-helpers.ts:413-476`).

Two colluding accounts, B spends 3 pack pollen through A's app on A's community model:

- A receives: 10 tier (quest) + 2.25 pack (community reward, credited to the payer's bucket — pack, since B paid pack) + 0.75 pack (markup) = **10 tier + 3 pack back**.
- The pair's net: **−3 pack → +10 tier +3 pack**, i.e. ≈10 tier pollen for ≈$0 net pack cost (the 3 pack rounds back to A).

`is_external` is only `user_id != owner` (`byop_app_payer_daily_mv.pipe:14-17, 33-42`) — no velocity, unique-payer, or fraud floor beyond the inequality. This is a **paid-conversion discount** rather than a mint (real pack pollen must enter), but at a 3.3× multiplier on round-tripped funds it is the platform's most efficient pack→tier exchange, and it composes with every pack-granting bug (54/72) and with issue 112's farmable identity baseline. Both quests are perUser-once, so the rate is per identity pair — the multiplier, not the repetition, is the finding.

## Why this is not a duplicate

- Issues 54 and 72 are the underlying payment bugs; this files the **quest-side conversion** they feed (different code path, different fix location — `account-setup.ts:186-204`), plus the unfiled colluder-rate economics.
- Issue 58 is forged usage; this is honest-but-colluding spend at a designed-but-unbounded reward ratio.
- Issue 112 covers the grant-side farming; this covers the paid-spend-side multipliers.

## Fix (minimal)

1. `top_up_since_launch`: join the checkout's `amount_paid`/`amount_total` and require `> 0` — one predicate, closes the 54/72 compositions' quest leg.
2. `app_pollen_10`/`create_used_community_model`: require K unique external payers (not one), or scale the reward down by round-tripped volume (net-spend instead of gross).
