# TODO — Pollinations Red-Team Engagement (30 waves)

**Target under review:** `https://github.com/pollinations/pollinations` @ `5c790c785c5063a4ec260e99b61e215bfebaa399`
(cloned read-only to `upstream/pollinations/`).

**Authorized scope:** the local checkout of upstream + loopback-only test servers started by the agent
(`.newera/cyber/scope.json`). No production probing of `pollinations.ai`, `media.pollinations.ai` or
`gen.pollinations.ai`. No PR is opened against the upstream repository.

**Prior art excluded:** issues `#40`–`#127` shipped in `pollinations-bugs-40-127.zip` (unpacked under
`prior-art/`, indexed in `evidence/prior-art-map.md`). Every new finding must be **unique** versus that set.

**Definition of done for a wave:** a candidate is only promoted to `issueNN.md` after a PoC that executes the
*real upstream code* (imported from `upstream/pollinations/`) passes locally and the failure mode is quoted in
the evidence file. Hypotheses that do not reproduce are recorded as negative results, not as findings.

| Wave | Focus area | Requirement | Status |
|---|---|---|---|
| W0 | Setup: clone upstream, scope file, prior-art dedupe map, PoC harness, skill corpora | R4 | DONE |
| W1 | `enter.pollinations.ai` auth: session, cookie, CORS, CSRF surface | R1 | IN PROGRESS |
| W2 | `enter.pollinations.ai` API-key lifecycle: create, permissions, budget, expiry, revoke | R1 | PENDING |
| W3 | OAuth authorize + device-code flow + token endpoint | R1 | PENDING |
| W4 | `shared/auth` helpers: redirect-uri, session token, agent-run token, ban, permissions | R1 | PENDING |
| W5 | `shared/billing`: deduction, bucket selection, markup, rewards, internal automation, precision | R1 | PENDING |
| W6 | `gen` realtime sessions | R1 | PENDING |
| W7 | `gen` E2B sandboxes + Azure sandboxes | R1 | PENDING |
| W8 | `gen` jobs + generation executor + generation handlers | R1 | PENDING |
| W9 | `gen` MCP + MCP card + well-known + docs/SEO routes | R1 | PENDING |
| W10 | `gen` middleware: auth/balance/permission guards, rate limiters, dedup | R1 | PENDING |
| W11 | `gen` content filter / safety / moderation | R1 | PENDING |
| W12 | Community endpoints + community model registry (auth, quotas, SSRF boundary) | R1 | PENDING |
| W13 | `media.pollinations.ai`: listing, tags, uploads, signed URLs | R1 | PENDING |
| W14 | `packages/auth` server (session cookies, HMAC, rotation) + `packages/sdk` | R1 | PENDING |
| W15 | `apps/polli` CLI + `packages/polli-cli` (key handling, injection, secrets) | R1 | PENDING |
| W16 | MCP servers: network, computer, ffmpeg, exa, machines, composio, news, research, ask-jev | R1 | PENDING |
| W17 | Bots & services: catgpt, discord bot family, mama-barbara, ai-dungeon-master | R1 | PENDING |
| W18 | `enter` routes: quests, community endpoints, payments/Stripe | R1 | PENDING |
| W19 | Operations dashboards / monitoring (unauth exposure, prod D1 reads) | R1 | PENDING |
| W20 | `pollinations.ai` website frontend + server endpoints (XSS, SSRF, leaks) | R1 | PENDING |
| W21 | Shared infra: client-IP trust, rate limit, cache, secret encryption, GitHub client, user-media-url | R1 | PENDING |
| W22 | `enter` Stripe billing utils + payment webhooks | R1 | PENDING |
| W23 | `gen` image/video/3D model adapters (billing vs render failure, fallback chains) | R1 | PENDING |
| W24 | `gen` embeddings + audio + transcription (input limits, URL fetch, partial billing) | R1 | PENDING |
| W25 | `gen` durable objects: GenerationCoordinator, CommunityModelRateLimiter | R1 | PENDING |
| W26 | Shared analytics/events/telemetry leakage + client-IP derived logic | R1 | PENDING |
| W27 | Apps: pi-workbench, reimagine, virtual-makeup, map-to-isometric, changelog-gen, packaging | R1 | PENDING |
| W28 | Cross-cutting: prompt injection / untrusted content framing in agent pipelines | R1 | PENDING |
| W29 | Cross-cutting: IDOR / missing ownership checks across D1 handlers | R1 | PENDING |
| W30 | Cross-cutting: rate limit / quota / amplification / resource exhaustion | R1 | PENDING |
| Final | ≥30 verified findings as `issue1.md`…`issueNN.md`, wave report, engagement report, green PoC suite | R2, R3, R5 | PENDING |

## Wave output contract

Each wave produces, in order:
1. `research/waveNN-*.md` — candidates with `file:line` citations, exploit path, dedupe check vs prior art.
2. `poc/` — an executable PoC that imports the real upstream module and asserts the defect.
3. `evidence/waveNN-*.txt` — captured PoC output (quoted verbatim in the issue).
4. `issueNN.md` — only for candidates whose PoC passes; includes severity, impact, exact reproduction, evidence
   table, code citations, and a concrete fix recommendation.

## Deliverables (R2 / R3 / R5)

- `issue1.md` … `issueNN.md` — one file per verified finding (≥30 total, 20+ waves represented).
- `TODO.md` — this file (remade with the 30 wave tasks).
- `WAVE-REPORT.md` — per-wave coverage and the negative results (dead ends).
- `ENGAGEMENT-REPORT.md` — scope, methodology, skills loaded, findings by severity, remediation, limitations.
- `poc/` + `evidence/` — executable proof and raw output for every claim.
