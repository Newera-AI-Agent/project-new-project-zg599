# Community-model usage forgery: a public listing bills any caller its self-reported token count — and the owner pockets 75% as reward

## Summary

Every price a community model charges is computed from usage numbers **the community endpoint itself reports in its response**, with no magnitude bound anywhere:

```ts
// gen.pollinations.ai/src/text/handler.ts:185-211 — usageHeaders()
const usage = completion?.usage;              // ← upstream (community) response
const normalizedUsage = usage ? openaiUsageToUsage(...) : undefined;
... buildUsageHeaders(modelUsed, normalizedUsage)   // → x-usage-* response headers
```

```ts
// shared/schemas/openai.ts:628-670 — CompletionUsageSchema
completion_tokens: z.number().int().nonnegative(),   // ← NO upper bound
prompt_tokens:     z.number().int().nonnegative(),   // ← NO upper bound
```

`gen.pollinations.ai/src/text/chat/usage.ts:7-15` validates only the shape. The middleware then charges the caller exactly this:

```ts
// gen.pollinations.ai/src/middleware/track.ts:1339-1377 — extractUsageHeaders()
const usage = parseUsageHeaders(response.headers);   // the endpoint's own numbers
// track.ts:418-438
const deduction = await handleBalanceDeduction({
    totalPrice: responseTracking.price?.totalPrice,   // tokens × listing price
    ...
});
```

And the listing owner is simultaneously credited 75% of that charge:

```ts
// shared/billing/track-helpers.ts:49-76 — selectCommunityModelReward()
if (servedCommunityEndpoint?.visibility === "public") {
    return { userId: servedCommunityEndpoint.ownerUserId,
             rewardRate: COMMUNITY_MODEL_REWARD_RATE,   // 0.75
             basePrice: servedPrice };
}
// shared/community-endpoints.ts:28
export const COMMUNITY_MODEL_REWARD_RATE = 0.75;
```

The preflight `requireFunds`/reservation uses gen's *estimated* average price, so it does not stop the inflated post-hoc deduction.

## Impact (live-verified chain)

Live evidence (2026-10-22, real key): calling `community/CloudCompile/MiniMax-m3.1-flash:free` returned `x-usage-prompt-text-tokens: 208` / `x-usage-completion-text-tokens: 5` — literally the upstream's self-reported numbers — and calling the priced `community/tomdacatto/tower-kitchen-table` billed the caller's balance from those same headers.

Attack: an allowlisted community publisher (the `shared/auth/github-id-list.ts` allowlist — dozens of outside community members, not core staff) serves `"usage": {"prompt_tokens":0, "completion_tokens":1000000000, "total_tokens":1000000000}` in their endpoint's response for a model priced at the cap (`MAX_COMMUNITY_PRICE_PER_MILLION_TOKENS = 50`):

- any user who calls that public model is charged **1e9 × 50/1M = 50,000 pollen** — bounded only by their balance, drained in one request;
- the publisher is credited **0.75 × charge = 37,500 pollen** as a community reward — the attack is directly profitable;
- the same unbounded trust exists in the other modalities: transcription duration (`gen.pollinations.ai/src/audio/communityEndpoint.ts:206-210` + `communityTranscriptionSeconds`), video (`shared/community-media.ts:19-34`, `usage.duration`), and image token counts (`gen.pollinations.ai/src/image/communityEndpoint.ts:198-215`).

This is an arbitrary-caller wallet drain + self-enrichment primitive. The `communityModelRewardInput?.userId === userId` self-call exclusion does not stop it — the victim is a different account.

## Fix (minimal)

Sanity-bound self-reported usage at settlement, e.g. any of:

1. Cap the billable total at `K ×` the preflight estimate for the request (K ≈ 10 covers legitimate variance), and cap rewards to the same bounded base;
2. Validate reported tokens against measurable inputs (tokens ≤ f(request input size + max_tokens), duration ≤ uploaded media duration measured locally as stem-separation already does);
3. At minimum, reject settlement when reported usage deviates from the registration probe baseline by more than a fixed multiplier, and suspend reward crediting for the deviation window.

---

## Addendum 1: BYOP developer-markup composition — the app commission turns the 75% drain into a 100% capture (and the victim pays 125%)

