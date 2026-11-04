# Payroll audit — does Muster pay what `docs/SPEC.md §2.9` and the tip-pool rules say?

Read-only audit on `main` at `23a556b`, 2026-11-03. No code changed, no issue filed, no comment
posted. Four parallel readers (time and periods; punches and edits; the tip pool; screens against
exports), then every S1 and S2 claim re-read by the lead against the source.

**Method limit, stated up front.** `npx vitest run` was denied by this session's permission policy
on every attempt, by every reader and by the lead. Nothing below carries "tested" confidence.
Numeric and DST claims were re-run in plain `node -e` with the same arithmetic the modules use
(noted as *read, arithmetic re-run*); everything else is *read*. The probe tests each reader wrote
are in Appendix A, unrun, so whoever can run them has them.

## 1. Summary

Thirty-nine rules were checked: the twenty-four statements in §2.9 proper, its six edge cases and
one acceptance criterion that add a rule, and eight from §2.8.4a/b, §2.8.10 and the §2.8 tip
acceptance criterion. **Thirty-two match the code. Six differ. One is not built** (§2.9.9's trail
is written and never read). **Eleven code behaviours decide an hour count, a period bucket or a tip
share where the spec says nothing.** One finding is S1: a tip the customer has been refunded is
still split to the crew when the operator refunds without cancelling. The time arithmetic itself
(vessel-local days, both DST transitions, midnight, period tiling, true elapsed minutes) is
correct everywhere it was traced.

Severity key: **S1** someone is paid the wrong amount · **S2** a pay figure can go wrong silently ·
**S3** a screen shows something different from what the export pays · **S4** spec stale or silent,
code fine.

## 2. Findings, most severe first

### F1 · S1 · A refunded tip is still paid to the crew when the refund is not a cancellation

**Spec.** §2.8.4a component table, `docs/SPEC.md:1699`: Tip … "Returned on a full refund: **yes**".
§2.8.4c, `:1820-1821`: "'Everything paid' means everything. The fare, extras, add-ons, insurance,
tax, the service fee and the tip". §2.8.10, `:2108`: "The crew tip pool pays out on `booked`."

**Code.** The pool admits every gratuity whose reservation satisfies `isBooked`
(`src/admin/gratuity-payroll.ts:125-132`), which is `status === "booked"`
(`src/domain/entities.ts:633-635`). The refund path never changes that status and never touches
the gratuity row: `refundReservation` allow-lists `booked` or `cancelled`
(`src/reservations/refund-payment.ts:139-140`) and writes only `markPaymentRefunded` (`:253`).
Only `cancelReservation` flips a reservation to `cancelled`
(`src/reservations/cancel-reservation.ts:241-243`). The operator's standalone "Refund up to" box is
offered on any row with `refundableCents > 0` with no status gate
(`app/(admin)/admin/calendar/[reservationId]/reservation-detail-pane.tsx:872-881`), and
`refundBooking` calls `refundReservation` directly without cancelling
(`app/(admin)/admin/calendar/[reservationId]/actions.ts:565-594`). No writer on the port removes or
zeroes a gratuity (`saveGratuity` is the only gratuity write in `src/ports/repository.ts`).

**What differs.** The spec says the tip goes back to the customer on a full refund and the pool
pays out on `booked`; the code keeps the reservation `booked` after a full refund, so the tip is
both returned to the customer and split to the crew. The cancel-then-refund flows (customer minus
$50, insured, operator) all go through `cancelReservation` first and are correct; the standalone
refund, partial or full, is the gap.

**Scenario.** Mary books the spec's worked example, $499 fare with a 20% tip of $99.80, total
$652.94 (`docs/SPEC.md:1706-1707`), for 2026-07-04. Ann and Bob hold the two required Confirmed
seats. On 2026-07-05 the operator refunds the full $652.94 as goodwill from the "Refund up to" box
and does not press cancel, because the trip already ran. The reservation stays `booked`, the
gratuity row stays, and the Jul 6–19 `gusto.csv` pays Ann $49.90 and Bob $49.90 in
`paycheck_tips`: $99.80 the customer already has back. A partial goodwill refund on a `booked` row
pays the full tip the same way.

**Note.** The spec is silent on a post-trip goodwill refund specifically, so part of this is a
spec gap. But "returned on a full refund" and "pays out on booked" cannot both hold on this path,
and the code chooses the one that pays twice.

**Confidence.** Read. Probe: Appendix A.3, "refund without cancel".

### F2 · S2 · A booked tip whose event sits on no shift vanishes from the report with no warning

**Spec.** §2.8.4b, `docs/SPEC.md:1778-1780`: "A pool with no confirmed crew is never silently
dropped. It is reported unsplit, as a warning the operator sees." Acceptance criterion `:2297-2299`:
"a trip with a tip but no confirmed crew produces a warning rather than a silent loss."

**Code.** `eventsInWindow` is built only from the `eventIds` of non-Cancelled shifts
(`src/admin/gratuity-payroll.ts:109-122`); a gratuity whose event is on no such shift is filtered
out at `:131` before `splitGratuity` runs, so the `:65-67` warning cannot fire. The state is
reachable: `formAndConfirm` keeps the booking when its vessel-day fails to derive, "sold, paid, no
crew, no row on the board … They still have no shift" (`src/reservations/booking-webhook.ts:1059-1068`,
and the outer catch at `:1069-1082`). The only trace is a `console.error` at booking time.

**Scenario.** Mary's $99.80 tip on a day whose derivation threw is absent from every period's
rows, totals and warnings until someone notices the empty roster.

**Also.** The same filter drops a `booked` reservation on a **Cancelled** shift, unwarned, and
`src/admin/gratuity-payroll.test.ts:149-156` pins that as intended. No path to it was found:
`cancelEventIfUnclaimed` refuses while a booked muster row holds the event
(`src/adapters/in-memory-repository.ts:515-519`, `src/adapters/postgres-repository.ts:1241-1247`)
and a shift goes Cancelled only when every event is cancelled (`src/builder/form-shifts.ts:499-501`).
Unreachable today, silent if it ever is.

**Confidence.** Read. Probe: Appendix A.3, Q4a and Q4b.

### F3 · S2 · Admin edits and deletes write no trail row; an admin delete leaves no evidence the hours existed

**Spec.** §2.9.9, `docs/SPEC.md:2493-2496`: "Every change requires a reason and appends a row — who,
when, from→to, and why — append-only … The row outlives the punch: after a delete it is the only
remaining evidence those hours existed." §2.9.8, `:2486-2487`: "the record says who asserted each
number."

**Code.** `appendTimePunchEdit` is called only from the three crew doors
(`src/crew/time-clock-crew.ts:120,167,204`). The admin actions call `editPunch` and `deletePunch`
directly (`app/(admin)/admin/time-clock/actions.ts:168-173`, `:198`); the admin forms carry no
reason field. An admin edit leaves only `adminEditedAt`, a timestamp with no before/after and no
reason (`src/crew/time-clock.ts:278-281`); an admin delete leaves nothing
(`src/crew/time-clock.ts:299-301` → `removeTimePunch`).

