---
schema: 1
id: DEC-112
title: "A departure's price comes from the offering, with a per-departure override"
topic: "Reservations & payments"
status: "active"
date: "2026-07-11"
ruling: "An offering's price variations resolve against the departure's date and fall back to the offering's base price, adjusted by a fixed amount or a percentage. A price written onto the departure itself overrides both."
claims:
  - kind: "file"
    target: "src/reservations/availability.ts"
  - kind: "column"
    target: "events.price"
  - kind: "unverifiable"
    target: "no test carries a non-empty price variation through the charge path"
    note: "issue #839 — proven on the calendar, unproven on the charge"
revisit_if: "issue #839 settles whether the price a customer is charged matches the one they were shown"
---

## DEC-112: A departure's price comes from the offering, with a per-departure override

Each individual trip can be priced separately, rather than every trip of a type costing the
same. The column that allows it is nullable and says nothing about which system sold the
departure — a Xola trip leaves it empty, because that money lives in Xola.

The record originally said the departure's own price was the only source, because the offering
catalog did not exist yet. It does now, so the fallback chain does too.

What is not established is that the two ends agree. The calendar's resolution is tested; the
charge path's fixtures all carry an empty variation list, so a surcharge an operator configures
is proven to appear and unproven to be collected.
