---
id: DEC-114
title: "`<RevealSelectedRow>` — scroll-position keeping on the two-pane board, an imperative island scoped to `board-col`"
topic: "UI, brand & frontend patterns"
---

## DEC-114: `<RevealSelectedRow>` — scroll-position keeping on the two-pane board, an imperative island scoped to `board-col`

**Status:** Decided 2026-07-11 (@architect gate, Phase 10.5). Fixes #365. (Renumbered 112→114 at merge — the concurrent reservations work took DEC-112/113.)

**Decision.** A contained `'use client'` island `<RevealSelectedRow sel={sel}>`, rendered only in the two-pane
host, adjusts **`board-col`'s `scrollTop` only** in a `useEffect([sel])` (`col.scrollTop += rowRect.top −
colRect.top − 16`, guarded to no-op when the row is already in view) so selecting a row in a long list keeps
the operator's place. **No URL fragment** — the `#shiftrow-<id>` + `scroll-mt` path is rejected because native
anchor `scrollIntoView` bubbles through every scrollable ancestor and drags the *window* ~50px on desktop
windows shorter than ~750px, violating DEC-085's "window never scrolls on lg." Inert on mobile: below `lg` the
board list is `display:none` → `offsetParent === null` → the effect skips, and Next's default scroll-to-top
already opens the drill-in at the top.

**Why an island (DEC-026 enhancement, not a break).** No-JS still fully works — the row selects, the cockpit
renders, the operator scrolls by hand; only auto-place-keeping needs JS. Joins the existing DEC-026 island
family (DEC-097 redirect-feedback, DEC-089 submit spinner, DEC-030 CopyButton/RelaySend, the GuestText button)
— a bounded, progressively-enhanced enhancement, not drift toward client-rendered surfaces. Scoping the scroll
imperatively to the one named scroller (vs a CSS fragment) is deliberately **decoupled from the pre-existing
~100px `lg` document overflow** (#376) so this fix can't be silently reintroduced by a future 1px layout change.

**Invariants.** Upholds DEC-085 "window never scrolls" (strictly better than the rejected fragment path).
`sel`-keyed, consistent with DEC-085's `sel`-as-preserved-filter-param. DEC-042 calm posture untouched (a
scroll adjust carries no ink/scoreboard). **Fragility recorded:** the mobile-inert guard keys off
`display:none` (offsetParent null); if the board-hide ever becomes `visibility:hidden` the island would fire on
mobile and fight the drill-in — revisit here.

**Rejected alternatives.** (a) CSS `#shiftrow-<id>` fragment + `scroll-mt` — bubbles to the window, breaks
DEC-085 on short desktops. (b) `scroll={false}` on the row link — fixes desktop but reopens the mobile
"drill-in opens mid-scroll" bug. (c) Root-causing the ~100px document overflow (#376) so a pure-CSS anchor
"just works" — unbounded (source not found in a timebox) and leaves a fragile forever-invariant where any 1px
of future overflow silently reintroduces the window-drag. **Relationship:** extends DEC-026, protects DEC-085,
decoupled from #376. Adds no schema, no domain state.
