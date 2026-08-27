---
schema: 1
id: DEC-138
title: "The booking flow reaches customers as an embed, not a rebuilt website"
topic: "Reservations & payments"
status: "active"
date: "2026-07-20"
ruling: "The booking flow is meant to reach customers as something dropped into the operator's existing website, rather than by rebuilding that website. Nothing of the embed is built; only the shape is kept open."
claims:
  - kind: "route"
    target: "/book"
  - kind: "unverifiable"
    target: "no embed route, no snippet, no message passing, and no second origin exist"
revisit_if: "reservations get close enough to live that the embed has to be built rather than anticipated"
---

## DEC-138: The booking flow reaches customers as an embed, not a rebuilt website

The operator's marketing site runs on WordPress. Rebuilding it to launch bookings would couple
two unrelated efforts and delay the half of the Xola replacement that makes money, so the flow
is meant to arrive as a paste-in that replaces the existing booking widget on the page that is
already there.

The same snippet on another operator's site would be the sell-it path. That is not being built
and is not being planned — what the decision buys is only that the shape does not foreclose it.

Keeping this open costs almost nothing today, and that is the whole argument: every step of the
flow is its own address with its state in the query string, which is worth having anyway and
happens to be what an embed needs.

There is deliberately no spec section for this. A spec describes what the system does, and the
system does not do this — a subsection describing an embed that does not exist is the kind of
writing that reads as a description and is a guess, which is what this record was rewritten to
stop doing. It gets one when somebody builds it.
