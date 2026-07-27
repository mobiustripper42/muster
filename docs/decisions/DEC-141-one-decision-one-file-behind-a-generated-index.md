---
id: DEC-141
title: "One decision, one file, behind a generated index"
topic: "Core architecture & engine mechanics"
amends:
  - id: DEC-127
    relation: amends
    scope: "the maintenance rule only — the index stands, but it is generated rather than hand-updated"
---

## DEC-141: One decision, one file, behind a generated index

**Decision:** Each decision lives at `docs/decisions/DEC-<id>-<slug>.md` with frontmatter
`{ id, title, topic, amends: [{ id, relation, scope }] }`. `docs/DECISIONS.md` keeps its path and
becomes a generated index: a hand-authored preamble partial (`docs/decisions/_preamble.md`) plus
generated topic sections, reciprocal back-pointers, and tally. `npm run gen:decisions` writes it;
`npm run check:decisions` runs first in `verify` and fails the build on a stale index, a duplicate
id, an unknown topic or relation, a forward-pointing amendment, or a reference to a decision that
does not exist.

**Amends DEC-127**, scope: *the maintenance rule only*. The index itself stands — DEC-127 was right
that a topic index is what makes 138 decisions navigable. What it got wrong is that "every new DEC
adds a row here" is a manual step at the end of a task, and manual steps decay: four of the last
nine DECs shipped without one, DEC-127 among them. Generation replaces the step. The three-state
convention (plain / struck / amended-by) survives as the `relation` vocabulary.

**Why.** 138 decisions in 415 KB exceed a single read, so anything needing one decision loaded all
of them. Retrieval, not size, was the sharper cost — audit shard Z checked all 138 and found **zero
fully superseded**, so there was nothing to archive and an active/archive split (#525) was dead on
arrival. One file per decision drops the read cost from ~105k tokens to the index plus the two or
three actually needed, and makes amend-in-place — the agreed convention — a ~30-line edit instead of
opening 4,161 lines to change four.

**The `amends` schema is the load-bearing part, not the file split.** Audit shard Z2 found 428
cross-reference pairs, 384 one-way, 28 of them supersede-class: a decision that changed another
updated itself and never its target. The cause is that the relation vocabulary was prose, and prose
is not checkable. A flat `amends: [DEC-105]` would not have fixed it — it can express neither
*which* relation nor **scope**, and scope is the load-bearing half of every back-pointer worth
having. DEC-031's hand-written banner scoped "display, not mechanic"; DEC-063's scoped exactly which
clause reversed. A generated pointer from a bare id would have said less than the prose it replaced.

Declaring the edge once, in the amending decision's frontmatter, generates **both** ends: the
annotation on the index row *and* a banner at the top of the amended decision's own file. The banner
is the half that matters — a reader arriving by `Ctrl-F`, a code comment, or another doc's citation
lands in the body, not the index, and every other audit shard in that run arrived exactly that way.

**Explicitly NOT the fix for cross-branch id collisions (#562).** The original proposal argued that
two branches creating the same-numbered file would collide at merge. Verified false: for any id N,
`DEC-N-alpha.md` and `DEC-N-bravo.md` merge clean and both land — git only conflicts on add/add of the *identical*
path, and two different decisions pick different slugs. Collisions are caught by the duplicate-id
check (#564a) plus DEC-140's allocate-on-`main` policy. Contrast DEC-121, which solved this class
for migrations by *deleting* the shared counter; here ~2,300 code citations pin the `DEC-NNN` shape,
so the counter stays and gets policed instead.

**Tradeoff.** Per-decision `git log --follow` starts at the split; the old file's history stays
intact at its path. The generator is still a step someone has to run — what changed is that
forgetting it is loud. The index grew (full body titles rather than hand-shortened ones), which is
also a fix: shard Z1 found the index's shortened title for DEC-105 had dropped the load-bearing half
of its meaning.

**Costs paid at the split.** Six ids do not fit `DEC-NNN-slug.md` and keep their names
(`DEC-MSG-1/2/3`, `DEC-ROLE-1`, `DEC-DATA-1`, `DEC-TBD`). `## DEC-107 amendment (11.2b)` sat 582
lines below DEC-107 inside DEC-121's span and folded into DEC-107's file — the one place source
order and decision identity disagreed. Four hand-written prose banners were removed because the
generated banner reproduces them exactly, their scope having moved into frontmatter.

**Revisit if:** the generated index itself exceeds ~5k tokens, or a decision genuinely needs two
topics.
