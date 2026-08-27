---
schema: 1
id: DEC-124
title: "Muster reports its own tips; joining them to Xola's stays in the operator's tool"
topic: "Reservations & payments"
status: "superseded"
date: "2026-07-18"
ruling: "Muster splits and exports its own tips. Joining those to Xola's stays in the operator's existing tool for the whole overlap, and during it the operator adds the two lists by hand."
claims:
  - kind: "file"
    target: "src/admin/gratuity-payroll.ts"
  - kind: "file"
    target: "src/crew/gusto-import.ts"
  - kind: "unverifiable"
    target: "no code joins Muster's tips to Xola's; the operator adds two lists by hand"
revisit_if: "issue #837 settles what actually happens to the union when Xola retires"
amends_spec:
  - section: "4"
    scope: "the payments park no longer covers gratuity — Muster collects and exposes tips, though it does not own the split"
---

## DEC-124: Muster reports its own tips; joining them to Xola's stays in the operator's tool

A tip is crew money, not revenue. It is exempt from tax and from the service fee, and it
reports as crew pay — which is why it is its own thing rather than an add-on, because an add-on
is taxed and charged a fee like anything else sold.

For the whole overlap, tips exist in both systems. The tool that already does the split and
emits the payroll file is the cheapest place to add a second reader, and building a parallel
report in Muster during the drain risks the worst defect available in this phase: a half-empty
payroll file handed to a payroll provider.

The end state is what this record got wrong. It also claimed the whole apparatus moves into
Muster when Xola retires, and the tool is retired with it. That was never decided, which is why
the status above says superseded — see issue #837.
