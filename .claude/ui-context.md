# Muster — UI Context (design system for @ui-reviewer)

The reference `@ui-reviewer` checks surfaces against. Sources: `docs/BRAND.md` (voice +
philosophy), `docs/design/DESIGN-REFERENCE.md` (how to consume mockups), `docs/design/mockups/*`
(visual direction), and the live tokens in `app/globals.css`. Stack chosen in **DEC-021**.

## Stack
- **Next.js (App Router)** — route groups `app/(admin)` / `app/(crew)` / `app/api`. Server components
  by default; forms post to **server actions** (no client JS unless a surface truly needs it).
- **Tailwind v4** (`@tailwindcss/postcss`, CSS-first `@theme` in `app/globals.css`). **No component
  library yet** (DEC-021) — surfaces are hand-built from utilities. Don't flag the absence of shadcn;
  it's deferred by decision, not an oversight.
- **Fonts:** IBM Plex Sans (UI) + IBM Plex Mono (times/countdowns), via `next/font` → `font-sans` /
  `font-mono`.

## Design tokens (utilities generated from `app/globals.css`)
Colors map straight to Tailwind utilities (`bg-*`, `text-*`, `border-*`):
- **Surfaces/ink:** `bg` (#eef2f6 page), `card` (#fff), `ink` (#101826), `muted` (#5b6675),
  `faint` (#93a0b0), `line` (#e7ebf1 borders).
- **Brand/roles:** `accent` (#2f5d86), `captain` (#2f5d86), `mate` (#2f7d70).
- **Status (each has a soft bg + line):** `ok`/`ok-bg`/`ok-line` (green), `warn`/`warn-bg`/`warn-line`
  (amber), `bad`/`bad-bg`/`bad-line` (red).
- **Radius:** `rounded-card` (14px) for cards/banners.
Harvested from the mockups per DESIGN-REFERENCE — read values, re-express as tokens, never import.

## Voice (binding — from BRAND)
- No-nonsense, calm, occasional dry line. Sounds like a competent deckhand, not a SaaS mascot.
- Empty/error states are plain and actionable: "No upcoming shifts", "Seat already filled — nothing
  to do". **Empty is success**, not a void or an error.
- Declining is **neutral** — never guilt-trip a "no". Reliability shown to crew is **individual and
  non-comparative** ("answered fast · showed 8/8"), **never a leaderboard**, never a grade.
- No gamification, badges, streaks, "Great job!", or nautical kitsch.

## Layout / responsiveness
- **Crew app is mobile-first** and "insultingly small" — phone-width (`max-w-md`, ~375px), thumb-sized
  tap targets, answerable without hunting. Every extra screen is a place for stale info to hide.
- Admin surfaces are desktop-leaning but must not break on a phone.
- **Push, not pull:** surfaces summon; they are not dashboards to monitor. No "anxiety dashboard"
  where everything glows yellow.

## Binding visual constraints (spec, not taste — DESIGN-REFERENCE)
- **Call time vs departure time** must be visually distinct + clearly labeled on the shift card
  (§2.6.3) — the #1 dock-confusion source. (Card surface = #13.)
- **Silent vs declined** candidates must be visually distinct in the assignment view (§2.4) — silence
  is the signal the operator cares about.
- Information hierarchy, which facts appear, sort order, and the action set per surface are **binding**
  (the spec rendered as layout). Spacing, color values, type, radius, component shapes are reference.

## Surfaces built so far
- **Crew App — the ask** (`app/(crew)/crew/page.tsx`, §2.6.1): push-style card, inline **In/Out**, no
  login beyond the session. Answerable without opening anything else.
- **Crew App — my shifts** (same page, §2.6.2): confirmed-upcoming only, soonest-first; own standing
  as a plain muted subline under the name (non-comparative — real reasons like "answered fast · showed
  8/8 · one late bail", #32). Tapping a shift opens the card (#13).
- **Magic-link landing** (`app/(crew)/crew/auth`): the tap IS the login; sets the session cookie.
  Admin links land on the board; crew links on /crew.
- **At-Risk Board** (`app/(admin)/admin/at-risk/page.tsx`, §2.5, #42/#43): triage rows most-urgent
  first — flag (regression distinct + bad-toned), what's-missing chips, mono time-to-trip
  (red inside 36h), SYSTEM-TRIED trail (silent ≠ declined), per-person **Lean** buttons, disabled
  reschedule/cancel (parked with payments, DEC-026), **empty state = success card**. Admin-gated.
- **Assignment view, thin** (`app/(admin)/admin/shift/[shiftId]/page.tsx`, §2.4): read-only seat
  cards + ranked pool with ask status (**silent ≠ declined** binding constraint); badge resolved on
  read (DEC-023). The cockpit actions are a later task.

## Priority
Function over form; polish is post-slice (BRAND). The slice's job is to run a real weekend, not to
look finished — review for clarity, correct hierarchy, and the binding constraints, not for visual
polish.
