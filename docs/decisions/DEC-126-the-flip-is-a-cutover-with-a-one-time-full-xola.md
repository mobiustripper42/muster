---
id: DEC-126
title: "The flip is a cutover with a one-time full Xola import — Muster becomes the reservation source of truth, and the cutover is reversible"
topic: "Reservations & payments"
amends:
  - id: DEC-105
    relation: reverses
    scope: "the parallel run ends in a cutover, not permanent coexistence — and the \"no migration\" leg"
  - id: DEC-011
    relation: amends
    scope: "coexistence ends at a cutover"
amends_spec:
  - section: "0.3"
    scope: "the arc ends in a cutover with a one-time full Xola import — it had been written to \"no cutover\""
  - section: "4"
    scope: "the historical-data park is settled by the cutover import, not left as a read-only archive"
---

## DEC-126: The flip is a cutover with a one-time full Xola import — Muster becomes the reservation source of truth, and the cutover is reversible

**Status:** Accepted (operator, 2026-07-17, S56) — the cutover model; mechanism **`@architect`-gated at
build**. Evolves DEC-105 (see the reconciliation below).

**Decision.** The flip from Xola to Muster is a **cutover**, not the "Xola drains naturally, no migration"
picture DEC-105 first painted. At cutover:

1. **One-time full import of ALL Xola reservations into Muster.** After it, **Muster is the single source
   of truth for reservations** — availability (DEC-125) sees *every* booking (imported + Muster-native), so
   nothing double-books. This is the whole reason the import exists: a reservation only avoids collision if
   it lives where the availability check looks, and post-cutover that's Muster.
2. **Money stays in Xola for the imported bookings.** Muster manages the *reservation* (arrival, cancel,
   roster, message); Xola keeps the *money* for anything it sold. New Muster-native bookings run through
   Stripe (DEC-107). So a Muster reservation may point at money held in either system.
3. **The ongoing Xola API pull STOPS.** Coexistence had a continuous pull (DEC-036/040); the cutover import
   is **one-time**, and after it there is no recurring import. Xola is no longer an input.
4. **Muster can cancel a Xola-originated reservation — IN MUSTER, with no write to Xola** (operator,
   2026-07-18). Today the operator can't cancel an imported reservation from Muster at all; after the import
   they need a Muster-side cancel action (marks it cancelled, **frees the slot**). **Muster does NOT write
   to Xola** — no API cancel/refund. The **money** side is the operator's **manual click in Xola** (they'll
   already be in Xola for imported bookings). Which path a cancel takes is read off the existing **`source`
   discriminator** (DEC-106): `source='muster'` → Stripe refund automated (DEC-107); `source='xola'` → the
   UI says "refund this in Xola" and only frees the slot here. No new "money-home" flag — `source` already
   carries it.
5. **The cutover is REVERSIBLE — a hard rollback requirement.** If Muster-reservations is a total failure at
   go-live, we must be able to **cut back to Xola**. So the cutover must not destroy or mutate Xola's own
   records, and Muster's forward-book must be exportable/re-keyable back into Xola for the window where
   rollback is credible. This is a first-class requirement, not a nicety — it's the stop-gap that makes the
   cutover safe to attempt.

**Reconciliation with DEC-105.** DEC-105 said "permanent coexistence, **no cutover, no migration**, Xola
drains." That was the **pilot** model — Muster sells a *subset* alongside Xola. DEC-126 is the **flip**: once
Muster-reservations is trusted, it takes over *fully*, and the clean way to do that without double-booking is
to bring Xola's whole forward-book into Muster in one import. So the two live **in sequence** — coexistence
(pilot) → cutover (flip) — but DEC-126 **does reverse DEC-105's "no migration" leg**: there *is* a one-time
migration, by design. SPEC §0.3/§4 are re-reconciled for this (they had been written to "no cutover").

**Consequence for DEC-125.** The `× muster-owned-days` mask on the availability formula is a
**pilot-coexistence** term only. Post-cutover Muster owns every reservation, so the mask is the entire
calendar and the term drops out.

**`@architect`-gated at build (NOT solved now):** the import mapping (Xola reservation → Muster
`Event`/`Reservation`, reusing the DEC-036/040 field work), the money-home flag and how cancel/refund routes
on it, the cancel-into-Xola mechanism, and the **rollback export** (Muster forward-book → Xola re-key) with
its credibility window. **Touches** DEC-105 (evolves the flip model), DEC-036/040 (reuses the import field
work, one-time not recurring), DEC-107 (Stripe for native; Xola money for imported), DEC-108/109 (the claim
now sees imported rows too), DEC-125 (retires the ownership mask).

> **Correction (2026-08-06, #615 — this decision was wrong about the code).**
>
> The rationale above states that *"a reservation only avoids collision if it lives where the
> availability check looks."* Imported Xola reservations **did** live there, and the availability check
> **did not look at them** — every layer of the sell funnel filtered `source='muster'`, so an imported
> booking did not make its boat unsellable.
>
> That was masked rather than handled: the DEC-106 owned-day allowlist meant Muster sold only on days
> explicitly marked, and a day was only marked once it held no live Xola bookings. Retiring that
> allowlist (DEC-149) removed the mask, leaving only the `RESERVATIONS` flag — a deployment setting, not
> a mechanism — between the funnel and a boat Xola had already sold.
>
> **Fixed in #615.** The sell guard now treats any scheduled trip on a hull as occupying it for its
> duration, whichever system sold it. The cutover is a data move again, which is what this decision
> assumed it already was.
