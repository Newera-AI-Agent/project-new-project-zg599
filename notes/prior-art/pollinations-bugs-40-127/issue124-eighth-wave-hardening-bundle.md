# Eighth-wave hardening bundle: `computer-mcp` and `ffmpeg-mcp` run without `global_fetch_strictly_public` (private-IP connect from the edge — the flag every other URL-fetching MCP worker sets), composio-mcp has no fetch timeouts and accepts an unvalidated `callbackUrl`, the MCP SDK is pinned at 2.0.0 on the flagship public server while machines-mcp runs 2.3.1, the app-submission pre-review spends the shared key on unauthenticated issue edits with an SSRF-unchecked screenshot fetch, floret serves `/files/{name}` unauthenticated with no retention, and openclaw passes the user's key as a process argument

**Severity: low (five hardening gaps plus corroboration notes; each with a one-to-few-line fix, two of them flags-file one-liners).**

**Found: 2026-10-25. Code-verified.**

## 1. Missing `global_fetch_strictly_public` on the two URL-fetching workers

```
apps/mcp/wrangler.jsonc:5           ["nodejs_compat", "global_fetch_strictly_public"]   ✓
apps/machines-mcp/wrangler.jsonc:8  ["nodejs_compat", "global_fetch_strictly_public"]   ✓
apps/computer-mcp/wrangler.jsonc:11 ["nodejs_compat"]                                  ✗
apps/ffmpeg-mcp/wrangler.jsonc:8    ["nodejs_compat"]                                  ✗
```

The flag makes workerd refuse connections to private/loopback/link-local resolved addresses; it is the mitigation issue 97 explicitly relied on for the main server. The omissions:

- **computer-mcp**: the `Egress` binding (`src/index.ts:85-96`) applies only a User-Agent default before `fetch(outbound)` — no scheme/host/IP policy — so a sandboxed `curl http://127.0.0.1:<port>/` or `fetch("http://169.254.169.254/...")` reaches workerd's default fetch, which (absent the flag) connects to private addresses. The tool docs say "any **public** URL" — nothing enforces "public". (The git credential confinement to the one collective repo is correct — only the *connect* surface is open.)
- **ffmpeg-mcp**: `validateUserMediaUrl` (`shared/user-media-url.ts:5-26`) refuses only literal IPs/localhost/credentials — a **public hostname that DNS-rebinds to a private IP passes** and is connected to (HTTPS-only limits it to TLS-speaking targets).

Fix: add the flag to both wranglers (one line each); consider exa/composio for uniformity.

## 2. composio-mcp: no timeouts, unvalidated `callbackUrl`

- `worker.js:33-37` and `:281-294` — both upstream fetches have no `signal`; a hung Composio pins the gen proxy request, consumes an edge-rate-limit slot, and emits no receipt (the issue-90/98-secondary class on a server no filed issue covers).
- `worker.js:141-161` — `createConnectionLink(userId, toolkit, body.callbackUrl)` passes the raw body value into the Composio OAuth flow. Today the only reachable caller is enter's integrations route, which pins the value (`enter.../routes/integrations.ts:135-147`) — but the worker is the layer talking to Composio, and any future route inherits a user-controlled URL inside an OAuth flow. Fix: origin allowlist inside the worker; `AbortSignal.timeout` on both fetch sites.

## 3. MCP SDK pin skew

`apps/mcp` + `packages/mcp` lock `@modelcontextprotocol/server` **2.0.0**; `machines-mcp` locks **2.3.1**; the flagship public server (`mcp.pollinations.ai` + `mcp.myceli.ai`) runs the oldest pin. The transport SDK's internals (Origin/CSRF handling for stateless streamable-HTTP) live in that dependency — align pins and confirm the version enforces the MCP-spec guidance.

## 4. App-submission pre-review: unauthenticated trigger spends the shared key; screenshot fetch lacks the sibling's SSRF controls

