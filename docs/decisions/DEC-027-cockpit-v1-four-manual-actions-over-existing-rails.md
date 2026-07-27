---
id: DEC-027
title: "Cockpit v1 — four manual actions over existing rails; implicit automation-pause confirmed as emergent; warming = board-complement derive; \"fills by\" deferred to the fill-deadline decision"
topic: "Staffing engine — asks, escalation, At-Risk board & cockpit"
---

## DEC-027: Cockpit v1 — four manual actions over existing rails; implicit automation-pause confirmed as emergent; warming = board-complement derive; "fills by" deferred to the fill-deadline decision

**Decision:**

1. **The §2.4 cockpit ships four actions** — assign (`assignFromPool`, a new guarded wrapper:
   lean's accept set enforced per seat, so a crafted form post can't reach unlabeled override
   semantics), nudge (`lean`), confirm (`confirmSeat`), manual override (`manualOverride`, the
   **only** unguarded path — the label is the authority trail) — codes-in-params per DEC-026.
   Manual broadcast is deferred (the §2.4 broadcast AC is satisfied by the tick-fired path; a
   blanket re-broadcast to decliners is spam, not escalation); "widen" has no rail by DEC-024.

2. **The §2.4 open question on pausing automation is confirmed in build as *emergent*:**
   `escalate` fires only on a stalled shift with no live asks, and every manual assign/nudge
   *creates* a live ask; `broadcastAsk` fires only at the `Pending→Filling` birth inside `tick`
   (DEC-023). The autonomous tier is already incapable of fighting a manual placement — no pause
   flag, no resume action in v1. The explicit toggle is parked in FUTURE_IDEAS with the trigger
   "automation gains a lever that can act on a seat carrying a live manual ask."

3. **Warming (§2.4/#55) is a cross-shift pure derive whose membership is *candidate predicate
   minus `deriveAtRiskBoard` rows*** — board membership stays single-sourced (DEC-026), never
   re-approximated by state checks, so warming inherits the board's deliberate quiet zone
   (willingness-exhausted, trip far out) instead of double-reporting it. Negative-trend signals
   (conservative, anti-anxiety-dashboard): **ghosted** (≥1 silent ask) or **quiet** (asks out,
   none pending, still short). A **live ask is never a signal** — people mid-decision are the
   system working; the @architect draft's raw answered/asked rate was dropped because it reads 0%
   the instant a broadcast fires (instant-warm on every broadcast = the opposite of conservative).
   `responseRate` survives as a display fact over **settled** asks only. Opened deliberately
   (`?warming=1` link), never on the board, never pings.

4. **The cockpit header is honest about time:** the countdown is **"departs in"** (to
   `tripStart`) and the staffing horizon renders as a dated fact. The §2.4 "fills by" AC wording
   is deliberately under-shipped — the staffing horizon is when asks *start*, not a fill
   deadline, and a countdown to it reads "passed" for any shift being worked. The real
   fill-deadline concept is #59's decision (P3 board precedent: don't fake it in UI).

**Tradeoffs:** warming pays one board derive per open (BrewBoat-cheap; derived only when the
panel is opened; same revisit trigger as DEC-022/024/026). The assignment view now also feeds
pools to Asked seats (monitor transparency) and Bailed seats minus bailers (the P3 gap, closed),
and applies the intra-shift distinct-pool exclusion the actions enforce — one accept-set
definition across view, board, lean, and assign (the DEC-026 lesson).

**Phase:** Phase 4 / Unit B (#54/#55). (@architect pre-pass, 2026-06-11.)

**Amendment (Unit C, #56):** the cockpit's action inventory is **five** — "Reports a bail…" on a
Confirmed seat joins assign/nudge/confirm/override. Same `bail()` rail as the crew's own "can't
make it" (DEC-028); it is also the recovery path for a mis-tapped override (the v1 answer to the
@ui-reviewer's no-undo finding).
