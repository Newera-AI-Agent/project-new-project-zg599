# Payment & deletion hardening bundle: x402 post-settlement missing-receipt check throws a raw 500 at a buyer who already paid; account deletion leaves the Stripe customer + saved card alive and lets an in-flight auto-top-up invoice charge a deleted account with pollen never credited; pack-key string normalization gap ("0.5" vs "0.50") returns raw internal 500s

**Severity: low (money-route robustness; each path already has partial recovery machinery, but the failure modes surface as raw 500s or silent non-credit at exactly the moment a customer has paid).**

**Found: 2026-10-25. Code-verified. Distinct triggers from issues 54/66/72/89 (cross-checked).**

## 1. x402: after on-chain settlement succeeds, a missing `payment-response` header throws a plain `Error` → unauthenticated 500 to the paid buyer

```ts
// enter.pollinations.ai/src/routes/x402-keys.ts:196-199
if (!issued || !c.res.ok) return c.res;
if (!c.res.headers.has("payment-response")) {
    throw new Error("x402 settlement receipt missing");
}
```

By the time this runs, the Weft middleware has verified and settled the payment (that's why the handler and `issued` exist). If the middleware failed to stamp the header, the raw `Error` escapes through `shared/error.ts` as an internal-wording 500 — to a user who **just paid on-chain**. Recovery is possible (the purchase row exists; a same-signature retry hits the `resumeVerifiedPayment` path at `:160-176`), but the 500 body tells the buyer nothing about retrying with the same signature — unlike the deliberate 503-with-guidance ten lines below (`:210-216`). Fix: mirror the 503-retry response here.

## 2. Account deletion vs Stripe: the customer and stored payment method survive, and an in-flight auto-top-up invoice charges the deleted account with no credit and no refund path

- No delete hook touches Stripe anywhere (`rg "customers.delete|deletePaymentMethod"` → 0; `deleteUser.beforeDelete` removes sites only — see issue 101 for the media variant).
- `stripe_auto_top_up_attempt` rows cascade on user deletion (`shared/db/better-auth.ts:252-256, 278`), so `creditAutoTopUpInvoice` (`src/utils/stripe-billing/auto-top-up.ts:334-349`), which looks the attempt up by invoice id, returns `{credited: false, reason: "unknown auto top-up attempt"}` — and the `invoice.paid` webhook (`stripe-webhooks.ts:767-777`) then does nothing further. **Money captured from the card, pollen never credited, no reversal path in-repo.**
- Privacy lifecycle: the Stripe customer object with the stored card persists after account deletion (chargeable by any future invoice event against the same customer).

Fix: `deleteUser.beforeDelete` should cancel/disable auto-top-up and detach or delete the payment method (or at minimum mark the account so `invoice.paid` for a deleted user triggers a refund instead of `credited: false`).

## 3. x402 pack-key string normalization: `/api/x402/keys/0.5` vs `/0.50` — same amount, different `pack_key` string → `preparePurchase` throws "Payment already belongs to another purchase" as a raw 500

Same amount, different path spelling, different `pack_key` → the uniqueness check in `preparePurchase` (`x402-key-purchases.ts:115-137`) trips and the internal message leaks as an unauthenticated 500. This is the same error-hygiene class as issue 66 §2, different trigger. Fix: canonicalize the amount (e.g. `parseFloat` → fixed 2-decimals string) before the pack-key lookup, and map the "belongs to another purchase" case to a 409 with a remediation message.

## 4. (lead, unconfirmable in-repo) "paid but never delivered" if `preparePurchase` itself fails after settlement

If D1 fails between middleware settlement and the purchase-row insert, no purchase row exists; recovery depends on the Weft facilitator accepting re-verification of an already-settled exact-EVM payment. The 503-retry design (`x402-keys.ts:210-216`) implies idempotent re-verify, but the SDK isn't vendored so this could not be confirmed. Worth one staged live test (settle, then break D1 between verify and insert) before treating as covered.

## Verified-clean (this audit; do not re-audit)

x402 amount↔pack binding (challenge price, `resumeVerifiedPayment` gate, and `creditPurchase` all derive from the same stored `pack_key`; cross-pack replay throws; minted keys are `pollenBudget: 0`, no account permissions, `/account/keys` 403), x402 exactly-once (SHA-256 payload PK, loser self-cleans, `credited_at IS NULL` batch guard, concurrency-tested), reward payout math (`onConflictDoNothing` idempotency, `assertRewardAmount` bounds incl. >10,000 rejection, claim gated on `changes() = 1`, `rewardKey` immune to delete-and-recreate, `ROUND(...,8)` + finite-checked precision), referrals (allowlisted telemetry only, no pollen), promo codes (one per GitHub identity per event, session-only, 40-bit Crockford, KV expiry, uniform 404), admin/token gates (`secretEquals`, path+hash-scoped export token — the non-constant-time compare is issue 89 §4), unsubscribe (domain-separated timing-safe HMAC, idempotent POST), status-notice, well-known, docs redirects, GitHub secret-scanning signature chain, app-lookup/client-metadata SSRF posture, oauth `/token` (single-use code, strict PKCE, client_id+redirect_uri equality), sites per-account limit (atomic single-statement `INSERT…SELECT count<5`), Composio integration, quest leaderboard aggregates, agents/account CRUD ownership, earnings-credit suppression for overdrawn wallets.
