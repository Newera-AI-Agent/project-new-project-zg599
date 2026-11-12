# Scope

| Item | Value |
|---|---|
| Target under review | `github.com/pollinations/pollinations` @ `5c790c785c5063a4ec260e99b61e215bfebaa399` (local read-only clone in `upstream/pollinations/`) |
| Authorized hosts | local checkout + loopback (`localhost:3000`, `localhost:7181`, `127.0.0.1:8787`) started by the PoC harness |
| Excluded | all production pollinations.ai endpoints, any third-party service, any upstream PR/issue creation |
| Authorization | owner-requested ethical red-team engagement (bug bounty style, report-only) |
| Safety rules | PoCs must be minimal; no DoS, no real provider charges, no data destruction, no live service abuse |

# Methodology

* Static review of the full upstream tree (apps, gen.pollinations.ai, enter.pollinations.ai, media.pollinations.ai, shared, packages, workflows).
* Prior-art dedupe against the owner-supplied archive `pollinations-bugs-40-127.zip` (issues #40-#127 unpacked under `prior-art/`, indexed in `evidence/prior-art-map.md`).
* Dynamic verification with the **real upstream code**: Cloudflare Workers `vitest` pool (workerd + miniflare + real D1 migrations) for the Workers apps, plain vitest/tsx for Node apps.
* Every finding ships with an executable PoC (tracked under `poc/`) and a raw evidence log (under `evidence/`).
* Cyber skill corpora consulted: PayloadAllTheThings (XSS/SSRF/IDOR/command-injection playbooks), SecLists (wordlists), REA (reverse engineering), nuclei templates (pattern selection).
