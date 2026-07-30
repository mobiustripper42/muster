---
id: DEC-144
title: "Completion is swept by the tick, and a self-claim scores"
topic: "Seats, shifts & state machine"
amends:
  - id: DEC-078
    relation: corrects
    scope: "only the clause 'a claim itself emits no reliability event' — a winning self-claim now logs `self_claim` (+4). The adjacent 'Rejected: reliability-dinging the claim' line is untouched and still stands; that rejected a PENALTY, and this is the opposite direction."
amends_spec:
  - section: "1.4"
    scope: "`self_claim` joins the Commitment event list, and `shift_completed` finally has a producer — the tick's completion sweep. Both were declared loggable from day one and neither was ever emitted."
---

## DEC-144: Completion is swept by the tick, and a self-claim scores

**Decision:**

- **The tick completes shifts.** A live shift whose derived end (`shiftEndFromEvents` — the latest
  trip *end* plus `TEARDOWN_MINUTES`, DEC-041) has passed, and which still holds at least one
  `Confirmed` **required** seat, advances to `Completed`, fanning out one `shift_completed` per
  occupant of those seats. Supernumerary and trainee seats are excluded (DEC-087) — they rode, they
  didn't crew it. The sweep sits **above** the past-trip guard (DEC-062/#147), which is precisely why
  nothing ever set `Completed`: that guard `continue`s past departed shifts, and a departed shift is
  the only kind that can complete.
- **A shift nobody crewed is left alone.** No occupants means no `Completed` and no events, rather
  than a state change that mints `+5`s for an empty boat. The operator decides what happened; the
  At-Risk trail already records it.
- **Not gated on the shift's own state.** `Pending` is claimable (DEC-078 as widened by #440), so a
  shift that never entered the staffing window can still have been crewed by a self-claim and really
  have run.
- **A winning self-claim logs `self_claim`, weighted +4.** Only on the CAS win — a loser of the race
  acquired nothing. Resulting value per shift by acquisition path: self-claimed & worked **+9**,
  ask-won & worked +7, operator-placed & worked +5.
- **Trip length is per-event and frozen.** `Event.durationMinutes` is seeded from the running
  `Offering.tripLengthMinutes` when the booking materializes the slot, and never resolved from the
  offering on read. Absent ⇒ the flat `TRIP_DURATION_MINUTES` fallback, which is every Xola-sourced
  event, permanently.
- **A completed shift stays VISIBLE everywhere; only ACTIONS are refused.** The split is the rule:
  display surfaces keep it (the shifts board, the crew's My Shifts, the shift thread, the calendar
  feed), and engine/action surfaces keep excluding it (asks, drip, lean, escalation, the At-Risk
  board, the warming watchlist, and the crew's open-asks list — an unanswered ask for a trip that
  already sailed is a phantom). **Bailing a completed shift is refused outright** (`shift_over`).
- **A terminal state is never re-derived for display.** The seat-folding resolver can only produce
  Pending/Filling/Crewed/AtRisk, so a `Completed` shift resolved on read comes back **`Crewed`** —
  a finished trip presenting as a live one. The board keeps the persisted state verbatim, extending
  the guard #416 already added for `Cancelled`.

**Why:** Two of the three behaviors the operator wants to reward emitted no event at all, so
answering asks was the only thing that moved a score. Ranked against shifts actually held — the
operator's stated ground truth — the two hardest-working crew sat **16th and 13th of 20**, while two
crew with one shift each sat 3rd and 4th on accumulated `ask_declined` credit. Completion is the
dominant term: it alone cut total rank displacement from 106 to 32. `self_claim` adds little to rank
*fit*, because self-claimers complete those shifts anyway and completion already counts them; it is
carried as a **leading indicator**, since someone who picks up five shifts next month should rank up
before any of them run, which a past-seat measure structurally cannot see.

**The asymmetry is the actual bug.** DEC-078 had reliability "earned at `Completed`" — but nothing
ever set `Completed`, while self-*release* had shipped and routes through the bail edge (−3 plus a
lateness ramp). So the engine could subtract from a self-server who dropped a shift and never add for
one who worked it. Self-serve was all downside, for a year, silently.

**Claim-then-release is weakly self-limiting, not closed — and that is accepted, not overlooked.**
A release runs the bail edge, but `bailLatenessMs` clamps to zero once notice exceeds the staffing
lead, so a release seven or more days out takes only the flat −3 and the pair nets **+1**; at
departure it nets −7.4. The claimable window is 45 days against a 7-day lead, so most of it sits in
the +1 zone. What blunts it is the **count-based** window: the pair burns two of the forty slots to
earn +1, where simply answering an ask "out" earns +1 in one slot — so churning claims ranks worse
per slot than ordinary responsiveness, and the exploit is dominated by behavior we already want.
Accepted at pilot scale. **Revisit if:** a real claim-release churn pattern shows up in the log; the
hard fix is pairing a `self_claim` to its own seat's later bail in the scorer, which the flat
per-event fold deliberately cannot express today.

**Visible, not hidden — and the reason the question came up at all.** Every surface already carried a
defensive `Completed` guard, written when nothing could ever set the state, so all of them were dead
code that turned live at once. Most were labelled "historical" and dropped the shift. That is wrong:
a shift completes when its own trips finish, which for a same-day trip is *that evening*, so hiding
it makes a trip the operator watched all day vanish from the board mid-day-view, deletes tonight's
shift off the crew member's own list, and — on a **subscribed** calendar feed — retroactively removes
work they actually did from every client. The useful distinction is not live-vs-historical but
**display vs action**: a finished shift is a true fact worth showing and an invalid thing to ask,
lean, escalate, or bail against.

**Reliability-grade, deliberately not money-grade.** The sweep asserts that a scheduled trip's clock
ran out with crew still assigned. Nobody asserts the boat left the dock. That is enough to order an
ask queue and it is **not** enough to release money — direct-to-crew tip distribution needs a real
departure signal or a human, and that is a separate build with a separate event. Naming this
`Completed` and then hanging payouts off it later, without revisiting the evidence, is the failure
mode this paragraph exists to prevent.

**Why per-event duration rather than reading the offering.** A flat fleet-wide trip length made
`latestStart + duration` and `max(start + duration)` the same expression; with real durations they
diverge, and a shift running a long charter at noon plus a short sunset in the evening would read as
finished while the charter was still on the water. Freezing the value on the event — the same posture
as `price` (DEC-125) and the reservation's `extrasCents` (#474) — means re-configuring an offering
next season cannot rewrite how long last season's shifts were, and so cannot rewrite who earned
reliability on them. It is also what makes a post-booking extra-time upsell expressible: that writes
the event's duration, and the shift end, the sweep, and the crew's hours all follow.

**Tradeoff:** the flat fallback still governs every Xola event, so completion timing for those is
approximate by exactly the amount it always was. **Rejected:** an operator "mark complete" action (a
daily chore that gets skipped, and a skipped completion silently withholds the `+5` — the same class
of bug as this one); `Offering.holdMinutes` as the shift-end basis (it is write-only config today,
read by nothing); a compensating event type to net against bad history; hiding completed shifts as
"historical" (see above). **Revisit if:** money is ever hung off completion — then it needs its own
evidence, not this one. **Phase:** 12.
