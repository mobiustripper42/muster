# Muster — Design Reference (read before using the mockups)

**For:** Claude Code, before building any UI from the design files in this folder.
**What this is:** visual-direction mockups exported from Claude Design **as JSX**. They are
**reference, not spec** — read for structure and styling, **never imported**. Read this file first;
it tells you exactly how much authority the JSX carries and how to consume it safely.

---

## Authority order (the one rule)

> **The locked spec (`docs/SPEC.md`) is behavioral truth. The mockups are visual-direction
> reference. Where they disagree, the spec wins on *what*; the mockup informs *how*.**

- Spec = *what must be true* (which facts appear, what states exist, what the sort order is, what
  actions are possible). Binding.
- Mockup = *what it might look like* (layout feel, density, color mood, component shapes). Reference.
- Conflict → follow the spec, and note the discrepancy in `DECISIONS.md`. **Never silently follow
  the picture over the words.**

---

## Binding vs. reference — what you may and may not change

**BINDING — do not redesign (this is the spec rendered as layout, treat as requirements):**
- **Information hierarchy** — what's most prominent vs. secondary. (On the at-risk board, "report/
  time-to-trip" and "what's missing" are dominant; that's not taste, it's the spec.)
- **Which facts appear** on a surface — the states-to-render and actions in the cited spec section.
- **Sort / priority order** — e.g. regressions above at-risk; most-urgent first.
- **State distinctions that carry meaning** — silent ≠ declined; regression ≠ never-filled;
  empty-board = success not error.
- **The action set** — e.g. lean / reschedule / cancel on the board; the seat-card actions in
  assignment. Don't add, drop, or rename actions.

**REFERENCE — free to change, improve, or swap to fit your stack:**
- Exact spacing, padding, margins, alignment.
- Color values, gradients, shadows.
- Typography (family, weight, size scale).
- Border radius, dividers, card styling.
- The specific component library / primitives.
- Microcopy wording (keep the *meaning*; improve the phrasing).

Rule of thumb: if changing it would change *what the operator/crew learns or can do*, it's binding.
If it only changes *how it feels*, it's reference.

---

## The JSX rule — read, don't import (the load-bearing rule)

The mockups are JSX, which means they carry real styling intent the spec deliberately doesn't —
spacing scale, color values, layout structure, responsive bones. That's the *how*, and it's exactly
why JSX beats a flat screenshot. **But JSX is runnable code, and the failure mode is treating it as
the implementation and lifting it wholesale** — dragging Claude Design's stack into ours.

Give this rule the same weight as the authority order:

> Read the JSX for **structure, layout, and CSS values** (spacing, colors, hierarchy, breakpoints).
> **Rebuild it in our stack — do NOT import it.** Do not pull in Design's dependencies, its icon
> library, or its component primitives. Drop its mock/placeholder data. Map its prop and field names
> onto our actual data model (spec §2.x *data read*); where a prop doesn't match, **our model wins.**

Concretely:
- **Harvest:** the layout structure, the spacing/color/type values (transfer into our design tokens),
  which element is visually dominant, the state-conditional rendering (how it branches silent vs.
  declined, empty vs. populated).
- **Discard:** Design's import statements, its component library, its icon set, its mock data, any
  prop/field name that doesn't match our model.
- **Translate, don't transfer, if our stack differs.** If we're on React + Tailwind, the utility
  classes largely transfer or seed our tokens directly. If we're on anything else, the JSX is still
  the best styling reference we have — read the values and re-express them, don't paste.

**Free cross-check:** the props each component expects are a check on our data model. If a card
renders a field our build-plan view-model doesn't have, that's a gap caught cheap — flag it.

A wholesale paste fights our framework and rots on the first dependency mismatch. A native rebuild of
the *intent* is the goal — the JSX answers "what goes where, what's dominant, and what are the actual
values," not "what files do we add to package.json."

---

## How to read a mockup (worked example: the at-risk board → spec §2.5)

Looking at the at-risk board mockups — `riskapp.jsx` and `riskcards.jsx` (rendered, the board you've
seen) — here's the binding-vs-reference read:

