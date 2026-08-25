---
id: DEC-113
title: "Flex-insurance is a boolean selector on the reservation, not a priced add-on product"
topic: "Reservations & payments"
---

## DEC-113: Flex-insurance is a boolean selector on the reservation, not a priced add-on product

**Status:** Decided 2026-07-11 (@architect + Eric, under DEC-105/107/110). **Recorded now to prevent
mis-modeling; the build is Phase 12.**

**Context.** Xola exposes general add-ons + a questionnaire; the operator's own booking design keeps exactly
**one** upsell — cancellation insurance ("Flex Insurance: Yes/No") — and models it as a policy flag, not a
product (`docs/design/the-booking-1.md §4`, `the-living-link-1.md §5`; confirmed by the Xola purchase line
"Flex Insurance: No — $0.00").

**Decision.** Insurance is a **boolean on the reservation** that selects which cancellation window
applies — **not** a general add-on, a line item, or a questionnaire field. The windows and the price are
`SPEC.md` §2.8.4c.

**Why it must not be an add-on**, which is the whole reason this file exists: an add-on is taxed and
charged the service fee like revenue (§2.8.4a). Insurance is neither. Modelling it as one silently
changes what the customer pays and what the operator owes. Recording the shape early is what stops it
being built as a priced product later. **Revisit if:** the operator ever wants true multi-add-on
selling — and even then, not this.

> **Two corrections (2026-07-25).**
> 1. **`refund_owed` does not exist.** It is a `SPEC.md` §3.3 formula, and §3.3 is **parked** by DEC-107.
>    So "no new machinery" means *no new machinery beyond the refund policy itself*, which is still
>    unbuilt — DEC-135 confirms the #472 refund policy does not exist. **Flex-insurance remains
>    unimplemented**, consistent with everything above; nothing to reconcile in code.
> 2. **The "general add-ons stay parked" revisit fired.** Add-ons shipped as a **first-class entity**
>    (`20260721000000_add_ons_entity.sql`, #491), a twin to `vessels`/`locations` that offerings attach
>    by id — a wider scope than the `item.addOns[]` reopen this DEC anticipated. That widen belongs to
>    DEC-123's catalog, not here. **What survives, and is the reason this DEC exists:** flex-insurance
>    is still a *policy boolean*, **not** one of those add-on rows. Do not model it as one.
