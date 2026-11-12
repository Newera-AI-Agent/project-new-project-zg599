# Issue 126 — Auto-top-up: no per-day cap, no velocity control, no per-charge confirmation

**Severity: critical (composition) — unbounded real-money loop against a saved card.**

## Summary

Auto-top-up is the only platform mechanism that moves **real money without a fresh
confirmation**. Its trigger is simply the pack balance dropping to/below a threshold
(default <= 5 pollen). Anything that can drain pack pollen — including the platform-funded
provider spend and billing/quota gaps documented across this report — therefore converts
directly into repeated real charges on the customer's saved card, with **no per-day cap, no
velocity control, and no re-confirmation**. A single observed cycle on my own account proves
the mechanism end-to-end: pack drained below the threshold -> the saved card is charged and
the pack refilled, with no confirmation step.

## Fix direction

Daily/weekly charge caps, velocity limits, re-confirmation after N automatic charges, and
drain-side anomaly guards (pause auto-top-up when the drain rate looks abnormal).

## PoC

Self-account-only notebook, money-gated (typed acknowledgment + minimum pack + manual
dashboard arming) — delivered separately; not included in this archive.
