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
- SP-6: I **lock** a reviewed shift so crewing may proceed; inside the staffing horizon, locking
  fires the asks.
- SP-7: When a late booking lands on a locked shift, I get a "changed since you reviewed it" nudge
  so I'm never blindsided. *(fast-follow — Pass C)*

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

## Crew — captains and mates (crew app)

Their entire world is three surfaces. The failure mode is friction and stale info, not missing
features (SPEC §2.6).

- CR-1: I get the ask as a push/SMS and answer **in or out in ~3 seconds without opening or logging
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

## Drew — the owner

Mostly out of the 2026 build; owns money/policy decisions that are parked.
- DR-1: I decide deposit-vs-full and the refund schedule. *(parked — payments are 2027)*
- DR-2: I review a year-end reliability report to inform bonuses I award by hand — the algorithm
  never signs the check. *(parked — FUTURE_IDEAS / SPEC §4 Goodhart guardrail)*
