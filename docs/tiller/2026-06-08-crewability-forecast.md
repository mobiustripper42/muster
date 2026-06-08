# Tiller pitch — Crewability forecast: point the oracle at the weekend before you ask anyone

*Draft proposal. Not for merge — the file is the artifact, the PR body is the pitch. Eric is the gate.*

## The pitch

### The idea
Muster's oracle already answers, for **one shift right now**, "is there an assignment of real people to every required seat such that each is eligible and not double-booked?" (`solveShift`, DEC-003). Point that exact question at the **future and the whole fleet**: given the roster, known PTO, and the proposed (not-yet-asked) shifts for a date range, compute — **before a single ask goes out** — which days are *structurally* crewable and which are not, and by how much. A new pure core function `forecastCrewability(repo, fromDate, toDate, now)` returns, per day, "8 required seats open, 8 fillable → green" or "6 fillable, **2 captain seats unfillable by anyone** → you are two captains short Saturday, and no ask sequence fixes that." It is the At-Risk board's information, computed from pool *structure* weeks early, instead of from *exhausted asks* at the eleventh hour.

### Why it's worth it
Muster's one-sentence reason to exist is "Xola knows a booking is paid; Muster knows whether anyone will be standing on the dock." The At-Risk board (Phase 3) delivers that knowledge **too late by construction** — it only fires *inside the staffing horizon*, *after* Tiers 1–2 exhaust, and the spec deliberately keeps its bar high and bans "warming" so it never becomes an anxiety dashboard. That's correct for triage. But a *structural* shortage — 4 boats running Saturday, 2 crew each, only 6 eligible bodies left after PTO — is knowable the **moment the bookings and PTO are**, which can be weeks out. That's the difference between "I can hire a captain / move someone's PTO / decline the marginal rental on Monday" and "I'm cancelling a paid trip at 11pm." For a semi-retired operator whose entire design goal is *no babysitting*, a deliberately-pulled "is this weekend even possible?" answer is the highest-leverage thing the engine can say. Now, because the vertical slice is done and the oracle + shared-pool solve already exist — this is a new *consumer* of proven machinery, not a new engine.

