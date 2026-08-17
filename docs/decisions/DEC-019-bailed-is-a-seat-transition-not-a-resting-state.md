---
id: DEC-019
title: "`Bailed` is a seat *transition*, not a resting state"
topic: "Seats, shifts & state machine"
---

## DEC-019: `Bailed` is a seat *transition*, not a resting state

**See also** — later decisions that changed part of this one:
- Amended by DEC-128

**Decision:** A confirmed crew backing out fires one atomic `bail()` operation: log `shift_bailed`
(with `latenessMs`), drop the occupant, and re-ask the next candidates (excluding the bailer) — the
`Confirmed → Bailed → Open` edge of SPEC §1.1 / §2.4 ("auto-reopens & re-asks") / §2.6 principle 2 (a
decline *immediately* re-asks). **If the re-ask finds candidates, the seat advances to `Asked`**
(Bailed cleared in the same operation — never a resting state on the happy path); **if the pool is
exhausted, the seat rests at `Bailed`**, which is the *only* way the loop yields `AtRisk`
(`deriveShiftState` derives `AtRisk` from a Bailed required seat). The durable "a bail happened"
record always lives in the reliability log, independent of the seat's resting state.
**Why:** The spec implies but never names the transient-vs-sticky fork, and `derive.ts` carries a ⚠️
comment pointing here. Making `Bailed` transient **on the happy path** means `deriveShiftState`'s
`AtRisk`-on-`Bailed` branch fires only when the re-ask finds an **exhausted pool** — which is the
legitimate Tier-3 / At-Risk condition (SPEC §1.2), not the horizon bug the comment feared. The
horizon-blind `Bailed → AtRisk` gap therefore does not bite the Tier-1 happy path; `Bailed → AtRisk`
becomes meaningful, not accidental.
**Tradeoff:** `bail()` does two things (drop + re-ask) in one call; a caller can't park a confirmed
seat at `Bailed` by hand. The resting `Bailed` is reserved for the exhausted-pool outcome. Accepted —
that's the spec's edge and the only AtRisk source the clockless loop can honestly produce.
**Scope note:** The Tier-1 ask loop is deliberately **horizon-agnostic** (it operates on demand, like
the oracle — DEC-004/013 clockless core). The *early*-bail (time to refill → `Filling`) vs *late*-bail
(no time → `AtRisk`) distinction needs the staffing-horizon clock and is left to the horizon task; a
clockless loop must not fake it. The `derive.ts` ⚠️ comment is re-homed from "1.4b" to "the
staffing-horizon task."
**Revisit if:** Pass D's `Held` tier or the staffing-horizon task changes how a vacated seat re-enters
the machine.
**Phase:** M3 (task 1.4b). @architect pass, 2026-06-05.
