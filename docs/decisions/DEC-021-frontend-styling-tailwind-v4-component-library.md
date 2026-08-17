---
id: DEC-021
title: "Frontend styling = Tailwind v4; component library deferred"
topic: "UI, brand & frontend patterns"
---

## DEC-021: Frontend styling = Tailwind v4; component library deferred

**See also** — later decisions that changed part of this one:
- Retired by DEC-041 — the `Event.durationMinutes` line only
- Refined by DEC-086 — adds tokens to the locked palette

**Decision:** The first real UI (task 1.5b, the crew app) establishes the styling foundation as
**Tailwind v4** (via `@tailwindcss/postcss`, CSS-first `@theme` tokens in `app/globals.css`, no
`tailwind.config.js`). **No component library is adopted yet** — the few crew surfaces are hand-built
from Tailwind utilities. Design tokens (colors, IBM Plex faces, radius) are **harvested from the
Claude Design mockups** per DESIGN-REFERENCE.md (read the CSS values, re-express as `@theme` tokens —
never import the mockups). `.claude/ui-context.md` captures the tokens + voice + binding constraints
for `@ui-reviewer`.
**Why:** Every component library the owner has used branches from Tailwind, so Tailwind is the
substrate regardless; picking the library later costs nothing now. BRAND says "function over form,
polish is post-slice" — a component library is foundation tax that's overkill for two small crew
surfaces and better chosen when the heavier admin surfaces (assignment view, at-risk board, roster)
actually need primitives. DESIGN-REFERENCE explicitly leaves the component library as *reference,
our choice*; `@ui-reviewer`'s shadcn assumption is a generic seed default, not binding on Muster.
**Tradeoff:** Hand-built components are more verbose than a library's primitives — accepted for the
slice; revisited when admin surfaces land. Webpack already required (DEC-020); Tailwind v4's PostCSS
plugin composes with it fine.
**Revisit / trigger:** Choose the component library via an **@architect pass (or chat research)** when
the first heavy admin surface is next on the build — layered on top of Tailwind without rework.
**Phase:** M4 / task 1.5b. (Owner decision, 2026-06-06.)