**What differs.** §2.9.9's sentence sits in the crew self-correction paragraph, so a narrow reading
makes the spec silent on admin edits. The migration's own rationale assumed otherwise
(`db/migrations/20260801180000_time_punch_edits.sql:8-13`, "Once crew and admin can both edit the
same row…"). Either the spec or the code is wrong.

**Scenario.** Hooper tapped 13:00–21:00 on 7 Jul, 8 hours. The operator deletes the punch on the
bench on 9 Jul. The `time_punches` row is gone, `time_punch_edits` is empty, Hooper's `/crew/time`
reads "No hours yet", and nothing records who did it or why.

**Confidence.** Read. Probe: Appendix A.1, "admin edits/deletes leave NO trail row".

### F4 · S2 (not built) · The edit trail is write-only; a crew self-edit is invisible to the operator

**Spec.** §2.9.9, `docs/SPEC.md:2498-2501`: "A crew edit lands immediately and is visible … Revisit
only if it is abused — and the trail is what would show that." §2.9.8, `:2485-2486`: "Hours nobody
actually punched must never look identical to hours they did."

**Code.** `listTimePunchEdits` has no caller under `app/`, `components/` or any view module; only
the adapters, the port and the contract test reference it (grep, 2026-11-03). A crew edit leaves
`origin: "crew"` and `adminEditedAt: null` (`src/crew/time-clock.ts:278-281`), so `touchedByAdmin`
is false (`src/admin/time-clock-report.ts:210`), the bench shows no provenance line
(`app/(admin)/admin/time-clock/page.tsx:411-415`), and the report shows no mark
(`app/(admin)/admin/payroll/page.tsx:416-418`).

**Scenario.** Quint tapped 13:00–21:00 (8h), then on `/crew/time` edits the out to 01:00 with the
reason "stayed late" (12h). `/admin/payroll` shows Quint 12h 0m with no flag, `gusto.csv` says
12.00, and the bench card is indistinguishable from a tapped punch. The trail row exists in
Postgres and no screen or export in the repo can show it. The no-approval bet in §2.9.9 rests on a
record nobody can read.

**Confidence.** Read. Probe: Appendix A.1, "a crew-origin, crew-edited punch carries no flag".

### F5 · S2 (suspected reachability) · An event listed on two live shifts pays the later shift's crew the tip and both shifts' crew the estimate

**Spec.** §2.8.4b, `docs/SPEC.md:1769-1770`: "split equally among the crew who worked it — the
confirmed holders of that shift's required seats".

**Code.** `crewByEvent.set(String(eventId), [...crew])` runs once per shift, so the last shift
listing an event wins with no warning (`src/admin/gratuity-payroll.ts:118-121`). The estimate sums
the event's `committedMinutes` into every shift that lists it (`src/admin/payroll.ts:51-55,68-72`).
Shift order is `select * from shifts` with no `order by`
(`src/adapters/postgres-repository.ts:2075-2078`), so which crew gets the pool is not deterministic.

**Reachability.** By construction an event is on exactly one live shift: `form-shifts.ts:307-308,629`
writes `eventIds` as a disjoint partition of a vessel-day and `src/builder/merge.ts:80-83` deletes
side B. The only route is a stale row for a vessel-day a caller forgot to re-form
(`src/builder/form-shifts.ts:238-241` names `reformWindow` as the backstop). No path that leaves
one was found; the silent overwrite is flagged, not a reproducer.

**Scenario.** Trip e1 moves from Hops to Duffy on the same date and the Hops shift row is left
listing e1 with its Confirmed captain Ann; the Duffy shift lists e1 with Bob. Tips: Bob $10.00,
Ann $0, or the reverse depending on row order. Estimate: both get the trip's minutes.

**Confidence.** Suspected (reachability), read (behaviour). Probe: Appendix A.4, "an event listed
on TWO non-cancelled shifts".

### F6 · S2 (low) · `?period=from|to` is validated for shape only, on every surface and on the file route

**Spec.** §2.9.7, `docs/SPEC.md:2473`: "per-crew hours for a pay period"; §2.9.6 `:2428-2435`
reasons about comparison "bounded by the pay period".

**Code.** `app/(admin)/admin/payroll/page.tsx:70-72`, `app/(admin)/admin/payroll/gusto.csv/route.ts:33-36`
and `app/(admin)/admin/time-clock/page.tsx:99-100` each accept any two `YYYY-MM-DD` strings. Nothing
checks `to = from + 13`, that `from` is on the anchor cadence, or that `from <= to`.

**Scenario.** The operator hand-edits the URL to `period=2026-07-06|2026-07-25`, a twenty-day
window across a period cut, and downloads `gusto-payroll-2026-07-06_2026-07-25.csv`. Hooper's
hours from both halves sum into one `regular_hours`; the filename looks legitimate and nothing on
the page says it is not a pay period. `period=2026-07-19|2026-07-06` yields an empty file silently.

**Confidence.** Read.

### F7 · S2 (low) · `tips.csv` is still served with `TIME_CLOCK` on, so tips can be imported twice

**Spec.** §2.9.7, `docs/SPEC.md:2477-2478`: "**One file** goes to payroll carrying both hours and
tips (`gusto.csv`), rather than an hours file the operator has to combine by hand."

**Code.** `gusto.csv` is gated on the flag (`app/(admin)/admin/payroll/gusto.csv/route.ts:26-28`)
and on `exportBlocked` (`:39-43`). `tips.csv` is gated on admin auth only
(`app/(admin)/admin/payroll/tips.csv/route.ts:14-18`) and emits the same `paycheck_tips` figure
(`src/admin/gratuity-payroll.ts:179`; `src/admin/payroll-reconcile.ts:244`). The page links only
`gusto.csv` in reconcile mode (`app/(admin)/admin/payroll/page.tsx:135-136,256-268`) and `tips.csv`
only with the flag off (`:182-188`), but the gusto route's own comment notes "a URL survives a
bookmark" (`gusto.csv/route.ts:17`).

**Scenario.** The operator imports a bookmarked `gusto-tips-2026-07-06_2026-07-19.csv` and the new
`gusto-payroll-2026-07-06_2026-07-19.csv`. Ann's $49.90 lands twice. Whether Gusto dedupes a
re-imported row is outside this repository and unverified.

**Confidence.** Read.

### F8 · S2 (low) · The punch write and its trail row are two writes, not one transaction

**Spec.** §2.9.9, `docs/SPEC.md:2493-2494`: "Every change … appends a row."

**Code.** `editOwnPunch` saves the punch (`src/crew/time-clock-crew.ts:111`) then appends (`:120`);
`addOwnPunch` likewise (`:156`, `:167`); `deleteOwnPunch` appends first (`:204`) then deletes
(`:216`). The Postgres adapter wraps neither pair in a transaction
(`src/adapters/postgres-repository.ts:1065-1085,1128-1139`). If the append throws, the action
redirects with `?err=error`, copy "Couldn't record that just now"
(`app/(crew)/crew/time/actions.ts:166-169`, `page.tsx:69`), while the punch change has landed.

**Scenario.** Brody edits 8h to 12h; the append fails; he is told it failed; 12h is stored with no
who or why. He retries with the same values; it succeeds; one trail row for two writes.

**Confidence.** Read. Probe: Appendix A.1, "trail row is not atomic".

### F9 · S3 · The screen and the Gusto file round the same minutes at different units

**Spec.** §2.9.6, `docs/SPEC.md:2399-2401`: "Precision is lost exactly once, at the **edge**, where
every surface — the Gusto file and all three clock displays — rounds to the **nearest** unit through
a single shared rule (`src/admin/hours-format.ts`)."

**Code.** `splitMinutes` rounds to the nearest minute (`src/admin/hours-format.ts:30-33`) and feeds
`hoursLabel` and `compactDuration`; `decimalHours` rounds to the nearest hundredth of an hour, 0.6
of a minute, and does not call `splitMinutes` (`:53-56`), despite the module doc's claim that the
arithmetic "now happens in `splitMinutes` and nowhere else" (`:21-22`). The page's Total row rounds
the unrounded sum (`app/(admin)/admin/payroll/page.tsx:451` over `src/admin/payroll-reconcile.ts:201`);
the file rounds each row (`src/admin/payroll-reconcile.ts:242`) and has no total row. The test titled
"the two labels and the file never disagree about the minute" never calls `decimalHours`
(`src/admin/hours-format.test.ts:87-101`).

**What differs.** Each surface does round once, to its nearest unit, as the sentence says. The
units differ, so the sentence's promise that the surfaces agree is not kept, and the module's own
claim of one arithmetic site is false.

**Scenario.** Quint and Hooper each punch 8h 0m 24s, 480.4 minutes.

| | Quint | Hooper | Total |
|---|---|---|---|
| `/admin/payroll` Actual | 8h 0m | 8h 0m | 16h 1m |
| `gusto.csv` `regular_hours` | 8.01 | 8.01 | (8.01 + 8.01 = 16.02) |

Ann and Bob each punch 30.3 minutes: file rows 0.51 + 0.51 = 1.02 h; page Total "1h 1m" (1.0167 h).
Per row the gap is at most 0.3 of a minute; it never nets to zero across a crew, so a file-to-screen
tally never reconciles exactly.

**Confidence.** Read, arithmetic re-run in plain node (`480.4 → "8h 0m" / "8.01"`,
`60.6 → "1h 1m" / "1.01"`, `489.5 → "8h 10m" / "8.16"`).

### F10 · S3 · Links from `/admin/payroll` to the bench land on the wrong person for an archived crew member

**Spec.** §2.9 edge cases, `docs/SPEC.md:2516`: "Crew deleted / deactivated with punches — punches
survive; hours already worked are still owed."

**Code.** The report resolves names from `repo.listCrewMembers()` for all statuses
(`src/admin/payroll-reconcile.ts:130,133`; `src/adapters/postgres-repository.ts:1002-1004`), so an
archived member with punches gets a row, a delta, and a `?crew=<id>&period=` link
(`app/(admin)/admin/payroll/page.tsx:295,436`). The bench builds its picker with
`c.status !== "archived"` (`app/(admin)/admin/time-clock/page.tsx:117`) and
`selectedCrew = sp.crew && crewList.some(…) ? sp.crew : crewList[0]?.id` (`:120`): an archived id
silently falls back to the first crew member alphabetically.

**Scenario.** Brody, archived in August, has an open punch from 2026-07-18 in the Jul 6–19 period.
The export is blocked. The operator clicks "Brody — 1 open" and gets Ann's timesheet with no
notice and nothing to close; the block persists. The stale strip
(`src/admin/time-clock-admin.ts:192-216`) catches it only through the day view.

**Confidence.** Read.

### F11 · S3 · `adminEditedAt` is last-admin-touch and survives a later crew edit

**Spec.** §2.9.8, `docs/SPEC.md:2484-2485`: "an admin-edited time (`adminEditedAt`)". §2.9.9,
`:2503-2504`: "That flag means *someone else* moved your hours."

**Code.** A crew edit keeps `existing.adminEditedAt` (`src/crew/time-clock.ts:278-281`).

**Scenario.** The office edits Quint 21:00 → 20:00; Quint then edits to 01:00 (12h). The bench reads
"Edited by the office" (`app/(admin)/admin/time-clock/page.tsx:413`) and the report "office-edited"
on numbers the office never set. Correct only if the trail were readable (F4).

**Confidence.** Read. Probe: Appendix A.1, "crew's later edit keeps the admin stamp".

### F12 · S3 · Unmapped crew are in the page totals and absent from the file; a zero row goes to Gusto

**Spec.** §2.8.4b, `docs/SPEC.md:1774-1775`: "the cents add up exactly to the pool".

**Code.** `gustoPayrollCsv` and `gustoTipsCsv` skip rows without `gusto.employeeId`
(`src/admin/payroll-reconcile.ts:235`; `src/admin/gratuity-payroll.ts:170`); the page rows and
`totalTipCents` / `totalActualMinutes` include them (`src/admin/payroll-reconcile.ts:200-202`).
Warnings exist for both (`src/admin/gratuity-payroll.ts:144`; `src/admin/payroll-reconcile.ts:185-191`)
and reach the page in both modes (`app/(admin)/admin/payroll/page.tsx:190-198,384-392`). Nothing
holds the unallocated cents; the remedy is to map the person and re-export the whole period file.
Conversely a mapped member who was scheduled, never punched and earned no tip is written as a
`0.00`/`0.00` row (`payroll-reconcile.ts:233-247`), which the spec's union sentence (`:2476`) covers
for the screen, not the file.

**Scenario.** Bob has $49.90 in tips and no Gusto id. The page Total says $99.80; the file's rows
sum to $49.90; the warning says why.

**Confidence.** Read.

### F13 · S3 (minor) · The Δ column says "even" while Est and Actual visibly differ by a minute

**Code.** `deltaLabel` returns "even" for `|Δ| < 1` minute, a threshold outside `hours-format.ts`
(`app/(admin)/admin/payroll/page.tsx:45-48`, footer `:454`). Est 480 → "8h 0m", Actual 480.6 →
"8h 1m", Δ 0.6 → "even". Est 480.4 → "8h 0m", Actual 481.6 → "8h 2m", Δ 1.2 → "+0h 1m". Each
column rounds correctly and the three do not add up on screen.

**Confidence.** Read, arithmetic re-run in plain node.

### F14 · S4 (copy) · The missing-days notice counts shifts; the number counts days

**Spec.** §2.9.6, `docs/SPEC.md:2447-2448`: "The report names the vessel-local **days** someone held
a required Confirmed seat … and has no punch at all".

**Code.** `payroll.ts:74` collects days as a Set, `payroll-reconcile.ts:161-162,204` diffs and
counts days, and the copy renders "One shift in this period has no punch against it" / "N shifts …"
(`app/(admin)/admin/payroll/page.tsx:353-355`). On a split day with Ann on both halves and no punch:
`shiftCount` 2, `missingCount` 1, copy "One shift". Day granularity is what the spec says, so the
code matches the spec and the copy does not. A corollary the spec accepts: Ann on both halves who
punches only the morning has a "punched" day; the afternoon's missing punch shows only as a
negative Δ.

**Confidence.** Read. Probe: Appendix A.4, "two shifts on one date".

### F15 · S4 (copy) · Provenance wording differs by surface and is per-person on the report

**Spec.** §2.9.8, `docs/SPEC.md:2484-2486`: both `origin: "admin"` and `adminEditedAt` "marked on
both the admin surface and the report."

**Code.** The report renders one row flag, "office-edited", from `touchedByAdmin`
(`app/(admin)/admin/payroll/page.tsx:416-418`; `src/admin/payroll-reconcile.ts:173`), so an
admin-*entered* punch is labelled "edited" and the operator cannot tell which punch. The bench
collapses "entered and edited" to "Entered by the office" (`app/(admin)/admin/time-clock/page.tsx:411-415`);
the crew line says "Entered or edited by the office" (`app/(crew)/crew/time/page.tsx:347-349`). Marked,
as the spec requires; three wordings for one fact. `gusto.csv` carries no provenance column, which
the spec does not ask for.

**Confidence.** Read.

### F16 · S4 (spec silent) · A non-refundable cancellation keeps the tip for the operator; the crew never get it

**Spec.** §2.8.4c, `docs/SPEC.md:1815,1817,1826`: inside the window the customer gets "nothing";
"A non-refundable cancellation keeps everything, service fee included." §2.8.4a, `:1721`: "The tip
is the crew's money."

**Code.** Cancel sets `cancelled` (`src/reservations/cancel-reservation.ts:241-243`), which
`isBooked` excludes from the pool (`src/admin/gratuity-payroll.ts:127`). The gratuity row is left
in place, never zeroed or removed.

**Scenario.** Mary cancels three days out, uninsured. The operator keeps $652.94 including the
$99.80 tip; Ann and Bob are paid $0 of it. A no-show handled by *not* pressing cancel pays the
crew; pressing cancel as "customer" does not. The tip's destination depends on an operator
keystroke the spec does not mention.

**Confidence.** Read.

### F17 · S4 (spec silent) · Tips are paid for in-window trips that have not run yet

**Code.** The pool takes every non-Cancelled shift in the window
(`src/admin/gratuity-payroll.ts:110-111`); `Completed` is not required. An export taken mid-period
includes tips for trips still to sail. §2.8.10 "pays out on booked" (`:2108`) permits it; §2.8.4b
"the crew who worked it" (`:1769`) does not quite. The denominator is likewise the crew confirmed
*now*, not at the trip: `manualOverride` writes a seat with no shift-state check
(`src/asks/ask-loop.ts:850-880`) and `mergeShift` deletes side-B seats with none
(`src/builder/merge.ts:42-55,80-83`), so if either is reachable on a past day the tip moves after
the fact. Whether the UI offers them on a Completed day was not verified.

**Confidence.** Read; the post-trip movement is suspected.

### F18 · S4 (spec silent) · Nothing records that a period's file was sent, so later punches into it are silent

**Spec.** §2.9.6 buckets by vessel-local `inAt` (`docs/SPEC.md:2456`). No export marker exists:
grep for `exported` / `export_at` under `src/` finds nothing.

**Scenario.** The operator downloads P1's `gusto.csv` at 10:00 on P1's last day with no open
punches. Hooper clocks in at 16:00 and out at 22:00, six hours with `inAt` in P1. P2's file never
carries them, `/admin/payroll` opens on the current period by default
(`app/(admin)/admin/payroll/page.tsx:72`), and nothing flags that P1 changed after export. Silent
by construction; potentially S1 in practice.

**Confidence.** Read.

### F19 · S4 · `PAY_PERIOD_ANCHOR` is the one env knob in `tenant.ts` with no validation; a future value clamps "current"

**Code.** `process.env.PAY_PERIOD_ANCHOR ?? "2026-01-05"` (`src/config/tenant.ts:46-47`), unlike
`envMs`, `envPositiveInt` and `envWallClock` in the same file (`:169-174,181-186,246-252`). A
malformed value makes `isoDay` throw (`src/admin/pay-periods.ts:16-18,32,42`), and `currentPeriod`
is called outside the try on `app/(admin)/admin/payroll/page.tsx:64-65`,
`app/(admin)/admin/time-clock/page.tsx:96-97` and `app/(crew)/crew/time/page.tsx:130`, so three
pages 500 rather than show the "Couldn't build" notice. `currentPeriod` clamps any day before the
anchor to the anchor's own period (`pay-periods.ts:39`, admitted at `:35-38`); `periodsForYear`
does not (`:54`), so with a future anchor the picker marks the wrong option "— current" and the
default window does not contain today.

**Scenario.** On 2026-11-03 the operator sets `PAY_PERIOD_ANCHOR=2026-12-07` to pre-stage next
year's calendar. `/admin/payroll` opens on an empty Dec 7–20 marked current; Hooper's 2026-11-02
hours are in a period the operator has to scroll back to.

**Confidence.** Read.

### F20 · S4 (suspected) · A departure between 00:00 and 00:44 puts the estimate and the punch on different days

**Code.** The estimate buckets on `shift.date` (`src/admin/payroll.ts:45,74`); call time is the
first departure minus `CALL_LEAD_MINUTES`, 45 (`src/crewapp/shift-card.ts:132`;
`src/builder/derive.ts:451`); the punch buckets on `vesselDateOf(inAt)`
(`src/admin/time-clock-report.ts:183`); auto-match compares the same two
(`src/crew/time-clock.ts:328-332`).

**Scenario.** A trip dated 2026-07-20 at 00:15, first day of a period. Quint clocks in at call time,
23:30 on 07-19, out 02:00. Jul 6–19: actual 150 min, estimate 0, a "punch with no seat" row.
Jul 20–Aug 2: estimate present, actual 0, `missingDays: ["2026-07-20"]`, `shiftId` null. Whether any
real event departs in that window is not answerable from the repo.

**Confidence.** Suspected.

### F21 · S4 (latent) · Period membership is a string comparison that depends on every writer using `.toISOString()`

**Code.** `in_at` is `text` (`db/migrations/20260731180000_time_punches.sql:29-30`), and both
adapters compare it as text, half-open (`src/adapters/postgres-repository.ts:1111-1115`;
`src/adapters/in-memory-repository.ts:450-453`); the port documents the same-shape assumption
(`src/ports/repository.ts:245-251`). Every app writer uses `.toISOString()`
(`src/crew/time-clock.ts:77,132,181-182,257,264`). A hand-run SQL insert of
`2026-07-20T04:00:00+00:00`, exactly 00:00 local on a period's first day, sorts below
`…T04:00:00.000Z` and is filed in the earlier period by the report and bench, while `/crew/time`,
which buckets by `vesselDateOf` (`src/crewapp/time-view.ts:111-113`), shows it in the later one. No
live writer produces that shape. The contract test covers only `.000Z`
(`src/adapters/repository-contract.ts:455-474`).

**Confidence.** Read.

### F22 · S4 · A non-Cancelled shift whose events are all cancelled is neither estimated nor missing

**Spec.** §2.9.6, `docs/SPEC.md:2447-2448`: days "someone held a required Confirmed seat on a
non-Cancelled shift and has no punch at all".

**Code.** `payroll.ts:56` `if (minutes === 0) continue` drops the shift before `days` is built
(`:74`), so `missingDays` never sees it. The importer normally flips such a shift to Cancelled
(`src/builder/form-shifts.ts:499-501`). Defensible, and narrower than the sentence.

**Confidence.** Read. Probe: Appendix A.1, "#638 and a non-Cancelled shift whose only event is cancelled".

### F23 · S4 · `editPunch` re-opening a punch relies on the index alone

**Code.** `src/crew/time-clock.ts:284-289` catches 23505 → `already_in` with no `getOpenPunchForCrew`
pre-check, unlike `clockIn` (`:70`) and `addPunch` (`:191`). `InMemoryRepository.saveTimePunch`
enforces nothing (`src/adapters/in-memory-repository.ts:422-429`), so the in-memory substrate can
hold two open punches after an edit and `getOpenPunchForCrew` returns an arbitrary one
(`:434-438`). Matches the spec on Postgres if the index exists
(`db/migrations/20260731180000_time_punches.sql:46-48`), unverified here.

**Confidence.** Read.

### F24 · S4 · Spec vocabulary is stale: `future` and `day_moved` are not in §2.9

**Code.** `future` refusal (`src/crew/time-clock.ts:115-117,187-189,270-272`, "operator, 2026-08-01");
`day_moved`, the immutable day (`:266-268`). §2.9.4 `docs/SPEC.md:2386-2387` says "Error codes are
the whole vocabulary" and lists three. Also stale: the `/crew/time` open-punch copy "ask the office
to correct it" (`app/(crew)/crew/time/page.tsx:195-197`) predates §2.9.9 self-correction;
`editPunch` keeps `shiftId` without re-matching (`:275`), harmless because nothing under
`src/admin/` pays from `shiftId` (only `integrity.ts:148-149` and `time-clock-admin.ts:52,116` read it).

**Confidence.** Read.

### F25 · S4 · Smaller items

- `committedMinutes` has a `Math.round` outside `hours-format.ts` (`src/crewapp/shift-card.ts:189`).
  Estimate input, whole-minute departures, a no-op in practice.
- `poolCents <= 0` skip (`src/admin/gratuity-payroll.ts:64`) is dead: a comp writes no gratuity row
  (`src/reservations/booking-webhook.ts:920`; `src/reservations/confirm-booking.ts:103`;
  `src/reservations/discount.ts:85,107`) and no writer produces a negative.
- `post` gratuities are still summed per event (`src/admin/gratuity-payroll.ts:50-53`, test `:57-66`)
  though post-trip tipping was removed in 15.18 (`src/reservations/gratuity.test.ts:148-176`). Dead.
- Remainder order is `.sort()` code-unit order (`src/admin/gratuity-payroll.ts:62`); ids are
  `crew-<slug>` from the CLI (`src/crew/crew-cli.ts:245`), so it equals the spec's "sorted by id".
  `crew-10` would outrank `crew-2`; irrelevant for slug ids.
- Test gaps: no test punches across spring-forward (the three DST tests at
  `src/admin/time-clock-report.test.ts:79-87`, `src/crewapp/time-view.test.ts:216`,
  `src/crew/time-clock.test.ts:258` are all fall-back); no test places a punch at exactly 00:00:00.000
  local on day `to+1` through `buildTimeClockReport`; no test asserts period N's upper instant equals
  period N+1's lower in a DST week.

## 3. Rules that match

Each line: the rule, then where. Postgres-dependent items are marked; Postgres was not available.

- Punch stores UTC instants, text ISO-8601 — `db/migrations/20260731180000_time_punches.sql:29-30`; every writer `.toISOString()` `src/crew/time-clock.ts:77,132,181-182,257,264`.
- Rendered vessel-local; `vesselDateOf` is pure `Intl`, DST-correct — `src/config/tenant.ts:108-116`.
- Midnight instants correct on 2026-03-08 (05:00Z), 03-09 (04:00Z), 11-01 (04:00Z), 11-02 (05:00Z) — `src/config/tenant.ts:92-100`; re-run in node.
- `addDays` is UTC date-only math, exact across month, year, leap and DST — `src/config/tenant.ts:125-130`; period cadence likewise `src/admin/pay-periods.ts:7-8,12-13`.
- Period window `[from 00:00 local, to+1 00:00 local)`, half-open on `inAt` — `src/admin/time-clock-report.ts:148-153`; `src/admin/time-clock-admin.ts:92-97`; adapters `src/adapters/postgres-repository.ts:1114`, `src/adapters/in-memory-repository.ts:453`; contract `src/adapters/repository-contract.ts:455-474`.
- A punch is in exactly one period: consecutive periods satisfy `next.start == addDays(prev.end, 1)` (`src/admin/pay-periods.test.ts:32-39`) and both bounds go through the same `zonedWallClockToInstant`, so N's `to` instant equals N+1's `from`; Oct 26–Nov 8 is `10-26T04:00Z`..`11-09T05:00Z`, re-run in node.
- 8pm Eastern on the last day lands in that period — `src/admin/time-clock-report.test.ts:53-67`; `src/crewapp/time-view.test.ts:147`; `src/admin/time-clock-admin.test.ts:66,160`; re-run in node (`2026-07-19 20:00 EDT → 2026-07-20T00:00Z → vessel date 2026-07-19`).
- Midnight-spanning punch bucketed by `inAt`'s day; edit cannot move the day — `src/admin/time-clock-report.ts:183`; `src/crewapp/time-view.ts:112`; `src/admin/time-clock-admin.ts:106`; `src/crew/time-clock.ts:266-268`.
- True elapsed minutes through DST, instants both ends — `src/admin/time-clock-report.ts:225-227`; `src/crewapp/time-view.ts:146`; `src/admin/time-clock-admin.ts:111`; spring 01:30 EST → 03:30 EDT is 60 min, re-run in node.
- No rounding of stored data — `src/admin/time-clock-report.ts:226`; `src/crewapp/time-view.ts:141-146`; `src/admin/time-clock-admin.ts:109-111`; tests `time-clock-report.test.ts:114-123`, `time-view.test.ts:228`.
- Rounds to nearest, not truncate (DEC-157); the 69-minute float trap pinned — `src/admin/hours-format.ts:30-33,53-56`; tests `:14-25,36-42,59-69`; `src/admin/payroll-reconcile.test.ts:217-231`.
- Period chosen as `currentPeriod(PAY_PERIOD_ANCHOR, vesselDateOf(now))`, vessel-local today, on all three surfaces — `app/(admin)/admin/payroll/page.tsx:63-64`; `app/(admin)/admin/time-clock/page.tsx:95-96`; `app/(crew)/crew/time/page.tsx:129-130`; `src/crewapp/time-view.ts:88`.
- `periodsForYear` agrees with `currentPeriod` at both year seams for the default anchor — `src/admin/pay-periods.ts:54,58`.
- Estimate and tips bucket on `shift.date`, the same calendar the punch join uses — `src/admin/payroll.ts:45,74`; `src/admin/gratuity-payroll.ts:111`; join `src/admin/payroll-reconcile.ts:161-162`; pinned `payroll-reconcile.test.ts:326-337`.
- One open punch: read check, 23505 → `already_in`, partial unique index — `src/crew/time-clock.ts:70,84-91`; `db/migrations/20260731180000_time_punches.sql:46-48`; concurrency test `src/adapters/postgres-repository.test.ts:401-418` (Postgres, unverified here).
- `not_in`, `out_before_in` including zero-length, one implementation shared by add and edit — `src/crew/time-clock.ts:101-103,130,133-135,183,269`.
- Auto-match: vessel-local date, Confirmed and required, Cancelled skipped, more than one → null; add re-matches like clock-in — `src/crew/time-clock.ts:200,323-347`.
- Open punches excluded from hours and counted on all three surfaces — `src/admin/time-clock-report.ts:191-196`; `src/crewapp/time-view.ts:125-126`; `src/admin/time-clock-admin.ts:120-123`.
- Nothing auto-closes: only `clockOut` and `editPunch` write `outAt`; no cron or tick module references punches — `src/crew/time-clock.ts:137-138,274-282`; grep.
- Open punch blocks `gusto.csv` at domain and route with a reason-naming message; page hides the button; each open punch linked to the bench — `src/admin/payroll-reconcile.ts:101-120,206,231`; `app/(admin)/admin/payroll/gusto.csv/route.ts:39-43`; `app/(admin)/admin/payroll/page.tsx:256-268,295`.
- Overlap blocks: closed punches only, half-open `<`, compared across the whole period with day attributed after, exact duplicate caught, linked to the day view — `src/admin/time-clock-report.ts:110-138,118,127,220`; `app/(admin)/admin/payroll/page.tsx:332`.
- Period seam is the accepted gap exactly as written; passed in both periods — `src/admin/time-clock-report.ts:100-108`; pinned `src/admin/payroll-reconcile.test.ts:487-526`.
- `exportBlocked` excludes `missingCount` — `src/admin/payroll-reconcile.ts:206`.
- Missing day counted, named, linked, not blocking; required Confirmed non-Cancelled; supernumerary never; a day with an open punch is not missing — `src/admin/payroll-reconcile.ts:88,161-162`; `src/admin/payroll.ts:44,63`; `src/admin/time-clock-report.ts:183-186`; `app/(admin)/admin/payroll/page.tsx:372`.
- Rows are a union; estimate-only shows `0h 0m` actual, punch-only shows `0h 0m` estimate — `src/admin/payroll-reconcile.ts:139`.
- One reconcile file carries hours and tips on one row — `src/admin/payroll-reconcile.ts:230-249`.
- Bench renders open punches first, flagged, with the stale strip above both views — `src/admin/time-clock-admin.ts:127-130,192-216`; `app/(admin)/admin/time-clock/page.tsx:173-193,392,406`.
- Provenance marked on bench, report and the crew's own list; admin edit stamps and leaves origin alone; crew edit does not stamp — `app/(admin)/admin/time-clock/page.tsx:411-415`; `app/(admin)/admin/payroll/page.tsx:416-418`; `src/crewapp/time-view.ts:149`; `src/crew/time-clock.ts:274-282`; `src/crew/time-clock-crew.ts:115`.
- "On the clock since" is render-time, no counter — `app/(crew)/crew/time/page.tsx:156`; `src/crewapp/time-view.ts:33`.
- Crew can punch only themselves; subject from the session, no crew id in any form; forged id answers `gone` like a nonexistent one — `app/(crew)/crew/time/actions.ts:60-61,89-90,140-141,188-189,228-229`; `src/crew/time-clock-crew.ts:52-60,104,198`.
- Reason required on all three crew doors; trail row has no FK to the punch and is append-only — `src/crew/time-clock-crew.ts:105,152,199`; `db/migrations/20260801180000_time_punch_edits.sql:15-20,29-31`; `src/adapters/postgres-repository.ts:1128-1139`; contract `src/adapters/repository-contract.ts:557-578`.
- Ids minted per request, so upsert-by-id never collides — `app/(admin)/admin/time-clock/actions.ts:113`; `app/(crew)/crew/time/actions.ts:70,157,190,206,236`.
- Every error code mapped to copy on both surfaces; failed writes logged and surfaced, never success-looking — `app/(admin)/admin/time-clock/page.tsx:69-78`, `actions.ts:119-123,175-178,199-202`; `app/(crew)/crew/time/page.tsx:63-76`, `actions.ts:75-81,103-106,166-169,214-217,242-245`.
- `TIME_CLOCK` off: pages `notFound()`, `gusto.csv` 404, every action gated, structurally tested — `app/lib/flags.ts:52-54`; `app/(admin)/admin/time-clock/page.tsx:88`; `app/(crew)/crew/time/page.tsx:85`; `app/(admin)/admin/payroll/gusto.csv/route.ts:26-28`; `app/lib/time-clock-gate.test.ts:65-77`.
- Tip denominator: required, Confirmed, assigned, deduped; seat kinds are exactly `required | supernumerary` and a trainee is supernumerary — `src/admin/gratuity-payroll.ts:112-116`; `src/domain/states.ts:66`; `docs/decisions/DEC-087*.md:12`; tests `gratuity-payroll.test.ts:186-229`.
- Exact integer cents, remainder to the first `pool mod n` crew by sorted id, summed per crew across events — `src/admin/gratuity-payroll.ts:60-75`; test `:43-55`.
- Pool with a crew-less live shift warned, unsplit, excluded from totals; warning reaches the page in both modes — `src/admin/gratuity-payroll.ts:65-67,74`; `app/(admin)/admin/payroll/page.tsx:190-198,384-392`; tests `:68-76,219-229`. A split day's "born fresh" side B is this case by design (`src/builder/form-shifts.ts:302-303,560-565`).
- Only `booked` reservations; a cancellation excludes — `src/admin/gratuity-payroll.ts:125-131`; `src/reservations/cancel-reservation.ts:241-243`.
- Comp writes no tip; the report shows $0 — `src/reservations/booking-webhook.ts:920`; `src/reservations/confirm-booking.ts:103`.
- Gratuity write is idempotent on webhook redelivery — `src/reservations/booking-webhook.ts:904-913,921-932`; `src/adapters/postgres-repository.ts:2010-2015`; `src/reservations/gratuity.test.ts:136-145`.
- Per-crew tips identical on the page, `gusto.csv` and `tips.csv`: one builder, integer cents, one `toFixed(2)` — `src/admin/payroll-reconcile.ts:129,136,174,244`; `app/(admin)/admin/payroll/tips.csv/route.ts:23`.
- Crew cannot see the tip anywhere — no `tip` or `gratuit` reader under `app/(crew)/**`, `src/crewapp/**`, `components/crew/**` (grep).
- Refund bases for operator, customer and insured cancellations include the tip — `src/reservations/refund-terms.ts:57-64,85-89,102-104`; `src/reservations/cancel-reservation.ts:77-81`.
- No `UNIQUE` on `shifts(vessel_id, date)`; the vessel+date uniques are on `events`, `checkout_holds`, `reservations` — `db/migrations/0001_init.sql:92-95`; `20260718142705:28-30,46-48`; `20260905031117:43-44`. Split partition is disjoint and merge removes side B — `src/builder/form-shifts.ts:307-308,629`; `src/builder/merge.ts:80-83`.
- `?day=` finds every punch whose `inAt` is on that vessel-local day regardless of shift or crew; `?crew=&period=` uses the report's window — `src/admin/time-clock-admin.ts:163-178`; `app/(admin)/admin/time-clock/page.tsx:105-107`.
- Crew period total, bench period total and the report row agree on the window and the open-punch exclusion, including an 11:30 pm EDT last-day punch — `src/crewapp/time-view.ts:110-114`; `src/admin/time-clock-admin.ts:92-97`; `src/admin/time-clock-report.ts:148-153`.
- Nothing computes hours from wall-clock strings — grep for `split(":")` in non-test `src/` hits only `src/rate-limit/*` and `src/reservations/hull-busy.ts:61`.

## 4. What could not be determined from the code

- **Nothing was executed under vitest.** Every probe in Appendix A was written, denied a run, and
  deleted. Arithmetic and DST traces were re-run in plain node where noted; Postgres-shaped
  behaviour was not run at all.
- **Postgres.** The partial unique index under concurrency, `on delete restrict` on
  `crew_member_id`, trail survival on the real table, the collation under which `in_at` text
  compares, and the row order of `select * from shifts` (matters only for F5).
- **Gusto.** Whether Gusto dedupes a re-imported row (F7, F12), how it treats a `0.00`/`0.00` row
  (F12), and whether two-decimal `regular_hours` is the format it wants (the module itself defers
  this to #628). Nothing about the import format was guessed.
- **Deployed values.** `TENANT_TZ`, `PAY_PERIOD_ANCHOR` and `TIME_CLOCK` live in the host's env.
- **Reachability.** Whether a stale shift row listing a moved event can survive in production (F5);
  whether the cockpit or split/merge UI offers `manualOverride` or `mergeShift` on a past day (F17);
  whether a non-Cancelled shift with zero scheduled events is reachable outside the importer (F22);
  whether any real event departs between 00:00 and 00:44 (F20).
- **Notification.** No push or notification code references punches (grep), so an admin edit or
  delete is believed to reach the crew member only through the "edited by the office" line; the
  notification layer was not read end to end.
- **Sibling decisions.** `gratuity-payroll.ts` cites `xola-tip-extractor`'s DEC-002/017; that repo
  is not on disk and was not read. This repo's DEC-124 is `status: withdrawn` and carries no split
  rules beyond "Muster splits and exports its own tips".

## Appendix A — probe tests (written, denied a run, deleted; not in the repo)

Each file was placed beside its module as `<module>.audit-tmp.test.ts`, which the
`vitest.config.ts` include globs pick up. Run with `npx vitest run <path>` and delete afterwards.

### A.1 `src/crew/time-clock.audit-tmp.test.ts` — punches and edits

```ts
/** TEMPORARY audit probe — deleted after the run. */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, Event, Seat, Shift, TimePunch } from "../domain/entities.js";
import { addPunch, deletePunch, editPunch } from "./time-clock.js";
import { editOwnPunch } from "./time-clock-crew.js";
import { buildTimeClockReport } from "../admin/time-clock-report.js";
import { buildPayrollReconcile } from "../admin/payroll-reconcile.js";

const QUINT = asId<"CrewMemberId">("crew-quint");
const CAP = asId<"RoleTypeId">("role-captain");
const V = asId<"VesselId">("vessel-1");
const pid = (s: string) => asId<"TimePunchId">(s);
const NOW = new Date("2026-07-20T12:00:00Z");
const WINDOW = { from: "2026-07-06", to: "2026-07-19" };

const member = (): CrewMember => ({
  id: QUINT, name: "Quint", phone: "+15035550100", ratings: [CAP], status: "active", reliabilityScore: null,
});
const closed = (id: string, inAt: string, outAt: string | null, over: Partial<TimePunch> = {}): TimePunch => ({
  id: pid(id), crewMemberId: QUINT, inAt, outAt, shiftId: null, origin: "crew", adminEditedAt: null, ...over,
});

describe("audit: admin edits/deletes leave NO trail row", () => {
  it("admin editPunch stamps adminEditedAt but appends nothing to time_punch_edits", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(member());
    await repo.saveTimePunch(closed("p1", "2026-07-07T13:00:00Z", "2026-07-07T21:00:00Z"));
    const r = await editPunch(repo, pid("p1"), { outAt: new Date("2026-07-07T17:00:00Z"), now: NOW });
    expect(r.ok).toBe(true);
    expect((await repo.getTimePunch(pid("p1")))!.adminEditedAt).toBe(NOW.toISOString());
    expect(await repo.listTimePunchEdits(pid("p1"))).toEqual([]);
  });
  it("admin deletePunch erases the hours with no remaining evidence", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(member());
    await repo.saveTimePunch(closed("p1", "2026-07-07T13:00:00Z", "2026-07-07T21:00:00Z"));
    await deletePunch(repo, pid("p1"));
    expect(await repo.getTimePunch(pid("p1"))).toBeNull();
    expect(await repo.listTimePunchEdits(pid("p1"))).toEqual([]);
    expect(await repo.listAllTimePunches()).toEqual([]);
  });
});

describe("audit: duplicates", () => {
  it("two identical closed punches (double-submit, fresh ids) are both stored and caught as an overlap", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(member());
    const input = { crewMemberId: QUINT, inAt: new Date("2026-07-07T13:00:00Z"), outAt: new Date("2026-07-07T21:00:00Z"), now: NOW };
    expect((await addPunch(repo, { id: pid("a"), ...input })).ok).toBe(true);
    expect((await addPunch(repo, { id: pid("b"), ...input })).ok).toBe(true);
    const rep = await buildTimeClockReport(repo, WINDOW);
    expect(rep.rows[0]!.minutes).toBe(960);
    expect(rep.rows[0]!.overlapDays).toEqual(["2026-07-07"]);
    expect((await buildPayrollReconcile(repo, WINDOW)).exportBlocked).toBe(true);
  });
  it("editPunch re-opening a punch has NO application-level already_in check — in-memory ends with two open punches", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(member());
    await repo.saveTimePunch(closed("p1", "2026-07-07T13:00:00Z", "2026-07-07T21:00:00Z"));
    await repo.saveTimePunch(closed("p2", "2026-07-08T13:00:00Z", null));
    const r = await editPunch(repo, pid("p1"), { outAt: null, now: NOW });
    expect(r.ok).toBe(true);
    expect((await repo.listTimePunchesForCrew(QUINT)).filter((p) => p.outAt === null)).toHaveLength(2);
  });
});

describe("audit: trail row is not atomic with the punch write", () => {
  it("editOwnPunch: punch changed, append throws → caller sees an error, punch stays changed, no trail", async () => {
    const inner = new InMemoryRepository();
    await inner.saveCrewMember(member());
    await inner.saveTimePunch(closed("p1", "2026-07-07T13:00:00Z", "2026-07-07T21:00:00Z"));
    const repo = new Proxy(inner, {
      get(t, k, rcv) {
        if (k === "appendTimePunchEdit") return async () => { throw new Error("db down"); };
        return Reflect.get(t, k, rcv);
      },
    }) as unknown as InMemoryRepository;
    await expect(
      editOwnPunch(repo, { editId: asId<"TimePunchEditId">("e1"), punchId: pid("p1"), crewMemberId: QUINT,
        outAt: new Date("2026-07-08T01:00:00Z"), reason: "forgot", now: NOW }),
    ).rejects.toThrow("db down");
    expect((await inner.getTimePunch(pid("p1")))!.outAt).toBe("2026-07-08T01:00:00.000Z");
    expect(await inner.listTimePunchEdits(pid("p1"))).toEqual([]);
  });
});

describe("audit: provenance after a crew edit follows an admin edit", () => {
  it("crew's later edit keeps the admin stamp", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(member());
    await repo.saveTimePunch(closed("p1", "2026-07-07T13:00:00Z", "2026-07-07T21:00:00Z"));
    await editPunch(repo, pid("p1"), { outAt: new Date("2026-07-07T20:00:00Z"), now: NOW });
    const r = await editOwnPunch(repo, { editId: asId<"TimePunchEditId">("e1"), punchId: pid("p1"), crewMemberId: QUINT,
      outAt: new Date("2026-07-08T01:00:00Z"), reason: "I stayed late", now: new Date("2026-07-21T12:00:00Z") });
    expect(r.ok).toBe(true);
    const p = (await repo.getTimePunch(pid("p1")))!;
    expect(p.adminEditedAt).toBe(NOW.toISOString());
    expect(p.outAt).toBe("2026-07-08T01:00:00.000Z");
  });
  it("a crew-origin, crew-edited punch carries no flag at all on the report", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(member());
    await repo.saveTimePunch(closed("p1", "2026-07-07T13:00:00Z", "2026-07-07T21:00:00Z"));
    await editOwnPunch(repo, { editId: asId<"TimePunchEditId">("e1"), punchId: pid("p1"), crewMemberId: QUINT,
      outAt: new Date("2026-07-08T01:00:00Z"), reason: "stayed late", now: NOW });
    const rep = await buildTimeClockReport(repo, WINDOW);
    expect(rep.rows[0]!.minutes).toBe(720);
    expect(rep.rows[0]!.touchedByAdmin).toBe(false);
    expect(rep.rows[0]!.adminEditedCount).toBe(0);
  });
});

describe("audit: #638 and a non-Cancelled shift whose only event is cancelled", () => {
  it("is neither estimated nor missing — the day vanishes from both sides", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(member());
    const eventId = asId<"EventId">("ev1");
    const shiftId = asId<"ShiftId">("sh1");
    const event: Event = { id: eventId, vesselId: V, date: "2026-07-07", time: "13:00", capacity: 6, status: "cancelled", source: "xola" };
    const shift: Shift = { id: shiftId, vesselId: V, date: "2026-07-07", state: "Crewed", eventIds: [eventId] };
    const seat: Seat = { id: asId<"SeatId">("s1"), shiftId, role: CAP, kind: "required", state: "Confirmed", assignedCrewMemberId: QUINT };
    await repo.saveEvent(event); await repo.saveShift(shift); await repo.saveSeat(seat);
    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.rows).toEqual([]);
    expect(r.missingCount).toBe(0);
  });
});
```

### A.2 `src/admin/time-clock-report.audit-tmp.test.ts` — time, periods, DST, rounding

```ts
/** AUDIT TEMP — delete before finishing. Time / period / DST / rounding probes. */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, Event, Seat, Shift, TimePunch } from "../domain/entities.js";
import { addDays, vesselDateOf, zonedWallClockToInstant } from "../config/tenant.js";
import { currentPeriod, periodsForYear } from "./pay-periods.js";
import { decimalHours, hoursLabel, compactDuration } from "./hours-format.js";
import { buildTimeClockReport } from "./time-clock-report.js";
import { buildPayrollReconcile } from "./payroll-reconcile.js";
import { buildCrewTimeView } from "../crewapp/time-view.js";

const TZ = "America/New_York";
const QUINT = asId<"CrewMemberId">("crew-quint");
const crew = (id: string, name: string): CrewMember => ({
  id: asId<"CrewMemberId">(id), name, phone: "+15035550100",
  ratings: [asId<"RoleTypeId">("role-captain")], status: "active", reliabilityScore: null,
});
let seq = 0;
const punch = (inAt: string, outAt: string | null, crewId = "crew-quint"): TimePunch => ({
  id: asId<"TimePunchId">(`p-${++seq}`), crewMemberId: asId<"CrewMemberId">(crewId),
  inAt, outAt, shiftId: null, origin: "crew", adminEditedAt: null,
});
async function repoWith(punches: TimePunch[]) {
  const repo = new InMemoryRepository();
  await repo.saveCrewMember(crew("crew-quint", "Quint"));
  for (const p of punches) await repo.saveTimePunch(p);
  return repo;
}

describe("Q1 vesselDateOf / zonedWallClockToInstant across DST", () => {
  it("midnight instants on and around both 2026 transitions", () => {
    expect(zonedWallClockToInstant("2026-03-07", "00:00", TZ).toISOString()).toBe("2026-03-07T05:00:00.000Z");
    expect(zonedWallClockToInstant("2026-03-08", "00:00", TZ).toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(zonedWallClockToInstant("2026-03-09", "00:00", TZ).toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(zonedWallClockToInstant("2026-11-01", "00:00", TZ).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(zonedWallClockToInstant("2026-11-02", "00:00", TZ).toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
  it("every day of 2026: midnight instant round-trips, and 1ms before it is the previous day", () => {
    let d = "2026-01-01";
    while (d <= "2026-12-31") {
      const mid = zonedWallClockToInstant(d, "00:00", TZ);
      expect(vesselDateOf(mid, TZ), d).toBe(d);
      expect(vesselDateOf(new Date(mid.getTime() - 1), TZ), d).toBe(addDays(d, -1));
      const next = zonedWallClockToInstant(addDays(d, 1), "00:00", TZ);
      const hours = (next.getTime() - mid.getTime()) / 3_600_000;
      expect(hours, d).toBe(d === "2026-03-08" ? 23 : d === "2026-11-01" ? 25 : 24);
      d = addDays(d, 1);
    }
  });
  it("addDays is pure date math across month/year/leap boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("Q2 period windows tile the timeline; a punch is in exactly one period", () => {
  it("period N's upper instant === period N+1's lower instant, all of 2026 incl. DST weeks", () => {
    const ps = periodsForYear("2026-01-05", 2026);
    for (let i = 1; i < ps.length; i++) {
      const upper = zonedWallClockToInstant(addDays(ps[i - 1]!.end, 1), "00:00", TZ).toISOString();
      const lower = zonedWallClockToInstant(ps[i]!.start, "00:00", TZ).toISOString();
      expect(upper).toBe(lower);
    }
  });
  it("a punch at exactly 00:00:00.000 local on day to+1 is in the NEXT period only; 1ms earlier in THIS one only", async () => {
    const repo = await repoWith([
      punch("2026-07-20T04:00:00.000Z", "2026-07-20T06:00:00.000Z"),
      punch("2026-07-20T03:59:59.999Z", "2026-07-20T05:00:00.000Z"),
    ]);
    const a = await buildTimeClockReport(repo, { from: "2026-07-06", to: "2026-07-19" });
    const b = await buildTimeClockReport(repo, { from: "2026-07-20", to: "2026-08-02" });
    expect(a.rows[0]!.punchCount).toBe(1);
    expect(a.rows[0]!.minutes).toBeCloseTo(60 + 1 / 60000, 6);
    expect(b.rows[0]!.punchCount).toBe(1);
    expect(b.rows[0]!.minutes).toBe(120);
  });
  it("a punch whose inAt is before the window and outAt inside is NOT in this window", async () => {
    const repo = await repoWith([punch("2026-07-20T02:00:00.000Z", "2026-07-20T06:00:00.000Z")]);
    const next = await buildTimeClockReport(repo, { from: "2026-07-20", to: "2026-08-02" });
    expect(next.rows).toHaveLength(0);
    const prev = await buildTimeClockReport(repo, { from: "2026-07-06", to: "2026-07-19" });
    expect(prev.rows[0]!.minutes).toBe(240);
  });
  it("HAZARD: a non-toISOString shape at the boundary instant is bucketed by string order, not by instant", async () => {
    const repo = await repoWith([punch("2026-07-20T04:00:00+00:00", "2026-07-20T06:00:00+00:00")]);
    const a = await buildTimeClockReport(repo, { from: "2026-07-06", to: "2026-07-19" });
    const b = await buildTimeClockReport(repo, { from: "2026-07-20", to: "2026-08-02" });
    console.log("'+00:00' shape at boundary: prev rows", a.rows.length, "next rows", b.rows.length,
      "vesselDateOf says", vesselDateOf(new Date("2026-07-20T04:00:00+00:00"), TZ));
    const view = await buildCrewTimeView(repo, QUINT, new Date("2026-07-21T12:00:00Z"));
    console.log("crew view period", view.period, "punches", view.punches.length);
  });
});

describe("Q3 midnight-spanning & DST-spanning punches", () => {
  it("spring-forward: 01:30 EST → 03:30 EDT is 60 real minutes (wall clock says 120)", async () => {
    const repo = await repoWith([punch("2026-03-08T06:30:00.000Z", "2026-03-08T07:30:00.000Z")]);
    const r = await buildTimeClockReport(repo, { from: "2026-03-02", to: "2026-03-15" });
    expect(r.rows[0]!.minutes).toBe(60);
  });
  it("estimate vs punch calendar: a trip departing 00:15 has call time 23:30 the day BEFORE shift.date", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-quint", "Quint"));
    const V = asId<"VesselId">("v1");
    const event: Event = { id: asId<"EventId">("e1"), vesselId: V, date: "2026-07-20", time: "00:15", capacity: 6, status: "scheduled", source: "xola" };
    const shift: Shift = { id: asId<"ShiftId">("s1"), vesselId: V, date: "2026-07-20", state: "Crewed", eventIds: [event.id] };
    const seat: Seat = { id: asId<"SeatId">("seat1"), shiftId: shift.id, role: asId<"RoleTypeId">("role-captain"), kind: "required", state: "Confirmed", assignedCrewMemberId: QUINT };
    await repo.saveEvent(event); await repo.saveShift(shift); await repo.saveSeat(seat);
    await repo.saveTimePunch(punch("2026-07-20T03:30:00.000Z", "2026-07-20T06:00:00.000Z"));
    const prev = await buildPayrollReconcile(repo, { from: "2026-07-06", to: "2026-07-19" });
    const next = await buildPayrollReconcile(repo, { from: "2026-07-20", to: "2026-08-02" });
    console.log("prev period:", prev.rows[0], "\nnext period:", next.rows[0]);
  });
});

describe("Q4 anchor & year boundaries", () => {
  it("currentPeriod agrees with periodsForYear(year of today) for every day 2025-12-01..2027-01-31 (default anchor)", () => {
    let d = "2025-12-01";
    while (d <= "2027-01-31") {
      const cur = currentPeriod("2026-01-05", d);
      expect(cur.start <= d && d <= cur.end, d).toBe(true);
      const ps = periodsForYear("2026-01-05", Number(d.slice(0, 4)));
      expect(ps.some((p) => p.start === cur.start && p.end === cur.end), d).toBe(true);
      d = addDays(d, 1);
    }
  });
  it("a FUTURE anchor: currentPeriod clamps to the anchor's period; periodsForYear does not", () => {
    const cur = currentPeriod("2026-12-07", "2026-11-03");
    expect(cur).toEqual({ start: "2026-12-07", end: "2026-12-20" });
    const ps = periodsForYear("2026-12-07", 2026);
    expect(ps.some((p) => p.start <= "2026-11-03" && "2026-11-03" <= p.end)).toBe(true);
    expect(ps.some((p) => p.start === cur.start)).toBe(true);
  });
  it("a malformed anchor throws", () => {
    expect(() => currentPeriod("2026-1-5", "2026-11-03")).toThrow();
    expect(() => currentPeriod("garbage", "2026-11-03")).toThrow();
  });
});

describe("Q5 rounding: screen vs file", () => {
  it("480.4 min: screen 8h 0m, file 8.01", () => {
    expect(hoursLabel(480.4)).toBe("8h 0m");
    expect(compactDuration(480.4)).toBe("8h");
    expect(decimalHours(480.4)).toBe("8.01");
  });
  it("two rows of 480.4: rows 8h 0m each, screen Total 16h 1m; file rows 8.01 + 8.01", () => {
    expect(hoursLabel(480.4 + 480.4)).toBe("16h 1m");
    expect(decimalHours(480.4)).toBe("8.01");
    expect(decimalHours(481)).toBe("8.02");
    expect(hoursLabel(480.6)).toBe("8h 1m");
    expect(decimalHours(480.6)).toBe("8.01");
  });
  it("Math.round on negative halves is never reached — deltaLabel takes abs", () => {
    expect(Math.round(-0.5)).toBe(-0);
    expect(Math.round(-1.5)).toBe(-1);
  });
});
```

Note on the first Q4 test: with the default anchor every day in that range is after it, so the
clamp never fires; the test's purpose is the `periodsForYear` agreement at both year seams.

### A.3 `src/admin/gratuity-payroll.audit-tmp.test.ts` — the tip pool

```ts
/** TEMPORARY audit probe — deleted after the run. */
import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { CrewMember, Gratuity, Seat, Shift } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { refundReservation } from "../reservations/refund-payment.js";
import { buildGratuityPayroll, splitGratuity } from "./gratuity-payroll.js";

const evId = (s: string) => asId<"EventId">(s);
const RES = asId<"ReservationId">("resv-1");
const CREW_A = asId<"CrewMemberId">("crew-ann");
const CREW_B = asId<"CrewMemberId">("crew-bob");
const SHIFT = asId<"ShiftId">("shift-v-1-2026-07-04");
const VESSEL = asId<"VesselId">("v-1");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const WINDOW = { from: "2026-07-01", to: "2026-07-31" };

const grat = (amountCents: number): Gratuity => ({
  id: asId<"GratuityId">("grat_pre_pi_1"), eventId: evId("evt-1"), reservationId: RES,
  kind: "pre", amountCents, createdAt: "2026-07-04T12:00:00.000Z",
});
const crew = (id: typeof CREW_A, name: string): CrewMember => ({
  id, name, phone: "+1", ratings: [CAPTAIN], status: "active", reliabilityScore: null,
  gusto: { firstName: name, lastName: "X", title: "Captain", employeeId: `E-${name}` },
});
const seat = (id: string, who: typeof CREW_A): Seat => ({
  id: asId<"SeatId">(id), shiftId: SHIFT, role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: who,
});

async function base(opts: { shift?: Shift | null } = {}): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveCrewMember(crew(CREW_A, "Ann"));
  await repo.saveCrewMember(crew(CREW_B, "Bob"));
  await repo.saveEvent({ id: evId("evt-1"), vesselId: VESSEL, date: "2026-07-04", time: "13:30", capacity: 12, status: "scheduled", source: "muster", price: 49900 });
  if (opts.shift !== null) {
    await repo.saveShift(opts.shift ?? { id: SHIFT, vesselId: VESSEL, date: "2026-07-04", state: "Completed", eventIds: [evId("evt-1")] });
    await repo.saveSeat(seat("s-a", CREW_A));
    await repo.saveSeat(seat("s-b", CREW_B));
  }
  await repo.saveReservation({ id: RES, eventId: evId("evt-1"), source: "muster", customerName: "Mary", partySize: 4, status: "booked" });
  await repo.saveGratuity(grat(9980)); // 20% of $499
  return repo;
}

describe("audit: silent drops", () => {
  it("Q4a: a booked reservation's tip whose event has NO shift row vanishes with no warning", async () => {
    const repo = await base({ shift: null });
    const out = await buildGratuityPayroll(repo, WINDOW);
    expect(out.rows).toEqual([]);
    expect(out.totalCents).toBe(0);
    expect(out.warnings).toEqual([]); // <- the silent part
  });
  it("Q4b: a booked reservation on a CANCELLED shift with confirmed crew — no row, no warning", async () => {
    const repo = await base({ shift: { id: SHIFT, vesselId: VESSEL, date: "2026-07-04", state: "Cancelled", eventIds: [evId("evt-1")] } });
    const out = await buildGratuityPayroll(repo, WINDOW);
    expect(out.rows).toEqual([]);
    expect(out.warnings).toEqual([]);
  });
});

describe("audit: refund without cancel", () => {
  it("Q2: a FULL refund on a booked reservation leaves it booked and the whole tip still pays out", async () => {
    const repo = await base();
    await repo.savePayment({
      id: asId<"PaymentId">("pay_pi_1"), reservationId: RES, method: "stripe", kind: "full",
      amountCents: 65294, taxCents: 3618, gratuityCents: 9980, serviceFeeCents: 1796,
      currency: "usd", stripePaymentIntentId: "pi_1", status: "succeeded", createdAt: "2026-06-01T00:00:00.000Z",
    });
    const payments = new FakePaymentPort();
    const r = await refundReservation({ repo, payments, now: () => "2026-07-05T00:00:00.000Z" }, RES, 65294, 0);
    expect(r.ok).toBe(true);
    expect((await repo.getPayment(asId<"PaymentId">("pay_pi_1")))!.status).toBe("refunded");
    expect((await repo.getReservation(RES))!.status).toBe("booked"); // never flipped
    expect(await repo.listAllGratuities()).toHaveLength(1); // row untouched
    const out = await buildGratuityPayroll(repo, WINDOW);
    expect(out.totalCents).toBe(9980);
    expect(out.rows.map((x) => [x.name, x.tipCents])).toEqual([["Ann", 4990], ["Bob", 4990]]);
    expect(out.warnings).toEqual([]);
  });
});

describe("audit: remainder order", () => {
  it("Q5: `.sort()` is code-unit order — crew-10 outranks crew-2 for the extra cent", () => {
    const out = splitGratuity({
      gratuities: [{ ...grat(1001), eventId: evId("e1") }],
      crewByEvent: new Map([["e1", ["crew-2", "crew-10", "crew-3"]]]),
    });
    expect(out.perCrew.map((p) => [p.crewMemberId, p.cents])).toEqual([
      ["crew-10", 334], ["crew-2", 334], ["crew-3", 333],
    ]);
  });
});
```

### A.4 `src/admin/payroll-reconcile.audit-tmp.test.ts` — screens vs exports, split days

```ts
/** TEMPORARY audit probe — deleted after the run. Demonstrates numeric findings only. */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, Event, Gratuity, Seat, Shift, TimePunch } from "../domain/entities.js";
import { buildPayrollReconcile, gustoPayrollCsv } from "./payroll-reconcile.js";
import { buildGratuityPayroll } from "./gratuity-payroll.js";
import { buildTimeClockReport } from "./time-clock-report.js";
import { buildCrewPeriodView } from "./time-clock-admin.js";
import { buildCrewTimeView } from "../crewapp/time-view.js";
import { decimalHours, hoursLabel, compactDuration } from "./hours-format.js";

const CAP = asId<"RoleTypeId">("role-captain");
const V = asId<"VesselId">("vessel-1");
const WINDOW = { from: "2026-07-06", to: "2026-07-19" };
const PERIOD = { start: "2026-07-06", end: "2026-07-19" };
const crew = (id: string, name: string, employeeId?: string): CrewMember => ({
  id: asId<"CrewMemberId">(id), name, phone: "+15035550100", ratings: [CAP], status: "active", reliabilityScore: null,
  ...(employeeId ? { gusto: { firstName: name, lastName: "X", title: "Captain", employeeId } } : {}),
});
let seq = 0;
const punch = (crewId: string, inAt: string, outAt: string | null): TimePunch => ({
  id: asId<"TimePunchId">(`punch-${++seq}`), crewMemberId: asId<"CrewMemberId">(crewId), inAt, outAt, shiftId: null, origin: "crew", adminEditedAt: null,
});
const seat = (id: string, shiftId: string, crewId: string): Seat => ({
  id: asId<"SeatId">(id), shiftId: asId<"ShiftId">(shiftId), role: CAP, kind: "required", state: "Confirmed", assignedCrewMemberId: asId<"CrewMemberId">(crewId),
});
const event = (id: string, date: string, time: string): Event => ({ id: asId<"EventId">(id), vesselId: V, date, time, capacity: 6, status: "scheduled", source: "xola" });
const shift = (id: string, date: string, eventIds: string[], extra: Partial<Shift> = {}): Shift => ({ id: asId<"ShiftId">(id), vesselId: V, date, state: "Crewed", eventIds: eventIds.map((e) => asId<"EventId">(e)), ...extra });
const grat = (id: string, eventId: string, amountCents: number): Gratuity => ({ id: asId<"GratuityId">(id), eventId: asId<"EventId">(eventId), reservationId: asId<"ReservationId">(`resv-${id}`), kind: "pre", amountCents, createdAt: "2026-07-04T12:00:00.000Z" });
// Same arithmetic as `deltaLabel` in app/(admin)/admin/payroll/page.tsx:45-48.
const deltaLabel = (min: number) => (Math.abs(min) < 1 ? "even" : `${min > 0 ? "+" : "−"}${hoursLabel(Math.abs(min))}`);

describe("AUDIT Q2 — page label vs file column for the same minutes", () => {
  it("480.4 min and 489.5 min read differently on screen and in the file", () => {
    expect(hoursLabel(480.4)).toBe("8h 0m");
    expect(decimalHours(480.4)).toBe("8.01");
    expect(hoursLabel(489.5)).toBe("8h 10m"); // 8.1667h
    expect(decimalHours(489.5)).toBe("8.16");
  });
  it("two-person page total vs sum of file rows", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-a", "Ann", "E1"));
    await repo.saveCrewMember(crew("crew-b", "Bob", "E2"));
    await repo.saveTimePunch(punch("crew-a", "2026-07-07T13:00:00.000Z", "2026-07-07T13:30:18.000Z")); // 30.3 min
    await repo.saveTimePunch(punch("crew-b", "2026-07-07T13:00:00.000Z", "2026-07-07T13:30:18.000Z"));
    const r = await buildPayrollReconcile(repo, WINDOW);
    const csv = gustoPayrollCsv(r);
    const fileRows = csv.trim().split("\n").slice(1).map((l) => Number(l.split(",")[4]));
    expect(fileRows.reduce((s, x) => s + x, 0)).toBe(1.02);       // 0.51 + 0.51
    expect(hoursLabel(r.totalActualMinutes)).toBe("1h 1m");        // 60.6 min
    expect(decimalHours(r.totalActualMinutes)).toBe("1.01");
  });
  it("delta 'even' while Est and Actual columns visibly differ by a minute", () => {
    expect(hoursLabel(480)).toBe("8h 0m"); expect(hoursLabel(480.6)).toBe("8h 1m"); expect(deltaLabel(0.6)).toBe("even");
    expect(hoursLabel(480.4)).toBe("8h 0m"); expect(hoursLabel(481.6)).toBe("8h 2m"); expect(deltaLabel(1.2)).toBe("+0h 1m");
  });
  it("crew total, bench period total and report row agree on the window incl. an 11:30pm EDT last-day punch", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-a", "Ann", "E1"));
    await repo.saveTimePunch(punch("crew-a", "2026-07-20T03:30:00.000Z", "2026-07-20T05:00:00.000Z")); // 07-19 23:30 EDT → in
    await repo.saveTimePunch(punch("crew-a", "2026-07-06T03:59:00.000Z", "2026-07-06T05:00:00.000Z")); // 07-05 23:59 EDT → out
    await repo.saveTimePunch(punch("crew-a", "2026-07-10T13:00:00.000Z", null));                        // open → excluded
    const report = await buildTimeClockReport(repo, WINDOW);
    const bench = await buildCrewPeriodView(repo, asId<"CrewMemberId">("crew-a"), PERIOD);
    const crewView = await buildCrewTimeView(repo, asId<"CrewMemberId">("crew-a"), new Date("2026-07-15T12:00:00Z"), PERIOD);
    expect(report.rows[0]!.minutes).toBe(90); expect(bench.totalMinutes).toBe(90); expect(crewView.totalMinutes).toBe(90);
    expect(crewView.openCount).toBe(1); expect(bench.openCount).toBe(1);
  });
});

describe("AUDIT Q5 — split day", () => {
  it("two shifts on one date, person on both, no punch: shiftCount 2, missingCount 1 (copy says 'One shift')", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-a", "Ann", "E1"));
    await repo.saveEvent(event("am", "2026-07-07", "10:00")); await repo.saveEvent(event("pm", "2026-07-07", "17:00"));
    await repo.saveShift(shift("shift-vessel-1-2026-07-07", "2026-07-07", ["am"], { splitCutTime: "14:00" }));
    await repo.saveShift(shift("shift-vessel-1-2026-07-07-b", "2026-07-07", ["pm"]));
    await repo.saveSeat(seat("s-a", "shift-vessel-1-2026-07-07", "crew-a")); await repo.saveSeat(seat("s-b", "shift-vessel-1-2026-07-07-b", "crew-a"));
    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.missingCount).toBe(1); expect(r.rows[0]!.estimateMinutes).toBeGreaterThan(0);
  });
  it("person on side A only, one 09:00-20:00 punch; side-B tip pool goes unsplit (warning)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-a", "Ann", "E1"));
    await repo.saveEvent(event("am", "2026-07-07", "10:00")); await repo.saveEvent(event("pm", "2026-07-07", "17:00"));
    await repo.saveShift(shift("shift-vessel-1-2026-07-07", "2026-07-07", ["am"], { splitCutTime: "14:00" }));
    await repo.saveShift(shift("shift-vessel-1-2026-07-07-b", "2026-07-07", ["pm"]));
    await repo.saveSeat(seat("s-a", "shift-vessel-1-2026-07-07", "crew-a"));
    await repo.saveReservation({ id: asId<"ReservationId">("resv-g1"), eventId: asId<"EventId">("am"), source: "muster", customerName: "X", partySize: 4, status: "booked" });
    await repo.saveReservation({ id: asId<"ReservationId">("resv-g2"), eventId: asId<"EventId">("pm"), source: "muster", customerName: "Y", partySize: 4, status: "booked" });
    await repo.saveGratuity(grat("g1", "am", 1000)); await repo.saveGratuity(grat("g2", "pm", 2500));
    await repo.saveTimePunch(punch("crew-a", "2026-07-07T13:00:00.000Z", "2026-07-08T00:00:00.000Z"));
    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.rows[0]!.tipCents).toBe(1000); expect(r.totalTipCents).toBe(1000);
    expect(r.warnings.some((w) => w.includes("no confirmed crew"))).toBe(true);
  });
  it("an event listed on TWO non-cancelled shifts: tip denominator = later shift wins; estimate counts both", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-a", "Ann", "E1")); await repo.saveCrewMember(crew("crew-b", "Bob", "E2"));
    await repo.saveEvent(event("e1", "2026-07-07", "10:00"));
    await repo.saveShift(shift("shift-stale", "2026-07-07", ["e1"])); await repo.saveShift(shift("shift-fresh", "2026-07-07", ["e1"]));
    await repo.saveSeat(seat("s-a", "shift-stale", "crew-a")); await repo.saveSeat(seat("s-b", "shift-fresh", "crew-b"));
    await repo.saveReservation({ id: asId<"ReservationId">("resv-g1"), eventId: asId<"EventId">("e1"), source: "muster", customerName: "X", partySize: 4, status: "booked" });
    await repo.saveGratuity(grat("g1", "e1", 1000));
    const tips = await buildGratuityPayroll(repo, WINDOW);
    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(tips.rows.map((x) => x.name)).toEqual(["Bob"]);          // Ann silently loses the pool
    expect(r.rows.every((x) => x.estimateMinutes > 0)).toBe(true);  // both get estimate for the same trip
  });
});
```
