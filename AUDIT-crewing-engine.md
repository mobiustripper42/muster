# Audit — the crewing engine against `docs/SPEC.md` §1.1–1.4

Read-only audit of `main` at **`84bd0d1`** (merge of pull request #1214). No code was changed. This branch is never merged.

## 1. Summary

The audit checked **94 rules** from §1.1–§1.4 and the crewing rules of §2.3–§2.7, including the decisions those sections cite or are amended by.

| Result | Count |
|---|---|
| Rules that match | 65 |
| Rules that differ | 21 |
| Rules not built | 8 |
| Code behaviours that decide a state, eligibility, ask, order or timing with no spec | 20 |

There are **50 findings**:

| Severity | Count |
|---|---|
| S1 | 6 |
| S2 | 10 |
| S3 | 20 |
| S4 | 14 |

The short answers to the four questions are below. Each is answered in full in §3.

1. **Can someone not allowed to crew a seat end up `Confirmed` on it? Yes, by several paths.**
   - Tapping "in" re-checks only double-booking. Active status, rating, MMC, PTO and day off are trusted from when the ask went out.
   - A cancelled shift that comes back to life restores its old crew without re-checking any of them.
   - The override can put one person in two required seats of the same shift.
2. **Can one person be confirmed on two overlapping shifts? Yes.**
   - Two concurrent commits on two same-date shifts both win (#554, on both the ask and the claim door).
   - Reviving a cancelled shift can double-book its old crew.
   - The override can double-book within a shift and across shifts.
3. **Can a shift that needs crew stop being worked silently? Yes, in four unbounded ways and two that stall until the fill deadline.**
   - A seat left in `Claimed` is never asked, never on the board and never completes.
   - A multi-trip day stops being worked once its first trip departs.
   - A trip booked onto a `Completed` shift is never crewed.
   - A horizon configured later than the fill deadline leaves shifts unworked.
4. **When two people say "in" to one seat at once, does exactly one win? Yes.** The loser keeps their real `accepted` answer and its +2, as DEC-146 says. One forced interleaving overwrites the loser's answer with `withdrawn`.

### How the evidence was produced

- **Tests could not run with `npm test`.** There is no `node_modules` in this container: `npm test -- <file>` prints `sh: 1: vitest: not found`. Installs are the operator's step under `CLAUDE.md` § Workflow Notes, so I did not run `npm ci`.
- **I ran the probes under a stand-in for vitest instead.** It is a small vitest-compatible shim that runs the real `src/` modules through Node 22's type stripping, with the suite's own env from `vitest.config.ts` (`CIVIL_SEND_START=00:00`, `CIVIL_SEND_END=23:59`).
- **The shim is trustworthy enough to rely on:**
  - It ran three existing suites green: `src/builder/tick.test.ts` 45/45, `src/asks/ask-loop.test.ts` 58/58, `src/asks/claim.test.ts` 24/24.
  - It reports real failures: two probes failed until their clocks were moved inside the civil window.
- **91 probe tests in 9 files, all passing.** Each probe asserts the behaviour the code has today, so a pass means the finding reproduces.
- **"Tested (shim)" below means one of these probes reproduces the finding.** The probe sources and the shim are in Appendix A, so every result can be re-run after the probe files are deleted from the tree.
- **Postgres was not available.** Anything that depends on the Postgres adapter is marked "read, not run".

---

## 2. Findings, most severe first

### S1 — someone not allowed to crew a seat can end up `Confirmed` on it, or `Crewed` is shown while a seat is not legally filled

#### S1-1. Tapping "in" re-checks only double-booking; the other five eligibility rules are trusted from when the ask was sent

- **Spec.**
  - §1.1: "only people whose credentials are valid on the trip date and who hold the required rating ever get asked. By the time someone can tap "in," they are already a legal candidate".
  - §1.3, *Crew eligibility*, repeats it.
- **Code.**
  - `recordResponse` (`src/asks/ask-loop.ts:359-431`) checks only two things before the compare-and-swap at `:411-414`:
    - nobody already holds another seat on this shift (`:370-373`);
    - the person is not committed elsewhere that date (`:398-409`).
  - `is_active`, `has_rating`, `mmc_valid_on_date`, `not_on_pto` and `not_recurring_off` are never re-run.
  - The crew door `app/(crew)/crew/actions.ts:47-67` checks only that the ask belongs to the caller.
  - Nothing retires live asks when PTO is added (`src/crew/time-off.ts:35-53`) or when a crew member is archived or deactivated (`src/crew/crew-cli.ts:311,332` call only `setCrewStatus`).
- **What differs:** the spec's premise ("already a legal candidate") holds only at the instant the ask is sent.
- **Scenario.**
  - Brew 2, Wed 2026-07-01, captain seat. The tick asks Dana on 06-29.
  - On 06-30 Eric adds PTO for Dana on 07-01. Or Dana's MMC record is corrected to expire 06-30, or she is archived, deactivated, has Wednesdays marked off, or loses her captain rating.
  - Dana taps Yes. The seat goes `Confirmed`, the shift reads `Crewed`, and the board is empty.
  - The board does flag the lapsed-MMC case afterwards, as `credential_lapse`.
- **Severity:** S1.
- **Confidence:** tested (shim) — six cases in `accept-eligibility.tagB` › "the accept path re-checks only double-booking", plus two in `tick.tagC` (F7).

#### S1-2. A cancelled shift comes back to life with its old `Confirmed` crew and re-checks none of them; a merge after a collapsed split does the same

- **Spec.**
  - §1.1: "`Cancelled` — reachable from every pre-Completed state". The spec names no edge out of `Cancelled`.
  - §0.4: the eligible pool is "credentials valid on the trip date, correct rating, not double-booked, not on PTO".
  - §2.3 acceptance criteria: "merging is the inverse".
- **Code.**
  - Cancelling writes only the shift state and keeps its seats (`src/builder/form-shifts.ts:499-501`, DEC-084).
  - A cancelled shift is not counted as a commitment (`src/oracle/oracle.ts:72-84`), so its crew are free to take other work that date.
  - When a scheduled trip returns to that vessel-day, the same shift id re-forms from the kept seats:
    - `restoredCrew` is collected (`form-shifts.ts:545-554`);
    - the state is folded from those seats, so it reads `Crewed` (`form-shifts.ts:596-609`);
    - nothing calls `evaluateCandidate`.
  - Merge keeps side A's occupants even when side A is a cancelled husk, deletes side B's seats and frees its crew (`src/builder/merge.ts:65-84`). It then re-forms the day (`merge.ts:99-109`), which takes the revival path above.
- **What differs:** a state the spec says is terminal can be left, and leaving it seats people without the eligibility check.
- **Scenarios.**
  - **Revival.** Brew 2, Sat 07-18, a 10:00 trip crewed by Alice (captain) and Dan (mate).
    - The trip cancels; both are told they're off.
    - Alice accepts Brew 1's 16:00 that Saturday, which passes the double-book guard. Dan files PTO for 07-18.
    - A customer books Brew 2 at 15:00. Brew 2 comes back `Crewed` with Alice and Dan for a trip neither was asked about.
    - Alice is now on two boats that day, and Dan is on PTO.
  - **Merge.** Brew 3 is split at 13:00: Alice and Dan on side A's 10:00 charter, Bob and Erin on side B's 15:00 and 17:00 trips.
    - The charter cancels and Alice takes Brew 1. Eric merges.
    - Bob and Erin are texted "removed". Alice and Dan are confirmed on the 15:00 and 17:00 trips, and Alice is double-booked.
- **Severity:** S1.
- **Confidence:** tested (shim):
  - `form-shifts.tagE` › "a cancelled vessel-day re-booked later comes back Crewed with its OLD crew, double-booked and on PTO";
  - `form-shifts.tagE` › "merging a split whose side A collapsed…";
  - `resurrect-doublebook.tagB`.

#### S1-3. The manual override can put one person in two required seats of the same shift, and the shift then reads `Crewed`

- **Spec.**
  - §2.4 Actions: the override drops "anyone **rated for the role** into a seat directly, regardless of rank and seat state … Rank is bypassed; competency is not."
  - §1.3 and §2.4 *Eligible pool*: a person can't be two crew on one boat (the shared pool, DEC-003).
  - The spec does not address one person holding two seats.
- **Code.**
  - `overrideSeat` and `manualOverride` (`src/asks/ask-loop.ts:907-930`, `850-881`) check only the rating and not-archived. There is no `committedOnShift` check; that rule exists for the ask path at `ask-loop.ts:153-168`.
  - The cockpit picker filters only by archived status and rating (`components/assignment/shift-cockpit.tsx:132-135`, `:350`).
  - `deriveShiftState` (`src/builder/derive.ts:82-94`) never checks that the occupants are different people.
- **Scenario:** Eric overrides Rob, rated captain and mate, into Brew 2's captain seat. He then picks Rob again from the mate card. The cockpit shows 2/2, the shift reads `Crewed`, and there is one person aboard. Nothing boards it.
- **Severity:** S1.
- **Confidence:** tested (shim) — `accept-eligibility.tagB` › "captain overridden into BOTH the captain and the mate seat".

#### S1-4. Two concurrent commits by one person on two same-date shifts both win (issue #554, on both doors), and no integrity check catches the result

- **Spec.**
  - §2.7.2: "The one-shift-per-date guard is not concurrency-safe — #554".
  - §2.7 acceptance criteria: "A crew member cannot end up committed to two shifts on the same date. *(**NOT met** — #554…)*".
- **Code.**
  - The gap is documented on the ask door (`src/asks/ask-loop.ts:391-397`) and the claim door (`src/asks/claim.ts:120-128`).
  - The only race guard is a single-row compare-and-swap, `update seats … where id=$1 and state=$6` (`src/adapters/postgres-repository.ts:2131-2133`; read, not run).
  - There is no crew-and-date uniqueness on `seats` (`db/migrations/0001_init.sql:101-109`), and no transaction or lock around an accept.
  - The urgent blast drops the one-boat-per-day spread (`src/builder/tick.ts:469` passes only `suppression.working`), so two same-day asks to one person happen in normal operation.
  - `claim.ts:125-127` says the cross-record invariant is "the integrity tripwire's job". `src/admin/integrity.ts:121-131` checks only dangling references. Nothing detects a double confirmation, and the board can't, because both shifts read `Crewed`.
- **What differs:** the spec already admits the claim door. This adds the ask door, the self-claim-versus-ask pairing, and the absence of the tripwire the code relies on.
- **Scenario:** Fri 07-17 at 18:00, Brew 1 and Brew 3 for Sat 07-18 are both past their fill deadline. The blast asks Capt. Jo for both. Jo taps Yes on both within a second, and both are `Confirmed`.
- **Severity:** S1 (already known).
- **Confidence:** tested (shim) — `accept-eligibility.tagB` › "two 'in' taps on two same-date shifts at the same moment" and "a self-claim and an ask-accept … racing".

#### S1-5. Once confirmed, a person who goes on PTO, takes the day off, is archived or is deactivated stays `Confirmed`; the shift reads `Crewed` and nothing is shown

- **Spec — the spec chose this:**
  - DEC-119 (amends the §1.3 rule list): a day-off "does NOT … retroactively bail an already-Confirmed seat … (candidate gate, not a sweep — same as adding a PtoWindow)".
  - §2.1 edge case: "Deactivation while assigned to a future shift. Deactivating must surface the affected future assignments". Its acceptance criterion is struck as "CLOSED as a non-issue on operator input, 2026-07-27 … at one boat and ~six crew".
- **Code.**
  - `Crewed` is a pure fold over seat states (`src/builder/derive.ts:91`).
  - The board checks committed crew for MMC only (`src/admin/at-risk-board.ts:289-301`).
  - `addTimeOff` (`src/crew/time-off.ts:35-53`) and the status change (`src/crew/crew-cli.ts:311,332`) touch no seat.
- **What differs:** nothing, against the spec. Against the rubric it is S1: "a shift reads `Crewed` while a required seat is not legally filled". The 2026-07-27 ruling's premise ("one boat") predates the four-boat fleet that §0.4 describes (DEC-016).
- **Scenario:** Capt. Rob is confirmed on Brew 4, 08-08. On 08-01 Eric archives him ("off every list"). The seat stays `Confirmed`, Brew 4 reads `Crewed`, the board is empty, and nobody is asked.
- **Severity:** S1 by the rubric; the code matches the spec.
- **Confidence:** tested (shim) — `accept-eligibility.tagB` › "nothing vacates, withdraws or boards…" (PTO, archived, day off); `tick.tagA` › F10.

#### S1-6. The override seats someone whose MMC has lapsed, who is on PTO, who has the day off, or who is already confirmed elsewhere that day

- **Spec.**
  - §2.4 Override: "Rank is bypassed; competency is not", bounded by DEC-064 (rating) and DEC-096 (archived).
  - DEC-119: the override is "bypassed … for free … consistent with PTO/double-booking". So PTO, day off and double-booking are sanctioned.
  - **MMC is not covered.** DEC-064 justifies the rating floor as a legal floor "even the authority backstop shouldn't cross", and that reasoning fits a lapsed MMC equally.
- **Code.**
  - The only gates are the rating and archived checks (`src/asks/ask-loop.ts:917-921`).
  - The picker shows no credential state (`components/assignment/shift-cockpit.tsx:132-135`).
  - The override also ignores shift state, so it will place someone on a `Cancelled` or `Completed` shift.
- **Mitigations.**
  - A lapsed MMC does board, as `credential_lapse` (`src/admin/at-risk-board.ts:292-301`).
  - A double-booking across shifts does not board, because both shifts read `Crewed`.
- **Scenario:** Eric overrides Gus into Brew 1's captain seat for 07-01, not knowing Gus's MMC expired in January. Gus is `Confirmed`, and the board shows a credential-lapse row.
- **Severity:** S1 for the MMC case, which the spec does not address. S4 for PTO, day off and double-booking, which DEC-119 sanctions.
- **Confidence:** tested (shim) — `accept-eligibility.tagB` › "spec-silent: the override seats a lapsed-MMC / on-PTO person".

### S2 — a shift that needs crew silently stops being worked, or someone is asked who should not be

#### S2-1. A seat left in `Claimed` is never asked, never on the board, never `Crewed` and never `Completed`

- **Spec.**
  - §1.1 seat machine: "`Claimed → Open` (claim rescinded)".
  - DEC-061: a winning "in" advances "`Asked → Claimed → Confirmed` in one operation".
  - §2.5 route (b): "a required seat still empty … **whether or not asks are still in flight**".
- **Code.**
  - The claim and the confirm are two separate writes with no transaction (`src/ports/repository.ts:9`): the compare-and-swap to `Claimed` at `src/asks/ask-loop.ts:411-414`, then `withdrawLiveAsks` and `refreshShiftState` at `:420-421`, then the confirm at `:580-585`.
  - If anything throws in between, the seat stays `Claimed`, and a re-tap returns `already_answered` (`:350-352`).
  - Then nothing moves it:
    - the tick works only `Open` and `Asked` seats (`src/builder/tick.ts:448`);
    - the board does not count `Claimed` as a gap (`src/admin/at-risk-board.ts:266-270`);
    - the completion sweep needs `Confirmed` (`tick.ts:347-352`);
    - bail and vacate need `Confirmed` (`ask-loop.ts:648-659`, `811-818`).
  - No writer implements `Claimed → Open`. The vestigial cockpit "Confirm" (`app/(admin)/admin/shift/[shiftId]/actions.ts:181-195`) is the only exit, and nothing points Eric to it.
- **Scenario:** cap-1 taps Yes on 07-05 at 14:20Z. The compare-and-swap wins, then the withdraw write hits a database blip. cap-1 sees an error and taps again, getting `already_answered`. 47 hours before the trip: 0 asks, state `Filling`, 0 board rows. After the trip: `shiftsCompleted: 0`, still `Filling`.
- **Severity:** S2.
- **Confidence:** tested (shim, failure injected) — `tick.tagA` › F2. Output: `F2 tick inside deadline { asksFired: 0, state: 'Filling', boardRows: 0 }`.

#### S2-2. On a multi-trip day, once the first trip departs the shift is never worked or boarded again

- **Spec.**
  - §0.4 glossary: "a Saturday shift has a 1pm, 3pm, 5pm manifest".
  - §2.6 acceptance criteria: "Bailing reopens the seat and the **tick** re-crews it, with no operator action."
- **Code.**
  - The tick's past-trip guard and the board's both key on the *earliest* departure (`src/builder/tick.ts:373-374`, `src/admin/at-risk-board.ts:226`).
  - Completion keys on the *latest* end (`tick.ts:343-353`).
  - DEC-062 accepted this on the premise "BrewBoat is single-trip; revisit if multi-trip days become common". The glossary and the per-event manifest (§2.6.3) contradict that premise.
- **What differs:** after the first departure a bail is never re-crewed and never surfaced. If no required seat is still `Confirmed`, the shift never completes.
- **Scenario:** captain-only boat, trips at 13:00 and 17:00 on 07-10. The captain bails at 14:30 after running the first trip. The next tick fires 0 asks, the board has 0 rows, and the shift sits `Filling` forever. The 17:00 trip has no captain, and nobody is told except by the cockpit if Eric opens it.
- **Severity:** S2.
- **Confidence:** tested (shim) — `tick.tagA` › F13.

#### S2-3. A trip booked onto a vessel-day whose shift is already `Completed` is folded into that row and never crewed

- **Spec.**
  - §2.3 edge case: "Late booking, shift exists → slots in automatically".
  - §1.1: `Completed` means "Trip ran. Historical."
- **Code.**
  - Formation keeps a stored `Completed` (`src/builder/form-shifts.ts:596-598`) while rewriting `eventIds` to include the new trip (`:624-643`).
  - The tick and the board skip terminal shifts (`src/builder/tick.ts:307`, `src/admin/at-risk-board.ts:217`).
  - The operator booking path refuses only departed trips and passes the cutoff (`src/reservations/operator-booking.ts:63-67`).
- **Scenario:** Brew 1's Saturday 09:00 runs; the tick marks it `Completed` around 12:00. At 12:30 the office phones in an 18:00 sunset trip. No shift is created, no notice is sent, and the next tick fires 0 asks with no board row.
- **Severity:** S2.
- **Confidence:** tested (shim) — `form-shifts.tagE` › "the 18:00 trip joins the Completed row".

#### S2-4. Seat writes that are not compare-and-swap, made from a stale read, erase a fill that just happened, and the engine then asks for a seat that was filled

- **Spec.**
  - §1.1: "`Asked → Open` (timeout/all-declined)".
  - DEC-061: "In" now means committed.
  - The rubric's S2 includes "asked after the seat filled".
- **Code.** Each of these reads the seat, does slower work, then writes back `{...staleSeat, state}`:
  - `widenAsk` reads at `src/asks/ask-loop.ts:280`, runs `rankedEligible` over the whole roster at `:284`, then saves `Asked` at `:286-288`. Tested.
  - `expireAsks` reads at `:605` and saves `Open` at `:622`. Tested.
  - The decline branch reads at `:335` and saves `Open` at `:448`. Tested.
  - `assignPerson` reads at `:240` and saves at `:252`. Read only.
  - Postgres `saveSeat` is an unconditional upsert (`src/adapters/postgres-repository.ts:2100-2108`; read, not run).
- **Scenarios.**
  - **Expire versus accept.** The tick times out cap-1's ask at 15:01Z while cap-2's accept lands. cap-2 is told `Confirmed`; the seat ends `Open` with no occupant and no `shift_bailed`. The next tick nudges cap-2 for the seat they think they hold.
  - **Widen versus self-claim.** The tick widens while Mo self-claims. Mo is told "claimed" and credited +4; the seat ends `Asked` with no occupant, and a fresh ask has gone out.
- **Severity:** S2.
- **Confidence:** tested (shim, interleaving forced):
  - `ask-loop-race.tagA` › R1, R2;
  - `tick.tagC` › F6 (two cases);
  - `accept-eligibility.tagB` › "non-CAS seat writes…" (three cases).
  - Whether Postgres timing opens these windows in production is read, not run.

#### S2-5. The engine re-asks and nudges the bailer of the shift they bailed on

- **Spec.**
  - §2.4 *Eligible pool*: "The ranked list then drops three more classes: … this shift's **bailers** (DEC-019)".
  - DEC-019: "re-ask the next candidates (excluding the bailer)".
- **Code.**
  - The tick excludes only the seat's own asked set (`src/builder/tick.ts:453-454`) and, on the urgent blast, working crew (`:469`).
  - `rankedEligible` excludes only crew already on the shift (`src/asks/ask-loop.ts:183-200`).
  - Tier-2 excludes declined, live, already-nudged and working crew, but not bailers or accepted asks (`src/asks/escalate.ts:84-109`).
  - The operator doors and the cockpit do exclude bailers (`src/asks/lean.ts:66-76`, `:139-144`; `src/admin/at-risk-board.ts:311-321`).
  - How a bailer gets back into the pool:
    - a self-claimer has no ask at all;
    - the fill doors withdraw the placed person's own ask, which makes them re-askable (`ask-loop.ts:878`, `src/asks/claim.ts:188`);
    - an accepted ask keeps them out of the drip but not out of Tier-2.
- **Scenarios.**
  - Alice self-claims, then releases 11 days out. At the horizon tick the first text for that seat goes to Alice. Her score is +4 for the claim and −3 for the bail, net +1, above a newcomer's 0.
  - Alice accepts, bails, and Bob ghosts. Tier-2 nudges Alice, while `lean()` refuses her with `bailed`.
- **Severity:** S2.
- **Confidence:** tested (shim) — `tick.tagC` › F1 (four cases); `tick.tagA` › F11.

#### S2-6. A seat made surplus by a manning cut, but `Asked` at the time, stays required: it keeps being asked and keeps the shift from `Crewed`

- **Spec.**
  - §2.3: required seats are "derived from COI … computed, not hand-entered", and manning is a list "the seat builder iterates".
  - §1.1: `Crewed` = "Every **required** seat confirmed".
- **Code.**
  - Only an `Open` surplus seat is pruned. Any other state is counted as `seatsStranded` and left as `kind:"required"` (`src/builder/form-shifts.ts:571-581`).
  - The tick keeps re-widening `Asked` seats (`src/builder/tick.ts:446-509`, `173-177`), so the seat is never `Open` when the next formation runs.
  - The cron's formation pass drops `seatsStranded` (`app/api/cron/tick/route.ts:86-116`), contradicting "surfaced" in `form-shifts.ts:15-17`.
- **Scenario:** Brew 2, 07-18. Alice is the confirmed captain; the mate seat is out to Dan. Eric makes Brew 2 captain-only. The repair pass reports one stranded seat, the shift stays `Filling`, and 20 minutes later the tick asks Erin for a mate seat the boat no longer needs. This repeats until the mate pool is walked. Whoever accepts is confirmed on a seat that should not exist.
- **Severity:** S2. The missing surfacing is S3.
- **Confidence:** tested (shim) — `form-shifts.tagE` › "a mate seat removed from manning while Asked…".

#### S2-7. Nothing stops two ticks from overlapping, so overlapping runs double-ask, double-score and double-alert

- **Spec:** silent. A careful reader expects at most one live ask per person per seat.
- **Code.**
  - There is no advisory lock or lease (`app/api/cron/tick/route.ts:36-228`, `src/builder/tick.ts:223`). The only advisory locks in the adapter are for the hull-day booking spine.
  - Ask ids embed `sentAt` (`src/asks/ask-loop.ts:133`), and `asks` has only a primary key and `asks_seat_idx` (`db/migrations/0001_init.sql:111-122`).
- **Scenario:** two invocations at 14:00:00.000Z and 14:00:00.001Z.
  - Both ask cap-1 for the same seat.
  - A finished shift logs `shift_completed` twice (+10).
  - A landing texts the admins twice.
  - Two hours later both duplicate asks expire in one sweep and mint the same `ask_ignored` id. Postgres's plain insert would then throw mid-tick (read, not run).
- **Severity:** S2.
- **Confidence:** tested (shim, in memory) — `tick.tagA` › F6, F6b. Whether Vercel ever overlaps runs cannot be determined from the repo (§6).

#### S2-8. If the staffing horizon falls after the fill deadline, the shift is never worked and never boarded

This can only happen through configuration.

- **Spec.**
  - §2.5 route (b): uncrewed shifts board when "the trip is within the fill deadline (48h)".
  - §1.3: before the horizon "crew rules abstain".
- **Code.**
  - Route (b) requires `resolvedState === "Filling"` (`src/admin/at-risk-board.ts:276`), and before the horizon the state is `Pending` (`src/builder/derive.ts:716`).
  - Nothing checks that the two windows relate correctly:
    - `STAFFING_HORIZON_LEAD_DAYS` and `FILL_DEADLINE_HOURS` are independent knobs (`derive.ts:172-175`, `:371`);
    - `envDaySet` accepts any weekday into the DEC-116 cohort (`derive.ts:153-162`);
    - the trigger is computed from the trip's own week (`derive.ts:326-328`).
- **Scenarios.**
  - **(a)** Lead set to 1.5 days with the 48h deadline. At 40h out: `Pending`, 0 asks, 0 rows.
  - **(b)** `STAFFING_HORIZON_WEEKEND_DAYS="5 6 0"` (a Sat/Sun/Mon holiday weekend), trigger Monday 09:00. A Monday 08:00 trip gets its horizon at Monday 13:00Z, after its 12:00Z departure. It is never worked or boarded.
- **Severity:** S2. Not reachable with the repo defaults: lead 7 days (`derive.ts:172-175`), deadline 48h (`:371`), cohort off (`:200-204`).
- **Confidence:** tested (shim) — `tick.tagA` › F9; `cohort.tagA` › C1.

#### S2-9. When everyone has declined or been nudged, the shift goes quiet until the fill deadline instead of boarding

- **Spec.**
  - §2.4 edge cases: "All declined / all silent → the shift boards At-Risk (§2.5)".
  - §2.5 route (a): "eligibility-exhausted (nobody left to ask …)".
  - DEC-065: "beyond 48h a `Filling` shift **the engine is working** still stays off".
- **Code.**
  - "Exhausted" means nobody is *eligible* (`src/oracle/oracle.ts:237-249`), not that nobody is left to *ask*.
  - Tier-2 goes dry once each person has been nudged once (`src/asks/escalate.ts:100-105`, `:118-128`).
  - Route (b) waits for 48h (`src/admin/at-risk-board.ts:275-285`).
- **What differs:** a shift the engine has stopped working stays off the board, and DEC-065's condition for staying off ("the engine is working") is false.
- **Scenario:** a one-captain pool. cap-1 declines on 07-05. Two hours later there are 0 live asks, the state is `Filling` and there are 0 rows. It boards only at 07-08 20:00Z, about three days later, with no asks in between.
- **Severity:** S2. It does board eventually, at the deadline.
- **Confidence:** tested (shim) — `tick.tagA` › F4/F5. Output: `F5 { live: 0, stored: 'Filling', early: 0, late: [ [ 'core' ] ] }`.

#### S2-10. A "Yes" refused as `double_booked` leaves the seat `Asked` with no live ask; the drip stops and Tier-2 never fires

- **Spec:** §1.1: "`Asked → Open` (timeout/all-declined, re-ask next)".
- **Code.**
  - The answer is saved as `accepted` (`src/asks/ask-loop.ts:357`). The function then returns `double_booked` from `:370-373` or `:405-409` without the reopen check the decline branch has (`:445-451`).
  - `expireAsks` reopens a seat only if it expired at least one ask this sweep (`:616-620`).
  - The tick treats a fully-asked seat as stalled only when it is `Open` (`src/builder/tick.ts:456-460`).
- **Scenario.**
  - V2 mate seat: Alice asked 06-25 16:00Z, Bob 16:15. Alice times out at 18:05 while Bob's ask is still live.
  - Bob is placed on another 07-01 boat, then taps Yes on V2 and gets `double_booked`.
  - On 06-26, 06-27 and 06-28: 0 asks, 0 nudges, the seat is `Asked`, the shift is `Filling`, and it is not on the board. Alice, the ghoster Tier-2 exists to nudge, is never nudged.
  - The trail shows `accepted: 1` for an unfilled seat.
  - It boards at the fill deadline.
- **Severity:** S2 (bounded by the fill deadline).
- **Confidence:** tested (shim) — `tick.tagC` › F2; `accept-eligibility.tagB` › "if instead they tap 'in' on X → double_booked…".

### S3 — the wrong thing is shown, or a reliability event is logged wrong, missed or doubled

| ID | Finding | Spec | Code | Scenario | Confidence |
|---|---|---|---|---|---|
| S3-1 | One seat with an empty pool makes the whole shift `AtRisk`; Tier-1 then stops for every seat, including ones that can still be filled. "Exhausted" can also be false: the solve is greedy, walks seats in list order, and moves `Confirmed` occupants out of their seats. | §1.2 Tier 1 "accepts down the list until required seats are `Confirmed`" | `src/oracle/oracle.ts:187-222,237-249`; `src/builder/derive.ts:717`; `src/builder/tick.ts:425` (only `Filling` is worked); Postgres `listSeatsForShift` has no ORDER BY, `src/adapters/postgres-repository.ts:2115-2121` (read) | Mate-first manning with Alice [captain, mate] and Carol [mate]: `satisfiable:false`, `AtRisk`, 0 asks, although Carol as mate and Alice as captain is valid. In the dual-rating case (Alice overridden into the mate seat), free captain Bob is never asked. | tested — `tick.tagA` F1a/b/e; `tick.tagC` F5 |
| S3-2 | A tick that throws halfway leaves earlier shifts' asks in the database but never texted; two hours later those people are charged `ask_ignored`. The same happens when a send fails. | §1.4 as amended by DEC-146: `ask_ignored` "is only for genuine silence" | `src/builder/tick.ts:555` (`firedAsks` returned only at the end); `app/api/cron/tick/route.ts:211-239` (its own comment admits the gap); `src/adapters/forward-asks.ts:124-139` swallows a send failure | Shift A asks cap-1, then `saveShift` throws on shift B. cap-1 is never texted and gets −3 at +2h. | tested — `tick.tagA` F7; send failure read |
| S3-3 | An ask still live when its shift cancels stays live. The crew app hides it while the shift is cancelled, so nobody can answer it; when the shift comes back, the next sweep charges it as silence. | DEC-146 | `src/builder/form-shifts.ts:499-501` (asks untouched); `src/crewapp/crew-view.ts:183-186`; `src/asks/ask-loop.ts:609-613` | Captains A and B are blasted at 00:00Z, the trip is cancelled at 00:05 and reinstated at 03:00; both get −3. | tested — `form-shifts.tagE`; `resurrect-doublebook.tagB`; `reliability.tagD` P2 |
| S3-4 | A merge deletes side B's seats but not their asks, and so does a manning prune. Seat ids are deterministic, so a re-split re-attaches the old asks: the crew app shows a stale ask for a different set of trips, the sweep charges it as ignored, and the integrity check goes red meanwhile. | DEC-146; the port comment says an Open seat has "no asks" (`src/ports/repository.ts:677-678`, wrong) | `src/builder/merge.ts:80-83`; `form-shifts.ts:573-574`; `src/builder/derive.ts:37`; `src/admin/integrity.ts:128-131` | Bob is asked for side B at 16:00; side B is merged away at 16:10 and re-split at 16:20. Bob's old ask reappears and is charged −3 at 18:05. | tested — `form-shifts.tagE`; `tick.tagC` F4; `reliability.tagD` P9 |
| S3-5 | A live ask is not retired when the person commits to another shift that same day. They are either charged `ask_ignored` for an ask they could never accept, or their "Yes" strands the seat (S2-10). | DEC-146 | Only the three fill doors withdraw, and only on their own seat (`src/asks/ask-loop.ts:420,878`; `src/asks/claim.ts:188`) | Asked for boat X, Mo self-claims boat Y the same date and ignores X's ask: −3. Or the urgent blast asks Alice for V1 and V2, she accepts V1, and V2's ask times out: −3. | tested — `accept-eligibility.tagB`; `tick.tagC` F3 |
| S3-6 | An ask still live at departure is never swept and stays on the home screen. A "Yes" a week later still confirms the seat and earns +2 and +5. | §1.4 `ask_ignored` (timed out); DEC-145 calls an unanswered ask for a sailed trip "a phantom" | `src/builder/tick.ts:373-374` exits before the sweep at `:388-392`; `src/crewapp/crew-view.ts:174-198` (filters on seat `Asked` and shift not terminal only — no date or departure filter); `ask-loop.ts:368-423` | A blast at 13:45 for a 15:00 trip; Sam stays silent. A week later Sam taps Yes: `Confirmed`, then `Completed`, `ask_accepted` and `shift_completed`. | tested — `reliability.tagD` P3 |
| S3-7 | A self-claim on a shift whose boat has already sailed earns +4 for the claim and +5 for completion. | DEC-145 — completion means the trip ran with them | `src/asks/claim.ts:100-111` checks only the date, not departure; `src/builder/tick.ts:343-363` | At 21:00 a captain claims the uncrewed 15:00 trip; the next tick completes it, +9. | tested — `reliability.tagD` P1 |
| S3-8 | Nothing logs `no_show`, so the completion sweep credits a no-show +5. After completion the cockpit's "Bailed" is refused in the core but reported as logged, and the person is texted "removed". | §1.4 "`no_show` (worst case)"; DEC-145 "Bailing a completed shift is refused outright" | `src/oracle/reliability-log.ts:206` has no production caller; `src/asks/ask-loop.ts:744`; `app/(admin)/admin/shift/[shiftId]/actions.ts:326-336` maps `shift_over` to success | Lee no-shows the 15:00 trip; at 18:00 Eric presses Bailed and sees "Logged Lee's bail", while Lee keeps +5. | tested (core) — `reliability.tagD` P4; UI mapping read |
| S3-9 | Nothing logs `shift_acknowledged`. | §1.4 "Log the event day one" | `src/oracle/reliability-log.ts:253` has no caller | — | read |
| S3-10 | A double submit doubles `ask_accepted`, `ask_declined` or `shift_bailed`. | §1.4 (once per occurrence) | `src/asks/ask-loop.ts:333-357` (read-check-write on the ask); `:647-678`; Postgres `saveAsk` is an unconditional upsert (read) | A crew member double-taps "drop this shift": two `shift_bailed`, −22.8. | tested — `reliability.tagD` P6 |
| S3-11 | When two people say "in" at once, the winner's withdraw can overwrite the loser's `accepted` with `withdrawn` from a stale copy. A re-tap then logs a second +2. | DEC-146 "their real answer replaces the marker" | `src/asks/ask-loop.ts:481-499`, `:350` | The forced interleave below. | tested — `accept-eligibility.tagB` › "(Postgres-shaped interleave)" |
| S3-12 | A withdrawn ask answered after its seat reopens returns `already_filled` on an `Open` seat. The answer then bars that person from the drip. | DEC-146 | `src/asks/ask-loop.ts:350,368,432-433` | Alice taps Yes on her withdrawn ask from a stale page after Bob's bail reopened the seat. | tested — `tick.tagC` F8 (low reach) |
| S3-13 | The badge a seat change writes decides behaviour. When a sweep reopens a seat mid-tick, the raw fold writes `Pending`, the tick doesn't correct it, and Tier-2 refuses because the stored state isn't `Filling`. Tier-2 fires one cadence late and the "birth" is counted twice. | DEC-067 "escalate **this** tick, not next" | `src/asks/ask-loop.ts:71,623`; `src/builder/tick.ts:304,416-420`; `src/asks/escalate.ts:64-67` | At +61 min: `{ stored: 'Pending', shiftsEscalated: 0 }`. At +76 min: `{ bornFilling: 1, nudges: 1 }`. | tested — `tick.tagA` F3; `tick.tagC` F9 |
| S3-14 | Every formation run writes a tick-set `AtRisk` back to `Filling`, because formation always passes `poolExhausted: false`. After a booking, cancel, split or merge the badge stays wrong for up to 15 minutes; the cron flips it on every run. | DEC-022 — `poolExhausted` "must be supplied by the caller" | `src/builder/form-shifts.ts:600-608,642-643`; `app/api/cron/tick/route.ts:86` runs before `:221` | `afterReform: ['Filling','Filling','Filling'], toAtRiskPerTick: [1,1,1]` | tested — `tick.tagA` F1d; `form-shifts.tagE` |
| S3-15 | Board-landing de-duplication is keyed on shift id, and ids are re-used after cancel-and-revive or merge-and-re-split. A shift that boards again is on the board but Eric is not texted. | §2.5 "A shift reaching the board pings Eric" | `src/builder/tick.ts:538-553` | Lands, cancels, is re-booked, lands again: `boardLandings=[]`. | tested — `form-shifts.tagE` |
| S3-16 | The tick and formation write whole shift rows from snapshots, so a split, merge or cancel that commits during a long run can be reverted until the next repair pass. | — | `src/builder/tick.ts:354,420`; `src/builder/form-shifts.ts:624-643`; Postgres `saveShift` overwrites every column, `src/adapters/postgres-repository.ts:2066-2084` (read) | — | suspected (read) |
| S3-17 | A non-terminal shift with no scheduled trip is still dripped, because a missing trip start skips the past-trip guard. | — | `src/builder/tick.ts:373-374`; `src/builder/derive.ts:715` | An event is cancelled and its vessel-day's formation fails: the next tick asks for a trip that doesn't exist. | tested — `tick.tagA` F8 (low reach: `reformWindow` runs first) |
| S3-18 | The crew-facing "late bail" label fires at 6 days' notice or less, not "within a day", because the lateness stored is lead minus notice. | §1.4 "Lateness of a bail is the signal" | `src/crewapp/standing.ts:39,85`; `src/builder/derive.ts:669-678` | A bail 5 days out reads "one late bail". | tested — `reliability-score.tagD` P5 |
| S3-19 | The 40-event score window counts zero-weight `ask_sent` and `nudged` events, so being asked often flushes a crew member's worked history. | §1.4 "Rolling window (last ~90 days or ~N shifts — pick one)" | `src/oracle/reliability-score.ts:91,169-185` | 8 completed shifts (score 56) followed by 20 declined asks scores 20, the same as someone who never worked. | tested — `reliability-score.tagD` P8 |
| S3-20 | A newcomer starts at 0, below anyone who has ever answered, since every answer is now positive under DEC-120. There is also no way for anyone to set the manual boost or floor. | §1.4 "unknowns start neutral/mid-pool"; "Eric gets a manual thumb on the scale"; §2.1 acceptance criteria | `src/oracle/reliability-score.ts:192-202,224-231`; no writer of `manualBoost`/`manualFloor` in `src/crew/crew-cli.ts:345-375` or the admin app | One "No" (+1) outranks a new hire. | tested (rank) — `reliability-score.tagD` P10; missing control read |

### S4 — the spec or docs are stale or silent and the code is fine

| ID | Finding | Where |
|---|---|---|
| S4-1 | Completion fires from any non-terminal state with at least one confirmed required seat (DEC-145), but §1.1 still lists only "`Crewed → Completed`". DEC-145's `amends_spec` covers §1.4 only. | `src/builder/tick.ts:343-367`; `docs/SPEC.md §1.1` |
| S4-2 | The §2.5 regression flag, its acceptance criterion ("Regressions render with a distinct flag") and §1.1's "`Crewed → At-Risk` … late" no longer happen for new bails. DEC-128 accepted this for V1 ("derive `regression` from a recent `shift_bailed` event" is the stated follow-up). | `src/admin/at-risk-board.ts:287`; DEC-128 line 20 |
| S4-3 | §2.4 edge cases say eligibility exhaustion "boards **however far out**"; §2.5 says "only from the staffing horizon inward". The code follows §2.5, but the module doc still says "however far out". | `docs/SPEC.md §2.4` vs `docs/SPEC.md §2.5`; `src/admin/at-risk-board.ts:16-18,28-34` |
| S4-4 | §1.2 still says "**Decided:** per-role default … with a per-person override toggle"; §2.4 cut that. `resolveProtocol` is dead. | `docs/SPEC.md §1.2`; `src/asks/ask-loop.ts:938-943` |
| S4-5 | The "+ small for low `ask_declined` latency" bonus is not built. The acknowledgment cap applies per event only, so five acks equal one completed shift; this is latent because nothing produces acks (S3-9). | `src/oracle/reliability-score.ts:113-131` |
| S4-6 | The urgent blast asks one person for two seats of the same shift when a vessel's manning repeats a role (count > 1), contradicting §2.4's live-ask-on-another-seat exclusion. | `src/builder/tick.ts:462-473`; `src/builder/derive.ts:35-36` |
| S4-7 | A dry Tier-2 logs `pool_widened` on every tick forever, about 96 rows a day per stalled shift. It is a system-actor event, so ask order is unaffected. | `src/asks/escalate.ts:79` |
| S4-8 | The drip interval is effectively 15 or 30 minutes depending on cron start jitter: the widen needs `now − max(sentAt) ≥ 15 min` against a `*/15` cron. | `src/builder/tick.ts:173-177`; `vercel.json` |
| S4-9 | Once one seat stalls, Tier-2 nudges every `Open` seat, including a sibling whose un-asked candidates were held back by the one-boat-per-day spread. It also bypasses that spread. | `src/asks/escalate.ts:72,118-128`; `src/builder/tick.ts:518-523` |
| S4-10 | §1.3 says to "Model the staffing horizon as a list-of-one, not a scalar"; it is a scalar. | `src/builder/derive.ts:172-175,314-332` |
| S4-11 | Completion saves `Completed` before appending its events, so a throw in between loses the +5 permanently. On a duplicate event id the in-memory adapter duplicates while Postgres throws. | `src/builder/tick.ts:354-363`; `src/oracle/reliability-log.ts:30-39`; `src/adapters/postgres-repository.ts:2380-2386` (read) |
| S4-12 | Bail lateness is measured against the flat lead, not the DEC-116 weekend horizon that actually opened the shift. | `src/builder/derive.ts:669-678`; `src/asks/ask-loop.ts:756` |
| S4-13 | Stale code comments. | `src/oracle/claimable.ts:59-67` and `src/asks/claim.ts:51-52,113-114` name five rules; `claim.ts:44-48` "seat not Open"; `src/asks/escalate.ts:19-23` "rides its horizon to At-Risk"; `src/builder/tick.ts:31-32` and `app/api/cron/tick/route.ts:18` cite a `db/tick-dev.ts` that does not exist; `src/builder/merge.ts:60-64` calls dual-side crew "routine"; `src/builder/form-shifts.ts:10-12,15-17`; `src/ports/repository.ts:677-678`; `.claude/CLAUDE-context.md` cites `derive.ts:148,192` for the defaults, which are at `src/builder/derive.ts:172,216` |
| S4-14 | Stale spec and decision cross-references. | `docs/SPEC.md §2.3` cites "DEC-083/114" for split/merge, but DEC-114 is about board scroll position; DEC-083 line 27 calls an occupied-seat merge "forbidden … guarded in the 8.3b UI", but merge deletes occupied side-B seats by design (DEC-084) and has no guard; DEC-171 and the §2.3 acceptance criteria say "Formation reads only `Event` rows", but it also reads manning (`src/builder/form-shifts.ts:530,557`); §1.1 and §1.3's "by the time someone can tap 'in,' they are already a legal candidate" is false (S1-1) |

---

## 3. The four questions

### Q1. Can someone who is not allowed to crew a seat end up `Confirmed` on it?

**Yes.** Only the self-claim door re-checks the full six-rule gate when it writes:

- A crew "in" re-checks double-booking only (S1-1).
- The override checks only rating and archived status (S1-3, S1-6).
- The vestigial confirm checks nothing.
- Shift revival checks nothing (S1-2).

What happens when a fact changes between the ask going out and the "in":

| What changed after the ask | Does the "in" still confirm? |
|---|---|
| MMC lapses | Yes. It then boards as `credential_lapse`. |
| PTO is added | Yes, silently. |
| Weekday off is added | Yes, silently. |
| Archived or made inactive | Yes, silently. A crew session is not re-checked against the roster (`app/lib/auth.ts:94-102`, read). |
| Confirmed on another shift that date (sequential) | No: `double_booked` (`src/asks/ask-loop.ts:398-409`). But the seat is then stranded (S2-10). |
| Confirmed on another shift that date (concurrent) | Yes (S1-4). |

Every path that writes a seat to `Claimed` or `Confirmed`:

| # | Path | Where the write happens | Eligibility re-checked at the write? | Race guard |
|---|---|---|---|---|
| 1 | Crew "in" on any ask: drip, blast, Tier-2 nudge, lean, assign-from-pool | `app/(crew)/crew/actions.ts:47-67` → `recordResponseAndConfirm` `src/asks/ask-loop.ts:574-586`; compare-and-swap `Asked→Claimed` `:411-414`; `confirmSeat` plain save `:547-550` | **Partly.** Same-shift (`:370-373`) and same-date double-booking (`:398-409`) only. Active, rating, MMC, PTO, day off and shift state are trusted from ask time. | One-row compare-and-swap on seat state (`postgres-repository.ts:2131-2133`, read). Nothing on the confirm step or across shifts. |
| 2 | Self-claim (`/crew/open`) | `app/(crew)/crew/open/actions.ts:25-44` → `claimSeat` `src/asks/claim.ts:83-191`; compare-and-swap `:174` | **Yes.** All six rules, native role, window, seat and shift state (`:90-147`). Departure is not checked (S3-7). | Compare-and-swap on the state it read. The same-date check is read-then-write (#554). |
| 3 | Admin override | `app/(admin)/admin/shift/[shiftId]/actions.ts:197-248` → `overrideSeat` `src/asks/ask-loop.ts:907-930` → `manualOverride` plain save `:873` | **Rating and not-archived only.** No MMC, PTO, day off, double-booking, same-shift or shift-state check. | None. |
| 4 | Admin confirm (vestigial) | `actions.ts:181-195` → `confirmSeat` `ask-loop.ts:541-553` | **None.** Only "the seat is `Claimed`". | None. |
| 5 | Trainee staffing (supernumerary, does not gate `Crewed`) | `staffTraineeSeat` `src/builder/manning.ts:109-144` → `manualOverride` | **Yes**, the trainee rule set (all except rating), including same-shift. | Reads `Open`, then plain save. |
| 6 | Shift revival, directly or via merge | `src/builder/form-shifts.ts:545-554,596-609`; `src/builder/merge.ts:65-109` | **None.** Kept `Confirmed` seats go live again. | Not applicable. |

Paths that do **not** write `Claimed` or `Confirmed`:

- `widenAsk`, `broadcastAsk`, `assignPerson`, `lean`, `assignFromPool` and `escalate` write `Asked` only. They check eligibility at ask time: `src/asks/lean.ts:146-158`, `:230-234`; `src/asks/ask-loop.ts:183-200`.
- Formation creates `Open` seats (`form-shifts.ts:560-566`).
- Split gives side B fresh `Open` seats; merge deletes side B's seats.
- `addOverrideSeat` creates `Open` seats (`src/builder/manning.ts:54`).

### Q2. Can one person be confirmed on two overlapping shifts?

**Yes.** The engine's double-booking rule is whole-day: any committed seat on another non-cancelled shift with the same `shift.date` (`src/oracle/oracle.ts:65-98`, `src/oracle/eligibility.ts:203-210`). It is enforced sequentially at the ask door (`src/asks/ask-loop.ts:398-409`) and the claim door (`src/asks/claim.ts:129-147`), which a probe confirms. It fails in four ways:

- **Two concurrent "in" taps on two same-date shifts both win**, and so does a self-claim racing an accept (S1-4). The only guard is the one-seat compare-and-swap; there is no crew-and-date constraint or lock, and the integrity check does not look.
- **Shift revival restores a person who has since been confirmed elsewhere that day** (S1-2).
- **The override has no same-shift guard** (S1-3), and DEC-119 deliberately lets it double-book across shifts (S1-6).
- **The board cannot see any of these.** Every shift involved reads `Crewed`.

### Q3. Can a shift that needs crew stop being worked silently — no ask out, not `Crewed`, never `At-Risk`?

**Yes. Four ways never end:**

- a seat stranded in `Claimed` (S2-1);
- a multi-trip day after its first departure (S2-2);
- a trip folded into a `Completed` shift (S2-3);
- a horizon configured after the fill deadline (S2-8, configuration only).

**Two more stall quietly until the fill deadline:** an all-declined or all-nudged pool (S2-9), and a seat stranded `Asked` by a `double_booked` "in" (S2-10).

By edge:

- **Bail (DEC-128).**
  - In-horizon, the next tick picks the seat up reliably: the horizon is a level check, and an `Open` seat widens immediately (`src/builder/tick.ts:174`, `src/builder/derive.ts:716`).
  - Pre-horizon it stays `Pending`, and is asked once the horizon is crossed.
  - It fails after the first departure of a multi-trip day (S2-2).
  - It re-asks the bailer (S2-5).
  - A bail at night before an early trip is held by the civil send window. It still boards via route (b), which is not civil-gated.
- **Split and merge.**
  - Split's side B is born with `Open` seats and is worked.
  - A merge after side A collapsed restores side A's released crew and frees side B's (S1-2).
  - A merge orphans side B's asks (S3-4).
- **Trip added to a crewed shift.** It slots in and the shift stays `Crewed` (whole-day commitment). A trip added to a `Completed` shift is never crewed (S2-3).
- **Trip removed.** If it was the last trip, the shift goes `Cancelled` with its seats and live asks kept (S3-3). Otherwise the shift is re-formed.
- **Vessel or manning change.**
  - An added seat is `Open`, so the shift goes back to `Filling` and is worked.
  - A seat removed while `Asked` is stranded and keeps being asked (S2-6).
  - A manning edit runs no formation itself; the cron's repair pass applies it within one cadence.
- **Crossing the horizon between two ticks.** Handled: it is a level check, not an edge, and missed ticks catch up (`src/builder/tick.ts:414-421`).
- **A tick that fails halfway.**
  - Each shift's writes are durable. The rest of that run is skipped and resumes next tick.
  - Asks already written are never relayed and are later charged `ask_ignored` (S3-2).
  - A throw between `Completed` and its events loses the +5 (S4-11).
  - A post-compare-and-swap failure in an "in" strands `Claimed` (S2-1).
- **A tick that runs twice.**
  - Back to back is idempotent: completion is terminal, landings are deduplicated per (shift, reason), and the sweep stamps `respondedAt`.
  - Overlapping runs double-ask, double-complete and double-alert (S2-7).

### Q4. When two people say "in" to the same seat at once, does exactly one win, and does the loser's ask end as `withdrawn` (DEC-146), not `ask_ignored`?

**Exactly one wins.**

- In memory this was tested with `Promise.all`.
- In Postgres, `update seats … where id=$1 and state=$6` takes the row lock, so only the first commit matches (`src/adapters/postgres-repository.ts:2126-2145`; read, not run).
- The loser gets `already_filled` and the "this one's taken" notice (`src/crewapp/answered-code.ts:20-27`, §2.6).

**The loser's ask ends `accepted`, not `withdrawn` and not `ask_ignored`.** That is what DEC-146 specifies: "A withdrawn ask remains answerable … A contested yes ten minutes late still logs `ask_accepted` (+2) per DEC-120, and their real answer replaces the marker."

- The loser's `ask_accepted` is logged before the compare-and-swap (`src/asks/ask-loop.ts:357-367`).
- Only *silent* siblings become `withdrawn`, with no event, at all three fill doors (`ask-loop.ts:420,878`; `src/asks/claim.ts:188`).
- When the seat later reopens, the sweep skips answered and withdrawn asks (`ask-loop.ts:610`), so nobody is charged `ask_ignored`. Tested.

**One exception:** if the loser's answer lands between the winner's read of the seat's asks and its withdraw write, the winner overwrites the loser's `accepted` with `withdrawn`. A re-tap then logs a second +2 (S3-11; tested with a forced interleave).

---

## 4. Rules that match

### §1.1

- Before the horizon a shift is `Pending` and crew are not sought: `src/builder/derive.ts:716`, `src/builder/tick.ts:425`.
- `Pending → Filling` is a level check each tick, so missed ticks catch up: `derive.ts:716-718`, `tick.ts:414-421`.
- `Crewed` means every required seat `Confirmed`; supernumeraries don't gate it: `derive.ts:83,91`.
- A vessel with no manning is an error, skipped per shift and named: `derive.ts:84-89`, `tick.ts:410-413`, `src/admin/at-risk-board.ts:240`.
- `Crewed → Filling` on a bail with time to refill: `src/asks/ask-loop.ts:675-679`, `:92-118`.
- `At-Risk → Crewed` through a lean, then an "in": `src/asks/lean.ts:94-174`.
- `Crewed → Completed`, as amended by DEC-145: `tick.ts:343-367`.
- `Cancelled` is reachable from every pre-Completed state through formation: `src/builder/form-shifts.ts:499-501`.
- Terminal states are never re-worked by the tick or by a seat change: `tick.ts:307`, `ask-loop.ts:69,101`.
- `Open → Asked`: `ask-loop.ts:286-288`, `:252`.
- `Confirmed → Open` on a bail, with no inline ask (DEC-128): `ask-loop.ts:675-679`, `:823-827`.

### §1.2

- Tier 1 is ranked by reliability, using the same ranking key everywhere: `src/oracle/reliability-score.ts:240-258`, `ask-loop.ts:195`.
- The drip asks one candidate per interval and asks accumulate (DEC-063): `tick.ts:474-508`, `ask-loop.ts:274-292`.
- An interval of 0 blasts: `tick.ts:442-443`.
- Inside the fill deadline the remaining pool is blasted regardless of interval (DEC-031): `tick.ts:441-473`.
- First acceptable yes wins, through the compare-and-swap: `ask-loop.ts:411-414`.
- Tier 2 nudges once per person, never enlarges the pool and has no sweetener (DEC-024): `src/asks/escalate.ts:100-105,119`.
- Tier 3 is the At-Risk board with the trail: `src/admin/at-risk-board.ts:244`, `src/asks/escalation-trail.ts:100-107`.
- A last-minute booking is born into `Filling` and asked on the next tick: `form-shifts.ts:600-608`.
- A winning "in" auto-confirms (DEC-061): `ask-loop.ts:574-586`.
- Over-ranked captains are never asked for mate seats (DEC-066): `ask-loop.ts:199`.
- Working crew are never asked (DEC-129); a same-day decline triggers a cooldown with a valve (DEC-130): `tick.ts:469,481-500`, `escalate.ts:107-121`.
- The engine never asks before the horizon, and a pre-horizon bail stays silent: `tick.ts:425`, `ask-loop.ts:679`.

### §1.3

- `is_active`, which fails for inactive and archived alike: `src/oracle/eligibility.ts:89-93`.
- `has_rating`: `eligibility.ts:110-114`.
- `mmc_valid_on_date`, a date-only `expiry >= shift.date` check: `eligibility.ts:172-187`.
- `not_double_booked`, whole-day, with cancelled shifts excluded: `eligibility.ts:203-210`, `src/oracle/oracle.ts:65-98`.
- `not_on_pto`, inclusive: `eligibility.ts:216-224`.
- `not_recurring_off`, Monday=0 on the vessel-local date: `eligibility.ts:233-241`.
- All six run together, and each failure carries a structured `details` payload: `eligibility.ts:259-278`.
- Before the horizon crew rules abstain: `derive.ts:716`.
- The pull window is decoupled from the staffing horizon (DEC-080): `derive.ts:216-219`. Defaults:
  - `STAFFING_HORIZON_LEAD_DAYS` 7: `derive.ts:172-175`;
  - `FILL_DEADLINE_HOURS` 48: `:371`;
  - `ASK_DRIP_INTERVAL_MINUTES` 15: `:233-236`;
  - `ASK_SILENT_TIMEOUT_MINUTES` 120: `:249-252`.

### §1.4

- `ask_sent` is logged once per ask: `ask-loop.ts:140`.
- `ask_accepted` and `ask_declined` carry latency, and a re-tap is idempotent: `ask-loop.ts:350-367,437-444`.
- `self_claim` is logged only when the claim wins: `claim.ts:174-180`.
- `shift_completed` counts required `Confirmed` seats only and is not re-logged on a re-run or a re-import: `tick.ts:347-363`, `form-shifts.ts:596-598`.
- `shift_bailed` scales with lateness and pins the occupant: `ask-loop.ts:750-757,656`.
- `withdrawn` carries no event and is re-askable: `ask-loop.ts:481-526`.
- DEC-120 weights: `reliability-score.ts:113-131`.
- The escalation bonus is cut: nothing produces it.
- Crew see their own standing only: `src/crewapp/crew-view.ts:283-286`.

### §2.3

- Same vessel and same vessel-local day form one shift: `form-shifts.ts:242-258`, `src/domain/entities.ts:568`.
- Required seats loop the N-line manning list: `derive.ts:34-44`.
- A late booking for a day with no shift spawns one; an upstream edit propagates: `form-shifts.ts:482-643`.
- Split partitions at the cut and is re-derived from live trips: `src/builder/split.ts:32-73`, `form-shifts.ts:306-333`.
- Formation covers stated vessel-days, with a bounded repair pass (DEC-171): `form-shifts.ts:170-216`.
- An added required hand gates `Crewed`, in the domain only: `src/builder/manning.ts:54`.
- **Trap check: no lookup or unique index keys a shift by vessel and date.** Shifts are read by id (`src/ports/repository.ts:645-654`), and `shifts` has no `(vessel_id, date)` unique index (`db/migrations/0001_init.sql:92-99`). The vessel-plus-date keys that do exist are the formation unit itself, and DEC-083 allows one cut.

### §2.4

- The cockpit pool shows only legally fillable people and drops bailers and live-ask holders: `src/asks/assignment-view.ts:179-199`.
- Silent is shown as distinct from declined, and withdrawn as distinct from both: `assignment-view.ts:116-126`.
- Assign creates an ask: `lean.ts:188-249`.
- The vestigial confirm is still there: `actions.ts:181-195`.
- Nudge: `lean.ts:94-174`.
- The override honours the rating and archived floors (DEC-064, DEC-096): `ask-loop.ts:917-921`.
- No-penalty remove logs no event: `ask-loop.ts:799-829`.
- The deadline is departure minus 48h, distinct from the horizon: `derive.ts:371,412-430`.
- Any manual action creates a live ask, which pauses automation implicitly (DEC-027 §2): `ask-loop.ts:234-256`.

### §2.5

- Route (a) boards on eligibility exhaustion from the horizon inward: `at-risk-board.ts:273-274`.
- `credential_lapse` is checked on every non-terminal shift, `Crewed` included: `at-risk-board.ts:289-301`.
- A `Filling` shift further out than the deadline does not appear: `at-risk-board.ts:275-285`.
- Urgency is time plus pool thinness: `at-risk-board.ts:106-116`.
- Membership is recomputed on read: `at-risk-board.ts:244-264`.
- The lean list excludes bailers and live-ask holders: `at-risk-board.ts:311-326`.
- Pause gates the tick but not formation: `app/api/cron/tick/route.ts:184-195`.

### §2.6

- Accepting a seat that just filled shows a clear "taken" notice: `src/crewapp/answered-code.ts:20-27`.
- My shifts lists confirmed and claimed shifts on a vessel-local today: `crew-view.ts`.
- Standing is individual, never comparative: `src/crewapp/standing.ts:56-133`.

### §2.7

- The claimable list uses the same six-rule gate, covers `Pending`, `Filling` and `AtRisk`, and includes uncommitted seats: `src/oracle/claimable.ts:28-29,94-97`.
- A claim re-validates the full predicate, then writes `Confirmed`: `claim.ts:90-191`.
- Two claims on the same seat produce exactly one winner: `claim.ts:174`.
- Release goes through the lead-time-weighted bail: `app/(crew)/crew/shift/[shiftId]/actions.ts:52`.
- The claim door is native-role only (DEC-076): `claim.ts:108`.

### Not built

- `AtRisk → Cancelled` as a shift action: deferred, DEC-026 §3.
- `Claimed → Open`: no writer.
- Per-role protocols: cut.
- The best-by-score knob.
- `no_show` and `shift_acknowledged` producers.
- The decline-latency bonus.
- A boost/floor editor.

### Code that decides crewing with no spec

1. Reviving a cancelled shift: S1-2.
2. The past-trip guard keyed on the earliest departure: S2-2.
3. Pruning only `Open` surplus seats and stranding the rest: S2-6.
4. Merge keeping side A's seats over a confirmed side-B occupant (`src/builder/merge.ts:65-84`): questionable.
5. Withdrawn asks stay answerable with no age or state limit (`ask-loop.ts:350`): questionable.
6. An "in" is accepted on a cancelled shift's `Asked` seat (`ask-loop.ts:398-404`): questionable.
7. The one-boat-per-day spread (`tick.ts:262-302`): fine.
8. The civil send window gating autonomous asks (`tick.ts:434`): fine.
9. DEC-129 and DEC-130 suppression: fine.
10. The urgent blast dropping the spread and the cooldown (`tick.ts:462-473`): feeds S1-4 and S3-5.
11. A 120-minute wall-clock silent timeout, swept outside civil hours (`tick.ts:388` runs before `:434`): questionable.
12. An `Open` seat widening immediately, and a nudge counting toward pacing (`tick.ts:159-177`): fine.
13. Formation's `poolExhausted: false`: S3-14.
14. Whole-day double-booking blocking both halves of a split (DEC-077, #560): consistent.
15. Self-claim gated on the stored shift state (`claim.ts:103`): mostly fine.
16. The 40-event window and the standing thresholds: S3-18, S3-19.
17. The id tie-break in ranking: fine.
18. `REFORM_WINDOW_LEAD_DAYS = 45`, hardcoded (`form-shifts.ts:170`): fine at defaults.
19. The greedy solve over every required seat, confirmed ones included: S3-1.
20. Self-claim after departure on the trip day: S3-7.

---

## 5. What could not be determined from the code

- **Whether Vercel ever runs two `/api/cron/tick` invocations at once** (S2-7). The repo has no `maxDuration`, lock or lease.
- **Postgres behaviour under concurrency.** The compare-and-swap's row-lock semantics, the full-row upserts behind S2-4, S3-11 and S3-16, and the row order of `listSeatsForShift` (S3-1) were all read, not run.
- **Deployed values** of `STAFFING_HORIZON_LEAD_DAYS`, `FILL_DEADLINE_HOURS`, `ASK_DRIP_INTERVAL_MINUTES`, `ASK_SILENT_TIMEOUT_MINUTES` and the weekend-cohort knobs. These decide whether S2-8 is live. They are in Vercel env, not the repo.
- **How often production hits the triggers:** post-compare-and-swap failures (S2-1), cancel-then-rebook on one vessel-day (S1-2, S3-3), multi-trip days (S2-2), and cron jitter (S4-8).
- **How long a crew session lasts after archiving.** `src/auth/` was not traced.
- **Real vitest behaviour.** The probes ran under a stand-in (Appendix A), not vitest. The commands to re-run them with `npm test` are in Appendix A.

---

## Appendix A — probes and the shim

The probe files were deleted from the tree before this commit. They are reproduced below so every "tested" claim can be re-run.

**To re-run with vitest:**

1. Run `npm ci`.
2. Save each block below at the path in its heading.
3. Run `npm test -- <path>`.

**To re-run without installing**, save the four shim files under any directory `R`, then run:

```
CIVIL_SEND_START=00:00 CIVIL_SEND_END=23:59 node --experimental-transform-types --no-warnings --import $R/register.mjs $R/run.mjs /abs/path/to/probe.audit-tmp.test.ts
```

**Results at `84bd0d1`** — 91 passed, 0 failed:

| Probe | Passed |
|---|---|
| `accept-eligibility.tagB` | 22/22 |
| `resurrect-doublebook.tagB` | 2/2 |
| `tick.tagA` | 19/19 |
| `ask-loop-race.tagA` | 2/2 |
| `cohort.tagA` | 1/1 |
| `tick.tagC` | 21/21 |
| `reliability.tagD` | 10/10 |
| `reliability-score.tagD` | 6/6 |
| `form-shifts.tagE` | 8/8 |

The shim also ran these existing suites green:

| Suite | Passed |
|---|---|
| `src/builder/tick.test.ts` | 45/45 |
| `src/asks/ask-loop.test.ts` | 58/58 |
| `src/asks/claim.test.ts` | 24/24 |


### The shim (`$R/*.mjs`)

<details><summary><code>register.mjs</code></summary>

```js
import { register } from "node:module";
register("./loader.mjs", import.meta.url);
```

</details>

<details><summary><code>loader.mjs</code></summary>

```js
// Resolve hook: NodeNext ".js" specifiers → sibling ".ts" when the .js is absent;
// "vitest" → the local shim. Audit-only harness (deps are not installed).
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const SHIM = pathToFileURL(new URL("./vitest-shim.mjs", import.meta.url).pathname).href;
export async function resolve(specifier, context, next) {
  if (specifier === "vitest") return { url: SHIM, shortCircuit: true };
  if ((specifier.startsWith(".") || specifier.startsWith("/")) && specifier.endsWith(".js") && context.parentURL) {
    const u = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(u))) {
      const ts = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
      if (existsSync(fileURLToPath(ts))) return { url: ts.href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
```

</details>

<details><summary><code>run.mjs</code></summary>

```js
// usage: node --experimental-transform-types --import ./register.mjs run.mjs <abs test path>
import { pathToFileURL } from "node:url";
const file = process.argv[2];
await import(pathToFileURL(file).href);
const { run } = await import("vitest");
await run();
```

</details>

<details><summary><code>vitest-shim.mjs</code></summary>

```js
// Minimal vitest-compatible subset (describe/it/beforeEach/expect) on node:assert.
import assert from "node:assert/strict";
const tests = []; const stack = []; const befores = [];
export function describe(name, fn) { stack.push(name); befores.push([]); fn(); befores.pop(); stack.pop(); }
export function beforeEach(fn) { if (befores.length) befores[befores.length - 1].push(fn); else globalBefore.push(fn); }
const globalBefore = [];
export function it(name, fn) { tests.push({ name: [...stack, name].join(" > "), fn, before: [...globalBefore, ...befores.flat()] }); }
export const test = it;
function isSubset(actual, expected) {
  if (expected === null || typeof expected !== "object") return Object.is(actual, expected);
  if (actual === null || typeof actual !== "object") return false;
  return Object.keys(expected).every((k) => isSubset(actual[k], expected[k]));
}
function matchers(actual, neg) {
  const ok = (cond, msg) => { if (neg ? cond : !cond) throw new assert.AssertionError({ message: (neg ? "NOT " : "") + msg }); };
  const j = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
  return {
    toBe: (e) => ok(Object.is(actual, e), `expected ${j(actual)} toBe ${j(e)}`),
    toEqual: (e) => { let eq = true; try { assert.deepStrictEqual(actual, e); } catch { eq = false; } ok(eq, `expected ${j(actual)} toEqual ${j(e)}`); },
    toMatchObject: (e) => ok(isSubset(actual, e), `expected ${j(actual)} toMatchObject ${j(e)}`),
    toContain: (e) => ok(actual != null && actual.includes(e), `expected ${j(actual)} toContain ${j(e)}`),
    toHaveLength: (n) => ok(actual != null && actual.length === n, `expected length ${actual?.length} toHaveLength ${n}`),
    toBeNull: () => ok(actual === null, `expected ${j(actual)} toBeNull`),
    toBeUndefined: () => ok(actual === undefined, `expected ${j(actual)} toBeUndefined`),
    toBeDefined: () => ok(actual !== undefined, `expected toBeDefined`),
    toBeGreaterThan: (n) => ok(actual > n, `expected ${j(actual)} > ${n}`),
    toBeGreaterThanOrEqual: (n) => ok(actual >= n, `expected ${j(actual)} >= ${n}`),
    toBeLessThan: (n) => ok(actual < n, `expected ${j(actual)} < ${n}`),
    toBeLessThanOrEqual: (n) => ok(actual <= n, `expected ${j(actual)} <= ${n}`),
    toBeFalsy: () => ok(!actual, `expected ${j(actual)} toBeFalsy`),
    toStrictEqual: (e) => { let eq = true; try { assert.deepStrictEqual(actual, e); } catch { eq = false; } ok(eq, `expected ${j(actual)} toStrictEqual ${j(e)}`); },
    toBeCloseTo: (e, d = 2) => ok(Math.abs(actual - e) < Math.pow(10, -d) / 2, `expected ${j(actual)} toBeCloseTo ${e}`),
    toThrow: (m) => { let threw = false, msg = ""; if (typeof actual !== 'function') { threw = actual !== undefined; msg = String(actual?.message ?? actual); } else { try { actual(); } catch (err) { threw = true; msg = String(err?.message ?? err); } } ok(threw && (m === undefined || (m instanceof RegExp ? m.test(msg) : msg.includes(m))), `expected function to throw ${m ?? ""}, got ${msg}`); },
    toBeTruthy: () => ok(!!actual, `expected ${j(actual)} toBeTruthy`),
  };
}
export function expect(actual) {
  const m = matchers(actual, false); m.not = matchers(actual, true);
  const wrap = (getVal) => { const w = {}; for (const k of Object.keys(matchers(0, false))) w[k] = async (...a) => matchers(await getVal(), false)[k](...a); return w; };
  m.resolves = wrap(async () => await actual);
  m.rejects = wrap(async () => { try { await actual; } catch (e) { return e; } throw new assert.AssertionError({ message: "expected promise to reject" }); });
  return m;
}
export async function run() {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try { for (const b of t.before) await b(); await t.fn(); pass++; console.log(`  ✓ ${t.name}`); }
    catch (e) { fail++; console.log(`  ✗ ${t.name}\n      ${e?.message ?? e}`); }
  }
  console.log(`\n${pass} passed, ${fail} failed, ${tests.length} total`);
  if (fail) process.exitCode = 1;
}
```

</details>

### The probe files

<details><summary><code>src/asks/accept-eligibility.tagB.audit-tmp.test.ts</code></summary>

```ts
/**
 * AUDIT PROBE (tagB) — crewing-engine audit, shard: eligibility at the moment of
 * the write + every path that writes a seat to Claimed/Confirmed. Read-only audit:
 * these tests ASSERT WHAT THE CODE DOES TODAY (so they pass), and each name says
 * whether that is a finding or a match. Delete after the audit.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { AskId, CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import type { CrewMember, Seat } from "../domain/entities.js";
import { mondayZeroWeekday } from "../config/tenant.js";
import { deriveShiftState } from "../builder/derive.js";
import { deriveAtRiskBoard } from "../admin/at-risk-board.js";
import { answeredNoticeCode } from "../crewapp/answered-code.js";
import {
  assignPerson,
  bail,
  expireAsks,
  overrideSeat,
  rankedEligible,
  recordResponse,
  recordResponseAndConfirm,
  widenAsk,
} from "./ask-loop.js";
import { claimSeat } from "./claim.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VX = asId<"VesselId">("vessel-x");
const VY = asId<"VesselId">("vessel-y");
const S1 = asId<"ShiftId">("shift-x");
const S2 = asId<"ShiftId">("shift-y");
const DATE = "2026-07-01"; // a Wednesday
// 2026-07-01T12:00Z = 08:00 America/New_York — vessel-local today === DATE.
const T0 = new Date("2026-07-01T12:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);
const HOUR = 3_600_000;

/** In-memory repo with a one-shot hook inside `listAsksForSeat`, to force the
 *  interleavings a real Postgres pool can produce (two requests in flight). */
class HookRepo extends InMemoryRepository {
  hook: (() => Promise<void>) | null = null;
  hookBeforeRead = false;
  override async listAsksForSeat(seatId: SeatId) {
    const h = this.hook;
    if (h) this.hook = null;
    if (h && this.hookBeforeRead) await h();
    const rows = await super.listAsksForSeat(seatId);
    if (h && !this.hookBeforeRead) await h();
    return rows;
  }
  /** One-shot hook AFTER `listAllSeats` reads — i.e. inside `committedDatesByCrew`,
   *  between the double-booking read and the per-seat CAS. */
  seatsHook: (() => Promise<void>) | null = null;
  override async listAllSeats() {
    const rows = await super.listAllSeats();
    const h = this.seatsHook;
    if (h) {
      this.seatsHook = null;
      await h();
    }
    return rows;
  }
}

let repo: HookRepo;
beforeEach(() => {
  repo = new HookRepo();
});

async function addCrew(
  id: string,
  over: Partial<CrewMember> = {},
  mmcExpiry = "2026-12-31",
): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name: id,
    phone: "555",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
    ...over,
  });
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: mmcExpiry,
  });
  return crewId;
}

/** A live shift on DATE with one scheduled 15:00 trip (so the board can see it). */
async function addShift(
  id: ShiftId,
  vessel: typeof VX,
  roles: (typeof CAPTAIN)[] = [CAPTAIN],
  state: "Pending" | "Filling" = "Filling",
): Promise<SeatId[]> {
  const eventId = asId<"EventId">(`ev-${id}`);
  await repo.saveEvent({
    id: eventId,
    vesselId: vessel,
    date: DATE,
    time: "15:00",
    capacity: 16,
    source: "xola",
    status: "scheduled",
  });
  await repo.saveShift({ id, vesselId: vessel, date: DATE, state, eventIds: [eventId] });
  const ids: SeatId[] = [];
  let i = 0;
  for (const role of roles) {
    i++;
    const seatId = asId<"SeatId">(`seat-${id}-${i}`);
    const seat: Seat = { id: seatId, shiftId: id, role, kind: "required", state: "Open" };
    await repo.saveSeat(seat);
    ids.push(seatId);
  }
  return ids;
}

const seatOf = async (id: SeatId) => (await repo.getSeat(id))!;
const types = async (c: CrewMemberId) =>
  (await repo.reliabilityEventsFor(c)).map((e) => e.type);

// ── Q3: state changes between the ask going out and the tap "in" ────────────

describe("FINDING: the accept path re-checks only double-booking, not the other five rules", () => {
  async function askedA(): Promise<{ a: CrewMemberId; seatId: SeatId; askId: AskId }> {
    const a = await addCrew("crew-a");
    const [seatId] = await addShift(S1, VX);
    const ask = await widenAsk(repo, seatId!, T0); // engine asks the (then-legal) top candidate
    expect(ask?.crewMemberId).toBe(a);
    return { a, seatId: seatId!, askId: ask!.id };
  }

  async function expectIneligibleNow(seatId: SeatId, a: CrewMemberId): Promise<void> {
    // Control: the oracle would no longer ask them.
    const pool = await rankedEligible(repo, await seatOf(seatId), T0);
    expect(pool.map((c) => c.id)).not.toContain(a);
  }

  it("PTO added covering the trip date after the ask → the 'in' still Confirms", async () => {
    const { a, seatId, askId } = await askedA();
    await repo.savePtoWindow({ id: asId<"PtoWindowId">("pto-1"), crewMemberId: a, start: DATE, end: DATE });
    await expectIneligibleNow(seatId, a);
    const out = await recordResponseAndConfirm(repo, askId, "accepted", later(60_000));
    expect(out).toMatchObject({ claimed: true, seatState: "Confirmed" });
    expect((await seatOf(seatId)).assignedCrewMemberId).toBe(a);
    expect((await repo.getShift(S1))!.state).toBe("Crewed");
  });

  it("MMC edited to expire before the trip after the ask → the 'in' still Confirms", async () => {
    const { a, seatId, askId } = await askedA();
    await repo.saveCredential({ id: asId<"CredentialId">("cred-crew-a"), crewMemberId: a, type: "MMC", expiry: "2026-06-30" });
    await expectIneligibleNow(seatId, a);
    const out = await recordResponseAndConfirm(repo, askId, "accepted", later(60_000));
    expect(out).toMatchObject({ claimed: true, seatState: "Confirmed" });
  });

  it("recurring weekday off added for the trip's weekday after the ask → still Confirms", async () => {
    const { a, seatId, askId } = await askedA();
    await repo.updateCrewWeekdaysOff(a, [mondayZeroWeekday(DATE)]);
    await expectIneligibleNow(seatId, a);
    const out = await recordResponseAndConfirm(repo, askId, "accepted", later(60_000));
    expect(out).toMatchObject({ claimed: true, seatState: "Confirmed" });
  });

  it("crew ARCHIVED after the ask → still Confirms", async () => {
    const { a, seatId, askId } = await askedA();
    await repo.setCrewStatus(a, "archived");
    await expectIneligibleNow(seatId, a);
    const out = await recordResponseAndConfirm(repo, askId, "accepted", later(60_000));
    expect(out).toMatchObject({ claimed: true, seatState: "Confirmed" });
  });

  it("crew made INACTIVE after the ask → still Confirms", async () => {
    const { a, seatId, askId } = await askedA();
    await repo.setCrewStatus(a, "inactive");
    await expectIneligibleNow(seatId, a);
    const out = await recordResponseAndConfirm(repo, askId, "accepted", later(60_000));
    expect(out).toMatchObject({ claimed: true, seatState: "Confirmed" });
  });

  it("captain rating removed (ratings corrected to [mate]) after the ask → still Confirms as captain", async () => {
    const { a, seatId, askId } = await askedA();
    const c = (await repo.getCrewMember(a))!;
    await repo.saveCrewMember({ ...c, ratings: [MATE] });
    await expectIneligibleNow(seatId, a);
    const out = await recordResponseAndConfirm(repo, askId, "accepted", later(60_000));
    expect(out).toMatchObject({ claimed: true, seatState: "Confirmed" });
  });

  it("MATCH: confirmed on another same-date shift FIRST (sequential) → the 'in' is refused double_booked", async () => {
    const { a, askId } = await askedA();
    const [other] = await addShift(S2, VY);
    await overrideSeat(repo, other!, a, T0);
    const out = await recordResponseAndConfirm(repo, askId, "accepted", later(60_000));
    expect(out).toMatchObject({ claimed: false, reason: "double_booked" });
  });
});

describe("FINDING: nothing vacates, withdraws or boards an already-Confirmed seat when the person becomes ineligible", () => {
  async function crewedWithA(): Promise<{ a: CrewMemberId; seatId: SeatId }> {
    const a = await addCrew("crew-a");
    const [seatId] = await addShift(S1, VX);
    const ask = await widenAsk(repo, seatId!, T0);
    await recordResponseAndConfirm(repo, ask!.id, "accepted", later(1000));
    expect((await repo.getShift(S1))!.state).toBe("Crewed");
    return { a, seatId: seatId! };
  }

  it("PTO added → seat stays Confirmed, shift Crewed, and the At-Risk board shows NO row", async () => {
    const { a, seatId } = await crewedWithA();
    await repo.savePtoWindow({ id: asId<"PtoWindowId">("pto-1"), crewMemberId: a, start: DATE, end: DATE });
    expect((await seatOf(seatId)).state).toBe("Confirmed");
    expect(await deriveAtRiskBoard(repo, later(2000))).toEqual([]);
  });

  it("archived → seat stays Confirmed and the board shows NO row", async () => {
    const { a, seatId } = await crewedWithA();
    await repo.setCrewStatus(a, "archived");
    expect((await seatOf(seatId)).state).toBe("Confirmed");
    expect(await deriveAtRiskBoard(repo, later(2000))).toEqual([]);
  });

  it("recurring day off → board shows NO row", async () => {
    const { a } = await crewedWithA();
    await repo.updateCrewWeekdaysOff(a, [mondayZeroWeekday(DATE)]);
    expect(await deriveAtRiskBoard(repo, later(2000))).toEqual([]);
  });

  it("MATCH (contrast): MMC lapse on a Confirmed seat DOES board as credential_lapse", async () => {
    const { a } = await crewedWithA();
    await repo.saveCredential({ id: asId<"CredentialId">("cred-crew-a"), crewMemberId: a, type: "MMC", expiry: "2026-06-30" });
    const rows = await deriveAtRiskBoard(repo, later(2000));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reasons).toContain("credential_lapse");
  });
});

// ── Q2/Q4: one person confirmed on two same-date shifts ─────────────────────

describe("FINDING (#554, the ask-path twin): concurrent cross-shift commits for one person both win", () => {
  it("two 'in' taps on two same-date shifts at the same moment → Confirmed on BOTH boats", async () => {
    const a = await addCrew("crew-a");
    const [x] = await addShift(S1, VX);
    const [y] = await addShift(S2, VY);
    const ax = await assignPerson(repo, x!, a, T0);
    const ay = await assignPerson(repo, y!, a, T0);
    const [ox, oy] = await Promise.all([
      recordResponseAndConfirm(repo, ax!.id, "accepted", later(1000)),
      recordResponseAndConfirm(repo, ay!.id, "accepted", later(1000)),
    ]);
    expect(ox.seatState).toBe("Confirmed");
    expect(oy.seatState).toBe("Confirmed");
    expect((await seatOf(x!)).assignedCrewMemberId).toBe(a);
    expect((await seatOf(y!)).assignedCrewMemberId).toBe(a);
    expect((await repo.getShift(S1))!.state).toBe("Crewed");
    expect((await repo.getShift(S2))!.state).toBe("Crewed");
  });

  it("a self-claim and an ask-accept for two same-date shifts racing → Confirmed on BOTH", async () => {
    const m = await addCrew("mate-m", { ratings: [MATE] });
    const [x] = await addShift(S1, VX, [MATE]);
    const [y] = await addShift(S2, VY, [MATE]);
    const ay = await assignPerson(repo, y!, m, T0);
    // Deterministic interleave: the claim reads its committed-dates set (empty), then
    // the accept on boat Y runs to completion, then the claim's CAS on boat X lands.
    let accept: Awaited<ReturnType<typeof recordResponseAndConfirm>> | null = null;
    repo.seatsHook = async () => {
      accept = await recordResponseAndConfirm(repo, ay!.id, "accepted", later(1000));
    };
    const claim = await claimSeat(repo, m, x!, T0);
    expect(claim.code).toBeNull();
    expect(accept!.seatState).toBe("Confirmed");
    expect((await seatOf(x!)).assignedCrewMemberId).toBe(m);
    expect((await seatOf(y!)).assignedCrewMemberId).toBe(m);
  });
});

describe("FINDING: the manual override has no same-shift guard — one person fills two required seats → Crewed", () => {
  it("captain overridden into BOTH the captain and the mate seat of one boat → shift Crewed", async () => {
    const x = await addCrew("cap-x", { ratings: [CAPTAIN, MATE] });
    const [cap, mate] = await addShift(S1, VX, [CAPTAIN, MATE]);
    expect((await overrideSeat(repo, cap!, x, T0)).code).toBeNull();
    expect((await overrideSeat(repo, mate!, x, T0)).code).toBeNull();
    const seats = await repo.listSeatsForShift(S1);
    expect(seats.every((s) => s.assignedCrewMemberId === x && s.state === "Confirmed")).toBe(true);
    expect(deriveShiftState(seats)).toBe("Crewed");
    expect((await repo.getShift(S1))!.state).toBe("Crewed");
  });

  it("spec-silent: the override seats a lapsed-MMC / on-PTO person (rating + archived are its only gates)", async () => {
    const x = await addCrew("cap-x", {}, "2026-01-01"); // MMC long lapsed
    await repo.savePtoWindow({ id: asId<"PtoWindowId">("pto-x"), crewMemberId: x, start: DATE, end: DATE });
    const [cap] = await addShift(S1, VX);
    expect((await overrideSeat(repo, cap!, x, T0)).code).toBeNull();
    expect((await seatOf(cap!)).state).toBe("Confirmed");
  });
});

// ── Q5: two "in" taps on the SAME seat ───────────────────────────────────────

describe("Q5 one seat, two concurrent 'in' taps", () => {
  it("MATCH: exactly one wins; loser already_filled ('filled' notice), ask kept as accepted (+2), silent third withdrawn; reopen sweeps nobody", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const c = await addCrew("crew-c");
    const [seatId] = await addShift(S1, VX);
    const asks = [
      await assignPerson(repo, seatId!, a, T0),
      await assignPerson(repo, seatId!, b, later(1)),
      await assignPerson(repo, seatId!, c, later(2)),
    ];
    const [oa, ob] = await Promise.all([
      recordResponseAndConfirm(repo, asks[0]!.id, "accepted", later(60_000)),
      recordResponseAndConfirm(repo, asks[1]!.id, "accepted", later(60_000)),
    ]);
    const outs = [oa, ob];
    expect(outs.filter((o) => o.claimed)).toHaveLength(1);
    const loser = outs.find((o) => !o.claimed)!;
    expect(loser.reason).toBe("already_filled");
    expect(answeredNoticeCode("accepted", loser)).toBe("filled");
    expect((await seatOf(seatId!)).state).toBe("Confirmed");

    const rows = await repo.listAsksForSeat(seatId!);
    const byCrew = new Map(rows.map((r) => [r.crewMemberId, r]));
    expect(byCrew.get(a)!.response).toBe("accepted");
    expect(byCrew.get(b)!.response).toBe("accepted");
    expect(byCrew.get(c)!.response).toBe("withdrawn");
    expect(await types(a)).toContain("ask_accepted");
    expect(await types(b)).toContain("ask_accepted");
    expect(await types(c)).not.toContain("ask_accepted");

    // Winner bails → seat reopens → a sweep far past the timeout stamps nobody ignored.
    const winner = oa.claimed ? a : b;
    await bail(repo, seatId!, later(2 * HOUR), 0, undefined, winner);
    await expireAsks(repo, seatId!, later(48 * HOUR), 2 * HOUR);
    for (const who of [a, b, c]) expect(await types(who)).not.toContain("ask_ignored");
  });

  it("FINDING (Postgres-shaped interleave): the winner's withdraw sweep overwrites a near-simultaneous loser's 'accepted' with 'withdrawn'; a re-tap then logs a SECOND ask_accepted", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const [seatId] = await addShift(S1, VX);
    const askA = await assignPerson(repo, seatId!, a, T0);
    const askB = await assignPerson(repo, seatId!, b, later(1));
    let loserOut: Awaited<ReturnType<typeof recordResponseAndConfirm>> | null = null;
    // A's withdrawLiveAsks reads the seat's asks (B still live) — B's tap lands in
    // the gap before A writes the withdrawals.
    repo.hookBeforeRead = false;
    repo.hook = async () => {
      loserOut = await recordResponseAndConfirm(repo, askB!.id, "accepted", later(60_001));
    };
    const winOut = await recordResponseAndConfirm(repo, askA!.id, "accepted", later(60_000));
    expect(winOut.claimed).toBe(true);
    expect(loserOut!.reason).toBe("already_filled");
    const bRow = (await repo.getAsk(askB!.id))!;
    expect(bRow.response).toBe("withdrawn"); // B said Yes; the row now says withdrawn
    expect((await types(b)).filter((t) => t === "ask_accepted")).toHaveLength(1);
    // A stale-form re-tap (or double submit) — withdrawn is "still answerable".
    const again = await recordResponse(repo, askB!.id, "accepted", later(120_000));
    expect(again.reason).toBe("already_filled"); // not already_answered
    expect((await types(b)).filter((t) => t === "ask_accepted")).toHaveLength(2);
  });
});

// ── Lost updates: unconditional saveSeat from a stale read erases a Confirmed ──

describe("FINDING: non-CAS seat writes from a stale read erase a concurrent fill", () => {
  it("tick's widenAsk on an Open seat erases a self-claim that lands mid-widen (claim reported success, +4 logged)", async () => {
    const m = await addCrew("mate-m", { ratings: [MATE] });
    await addCrew("mate-n", { ratings: [MATE] });
    const [x] = await addShift(S1, VX, [MATE]);
    let claimCode: string | null | undefined;
    repo.hookBeforeRead = true;
    repo.hook = async () => {
      claimCode = (await claimSeat(repo, m, x!, T0)).code;
    };
    const ask = await widenAsk(repo, x!, T0);
    expect(claimCode).toBeNull(); // claimer was told "claimed"
    expect(await types(m)).toContain("self_claim");
    const s = await seatOf(x!);
    expect(s.state).toBe("Asked"); // the Confirmed write is gone
    expect(s.assignedCrewMemberId).toBeUndefined();
    expect(ask).not.toBeNull();
  });

  it("admin override landing between an accept's CAS and its confirm → seat is the override's, the accepter is still told 'in'", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const [x] = await addShift(S1, VX);
    const askA = await assignPerson(repo, x!, a, T0);
    repo.hookBeforeRead = false; // fires in A's post-CAS withdrawLiveAsks
    repo.hook = async () => {
      expect((await overrideSeat(repo, x!, b, later(60_000))).code).toBeNull();
    };
    const out = await recordResponseAndConfirm(repo, askA!.id, "accepted", later(60_000));
    expect(out).toMatchObject({ claimed: true, seatState: "Claimed" });
    expect(answeredNoticeCode("accepted", out)).toBe("in");
    expect((await seatOf(x!)).assignedCrewMemberId).toBe(b);
  });

  it("a decline whose read predates a concurrent winning 'in' reopens the seat to Open, erasing the winner", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const [x] = await addShift(S1, VX);
    const askA = await assignPerson(repo, x!, a, T0);
    const askB = await assignPerson(repo, x!, b, later(1));
    let winOut: Awaited<ReturnType<typeof recordResponseAndConfirm>> | null = null;
    repo.hookBeforeRead = true; // fires inside B's allAsksClosed, before its list read
    repo.hook = async () => {
      winOut = await recordResponseAndConfirm(repo, askA!.id, "accepted", later(60_000));
    };
    await recordResponseAndConfirm(repo, askB!.id, "declined", later(60_000));
    expect(winOut!).toMatchObject({ claimed: true, seatState: "Confirmed" });
    expect(answeredNoticeCode("accepted", winOut!)).toBe("in"); // A was told "you're in"
    const s = await seatOf(x!);
    expect(s.state).toBe("Open");
    expect(s.assignedCrewMemberId).toBeUndefined();
  });
});

// ── Moot asks after the person is committed elsewhere ───────────────────────

describe("FINDING: a live ask is not retired when its recipient is committed elsewhere that date", () => {
  it("asked for boat X, self-claims boat Y same date, ignores X's (now moot) ask → ask_ignored (−3)", async () => {
    const m = await addCrew("mate-m", { ratings: [MATE] });
    const [x] = await addShift(S1, VX, [MATE]);
    const [y] = await addShift(S2, VY, [MATE]);
    await assignPerson(repo, x!, m, T0);
    expect((await claimSeat(repo, m, y!, later(1000))).code).toBeNull();
    await expireAsks(repo, x!, later(3 * HOUR), 2 * HOUR);
    expect(await types(m)).toContain("ask_ignored");
  });

  it("if instead they tap 'in' on X → double_booked, and X's seat is stranded Asked with no live ask", async () => {
    const m = await addCrew("mate-m", { ratings: [MATE] });
    const [x] = await addShift(S1, VX, [MATE]);
    const [y] = await addShift(S2, VY, [MATE]);
    const ax = await assignPerson(repo, x!, m, T0);
    expect((await claimSeat(repo, m, y!, later(1000))).code).toBeNull();
    const out = await recordResponseAndConfirm(repo, ax!.id, "accepted", later(2000));
    expect(out.reason).toBe("double_booked");
    expect((await seatOf(x!)).state).toBe("Asked");
    const live = (await repo.listAsksForSeat(x!)).filter((a) => a.respondedAt === undefined);
    expect(live).toHaveLength(0);
    // No sweep reopens it (expireAsks needs expired > 0), and no one is left to widen to.
    expect(await expireAsks(repo, x!, later(10 * HOUR), 2 * HOUR)).toBe(0);
    expect(await widenAsk(repo, x!, later(10 * HOUR))).toBeNull();
    expect((await seatOf(x!)).state).toBe("Asked");
  });
});
```

</details>

<details><summary><code>src/asks/ask-loop-race.tagA.audit-tmp.test.ts</code></summary>

```ts
/**
 * AUDIT PROBE (tagA) — stale-snapshot blind writes in the seat machine.
 * `expireAsks` and `recordResponse`'s decline branch read the seat once, then later
 * `saveSeat({...staleSeat, state: "Open"})`. An accept landing in between is wiped.
 * The interleaving is forced by intercepting `logReliabilityEvent` (the await that
 * sits between the read and the write). Passing = the finding reproduces.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, RoleTypeId } from "../domain/ids.js";
import type { ReliabilityEvent } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";
import { tick } from "../builder/tick.js";
import { formAllVesselDaysForTest } from "../builder/form-all-test-support.js";
import { recordResponseAndConfirm } from "./ask-loop.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const VESSEL = asId<"VesselId">("vessel-a");
const SHIFT = asId<"ShiftId">(`shift-${VESSEL}-2026-07-10`);
const T0 = new Date("2026-07-05T14:00:00.000Z"); // in-horizon, pre-deadline (drip)
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

let repo: InMemoryRepository;
beforeEach(async () => {
  repo = new InMemoryRepository();
  await repo.saveVessel({ id: VESSEL, name: "A", coiMaxPax: 6, manning: [{ roleTypeId: CAPTAIN, count: 1 }] });
  await repo.saveEvent({ id: asId<"EventId">("ev-a"), vesselId: VESSEL, date: "2026-07-10", time: "15:00", capacity: 6, source: "xola", status: "scheduled" });
});

async function crew(id: string, ratings: RoleTypeId[] = [CAPTAIN]): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({ id: crewId, name: id, phone: "555", ratings, status: "active", reliabilityScore: null });
  await repo.saveCredential({ id: asId<"CredentialId">(`cred-${id}`), crewMemberId: crewId, type: "MMC", expiry: "2027-12-31" });
  return crewId;
}

/** Proxy that runs `hook` once, just before the first reliability event of `type` is written. */
function interceptOnce(base: InMemoryRepository, type: string, hook: () => Promise<void>): Repository {
  let fired = false;
  return new Proxy(base, {
    get(target, prop, recv) {
      if (prop === "logReliabilityEvent") {
        return async (e: ReliabilityEvent) => {
          if (!fired && e.type === type) {
            fired = true;
            await hook();
          }
          return target.logReliabilityEvent(e);
        };
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as Repository;
}

describe("R1 tick's expireAsks wipes a seat confirmed mid-sweep", () => {
  it("cap-2 accepts while the tick is timing out cap-1's ask → seat ends Open, cap-2 silently dropped", async () => {
    const cap1 = await crew("cap-1");
    const cap2 = await crew("cap-2");
    await formAllVesselDaysForTest(repo);
    const o = { silentTimeoutMinutes: 60 };
    await tick(repo, T0, o); // ask cap-1
    await tick(repo, min(16), o); // widen cap-2
    const seatId = (await repo.listSeatsForShift(SHIFT))[0]!.id;
    const cap2Ask = (await repo.listAsksForSeat(seatId)).find((a) => a.crewMemberId === cap2)!;

    let acceptOutcome: unknown;
    const racy = interceptOnce(repo, "ask_ignored", async () => {
      acceptOutcome = await recordResponseAndConfirm(repo, cap2Ask.id, "accepted", min(61));
    });
    await tick(racy, min(61), o); // cap-1's ask (sent T0) is past the 60-min timeout

    const seat = (await repo.listSeatsForShift(SHIFT))[0]!;
    const cap2Events = (await repo.reliabilityEventsFor(cap2)).map((e) => e.type);
    const cap1Events = (await repo.reliabilityEventsFor(cap1)).map((e) => e.type);
    const shift = await repo.getShift(SHIFT);
    console.log("R1", { acceptOutcome, seat: seat.state, occupant: seat.assignedCrewMemberId, shift: shift!.state, cap2Events, cap1Events });
    expect((acceptOutcome as { seatState: string }).seatState).toBe("Confirmed"); // cap-2 was told "you're in"
    expect(seat.state).not.toBe("Confirmed");
    expect(seat.assignedCrewMemberId).toBeUndefined();
    expect(cap2Events).not.toContain("shift_bailed");
    expect(cap1Events).toContain("ask_ignored"); // charged for an ask the fill should have withdrawn

    // Next tick re-works a seat cap-2 believes they hold.
    const r = await tick(repo, min(76), o);
    console.log("R1 next tick", { asksFired: r.asksFired, nudges: r.nudgesFired, firedTo: r.firedAsks.map((a) => a.crewMemberId) });
  });
});

describe("R2 a decline racing an accept wipes the winner", () => {
  it("cap-1 declines while cap-2's accept lands → seat ends Open", async () => {
    await crew("cap-1");
    const cap2 = await crew("cap-2");
    await formAllVesselDaysForTest(repo);
    await tick(repo, T0); // ask cap-1
    await tick(repo, min(16)); // widen cap-2
    const seatId = (await repo.listSeatsForShift(SHIFT))[0]!.id;
    const asks = await repo.listAsksForSeat(seatId);
    const cap1Ask = asks.find((a) => a.crewMemberId !== cap2)!;
    const cap2Ask = asks.find((a) => a.crewMemberId === cap2)!;

    let acceptOutcome: unknown;
    const racy = interceptOnce(repo, "ask_declined", async () => {
      acceptOutcome = await recordResponseAndConfirm(repo, cap2Ask.id, "accepted", min(20));
    });
    const declineOutcome = await recordResponseAndConfirm(racy, cap1Ask.id, "declined", min(20));
    const seat = (await repo.listSeatsForShift(SHIFT))[0]!;
    console.log("R2", { acceptOutcome, declineOutcome, seat: seat.state, occupant: seat.assignedCrewMemberId, shift: (await repo.getShift(SHIFT))!.state });
    expect((acceptOutcome as { seatState: string }).seatState).toBe("Confirmed");
    expect(seat.state).toBe("Open");
    expect(seat.assignedCrewMemberId).toBeUndefined();
  });
});
```

</details>

<details><summary><code>src/builder/cohort.tagA.audit-tmp.test.ts</code></summary>

```ts
/**
 * AUDIT PROBE (tagA) — DEC-116 weekend cohort with a Monday in the set (e.g. a
 * Sat/Sun/Mon holiday weekend, the generalisation DEC-116's revisit_if invites).
 * The env knob is read at module load, so it is set BEFORE the dynamic imports.
 * Passing = the finding reproduces.
 */
import { describe, expect, it } from "vitest";

process.env.STAFFING_HORIZON_WEEKEND_DAYS = "5 6 0"; // Sat Sun Mon (Mon=0)
process.env.STAFFING_HORIZON_TRIGGER_DAY = "0";
process.env.STAFFING_HORIZON_WEEKEND_ASK_TIME = "09:00";

describe("C1 a Monday trip in the cohort is never worked or boarded", () => {
  it("Mon 08:00 trip: horizon = Mon 09:00 same day, after departure", async () => {
    const { InMemoryRepository } = await import("../adapters/in-memory-repository.js");
    const { asId } = await import("../domain/ids.js");
    const { tick } = await import("./tick.js");
    const { staffingHorizonFromEvents, fillDeadlineFromEvents } = await import("./derive.js");
    const { formAllVesselDaysForTest } = await import("./form-all-test-support.js");
    const { deriveAtRiskBoard } = await import("../admin/at-risk-board.js");

    const repo = new InMemoryRepository();
    const CAPTAIN = asId<"RoleTypeId">("role-captain");
    const V = asId<"VesselId">("vessel-m");
    await repo.saveVessel({ id: V, name: "M", coiMaxPax: 6, manning: [{ roleTypeId: CAPTAIN, count: 1 }] });
    const ev = { id: asId<"EventId">("ev-mon"), vesselId: V, date: "2026-07-13", time: "08:00", capacity: 6, source: "xola" as const, status: "scheduled" as const };
    await repo.saveEvent(ev);
    const cid = asId<"CrewMemberId">("cap-1");
    await repo.saveCrewMember({ id: cid, name: "cap-1", phone: "5", ratings: [CAPTAIN], status: "active", reliabilityScore: null });
    await repo.saveCredential({ id: asId<"CredentialId">("c1"), crewMemberId: cid, type: "MMC", expiry: "2027-12-31" });
    await formAllVesselDaysForTest(repo);
    const SHIFT = asId<"ShiftId">(`shift-${V}-2026-07-13`);

    const horizon = staffingHorizonFromEvents([ev]);
    const fillsBy = fillDeadlineFromEvents([ev]);
    console.log("C1 horizon", horizon?.toISOString(), "fillsBy", fillsBy?.toISOString(), "departs 2026-07-13T12:00:00Z");
    expect(horizon!.getTime()).toBeGreaterThan(new Date("2026-07-13T12:00:00.000Z").getTime());

    const sat = new Date("2026-07-11T14:00:00.000Z"); // 46h out — inside the fill deadline
    const monDawn = new Date("2026-07-13T11:30:00.000Z"); // 07:30 local, 30 min before departure
    for (const now of [sat, monDawn]) {
      const r = await tick(repo, now);
      const board = await deriveAtRiskBoard(repo, now);
      const state = (await repo.getShift(SHIFT))!.state;
      console.log("C1", now.toISOString(), { state, asksFired: r.asksFired, boardRows: board.length });
      expect(state).toBe("Pending");
      expect(r.asksFired).toBe(0);
      expect(board).toHaveLength(0);
    }
  });
});
```

</details>

<details><summary><code>src/builder/form-shifts.tagE.audit-tmp.test.ts</code></summary>

```ts
/**
 * AUDIT PROBE (tagE) — Shift Builder formation / split / merge / manning. Read-only audit;
 * the lead re-runs and deletes this file. Each `it` demonstrates one finding — the
 * assertions describe what the code DOES today, and the comments say why that is wrong.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, ShiftId, SeatId } from "../domain/ids.js";
import type { Event } from "../domain/entities.js";
import { seedFleet } from "../import/resource-map.js";
import { formShifts, reformWindow } from "./form-shifts.js";
import { splitShift } from "./split.js";
import { mergeShift } from "./merge.js";
import { tick } from "./tick.js";
import { recordResponseAndConfirm } from "../asks/ask-loop.js";
import { committedDatesByCrew, eligiblePool } from "../oracle/oracle.js";
import { checkIntegrity } from "../admin/integrity.js";
import { buildCrewAppView } from "../crewapp/crew-view.js";
import { saveVesselAdmin } from "../admin/vessel-admin.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const B1 = asId<"VesselId">("vessel-brew-1");
const B2 = asId<"VesselId">("vessel-brew-2");
const B3 = asId<"VesselId">("vessel-brew-3");
const DAY = "2026-07-18"; // a Saturday
// Four days before the trips: inside the default 7-day staffing horizon, outside the
// 48h fills-by, so the tick drips rather than blasts.
const NOW = new Date("2026-07-14T12:00:00Z");
const ALWAYS = { civilWindow: { start: "00:00", end: "23:59" } };

const ev = (id: string, vesselId: typeof B1, time: string, status: Event["status"] = "scheduled"): Event => ({
  id: asId<"EventId">(id),
  vesselId,
  date: DAY,
  time,
  capacity: 16,
  source: "xola",
  status,
});
const shiftOf = (v: typeof B1) => asId<"ShiftId">(`shift-${v}-${DAY}`);
const day = (v: typeof B1) => [{ vesselId: v, date: DAY }];

async function addCrew(repo: InMemoryRepository, id: string, role: typeof CAPTAIN): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name: id,
    phone: "555",
    ratings: [role],
    status: "active",
    reliabilityScore: null,
  });
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: "2027-12-31",
  });
  return crewId;
}

async function seat(repo: InMemoryRepository, shiftId: ShiftId, role: typeof CAPTAIN) {
  const s = (await repo.listSeatsForShift(shiftId)).find((x) => x.role === role);
  if (!s) throw new Error(`no ${String(role)} seat on ${String(shiftId)}`);
  return s;
}

async function confirm(repo: InMemoryRepository, shiftId: ShiftId, role: typeof CAPTAIN, who: CrewMemberId) {
  const s = await seat(repo, shiftId, role);
  await repo.saveSeat({ ...s, state: "Confirmed", assignedCrewMemberId: who });
}

/** Seat someone through the REAL accept door (double-book guard included). */
async function acceptViaAsk(repo: InMemoryRepository, seatId: SeatId, who: CrewMemberId, askId: string, at: Date) {
  const s = await repo.getSeat(seatId);
  await repo.saveSeat({ ...s!, state: "Asked" });
  await repo.saveAsk({
    id: asId<"AskId">(askId),
    seatId,
    crewMemberId: who,
    channel: "sms",
    sentAt: at.toISOString(),
  });
  return recordResponseAndConfirm(repo, asId<"AskId">(askId), "accepted", at);
}

describe("tagE probe — formation resurrection never re-checks eligibility", () => {
  it("a cancelled vessel-day re-booked later comes back Crewed with its OLD crew, double-booked and on PTO", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo);
    const alice = await addCrew(repo, "alice", CAPTAIN);
    const dan = await addCrew(repo, "dan", MATE);

    // Brew 2, Sat 10:00 — formed, then crewed Alice (captain) + Dan (mate).
    await repo.saveEvent(ev("e1", B2, "10:00"));
    await formShifts(repo, day(B2), { now: NOW });
    await confirm(repo, shiftOf(B2), CAPTAIN, alice);
    await confirm(repo, shiftOf(B2), MATE, dan);
    await formShifts(repo, day(B2), { now: NOW });
    expect((await repo.getShift(shiftOf(B2)))?.state).toBe("Crewed");

    // The only trip cancels → the shift goes Cancelled, crew told "you're off".
    await repo.saveEvent(ev("e1", B2, "10:00", "cancelled"));
    const cancel = await formShifts(repo, day(B2), { now: NOW });
    expect((await repo.getShift(shiftOf(B2)))?.state).toBe("Cancelled");
    expect(cancel.cancelledCrew.map((c) => String(c.crewMemberId)).sort()).toEqual(["alice", "dan"]);
    // ...but the seats stay Confirmed on the husk (DEC-084 keeps them).
    expect((await seat(repo, shiftOf(B2), CAPTAIN)).state).toBe("Confirmed");

    // The engine now treats Alice as free that day (a Cancelled shift is not a commitment)...
    expect((await committedDatesByCrew(repo)).get(alice)?.has(DAY) ?? false).toBe(false);
    // ...so she takes Brew 1's Saturday through the real accept path.
    await repo.saveEvent(ev("e2", B1, "16:00"));
    await formShifts(repo, day(B1), { now: NOW });
    const b1Cap = await seat(repo, shiftOf(B1), CAPTAIN);
    const out = await acceptViaAsk(repo, b1Cap.id, alice, "ask-alice-b1", NOW);
    expect(out.claimed).toBe(true);
    expect((await repo.getSeat(b1Cap.id))?.state).toBe("Confirmed");
    // Dan, told he is off, books Saturday as time off.
    await repo.savePtoWindow({ id: asId<"PtoWindowId">("pto-dan"), crewMemberId: dan, start: DAY, end: DAY });

    // Three days later a new customer books Brew 2 for Saturday afternoon.
    await repo.saveEvent(ev("e3", B2, "15:00"));
    const back = await formShifts(repo, day(B2), { now: NOW });

    // The canonical row resurrects with the husk's seats: Crewed, nobody asked.
    expect((await repo.getShift(shiftOf(B2)))?.state).toBe("Crewed");
    expect(String((await seat(repo, shiftOf(B2), CAPTAIN)).assignedCrewMemberId)).toBe("alice");
    expect(String((await seat(repo, shiftOf(B2), MATE)).assignedCrewMemberId)).toBe("dan");
    expect(back.restoredCrew.map((c) => String(c.crewMemberId)).sort()).toEqual(["alice", "dan"]);
    // Alice is now Confirmed on TWO boats the same date; Dan is Confirmed while on PTO.
    expect(String((await repo.getSeat(b1Cap.id))?.assignedCrewMemberId)).toBe("alice");
    const pools = await eligiblePool(repo, shiftOf(B2));
    const capPool = pools.find((p) => p.role === CAPTAIN)!;
    const matePool = pools.find((p) => p.role === MATE)!;
    const why = (p: typeof capPool, who: CrewMemberId) =>
      p.verdicts.find((v) => v.crewMemberId === who)!.failures.map((f) => f.ruleId);
    expect(why(capPool, alice)).toContain("not_double_booked");
    expect(why(matePool, dan)).toContain("not_on_pto");
  });

  it("merging a split whose side A collapsed hands side B's trips to side A's released crew and drops side B's crew", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo);
    const alice = await addCrew(repo, "alice", CAPTAIN);
    const dan = await addCrew(repo, "dan", MATE);
    const bob = await addCrew(repo, "bob", CAPTAIN);
    const erin = await addCrew(repo, "erin", MATE);
    const canon = shiftOf(B3);
    const sideB = asId<"ShiftId">(`${canon}-b`);

    // Brew 3: 10:00 private charter + 15:00 and 17:00 public. Split at 13:00.
    await repo.saveEvent(ev("am", B3, "10:00"));
    await repo.saveEvent(ev("pm1", B3, "15:00"));
    await repo.saveEvent(ev("pm2", B3, "17:00"));
    await formShifts(repo, day(B3), { now: NOW });
    await splitShift(repo, canon, "13:00", NOW);
    await confirm(repo, canon, CAPTAIN, alice);
    await confirm(repo, canon, MATE, dan);
    await confirm(repo, sideB, CAPTAIN, bob);
    await confirm(repo, sideB, MATE, erin);
    await formShifts(repo, day(B3), { now: NOW });
    expect((await repo.getShift(canon))?.state).toBe("Crewed");
    expect((await repo.getShift(sideB))?.state).toBe("Crewed");

    // The charter cancels → side A is a Cancelled husk; Alice and Dan are told they're off.
    await repo.saveEvent(ev("am", B3, "10:00", "cancelled"));
    const collapse = await formShifts(repo, day(B3), { now: NOW });
    expect((await repo.getShift(canon))?.state).toBe("Cancelled");
    expect(collapse.cancelledCrew.map((c) => String(c.crewMemberId)).sort()).toEqual(["alice", "dan"]);

    // Alice, free, takes Brew 1's Saturday through the real accept path.
    await repo.saveEvent(ev("b1", B1, "16:00"));
    await formShifts(repo, day(B1), { now: NOW });
    const b1Cap = await seat(repo, shiftOf(B1), CAPTAIN);
    expect((await acceptViaAsk(repo, b1Cap.id, alice, "ask-a", NOW)).claimed).toBe(true);

    // Eric merges the day back — DEC-083 names Merge as the operator's only inverse of a collapse.
    const { form, freedCrew } = await mergeShift(repo, canon, NOW);

    // Bob and Erin — who agreed to 15:00/17:00 — are dropped...
    expect(freedCrew.map(String).sort()).toEqual(["bob", "erin"]);
    // ...and the husk's crew are Confirmed on the afternoon they were never asked about.
    const merged = await repo.getShift(canon);
    expect(merged?.state).toBe("Crewed");
    expect((merged?.eventIds ?? []).map(String).sort()).toEqual(["pm1", "pm2"]);
    expect(String((await seat(repo, canon, CAPTAIN)).assignedCrewMemberId)).toBe("alice");
    expect(String((await seat(repo, canon, MATE)).assignedCrewMemberId)).toBe("dan");
    expect(form.restoredCrew.map((c) => String(c.crewMemberId)).sort()).toEqual(["alice", "dan"]);
    // Alice is Confirmed on Brew 1 AND Brew 3 the same date.
    expect(String((await repo.getSeat(b1Cap.id))?.assignedCrewMemberId)).toBe("alice");
  });
});

describe("tagE probe — merge does not retire side B's asks; a re-split re-attaches them", () => {
  it("orphans a live ask on merge (integrity goes red), then re-split revives it and the tick scores it ask_ignored", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo);
    const alice = await addCrew(repo, "alice", CAPTAIN);
    const dan = await addCrew(repo, "dan", MATE);
    const bob = await addCrew(repo, "bob", CAPTAIN);
    await addCrew(repo, "carol", CAPTAIN);
    await addCrew(repo, "erin", MATE); // side B's mate pool must be satisfiable, or it resolves AtRisk
    const canon = shiftOf(B2);
    const sideB = asId<"ShiftId">(`${canon}-b`);

    await repo.saveEvent(ev("am", B2, "11:00"));
    await repo.saveEvent(ev("pm", B2, "17:00"));
    await formShifts(repo, day(B2), { now: NOW });
    await splitShift(repo, canon, "14:00", NOW);
    await confirm(repo, canon, CAPTAIN, alice);
    await confirm(repo, canon, MATE, dan);

    // Side B's captain seat has a live ask out to Bob.
    const bCap = await seat(repo, sideB, CAPTAIN);
    await repo.saveSeat({ ...bCap, state: "Asked" });
    await repo.saveAsk({
      id: asId<"AskId">("ask-bob"),
      seatId: bCap.id,
      crewMemberId: bob,
      channel: "sms",
      sentAt: NOW.toISOString(),
    });

    await mergeShift(repo, canon, NOW);

    // The ask is still live, pointing at a seat that no longer exists.
    const orphan = await repo.getAsk(asId<"AskId">("ask-bob"));
    expect(orphan?.respondedAt).toBeUndefined();
    expect(await repo.getSeat(bCap.id)).toBeNull();
    const integrity = await checkIntegrity(repo);
    expect(integrity.violations.some((v) => v.entity === "ask" && v.id === "ask-bob" && v.ref === "seatId")).toBe(true);

    // Eric re-splits (same cut). Side B's seat ids are deterministic, so the old ask is back.
    const later = new Date(NOW.getTime() + 3 * 60 * 60 * 1000); // 3h later — past the 120-min silent timeout
    await splitShift(repo, canon, "14:00", later);
    const newBCap = await seat(repo, sideB, CAPTAIN);
    expect(newBCap.id).toBe(bCap.id);
    expect(newBCap.state).toBe("Open");
    expect((await repo.listAsksForSeat(newBCap.id)).map((a) => String(a.id))).toContain("ask-bob");

    // Tick 1 widens the reborn seat to Carol (Bob is "already asked" off the dead ask).
    const t1 = await tick(repo, later, ALWAYS);
    const capAsks = t1.firedAsks.filter((a) => a.seatId === newBCap.id).map((a) => String(a.crewMemberId));
    expect(capAsks).toEqual(["carol"]);
    // Bob's stale ask now renders in his app as answerable for the NEW side B.
    const bobView = await buildCrewAppView(repo, bob, later);
    expect(bobView?.asks.map((a) => String(a.askId))).toContain("ask-bob");

    // Tick 2: the sweep finds Bob's 3-hour-old ask on an Asked seat and scores it silence.
    await tick(repo, new Date(later.getTime() + 60_000), ALWAYS);
    const bobEvents = await repo.reliabilityEventsFor(bob);
    expect(
      bobEvents.some((e) => e.type === "ask_ignored" && String(e.metadata.seatId) === String(newBCap.id)),
    ).toBe(true);
  });
});

describe("tagE probe — asks are not retired when formation cancels or prunes", () => {
  it("a live ask on a cancelled shift is hidden, not withdrawn; on resurrection the tick scores it ask_ignored", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo);
    const carol = await addCrew(repo, "carol", CAPTAIN);
    await addCrew(repo, "erin", MATE);
    const shift = shiftOf(B2);

    await repo.saveEvent(ev("e1", B2, "15:00"));
    await formShifts(repo, day(B2), { now: NOW });
    const cap = await seat(repo, shift, CAPTAIN);
    await repo.saveSeat({ ...cap, state: "Asked" });
    await repo.saveAsk({ id: asId<"AskId">("ask-carol"), seatId: cap.id, crewMemberId: carol, channel: "sms", sentAt: NOW.toISOString() });

    // Ten minutes later the trip cancels; the shift goes Cancelled.
    await repo.saveEvent(ev("e1", B2, "15:00", "cancelled"));
    await formShifts(repo, day(B2), { now: new Date(NOW.getTime() + 10 * 60_000) });
    expect((await repo.getShift(shift))?.state).toBe("Cancelled");
    // The ask is still live (not withdrawn) — and the crew app hides it (#415).
    expect((await repo.getAsk(asId<"AskId">("ask-carol")))?.respondedAt).toBeUndefined();
    const hidden = await buildCrewAppView(repo, carol, new Date(NOW.getTime() + 20 * 60_000));
    expect(hidden?.asks.map((a) => String(a.askId))).not.toContain("ask-carol");

    // Three hours later the trip is re-booked; the shift resurrects with the Asked seat.
    const later = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
    await repo.saveEvent(ev("e1", B2, "15:00"));
    await formShifts(repo, day(B2), { now: later });
    await tick(repo, later, ALWAYS);
    const events = await repo.reliabilityEventsFor(carol);
    expect(events.some((e) => e.type === "ask_ignored" && String(e.metadata.seatId) === String(cap.id))).toBe(true);
  });

  it("pruning an Open surplus seat after a manning shrink orphans its closed asks (integrity goes red)", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo);
    const dan = await addCrew(repo, "dan", MATE);
    const shift = shiftOf(B2);

    await repo.saveEvent(ev("e1", B2, "15:00"));
    await formShifts(repo, day(B2), { now: NOW });
    const mateSeat = await seat(repo, shift, MATE);
    // Dan was asked and declined — the seat is Open again, holding one closed ask.
    await repo.saveAsk({
      id: asId<"AskId">("ask-dan"),
      seatId: mateSeat.id,
      crewMemberId: dan,
      channel: "sms",
      sentAt: NOW.toISOString(),
      respondedAt: NOW.toISOString(),
      response: "declined",
    });
    expect((await repo.getSeat(mateSeat.id))?.state).toBe("Open");

    await saveVesselAdmin(repo, { id: String(B2), name: "Brew 2", coiMaxPax: 16, manning: [{ roleTypeId: CAPTAIN, count: 1 }] });
    const form = await formShifts(repo, day(B2), { now: NOW });
    expect(form.seatsPruned).toBe(1);
    const integrity = await checkIntegrity(repo);
    expect(integrity.violations.some((v) => v.entity === "ask" && v.id === "ask-dan")).toBe(true);
  });
});

describe("tagE probe — formation vs the tick's AtRisk, and the reused shift id", () => {
  it("every re-form rewrites a tick-set AtRisk to Filling; a resurrected shift re-boards with no new landing", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo);
    await addCrew(repo, "carol", CAPTAIN); // no mates exist → the mate seat's pool is empty
    const shift = shiftOf(B2);

    await repo.saveEvent(ev("e1", B2, "15:00"));
    await formShifts(repo, day(B2), { now: NOW });
    const t1 = await tick(repo, NOW, ALWAYS);
    expect((await repo.getShift(shift))?.state).toBe("AtRisk");
    const firstLandings = t1.boardLandings.filter((l) => l.shiftId === String(shift));
    expect(firstLandings.length > 0).toBe(true);

    // The cron's repair pass runs BEFORE the tick: it writes Filling over AtRisk (poolExhausted:false).
    const rf = await reformWindow(repo, new Date(NOW.getTime() + 15 * 60_000));
    expect((await repo.getShift(shift))?.state).toBe("Filling");
    expect(rf.shiftsUpdated).toBe(1); // a "steady" re-form reports a change every run (#998 says 0)

    // Cancel, then re-book the same vessel-day: same canonical id, same board reason.
    await repo.saveEvent(ev("e1", B2, "15:00", "cancelled"));
    await formShifts(repo, day(B2), { now: NOW });
    await repo.saveEvent(ev("e2", B2, "16:00"));
    await formShifts(repo, day(B2), { now: NOW });
    const t2 = await tick(repo, new Date(NOW.getTime() + 30 * 60_000), ALWAYS);
    expect((await repo.getShift(shift))?.state).toBe("AtRisk");
    // Back on the board, but the (shiftId, reason) dedup memory says it already landed.
    expect(t2.boardLandings.filter((l) => l.shiftId === String(shift))).toEqual([]);
  });
});

describe("tagE probe — a trip booked onto a vessel-day whose shift already Completed is never crewed", () => {
  it("the 18:00 trip joins the Completed row: no new shift, no notice, no ask, no At-Risk row", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo);
    const alice = await addCrew(repo, "alice", CAPTAIN);
    const dan = await addCrew(repo, "dan", MATE);
    await addCrew(repo, "carol", CAPTAIN);
    await addCrew(repo, "erin", MATE);
    const shift = shiftOf(B1);

    // Brew 1, Sat 09:00 EDT (13:00Z), crewed by Alice + Dan.
    await repo.saveEvent(ev("am", B1, "09:00"));
    await formShifts(repo, day(B1), { now: NOW });
    await confirm(repo, shift, CAPTAIN, alice);
    await confirm(repo, shift, MATE, dan);
    await formShifts(repo, day(B1), { now: NOW });

    // 12:00 EDT: the morning trip's end (09:00 + 100 + 25 teardown = 11:05) has passed → Completed.
    const noon = new Date("2026-07-18T16:00:00Z");
    const t0 = await tick(repo, noon, ALWAYS);
    expect(t0.shiftsCompleted).toBe(1);
    expect((await repo.getShift(shift))?.state).toBe("Completed");

    // 12:30 EDT: the office phones in an 18:00 sunset booking on Brew 1 (operator bookings pass
    // the cutoff; only `departed` refuses). The booking path forms exactly this vessel-day.
    await repo.saveEvent(ev("sunset", B1, "18:00"));
    const form = await formShifts(repo, day(B1), {
      now: new Date("2026-07-18T16:30:00Z"),
      notifyTripChanges: true,
    });

    // The trip is folded into the Completed row — no shift is created for it, nobody is told.
    const row = await repo.getShift(shift);
    expect(row?.state).toBe("Completed");
    expect((row?.eventIds ?? []).map(String).sort()).toEqual(["am", "sunset"]);
    expect(form.shiftsCreated).toBe(0);
    expect(form.changedCrew).toEqual([]);

    // And the engine never works it: the tick skips terminal rows, so no one is asked.
    const t1 = await tick(repo, new Date("2026-07-18T16:45:00Z"), ALWAYS);
    expect(t1.asksFired).toBe(0);
    expect(t1.boardLandings).toEqual([]);
  });
});

describe("tagE probe — manning shrink leaves an occupied surplus seat gating Crewed and still dripping asks", () => {
  it("a mate seat removed from manning while Asked stays required, keeps the shift off Crewed, and the tick asks another mate for it", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo);
    const alice = await addCrew(repo, "alice", CAPTAIN);
    const dan = await addCrew(repo, "dan", MATE);
    await addCrew(repo, "erin", MATE);
    const shift = shiftOf(B2);

    await repo.saveEvent(ev("e1", B2, "15:00"));
    await formShifts(repo, day(B2), { now: NOW });
    await confirm(repo, shift, CAPTAIN, alice);
    const mateSeat = await seat(repo, shift, MATE);
    await repo.saveSeat({ ...mateSeat, state: "Asked" });
    await repo.saveAsk({
      id: asId<"AskId">("ask-dan"),
      seatId: mateSeat.id,
      crewMemberId: dan,
      channel: "sms",
      sentAt: NOW.toISOString(),
    });

    // Eric edits Brew 2 down to captain-only. No formation runs from the vessel screen.
    const saved = await saveVesselAdmin(repo, {
      id: String(B2),
      name: "Brew 2",
      coiMaxPax: 16,
      manning: [{ roleTypeId: CAPTAIN, count: 1 }],
    });
    expect(saved.ok).toBe(true);

    // The cron's repair pass re-forms the day: the Asked mate seat is "stranded", not pruned.
    const t0 = new Date(NOW.getTime() + 5 * 60_000);
    const form = await reformWindow(repo, t0);
    expect(form.seatsStranded).toBe(1);
    expect(form.seatsPruned).toBe(0);
    // Manning now needs only the captain, who is Confirmed — yet the shift is not Crewed.
    expect((await repo.getShift(shift))?.state).toBe("Filling");

    // 20 minutes later the tick drips the surplus seat to the next mate.
    const t1 = await tick(repo, new Date(NOW.getTime() + 20 * 60_000), ALWAYS);
    expect(t1.firedAsks.filter((a) => a.seatId === mateSeat.id).map((a) => String(a.crewMemberId))).toEqual(["erin"]);

    // And the next repair pass still cannot prune it (it is Asked again).
    const again = await reformWindow(repo, new Date(NOW.getTime() + 30 * 60_000));
    expect(again.seatsStranded).toBe(1);
    expect(await repo.getSeat(mateSeat.id)).not.toBeNull();
  });
});
```

</details>

<details><summary><code>src/builder/reliability.tagD.audit-tmp.test.ts</code></summary>

```ts
/**
 * AUDIT PROBE (tagD, crewing-engine audit, shard §1.4 reliability). Not a real test —
 * the lead re-runs and deletes it. Each `it` demonstrates a finding; the assertions
 * encode what the CODE does today (so a passing test = finding reproduced).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId } from "../domain/ids.js";
import type { Event, Vessel } from "../domain/entities.js";
import { tick } from "./tick.js";
import { formAllVesselDaysForTest } from "./form-all-test-support.js";
import { splitShift } from "./split.js";
import { mergeShift } from "./merge.js";
import { claimSeat } from "../asks/claim.js";
import {
  bailWithDerivedLateness,
  manualOverride,
  overrideSeat,
  recordResponse,
  recordResponseAndConfirm,
  vacateSeat,
} from "../asks/ask-loop.js";
import { buildCrewAppView } from "../crewapp/crew-view.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VESSEL = asId<"VesselId">("vessel-x");
const SHIFT = asId<"ShiftId">(`shift-${VESSEL}-2026-07-01`);
// Trip 2026-07-01 15:00 America/New_York = 19:00Z; flat end = 19:00Z+100+25 = 21:05Z.
const AFTER = new Date("2026-06-30T00:00:00.000Z"); // past horizon, inside 48h fills-by
const MIDTRIP = new Date("2026-07-01T20:00:00.000Z"); // boat on the water
const DEPARTED = new Date("2026-07-02T00:00:00.000Z"); // shift end passed

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function vessel(manning: Vessel["manning"]): Promise<void> {
  await repo.saveVessel({ id: VESSEL, name: "X", coiMaxPax: 16, manning });
}
async function event(id: string, time: string, status: Event["status"] = "scheduled"): Promise<void> {
  await repo.saveEvent({
    id: asId<"EventId">(id),
    vesselId: VESSEL,
    date: "2026-07-01",
    time,
    capacity: 16,
    source: "xola",
    status,
  });
}
async function crew(id: string, role: typeof CAPTAIN): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name: id,
    phone: "555",
    ratings: [role],
    status: "active",
    reliabilityScore: null,
  });
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: "2026-12-31",
  });
  return crewId;
}
const types = async (id: CrewMemberId) =>
  (await repo.reliabilityEventsFor(id)).map((e) => e.type);

describe("tagD P1 — self-claim on a departed/finished shift earns self_claim + shift_completed", () => {
  it("mate claims mid-trip (boat already on the water) and is credited +4 +5", async () => {
    await vessel([
      { roleTypeId: CAPTAIN, count: 1 },
      { roleTypeId: MATE, count: 1 },
    ]);
    await event("e1", "15:00");
    const cap = await crew("cap-1", CAPTAIN);
    await formAllVesselDaysForTest(repo);
    const seats = await repo.listSeatsForShift(SHIFT);
    const capSeat = seats.find((s) => s.role === CAPTAIN)!;
    const mateSeat = seats.find((s) => s.role === MATE)!;
    await manualOverride(repo, capSeat.id, cap, AFTER); // captain operator-placed

    const late = await crew("mate-late", MATE);
    const out = await claimSeat(repo, late, mateSeat.id, MIDTRIP);
    expect(out.code).toBeNull(); // claim accepted 1h after departure

    const r = await tick(repo, DEPARTED);
    expect(r.shiftsCompleted).toBe(1);
    expect(await types(late)).toEqual(["self_claim", "shift_completed"]);
  });

  it("captain claims an un-crewed shift AFTER its shift end; next tick completes it with them (+9)", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await event("e1", "15:00");
    const cap = await crew("cap-1", CAPTAIN);
    await formAllVesselDaysForTest(repo); // Pending, seat Open, nobody aboard
    const seat = (await repo.listSeatsForShift(SHIFT))[0]!;

    // 2026-07-02T01:00Z = 21:00 EDT on 07-01 — trip ran 15:00-16:40, shift end 17:05 local.
    const out = await claimSeat(repo, cap, seat.id, new Date("2026-07-02T01:00:00.000Z"));
    expect(out.code).toBeNull();
    const r = await tick(repo, new Date("2026-07-02T01:15:00.000Z"));
    expect(r.shiftsCompleted).toBe(1);
    expect(await types(cap)).toEqual(["self_claim", "shift_completed"]);
  });
});

describe("tagD P3 — an ask still live at departure is never swept, stays answerable, and can win completion credit", () => {
  it("silent for 4h across departure: no ask_ignored; a post-trip Yes then scores +2 +5", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await event("e1", "15:00");
    const cap = await crew("cap-1", CAPTAIN);
    await formAllVesselDaysForTest(repo);

    const r1 = await tick(repo, new Date("2026-07-01T18:00:00.000Z")); // 1h before departure
    expect(r1.asksFired).toBe(1);
    // 22:00Z: 4h after the ask (timeout default 120m), after shift end. No crew → no
    // completion; past-trip guard → no expireAsks.
    const r2 = await tick(repo, new Date("2026-07-01T22:00:00.000Z"));
    expect(r2.shiftsCompleted).toBe(0);
    expect(await types(cap)).toEqual(["ask_sent"]); // NO ask_ignored

    // The ask is still on the crew member's home screen after the trip ran.
    const view = await buildCrewAppView(repo, cap, new Date("2026-07-01T23:00:00.000Z"));
    expect(view!.asks).toHaveLength(1);
    const outcome = await recordResponseAndConfirm(
      repo,
      asId<"AskId">(view!.asks[0]!.askId),
      "accepted",
      new Date("2026-07-01T23:00:00.000Z"),
    );
    expect(outcome.claimed).toBe(true);
    const r3 = await tick(repo, new Date("2026-07-01T23:15:00.000Z"));
    expect(r3.shiftsCompleted).toBe(1);
    expect(await types(cap)).toEqual(["ask_sent", "ask_accepted", "shift_completed"]);
  });

  it("the phantom ask is still on the home screen a WEEK later, and a Yes then still scores +2 +5", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await event("e1", "15:00");
    const cap = await crew("cap-1", CAPTAIN);
    await formAllVesselDaysForTest(repo);
    await tick(repo, new Date("2026-07-01T18:00:00.000Z"));
    await tick(repo, new Date("2026-07-03T12:00:00.000Z")); // ticks keep running; nothing sweeps it

    const weekLater = new Date("2026-07-08T16:00:00.000Z");
    const view = await buildCrewAppView(repo, cap, weekLater);
    expect(view!.asks.map((a) => a.date)).toEqual(["2026-07-01"]);
    const outcome = await recordResponseAndConfirm(
      repo,
      asId<"AskId">(view!.asks[0]!.askId),
      "accepted",
      weekLater,
    );
    expect(outcome.claimed).toBe(true);
    await tick(repo, new Date(weekLater.getTime() + 15 * 60_000));
    expect((await repo.getShift(SHIFT))!.state).toBe("Completed");
    expect(await types(cap)).toEqual(["ask_sent", "ask_accepted", "shift_completed"]);
  });
});

describe("tagD P2 — cancel → restore turns asks hidden during the cancellation into ask_ignored", () => {
  it("asks fired, shift Cancelled 5 min later, restored 3h later → ask_ignored on the next tick", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await event("e1", "15:00");
    const a = await crew("cap-a", CAPTAIN);
    const b = await crew("cap-b", CAPTAIN);
    await formAllVesselDaysForTest(repo);
    const r1 = await tick(repo, AFTER); // urgent (inside fills-by) → blasts both
    expect(r1.asksFired).toBe(2);

    // Trip cancelled in Xola 5 minutes later; re-import cancels the shift.
    const t1 = new Date(AFTER.getTime() + 5 * 60_000);
    await event("e1", "15:00", "cancelled");
    await formAllVesselDaysForTest(repo, { now: t1 });
    expect((await repo.getShift(SHIFT))!.state).toBe("Cancelled");
    // While Cancelled, the crew app hides the ask — nobody can answer it.
    expect((await buildCrewAppView(repo, a, new Date(AFTER.getTime() + 10 * 60_000)))!.asks).toHaveLength(0);
    // Asks were NOT retired on cancel.
    const seat = (await repo.listSeatsForShift(SHIFT))[0]!;
    expect((await repo.listAsksForSeat(seat.id)).every((x) => x.respondedAt === undefined)).toBe(true);

    // Trip reinstated 3h later; re-import resurrects the shift (#244 path).
    const t2 = new Date(AFTER.getTime() + 3 * 3600_000);
    await event("e1", "15:00", "scheduled");
    await formAllVesselDaysForTest(repo, { now: t2 });
    expect((await repo.getShift(SHIFT))!.state).not.toBe("Cancelled");
    await tick(repo, t2);
    const ignored = async (id: CrewMemberId) =>
      (await types(id)).filter((x) => x === "ask_ignored").length;
    // −3 each for an ask that was hidden from them for 2h55m of its 3h life.
    expect(await ignored(a)).toBe(1);
    expect(await ignored(b)).toBe(1);
  });
});

describe("tagD P4 — post-completion correction cannot fix attribution; bail is refused", () => {
  it("vacate + override on a Completed shift: wrong person keeps +5, right person gets nothing", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await event("e1", "15:00");
    const wrong = await crew("cap-wrong", CAPTAIN);
    const right = await crew("cap-right", CAPTAIN);
    await formAllVesselDaysForTest(repo);
    const seat = (await repo.listSeatsForShift(SHIFT))[0]!;
    await manualOverride(repo, seat.id, wrong, AFTER);
    await tick(repo, DEPARTED);
    expect((await repo.getShift(SHIFT))!.state).toBe("Completed");

    // Operator: "Bailed" (the only penalty control) — refused, no event.
    const later = new Date(DEPARTED.getTime() + 3600_000);
    expect((await bailWithDerivedLateness(repo, seat.id, later, wrong)).code).toBe("shift_over");
    // Operator: "Remove" (no-penalty) — NOT refused on a Completed shift.
    await expect(vacateSeat(repo, seat.id, later, wrong)).resolves.toEqual({ removed: wrong });
    const placed = await overrideSeat(repo, seat.id, right, later);
    expect(placed.code).toBeNull();
    await tick(repo, new Date(later.getTime() + 15 * 60_000));

    expect((await repo.getShift(SHIFT))!.state).toBe("Completed");
    expect(await types(wrong)).toEqual(["shift_completed"]);
    expect(await types(right)).toEqual([]);
  });
});

describe("tagD P6 — concurrent double submit doubles response/bail events", () => {
  it("two concurrent declines on one ask log ask_declined twice", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await event("e1", "15:00");
    const a = await crew("cap-a", CAPTAIN);
    await formAllVesselDaysForTest(repo);
    await tick(repo, AFTER);
    const seat = (await repo.listSeatsForShift(SHIFT))[0]!;
    const ask = (await repo.listAsksForSeat(seat.id))[0]!;
    const t = AFTER.getTime() + 60_000;
    await Promise.all([
      recordResponse(repo, ask.id, "declined", new Date(t)),
      recordResponse(repo, ask.id, "declined", new Date(t + 1)),
    ]);
    expect((await types(a)).filter((x) => x === "ask_declined")).toHaveLength(2);
  });

  it("two concurrent accepts on one ask log ask_accepted twice", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await event("e1", "15:00");
    const a = await crew("cap-a", CAPTAIN);
    await formAllVesselDaysForTest(repo);
    await tick(repo, AFTER);
    const seat = (await repo.listSeatsForShift(SHIFT))[0]!;
    const ask = (await repo.listAsksForSeat(seat.id))[0]!;
    const t = AFTER.getTime() + 60_000;
    await Promise.all([
      recordResponseAndConfirm(repo, ask.id, "accepted", new Date(t)),
      recordResponseAndConfirm(repo, ask.id, "accepted", new Date(t + 1)),
    ]);
    expect((await types(a)).filter((x) => x === "ask_accepted")).toHaveLength(2);
  });

  it("two concurrent bails on one seat log shift_bailed twice", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await event("e1", "15:00");
    const a = await crew("cap-a", CAPTAIN);
    await formAllVesselDaysForTest(repo);
    const seat = (await repo.listSeatsForShift(SHIFT))[0]!;
    await manualOverride(repo, seat.id, a, AFTER);
    const t = AFTER.getTime() + 60_000;
    const outs = await Promise.all([
      bailWithDerivedLateness(repo, seat.id, new Date(t), a),
      bailWithDerivedLateness(repo, seat.id, new Date(t + 1), a),
    ]);
    expect(outs.map((o) => o.code)).toEqual([null, null]);
    expect((await types(a)).filter((x) => x === "shift_bailed")).toHaveLength(2);
  });
});

describe("tagD P9 — split→merge→split re-attaches orphaned side-B asks (deterministic -b seat ids)", () => {
  it("pre-merge side-B asks are swept as ask_ignored on the re-created seat", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await event("e1", "10:00");
    await event("e2", "17:00");
    const a = await crew("cap-a", CAPTAIN);
    const b = await crew("cap-b", CAPTAIN);
    await formAllVesselDaysForTest(repo);
    await splitShift(repo, SHIFT, "13:00", AFTER);
    const sideB = asId<"ShiftId">(`${SHIFT}-b`);
    await tick(repo, AFTER); // urgent → blasts both shifts' seats
    const bSeat = (await repo.listSeatsForShift(sideB))[0]!;
    const preMerge = await repo.listAsksForSeat(bSeat.id);
    expect(preMerge.length).toBeGreaterThan(0);

    await mergeShift(repo, SHIFT, new Date(AFTER.getTime() + 10 * 60_000));
    expect(await repo.getSeat(bSeat.id)).toBeNull(); // side-B seat deleted, asks orphaned
    await splitShift(repo, SHIFT, "13:00", new Date(AFTER.getTime() + 20 * 60_000));
    const reborn = (await repo.listSeatsForShift(sideB))[0]!;
    expect(reborn.id).toBe(bSeat.id); // same deterministic id
    expect((await repo.listAsksForSeat(reborn.id)).map((x) => x.id)).toEqual(preMerge.map((x) => x.id));

    // A new captain joins → the drip asks them → seat Asked → the next sweep after the
    // timeout also expires the ORPHANED pre-merge asks.
    await crew("cap-c", CAPTAIN);
    await tick(repo, new Date(AFTER.getTime() + 25 * 60_000));
    await tick(repo, new Date(AFTER.getTime() + 125 * 60_000));
    const ignoredOn = async (id: CrewMemberId) =>
      (await repo.reliabilityEventsFor(id)).filter(
        (e) => e.type === "ask_ignored" && e.metadata.seatId === reborn.id,
      ).length;
    const counts = { a: await ignoredOn(a), b: await ignoredOn(b) };
    console.log("tagD P9 ask_ignored on re-created side-B seat:", counts);
    expect(counts).toEqual({ a: 1, b: 1 });
  });
});
```

</details>

<details><summary><code>src/builder/resurrect-doublebook.tagB.audit-tmp.test.ts</code></summary>

```ts
/**
 * AUDIT PROBE (tagB) — a Cancelled shift's retained Confirmed seats are invisible to
 * the double-booking rule (`committedDatesByCrew` skips Cancelled), and resurrection
 * (`formOneShift`) brings them back live with no eligibility re-check. Asserts what the
 * code does today. Delete after the audit.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, ShiftId } from "../domain/ids.js";
import type { Event } from "../domain/entities.js";
import { seedFleet } from "../import/resource-map.js";
import { assignPerson, expireAsks, overrideSeat, recordResponseAndConfirm } from "../asks/ask-loop.js";
import { formAllVesselDaysForTest } from "./form-all-test-support.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const BREW2 = asId<"VesselId">("vessel-brew-2");
const BREW4 = asId<"VesselId">("vessel-brew-4");
const DATE = "2026-07-11";
const NOW = new Date("2026-07-01T16:00:00.000Z");

const ev = (id: string, vesselId: typeof BREW2, time: string, status: Event["status"] = "scheduled"): Event => ({
  id: asId<"EventId">(id),
  vesselId,
  date: DATE,
  time,
  capacity: 12,
  source: "xola",
  status,
});

async function crew(repo: InMemoryRepository, id: string, ratings: (typeof CAPTAIN)[]): Promise<CrewMemberId> {
  const c = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({ id: c, name: id, phone: "555", ratings, status: "active", reliabilityScore: null });
  await repo.saveCredential({ id: asId<"CredentialId">(`cred-${id}`), crewMemberId: c, type: "MMC", expiry: "2027-12-31" });
  return c;
}

describe("FINDING: an ask outstanding when its shift cancels stays live; on resurrection it is swept as ask_ignored", () => {
  it("ask out → trip cancels (ask hidden from the crew app, #415) → new booking revives the shift → the tick's sweep charges −3", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo);
    const x = await crew(repo, "cap-x", [CAPTAIN]);
    await repo.saveEvent(ev("t-brew2", BREW2, "15:30"));
    await formAllVesselDaysForTest(repo);
    const b2 = asId<"ShiftId">(`shift-${BREW2}-${DATE}`);
    const cap = (await repo.listSeatsForShift(b2)).find((s) => s.role === CAPTAIN)!;
    await assignPerson(repo, cap.id, x, NOW);

    await repo.saveEvent(ev("t-brew2", BREW2, "15:30", "cancelled"));
    await formAllVesselDaysForTest(repo);
    expect((await repo.getShift(b2))!.state).toBe("Cancelled");
    const ask = (await repo.listAsksForSeat(cap.id))[0]!;
    expect(ask.respondedAt).toBeUndefined(); // not retired by the cancel

    await repo.saveEvent(ev("t-brew2-new", BREW2, "18:00"));
    await formAllVesselDaysForTest(repo);
    expect((await repo.getShift(b2))!.state).not.toBe("Cancelled");
    expect((await repo.getSeat(cap.id))!.state).toBe("Asked");
    // What the tick does to every Asked seat of a live shift (tick.ts sweep).
    await expireAsks(repo, cap.id, new Date(NOW.getTime() + 3 * 3_600_000), 2 * 3_600_000);
    expect((await repo.reliabilityEventsFor(x)).map((e) => e.type)).toContain("ask_ignored");
  });
});

describe("FINDING: resurrection of a Cancelled shift double-books its retained crew", () => {
  it("captain X on Brew 2 → Brew 2's trip cancels → X takes Brew 4 same date → a new Brew 2 booking revives X's seat → X Confirmed on both boats, both Crewed", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo);
    const x = await crew(repo, "cap-x", [CAPTAIN, MATE]);
    const m2 = await crew(repo, "mate-2", [MATE]);
    const m4 = await crew(repo, "mate-4", [MATE]);
    await repo.saveEvent(ev("t-brew2", BREW2, "15:30"));
    await repo.saveEvent(ev("t-brew4", BREW4, "13:30"));
    await formAllVesselDaysForTest(repo);

    const b2 = asId<"ShiftId">(`shift-${BREW2}-${DATE}`);
    const b4 = asId<"ShiftId">(`shift-${BREW4}-${DATE}`);
    const seat = async (shift: ShiftId, role: typeof CAPTAIN) =>
      (await repo.listSeatsForShift(shift)).find((s) => s.role === role)!;

    // Brew 2 fully crewed: X captain, mate-2 mate.
    expect((await overrideSeat(repo, (await seat(b2, CAPTAIN)).id, x, NOW)).code).toBeNull();
    expect((await overrideSeat(repo, (await seat(b2, MATE)).id, m2, NOW)).code).toBeNull();
    expect((await repo.getShift(b2))!.state).toBe("Crewed");

    // Brew 2's only trip cancels → shift Cancelled, seats KEPT Confirmed (DEC-084).
    await repo.saveEvent(ev("t-brew2", BREW2, "15:30", "cancelled"));
    await formAllVesselDaysForTest(repo);
    expect((await repo.getShift(b2))!.state).toBe("Cancelled");
    expect((await seat(b2, CAPTAIN)).assignedCrewMemberId).toBe(x);

    // X is now asked for Brew 4's captain seat the same date and says "in" — the
    // double-book check ignores the Cancelled husk, so it is allowed (correctly, for now).
    const ask = await assignPerson(repo, (await seat(b4, CAPTAIN)).id, x, NOW);
    const out = await recordResponseAndConfirm(repo, ask!.id, "accepted", NOW);
    expect(out.seatState).toBe("Confirmed");
    expect((await overrideSeat(repo, (await seat(b4, MATE)).id, m4, NOW)).code).toBeNull();
    expect((await repo.getShift(b4))!.state).toBe("Crewed");

    // A NEW booking lands on Brew 2 the same day → same deterministic shift id → resurrected.
    await repo.saveEvent(ev("t-brew2-new", BREW2, "18:00"));
    const r = await formAllVesselDaysForTest(repo);
    expect(r.restoredCrew.map((c) => c.crewMemberId)).toContain(x); // "you're on" notice queued

    expect((await repo.getShift(b2))!.state).toBe("Crewed");
    expect((await repo.getShift(b4))!.state).toBe("Crewed");
    expect((await seat(b2, CAPTAIN)).assignedCrewMemberId).toBe(x);
    expect((await seat(b4, CAPTAIN)).assignedCrewMemberId).toBe(x);
  });
});
```

</details>

<details><summary><code>src/builder/tick.tagA.audit-tmp.test.ts</code></summary>

```ts
/**
 * AUDIT PROBE (tagA) — shift/seat state machine, horizons and the tick.
 * Read-only audit; each `it` demonstrates a finding by asserting the CURRENT
 * behaviour (so a passing test = the finding reproduces).
 *
 * World: America/New_York (test default TENANT_TZ unset). Trip 2026-07-10 15:00
 * local = 19:00Z. Horizon (7d) = 2026-07-03T19:00Z. Fill deadline (48h) =
 * 2026-07-08T19:00Z. T0 = 2026-07-05T14:00Z is in-horizon, pre-deadline (drip).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, RoleTypeId, SeatId, VesselId } from "../domain/ids.js";
import type { Ask, ReliabilityEvent } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";
import { tick } from "./tick.js";
import { reformWindow } from "./form-shifts.js";
import { formAllVesselDaysForTest } from "./form-all-test-support.js";
import { deriveAtRiskBoard } from "../admin/at-risk-board.js";
import { solveShift } from "../oracle/oracle.js";
import { recordResponseAndConfirm } from "../asks/ask-loop.js";
import { SYSTEM_ACTOR_ID } from "../oracle/reliability-log.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VESSEL = asId<"VesselId">("vessel-a");
const DATE = "2026-07-10";
const SHIFT = asId<"ShiftId">(`shift-${VESSEL}-${DATE}`);
const T0 = new Date("2026-07-05T14:00:00.000Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const INSIDE_DEADLINE = new Date("2026-07-08T20:00:00.000Z"); // 47h before trip
const AFTER_END = new Date("2026-07-11T00:00:00.000Z"); // past 21:05Z shift end

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function vessel(manning: { roleTypeId: RoleTypeId; count: number }[], id: VesselId = VESSEL, date = DATE, time = "15:00") {
  await repo.saveVessel({ id, name: String(id), coiMaxPax: 6, manning });
  await repo.saveEvent({
    id: asId<"EventId">(`ev-${id}-${date}`),
    vesselId: id,
    date,
    time,
    capacity: 6,
    source: "xola",
    status: "scheduled",
  });
}

async function crew(id: string, ratings: RoleTypeId[]): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({ id: crewId, name: id, phone: "555", ratings, status: "active", reliabilityScore: null });
  await repo.saveCredential({ id: asId<"CredentialId">(`cred-${id}`), crewMemberId: crewId, type: "MMC", expiry: "2027-12-31" });
  return crewId;
}

const seats = () => repo.listSeatsForShift(SHIFT);
const stored = async () => (await repo.getShift(SHIFT))!.state;
const asksFor = async (seatId: SeatId) => repo.listAsksForSeat(seatId);

// ── F1: one seat's empty pool → whole shift AtRisk → Tier-1 stops on a fillable sibling ──
describe("F1 AtRisk (one seat exhausted) suppresses all Tier-1 on the shift", () => {
  it("captain+mate boat, captains exist but no mates: the captain seat is never auto-asked", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }, { roleTypeId: MATE, count: 1 }]);
    await crew("cap-1", [CAPTAIN]);
    await crew("cap-2", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);

    const r = await tick(repo, T0);
    const s = await seats();
    const captainSeat = s.find((x) => x.role === CAPTAIN)!;
    console.log("F1a", { state: await stored(), asksFired: r.asksFired, captainSeat: captainSeat.state });
    expect(await stored()).toBe("AtRisk");
    expect(r.asksFired).toBe(0);
    expect(captainSeat.state).toBe("Open");
    expect(await asksFor(captainSeat.id)).toHaveLength(0);
  });

  it("greedy solve misses a valid assignment when manning lists mate first → fillable shift reads AtRisk, nobody asked", async () => {
    // alice [captain, mate], carol [mate]. Valid: carol→mate, alice→captain, both askable.
    await vessel([{ roleTypeId: MATE, count: 1 }, { roleTypeId: CAPTAIN, count: 1 }]);
    await crew("a-alice", [CAPTAIN, MATE]);
    await crew("c-carol", [MATE]);
    await formAllVesselDaysForTest(repo);

    const sol = await solveShift(repo, SHIFT, T0);
    const r = await tick(repo, T0);
    console.log("F1b", { satisfiable: sol.satisfiable, pools: sol.pools.map((p) => [p.role, p.eligible]), state: await stored(), asksFired: r.asksFired });
    expect(sol.satisfiable).toBe(false);
    expect(await stored()).toBe("AtRisk");
    expect(r.asksFired).toBe(0);
    const board = await deriveAtRiskBoard(repo, T0);
    console.log("F1b board", board.map((b) => ({ reasons: b.reasons, exhausted: b.trail.exhausted, available: b.available })));
  });

  it("control: same crew, captain-first manning → Filling and both seats asked", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }, { roleTypeId: MATE, count: 1 }]);
    await crew("a-alice", [CAPTAIN, MATE]);
    await crew("c-carol", [MATE]);
    await formAllVesselDaysForTest(repo);
    const r = await tick(repo, T0);
    console.log("F1c", { state: await stored(), asksFired: r.asksFired });
    expect(await stored()).toBe("Filling");
    expect(r.asksFired).toBe(2);
  });

  it("solve does not pin Confirmed occupants: captain overridden into the mate seat (DEC-064 hack) → captain seat never asked", async () => {
    const { overrideSeat } = await import("../asks/ask-loop.js");
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }, { roleTypeId: MATE, count: 1 }]);
    const alice = await crew("a-alice", [CAPTAIN, MATE]);
    await crew("b-bob", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    const mateSeat = (await seats()).find((s) => s.role === MATE)!;
    expect((await overrideSeat(repo, mateSeat.id, alice, T0)).code).toBeNull();
    const sol = await solveShift(repo, SHIFT, T0);
    const r = await tick(repo, min(1));
    const capSeat = (await seats()).find((s) => s.role === CAPTAIN)!;
    console.log("F1e", { satisfiable: sol.satisfiable, state: await stored(), asksFired: r.asksFired, captainSeat: capSeat.state });
    expect(sol.satisfiable).toBe(false);
    expect(await stored()).toBe("AtRisk");
    expect(r.asksFired).toBe(0); // b-bob, free and askable, is never asked
  });

  it("reformWindow rewrites AtRisk→Filling every run; the tick re-flips it and counts toAtRisk again each time", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }, { roleTypeId: MATE, count: 1 }]);
    await crew("cap-1", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    const counts: number[] = [];
    const afterReform: string[] = [];
    for (let i = 0; i < 3; i++) {
      await reformWindow(repo, min(15 * i));
      afterReform.push(await stored());
      counts.push((await tick(repo, min(15 * i))).toAtRisk);
    }
    console.log("F1d", { afterReform, toAtRiskPerTick: counts });
    expect(afterReform[1]).toBe("Filling");
    expect(counts).toEqual([1, 1, 1]);
  });
});

// ── F2: a seat stranded in Claimed is never worked, never boarded, never completed ──
describe("F2 stranded Claimed seat", () => {
  it("a failure after the CAS leaves Claimed; tick skips it, board omits it, completion skips it", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    const cap1 = await crew("cap-1", [CAPTAIN]);
    await crew("cap-2", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    await tick(repo, T0); // asks cap-1
    await tick(repo, min(16)); // widens cap-2
    const seat = (await seats())[0]!;
    const asks = await asksFor(seat.id);
    expect(asks).toHaveLength(2);
    const cap1Ask = asks.find((a) => a.crewMemberId === cap1)!;

    // Proxy: the withdrawal write for cap-2's losing ask fails once (a DB blip).
    let blown = false;
    const flaky = new Proxy(repo, {
      get(target, prop, recv) {
        if (prop === "saveAsk") {
          return async (a: Ask) => {
            if (!blown && a.response === "withdrawn") {
              blown = true;
              throw new Error("simulated blip");
            }
            return target.saveAsk(a);
          };
        }
        const v = Reflect.get(target, prop, recv);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Repository;
    await expect(recordResponseAndConfirm(flaky, cap1Ask.id, "accepted", min(20))).rejects.toThrow("simulated blip");
    // The crew member re-taps "Yes" after seeing the error notice:
    const retap = await recordResponseAndConfirm(repo, cap1Ask.id, "accepted", min(21));
    const afterRetap = (await seats())[0]!;
    console.log("F2 retap", retap, afterRetap.state, afterRetap.assignedCrewMemberId);
    expect(retap.reason).toBe("already_answered");
    expect(afterRetap.state).toBe("Claimed");

    const r = await tick(repo, INSIDE_DEADLINE);
    const board = await deriveAtRiskBoard(repo, INSIDE_DEADLINE);
    console.log("F2 tick inside deadline", { asksFired: r.asksFired, state: await stored(), boardRows: board.length });
    expect(r.asksFired).toBe(0);
    expect(await stored()).toBe("Filling");
    expect(board.find((b) => b.shiftId === SHIFT)).toBeUndefined();

    const done = await tick(repo, AFTER_END);
    console.log("F2 after end", { shiftsCompleted: done.shiftsCompleted, state: await stored() });
    expect(done.shiftsCompleted).toBe(0);
    expect(await stored()).toBe("Filling"); // never Crewed, never Completed, never boarded
  });
});

// ── F3: in-tick reopen writes "Pending" over the stored badge; escalate (gated on stored state) skips ──
describe("F3 stored-state gate in escalate", () => {
  it("the tick that reopens a ghosted seat leaves stored Pending and skips Tier-2; next tick re-'births' it", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await crew("cap-1", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    const o = { silentTimeoutMinutes: 60 };
    const r0 = await tick(repo, T0, o);
    expect(r0.asksFired).toBe(1);
    expect(await stored()).toBe("Filling");

    const r1 = await tick(repo, min(61), o); // cap-1's ask expires in-tick → seat Open
    console.log("F3 tick+61", { stored: await stored(), shiftsEscalated: r1.shiftsEscalated, nudges: r1.nudgesFired, seat: (await seats())[0]!.state });
    expect(await stored()).toBe("Pending"); // in-horizon shift persisted as Pending
    expect(r1.shiftsEscalated).toBe(0);
    expect(r1.nudgesFired).toBe(0);

    const r2 = await tick(repo, min(76), o);
    console.log("F3 tick+76", { bornFilling: r2.bornFilling, nudges: r2.nudgesFired });
    expect(r2.bornFilling).toBe(1); // counted as a second "birth"
    expect(r2.nudgesFired).toBe(1);
  });
});

// ── F4 / F5: escalate goes dry → pool_widened every tick; shift silent until the fill deadline ──
describe("F4/F5 escalate dry", () => {
  it("logs pool_widened every tick forever and stays off the board until the fill deadline", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await crew("cap-1", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    const o = { silentTimeoutMinutes: 60 };
    await tick(repo, T0, o);
    const seatId = (await seats())[0]!.id;
    const first = (await asksFor(seatId))[0]!;
    await recordResponseAndConfirm(repo, first.id, "declined", min(5)); // seat Open, stored Pending
    await tick(repo, min(15), o); // re-births Filling, escalate: cap-1 declined → nobody to nudge
    const widenedCounts: number[] = [];
    for (let i = 2; i <= 6; i++) {
      await tick(repo, min(15 * i), o);
      const n = (await repo.reliabilityEventsFor(SYSTEM_ACTOR_ID)).filter(
        (e: ReliabilityEvent) => e.type === "pool_widened" && e.metadata.shiftId === SHIFT,
      ).length;
      widenedCounts.push(n);
    }
    console.log("F4 pool_widened cumulative per tick", widenedCounts);
    expect(widenedCounts[4]! - widenedCounts[0]!).toBe(4);

    // F5: nobody left to ask, no live ask, ~5 days out → not on the board, state Filling.
    const live = (await asksFor(seatId)).filter((a) => a.respondedAt === undefined);
    const boardEarly = await deriveAtRiskBoard(repo, min(120));
    const boardLate = await deriveAtRiskBoard(repo, INSIDE_DEADLINE);
    console.log("F5", { live: live.length, stored: await stored(), early: boardEarly.length, late: boardLate.map((b) => b.reasons) });
    expect(live).toHaveLength(0);
    expect(boardEarly).toHaveLength(0);
    expect(boardLate).toHaveLength(1);
  });
});

// ── F6: two ticks overlapping (no run lock) ──
describe("F6 concurrent ticks", () => {
  it("two overlapping ticks each fire a drip ask in the same interval", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    const c1 = await crew("cap-1", [CAPTAIN]);
    await crew("cap-2", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    const [a, b] = await Promise.all([tick(repo, T0), tick(repo, new Date(T0.getTime() + 1))]);
    const all = await asksFor((await seats())[0]!.id);
    const sentToCap1 = (await repo.reliabilityEventsFor(c1)).filter((e) => e.type === "ask_sent").length;
    console.log("F6 two-candidate", { a: a.asksFired, b: b.asksFired, asks: all.map((x) => [x.crewMemberId, x.sentAt]), sentToCap1 });
    expect(a.asksFired + b.asksFired).toBeGreaterThan(1);
  });

  it("one candidate: overlapping ticks ask the same person twice for the same seat", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    const c1 = await crew("cap-1", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    await Promise.all([tick(repo, T0), tick(repo, new Date(T0.getTime() + 1))]);
    const all = await asksFor((await seats())[0]!.id);
    const sent = (await repo.reliabilityEventsFor(c1)).filter((e) => e.type === "ask_sent").length;
    console.log("F6 one-candidate", { asks: all.map((x) => [x.crewMemberId, x.sentAt]), ask_sent: sent });
    expect(all.filter((x) => x.crewMemberId === c1)).toHaveLength(2);
    expect(sent).toBe(2);
    // 2h later both duplicate asks expire in ONE sweep → two ask_ignored with the SAME id.
    // In-memory pushes both; Postgres' plain INSERT (postgres-repository.ts:2380-2385) would
    // throw a pkey violation mid-tick.
    await tick(repo, min(121));
    const ignored = (await repo.reliabilityEventsFor(c1)).filter((e) => e.type === "ask_ignored");
    console.log("F6 dup ask_ignored ids", ignored.map((e) => e.id));
    expect(ignored).toHaveLength(2);
    expect(ignored[0]!.id).toBe(ignored[1]!.id);
  });
});

describe("F6b concurrent ticks — completion and board landing", () => {
  it("overlapping ticks double shift_completed and double board_landed", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    const c1 = await crew("cap-1", [CAPTAIN]);
    // a second, uncrewable shift (mate-only boat, no mates) to land on the board
    const VB = asId<"VesselId">("vessel-b");
    await vessel([{ roleTypeId: MATE, count: 1 }], VB, "2026-07-12");
    await formAllVesselDaysForTest(repo);
    await tick(repo, T0);
    const ask = (await asksFor((await seats())[0]!.id))[0]!;
    await recordResponseAndConfirm(repo, ask.id, "accepted", min(5));
    // wipe the landing the first tick recorded so the overlap is the first to see it
    const sys = asId<"CrewMemberId">(String(SYSTEM_ACTOR_ID));
    void sys;
    await Promise.all([tick(repo, AFTER_END), tick(repo, new Date(AFTER_END.getTime() + 1))]);
    const completed = (await repo.reliabilityEventsFor(c1)).filter((e) => e.type === "shift_completed").length;
    console.log("F6b", { shift_completed_for_cap1: completed, state: await stored() });
    expect(completed).toBe(2);
  });

  it("overlapping ticks record the same board landing twice (two admin SMS)", async () => {
    const VB = asId<"VesselId">("vessel-b");
    await vessel([{ roleTypeId: MATE, count: 1 }], VB);
    await formAllVesselDaysForTest(repo);
    const [a, b] = await Promise.all([tick(repo, T0), tick(repo, new Date(T0.getTime() + 1))]);
    const landed = (await repo.reliabilityEventsFor(SYSTEM_ACTOR_ID)).filter((e) => e.type === "board_landed").length;
    console.log("F6c", { aLandings: a.boardLandings, bLandings: b.boardLandings, landed });
    expect(a.boardLandings.length + b.boardLandings.length).toBe(2);
  });
});

// ── F7: tick throws mid-loop → earlier shifts' asks are durable but never returned for relay ──
describe("F7 tick throws halfway", () => {
  it("shift A is asked in the DB, tick throws on shift B, A's ask is lost from firedAsks and later charged ask_ignored", async () => {
    const VB = asId<"VesselId">("vessel-b");
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }], VB);
    const c1 = await crew("cap-1", [CAPTAIN]);
    await crew("cap-2", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    const SHIFT_B = asId<"ShiftId">(`shift-${VB}-${DATE}`);
    let saved = 0;
    const flaky = new Proxy(repo, {
      get(target, prop, recv) {
        if (prop === "saveShift") {
          return async (s: { id: unknown }) => {
            if (s.id === SHIFT_B) throw new Error("simulated blip on shift B");
            saved++;
            return target.saveShift(s as never);
          };
        }
        const v = Reflect.get(target, prop, recv);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Repository;
    await expect(tick(flaky, T0)).rejects.toThrow("shift B");
    const aAsks = await asksFor((await seats())[0]!.id);
    console.log("F7", { savedShifts: saved, shiftAAsks: aAsks.map((x) => x.crewMemberId) });
    expect(aAsks).toHaveLength(1); // persisted, but the route's relayAsks never saw it

    // The ask was never texted; 2h later the next healthy tick charges it as silence.
    await tick(repo, min(121));
    const asked = aAsks[0]!.crewMemberId;
    const ignored = (await repo.reliabilityEventsFor(asked)).filter((e) => e.type === "ask_ignored");
    console.log("F7 ignored", asked, ignored.length, c1);
    expect(ignored).toHaveLength(1);
  });
});

// ── F8: a non-terminal shift with no scheduled trip is still dripped ──
describe("F8 null-anchor shift", () => {
  it("event cancelled but shift not re-formed: past-trip guard is bypassed and the drip keeps asking", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await crew("cap-1", [CAPTAIN]);
    await crew("cap-2", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    await tick(repo, T0); // asks cap-1, seat Asked
    const ev = (await repo.listEvents())[0]!;
    await repo.saveEvent({ ...ev, status: "cancelled" });
    const r = await tick(repo, min(16));
    console.log("F8", { asksFired: r.asksFired, stored: await stored() });
    expect(r.asksFired).toBe(1);
  });
});

// ── F10: Crewed is a seat-fold only — PTO / archive after confirmation leaves it Crewed and off the board ──
describe("F10 Crewed does not re-check eligibility", () => {
  it("confirmed captain then takes PTO for the date (or is archived): shift still resolves Crewed, no board row", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    const c1 = await crew("cap-1", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    await tick(repo, T0);
    const ask = (await asksFor((await seats())[0]!.id))[0]!;
    await recordResponseAndConfirm(repo, ask.id, "accepted", min(5));
    expect(await stored()).toBe("Crewed");
    await repo.savePtoWindow({ id: asId<"PtoWindowId">("pto-1"), crewMemberId: c1, start: DATE, end: DATE });
    const r = await tick(repo, INSIDE_DEADLINE);
    const board = await deriveAtRiskBoard(repo, INSIDE_DEADLINE);
    console.log("F10 pto", { stored: await stored(), asksFired: r.asksFired, board: board.length });
    expect(await stored()).toBe("Crewed");
    expect(board).toHaveLength(0);
    const me = (await repo.getCrewMember(c1))!;
    await repo.saveCrewMember({ ...me, status: "archived" });
    const board2 = await deriveAtRiskBoard(repo, INSIDE_DEADLINE);
    console.log("F10 archived", { stored: await stored(), board: board2.length });
    expect(board2).toHaveLength(0);
  });
});

// ── F11: the tick's re-crew does not exclude the bailer ──
describe("F11 bailer re-asked by the tick", () => {
  it("accept-path bail: the drip skips the bailer but Tier-2 nudges them; self-claim bail: the drip asks them directly", async () => {
    const { bailWithDerivedLateness } = await import("../asks/ask-loop.js");
    const { claimSeat, releaseSelfClaim } = await import("../asks/claim.js");
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    const c1 = await crew("cap-1", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    await tick(repo, T0);
    const seatId = (await seats())[0]!.id;
    const ask = (await asksFor(seatId))[0]!;
    await recordResponseAndConfirm(repo, ask.id, "accepted", min(5));
    expect((await bailWithDerivedLateness(repo, seatId, min(10), c1)).code).toBeNull();
    const r = await tick(repo, min(30));
    console.log("F11 accept-path", { asksFired: r.asksFired, nudged: r.nudgesFired, to: r.firedAsks.map((a) => a.crewMemberId) });
    expect(r.firedAsks.map((a) => a.crewMemberId)).toContain(c1);

    // Self-claim door on a fresh world.
    repo = new InMemoryRepository();
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    const c2 = await crew("cap-1", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    const s2 = (await seats())[0]!.id;
    expect((await claimSeat(repo, c2, s2, T0)).code).toBeNull();
    expect((await releaseSelfClaim(repo, c2, s2, min(5))).code).toBeNull();
    const r2 = await tick(repo, min(10));
    const board = await deriveAtRiskBoard(repo, INSIDE_DEADLINE);
    console.log("F11 self-claim", { to: r2.firedAsks.map((a) => a.crewMemberId), boardAvailable: board.map((b) => b.available) });
    expect(r2.firedAsks.map((a) => a.crewMemberId)).toContain(c2);
  });
});

// ── F12: a late bail no longer carries the regression flag (DEC-128) ──
describe("F12 late bail → no regression row", () => {
  it("a confirmed captain bails 10h before the trip with others available: resolved Filling, board reason 'core' only", async () => {
    const { bailWithDerivedLateness } = await import("../asks/ask-loop.js");
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    const c1 = await crew("cap-1", [CAPTAIN]);
    await crew("cap-2", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    await tick(repo, T0);
    const seatId = (await seats())[0]!.id;
    const ask = (await asksFor(seatId)).find((a) => a.crewMemberId === c1)!;
    await recordResponseAndConfirm(repo, ask.id, "accepted", min(5));
    const late = new Date("2026-07-10T09:00:00.000Z"); // 10h before departure
    await bailWithDerivedLateness(repo, seatId, late, c1);
    const board = await deriveAtRiskBoard(repo, late);
    console.log("F12", { stored: await stored(), rows: board.map((b) => ({ resolved: b.resolvedState, reasons: b.reasons })) });
    expect(board[0]!.reasons).toEqual(["core"]);
    expect(board[0]!.resolvedState).toBe("Filling");
  });
});

// ── F13: multi-trip day — after the FIRST departure the shift is neither worked nor boarded ──
describe("F13 multi-trip day after first departure", () => {
  it("13:00 + 17:00 trips; the captain bails at 14:30 → no ask, no board row, never completed", async () => {
    const { bailWithDerivedLateness } = await import("../asks/ask-loop.js");
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }], VESSEL, DATE, "13:00");
    await repo.saveEvent({ id: asId<"EventId">("ev-late"), vesselId: VESSEL, date: DATE, time: "17:00", capacity: 6, source: "xola", status: "scheduled" });
    const c1 = await crew("cap-1", [CAPTAIN]);
    await crew("cap-2", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    await tick(repo, T0);
    const seatId = (await seats())[0]!.id;
    const ask = (await asksFor(seatId)).find((a) => a.crewMemberId === c1)!;
    await recordResponseAndConfirm(repo, ask.id, "accepted", min(5));
    expect(await stored()).toBe("Crewed");
    const midday = new Date("2026-07-10T18:30:00.000Z"); // 14:30 local: 13:00 trip gone, 17:00 trip ahead
    expect((await bailWithDerivedLateness(repo, seatId, midday, c1)).code).toBeNull();
    const r = await tick(repo, new Date("2026-07-10T18:45:00.000Z"));
    const board = await deriveAtRiskBoard(repo, new Date("2026-07-10T18:45:00.000Z"));
    console.log("F13", { stored: await stored(), asksFired: r.asksFired, boardRows: board.length, seat: (await seats())[0]!.state });
    expect(r.asksFired).toBe(0);
    expect(board).toHaveLength(0);
    const end = await tick(repo, new Date("2026-07-10T23:30:00.000Z")); // past 21:00Z+100+25
    console.log("F13 end", { completed: end.shiftsCompleted, stored: await stored() });
    expect(end.shiftsCompleted).toBe(0);
  });
});

// ── F9: [fill deadline, horizon) gap — route (b) needs Filling ──
describe("F9 inside the fill deadline but before the horizon", () => {
  it("lead 1.5d < deadline 48h: at 40h out an uncrewed shift is Pending, unworked and off the board", async () => {
    await vessel([{ roleTypeId: CAPTAIN, count: 1 }]);
    await crew("cap-1", [CAPTAIN]);
    await formAllVesselDaysForTest(repo);
    const at40h = new Date("2026-07-09T03:00:00.000Z");
    const r = await tick(repo, at40h, { leadDays: 1.5 });
    const board = await deriveAtRiskBoard(repo, at40h, { leadDays: 1.5, deadlineHours: 48 });
    console.log("F9", { stored: await stored(), asksFired: r.asksFired, board: board.length });
    expect(r.asksFired).toBe(0);
    expect(board).toHaveLength(0);
  });
});
```

</details>

<details><summary><code>src/builder/tick.tagC.audit-tmp.test.ts</code></summary>

```ts
/**
 * AUDIT PROBES (tagC) — who is asked, in what order, and when. Read-only audit;
 * the lead re-runs and deletes this file. Each `it` demonstrates one finding or
 * pins one match. Default tenant tz (America/New_York).
 *
 * Clock frame: trip 2026-07-01 15:00 EDT = 19:00Z.
 *   staffing horizon (−7d)  = 2026-06-24T19:00Z
 *   fills-by (−48h)         = 2026-06-29T19:00Z
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, RoleTypeId, SeatId, ShiftId, VesselId } from "../domain/ids.js";
import type { CrewMember, ManningRequirement } from "../domain/entities.js";
import type { ReliabilityEvent } from "../domain/reliability.js";
import { tick } from "./tick.js";
import { formAllVesselDaysForTest } from "./form-all-test-support.js";
import { splitShift } from "./split.js";
import { mergeShift } from "./merge.js";
import {
  bailWithDerivedLateness,
  manualOverride,
  recordResponseAndConfirm,
  widenAsk,
} from "../asks/ask-loop.js";
import { claimSeat, releaseSelfClaim } from "../asks/claim.js";
import { lean } from "../asks/lean.js";
import { escalationTrailFor } from "../asks/escalation-trail.js";
import { recordReliabilityEvent, SYSTEM_ACTOR_ID } from "../oracle/reliability-log.js";
import { buildCrewAppView } from "../crewapp/crew-view.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const DATE = "2026-07-01";
const at = (iso: string) => new Date(iso);
const DRIP_T = at("2026-06-25T16:00:00.000Z"); // in-horizon, before fills-by, 12:00 ET
const URGENT_T = at("2026-06-30T14:00:00.000Z"); // inside fills-by, 10:00 ET
const plusMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function vessel(id: string, manning: ManningRequirement[], times: string[] = ["15:00"]) {
  const vid = asId<"VesselId">(id);
  await repo.saveVessel({ id: vid, name: id, coiMaxPax: 16, manning });
  for (const t of times) {
    await repo.saveEvent({
      id: asId<"EventId">(`ev-${id}-${t}`),
      vesselId: vid,
      date: DATE,
      time: t,
      capacity: 16,
      source: "xola",
      status: "scheduled",
    });
  }
  return vid;
}
const shiftOf = (v: VesselId) => asId<"ShiftId">(`shift-${v}-${DATE}`);
const seatsOf = (s: ShiftId) => repo.listSeatsForShift(s);

async function crew(id: string, ratings: RoleTypeId[], over: Partial<CrewMember> = {}) {
  const cid = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: cid,
    name: id,
    phone: "555",
    ratings,
    status: "active",
    reliabilityScore: null,
    ...over,
  });
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: cid,
    type: "MMC",
    expiry: "2026-12-31",
  });
  return cid;
}
const askedIds = async (seatId: SeatId) =>
  (await repo.listAsksForSeat(seatId))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    .map((a) => String(a.crewMemberId));
const events = (c: CrewMemberId) => repo.reliabilityEventsFor(c);

// ───────────────────────────────────────────────────────────────────────────────
describe("tagC F1 — this shift's bailer is re-asked by the engine (DEC-019 / SPEC §2.4)", () => {
  it("drip: a self-claim releaser is asked again for the seat they bailed (lean refuses the same person)", async () => {
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 1 }]);
    const alice = await crew("alice", [MATE]);
    await crew("bob", [MATE]);
    await formAllVesselDaysForTest(repo);
    const seat = (await seatsOf(shiftOf(v)))[0]!;

    expect((await claimSeat(repo, alice, seat.id, at("2026-06-20T16:00:00.000Z"))).code).toBeNull();
    expect((await releaseSelfClaim(repo, alice, seat.id, DRIP_T)).code).toBeNull(); // bail, in-horizon

    await tick(repo, plusMin(DRIP_T, 5)); // seeds top-ranked (bob, 0 > alice −0.05)
    // The operator's own door refuses alice as a bailer of this shift:
    const leaned = await lean(repo, shiftOf(v), alice, plusMin(DRIP_T, 6));
    expect(leaned.code).toBe("bailed");
    await tick(repo, plusMin(DRIP_T, 20)); // drip widens by one → the bailer
    expect(await askedIds(seat.id)).toEqual(["bob", "alice"]);
  });

  it("pre-horizon release: at the horizon the releaser is the FIRST person texted for that seat (+4 claim −3 bail = +1 > cold 0)", async () => {
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 1 }]);
    const alice = await crew("alice", [MATE]);
    await crew("bob", [MATE]);
    await formAllVesselDaysForTest(repo);
    const seat = (await seatsOf(shiftOf(v)))[0]!;
    expect((await claimSeat(repo, alice, seat.id, at("2026-06-10T16:00:00.000Z"))).code).toBeNull();
    expect((await releaseSelfClaim(repo, alice, seat.id, at("2026-06-20T16:00:00.000Z"))).code).toBeNull(); // 11 days out
    expect((await repo.getShift(shiftOf(v)))!.state).toBe("Pending"); // DEC-128: silent pre-horizon ✓
    const r = await tick(repo, at("2026-06-24T19:15:00.000Z")); // horizon crossed
    expect(r.firedAsks.map((a) => String(a.crewMemberId))).toEqual(["alice"]);
  });

  it("urgent blast: a bail inside fills-by re-asks the bailer in the very next tick", async () => {
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 1 }]);
    const alice = await crew("alice", [MATE]);
    await crew("bob", [MATE]);
    await formAllVesselDaysForTest(repo);
    const seat = (await seatsOf(shiftOf(v)))[0]!;
    expect((await claimSeat(repo, alice, seat.id, at("2026-06-20T16:00:00.000Z"))).code).toBeNull();
    expect((await releaseSelfClaim(repo, alice, seat.id, URGENT_T)).code).toBeNull();

    const r = await tick(repo, plusMin(URGENT_T, 5));
    expect(r.firedAsks.map((a) => String(a.crewMemberId)).sort()).toEqual(["alice", "bob"]);
  });

  it("Tier-2: escalate nudges an accepted-then-bailed crew member (their 'accepted' ask is not an exclusion)", async () => {
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 1 }]);
    const alice = await crew("alice", [MATE]);
    await crew("bob", [MATE]);
    await formAllVesselDaysForTest(repo);
    const seat = (await seatsOf(shiftOf(v)))[0]!;

    await tick(repo, DRIP_T); // seeds alice (id tie-break)
    const aliceAsk = (await repo.listAsksForSeat(seat.id))[0]!;
    expect(String(aliceAsk.crewMemberId)).toBe("alice");
    expect((await recordResponseAndConfirm(repo, aliceAsk.id, "accepted", plusMin(DRIP_T, 1))).seatState).toBe("Confirmed");
    expect((await bailWithDerivedLateness(repo, seat.id, plusMin(DRIP_T, 60), alice)).code).toBeNull();

    await tick(repo, plusMin(DRIP_T, 65)); // drip → bob (alice's accepted ask keeps her out of the DRIP)
    // bob ghosts → the in-tick sweep reopens the seat … but see F9: escalate is refused THIS tick.
    const r0 = await tick(repo, plusMin(DRIP_T, 65 + 125));
    expect(r0.shiftsEscalated).toBe(0);
    const r = await tick(repo, plusMin(DRIP_T, 65 + 140)); // next tick: Tier-2 fires
    expect(r.shiftsEscalated).toBe(1);
    expect(r.firedAsks.map((a) => String(a.crewMemberId))).toEqual(["alice"]); // the bailer is nudged
    expect((await lean(repo, shiftOf(v), alice, plusMin(DRIP_T, 210))).code).not.toBe(null);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("tagC F9 — an in-tick timeout reopen persists `Pending` and refuses Tier-2 that tick (DEC-067 says 'this tick, not next')", () => {
  it("expireAsks' raw seat-fold writes Pending; tick's stale `shift.state` skips the correction; escalate sees Pending", async () => {
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 1 }]);
    await crew("alice", [MATE]);
    await formAllVesselDaysForTest(repo);
    await tick(repo, DRIP_T); // alice asked; only candidate
    const r1 = await tick(repo, plusMin(DRIP_T, 125)); // alice ghosts → seat Open, pool walked
    expect(r1.shiftsEscalated).toBe(0); // refused: persisted state is Pending
    expect((await repo.getShift(shiftOf(v)))!.state).toBe("Pending"); // in-horizon shift badged Pending
    const r2 = await tick(repo, plusMin(DRIP_T, 140));
    expect(r2.bornFilling).toBe(1); // spurious "born" a second time
    expect(r2.shiftsEscalated).toBe(1); // Tier-2 one tick late
    expect(r2.nudgesFired).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("tagC F2 — a double_booked accept strands the seat `Asked` with no live ask", () => {
  it("no ask, no Tier-2, not on the board for ~4 days while a nudgeable ghoster exists", async () => {
    const v2 = await vessel("v2", [{ roleTypeId: MATE, count: 1 }]);
    await crew("alice", [MATE]);
    const bob = await crew("bob", [MATE]);
    await formAllVesselDaysForTest(repo);
    // Boat 1: same date, no events (stays Pending, never dripped) — a place to commit bob.
    const b1Shift = asId<"ShiftId">("shift-boat1");
    await repo.saveShift({ id: b1Shift, vesselId: asId<"VesselId">("v1"), date: DATE, state: "Pending", eventIds: [] });
    const b1Seat = asId<"SeatId">("seat-boat1");
    await repo.saveSeat({ id: b1Seat, shiftId: b1Shift, role: MATE, kind: "required", state: "Open" });
    const seat = (await seatsOf(shiftOf(v2)))[0]!;

    await tick(repo, DRIP_T); // alice
    await tick(repo, plusMin(DRIP_T, 15)); // bob
    expect(await askedIds(seat.id)).toEqual(["alice", "bob"]);
    await tick(repo, plusMin(DRIP_T, 125)); // alice times out; bob still live → seat stays Asked
    expect((await repo.getSeat(seat.id))!.state).toBe("Asked");

    await manualOverride(repo, b1Seat, bob, plusMin(DRIP_T, 126)); // bob committed on 07-01 elsewhere
    const bobAsk = (await repo.listAsksForSeat(seat.id)).find((a) => String(a.crewMemberId) === "bob")!;
    const out = await recordResponseAndConfirm(repo, bobAsk.id, "accepted", plusMin(DRIP_T, 127));
    expect(out.reason).toBe("double_booked");

    // Seat: Asked, zero live asks, pool walked. Every later tick does nothing.
    for (const day of ["2026-06-26", "2026-06-27", "2026-06-28"]) {
      const r = await tick(repo, at(`${day}T16:00:00.000Z`));
      expect(r.asksFired).toBe(0);
      expect(r.nudgesFired).toBe(0);
      expect(r.shiftsEscalated).toBe(0);
      expect(r.boardLandings.filter((l) => l.shiftId === shiftOf(v2))).toEqual([]);
    }
    expect((await repo.getSeat(seat.id))!.state).toBe("Asked");
    expect((await repo.listAsksForSeat(seat.id)).every((a) => a.respondedAt !== undefined)).toBe(true);
    expect((await repo.getShift(shiftOf(v2)))!.state).toBe("Filling");

    // The trail counts bob's non-claiming "accepted" — the board row does not render `accepted`.
    const trail = await escalationTrailFor(repo, shiftOf(v2), at("2026-06-28T16:00:00.000Z"));
    expect({ asked: trail.asked, accepted: trail.accepted, silent: trail.silent, pending: trail.pending })
      .toEqual({ asked: 2, accepted: 1, silent: 1, pending: 0 });

    // It surfaces only at fills-by (route b) — and even then alice (the ghoster) is never nudged.
    const late = await tick(repo, at("2026-06-29T19:30:00.000Z"));
    expect(late.boardLandings.some((l) => l.shiftId === shiftOf(v2))).toBe(true);
    expect(late.asksFired + late.nudgesFired).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("tagC F3 — urgent blast asks one person on every seat / every same-day boat", () => {
  it("two mate seats on ONE shift: each candidate holds two live asks for the same shift", async () => {
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 2 }]);
    await crew("alice", [MATE]);
    await crew("bob", [MATE]);
    await crew("carol", [MATE]);
    await formAllVesselDaysForTest(repo);
    const r = await tick(repo, URGENT_T);
    const per = new Map<string, number>();
    for (const a of r.firedAsks) per.set(String(a.crewMemberId), (per.get(String(a.crewMemberId)) ?? 0) + 1);
    expect(Object.fromEntries(per)).toEqual({ alice: 2, bob: 2, carol: 2 });
    void v;
  });

  it("two boats same day: accepting one leaves the other ask live → ask_ignored (−3) 2h later", async () => {
    const v1 = await vessel("v1", [{ roleTypeId: MATE, count: 1 }]);
    const v2 = await vessel("v2", [{ roleTypeId: MATE, count: 1 }]);
    const alice = await crew("alice", [MATE]);
    await formAllVesselDaysForTest(repo);
    const r = await tick(repo, URGENT_T);
    expect(r.firedAsks.map((a) => String(a.crewMemberId))).toEqual(["alice", "alice"]);
    const s1 = (await seatsOf(shiftOf(v1)))[0]!;
    const s2 = (await seatsOf(shiftOf(v2)))[0]!;
    const a1 = (await repo.listAsksForSeat(s1.id))[0]!;
    expect((await recordResponseAndConfirm(repo, a1.id, "accepted", plusMin(URGENT_T, 1))).seatState).toBe("Confirmed");

    await tick(repo, plusMin(URGENT_T, 130));
    const ignored = (await events(alice)).filter((e) => e.type === "ask_ignored");
    expect(ignored.map((e) => e.metadata.seatId)).toEqual([s2.id]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("tagC F4 — merge orphans side-B asks; a re-split resurrects them on the reborn seat", () => {
  it("a stale ask from a destroyed seat reappears to the crew member and is later swept as ask_ignored", async () => {
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 1 }], ["09:00", "17:00"]);
    await crew("alice", [MATE]);
    const bob = await crew("bob", [MATE]);
    await crew("carol", [MATE]);
    await crew("dave", [MATE]);
    await formAllVesselDaysForTest(repo);
    const canon = shiftOf(v);
    const sideB = asId<"ShiftId">(`${canon}-b`);
    await splitShift(repo, canon, "13:00", at("2026-06-20T16:00:00.000Z"));

    await tick(repo, DRIP_T); // side A → alice; side B → bob (#393 spread)
    const sideBSeat = (await seatsOf(sideB))[0]!;
    expect(await askedIds(sideBSeat.id)).toEqual(["bob"]);

    await mergeShift(repo, canon, plusMin(DRIP_T, 10)); // side B torn down; bob's ask NOT retired
    expect(await repo.getSeat(sideBSeat.id)).toBeNull();
    const orphan = (await repo.listAllAsks()).find((a) => a.seatId === sideBSeat.id)!;
    expect(orphan.respondedAt).toBeUndefined(); // still live, on a seat that no longer exists

    await splitShift(repo, canon, "13:00", plusMin(DRIP_T, 20)); // side B reborn, SAME seat id
    expect((await repo.getSeat(sideBSeat.id))!.state).toBe("Open");
    expect((await repo.listAsksForSeat(sideBSeat.id)).map((a) => a.id)).toContain(orphan.id);

    await tick(repo, plusMin(DRIP_T, 30)); // reborn side-B seat gets a fresh ask → Asked
    expect((await repo.getSeat(sideBSeat.id))!.state).toBe("Asked");
    const bobView = await buildCrewAppView(repo, bob, plusMin(DRIP_T, 31));
    expect(bobView!.asks.map((a) => a.askId)).toContain(orphan.id); // stale card resurfaces

    await tick(repo, plusMin(DRIP_T, 125)); // 2h05 after the ORIGINAL send
    const ign = (await events(bob)).filter((e) => e.type === "ask_ignored");
    expect(ign.map((e) => e.metadata.seatId)).toEqual([sideBSeat.id]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("tagC F5 — an AtRisk shift freezes its fillable sibling seat", () => {
  it("no captain exists → AtRisk → the mate seat (eligible mate available) is never asked", async () => {
    const v = await vessel("v1", [
      { roleTypeId: CAPTAIN, count: 1 },
      { roleTypeId: MATE, count: 1 },
    ]);
    await crew("alice", [MATE]);
    await formAllVesselDaysForTest(repo);
    const r1 = await tick(repo, DRIP_T);
    const r2 = await tick(repo, at("2026-06-27T16:00:00.000Z"));
    expect((await repo.getShift(shiftOf(v)))!.state).toBe("AtRisk");
    expect(r1.asksFired + r2.asksFired).toBe(0);
    const mateSeat = (await seatsOf(shiftOf(v))).find((s) => s.role === MATE)!;
    expect(mateSeat.state).toBe("Open");
    expect(r1.boardLandings.some((l) => l.shiftId === shiftOf(v))).toBe(true); // surfaced, not silent
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("tagC F6 — lost updates: a stale seat write erases a just-filled seat (injected interleave)", () => {
  class HookRepo extends InMemoryRepository {
    onListCrew: (() => Promise<void>) | null = null;
    onEvent: ((e: ReliabilityEvent) => Promise<void>) | null = null;
    async listCrewMembers() {
      const h = this.onListCrew;
      this.onListCrew = null;
      if (h) await h();
      return super.listCrewMembers();
    }
    async logReliabilityEvent(e: ReliabilityEvent) {
      await super.logReliabilityEvent(e);
      const h = this.onEvent;
      if (h) {
        this.onEvent = null;
        await h(e);
      }
    }
  }

  it("widenAsk (Open seat) racing a self-claim overwrites Confirmed → Asked and drops the claimant", async () => {
    const hr = new HookRepo();
    repo = hr;
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 1 }]);
    await crew("alice", [MATE]);
    const bob = await crew("bob", [MATE]);
    await formAllVesselDaysForTest(repo);
    const seat = (await seatsOf(shiftOf(v)))[0]!;

    let claimCode: string | null = "unset";
    hr.onListCrew = async () => {
      claimCode = (await claimSeat(repo, bob, seat.id, DRIP_T)).code; // lands mid-widen
    };
    const ask = await widenAsk(repo, seat.id, DRIP_T); // what tick.ts:502 calls
    expect(claimCode).toBeNull(); // bob's claim WON (Confirmed, +4 self_claim)
    expect(ask).not.toBeNull();
    const after = (await repo.getSeat(seat.id))!;
    expect(after.state).toBe("Asked"); // stale saveSeat clobbered Confirmed
    expect(after.assignedCrewMemberId).toBeUndefined();
    expect((await events(bob)).some((e) => e.type === "self_claim")).toBe(true);
  });

  it("expireAsks racing an accept: the accepted crew member is told Confirmed, then the sweep reopens the seat", async () => {
    const hr = new HookRepo();
    repo = hr;
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 1 }]);
    await crew("alice", [MATE]);
    await crew("bob", [MATE]);
    await crew("carol", [MATE]);
    await formAllVesselDaysForTest(repo);
    const seat = (await seatsOf(shiftOf(v)))[0]!;
    await tick(repo, DRIP_T); // alice
    await tick(repo, plusMin(DRIP_T, 90), { dripIntervalMinutes: 90 }); // bob
    const bobAsk = (await repo.listAsksForSeat(seat.id)).find((a) => String(a.crewMemberId) === "bob")!;

    let told: string | undefined;
    hr.onEvent = async (e) => {
      if (e.type !== "ask_ignored") { hr.onEvent = hr.onEvent; return; }
      told = (await recordResponseAndConfirm(repo, bobAsk.id, "accepted", plusMin(DRIP_T, 125))).seatState;
    };
    await tick(repo, plusMin(DRIP_T, 125), { dripIntervalMinutes: 90 }); // alice expires mid-sweep
    expect(told).toBe("Confirmed");
    const after = (await repo.getSeat(seat.id))!;
    expect(after.assignedCrewMemberId).toBeUndefined(); // bob erased
    expect(await askedIds(seat.id)).toContain("carol"); // and the engine re-asks the "filled" seat
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("tagC F7 — accept-time eligibility is not re-checked (cross-shard, S1)", () => {
  it("asked while eligible, put on PTO, taps Yes → Confirmed on a PTO day", async () => {
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 1 }]);
    const alice = await crew("alice", [MATE]);
    await formAllVesselDaysForTest(repo);
    await tick(repo, DRIP_T);
    const seat = (await seatsOf(shiftOf(v)))[0]!;
    const ask = (await repo.listAsksForSeat(seat.id))[0]!;
    await repo.savePtoWindow({ id: asId<"PtoWindowId">("pto-a"), crewMemberId: alice, start: DATE, end: DATE });
    const out = await recordResponseAndConfirm(repo, ask.id, "accepted", plusMin(DRIP_T, 30));
    expect(out.seatState).toBe("Confirmed");
    expect((await repo.getSeat(seat.id))!.assignedCrewMemberId).toBe(alice);
  });

  it("asked while active, then archived, taps Yes → Confirmed", async () => {
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 1 }]);
    const alice = await crew("alice", [MATE]);
    await formAllVesselDaysForTest(repo);
    await tick(repo, DRIP_T);
    const seat = (await seatsOf(shiftOf(v)))[0]!;
    const ask = (await repo.listAsksForSeat(seat.id))[0]!;
    const me = (await repo.getCrewMember(alice))!;
    await repo.saveCrewMember({ ...me, status: "archived" });
    const out = await recordResponseAndConfirm(repo, ask.id, "accepted", plusMin(DRIP_T, 30));
    expect(out.seatState).toBe("Confirmed");
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("tagC F8 — a withdrawn ask answered after the seat reopened", () => {
  it("'Yes' on a withdrawn ask to a now-Open seat returns already_filled, and bars the person from the drip", async () => {
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 1 }]);
    await crew("alice", [MATE]);
    const bob = await crew("bob", [MATE]);
    await crew("carol", [MATE]);
    await formAllVesselDaysForTest(repo);
    const seat = (await seatsOf(shiftOf(v)))[0]!;
    await tick(repo, DRIP_T); // alice
    await tick(repo, plusMin(DRIP_T, 15)); // bob
    const asks = await repo.listAsksForSeat(seat.id);
    const aliceAsk = asks.find((a) => String(a.crewMemberId) === "alice")!;
    const bobAsk = asks.find((a) => String(a.crewMemberId) === "bob")!;
    await recordResponseAndConfirm(repo, bobAsk.id, "accepted", plusMin(DRIP_T, 16)); // alice withdrawn
    expect((await repo.getAsk(aliceAsk.id))!.response).toBe("withdrawn");
    await bailWithDerivedLateness(repo, seat.id, plusMin(DRIP_T, 60), bob); // seat Open again

    const out = await recordResponseAndConfirm(repo, aliceAsk.id, "accepted", plusMin(DRIP_T, 61));
    expect(out).toMatchObject({ claimed: false, reason: "already_filled", seatState: "Open" });
    const r = await tick(repo, plusMin(DRIP_T, 62));
    expect(r.firedAsks.map((a) => String(a.crewMemberId))).toEqual(["carol"]); // alice skipped
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("tagC M — matches: rank order, boost/floor, tie-break, wall-clock pacing, blast", () => {
  async function world() {
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 1 }]);
    await crew("m-a", [MATE]); // 0
    await crew("m-b", [MATE], { manualFloor: 5 }); // 5
    await crew("m-c", [MATE], { manualBoost: 1 }); // 1
    const d = await crew("m-d", [MATE]); // −3
    await recordReliabilityEvent(repo, d, "ask_ignored", at("2026-06-01T00:00:00.000Z"));
    await crew("cap", [CAPTAIN, MATE], { manualFloor: 100 }); // over-ranked: never asked (DEC-066)
    await formAllVesselDaysForTest(repo);
    return (await seatsOf(shiftOf(v)))[0]!;
  }

  it("drip asks in ranked order, one per 15 wall-clock minutes; 5-min re-tick widens nothing", async () => {
    const seat = await world();
    const fired: number[] = [];
    for (const m of [0, 5, 15, 30, 45, 60]) fired.push((await tick(repo, plusMin(DRIP_T, m))).asksFired);
    expect(fired).toEqual([1, 0, 1, 1, 1, 0]);
    expect(await askedIds(seat.id)).toEqual(["m-b", "m-c", "m-a", "m-d"]);
  });

  it("F10: a */15 cron whose next run starts 1s 'early' skips the widen → effective interval 30 min", async () => {
    const seat = await world();
    const t0 = DRIP_T;
    const fired: number[] = [];
    // sentAt = the tick's own `now` (route.ts:44 → tick → fireAsk), so the next cron must be ≥15:00.000 later.
    for (const ms of [0, 15 * 60_000 - 1_000, 30 * 60_000 - 2_000, 45 * 60_000 - 3_000, 60 * 60_000 - 4_000]) {
      fired.push((await tick(repo, new Date(t0.getTime() + ms))).asksFired);
    }
    expect(fired).toEqual([1, 0, 1, 0, 1]);
    expect(await askedIds(seat.id)).toEqual(["m-b", "m-c", "m-a"]);
  });

  it("interval 0 blasts the whole askable pool in one tick", async () => {
    const seat = await world();
    const r = await tick(repo, DRIP_T, { dripIntervalMinutes: 0 });
    expect(r.asksFired).toBe(4);
    expect((await askedIds(seat.id)).sort()).toEqual(["m-a", "m-b", "m-c", "m-d"]);
  });

  it("inside fills-by the remaining pool blasts regardless of interval", async () => {
    await world();
    const r = await tick(repo, URGENT_T);
    expect(r.asksFired).toBe(4);
  });

  it("pre-horizon: the engine asks nobody", async () => {
    await world();
    const r = await tick(repo, at("2026-06-24T18:59:00.000Z"));
    expect(r.asksFired).toBe(0);
  });

  it("Tier-2 stub re-logs pool_widened on every tick once nobody is nudgeable (info)", async () => {
    const v = await vessel("v1", [{ roleTypeId: MATE, count: 1 }]);
    await crew("alice", [MATE]);
    await formAllVesselDaysForTest(repo);
    const seat = (await seatsOf(shiftOf(v)))[0]!;
    await tick(repo, DRIP_T);
    const ask = (await repo.listAsksForSeat(seat.id))[0]!;
    await recordResponseAndConfirm(repo, ask.id, "declined", plusMin(DRIP_T, 1));
    for (let i = 1; i <= 5; i++) await tick(repo, plusMin(DRIP_T, 15 * i));
    const widened = (await repo.reliabilityEventsFor(SYSTEM_ACTOR_ID)).filter(
      (e) => e.type === "pool_widened" && e.metadata.shiftId === shiftOf(v),
    );
    expect(widened.length).toBe(5);
  });
});
```

</details>

<details><summary><code>src/oracle/reliability-score.tagD.audit-tmp.test.ts</code></summary>

```ts
/**
 * AUDIT PROBE (tagD, crewing-engine audit, shard §1.4 reliability). Pure scorer /
 * standing probes. Passing = the finding reproduces as described in the report.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId } from "../domain/ids.js";
import type { CrewMember } from "../domain/entities.js";
import type {
  ReliabilityEvent,
  ReliabilityEventMetadata,
  ReliabilityEventType,
} from "../domain/reliability.js";
import { computeReliabilityScore, rankByReliability } from "./reliability-score.js";
import { recordReliabilityEvent } from "./reliability-log.js";
import { summarizeStanding } from "../crewapp/standing.js";
import { bailLatenessMs } from "../builder/derive.js";

const NOW = new Date("2026-09-01T00:00:00.000Z");
const H = 3600_000;
const D = 24 * H;
let seq = 0;
function evt(
  type: ReliabilityEventType,
  at: Date,
  metadata: ReliabilityEventMetadata = {},
): ReliabilityEvent {
  seq++;
  return {
    id: asId<"ReliabilityEventId">(`e-${seq}`),
    crewMemberId: asId<"CrewMemberId">("c"),
    type,
    timestamp: at.toISOString(),
    metadata,
  };
}
const daysAgo = (n: number) => new Date(NOW.getTime() - n * D);

describe("tagD P5 — crew-facing 'late bail' fires at ≤6 days notice, not 'within a day'", () => {
  const trip = new Date("2026-09-20T19:00:00.000Z");
  const bailAt = (noticeMs: number) => {
    const at = new Date(trip.getTime() - noticeMs);
    return evt("shift_bailed", at, { latenessMs: bailLatenessMs(trip, at), noticeMs });
  };
  it("a bail 5 days before the trip reads 'one late bail'", () => {
    const r = summarizeStanding([bailAt(5 * D)], new Date(trip.getTime() + D));
    expect(r.reasons).toContain("one late bail");
  });
  it("a bail 6.5 days before reads 'one early bail'; 20h before also 'late' — boundary is lead−24h", () => {
    const now = new Date(trip.getTime() + D);
    expect(summarizeStanding([bailAt(6.5 * D)], now).reasons).toContain("one early bail");
    expect(summarizeStanding([bailAt(20 * H)], now).reasons).toContain("one late bail");
    expect(summarizeStanding([bailAt(5.9 * D)], now).reasons).toContain("one late bail");
  });
});

describe("tagD P8 — zero-weight engine events (ask_sent) consume the 40-event window", () => {
  it("8 worked shifts are flushed by 20 declined asks: worker scores the same as a never-worked decliner", () => {
    const worker: ReliabilityEvent[] = [];
    for (let i = 0; i < 8; i++) {
      worker.push(evt("ask_sent", daysAgo(60 - i * 2)));
      worker.push(evt("ask_accepted", daysAgo(60 - i * 2), { latencyMs: 60_000 }));
      worker.push(evt("shift_completed", daysAgo(59 - i * 2)));
    }
    const declines = (start: number) => {
      const out: ReliabilityEvent[] = [];
      for (let i = 0; i < 20; i++) {
        out.push(evt("ask_sent", daysAgo(start - i)));
        out.push(evt("ask_declined", daysAgo(start - i), { latencyMs: 60_000 }));
      }
      return out;
    };
    const workerScore = computeReliabilityScore([...worker, ...declines(30)], NOW).score;
    const declinerScore = computeReliabilityScore(declines(30), NOW).score;
    const workerOnly = computeReliabilityScore(worker, NOW).score;
    expect(workerOnly).toBe(56);
    expect(workerScore).toBe(20);
    expect(declinerScore).toBe(20);
  });
});

describe("tagD P10 — cold start (0) ranks BELOW anyone who ever answered an ask", () => {
  it("a brand-new hire is not mid-pool: one 'no' outranks them", async () => {
    const repo = new InMemoryRepository();
    const mk = (id: string): CrewMember => ({
      id: asId<"CrewMemberId">(id),
      name: id,
      phone: "555",
      ratings: [],
      status: "active",
      reliabilityScore: null,
    });
    const fresh = mk("a-new-hire"); // sorts first on the id tie-break
    const decliner = mk("m-said-no-once");
    const ghost = mk("z-ghost");
    await recordReliabilityEvent(repo, decliner.id as CrewMemberId, "ask_declined", daysAgo(3), { latencyMs: 5 * 60_000 });
    await recordReliabilityEvent(repo, ghost.id as CrewMemberId, "ask_ignored", daysAgo(3));
    const order = (await rankByReliability(repo, [fresh, decliner, ghost], NOW)).map((c) => c.id);
    expect(order).toEqual([decliner.id, fresh.id, ghost.id]);
  });
});

describe("tagD P11 — weights that the spec says should differ do not", () => {
  it("decline latency does not move the score (spec: '+ small for low ask_declined latency')", () => {
    const fast = computeReliabilityScore([evt("ask_declined", daysAgo(1), { latencyMs: 30_000 })], NOW).score;
    const slow = computeReliabilityScore([evt("ask_declined", daysAgo(1), { latencyMs: 110 * 60_000 })], NOW).score;
    expect(fast).toBe(slow);
  });
  it("acknowledgment is capped per event only: five acks = one completed shift", () => {
    const acks = computeReliabilityScore(
      [1, 2, 3, 4, 5].map((d) => evt("shift_acknowledged", daysAgo(d))),
      NOW,
    ).score;
    const shift = computeReliabilityScore([evt("shift_completed", daysAgo(1))], NOW).score;
    expect(acks).toBe(shift);
  });
});
```

</details>
