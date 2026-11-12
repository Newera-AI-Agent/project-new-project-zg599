# E2B sandbox login mints an uncapped, never-expiring account credential and writes it into the box where untrusted code runs — prompt-injected or malicious-repo code drains the whole account balance and can spawn more sandboxes, and the key outlives the sandbox it came from

**Severity: medium-high (unbounded financial blast radius from the sandbox's designed purpose — running untrusted code; zero attacker privileges needed beyond owning an account).**

**Found: 2026-10-25. LIVE-VERIFIED end-to-end (sandbox created, minted key inspected, in-box credential file read back, cleanup done). Total test cost: 0.00014 pollen.**

## Summary

Every sandbox created from a logged-in template (`pollinations`, `pollinations-large`) gets a platform-generated `sk_` key written to `/home/user/.pollinations/credentials.json`. The creation call omits both spend caps:

```ts
// gen.pollinations.ai/src/routes/e2b.ts:68-71
const POLLI_PERMISSIONS = ["profile", "usage", "machines"];
// (comment): "every process in the box can read the login, and `keys` would
// let it raise any key's budget" — budget/expiry of the login itself were
// not considered

// gen.pollinations.ai/src/routes/e2b.ts:370-385 — logIn()
body: JSON.stringify({
    name: `polli-sandbox-${sandbox.sandboxID}`,
    type: "secret",
    accountPermissions: POLLI_PERMISSIONS,
}),        // ← no pollenBudget, no expiresIn
```

`shared/auth/api-key-creation.ts` only writes `pollenBalance` when the request supplies it (`if (effectivePollenBudget != null)`), and never writes an expiry unless `expiresIn` is given. A `null` budget key spends the **whole account balance** — `requireAccountFunds` (`gen.../utils/generation-access.ts:67-75`) checks the user's funded balance, never the key's budget, and no deduction path treats `null` as 0. The file write is plain `user`-owned (`e2b.ts:397-416`).

The sandbox's **designed purpose is executing untrusted code**: the templates ship LLM harnesses that run model-generated code and clone arbitrary repositories as `user` (`operations/infrastructure/e2b/e2b.Dockerfile:61-67` — claude-code, openclaw, opencode, pi). Every one of those processes can read the login.

## Live verification (2026-10-25)

1. `POST /alpha/e2b/sandboxes {"templateID":"pollinations"}` (normal `machines`-permission key) → `201` + `envdAccessToken`.
2. `GET /api/account/keys` → the auto-minted row:
   ```json
   {"name":"polli-sandbox-<id>","prefix":"sk","expiresAt":null,
    "permissions":{"account":["profile","usage","machines"]},
    "pollenBalance":null}
   ```
   → **no budget cap, no expiry**.
3. Read the file inside the box (envd files API, creator's access token):
   `GET https://49983-<id>.e2b.app/files?path=/home/user/.pollinations/credentials.json&username=user` → `200 {"apiKey":"sk_BMKAgBP…","keyType":"sk"}` — the live credential, in plaintext, in the box.
4. Cleanup: sandbox deleted (204), minted key deleted (200). Lease charge for the whole test: 0.00013875 pollen.

## Attack chains

**A. Prompt injection (remote, no code bug needed).** The Barbara product runs user sandboxes whose Claude Code sessions answer *strangers'* mentions in group chats (`apps/mama-barbara/mama.ts` group mode). A third party injects instructions that steer the in-box session into reading the login file and spending it — generation on any model, **or recursively creating more sandboxes** (`machines` permission + funded balance is all `requireCapacity`/`requireAccountFunds` need), each of which mints *another* uncapped key.

**B. Malicious repo / harness task.** The templates' documented workflow is cloning user-chosen repos and running model-written code in them. Any such code reads `~/.pollinations/credentials.json` (world-readable in the box) and exfiltrates or spends it. The key is **persistent**: it keeps working after the sandbox is paused or deleted — it is a normal account key with `machines`, only discoverable by the owner scrolling their key list (`polli-sandbox-<id>`, no budget, no expiry, no linkage back to a live sandbox).

**C. Budget asymmetry.** A user who deliberately creates their sandbox with a 0.5-pollen capped key still gets an **uncapped** key inside the box — the cap the user chose for the call does not constrain the credential the platform hands to untrusted code.

The code comment shows the `keys`-permission risk was considered and declined; the same reasoning was never applied to the login's own spend cap and lifetime. `mama-barbara` proves the fix shape exists in-tree: it PATCHes a budget of 10 pollen onto its box keys (`apps/mama-barbara/mama.ts:450-457`).

## Fix (minimal)

1. Pass `pollenBudget` (e.g. a sane default, or a fraction of the caller key's remaining budget) and `expiresIn` (e.g. 24 h, matching E2B's own run cap) in `logIn`'s create call.
2. Track minted keys in the sandbox row so pausing/deleting the sandbox revokes (or at least expires) its login.
3. Consider dropping `machines` from `POLLI_PERMISSIONS` unless a harness genuinely needs to spawn sub-sandboxes — that alone caps the recursive-amplification leg.
