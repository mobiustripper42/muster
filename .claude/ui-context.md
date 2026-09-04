# Muster — UI Context (design system for @ui-reviewer)

The reference `@ui-reviewer` checks surfaces against. Sources: `docs/BRAND.md` (voice +
philosophy), `docs/design/DESIGN-REFERENCE.md` (how to consume mockups), `docs/design/mockups/*`
(visual direction), and the live tokens in `app/globals.css`. Stack chosen in **DEC-021**.

## Stack
- **Next.js (App Router)** — route groups `app/(admin)` / `app/(crew)` / `app/(public)` / `app/api`,
  plus `app/reservations` (capability-URL customer pages). Server components by default; forms post to
  **server actions** (no client JS unless a surface truly needs it).
- **Tailwind v4** (`@tailwindcss/postcss`, CSS-first `@theme` in `app/globals.css`). **No third-party
  component library** (DEC-021) — surfaces are hand-built from utilities. Don't flag the absence of
  shadcn; it's deferred by decision, not an oversight.
- **There ARE local primitives** in `components/ui/` — `Shell`, `Notice`, `BackLink`, `SubmitButton`,
  `AppLink`, `RoleGlyph`, `CopyButton`, `NavSpinner`, `VersionTag` — plus `components/admin/` and
  `components/crew/`. A new surface that hand-rolls a banner or a back link instead of reusing these
  is a **consistency** finding. Check before assuming something must be built from scratch.
- **Client islands are the exception, and they're bounded** (DEC-133): the default is server-rendered,
  an island needs a real UX win to justify itself, and **no function may cross the RSC boundary**
  (server→client function props fail only at render/e2e, never at `next build`).
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
- **Money shown must equal money charged.** On customer surfaces, every line item (fare, tax, service
  fee, tip, total, balance owed) comes from the same pure functions the charge builder freezes into
  the PaymentIntent. A total assembled independently in the view is a **High** finding even when the
  arithmetic happens to agree today.
- Information hierarchy, which facts appear, sort order, and the action set per surface are **binding**
  (the spec rendered as layout). Spacing, color values, type, radius, component shapes are reference.

## Three audiences, three postures
The surface count has outgrown a per-page list, and *who* a surface is for now matters more than
which ones exist. Route group tells you the posture:

- **Crew** (`app/(crew)`) — mobile-first, "insultingly small", answerable in one tap. Session via
  magic link. The strictest surface: every extra screen is somewhere stale info hides.
- **Admin** (`app/(admin)`) — Eric's cockpit. Desktop-leaning, must not break on a phone. Dense is
  fine; **anxious is not**. Triage surfaces summon; they aren't monitors.
- **Customer** (`app/(public)/book/*`, `app/b/[code]`) — the newest audience, and the one
  with different rules. These people have never seen the product, get no training, and may never
  return. Copy carries more weight, error states must be self-explanatory, and a stale link must
  render an honest dead end rather than a doomed form. Still Muster's calm voice — no marketing
  register, no urgency tactics.

Anchor surfaces worth knowing, since the binding constraints attach to them:
- **The ask + my shifts** (`app/(crew)/crew/page.tsx`, §2.6.1–2) — push-style card, inline Yes/No;
  own standing as a non-comparative muted subline, never a leaderboard.
- **At-Risk board** (`app/(admin)/admin/at-risk/page.tsx`, §2.5) — most-urgent-first triage, mono
  time-to-trip, SYSTEM-TRIED trail, **empty state = success card**.
- **Assignment cockpit** (`app/(admin)/admin/shift/[shiftId]/page.tsx`, §2.4) — seat cards + ranked
  pool where **silent ≠ declined** is binding.
- **Shift card** (`app/(crew)/crew/shift/[shiftId]/page.tsx`) — where **call time vs departure time**
  is binding.
- **Booking flow** (`app/(public)/book` → `/book/checkout` → `/book/success`) — availability, then
  inline Stripe Elements. The checkout screen prices with the same pure money functions the charge
  builder freezes, so displayed and charged totals cannot drift.
- **Your booking** (`app/b/[code]`) — capability-URL landing (DEC-122, mechanism amended by DEC-154), bearer code and
  no login; one page, two states driven by trip time.

For anything not listed, read the file's header comment — this codebase documents *why* at the top of
each surface, and that's more reliable than a list here that drifts.

## Priority
**The slice is over** (production posture since 2026-07-01) — "it just has to work" no longer applies.
Interfaces are expected to be fully baked: correct hierarchy, honest empty and error states, real copy.

Function still leads form, and the binding constraints still outrank taste. What changed is that
visible roughness on a shipped surface is now a legitimate finding rather than an accepted cost —
especially on customer-facing pages, which are somebody's first and possibly only impression of the
product. Judge polish as in-scope; judge *decoration* as out of scope, permanently.

## Using the `frontend-design` skill (Muster-local)
Given the production posture above, the execution craft the `frontend-design` skill brings is
warranted. Invoke it for UI work — but pass **`docs/BRAND.md`
+ this file + the `@theme` tokens (`app/globals.css`)** as the authoritative brief. **The brand wins
every conflict.** The skill defaults to making UI *distinctive* (a signature element, an aesthetic
risk, a characterful display face, motion); Muster is the deliberate opposite — calm, anti-anxiety,
"insultingly small," neutral ink, no gamification, function-over-form, palette/IBM Plex/radius locked
(DEC-021, no component library). The skill itself defers to a pinned brief ("the brief's own words
always win"), so binding it is natural.
- **Take from it:** precise spacing + hierarchy, type scale *within IBM Plex*, empty/error states as
  invitations, active-voice end-user copy, keyboard focus, `prefers-reduced-motion`.
- **Hold back:** new palette, signature element, aesthetic risk, motion/animation — not applicable to
  a locked, calm identity.
Muster-local (not backported to seeds).