**Severity: raises this issue's ceiling — same root cause (self-reported usage), amplified through the Connect-User-Wallets (BYOP) developer-earnings path. 2026-10-25, code-verified + live mechanics verified.**

The platform's app commission ("Developer Earnings", `BRING_YOUR_OWN_POLLEN.md`) bills a user **25% over base rates** whenever a request is authenticated by an app-issued `sk_` key with a `byop_client_key_id`, and credits that markup to the app key's owner (`shared/billing/markup.ts:9` `MARKUP_PCT = 0.25`). This fee layer composes with the self-reported-usage drain above when the app developer is also a community publisher:

### Composition chain (all steps code-verified)

1. **Anyone can become an app developer with earnings enabled** — `POST /account/keys` with `{"type":"publishable","earningsEnabled":true,"redirectUris":[...]}`; no approval. Live-verified 2026-10-25 with the tester key: created `bounty-test-app` → `pk_NeJEQCdK2LlwcnT4` with `metadata.earningsEnabled: true`.
2. **App keys can bind a user's key to the developer's own community model** — `toModelPermissions` (`shared/registry/model-permissions.ts:77-122`) resolves `community/<owner>/<name>` IDs into key model permissions, so the OAuth `models=community/dev/model` restriction is accepted at consent.
3. **Attribution is mintable through the API** — `POST /account/keys` spreads the `consent` object into key metadata (`enter.pollinations.ai/src/routes/account.ts:1797-1801`), and `validateClientRedirectBinding` (`shared/auth/api-key-creation.ts:135-208`) turns `consent.requestedClientId` + a registered redirect URI into a `byop_client_key_id`. Live-verified: a secret key created this way carries `byopClientKeyId` in its response (`createdVia: "redirect-auth"`). A victim's key still requires their authorization — this step only shows the plumbing is fully programmatic.
4. **At settlement both credits fire on the same self-reported `totalPrice`** (`shared/billing/track-helpers.ts:244-369`):
   - payer is charged `billedPrice = totalPrice + devCredit` = **1.25 × totalPrice** (`computeBilledPrice`, line 405-411);
   - community owner is credited `0.75 × totalPrice` (`creditCommunityOwner`);
   - app developer is credited `0.25 × totalPrice` (`creditDev`);
   - with the same attacker behind the community model **and** the app key, the attacker captures **1.00 × totalPrice** while the victim pays **1.25 × totalPrice** — the platform's retained share is zero and the victim's overdraft is 25% deeper than the base attack.
5. **No rule separates the two roles for a third-party payer.** The only self-dealing guards are `byopClientAllowsMarkup`'s `client.userId !== payerUserId` (`shared/billing/markup.ts:44`) and the community self-call skip (`track-helpers.ts:226`). Both compare against the **payer**; nothing prevents one account from being simultaneously the community owner and the app developer. Verified against the unit suite (`gen.pollinations.ai/test/byop-markup.test.ts:193` "allows BYOP markup only for a live pk_ with earnings, not self-spend") — the guard tested is payer-side only.
6. **Budget caps do not bound the drain**: the user-authorized app budget is an estimate reserved preflight and reconciled post-hoc to the self-reported `billedPrice` (`reconcileApiKeyBalance`, `track-helpers.ts:484-521`), so a single inflated settlement drives the budget (and the user balance) negative — consistent with the base finding.

### Additional live verifications (2026-10-25, tester account)

- Child keys created by an attributed key do **not** inherit `byopClientKeyId` (child `byopClientKeyId: null`) — the composition needs the victim's own authorized key, which step 2-3 provide at consent time.
- Markup credit follows the payer's meter bucket (`byop-markup.test.ts:242-265`): victims spending **Quest Pollen** pay the developer's commission **in Quest Pollen** — a malicious dev converts victims' free-tier quest pollen into their own spendable balance at 25% on top of the 75% community reward.

### Fix (composition-specific, complements the usage bounds above)

- Cap or pro-rate the BYOP markup when the settlement's self-reported usage exceeds the preflight estimate by the same multiplier chosen for the usage bound (a forged-usage settlement should credit **neither** the community reward **nor** the markup).
- Consider disallowing `community/<owner>/...` model restrictions on keys whose `byop_client_key_id` resolves to the same owner as the restricted community model (the self-dealing shape: one attacker account on both sides of the transaction), or flag such keys for review at consent.
- Surface in the consent UI that the app will route the user's wallet to developer-owned community models with developer-set pricing.

