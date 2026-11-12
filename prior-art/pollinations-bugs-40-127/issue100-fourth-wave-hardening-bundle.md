# Hardening bundle (4th wave): e2b capacity/keeper asymmetries, per-create permanent key minting, model3d parameter gaps, catgpt key-in-URL (second instance of the issue-55 class), and a pi-workbench defense-in-depth note

**Severity: low-medium overall; individual items marked below. Code-verified.**

## 1. `POST /alpha/e2b/sandboxes/:id/timeout` skips the paused-state capacity check its sibling `connect` performs (low-medium)

`connect` re-checks capacity when resuming a paused sandbox:

```ts
// gen.pollinations.ai/src/routes/e2b.ts:589-610 (connect)
if (sandbox.state === "paused") await requireCapacity(c);
```

but the timeout route — which also extends leases and can resume a box — has **no such check** (`e2b.ts:573-586`):

```ts
.post("/sandboxes/:id/timeout", sandboxDocs.timeout, async (c) => {
    const sandbox = await ownedSandbox(c);
    const { timeout } = await readJson<{ timeout: number }>(c);
    const until = keepUntil(timeout);
    const response = await extendLease(c, sandbox, until ? keepLease(sandbox) : timeout);
```

Two consequences, depending on E2B's behavior for a paused box: (a) if the E2B timeout endpoint resumes the sandbox, `MAX_RUNNING_PER_USER = 8` is bypassable through this route; (b) if it does not, `extendLease` still **bills lease time from `now` for a sandbox that never runs** (`e2b.ts:302-310`) — charging for time not used. Either branch deserves the same `requireCapacity` guard `connect` has.

## 2. Paused sandboxes accumulate without bound; every logged-in create also mints a permanent key row (low-medium)

`requireCapacity` counts **running** sandboxes only (`state: "running"` filter, `e2b.ts:195-209`); creates default `autoPause: true` (`:476-492`); and the `keepSandboxes` cron renews keeps and deletes expired keep rows but **never GCs paused sandboxes** (`:681-769`). The CLI documents paused boxes as "keep their files and memory and cost nothing" (`packages/polli-cli/src/commands/sandbox/e2b.ts:72-73`) with 20-50 GB disks (`apps/machines-mcp/worker.js:63`):

- A funded user can accumulate unbounded paused boxes (unbounded free storage on the platform's E2B team).
- E2B team-level sandbox quotas (their concurrency limit is per-team, `e2b.ts:195`) can be exhausted by one user's paused fleet, blocking sandbox creation for everyone else (cross-user DoS; conditional on E2B-side limits).
- Each create from a logged-in template also mints a permanent `polli-sandbox-*` key (issue 95) — and `POST /api/account/keys` has **no per-account count limit** (`enter.../routes/account.ts:1762-1846`), so a create/destroy loop litters unbounded key rows.

## 3. model3d: `image` parameter has no URL policy, unbounded array, and its declared `maxReferenceImages: 1` is never enforced; `POST /3d` has no body limit (low — addenda to issues 94 §3 / 86)

- `gen.pollinations.ai/src/model3d/params.ts:12-19` builds the `image` array from `|`/`,`-split with **no max length**; `schemas/model3d.ts:30-54,72-94` only checks scheme prefixes (same shape issue 94 §3 filed for image/video params).
- The registry declares `maxReferenceImages: 1` for every 3D model (`shared/registry/model3d.ts:66,87,106`) — enforced on the image route (`image/params.ts:184-191`) but **never on the 3D route**.
- `rodinModel.ts:27` forwards `params.image` verbatim to fal as `image_urls`; `trellis2Model.ts:18` / `assetHarvesterModel.ts:17` forward to InferencePort — credentialed/internal/`http://` URLs reach their fetchers exactly as in issue 94 §3 (add these files to that issue's list).
- `POST /3d/:prompt` (`routes/proxy.ts:1112-1164`) has no `bodyLimit` while `prepareGenerationRequest` buffers the whole body (`generation-cache.ts:161-164`) and persists it into DO storage in 1 MiB chunks — an issue-86-class memory/storage amplification bounded only by Workers limits.

## 4. catgpt hand-rolls the key-in-URL pattern — second instance of the issue-55 class, not fixable by 55's remediation (low)

```js
// apps/catgpt/ai.js:115-124
let url = `${API}/${encodeURIComponent(prompt)}?height=1024&width=1024&model=${model}&key=${encodeURIComponent(key)}`;
```

Every meme generation puts the live `sk_` into the image URL — browser history, proxy/CDN logs, HARs, and the `img.src` DOM attribute for the session. Unlike the SDK path issue 55 covers, this request sends **no Authorization header** (the query key is the only auth), so 55's fix (prefer the header) does not apply — the fix here is switching the `<img>` flow to a headered fetch + blob URL, or a short-lived token. The OAuth fragment itself is stripped after extraction (`script.js:552-558`) and share links never contain the key — it is specifically the generation requests that leak. (Related, platform-wide: the minted key sits in `localStorage["catgpt_api_key"]`, the storage issue 80 already recommended fixing generically.)

## 5. pi-workbench HTML preview isolation rests solely on the iframe `sandbox` attribute (informational)

`apps/pi-workbench/public/app.js:338-341` injects user code into an `srcdoc` iframe whose CSP **allows inline script** (`script-src 'unsafe-inline'`); isolation is preserved only because `index.html:32` sets `sandbox="allow-scripts"` without `allow-same-origin` (null origin). Any future edit that loosens the attribute silently becomes same-origin script execution with the page's `sessionStorage` key. Belt-and-braces: add a `Content-Security-Policy: sandbox` to the srcdoc itself, and drop `'unsafe-inline'` from the injected CSP if the preview does not need it.

## Verified-clean this wave (for the record)

- e2b auth/CSRF (bearer-only, no cookie surface), cross-user sandbox ownership (`ownedSandbox` + forced owner filter), catch-all 403 of E2B's raw surface, keeper cron re-validation, `machines-mcp` relay, polli ssh bootstrap, mama-barbara scripts/budget hygiene (10-pollen box keys — the contrast that makes issue 95 a real fix), model3d serving content-type pinning + filename sanitization + SHA-256 cache keys, DO inventory (no WS-hibernation DOs exist; `GenerationCoordinator` handoff nonce one-shot; rate-limiter DOs name-stable), computer-mcp per-user isolation + GitHub-App token confinement, composio session binding, gimp/krita secret stores, Stripe + GitHub + Telegram + polli webhook signatures, email surface (static bodies, List-Unsubscribe, no CRLF), audio first-party routes (caps/timeouts/meters), frontend XSS sweep (zero new sinks — full census in the wave notes; the filed family 33/40/69/77/78/80/31 remains the complete list).
