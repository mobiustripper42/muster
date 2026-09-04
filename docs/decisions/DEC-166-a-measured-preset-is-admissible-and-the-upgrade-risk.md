---
schema: 1
id: DEC-166
title: "A measured preset is admissible; the upgrade risk is accepted"
topic: "Core architecture & engine mechanics"
status: "active"
date: "2026-09-04"
ruling: "A plugin's `recommended` may be spread wholesale once measured, replacing DEC-159's cherry-pick-by-name clause; its four other rules stand."
claims:
  - kind: "file"
    target: "eslint.config.mjs"
    note: "five `recommended` spreads plus an OFF map carrying every firing rule's count"
revisit_if: "a plugin major bump turns a batch of newly-added rules red and the cleanup is not worth the rules"
---

## DEC-166: A measured preset is admissible

Supersedes **DEC-159** on one clause. Its rules 1, 2, 4 and 5 stand unchanged.

### What changes

DEC-159 said *"Cherry-pick rules by name; never adopt a plugin's preset,"* on two grounds: a preset admits rules unmeasured, and *"the plugin's contents change between majors, so a preset silently expands what the gate enforces on an upgrade."*

The first ground is answered. All 347 rules across five `recommended` presets were run against this codebase before adoption; 297 returned zero findings and are on, and the 50 that fired are in `OFF` with counts. That is DEC-159 rule 3 satisfied, not evaded.

The second is **accepted, not mitigated**. A major bump can add rules that fire. Operator's ruling: *"if a bunch of shit breaks on a major upgrade, then we change it."* A red gate on an upgrade is loud and attached to the diff that caused it — the feared failure mode announces itself.

### Why the clause was wrong

It priced the wrong risk. Nine rules ran out of 875 installed, and the cost of those never enabled — four security rules among them — dwarfs an upgrade occasionally going red. Issue #854 is the evidence: one rule found 109 sites a hand grep scored at 36.

A spread also fails safe where a hand list fails silent: a list omits a newly-added rule forever and reports nothing.
