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

**A change to a decision goes IN that decision's file** (DEC-141, amended 2026-08-17), appended as a
dated `## Amendment, YYYY-MM-DD (who)` section. It is not a new decision and gets no id of its own.
A new id is for a subject the record has no decision about yet — one worth writing even if nothing
before it existed. Two decisions that merely relate name each other in a plain **see also**.

**So every row here is one subject, and the file behind it holds the current answer.** There are no
strike-throughs and no "amended by" annotations: a decision amended last week still shows its
original title on its row, because the amendment is inside it. The row tells you a subject exists;
the file tells you what is true. Open the file.

The retired model did the opposite — a change meant a NEW decision whose `amends:` frontmatter
pointed back, and a generated banner in the target. An audit of 138 found **zero fully superseded**,
so nearly every change was partial, and a subject accumulated files: the payment posture needed
DEC-107, 151, 153 and 155 read in order before any of them answered it. The 51 pointers that model
produced are now plain **see also** prose inside the files, and the frontmatter is gone.

A decision that changes the spec declares that in frontmatter — `amends_spec: [{section, scope}]` —
and the pointer under that spec section's heading is generated from the declaration. A claim that
never reached the spec is a red build rather than prose nobody cross-read. This is the one generated
cross-reference left, and it points at the spec, never at another decision.
