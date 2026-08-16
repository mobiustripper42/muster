---
id: DEC-155
title: "Full payment is the default and the launch posture — deposit mode becomes opt-in (#617)"
topic: "Reservations & payments"
amends:
  - id: DEC-107
    relation: reverses
    scope: "the DEFAULT and launch posture only — deposit-vs-full. Deposit + balance remains fully built and fully supported: the deposit share, the balance deriver, the balance checkout link, and the frozen-money rule are untouched. What changes is which one an unconfigured deploy inherits."
---

## DEC-155: Full payment is the default and the launch posture

**Status:** Decided 2026-08-16 (operator).

**Context.** DEC-107 recorded the owner's choice of deposit + balance over full-upfront, as the closer match to
Xola. That choice was implemented as the **code default** — `PAYMENT_CONFIG_DEFAULTS.depositMode = "deposit"` at
25% — and never written into any environment's `app_settings`. Production holds exactly one settings row
(`engine_paused`), so the posture was inherited rather than chosen, everywhere.

The half that makes deposits work was never built. **Nothing reads `balanceDueDaysBeforeEvent` on a schedule**:
there is no reminder, no scheduler, no due-date emit. Issue #712 is the auto-collect, and it is unbuilt and now
deferred. Collecting the remaining 75% meant the operator noticing, opening the reservation, copying a URL and
texting it — per booking, forever.

Issue #617 raised this and recommended two things: flip the default, and stop telling customers the balance is
charged automatically. **PR #734 did the copy half and the issue was closed.** The flip was lost, and surfaced
again only when a local checkout still quoted a 25% deposit and nobody could account for it.

**Decision.** `depositMode` defaults to **`full`**. One charge at booking: fare + extras + tax + service fee +
gratuity, nothing deferred, no balance to collect.

- **Deposit mode is not removed.** Every mechanism stays — `chargeNowCents`'s deposit branch, `balanceOwedCents`,
  the operator's balance-link action, the manage page's balance row. It is **opt-in**: set `payment.depositMode`
  to `deposit` and the whole path returns.
- **`depositPercent` stays at 25**, so opting in remains one setting rather than two.
- **Existing bookings are unaffected.** `balanceOwedCents` derives from stored `Payment` rows, never from the live
  config, so a reservation taken under deposit mode keeps its outstanding balance and renders it correctly.

**Why the DEFAULT is the thing that mattered.** A default is what an unconfigured deploy inherits — a fresh
preview, a restored database, a new environment, or a production that nobody remembered to configure. It should
therefore be the posture that cannot leak revenue by being forgotten. Full payment has no second step to forget;
deposit mode's second step is a human, per booking, with no reminder.

**This is the operator's choice for every environment, and that answers issue #617's second acceptance criterion
by decision rather than by task.** #617 asked for the launch posture to be an explicit row in production's
`app_settings` rather than inherited. It is answered here instead: full payment is the choice, everywhere, and the
default carries it. There is no per-environment row to set, and none to forget.

**What this does not decide.** Whether BrewBoat ever *wants* deposits back is Drew's call, and the machinery is
waiting if so — but it should not come back until something collects the balance without a person remembering
(issue #712).

**It does, however, change what issue #574 means, and the first draft of this decision got that wrong.** #574 is
filed as a deposit-mode defect: `balanceOwedCents` computes the total from the **live** tax rate while each
payment carries the **frozen** one, so the balance drifts by `liveTax − frozenTax`. Under the old deposit default
that drift hid inside a real 75% balance. Under full payment it is *more* visible, not less — a booking paid in
full has a balance of exactly zero, so any later edit to `payment.tax_rate_bps` gives every previously settled
booking a **phantom balance**: rendered to the customer as "Balance · due before your trip", shown as unpaid in
`/admin/purchases`, and mintable as a real Stripe charge through the balance link.

Nothing in this decision introduces that — the mechanism predates it and no operator has edited the rate — but it
is wrong to say #574 sleeps until deposits return. It sleeps until someone changes the tax rate, in either mode.
