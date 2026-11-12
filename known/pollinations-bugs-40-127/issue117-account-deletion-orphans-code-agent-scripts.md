# Account deletion cascades the `community_endpoint` rows but orphans every code agent's deployed Workers script in the `CODE_AGENTS` dispatch namespace forever: deploys carry no owner tags (sites do), the deletion hook cleans sites only, and the API delete swallows Cloudflare failures leaving live scripts behind deleted rows — plus the complete deletion-cleanup census this audit produced

**Severity: low-medium (permanent user-authored code residue in the platform's Cloudflare account; unbounded accumulation; erasure-expectation gap for user code — the code-agent analog of issue 101's media finding).**

**Found: 2026-10-25. Code-verified (deploy metadata, deletion hook, delete paths, cascade table).**

## Summary

### 1. The asymmetric cleanup

The account-deletion hook cleans exactly one Cloudflare resource family — sites, via owner tags:

```ts
// enter.pollinations.ai/src/auth.ts:368-375
user: {
    deleteUser: {
        enabled: true,
        beforeDelete: (user) => removeUserSites(env, user.id),   // sites only
    },
},
```

```ts
// services/sites.ts:230-252 — removeUserSites()
const tags = encodeURIComponent(`${ownerTag(userId)}:yes`);
const response = await fetch(cloudflareAccountUrl(env,
    `/workers/dispatch/namespaces/${encodeURIComponent(namespace)}/scripts?tags=${tags}`),
    { method: "DELETE", ... });            // SITES namespace only
```

Site deploys are tagged (`sites.ts:204` — `tags: [ownerTag(userId)]`), which is what makes that bulk delete possible. **Code-agent deploys carry no tags at all:**

```ts
// services/code-agent.ts:160-183 — deployCodeAgent()
form.set("metadata", new Blob([JSON.stringify({
    main_module: "index.mjs",
    compatibility_date: "2026-09-01",
    bindings: [{ type: "plain_text", name: "POLLINATIONS_BASE_URL", text: env.GEN_BASE_URL }],
})], { type: "application/json" }));          // ← no tags
```

`deleteCodeAgent` is only ever invoked from the per-row API delete (and the type-change PATCH), and even there a transient Cloudflare failure is swallowed while the D1 row still goes away:

```ts
// routes/agents.ts:620-624
if (stored.type === "code_agent") {
    await deleteCodeAgent(c.env, id).catch((error) => {
        console.error("Failed to remove code agent Worker", error);
    });
}
```

The D1 side cascades cleanly on account deletion (`shared/db/better-auth.ts:296-298` — `ownerUserId … onDelete: "cascade"`), so after deletion the scripts become unreachable (gen dispatches the `CODE_AGENTS` namespace only for registered ids) — but they remain **deployed user code in the platform's Cloudflare account with no remaining deletion path anywhere in the repo**. Accumulation is unbounded; a deleted user's code lives on (the code-agent analog of issue 101's media finding), and every agent whose API delete hit a transient CF error adds the same residue while its owner still exists.

### 2. The full deletion-cleanup census (produced during this audit; for the fix and the record)

| Artifact | Status after `POST /api/auth/delete-user` |
|---|---|
| sessions, OAuth account links, `apikey`, oauthClient tokens/consents, stripe attempts/credits, **communityEndpoint (models + all agent types)**, deviceCode, media catalog rows, sandboxKeep | ✅ FK `onDelete: "cascade"` (`shared/db/better-auth.ts`) |
| site rows + CF site scripts | ✅ `removeUserSites` tag-delete |
| rewards ledger | ✅ by design (`userId` → null, idempotency keys survive) |
| blocked-site rows | ✅ by design (names reserved, `userId` → null) |
| R2 media blobs | ❌ **issue 101** |
| Stripe customer / saved card / in-flight invoice | ❌ **issue 103 §2** |
| CF code-agent scripts | ❌ **this issue** |
| x402 purchase rows + holding user | ⚠️ FK blocks deletion itself — **issue 116** |
| e2b sandboxes | ✅ self-healing (keep rows cascade → renewal stops → E2B timeout ≤10 min) |
| KV `device-key:*` | ✅ TTL'd; underlying key rows cascade |
| `sess_` JWTs | ✅ live-user lookup on every auth (`shared/auth/api-key.ts:285-308`) |
| Tinybird raw event history | ⚠️ privacy residue, out of bug-bounty scope (noted) |

## Why this is not a duplicate

- **Issue 101** = R2 media blobs; **issue 103 §2** = Stripe. Both enumerated *external* residues and neither mentions dispatch namespaces; issue 100 §5's verified-clean note covered the *sites* side of dispatch hygiene.
- No filed issue covers code-agent script cleanup.

## Fix (minimal)

1. Tag code-agent scripts at deploy: `tags: [ownerTag(userId)]` in `deployCodeAgent`'s metadata.
2. Extend the deletion hook to a `removeUserDeployments` that bulk-deletes by tag in **both** namespaces.
3. Make the agent-delete `.catch` non-silent (surface a 502 and keep the D1 row when the script delete fails — never drop the row while the script lives).
