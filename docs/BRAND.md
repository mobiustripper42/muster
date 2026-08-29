# Muster — Brand Direction

## Name
Muster — a reservation and operations system for small-passenger-vessel operators.
("Muster" = call the crew together — named for the crewing half, which was built first.)

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
**Settled at task 1.5b (DEC-021).** The canonical values live in `app/globals.css` as Tailwind v4
`@theme` tokens — that file is the source of truth; this section describes the intent so a reader
knows *why* a value is what it is. Tokens were harvested from the Claude Design mockups per
`docs/design/DESIGN-REFERENCE.md` (read the CSS, re-express as tokens — never import the mockups).
`.claude/ui-context.md` carries the same tokens for `@ui-reviewer`.

- **Framework** — Tailwind v4, CSS-first `@theme`, no `tailwind.config.js`, no component library.
  The surfaces are hand-built from utilities; a library gets adopted when hand-building actually hurts.
- **Type** — IBM Plex Sans and IBM Plex Mono, self-hosted through `next/font` (no external request, no
  layout shift). Mono is for times, counts, and ids — anything the eye scans in a column.
- **Light only.** No dark mode and no theme toggle. This is a tool used on a bright dock and in a
  bright office; a second theme is surface area with no demonstrated demand.
- **Radius** — one card radius (`--radius-card`, 14px). One value, not a scale — a scale invites
  fiddling and buys nothing at this size.
- **Color is information, never decoration** (DEC-021/042). Three independent axes that must not bleed
  into each other:
  - **Role** — captain and mate each own a hue.
  - **Status** — ok / warn / bad, each with a matching soft background and line, contrast-tuned to hold
    AA at the 10px pill sizes the board actually renders.
  - **Vessel identity** — a calm, desaturated hue per boat (DEC-086), deliberately distant from every
    role and status hue so a vessel dot can never be misread as a badge. Identity only; a boat's colour
    never encodes risk.
- **Accent** is a single blue, shared with the captain hue and the PWA theme colour.

Two constraints fixed by the spec, and they outrank anything above:
- **Call time vs departure time** must be visually distinct and clearly labeled on the shift card —
  the #1 source of dock confusion (SPEC §2.6.3).
- **Silent vs declined** candidates must be visually distinct in the assignment view — silence is
  the signal the operator cares about (SPEC §2.4).

## Anti-patterns
- **No anxiety dashboard.** Nothing that invites the operator to sit and watch. Warming/trending
  shifts live behind a deliberate click, never on the At-Risk board.
- **No wall-of-pills calendar.** The reservation calendar shows *state and counts*, not one pill per
  open availability per product (FareHarbor's month view — a legibility failure). Day-first, filterable,
  and the axes are **boats + real time**, never the catalog; a new offering is color, not a row/column.
- **No config maze.** Purpose-built for one operator beats generic settings. The offering-catalog is the
  only real setup surface — no Customer Types / Price Sheets / Custom Fields sprawl (FareHarbor's admin).
  If the operator has to *learn* the setup screen, we've failed the single-tenant dividend.
- **No leaderboards / gamification** of reliability. The score is a ranking that orders asks, not a
  grade or a public ranking (DEC-008).
- **No positive-availability calendar** for crew. Suppression-only. If a "set your availability"
  screen ever appears, the product has failed (DEC-009).
- **No nautical kitsch.** It's a working tool for a working dock.

## Priority
Function over form. Polish is post-slice (Pass C / M4+). The slice's job is to *run a real weekend*,
not to look finished.
