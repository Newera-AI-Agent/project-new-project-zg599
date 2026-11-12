# Realtime sessions: no per-user session or RPM cap, admission is a one-shot median estimate, settlement fires only on socket close, has no balance floor, and is dropped after one retry — plus the upstream Azure connect has no timeout

**Severity: high (platform-funded provider spend; free-tier-reachable; verified live).**

**Found: 2026-10-25. Code-verified and live-verified (4 concurrent sessions on one key from a quest-funded account; zero-audio sessions used to keep the verification cost at zero).**

## Summary

Every other generation surface on `gen.pollinations.ai` bounds what a caller can take before the platform pays for it — `perUserRpm` in the model registries, sandbox capacity for e2b, per-key budget reservations, settlement tied to the response. **The realtime WebSocket surface (`/realtime`, `/v1/realtime`) has none of these.** A quest-funded account (paid balance 0, tier balance >0) can hold an arbitrary number of concurrent `gpt-realtime-2.1` / `-mini` / `gpt-live-transcribe` / `mai-transcribe-2-streaming` sessions for an arbitrary duration; the wallet is charged exactly once per session, **only when the socket closes**, with **no floor at zero** — and if that one settlement write fails twice, the session is **never charged at all**. All provider cost (Azure OpenAI realtime) in between is funded by the platform.

Live verification (2026-10-25, `openai/gpt-realtime-2.1-mini`, one `sk_` key, zero audio streamed so usage = 0 tokens and settlement = 0 pollen):

```
[sess#1] session.created :: concurrent-live=1
[sess#2] session.created :: concurrent-live=2
[sess#3] session.created :: concurrent-live=3
[sess#4] session.created :: concurrent-live=4
[peak] concurrent live sessions from ONE key: 4
```

Four sessions reached `session.created` concurrently and coexisted indefinitely — the run was only stopped by the test closing them. Nothing in the platform refused the 5th, 10th, or 50th; the only observed throttling is Azure's own **new-connection** rate (an 8-connection burst left 7 sockets hanging in CONNECTING — see companion note 3).

## The five gaps (all verified in code)

1. **Admission is a one-shot, median-priced, read-only gate.** `authorizeRealtimeSession` (`gen.pollinations.ai/src/routes/realtime.ts:1502-1507`) calls `requireGenerationAccess` once at connect. For realtime models `getDefinedRequestEstimate` returns `null` (token/second-priced — `src/utils/model-stats.ts:12-28`), so the gate compares the wallet against the **Tinybird median historical session cost** (`getEstimatedPrice`, model-stats.ts:39-60). Any wallet above the median — including a fresh quest-granted one — is admitted; the eventual cost is unbounded by that number.
2. **No session or RPM limits of any kind.** `enforceModelRateLimit` (realtime.ts:1516) is a no-op for every realtime model because **no entry in `shared/registry/realtime.ts` defines `perUserRpm`** (text/image/audio models do — e.g. `image.ts:286 perUserRpm: 12`), and there is no concurrent-session counter, no capacity DO, and no equivalent of e2b's `requireCapacity` anywhere in the file. `frontendKeyRateLimit` only applies to `pk_` keys (`src/middleware/rate-limit-durable.ts:32-35`). `gpt-realtime-2.1`, `-mini`, `gpt-live-transcribe` and `mai-transcribe-2-streaming` are all `paidOnly: false` (realtime.ts:38, 61, 69, 123) — quest pollen is enough.
3. **Nothing bounds spend or duration during a session.** No session-length cap, no spend ceiling, no mid-session balance re-check exists anywhere in the file. Settlement fires only from the `close`/`error` events — `wireClose` → `scheduleRealtimeSettlement` (realtime.ts:986-1012; scribe path same at :1438-1447). The route's own docs describe the model: *"settles one session total when the socket closes"* (`routes/proxy.ts:175`).
4. **Settlement has no floor and can drive wallets arbitrarily negative.** `atomicDeductUserBalance` (`shared/billing/deduction.ts:57-96`) picks the bucket with `WHEN COALESCE(tier_balance,0) >= amount THEN 'tier' WHEN COALESCE(pack_balance,0) > 0 THEN 'pack' ELSE 'tier'` — the `ELSE 'tier'` fallthrough subtracts the full session cost with no floor, and `track-helpers.ts:293-306` even logs "negative after deduction" as an expected outcome. At `gpt-realtime-2.1` rates (`shared/registry/realtime.ts:25-28`: completion audio `$0.000064/token` ≈ $64/1M tokens) a single hour of full-duplex audio is dollars; N parallel sessions for hours multiply it, all against a wallet that only needed the median to connect.
5. **A failed settlement is silently dropped.** `scheduleRealtimeSettlement` (realtime.ts:945-984) retries exactly once, then logs and abandons: a session whose D1 deduction fails twice is **never charged and produces no ledger row** — unlike the negative-balance path, this one produces no trace at all.

## Attacker scenario (the free-tier version)

1. Create a throwaway Pollinations account; claim enough quest pollen to clear the median (today's median is small — a single `join_discord`-style reward suffices on most days).
2. Open as many `wss://gen.pollinations.ai/v1/realtime?model=openai/gpt-realtime-2.1&key=sk_…` connections as Azure will establish (live-verified: ≥4 concurrent per key; see note 3 for the connection-rate behavior), staggering new connections by a second or two.
3. Stream full-duplex audio for hours per session. Nothing re-checks the wallet; nothing kills the session.
4. On close, each session settles its full cost against a wallet that goes deeply negative — the platform has already paid Azure. Repeat per throwaway account. (Steps 2-4 were NOT executed in this verification — the live proof used zero-audio sessions so the settlement was exactly 0.)

## Impact

- Direct, repeatable platform-funded provider spend with a free account; the negative wallet never blocks the *next* session because admission compares against the median, not the debt (and `requireFunds` on the next connect only needs `balance >= median`).
- Resource exhaustion: each session pins one Worker invocation + one Azure realtime socket indefinitely.
- Revenue integrity: settlement-drop (gap 5) means transient D1 errors convert billed usage into unbilled usage with no compensating record.

## Fix (minimal)

1. Add `perUserRpm`/`maxConcurrentSessions` for realtime models (e.g. 1-2 concurrent sessions per user) — the registry field and `enforceModelRateLimit` already exist and are used by every other surface.
2. Enforce a session-duration and spend ceiling: a timer that settles-and-closes at a cap (e.g. 10 minutes / N pollen), plus incremental settlement per `response.done` instead of one terminal write.
3. Make settlement non-droppable: on retry failure, write the ledger row first (or enqueue to a durable queue) and reconcile the deduction separately.
4. Give `connectAzureRealtime`'s `fetch` an `AbortSignal.timeout` (see note 3).

## Companion notes (same file, same audit)

1. **Scribe sessions have an unbounded `queue`** (realtime.ts:1184, :1364) that grows while the upstream connects — an auth-required memory DoS on the same surface.
2. `requireGenerationAccess`'s median gate uses the model's *historical median*, so an attacker who shifts their own historical costs down (short zero-usage sessions, which settle 0) can also drag the gate down for everyone on that model — the estimate is computed from Tinybird over all sessions.
3. **`connectAzureRealtime` has no timeout** (`realtime.ts:156-194`: plain `await fetch(...)`). When Azure throttles new connections, the client socket hangs in CONNECTING **indefinitely** — live-observed: 8 connections staggered 150ms apart left 7 hanging for the full test window; each hung request holds a Worker invocation (and any state already reserved) with no deadline. An `AbortSignal.timeout(10_000)` would cap this.
