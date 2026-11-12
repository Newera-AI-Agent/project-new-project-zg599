# Issue 125 — Private code agents are a free, unlimited, stateful CPU farm + 64-subrequest anonymous relay

**Severity: critical (resource exhaustion / missing economic gate / missing throttle).**

## Summary

Any GitHub-linked account (no publisher allowlist needed — private visibility suffices) can
deploy arbitrary TypeScript into the platform's code-agent Workers namespace. Invocations are
stateful (isolate state and the invocation counter persist across calls), each execution may
issue up to 64 subrequests, and invocations are billed at **0 pollen with no per-account
throttle or concurrency cap — no 429 is ever returned**. Sustained invocation therefore burns
Workers CPU on the production code-agent namespace at zero cost to the caller, for as long as
the attacker chooses. The 64-subrequest budget additionally turns every invocation into an
anonymous outbound relay from platform egress.

## Fix direction

Per-account RPM / concurrency caps on code-agent invocations; a minimum billing floor or
positive-balance gate for sustained invocation; reduced subrequest budget for private
(non-allowlisted) agents.

## PoC

Coordinated-window Colab notebook with hard time-gate interlock — delivered separately to the
team; intentionally not included in this archive.
