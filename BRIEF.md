# RED-TEAM BRIEF — pollinations (authorized, local-only)

## Target
- Upstream read-only checkout: `upstream/pollinations/` @ 5c790c7 (git SUBMODULE — **never** rely on files you
  create inside it; they are not committed).
- Report repo root (WRITE HERE): `/home/runner/work/project-new-project-zg599/project-new-project-zg599`

## Authorization / safety
- Authorized by the repo owner for ethical research. **Local checkout + loopback only.** Never contact
  pollinations.ai / media.pollinations.ai / gen.pollinations.ai. No DoS, no large media, no billing abuse,
  no upstream PR. All PoCs must be minimal and non-destructive.

## PoC substrate (PROVEN WORKING)
`scripts/run-poc.sh <worker-dir> <poc-path-inside-report-repo>` stages your test file into
`upstream/pollinations/<worker-dir>/test/redteam/` and runs it with that worker's vitest config
(Cloudflare workers pool, **real D1 with real migrations**, real upstream handler code).
Example:
```
cd /home/runner/work/project-new-project-zg599/project-new-project-zg599
scripts/run-poc.sh enter.pollinations.ai poc/a/my-slug.test.ts
scripts/run-poc.sh gen.pollinations.ai  poc/a/my-slug.test.ts
scripts/run-poc.sh media.pollinations.ai poc/a/my-slug.test.ts
```
Worker dirs: `enter.pollinations.ai`, `gen.pollinations.ai`, `media.pollinations.ai` (all have `test/redteam/`
created on demand). Inside a worker test you can use `import { env, SELF } from "cloudflare:test"` and
`SELF.fetch("http://localhost:3000/...")` (enter), `http://localhost:8787` (gen/media — check each worker's
`wrangler.toml` / existing tests for the right port). D1 is reachable via `env.DB` (enter) or the worker binding
name you find in `wrangler.toml`. Copy the fixture style from
`upstream/pollinations/enter.pollinations.ai/test/integration/*.test.ts` and `test/fixtures.ts`.

## NO FALSE POSITIVES — hard rule
A candidate becomes a finding ONLY if the PoC **runs green against real upstream code and demonstrates the
defect** (e.g. request returns 200 where it should be 403, quota not enforced, secret leaked, cost not charged).
If the PoC does not demonstrate the flaw, record it as a NEGATIVE RESULT (research note) — do not write an issue.
Every issue file must quote VERBATIM PoC output that you actually observed in this VM.

## Dedupe (mandatory)
Prior art = issues **#40–#127**, unpacked at `prior-art/pollinations-bugs-40-127/` (index:
`evidence/prior-art-map.md`, severity index: `prior-art/pollinations-bugs-40-127/00-SEVERITY-INDEX.md`).
Read the severity index FIRST. Your finding must be **materially different** from every prior-art entry.
State a dedupe note (which prior issues you checked, why yours differs). Do not re-report: media stored XSS,
unbounded media uploads, community usage forgery, consent CSRF, authorize XSS/fragment key leak, agent-run-token
full authority, publishable-key permissions, refund/chargeback pollen, text-cache pre-auth reuse, realtime
uncapped sessions, Stripe discount credit, device-code writes, SDK key-in-URL, floret SSRF, catgpt key logging,
private model telemetry, websim XSS, collective-memory injection, PR-prose posting, CPU-farm, auto-topup,
caller-opt-in moderation, x402 revocation, Tinybird/quest-dash/OpenAPI amplification, GitHub-write schema-only guard.

## Deliverables per finding (exact paths — you own these, never touch another agent's folder)
1. `poc/<area>/<slug>.test.ts` — executable PoC (imports real upstream code).
2. `evidence/<area>-<slug>.txt` — verbatim captured run output (script output piped to it).
3. `findings/<area>/<slug>.md` — the issue draft, template:
```
# <slug> — <one-line title>
- **Severity:** Critical|High|Medium
- **Component:** <upstream path>
- **CWE:** <id>
- **Wave:** <W#>
## Summary
## Attacker path (minimal, local)
## Reproduction
- PoC: `poc/<area>/<slug>.test.ts`
- Command: `scripts/run-poc.sh <worker> poc/<area>/<slug>.test.ts`
- Observed (verbatim):
  ```text
  <paste real output>
  ```
## Code citations
- `upstream/pollinations/<file>:<line>` — what it does
## Impact
## Remediation
## Dedupe note
```
4. Append a one-line entry to `research/<area>-log.md`: `<slug> | severity | status | dedupe target`.

## Budget discipline
Maximum 28 tool steps. Prefer 3-6 candidate hypotheses, then PoC the 2-3 strongest. If a PoC fails twice,
change hypothesis — never retry the same thing louder. Always write the finding file the moment a PoC passes.
