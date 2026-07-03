# Shift Builder — Design Reconciliation (2026-07-03)

The adopt-vs-superseded punch-list the owner asked for before calling the Builder done. Produced by two
independent lenses (frontend-design + ui-review), merged and ground-checked against the shipped `.tsx`
and the DEC-042/082/083 text. This is the durable record; the decisions here feed **Phase 9** (see
`PROJECT_PLAN.md`) and **DEC-085 / DEC-086**.

Sources compared: `docs/design/mockups/Shift Builder.html`, `shiftdetail.jsx`, `shiftboard.jsx`,
`atoms.jsx` vs the shipped `app/(admin)/admin/shifts/page.tsx` (board) and
`app/(admin)/admin/shift/[shiftId]/page.tsx` (cockpit). Static reconciliation — no live render.

## Owner rulings (2026-07-03)

- **Layout:** responsive **dual-form-factor** — desktop-app (two-pane master-detail) AND mobile-app
  (drill-in), same functions, equal priority, one no-JS core → **DEC-085**. *(The two lenses called the
  two-pane "superseded by DEC-042/026"; corrected — no DEC forecloses a server-rendered two-pane.)*
- **Board pips:** adopt neutral-ink seat pips (density, minus the DEC-042-forbidden state color).
- **Vessel identity:** add a per-vessel identity hue + bless day-grouping with a DEC → **DEC-086** +
  DEC-085. Color must encode information, never decorate.
- **No-JS:** kept (DEC-026 default; break only for a recorded reason — none yet).
- **Scope:** High + cheap-Med + pips **+ the Low polish tier** (finish it properly).

## Adopt

### High
- **Board trip line is broken** — `trips…join("   ")` collapses to one space in HTML
  (`shifts/page.tsx:456,502`), so multi-trip days read as one run-on string and wrap mid-fact at 375px.
  Reuse the cockpit's per-trip `<span>` flex row. **S.** → Phase 9.6
- **Manning role `<select>`s have no accessible name** (`shift/[shiftId]/page.tsx:356–367`, rendered
  twice, bare) — WCAG 4.1.2 fail. Wrap in a label like the Split form. **S.** → Phase 9.7

### Med
- **DEC-082 cockpit cleanup** — the "changed since reviewed" warn Notice + `changedSinceReviewed`/
  `lockedAt` read still ships (`:127–136,282–286`). Dead unless `lockedAt` is set, but exactly what #215
  targets. **S.** → Phase 9.1. *Open sub-q:* should a non-lock "changed in the last pull" cue reach the
  cockpit? (DEC-083's cue is board-only.)
- **Sub-target tap affordances** (back link, "needs attention ↗", Remove, Call/Text, warming link) —
  bare `text-xs`, under ~44px; operator's on a phone. `min-h-9` + padding. **S.** → 9.7
- **Cockpit back-link hardcodes "← At-Risk board"** even when reached from All shifts (`:217`). Drop it
  (nav covers wayfinding). **S.** → 9.7
- **`ok` token ≈4.4:1 on its bg** — marginally under AA at 10/14px; `warn` was already darkened for this.
  One-token fix, confirm with a checker. **S.** → 9.7
- **Cockpit trip facts** — shows time·pax + aboard-total; mockup adds pax/effective-COI-max, reservation
  count, trip note. The pax-note earns its place (Manning says a trainee "takes a pax slot" but the
  number never appears). Adopt if `buildAssignmentView` has the data. **M.** → 9.6/9.8 if cheap

### Low (folded in — owner: finish properly)
Role glyph on seat cards (uses the DEC-086 tokens) · `aria-hidden` on admin decorative glyphs (crew
already does it) · unified content width (board 3xl vs cockpit 2xl) · unused `text-faint` tertiary tier
in admin · whole-card click target (stretched-link) · consistent section-header kicker scale ·
Crewed-gate summary line · tenant+date in AdminNav. → Phase 9.8

## Superseded — validated against the DECs, no action

- Lock-all / need-review counts / lock icons / "build→review" (DEC-082; the count strip also a
  scoreboard barred by DEC-042)
- Colored crew-state pills + colored seat pips (DEC-042 neutral ink)
- Amber "new · review" / "changed since review" nudges (DEC-082 → replaced by the calm DEC-083 split cue)
- Cockpit lock bar (DEC-082 — lock never gated crewing)
- Arbitrary per-trip A/B split panel (DEC-083 cut-time model — survives re-derivation; the build even
  pre-selects the suggested boundary, better than the mockup's "first trip in A" default)

The neutral-ink board is a **faithful supersession, not drift**.

## Must survive any change (both lenses flagged)

silent≠declined in the pool · the plain "No shifts" empty state deliberately NOT reusing the board's
success card (empty-is-success stays uncontaminated) · no-JS form→action→redirect with code-mapped
feedback · mono+red countdown inside 36h · URL-injection guards on merge/split params.

## Scratched

- **Claimed-card rescind** — the accidental "In" is covered: a winning ask-tap **auto-confirms**
  (`Claimed→Confirmed`, DEC-061), then undo = **bail** from the shift card (DEC-078). The no-undo limbo
  is only a narrow residual `pending` "Awaiting confirmation" row, not the fat-finger case. Dropped.

## Production-need scan (FUTURE_IDEAS, 2026-07-03)

Five parked ideas checked for "needed before real crews":

| Idea | Verdict |
|------|---------|
| Per-vessel qualification gate | **parked** — BrewBoat has no boat-specific checkouts |
| **Civil send window** | **required → Phase 9.9** — asks must not fire at antisocial hours |
| Capacity-stomp override | **parked** — Xola is truth for now |
| Post-shift attendance / reliability loop | **not at launch; VERY HIGH after** — post-launch priority #1 |
| **Admin deprovision / roles** | **required → Phase 10.2** — single revoke lever kills everyone |
