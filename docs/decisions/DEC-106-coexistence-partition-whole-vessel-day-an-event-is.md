---
schema: 1
id: DEC-106
title: "Every departure and booking records which system sold it"
topic: "Reservations & payments"
status: "active"
date: "2026-07-11"
ruling: "Every departure and every booking records which system sold it, Muster or Xola. The whole-vessel-day ownership partition this marker was built to serve is retired; the marker itself is what survived, and it still routes a cancel."
claims:
  - kind: "column"
    target: "events.source"
  - kind: "column"
    target: "reservations.source"
  - kind: "file"
    target: "src/reservations/hull-busy.ts"
revisit_if: "the last Xola-sourced booking has aged out, after which every row reads muster and the marker routes nothing"
---

## DEC-106: Every departure and booking records which system sold it

The make-or-break risk of selling on two systems at once is double-selling the same boat. The
first answer was to partition ownership at the whole vessel-day, so a boat on a date belonged
to exactly one system and capacity was never added across the two.

That partition is gone (DEC-149), and the guard that replaced it is better: any scheduled trip
on a hull occupies it for the trip's duration, whichever system sold it. There is no count to
reconcile, so there is nothing to get wrong.

The marker is what the partition left behind, and it earns its place on its own — a cancel
routes off it, because a Muster booking refunds through Stripe and a Xola booking is refunded
in Xola by hand.
