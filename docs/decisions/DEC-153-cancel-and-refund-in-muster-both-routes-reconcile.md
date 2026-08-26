---
id: DEC-153
title: "Cancel and refund from Muster — the operator keeps the discretion, both routes reconcile, and cancelling releases the event not just the reservation"
topic: "Reservations & payments"
amends_spec:
  - section: "3.3"
    scope: "the STATUS claim only — \"nothing in `src/` implements a cascade or a refund\" is no longer true, and neither is §0.2's reading that the whole refund surface is parked. The cascade's own design is untouched and still unbuilt: shift-level cancel from the At-Risk board, the per-booking fan-out, rebook-or-credit offered before cash, and the customer notification all stand exactly as written. What exists now is reservation-level cancel + refund from the calendar detail pane, which supplies §3.3's step 1 (the policy function, `refund-terms.ts`), its step 2 (operator-initiated ⇒ full refund) and half of step 4 (issue the refund, set the booking to Cancelled) for ONE booking at a time, with no fan-out and no customer notice"
---

## DEC-153: Cancel and refund from Muster — the operator keeps the discretion, both routes reconcile, and cancelling releases the event not just the reservation

Retired 2026-08-26. Every ruling in this decision was adjudicated DEAD during the
reservations decision decomposition — see issue #816, which is the current record for
this work. Nothing here governs what is being built.

The file is kept, with its id and filename, so existing references still resolve.
What is true now lives in the code and in `docs/SPEC.md`; git history holds the original.
