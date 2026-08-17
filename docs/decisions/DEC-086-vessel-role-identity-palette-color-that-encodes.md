---
id: DEC-086
title: "Vessel + role identity palette — color that encodes information"
topic: "UI, brand & frontend patterns"
---

## DEC-086: Vessel + role identity palette — color that encodes information

**See also** — decisions this one changed part of:
- Refines DEC-021 — adds tokens to the locked palette
- Refines DEC-085

**Status:** Decided 2026-07-03 (Eric, Phase 9). Hue values set when the 9.6 board bundle lands.

**Decision.** Add a small **identity** palette to the DEC-021 locked token set: a distinct **calm hue
per vessel** (rendered as a per-vessel dot on board rows so a same-brand fleet is legible at a glance)
and the existing **role hues** (`captain`/`mate`, defined in `globals.css` but currently unused in
shipped TSX) put to work. The rule: **color that encodes information is permitted; decorative color is
not.**

**Why (the rule this refines).** DEC-021 locks the palette and DEC-042 mandates neutral ink precisely to
bar two failure modes — color added "to make it look good," and the risk-scoreboard where every row
glows. Identity color is **neither**: a vessel hue answers *which boat*, a role hue answers *which
role* — each carries a value. Eric's framing: *"the rule is so color isn't added for dumb reasons; it
needs to carry a value. vessel hue, role hue — that's value, so we add it."* Identity ≠ risk, so
DEC-042 is untouched (warm/bad tokens stay reserved for the At-Risk board).

**Guardrails.** Hues are calm/desaturated, **one deliberate hue per vessel** (not a rainbow), chosen —
not auto-generated garishly. They encode **identity only**, never state/risk. Each hue's meaning is
recorded when the values are set. A ~4-boat fleet needs ~4 identity tokens beyond `captain`/`mate`.

**Relationship:** refines DEC-021 (adds *informational* tokens to the locked palette), compatible with
DEC-042 (identity color ≠ risk color). Companion to DEC-085 (the board that renders them). Supersedes
nothing.

**Amendment — hue values set (9.6, 2026-07-03).** Six `--color-vessel-N` tokens land in `@theme`
(`app/globals.css`): 1 indigo `#5b64a8`, 2 plum `#8a5f93`, 3 olive `#6e7f46`, 4 clay `#9c6b4e`,
5 lagoon `#4f7f8b`, 6 driftwood `#7c6a54` — all calm/desaturated, deliberately distant from
accent/captain/mate and every status hue so a dot never reads as a badge. The real fleet is **pinned**
(the "chosen, not auto-generated" guardrail) in `app/lib/vessel-hue.ts`: Brew 1→indigo, Brew 2→plum,
Brew 3→olive, Brew 4→clay; unpinned vessels (dev seeds, a future boat before someone pins it) fall to
a stable hash over the pool, so an id always keeps its hue. Rendered as a 10px dot before the vessel
name on board rows — identity only, `aria-hidden`, the name stays the accessible answer.
**Role hues:** first surface = the 9.8 seat-card role glyph; extended (operator call, 2026-07-04)
to the board's FILLED pips so both surfaces speak one language — a captain-blue/mate-teal square
means "a person of that role, aboard." Identity, not state: fill-vs-outline still carries the state
(open pips stay light outline grey so gaps jump), filled trainees stay faint, and warm/bad tones
never appear on the board.

**Amendment — identity color reaches the crew surfaces (9.11, 2026-07-05, #237, @architect GO).**
Two render sites added on the crew app, both direct reuse of the pinned system, no new token:
- **Vessel dot on `/crew` My-shifts rows** (`app/(crew)/crew/page.tsx`) — a 10px `vesselHueClass`
  dot before the vessel name, so a mixed-vessel list is legible at a glance (the same disambiguation
  value the board earns). `aria-hidden`; the vessel name stays the accessible answer. The single-vessel
  shift-card **header** carries **no** dot — the 2xl boat name already fully answers "which boat," so
  a dot there would be decoration, not information (the architect's one cut).
- **Co-crew role glyph on the shift card** (`app/(crew)/crew/shift/[shiftId]`) — each "Crewing with
  you" row shows the captain/mate C/M role glyph (shared `RoleGlyph`, `components/ui/role-glyph.tsx`,
  same `roleHueClass` as the seat-card + board), from the seat's role — the identical resolution as
  `viewerRole`, now memoized per build. Identity, not state. The visible role label beside the glyph
  is the accessible answer (glyph is `aria-hidden`).
