---
id: DEC-143
title: "A decision that changes SPEC declares it, and the reciprocal pointer in SPEC is generated"
topic: "Core architecture & engine mechanics"
amends:
  - id: DEC-141
    relation: extends
    scope: "the same generated-reciprocal-pointer mechanism, pointed at SPEC instead of at other decisions"
---

## DEC-143: A decision that changes SPEC declares it, and the reciprocal pointer in SPEC is generated

**Decision:** A decision that changes SPEC declares it in frontmatter — `amends_spec: [{ section,
scope }]` — and `npm run gen:decisions` writes the reciprocal pointer into that section of
`docs/SPEC.md`. `npm run check:decisions` fails on a section that does not exist, a declaration with
no scope, and a spec whose generated blocks are stale. The blocks are marker-delimited and
machine-owned; everything outside them is hand-written as before.

**Why:** The 2026-07-25 audit's single largest finding class was spec amendments claimed in a
decision that never landed in the spec — 41 claims, 17 unlanded. DEC-141 closed the DEC→DEC leg of
exactly this pattern. This is the DEC→SPEC leg, and it is the same fix for the same reason: the
claim was prose, and prose is not checkable.

**Why a banner in the section rather than an index.** The same argument DEC-141 made and this
project has now made twice: a reader arrives at §2.3 by Ctrl-F, by a code comment, or by another
doc's citation — not via an index. An index-only pointer helps only the reader who came via the
index, and nobody does. The cost is real (the spec body now contains generated regions) and was
taken deliberately over the cheaper appendix.

**One verb, not ten.** The DEC→DEC vocabulary distinguishes `supersedes` from `refines` from
`corrects` because between two decisions the question is *which one is authoritative now*. Against
the spec there is only one question a reader has — **is what I am reading still true?** — and the
scope answers it. A second vocabulary here would be a second thing to keep honest for no reader's
benefit.

**Anchors are numbered sections only.** `§2.4` resolves; "the Booking availability subsection" does
not. An unnumbered heading's text is prose that gets reworded, and an anchor that quietly stops
resolving is the failure this exists to prevent.

**What it does not do.** It checks *declared* claims. A decision that changes the spec and says so
only in prose is still invisible — coverage is set by the conversion pass, not by the mechanism.
The same is true of `amends:` today. This makes the record checkable going forward; it does not
prove anything about the past.

**Scope: SPEC only.** `USER_STORIES`, the operator manual and `DESIGN-REFERENCE` drift the same way
and are uncovered. SPEC is where the volume is and where the fix was cheapest; an `amends_docs`
generalization is available later if the drift shows up there.
