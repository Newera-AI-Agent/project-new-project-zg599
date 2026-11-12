# x402 prepaid keys have no working revocation primitive: the only delete API trips a D1 foreign key (`x402_key_purchase.key_id`, `NO ACTION`) and returns a raw 500, the mint carries no expiry, the patch endpoint has no `enabled` field — and the x402 holding user can never be deleted either

**Severity: medium (broken credential-lifecycle control on a real-money route; composes with issue 66's signature-replay key exposure; permanent 500-on-delete for the platform's own tooling).**

**Found: 2026-10-25. Code-verified (schema, mint, delete, patch, auth honoring of `enabled`).**

## Summary

The x402 prepaid-key purchase table is raw SQL with foreign keys and no `ON DELETE` clause — SQLite `NO ACTION`:

```sql
-- enter.pollinations.ai/drizzle/0066_x402_key_purchases.sql:1-8
CREATE TABLE x402_key_purchase (
    payment_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id),
    key_id TEXT NOT NULL REFERENCES apikey(id),
    ...
```

Purchase rows are inserted on every buy (`services/x402-key-purchases.ts:115-122`) and **never deleted anywhere in the repo**. All keys are minted under the platform's holding user (`routes/x402-keys.ts:76` — `holdingUserId = c.env.X402_HOLDING_USER_ID`) with **no `expiresIn`** (`x402-key-purchases.ts:104-113` — `pollenBudget: 0` until settlement funds it).

Three consequences, all verified:

1. **`DELETE /api/account/keys/:id` on any x402 key throws the FK.** The route's only delete is `db.delete(apikeyTable).where(eq(apikeyTable.id, id))` (`routes/account.ts:2064`); D1 enforces FKs (this codebase relies on it in production — `shared/db/sites.ts:12-16` documents `onDelete: "set null"` firing), so the delete on an x402-backed key returns a raw internal 500. The holding account cannot revoke a funded prepaid key through the only API that exists.
2. **No expiry, no disable.** `UpdateKeySchema` on `PATCH /api/account/keys/:id` (`account.ts:1869-1979`) exposes name/models/budget/questPollenOnly/accountPermissions/expiresAt/description/redirectUris/earnings — **no `enabled`** — even though the auth path honors `enabled === false` (`shared/auth/api-key.ts:349-354`). The only live remedy is PATCHing `expiresAt` into the past as the holding account, which is undocumented.
3. **The buyer has no Pollinations login by design** ("Buy a new secret API key without a Pollinations login", `x402-keys.ts:34`) — so there is no self-service revocation path at all; the buyer's only credential is the `sk_` string itself. Issue 66 §1 already showed a captured `payment-signature` header replays the **funded plaintext key** to anyone forever; this filing closes the loop: even after discovering the leak, revocation is a 500.
4. **The holding user row is un-deletable for the platform's lifetime** — `deleteUser` (`src/auth.ts:368-375`, `beforeDelete = removeUserSites` only) runs `DELETE FROM user` through better-auth, blocked by the `user_id` FK. Residual `encrypted_key` rows (funded key material under `BETTER_AUTH_SECRET`) accumulate permanently.

## Attack chain

1. Buyer pays USDC on-chain → receives the funded `sk_` once in the HTTP body.
2. The key string leaks by any ordinary means (issue 66's replay makes this strictly worse).
3. Victim (no account, no dashboard) can do nothing. Platform-side, the only delete endpoint returns 500; no disable exists; no expiry was minted.
4. The funded key keeps spending until its budget is exhausted — the attacker, not the victim, decides when.

## Why this is not a duplicate

- **Issue 66** covered the x402 route's signature-as-bearer replay and error-leak surfaces; its hygiene note covered secret *rotation* bricking, not deletion.
- **Issue 89 §4** re-verified the x402 *payment/credit* paths solid (exactly-once, `credited_at IS NULL` transactional guard) — this is the *key lifecycle after crediting*, a different half.
- **Issue 103 §2** is the Stripe/deletion residue bundle; it verified "x402 minted keys are `pollenBudget: 0`, no account permissions" without touching the FK or revocation. No filed issue mentions the FK constraint or revocation primitive.

## Fix (minimal)

1. Migration: rebuild `x402_key_purchase` with `key_id … ON DELETE cascade` and `user_id … ON DELETE cascade` (or `set null` + a cleanup job).
2. Delete purchase rows when the funded key is fully spent (budget ≤ 0 and no pending resume).
3. Expose a buyer-facing "burn my prepaid key" endpoint authenticated by the key itself (the buyer's only credential) — `DELETE /v1/x402/burn` with `Authorization: Bearer sk_…`.
4. While at it: honor `enabled` in `UpdateKeySchema` so the platform can soft-disable without hand-DDL.
