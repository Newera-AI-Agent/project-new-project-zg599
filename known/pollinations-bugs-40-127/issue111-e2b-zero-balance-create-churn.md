# Zero-balance e2b sandbox create-churn: the create handler runs the E2B list → create → get sequence before the post-hoc funds check for the lease price, so a 0-pollen wallet still burns 4 E2B team-API calls per attempt — and E2B's concurrency/quota limits are per team, so the churn degrades sandbox operations for everyone

**Severity: medium-low (shared-provider quota burn reachable with an empty wallet; each failed create also litters a permanent `polli-sandbox-*` key row via enter's key API). NOT load-tested.**

**Found: 2026-10-25. Code-verified (handler order in gen's e2b create route).**

## Summary

The create handler (`gen.pollinations.ai/src/routes/e2b.ts`, `POST /v2/sandboxes`) runs in this order:

1. `requireAccountFunds(c, 0)` — passes for **any balance ≥ 0, including 0**.
2. `requireCapacity(c)` — an E2B **list** call (`e2b.ts:195-209`; the route's own comment: *"E2B's concurrency limit is per team"*).
3. The E2B **create** call (`:470-492`).
4. `getSandbox` (`:511` area) — an E2B **get**.
5. Only then the post-hoc `requireAccountFunds(c, bill.price)` — which fails for an empty wallet, triggering the **delete** cleanup (`:513-518`).

Net: a free account with **0 pollen** forces, per attempt, 1 E2B list + 1 E2B create + 1 E2B get + 1 E2B delete, plus D1 work in `charge()`'s tracking path — **four team-quota E2B API calls and a real (short-lived) sandbox boot, zero spendable balance**. Each create with a logged-in template additionally mints a permanent `polli-sandbox-*` key row through enter's key API (`e2b.ts:370-391`) — the key-litter half is issue 100 §2; the **E2B API-quota burn with an empty wallet is not covered** by 100 §2 (which concerns funded users' paused boxes), 45 (charge-swallow race), or 95 (login-key scope).

## Attack description (for the controlled window — NOT executed)

```
while true; do
  curl -s -o /dev/null -X POST "https://gen.pollinations.ai/alpha/e2b/v2/sandboxes" \
    -H "Authorization: Bearer sk_…(balance 0)" \
    -H "Content-Type: application/json" \
    -d '{"template":"…","timeout":60}'
done
```

Effective ceiling is the gen edge limiter (1,000 req/s/IP per issue 14); meaningful pressure at ~20-50 req/s. Blast radius: E2B team API quota/concurrency exhaustion → sandbox create/connect latency or failures for **all users** (per-team limits), plus D1 write churn.

## Why this is not a duplicate

Covered above (100 §2 / 45 / 95 all different). Issue 83 is the device-code D1 write DoS.

## Fix (minimal)

Pre-check funds against the **minimum lease estimate** (first-bill price) *before* the capacity list and create calls — the estimate the billing path already computes. A 402 before step 2 costs one D1 read instead of four E2B calls and a sandbox boot.
