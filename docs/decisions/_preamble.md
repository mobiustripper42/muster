# Muster — Decisions

Architectural decisions, each with an ID (DEC-NNN). DEC-001 through DEC-012 are **extracted from
the locked spec** (`docs/SPEC.md` v1.0) — the forks it already resolved, captured here as decisions
so the *why* survives. DEC-013 and DEC-014 were made during project setup (2026-06-03). Open
questions live at the bottom as DEC-TBD.

> The spec is the contract. Where a decision below compresses spec reasoning, the spec section is
> cited — read it for the full argument.

**One decision, one file** (DEC-141). Each lives at `docs/decisions/DEC-<id>-<slug>.md`; this file
is the generated index. Read one decision by reading its file — `grep -rl DEC-042 docs/decisions/`
resolves any id — rather than loading all 138. To add or change a decision, edit its file and run
`npm run gen:decisions`; `npm run check:decisions` fails the build if this index is stale.

**Three states, not two** (corrected 2026-07-25, audit shard Z1). A strike-through was the only
marker for "something changed", which forced every partial supersession to be recorded as total or
as nothing — and an audit of all 138 found **zero fully superseded**: every struck row still has a
leg cited by SPEC, code, or a later DEC. So:

- **plain row** — current, nothing amends it.
- **~~struck~~ → superseded by DEC-N** — the whole holding is replaced.
- **row + "amended by DEC-N — scope"** — the DEC still governs, but one leg was replaced. **Use
  this by default**; total supersession is rarer than it looks.

The relation and its scope are declared once, in the amending decision's `amends:` frontmatter, and
generated in both directions — onto the row below *and* into a banner at the top of the amended
decision's own file. Audit shard Z2 found 28 supersede-class edges where the amending DEC updated
itself and never its target, because a reader arriving by `Ctrl-F`, a code comment, or another doc's
citation lands in the body, not the index. Declaring it once is what makes both ends agree.

Available relations: `supersedes` (the only one that strikes a row), `amends`, `revises`, `refines`,
`reverses`, `retires`, `extends`, `corrects`, `resolves`, `reframes`.
