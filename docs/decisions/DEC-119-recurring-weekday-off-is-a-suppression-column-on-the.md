---
id: DEC-119
title: "Recurring weekday-off is a suppression column on the crew record (#411)"
topic: "Availability & commitment rules"
---

## DEC-119: Recurring weekday-off is a suppression column on the crew record (#411)

**Status:** Decided 2026-07-14 (Eric + @architect).

**Decision.** A per-crew recurring weekday blackout ("never works Sundays") is stored as
`weekdaysOff: number[]` (Mon=0…Sun=6) — a bounded array **column** on the `CrewMember` record
(`weekdays_off jsonb`), mirroring the existing `ratings` array-column. **NOT** a separate table,
**NOT** modeled as recurring `PtoWindow`s.

- **Column, not table**, because it's a standing *attribute* of the crew member, not a 1:n
  collection with per-row identity (which is exactly why `PtoWindow` — individually removable dated
  spans — *is* a table). The column rides on the already-loaded `crew` object, so all three
  eligibility doors (auto-ask via `oracle`, self-claim via `claim`, browse via `claimable`) are
  covered by ONE new rule reading `ctx.crew.weekdaysOff` — zero new repo fetch, zero
  `CandidateContext` change. A table would triple the `ptoWindows` plumbing for no gain.
- **Eligibility:** one new hard rule `not_recurring_off`, a **sibling** to `not_on_pto` (its own
  `ruleId` + `{weekday}` detail — a categorically different reason, not folded into PTO), added to
  **both** `evaluateCandidate` and `evaluateTraineeCandidate` (trainees don't work their days off
  either). The weekday is pure string math on the already-vessel-local `shift.date` via
  `mondayZeroWeekday` (promoted to `config/tenant.ts`) — timezone-invariant by construction, no
  live tz read.
- **Operator-set** via `db:crew days-off <id> --days=… | --clear` (a targeted `updateCrewWeekdaysOff`
  UPDATE, DEC-094-safe). UI is a later slice (crew self-service #426; admin still under #411).

**Why this clears DEC-009.** DEC-009 forbids a *crew-maintained positive-availability calendar* (the
Xola trap — declaring when you're free, which rots). This is **subtractive** (DEC-009's own permitted
suppression shape), **operator-set**, and a **stable standing fact**, not a per-week calendar. It
extends PtoWindow's suppression onto a recurring axis; it is **not** a precedent for positive
availability.

**Does NOT:** add time-of-day granularity (#333 stays parked); add positive/recurring availability;
date-bound the recurrence (a weekday is simply off or not); or retroactively bail an
already-Confirmed seat on that weekday (candidate gate, not a sweep — same as adding a PtoWindow). Is
**bypassed by the operator override for free** (`overrideSeat` honors only the rating floor, DEC-064)
— consistent with PTO/double-booking. An **all-7-days-off** member is permitted (an emergent soft
bench, not archived), with a CLI warning. **Revisit if** genuine per-shift/intra-day availability is
ever required — that's a different model, not more flags on this one.