**Binding (because it's the spec showing up):**
- The header framing "only shifts the automation couldn't close land here" — the empty-is-success,
  push-not-pull stance (§2.5 / §1 stance). Keep the intent.
- **Regression flagged distinctly and sorted to the top** above plain at-risk (§2.5, §3 urgency).
- The **"SYSTEM TRIED" escalation trail** (asked N · declined · silent · widened · nudged ·
  exhausted) — escalation transparency, so the operator trusts it gave up for real reasons (§2.5).
- **"silent" surfaced as its own thing**, distinct from "declined" (§2.4/§1.4).
- **"still available / nobody left in the pool"** stated explicitly, including the "manual lean
  won't help — reschedule/cancel call" honesty (§2.5).
- The **three actions: Lean / Reschedule / Cancel**, plus "Open in Assignment" (§2.5, §2.4 link).

**Reference (change freely — harvest the values, re-express in our stack):** the exact reds and
ambers (read them off the JSX and seed our tokens), the badge pill styling, card spacing, the
monospace "Xd Yh to trip" treatment, fonts, the divider lines.

Read every other mockup the same way: open the cited spec section alongside its JSX, treat the
states-to-render + actions as binding, read the styling values as reference, and rebuild — don't
import.

---

## Mockup index — REMOVED (stale), rebuild pending

> **The index that lived here was wrong in every row** (audit shard G, 2026-07-25). It listed eight
> files — `crew-roster.jsx`, `event-admin.jsx`, `shift-builder.jsx`, `assignment-view.jsx`,
> `at-risk-board.jsx`, `crew-ask.jsx`, `crew-myshifts.jsx`, `crew-shift-card.jsx` — **none of which
> exist**. Its own footnote had offered the out ("*or update this table to match your filenames*") and
> nobody took it, so it had stopped being an index and started being a wrong map: a reader hunting the
> at-risk mockup searched `at-risk-board.jsx`, found nothing, and had no way to learn that
> `riskapp.jsx` / `riskcards.jsx` / `riskmobile.jsx` were what they wanted. One row also still listed
> **lock** as a binding highlight — cut by DEC-082.

**What is actually in `docs/design/mockups/` (~50 files):**

- **Crew app** — `crewapp.jsx`, `crewdata.jsx`, `mobileapp.jsx`, `mobiledetail.jsx`, `ios-frame.jsx`
- **At-Risk board** — `riskapp.jsx`, `riskcards.jsx`, `riskdata.jsx`, `riskmobile.jsx`, `riskmodals.jsx`
- **Assignment cockpit** — `assignapp.jsx`, `assigndata.jsx`, `assignmobile.jsx`, `assignseat.jsx`
- **Shift builder** — `shiftapp.jsx`, `shiftboard.jsx`, `shiftdata.jsx`, `shiftdetail.jsx`
- **Event admin / import** — `eventapp.jsx`, `eventdata.jsx`, `eventdetail.jsx`, `eventlist.jsx`, `eventimport.jsx`
- **Roster** — `roster.jsx`
- **Shared** — `atoms.jsx`, `forms.jsx`, `data.jsx`, `detail.jsx`, `app.jsx`, `tweaks-panel.jsx`
- **Phase 12 reservations (HTML)** — `booking-form.html`, `booking-manage.html`, `booking-recovery.html`,
  `availability-picker.html`, `offering-catalog.html`, `offerings-list.html`,
  `purchases-customers.html`, `reservation-calendar{,-mobile,-scale}.html`, `blocks.html`,
  `location.html`, `vessel.html`

**The file → spec-section mapping is deliberately not rebuilt here.** Pairing ~50 mockups to their
authoritative §2.x sections requires reading those sections, which is exactly **audit shard C2's**
corpus. Guessing the pairings now would mean inventing the answer C2 is about to establish properly.
Until then: the authority order below still governs — **spec wins on *what*, mockups inform *how***.

---

## If a mockup and the spec disagree
1. The spec wins on *what*.
2. Build to the spec; use the mockup only for the *how*.
3. Log the discrepancy in `DECISIONS.md` (one line: which surface, what differed, that spec won).
4. If you think the mockup is actually *right* and the spec wrong — that's a spec-correction
   candidate, not a license to diverge. Flag it; don't silently follow the image.
