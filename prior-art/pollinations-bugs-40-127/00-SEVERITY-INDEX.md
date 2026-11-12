# Pollinations bug reports — issues #40 through #127 (severity index)

**88 issues total. Ranked from high to low severity.**
PoCs are NOT included in this archive — this is the ranked report set only.

## 🔴 CRITICAL / HIGH (29)

- **#40** — One-click account takeover via /authorize javascript: redirect XSS (patched upstream 5e07b12a — same chain still alive via #71)
- **#41** — Required-safety scan bypass — guardrail only sees trailing 50k chars (padding bypass)
- **#46** — Prompt injection into community-monitor agent holding 3 live tokens (POLLI/DISCORD/TB)
- **#48** — Media uploads unthrottled, unquota'd, unmoderated + public tag galleries, undeletable blobs
- **#53** — Device /approve + OAuth /code trust client-supplied apiKey verbatim (ATO chain amplifier)
- **#58** — Community usage forgery — caller wallet drain + 75% self-enrichment
- **#59** — Publishable pk_ keys can carry accountPermissions — browser-public key = full account takeover
- **#61** — One-click ATO via pre-checked 'keys' consent scope (device flow, zero attacker infra)
- **#62** — Compound chain — full account takeover where the single click can be 'Decline'
- **#67** — Community embeddings usage forgery (same class as #58, /v1/embeddings route)
- **#69** — Stored XSS / arbitrary HTML hosting on media.pollinations.ai (any pk_/sk_, immutable-cached)
- **#70** — Child-key privilege + budget escalation — keys-only grant mints full-scope children
- **#71** — Post-40 bypass: legacy /authorize fragment flow delivers fresh sk_ to arbitrary attacker URL
- **#72** — Stripe refunds/chargebacks never reverse credited Pollen (buy -> spend -> refund keeps both)
- **#73** — Text cache is identity-blind, pre-auth, unbilled — free paid-model output + cross-user poisoning
- **#76** — Demo apps deploy to shared pollinations.ai registrable domain — cookie authority + phishing
- **#77** — Keyless stored XSS on media.pollinations.ai via agent assets publish (0.0002 pollen total)
- **#78** — websim serves attacker-controlled HTML/script on websim.pollinations.ai (attacker-chosen paths)
- **#79** — Private community models publicly listed with full operational telemetry (392 hidden models)
- **#80** — websim 'Open' button executes generated HTML with full origin + reads victim's minted sk_
- **#81** — Agent run tokens (ag_) authenticate on account API with FULL parent-key permissions -> key mint = permanent ATO
- **#85** — Realtime sessions uncapped, settle only on close — negative balance funded by platform
- **#105** — polli API-mode GitHub-write restrictions enforced only in LLM tool schema, executor never checks
- **#106** — community_endpoint uncapped + 25 MiB catalog KV overflow -> self-sustaining /models outage
- **#119** — auto-fix Polli agent: write-capable GitHub Actions job, zero untrusted-content framing
- **#122** — mcpServers arms — any community prompt agent configurable with computer/composio
- **#125** — Private code agents = free unlimited stateful CPU farm + 64-subrequest anonymous relay (0 pollen, no throttle)
- **#126** — Auto-top-up: no per-day cap, no velocity control, no per-charge confirmation (real-money loop)
- **#127** — Moderation caller-opt-in only — every generation hosted permanently, public, undeletable, no takedown

## 🟡 MEDIUM (35)

