# Shard G — Brand / UI

**Subject:** the design system of record — brand direction, the mockup-consumption rules, and the
UI-review context those depend on.
**Audited tree:** `main` @ `5790ce2`.

> **Which-tree check (lesson 4).** `DESIGN-REFERENCE.md` is byte-identical across trees. `BRAND.md` is
> **83 lines on `main` vs 55 on `feature/reservations`** — `main` is *ahead* (the anti-patterns section
> gained the FareHarbor-derived rules). Audited `main` as the newer copy; the branch picks it up on the
> next forward-merge.

**Primary docs:** `docs/BRAND.md` (83), `docs/design/DESIGN-REFERENCE.md` (133).
**Checked against:** `docs/design/mockups/`, `app/globals.css`, `.claude/ui-context.md`,
`.claude/CLAUDE-context.md`.

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| G1 | `DESIGN-REFERENCE.md:107-125` | "## Mockup index (filename → surface → spec section)" — an 8-row table: `crew-roster.jsx`, `event-admin.jsx`, `shift-builder.jsx`, `assignment-view.jsx`, `at-risk-board.jsx`, `crew-ask.jsx`, `crew-myshifts.jsx`, `crew-shift-card.jsx` | **None of the 8 files exist.** `docs/design/mockups/` holds ~50 files under entirely different names (`riskapp.jsx`, `assignapp.jsx`, `crewapp.jsx`, `roster.jsx`, `eventapp.jsx`, `shiftapp.jsx`…) **plus the whole Phase-12 reservations set** — `booking-form.html`, `booking-manage.html`, `offering-catalog.html`, `reservation-calendar.html`, `purchases-customers.html`, `availability-picker.html` — none of which the index mentions | CODE-CONTRADICTS | doc-wrong |
| G2 | `DESIGN-REFERENCE.md:114` | `shift-builder.jsx` row, binding highlights: "proposed shifts (no blank-slate build); derived seats; **lock**; state badges" | Locking was **cut** (DEC-082); column dropped by `0022_drop_shifts_locked_at.sql`; zero code references. Same finding as shard C's SP-6/SP-7, in a third document | MISMATCH | doc-wrong |
| G3 | `.claude/CLAUDE-context.md:196` | "**`@ui-reviewer` is installed but inert until `.claude/ui-context.md` exists** — it hard-stops without it" | **The file exists** — 83 lines, and `BRAND.md:41` already relies on it ("`.claude/ui-context.md` carries the same tokens for `@ui-reviewer`"). The agent is not inert; the doc tells you your UI reviewer doesn't work when it does | MISMATCH | doc-wrong |
| G4 | `.claude/CLAUDE-context.md:137` | "colors, **radius scale** (`--radius-card: 14px`)" | `BRAND.md:48` — "**One value, not a scale** — a scale invites fiddling and buys nothing at this size." Calling it a scale invites exactly the `--radius-sm`/`--radius-lg` sprawl BRAND forbids | MISMATCH | doc-wrong |

## Severity read

**G1 is the finding, and it is a clean own-goal.** `DESIGN-REFERENCE.md` exists to answer one
mechanical question — *which mockup file belongs to which spec section* — and every filename in its
answer is wrong. Worse, the table's own footnote anticipated this exactly:

> *"(Rename your exports to match, **or update this table to match your filenames** — the point is each
> JSX file is paired with its spec section.)"*

The doc offered the out and nobody took it. The index is now not just stale but **actively
misdirecting**: a reader looking for the at-risk mockup searches `at-risk-board.jsx`, finds nothing,
and has no way to learn that `riskapp.jsx` / `riskcards.jsx` / `riskmobile.jsx` are what they wanted.
And the entire P12 reservations mockup set — the surfaces under active construction *right now* — is
invisible to the index.

**G3 is small but costly in an unusual way:** it tells you a tool is broken. Nobody runs an agent the
docs describe as inert, so `@ui-reviewer` has plausibly gone unused since `ui-context.md` was written.

G2 and G4 are one-liners.

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | verified against |
|---|---|
| Tokens live in `app/globals.css` as Tailwind v4 `@theme` — "that file is the source of truth" | `app/globals.css` carries an `@theme` block. `BRAND.md` correctly positions itself as intent, not values |
| `.claude/ui-context.md` carries the same tokens for `@ui-reviewer` | The file exists and is populated (83 lines) — see G3, where a *different* doc denies it |
| The JSX rule — "read, don't import" | Consistent across `BRAND.md:39`, `DESIGN-REFERENCE.md:48`, `CLAUDE-context.md:137`. Three docs, one rule, no drift |
| Binding constraints — call-vs-departure time (§2.6.3), silent-vs-declined (§2.4) | Match SPEC and `.claude/agents/ui-reviewer.md`'s description. These are the two the brand doc says outrank everything, and they are stated identically everywhere |
| Anti-patterns (no anxiety dashboard, no leaderboards DEC-008, no positive-availability calendar DEC-009) | All cite live DECs and match them |

**`BRAND.md` is the healthiest document in this audit.** It cites DECs inline, defers values to code,
and its claims check out. The findings here are all in its *neighbours*.

## Not fixed here

**G1's full remap is C2's work, not G's.** Mapping ~50 mockups to spec sections requires reading the
§2.x surface specs — which is exactly shard C2's corpus. Fixing it here would mean guessing at
pairings C2 is about to establish properly. This shard **removes the false index** and states what is
actually on disk; C2 rebuilds the mapping.