### Why he hasn't already
The oracle has only ever been called **reactively and one-shift-at-a-time** — `solveShift(repo, shiftId, now)`, `eligiblePool(repo, shiftId)`, the ask loop on the seats it's handed. The whole core is proudly clockless ("works the seats it is handed, when called"). Forecasting is a *different call shape* — fleet-wide, forward-ranging, aggregated — and forward-looking has *felt* blocked on the staffing-horizon clock that's flagged as "not yet placed in a phase." The unlock is noticing that **feasibility doesn't need the clock**: "could this *ever* be crewed?" is exactly the cheap out-of-horizon check SPEC §1.3 already carves out ("outside it the crew group abstains and at most does a cheap 'could this ever plausibly be crewed' sanity check") — specced, never built. The forecast is that sanity check, taken seriously and lifted from one shift to a whole day's shifts sharing one crew pool. The double-booking constraint `solveShift` handles *within* a shift is the same constraint that makes a *weekend* infeasible (one captain can't run two boats Saturday) — the oracle already models it; nobody has pointed it across shifts.

---

## The build handoff

### Approach
- **A new pure core consumer, not a new engine.** Lives in `src/oracle/`, framework-free, `now` and the date range injected, repo reads only. No UI, no stack work — the surface (an admin "weekend readiness" view) comes later; this PR is the engine that feeds it.
- **Feasibility is a per-day maximum bipartite matching.** Muster's double-booking rule is **day-grained** (`notDoubleBooked` in `eligibility.ts`: a crew member committed to any shift that date is out; v1 has no cross-day rest rule — duty-hour is a parked soft "M" rule). So weekend feasibility decomposes cleanly into **independent per-day matchings**: for each date, one side is every *required, still-open* seat across all that day's shifts; the other side is the crew; an edge is eligibility for that seat. Max matching = how many seats can be simultaneously filled by *distinct* people. `matchedCount < openRequiredCount` ⇒ that day is short, and the deficit (by role) is the binding constraint.
- **Reuse eligibility wholesale — do not reimplement rules.** Build each day's graph from `eligiblePool(repo, shiftId)` per shift (it already returns each required seat's eligible crew set, applying role + MMC-on-date + PTO + active). The forecast's *only* new logic is the cross-shift matching over those sets.
- **Greedy is genuinely insufficient here — this is why the matching is load-bearing, not gold-plating.** `solveShift` notes greedy "can still miss an assignment a full matching would find … acceptable while the pool is tiny." At fleet scale that gap *changes the answer*: greedy hands your one ace captain to boat 1 and then reports boat 2 uncrewable, when spreading crew would crew both. A forecast that cried wolf would be worse than none. So the forecast needs a real maximum matching (Kuhn's augmenting-path / Hopcroft–Karp; tiny inputs, exact is cheap).
- **Account for work already done.** A seat already `Confirmed`/`Claimed` consumes its occupant for that day: drop that crew from the day's available pool and that seat from the open-seat count. So the forecast stays truthful mid-fill, not just on a blank weekend.

### File-by-file
- **`src/oracle/matching.ts` (new).** A generic, pure `maxBipartiteMatching(leftIds, rightIds, edges): Map<left,right>` (Kuhn's algorithm). No domain types — just ids + an adjacency predicate/set. Unit-tested in isolation. This is the shared primitive.
- **`src/oracle/forecast.ts` (new).** `forecastCrewability(repo, fromDate, toDate, now)`:
  1. `repo.listShifts()` → filter to `shift.date` in `[fromDate, toDate]`; group by date.
  2. Per date: gather that date's shifts' **required** seats (`listSeatsForShift`, `kind === "required"`); split into *already-filled* (Confirmed/Claimed → fixes an occupant) and *open*.
  3. Build the bipartite graph: left = open required seats; right = crew **minus** anyone already filling a seat that date (the day's double-booking constraint); edges from `eligiblePool` per shift (seat → its eligible set), with already-committed crew removed.
  4. `maxBipartiteMatching` → `fillable = matched.size`; `infeasibleSeats = open.length - fillable`; bucket the unmatched seats `byRole` for the "short N captains / M mates" line.
  5. Return `DayForecast[] { date, openRequired, fillable, infeasibleSeats, shortByRole: Record<RoleTypeId, number>, feasible }`.
- **`src/oracle/forecast.test.ts` (new).** See "Done when."
- **`src/oracle/oracle.ts` (optional follow-up, NOT this PR).** `solveShift`'s greedy could later delegate to `matching.ts` for a correct single-shift solve too — note it as a follow-up so the primitive has one home; keep this PR contained to avoid touching the live ask path.
- **`src/oracle/index.ts`.** Barrel-export `forecastCrewability` + its types.
- **`docs/DECISIONS.md`.** One DEC: "forecast = data-independent, clock-free feasibility, distinct from the At-Risk board (post-exhaustion triage) and from the staffing-horizon clock; greedy insufficient cross-shift → exact matching." Note the SPEC §1.3 "cheap sanity check" lineage so it reads as realizing existing scope, not new scope (respects the lock rule — this is a *consumer*, not a spec feature).

### Gotchas / risks
- **Per-day, not per-weekend, matching.** A crew member working Saturday *and* Sunday is fine — don't make crew single-use across the range, only within a date. Decompose by date first.
- **Feasibility ≠ schedule.** The forecast answers "can it be filled," not "who to ask" — it must **not** touch seats, fire asks, or write state. Pure read + compute. It also must not consult the reliability *score* (that's ask-*order*, irrelevant to *whether* a body exists) — keep it data-independent so it works before any history exists.
- **Already-filled seats cut both ways.** Forgetting to remove a Confirmed occupant from the day's pool will let one person "fill" two seats and report false-feasible. Test this explicitly.
- **Supernumerary seats don't gate** — `eligiblePool` already returns only required seats; mirror that filter when counting open seats.
- **Don't rebuild the At-Risk board.** This is a *deliberately-pulled* feasibility check (sibling to the assignment view's allowed "warming" posture), not a push surface and not a glowing dashboard. Output is structural facts, not urgency theater.
- **Date semantics.** Reuse the project's `iso-date` helpers; `notDoubleBooked`/`notOnPto` compare ISO date strings — keep the range filter string-comparable and inclusive, matching existing conventions.

### Done when
- `forecastCrewability` is pure (same repo state + range ⇒ same result), reads only, and lives in the framework-free core.
- Tests in `src/oracle/forecast.test.ts` (in-memory repo):
  - **Slack weekend:** enough eligible crew → every day `feasible`, `infeasibleSeats: 0`.
  - **The discriminating test (the whole point):** a day where **greedy-by-anything would report a shortage but a real matching crews everyone** (e.g. one captain-only crew, one dual-rated crew, two boats each needing a captain — greedy may burn the dual-rated on the wrong seat). Forecast must say `feasible`.
  - **Genuine structural shortage:** 4 boats Saturday (8 required seats), only 6 eligible bodies after a PTO window → `infeasibleSeats: 2`, `shortByRole` names the role.
  - **Cross-day non-conflict:** one crew the only body available both Sat and Sun → both days count them, not double-penalized.
  - **Already-filled reduces the pool:** a Confirmed seat removes its occupant from that day's matching; a confirmed crew can't also fill a second open seat that day.
- `npm run verify` green (`typecheck` + `typecheck:app` + `test` + `build`).

### Kickoff
> Read `docs/tiller/2026-06-08-crewability-forecast.md`, `src/oracle/oracle.ts`, `src/oracle/eligibility.ts`, and `src/ports/repository.ts`. Build the crewability forecast as specced there: a new pure `src/oracle/matching.ts` (generic max bipartite matching) and `src/oracle/forecast.ts` (`forecastCrewability(repo, fromDate, toDate, now)` → per-day feasibility via cross-shift matching, reusing `eligiblePool`). Core only — no UI, no ask-path changes. Write `forecast.test.ts` including the greedy-fails-but-matching-succeeds case. Plan it and poker it before cutting the branch, per the micro workflow.