`.github/workflows/apps-review-submissions.yml` runs on `issues: [opened, edited]` gated only on the attacker-controllable title prefix `[App Submission]` — every edit of every such issue re-runs a fresh runner that installs tooling, downloads the attacker-supplied screenshot URL, and makes an LLM call on `PLN_GITHUB_POLLY_KEY`. Bounded (GitHub-hosted runner, per-issue concurrency) but: unauthenticated cost amplification via repeated `edited` events. The screenshot fetch (`operations/app-management/ingestion/screenshot.js:7-15`) does `redirect: "follow"` with no scheme allow-list, no private-IP pinning, and a 5 MB size check *after* the full body is buffered — while the sibling reviewer (`review-agent.py:76-150`) implements `resolve_public_target` with curl `--resolve` IP pinning, redirect re-validation, and content-type/size caps. Port the sibling's controls to the validator path.

## 5. floret: unauthenticated `GET /files/{name}`, no retention

`apps/floret/gateway.js:85-106` gates only `POST /v1/chat/completions`; `apps/floret/src/floret/api.py:86-98` serves `/files/{name}` with no auth check and `:101-123` persists every TTS/data-URI artifact to container-local disk that is never reclaimed (UUID-name obscurity only). Any valid key can fill the disk. Gate `/files/*` behind the bearer check and add a TTL sweep.

## 6. openclaw setup script passes the key as an argument

`apps/openclaw/setup-pollinations.sh:14,36` — `bash -s -- KEY` → `npx ... auth login --with-token`: the argv-exposure class issue 102 filed for the CLI adapters, same fix (env/stdin).

## Corroboration notes (for existing-issue fix passes)

- **Issue 96/97/98/37 are all still open in current code** (re-verified this wave): exa `urls` still has no `.max()` and buffers whole `arrayBuffer()`; transcribeAudio still presence-only with unbounded `blob()`; ffmpeg `args` still flows raw into argv with `sources` `.min(1)` and no `.max()`; the mcp receipt parse still sits outside the billing try (`routes/mcp.ts:211`).
- **Receipt semantics asymmetries** (billing-accuracy, informational): composio bills on transport-2xx with caller-declared `tools.length` units (tool failures inside HTTP 200 are billed; Composio-side fan-out beyond the declared array is not); computer bills only on `response.ok` — a 60-second bash command that errors is free of the tool-call fee while the DO did the work.
- **Hardcoded `pk_` keys in six frontends** (`apps/catgpt/ai.js:12`, `apps/websim/src/config.ts:3`, `apps/openclaw/src/script.js:1`, sirius `:59`, ai-dungeon-master `:5`, plus two placeholders) — safe iff issue 59's server-side fix (reject account permissions on `pk_`) holds; operational check: verify none carry `accountPermissions` in D1.
- **ops note (issue 46 follow-up)**: `operations/community-monitor/CYCLE.md` documents the live EC2 box (EIP `3.221.108.127`) and a persistent phone-accessible `claude --remote-control --dangerously-skip-permissions` session — belongs in that issue's remediation pass.

## Negative results this wave (checked and held)

- The full GitHub Actions estate (44 workflows): **no fork-PR-triggered workflow holds repo secrets**; no `${{ github.event.* }}` interpolated into any `run:` script; `pull_request_target` workflows check out the base ref only; comment-triggered agents (`!polli`/`!askpolli`) authorize on immutable user IDs; app pre-review and publish paths revalidate edited bodies; `repo-organize-issues-prs.yml`'s LLM writes are enum-capped (classification steering only).
- `operations/model-evals`: pure string/regex grading (no eval/Function/child_process), sops-encrypted key, budget-capped, results to an isolated branch.
- Quest-dashboard assets XSS: pure `React.createElement`, no innerHTML anywhere.
- Leaderboard/community-monitor injection: blocked upstream by the model-name regex `^[A-Za-z0-9._:-]+$`.
- `agent-pr-review-fixer`: exemplary (caller's own fine-grained PAT, classic tokens stripped, no comments posted, deterministic edits).
- Router agents (frugal/polyrouter/triage/tiered-health), cerberus, jev-trimmer, nomic-player, sirius-elevator, micro-mission-broker: clean (no secrets, no MCP or validated-JSON-only, deterministic routing).
- `apps/chat` deep pass: no server code, markdown pipeline hardened (html:false, URL sanitizer, KaTeX trust:false), no new sink.
- Repo-wide secret scan: no plaintext `sk_`/`ghp_`/`github_pat_`/`ag_`/discord tokens outside tests; all committed secret files sops/age-encrypted.
- gen `/mcp/:serverId` proxy: closed server enum, caller headers stripped (no receipt forgery), cookie/authorization hygiene correct per server type.
