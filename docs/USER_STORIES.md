# Muster — User Stories

Story IDs use a per-role prefix: **SP** (Spink, operator), **CR** (Crew), **DR** (Drew, owner).
Cross-reference with `docs/SPEC.md` (the surface each story maps to) and `docs/PROJECT_PLAN.md`.
Roles and surfaces are defined in SPEC §0.4 and §2.

---

## Spink — the operator (admin app)

Semi-retired. The throughline: **no babysitting** — the system works shifts on its own and only
summons him when it genuinely can't.

### Roster / People (SPEC §2.1)
- SP-1: I add a crew member with name, phone, and ratings so the oracle has someone to reason over.
- SP-2: I record a crew member's MMC (and medical/TWIC if needed) with its expiry so they drop out
  of the pool automatically once it lapses — I never discover it at the dock.
- SP-3: I set a manual **boost or floor** on a veteran so a slow couple of months doesn't sink
  someone I trust.
- SP-4: I add a PTO/blackout window so a crew member stops being asked during it — without ever
  maintaining a positive-availability calendar.

### Shift Builder (SPEC §2.3)
- SP-5: I see shifts **already auto-formed** from the week's events (one boat, one day) so my Monday
  is a review pass, not a build-from-blank.
- ~~SP-6: I **lock** a reviewed shift so crewing may proceed; inside the staffing horizon, locking
  fires the asks.~~ — **CUT (DEC-082).** Muster sits next to Xola, which is the source of truth for
  bookings, so a "reviewed/locked" stamp over Xola-derived data is meaningless. The column was
  dropped in `0022_drop_shifts_locked_at.sql`. Asks fire on the staffing horizon, no lock step.
- ~~SP-7: When a late booking lands on a locked shift, I get a "changed since you reviewed it" nudge
  so I'm never blindsided. *(fast-follow — Pass C)*~~ — **Precondition removed with SP-6.** The
  underlying want (don't get blindsided by a late booking) is still live; it just can't be framed
  against a lock. Re-file it if it matters.

### Assignment View (SPEC §2.4)
- SP-8: I watch the system work a shift's seats (asked top mates, 2 declined, waiting on 3) and
  rarely have to step in.
- SP-9: I see a **silent** candidate as visually distinct from a **declined** one, because silence
  is the thing I hate.
- SP-10: I take over and manually assign or override any seat when I know something the system
  doesn't (especially captains).

### At-Risk Board (SPEC §2.5)
- SP-11: I get **pinged** when a shift can't be auto-crewed so I go there when summoned — I don't
  monitor a dashboard. An empty board is success.
- SP-12: I see the **escalation trail** (asked 6, 4 declined, 2 silent, nudged Bob, exhausted) so I
  trust the system gave up for real reasons.
- SP-13: I **lean / reschedule / cancel** from the board, with the cancel fallout made easy and
  informed — that's the 11pm decision that keeps me up. *(cancel cascade is 2027 / parked)*

### Coexistence (SPEC §3.5)
- SP-14: I get a weekend "enter these in Xola" sheet so I key crew assignments from one list — *only
  if* the Xola export doesn't already carry guest detail (decided at M1).

### Crew Self-Serve (SPEC §2.7)
- SP-15: Mates self-fill so I stop blasting Sunday texts; the cascade still chases the seats nobody
  grabbed (mostly captains); and I can still drop a dual-rated captain into a mate seat at the last
  minute when I'm stuck.
- SP-16: A self-claim locks the seat immediately, but I can still see and override it, and I have a
  switch to require my confirmation later if auto-lock ever bites me.

## Crew — captains and mates (crew app)

Their entire world is three surfaces. The failure mode is friction and stale info, not missing
features (SPEC §2.6).

- CR-1: I get the ask as a push/SMS and answer **yes or no in ~3 seconds without opening or logging
  into anything**.
- CR-2: I land on the right shift via a **magic link** — no password to forget.
- CR-3: I see my **confirmed upcoming shifts**, one card each, past stuff hidden.
- CR-4: On the shift card I see **call time distinct from departure time**, a tappable dock pin, who
  else is crewing with one-tap contact, and the **per-event guest manifest** (1/3/5pm lists) — no
  waivers.
- CR-5: I **bail** as easily as I accepted, and the seat immediately re-asks the next person, so I
  never ghost.
- CR-6: I get a quiet **nudge before my MMC/medical expires** so I renew before dropping from the
  pool.
- CR-7: I see **my own** reliability standing and reasons — never a ranking against other crew.
- CR-8: I open the app, see the boats that need my role this weekend, tap one, and it's mine —
  **without waiting for a text** (SPEC §2.7).
- CR-9: When I claim a day, the confirm screen tells me plainly it's the **whole day** on that boat
  including trips added later, with the current trips and my call/back times, so I know exactly what
  I'm agreeing to.
- CR-10: When my plans change, I **release** a claimed day as easily as I grabbed it, and it
  immediately re-opens for someone else.

## Drew — the owner

Mostly out of the 2026 build; owns money/policy decisions that are parked.
- DR-1: I decide deposit-vs-full and the refund schedule. *(~~parked — payments are 2027~~ —
  **payments landed in 2026.** DEC-105 reopened the customer portal; **deposit-vs-full is DECIDED —
  deposit + balance**, DEC-107. The **refund schedule is still Drew's open call** (#472), and it's
  what blocks self-service cancel per DEC-135 — *that is `feature/reservations`' DEC-135 (the "Your booking" manage page), not this tree's, which was deleted 2026-07-27; the citation resolves correctly once reservations merges*.)*
- DR-2: I review a year-end reliability report to inform bonuses I award by hand — the algorithm
  never signs the check. *(parked — FUTURE_IDEAS / SPEC §4 Goodhart guardrail)*