- **#42** — Wallet admission is read-only SELECT — concurrent requests settle into negative balance
- **#44** — PollenRateLimiter check-then-consume race — per-(key,IP) spend throttle never throttles a burst
- **#47** — Media run tokens carry full DELETE authority over every item the user published
- **#50** — Editing an API key's budget clobbers in-flight reservations (absolute SET vs relative writes)
- **#52** — AssemblyAI 240s timeout abandons jobs unbilled/uncancelled + no file-size cap
- **#54** — Discounted Stripe checkouts credit full pack — guard checks pre-discount subtotal
- **#55** — SDK puts the secret sk_ in request URLs for image/video/audio GETs
- **#56** — floret SSRF — user-influenced fetches with no host validation
- **#57** — catgpt-bot logs a spendable sk_ into world-readable files
- **#60** — Unauthenticated unbounded device_code writes — D1 flood, rows never cleaned
- **#64** — Unauthenticated GET /register leaks internal GPU worker fleet (hostnames, heartbeats)
- **#74** — Official fallback chains skip the paid-only balance-class guard (latent critical)
- **#75** — Agent media writes unattributed, unquoted, unthrottled — flat 0.0002 pollen flat rate
- **#82** — App-approval bounty misrouting — free-text Quest field pays out any open POLLEN-QUEST
- **#86** — Embeddings multimodal ContentPart arrays uncapped — unbounded remote fetch fanout
- **#87** — Consent endpoints take session cookies with no Origin check (CSRF, chains 53/62)
- **#90** — Community text-proxy upstream fetches have no timeout (documented 300s unimplemented)
- **#91** — Video generations failing after provider render are unbilled on every route except one
- **#92** — Community endpoint URL trust model — string-only blocklist bypasses
- **#93** — Unauthenticated prompt injection into issue-triage bot — posts under verified bot identity
- **#95** — E2B sandbox login mints uncapped never-expiring key into the box where untrusted code runs
- **#96** — Exa MCP deterministic receipt loss — platform-funded spend, repeatable per request
- **#99** — Stable Audio 3 / 3D post-render provider-job abandonment (free renders for funded callers)
- **#101** — Account deletion leaves every R2 media blob public forever + permanently undeletable
- **#107** — One shared Cloudflare deploy token fronts every site/agent deploy (cross-user quota exhaustion)
- **#108** — quest-dash-live serves unauthenticated /data with production D1 reads (workers.dev host)
- **#109** — Anonymous unthrottled OpenAPI schema regeneration — CPU amplification across 3 workers
- **#110** — Tinybird read pipes unthrottled + uncached per user (50k-row exports, 90-day windows)
- **#112** — Pollen farming I — onboarding quest cluster self-seeding mint
- **#113** — Pollen farming II — reported_merged_issue self-fulfillment (3 tier per merged issue)
- **#115** — Official Discord bots = free unlimited unauthenticated generation faucet on one shared key
- **#116** — x402 prepaid keys have no working revocation — delete trips FK and returns 500
- **#120** — collective-memory is a public injection channel into bash agents in victim sandboxes
- **#121** — Social-posting pipeline turns merged-PR prose into unreviewed official brand-account posts
- **#123** — agent-pr-mender reviews attacker-authored PR content with zero framing

## 🟢 LOW (24)

- **#43** — /v1/messages drops query string — ?safe= privacy redaction silently ignored
- **#45** — E2B charge failure swallowed + capacity check race
- **#49** — Media upload originalName exceeds R2 2KB customMetadata limit -> 500
- **#51** — Stem separation bills client-forged MP3 Xing header
- **#63** — Unauthenticated analytics beacons accept unlimited forged events
- **#65** — Media upload: no rate limit, no quota, any valid key (storage cost DoS)
- **#66** — x402 payment signature = bearer credential; cross-pack replay 500 with raw error
- **#68** — NaN/Infinity usage headers — corrected to hardening after re-test (zod gates hold)
- **#83** — Auth-surface hardening bundle (device-flow write amplification, approve apiKey)
- **#84** — Discord quest relink cycling + per-account filter bypass
- **#88** — /api/account/quests unthrottled GitHub GraphQL fan-out (shared quota burn)
- **#89** — Credential-scope + comparison hardening bundle
- **#94** — Billing/quota enforcement bundle — guardrail calls unbilled amplification
- **#97** — transcribeAudio — unauthenticated arbitrary-URL fetch primitive
- **#98** — ffmpeg-mcp args bypass validated sources policy (file:// container read)
- **#100** — Fourth-wave hardening bundle
- **#102** — polli CLI key-management bundle (no-budget no-expiry harness keys)
- **#103** — Payment & deletion hardening bundle
- **#104** — Video billing audit verdict (negative result) + live cache-replay proof for #73
- **#111** — Zero-balance E2B sandbox create-churn (shared-provider quota burn)
- **#114** — Pollen farming III — topup composition / colluder economics
- **#117** — Account deletion orphans code-agent Workers scripts (unbounded residue)
- **#118** — Seventh-wave hardening bundle
- **#124** — Eighth-wave hardening bundle

## Notes

- #40 is patched upstream (5e07b12a) — the same delivery chain remains live via #71.
- #68 was self-corrected to hardening after re-testing (honest downgrade).
- #104 is an audit verdict (negative result on free fresh video) + live cache-replay
  evidence that upgrades #73's media leg to live-proven.
- #125/#126/#127: finding summaries in this archive; their coordinated-window test
  notebooks are delivered separately to the team.
