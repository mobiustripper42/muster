---
schema: 1
id: DEC-187
title: "Check-in & waivers is in scope, specced in its own files that SPEC.md indexes"
topic: "Check-in & waivers"
status: "active"
date: "2026-09-27"
ruling: "Check-in and waivers are built. Their spec is docs/design/check-in-and-waivers.md and check-in-surfaces.md; SPEC.md §0.2 points there and states the two binding rules."
claims:
  - kind: "file"
    target: "docs/design/check-in-and-waivers.md"
    note: "model and rationale, v0.6"
  - kind: "file"
    target: "docs/design/check-in-surfaces.md"
    note: "screens, v0.4"
  - kind: "spec"
    target: "0.2"
revisit_if: "A module spec and SPEC.md disagree about the same behaviour, and the index entry is not enough to say which one wins"
amends_spec:
  - section: "0.2"
    scope: "adds check-in & waivers to scope, specced in docs/design/, with the COI and never-block rules"
---

## DEC-187: Check-in & waivers is in scope, specced in its own files that SPEC.md indexes

Operator, 2026-09-27: the waiver is a field on check-in, and knowing who is on the boat is the
product. Waivers go live when Xola goes dark. Issue #466 (the provider spike) is answered: build,
not buy (the spec's §2a).

Muster started as crewing and has since added reservations and time cards;
check-in, the captain's log and sea time are next. SPEC.md is past 2,800 lines. A module gets its own
spec, and SPEC.md carries a scope entry, the rules that bind across modules, and a pointer. The two
binding rules here, stated in §0.2 so no module can drift from them:

- Nothing recorded or shown exceeds the boat's COI passenger limit.
- Nothing blocks departure.

*Rejected: appending to SPEC.md.* Each new module would add hundreds of lines to a document every
session reads as ground truth.

DEC-012's "no waivers for crew" predates check-in. Converting that frozen record, and correcting the
SPEC lines that repeat it, is Phase 0 of the waiver work.
