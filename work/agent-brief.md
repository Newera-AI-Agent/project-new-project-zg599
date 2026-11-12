# SHARED RED-TEAM BRIEF FOR SUB-AGENTS (read fully before acting)

## Mission
Find **new, real, attacker-triggerable vulnerabilities** in the pollinations monorepo and PROVE each one
with an executable PoC that imports the **real upstream code**. The upstream checkout is READ-ONLY: never edit
anything under `upstream/`. Write only inside your assigned `poc/<area>/` directory and `evidence/` files.

## Paths (repo root = /home/runner/work/project-new-project-zg599/project-new-project-zg599)
- Upstream code (read-only): `upstream/pollinations/` @ 5c790c785c5063a4ec260e99b61e215bfebaa399
- Your PoC dir: `poc/<area>/` (ONLY this one)
- Evidence dir: `evidence/<area>-<slug>.txt`
- Prior art (#40–#127, DO NOT re-report): `prior-art/pollinations-bugs-40-127/` — read
  `prior-art/pollinations-bugs-40-127/00-SEVERITY-INDEX.md` first, then open the individual files of any
  issue that looks similar to your candidate.
- Methodology + rules: `BRIEF.md` (repo root). Read it.

## Harness (already installed and proven — do not reinvent)
### A. Pure-module PoCs (fast, node env, seconds)
```
cd /home/runner/work/project-new-project-zg599/project-new-project-zg599
scripts/verify.sh poc/<area>/<slug>.test.ts evidence/<area>-<slug>.txt
```
The root `vitest.config.ts` aliases: `@shared/*` -> `upstream/pollinations/shared/*`, `@/*` ->
`upstream/pollinations/gen.pollinations.ai/src/*`, `@enter/*` -> `upstream/pollinations/enter.pollinations.ai/src/*`,
`@frontend/*` -> `upstream/pollinations/enter.pollinations.ai/frontend/src/*`.
Use this for validators, auth helpers, billing math, URL filters, schema parsing, middleware functions.

### B. Route/DB PoCs (Cloudflare workers pool, real D1 + real migrations) — needed when the claim involves
   HTTP routing, session cookies, D1 rows, rate limits, or billing writes
```
cd /home/runner/work/project-new-project-zg599/project-new-project-zg599
scripts/run-poc.sh enter.pollinations.ai poc/<area>/<slug>.test.ts   # or gen.pollinations.ai / media.pollinations.ai
```
That script stages the file into `upstream/pollinations/<worker>/test/redteam/` and runs the worker's vitest
(workers pool). It writes output to `evidence/last-run.txt`; capture your own copy:
```
scripts/run-poc.sh enter.pollinations.ai poc/<area>/<slug>.test.ts 2>&1 | tee evidence/<area>-<slug>.txt
```
Inside a worker test: `import { env, SELF } from "cloudflare:test"`, `SELF.fetch("http://localhost:3000/...")`
for enter (check the port in that worker's `wrangler.toml` / existing `test/integration/*.test.ts`),
D1 via the binding name in `wrangler.toml` (`env.DB` for enter). Copy fixture style from
`upstream/pollinations/enter.pollinations.ai/test/integration/` and `test/fixtures.ts`.
NOTE: worker-pool runs can take 1-3 minutes each. Budget them; prefer batch several assertions into one test file.

## What counts as a REAL finding (hard rules — false positives are worse than fewer findings)
1. The PoC must EXECUTE REAL UPSTREAM CODE and demonstrate the DEFECT (e.g. request returns 200 where the
   design requires 403; a secret is returned; a quota is not enforced; cost is not charged; an IDOR returns
   another user's record). Asserting the *vulnerable* behaviour is the proof (e.g. `expect(result.ok).toBe(true)`
   when the filter must refuse, `expect(res.status).toBe(200)` when it must be 401).
2. If the code is actually safe -> that is a NEGATIVE RESULT. Record it, do not report it.
3. Every PoC must also include **negative controls** showing the safe path still behaves correctly, so the
   finding is not a misreading of the API.
4. NO production traffic. Never contact pollinations.ai / media.pollinations.ai / gen.pollinations.ai.
   Loopback + local files only. No DoS, no large media, no billing abuse, no upstream PR, no git push.
5. Do not report anything already in the prior-art index (read it). In your report include a DEDUPE NOTE naming
   the prior issues you checked and why yours is materially different (different root cause, different component,
   different impact, or a strictly stronger exploit).
6. Severity: Critical = direct account takeover / platform-wide financial loss / RCE / auth bypass on the platform
   origin. High = unauthenticated data exposure, financial abuse with real cost, privilege escalation, stored XSS on
   a platform origin, cross-tenant data access. Medium = DoS amplification, info leak, weak enforcement.
7. Cite exact `file:line` in `upstream/pollinations/...` for the vulnerable code (verify the line numbers by
   reading the file).

## Deliverables YOU must produce (do not write issue*.md — the lead writes those)
For each accepted candidate:
- `poc/<area>/<slug>.test.ts` (runnable, self-contained, deterministic)
- `evidence/<area>-<slug>.txt` (VERBATIM run output, captured by the command you ran)
- a research note `research/<area>-wave.md` describing: code path read, hypothesis, exploit path, dedupe check,
  negative results, and what still needs fixing.

## Final message format (the lead will use it to write the issue files — be precise and complete)
For each candidate, exactly:
```
### <slug>
- severity: Critical|High|Medium
- cwe: CWE-xxx
- component: upstream path (file:line citations, 2-4 of them)
- summary: 2-4 sentences (root cause + what the attacker gets)
- attacker_path: minimal concrete steps (what the attacker sends / what they obtain)
- poc: poc/<area>/<slug>.test.ts
- evidence: evidence/<area>-<slug>.txt
- command: <exact command you ran>
- observed: <paste the decisive 3-12 lines of verbatim output>
- impact: <why it matters for the platform>
- remediation: <concrete fix, with the file to change>
- dedupe: <prior issues checked + why different>
```
Then a final section `### NEGATIVE RESULTS` listing hypotheses that did not reproduce (so they are not retested).
Target 3-6 candidates per area; PoC the strongest 2-3 properly rather than 6 sloppy ones.
