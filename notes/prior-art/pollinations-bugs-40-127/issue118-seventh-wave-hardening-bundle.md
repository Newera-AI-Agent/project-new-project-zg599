# Seventh-wave hardening bundle: the sites upload route buffers an unbounded body, the admin site-block commits the D1 row before the Cloudflare delete, a failed device-approve orphans the pre-minted key, the d1_user Tinybird export ships `email` under a header that says sensitive columns never leave D1, and polli's CLI attribution is self-mintable without the CLI

**Severity: low (five verified hardening gaps, none independently exploitable beyond what's noted; each with a one-to-few-line fix).**

**Found: 2026-10-25. Code-verified.**

## 1. `POST /account/sites/:name/upload` has no `bodyLimit` — the one sites route that takes a manifest

`enter.pollinations.ai/src/routes/sites.ts:112-119` defines `inlineBodyLimit` (5 MiB) for the **PUT** route only. The upload-session POST (`:241-297`) validates `ManifestSchema` only *after* Hono's `validator("json")` has parsed the whole body, and no global body limit exists in enter — so a `machines`-permitted key can POST a ~100 MB JSON body repeatedly (the issue-86/100 §3 class on a new route). Fix: apply the same `bodyLimit` (a 1000-entry manifest needs a few hundred KB).

## 2. Admin site-block order: D1 commit before the CF delete

`routes/admin.ts:128-138` — `UPDATE … SET blockedAt` runs **before** `deleteSite`'s Cloudflare call; `gen/src/sites.ts:49-57` serving never consults D1. A transient CF failure leaves a "blocked" site still serving (the blocked row says blocked, the script is live). Fix: delete first, then commit (or retry the delete on the block path).

## 3. Failed device-approve orphans the minted key

The consent screen mints the `sk_` **before** calling `/api/device/approve`; the OAuth-code branch cleans up on failure (`frontend/src/components/auth/authorize.tsx:411-416` — `$delete().catch(() => {})`) but the **device branch throws with no cleanup** (`:362-381`). A slow user (30-min code expiry) or a second-tab race (`requirePendingDevice` 400s) strands a live `Device XXXXXXXX` key on the account with whatever permissions were granted. Same-account only, but it is a key-litter instance the issue-100 §2 fix pass should include. Fix: mirror the code-flow cleanup in the device branch.

## 4. `d1_user` Tinybird export includes `email`

`services/d1-tinybird-sync.ts:20-26` exports `email` in the `d1_user` snapshot under the file's own header "Sensitive columns are excluded here and never leave D1". All `d1_user`-reading pipes carry private tokens (verified per pipe: `kpi_*`, `economics_*`, `app_*` — none `tinybird_read_public`), so there is **no public leak found** — but the export contradicts its own documentation, and one future public pipe over `d1_user` turns it into issue-64-class. Fix: drop `email` from the export (or rename the header and record the decision).

## 5. polli CLI attribution is self-mintable without installing anything

The device flow accepts any `client_id` (`POST /api/device/code`, unauthenticated — issue 83's route), and `validateClientRedirectBinding` (`shared/auth/api-key-creation.ts:172-190`) validates the flow is pending for the requested client but not who started it. So anyone can open a device flow with polli's fixed client id (`pk_VZF38YW4tQX36SEn`), then `POST /api/account/keys` with `consent.requestedClientId` + their own `deviceUserCode` to stamp `byopClientKeyId = jF3QOFUCn0ipcgRqkTU2kiSFMwZtm7v0` — satisfying the `connect_polli_cli` quest (the farming half is issue 112 §3) and **polluting polli's install-funnel metrics** (`polli_cli_task_funnel.pipe`) with zero CLI installs. Fix: bind the device flow's started-by user to the approval session.

## Verified-solid companions (this wave's negative results)

- **Device/OAuth pairing deep-dive:** `device_code` entropy ≈ 238 bits; `user_code` 40 bits unbiased; double-approval blocked (`requirePendingDevice` requires `status === "pending"`); token exchange burns the code before validating, enforces client_id + exact redirect + S256 PKCE; `sess_` JWTs HS256 with issuer/aud/exp/sub, 15-min TTL, live-user lookup. Known gaps are exactly issues 53/60/83 — nothing beyond them.
- **enter has no email/password surface at all** (`CHANGE_EMAIL_DISABLED` path; OAuth profile emails never overwrite the stored one; `update-user` cannot touch `tier`/`githubId`/`role`).
- **Sites claim/publish/JWT path:** `claimSite`'s single-statement `INSERT … SELECT count<5 … ON CONFLICT DO NOTHING` is atomic against both races; publish requires D1 ownership on both paths; site names regex-`[a-z][a-z0-9-]{1,30}[a-z0-9]`, reserved-name-filtered, `encodeURIComponent`d — no punycode/traversal claim on another site's script; user sites live on `pollinations.app`, outside better-auth trusted origins, so no cookie-authority chain.
- **Admission-median poisoning (observability census):** `getEstimatedPrice`'s median is fed exclusively by server-priced `generation_event_v2` rows; community-model owners can poison only their own model's median (and the same numbers set the real charge — the issue-58 divergence, not a new write path); the `TINYBIRD_OUTLIER_RATIO = 10` guard clamps upward poisoning; the beacon-writable `product_event` datasource feeds no security decision (quest pipes read `generation_event_v2` only — the "forge quest completion" line is closed).
- **polli CLI backend routes** are all key-authenticated; `polli keys create` has no permission asymmetry vs the dashboard (the harness/budget/expiry gaps are issue 102's).
