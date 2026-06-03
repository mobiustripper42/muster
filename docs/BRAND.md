# Muster — Brand Direction

## Name
Muster — a crew engine. ("Muster" = call the crew together.)

## Tagline
None needed yet. If pressed: *"Xola knows the booking is paid. Muster knows who's running it."*

## Philosophy
Muster exists to take a recurring anxiety out of one semi-retired operator's head: *will anyone be
on the dock to run this trip?* Every touchpoint should reduce load, not add a screen to check. The
system mediates the work; the humans get summoned only when the machine genuinely can't close a gap.

In practice this means:
- **Empty is success.** A blank At-Risk board means the system did its job — render it as a win, not
  a void or a "nothing to see" error.
- **Push, not pull.** Surfaces summon the operator (a ping when a shift needs a human); they are not
  dashboards he's expected to monitor. The failure mode to design against is the *anxiety dashboard*
  where everything glows yellow.
- **Insultingly small (crew app).** The crew member's whole world is three surfaces. Every added
  screen is a place for stale info and friction to hide. If accepting a shift is harder than
  replying to a text, it has already failed.
- **The card is authoritative and live.** One known place. The moment info splits across channels,
  you're back to Xola.

## Voice
No-nonsense and calm, with the occasional dry line. It sounds like a competent deckhand, not a SaaS
mascot. Error and empty states are plain and actionable ("Seat already filled — nothing to do" /
"No upcoming shifts"). Reliability standing shown to crew is **individual and neutral** ("answered
fast · showed 8/8 · one late bail"), never a leaderboard, never a scolding.

What it should **not** sound like: gamified, congratulatory, anxious, or chatty. No badges, no
streaks, no "Great job!" Declining a shift is neutral — the copy never guilt-trips a "no."

## Visual Direction
**Deferred to M4 with the stack (DEC-013).** No web UI exists until the crew app forces a framework.
When chosen, fill in: style preset, light/dark default, font, border radius, color approach. Two
constraints already fixed by the spec:
- **Call time vs departure time** must be visually distinct and clearly labeled on the shift card —
  the #1 source of dock confusion (SPEC §2.6.3).
- **Silent vs declined** candidates must be visually distinct in the assignment view — silence is
  the signal the operator cares about (SPEC §2.4).

## Anti-patterns
- **No anxiety dashboard.** Nothing that invites the operator to sit and watch. Warming/trending
  shifts live behind a deliberate click, never on the At-Risk board.
- **No leaderboards / gamification** of reliability. The score is a ranking that orders asks, not a
  grade or a public ranking (DEC-008).
- **No positive-availability calendar** for crew. Suppression-only. If a "set your availability"
  screen ever appears, the product has failed (DEC-009).
- **No nautical kitsch.** It's a working tool for a working dock.

## Priority
Function over form. Polish is post-slice (Pass C / M4+). The slice's job is to *run a real weekend*,
not to look finished.
