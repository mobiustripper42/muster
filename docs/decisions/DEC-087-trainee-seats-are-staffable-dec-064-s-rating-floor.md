---
id: DEC-087
title: "Trainee seats are staffable — DEC-064's rating floor is scoped to required manning"
topic: "Staffing engine — asks, escalation, At-Risk board & cockpit"
---

## DEC-087: Trainee seats are staffable — DEC-064's rating floor is scoped to required manning

**Status:** Decided 2026-07-03 (@architect gate, Phase 9.3, #224).

**Decision.** `staffTraineeSeat` / `unstaffTraineeSeat` (`src/builder/manning.ts`, siblings of the
8.5 add/remove pair) place a named person into / out of a `kind:"supernumerary"` seat.

- **Staff** guards (seat is supernumerary + `Open`; candidate passes `evaluateTraineeCandidate`)
  then composes `manualOverride` — straight to `Confirmed`, `acquiredVia:"operator"`, no
  reliability event, no ask round-trip. Server-side re-check + picker scope, the DEC-064 posture.
- **Trainee eligibility = `evaluateCandidate` minus `hasRating`** (`evaluateTraineeCandidate`,
  `src/oracle/eligibility.ts`): isActive + mmcValidOnDate (DEC-044 sentinel keeps BrewBoat open) +
  notOnPto + notDoubleBooked over `committedDatesByCrew(repo)` with NO shift exclusion — so crew
  already committed anywhere that date, including this shift's own required seats, are excluded by
  the existing rule, no bespoke same-shift check. No rating requirement: trainees are unrated by
  definition.
- **DEC-064 scoping, not bypass:** the rating floor protects role-holding on REQUIRED manning (a
  license floor). A supernumerary seat holds no role in that sense — its `role` is the track being
  trained toward. DEC-064 is untouched for `kind:"required"`.
- **Unstaff is bespoke, never `vacateSeat`:** `vacateSeat` re-asks via the kind-blind
  `rankedEligible` and would fire real asks for a trainee seat. `unstaffTraineeSeat` is the
  vacate-exhausted branch only: clear occupant + provenance, rest `Open`, no penalty, no re-ask.
  After unstaff, 8.5's Remove reappears (seat is `Open` again).
- **Comms verified kind-blind, zero changes:** my-shifts (`crew-view.ts`), thread membership
  (`membership.ts` `assignedOn`), doorbell (`doorbell-tick` via `deriveMembers`) all derive from
  seat assignment without a kind filter. DEC-084 notices wired at the edge via the existing
  `notify()` ("added" on staff, "removed" on unstaff; operator excluded per DEC-072).
- **Edge:** picker excludes `OPERATOR_CREW_MEMBER_ID` (UI scope, not an engine rule). Occupied
  supernumerary line in `ManningSection` shows occupant + unstaff (it has no seat card); occupied
  required override lines keep the vacate-first text.

**Documented side effect:** `committedDatesByCrew` is kind-blind, so a staffed trainee is
double-booking-excluded from required-seat auto-asks and claims on that date. Correct (they're
aboard) — not a pool bug.

**Relationship:** builds on 8.5 seat add/remove (manning.ts), DEC-064/066 (rating gates),
DEC-084/072 (notices), DEC-044 (MMC sentinel), #196 (provenance badge).
**Revisit if:** trainees should remain askable/claimable for required seats on their trainee day
(drop the kind-blind committed-date, add a kind filter); or trainee hours want tracking (a log,
not seat state).