---

## Addendum 2: weaponized single-worker PoC — the composition as one deployable file with a "ratio" dial (2026-10-25)

**This addendum documents the end-to-end PoC artifact (one Cloudflare Worker, ~870 lines, no build step) that turns Addendum 1's composition into a turnkey demo. It is published for maintainers' reproduction; every capability it exercises is a live behavior already established in this issue, issue 71, and Addendum 1.**

The worker hosts all five roles at one origin:

1. **the third-party app landing page** — "Continue with Pollinations" points at the legacy `/authorize` flow with `client_id=<attacker pk_>`, `redirect_uri=https://<worker>/harvest`, `scope=keys usage profile machines`, `budget=20+`, `expiry=<days>`, `models=community/<attacker>/<model>` (the `models=` restriction routes the victim's wallet onto the attacker's listing via `toModelPermissions`, Addendum 1 step 2);
2. **the issue-71 catcher** (`/harvest` + `POST /api/harvest`) — parses `#api_key=sk_…` from the fragment after the victim clicks Allow on the official consent screen, stores the key, sets a session cookie, and drops the victim into a working chat;
3. **the chat proxy** (`POST /v1/chat/completions`) — replays every victim message to `gen` with `Authorization: Bearer <victim sk_>` and `model=<attacker's community model>` (i.e. the victim's own key, BYOP-marked, spending on the attacker's listing);
4. **the "community model" itself** (`POST /model`, authenticated by the listing's registered bearer) — the endpoint gen proxies into: produces a real reply (anonymous-tier forward with canned fallback), then answers with `usage.completion_tokens = real_completion × RATIO` — the issue-58 forgery, with **RATIO as an admin-panel slider** (1.0 = honest tokens → the attacker earns exactly the markup + reward on real usage; unbounded above that);
5. **the admin panel** (`/admin`, basic-auth over Cloudflare env vars) — lists harvested `sk_…` keys in full (with a live `GET gen/account/key` verifier), runs full-chain test generations through any harvested key, shows gen's own `x-usage-*` billed headers in a live event feed, computes earnings totals, and carries the **kill-switch toggle**: OFF (the default) makes every victim-facing route render a plain "There is nothing to see here." page — only `/admin` stays reachable.

**Earnings math surfaced by the panel** (matching `markup.ts` / `track-helpers.ts` exactly): `victim_billed = (prompt + completion×ratio) × price/1M × 1.25`; `attacker_earns = base × 0.75 (community reward — public listing) + base × 0.25 (BYOP dev markup) = base × 1.00`. The consent `budget` parameter pre-fills the minted key's pollen budget (≥20 in the default config), so every fresh account's signup pollen is farmable per visitor, and per the base finding the settlement reconciliation drives key budget and account balance negative — the ratio has no ceiling anywhere in the settlement path.

**Worker verification** (offline harness, mocked upstream, no third-party impact; 22 assertions, all passing): kill-switch gating of every victim route; admin auth (missing/wrong/correct credentials); authorize-URL construction (exact `client_id`/`redirect_uri`/`scope`/`budget`/`expiry`/`models` params, no `response_type` — the legacy fragment branch); `sk_` capture + session issuance; chat proxy forwards with the victim key and the attacker model; `/model` bearer auth; ratio math at 1.0 (honest 40 tokens) and 4.0 (reported 160, prompt honest); totals `billed=1.25×base`, `earned=1.00×base`; verify/test/preflight/delete endpoints; kill switch back off. The live chain each step exercises was already live-verified piecewise: pk_ minting with `earningsEnabled`+`redirectUris` (Addendum 1), `byopClientKeyId` stamping at consent (Addendum 1), fragment delivery of the minted `sk_` to an unregistered worker (issue 71's live verification), and gen billing + crediting from self-reported usage (this issue's live evidence).

Artifacts: `download/pollinations-poc-worker/worker.js` (+ `wrangler.toml`, `DEPLOY.md` with the account setup checklist and a step-by-step recording script, `email-template.md` for the maintainer report). Fix-wise nothing new is required beyond Addendum 1's composition fixes and issue 71's redirect registration — the worker merely composes them; it is included so the severity of the composition is reproducible rather than rhetorical.
