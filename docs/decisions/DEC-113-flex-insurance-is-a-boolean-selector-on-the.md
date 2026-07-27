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

**Decision.** Insurance is a **boolean on the reservation** that flips which tier the refund policy reads
(BrewBoat: 14-day free-cancel → 72-hour) — **not** a general add-on / line-item and **not** a questionnaire
field. It rides the `terms` argument of `refund_owed(who, when, paid, terms)`; **no new machinery**.
**General add-ons stay parked** — model as Xola `item.addOns[]` only if ever built. The flag is **inert until
refund-policy-as-code exists**, which is **Phase 12** and **owner-gated (Drew — refund tiers)**; it is **not
required for the Phase 11 exit gate** (one paid booking) and adds **no** field to the throwaway P11 harness.
Recording now fixes the *shape* so it isn't later built as a priced product. **Revisit if:** the operator
ever wants true multi-add-on selling (then reopen as `item.addOns[]`, a conscious scope widen).

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
