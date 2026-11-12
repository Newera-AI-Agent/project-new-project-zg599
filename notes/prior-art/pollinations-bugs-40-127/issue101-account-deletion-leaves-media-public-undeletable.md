# Account deletion leaves every R2 media blob publicly readable forever — and permanently undeletable: no purge on delete, reads need no owner check, and fetching a blob at least once every 30 days refreshes its lifecycle so it never expires; the DELETE endpoint requires catalog rows the deletion just cascade-removed

**Severity: medium (data-lifecycle / privacy: user-uploaded content — and agent-run outputs in the same bucket — outlive the account, world-readable by URL, with no self-service or admin purge path left in the repo).**

**Found: 2026-10-25. Code-verified end-to-end (delete path, read path, TTL refresh, delete-endpoint precondition).**

## Summary

`POST /api/auth/delete-user` cleans up exactly one thing before better-auth removes the account rows:

```ts
// enter.pollinations.ai/src/auth.ts:368-375
user: {
    deleteUser: {
        enabled: true,
        beforeDelete: (user) => removeUserSites(env, user.id),   // ← sites only
    },
},
```

`rg MEDIA_BUCKET enter.pollinations.ai/` → **0 hits**. Nothing enumerates or deletes the deleted account's media objects. The D1 catalog rows (`mediaItem`/`mediaTag`) cascade away with the user (FK `onDelete: "cascade"`, `shared/db/media-catalog.ts`), while the **R2 blobs survive**.

The read side has no owner or account check at all:

```ts
// media.pollinations.ai/src/index.ts:1008-1049 — security: []
async (c) => {
    const response = await readMedia(c.env, id, c.executionCtx, c.req.method);
    ...
// media-upload.ts:108-150 — straight R2 get by id, serves customMetadata
// (originalName, uploadedBy) and Content-Disposition with the original filename
```

And retention is **reader-refreshed** — `readMedia` streams through `refreshR2ObjectTtl` (`shared/r2-storage.ts`), which rewrites any object older than 15 days, resetting its 30-day lifecycle clock. A blob fetched at least once per 30 days **never expires** — the R2 rewrite even preserves the ex-user's `uploadedBy` metadata and original filename.

## Why the blobs become undeletable, not just orphaned

The public DELETE endpoint authorizes through the catalog:

```ts
// media.pollinations.ai/src/index.ts:976-985
// "Only cataloged (published) items are deletable: an uncataloged id
//  has no owner record to authorize against, so it answers 404 just
//  like an unknown id."
const owner = await catalogItemOwner(db, id);
if (owner === undefined) return c.json({ error: "Media item not found" }, 404);
```

After account deletion the catalog rows are gone, so `catalogItemOwner` returns `undefined` — **the ex-owner can never delete their previously published uploads, even with proof of ownership**, and no admin purge path exists in-repo. (The route's own comment documents the invariant for *uncataloged* ids; account deletion turns *cataloged* ids into the same state, silently.)

## Attack / impact chain

1. User uploads media (issue 69 already showed uploads can carry active content; issue 65 the unthrottled storage) or an agent run writes outputs into the same bucket (issue 75's media-RPC).
2. User deletes their account (GDPR-style expectation: my data goes away).
3. Every blob they ever uploaded/published remains world-readable at `https://media.pollinations.ai/<id>` — with original filename — for as long as anyone fetches it monthly; with zero remaining deletion path.
4. The same holds for private/unpublished uploads if the id leaks (ids are returned to the uploader and appear in logs/history).

Note the codebase's own care about this class: `refreshR2ObjectTtl` carries an `onlyIf: { etagMatches }` guard specifically so a *concurrent delete* must win the race — the delete-vs-refresh race was considered, but deletion-of-the-*owner* was not.

## Fix (minimal)

In `deleteUser.beforeDelete` (and the admin-delete hook at `auth.ts:267-281`): before the cascade, enumerate the account's cataloged `mediaItem` ids, then delete the corresponding `MEDIA_BUCKET` objects (or hand them to a GC queue that deletes ownerless blobs after a grace period). Also consider excluding `refreshR2ObjectTtl` for blobs whose catalog row no longer exists, so orphaned content ages out instead of being immortalized by reads.

## Live verification plan (5 minutes, staging)

Upload a tagged media file → record URL → delete account → `GET /<id>` still 200 with `Content-Disposition: originalName` → `DELETE /<id>` 404 → re-GET after 15+ days (or accept the code-verified refresh) to demonstrate the indefinite retention.
