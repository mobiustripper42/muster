---
schema: 1
id: DEC-012
title: "The guest manifest is grouped per event on the shift card"
topic: "Crew, vessels & manning model"
status: "active"
date: "2026-06-03"
ruling: "The shift card shows one guest list per event (a Saturday shift: separate 1pm, 3pm and 5pm lists), each name, party size and phone. Waiver coverage is not on the manifest; it lives on the check-in screen."
claims:
  - kind: "file"
    target: "src/crewapp/shift-card.ts"
    note: "the per-event manifest"
  - kind: "spec"
    target: "2.6"
revisit_if: "Crew need waiver status on the manifest itself, not only at check-in"
amends_spec:
  - section: "0.4"
    scope: "the Manifest row: waiver coverage is the check-in screen's, not the manifest's"
  - section: "1.3"
    scope: "a waiver is check-in's concern and never gates"
  - section: "2.2"
    scope: "the manifest source no longer says crew don't need waivers"
  - section: "2.6"
    scope: "waiver coverage is shown at check-in, reached from the shift card"
  - section: "2.8"
    scope: "2.8.12: the per-guest waiver roster is no longer deferred; the check-in module builds it"
---

## DEC-012: The guest manifest is grouped per event on the shift card

Different customers are on each event, so crew need a list per event. Once the card is the source
of truth, crew stop needing Xola. The manifest's contact fields are name, party size and a nullable
phone, fed from the booking.

This record also said waivers are not shown to crew. That held while Xola owned waivers; it does not
survive check-in, where the mate at the gangway is the only person who can act on who has signed.
Waiver coverage is the check-in module's (DEC-187), reached from the shift card. The manifest itself
still carries no waiver field.
