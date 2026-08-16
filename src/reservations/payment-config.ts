/**
 * Operator-tunable payment config (DEC-107) — lives in `app_settings` (the DEC-054
 * typed-port KV), NOT env vars (env is for secrets: the Stripe keys) and NOT a new
 * table. A cohesive cluster edited on one P12 admin settings screen, so it's exposed as
 * ONE struct via `getPaymentConfig`/`setPaymentConfig` (the adapter maps each field to
 * its own `payment.*` key, applying the per-field default on an absent key — the DEC-054
 * absent⇒default idiom). Code holds the defaults below (BrewBoat's numbers).
 *
 * Refund terms are deliberately NOT here — they are the operator's PUBLISHED policy, not a
 * knob, and a term a customer agreed to at booking must not be re-quoted by a later settings
 * edit. They live as code constants in `refund-terms.ts`, which since #619 exists and is
 * rendered at checkout, on the manage page, and in the confirmation.
 *
 * Refunds are no longer always manual: DEC-107's amendment (#472) auto-refunds the
 * residual-race loser. Manual-only now narrows to operator-discretion refunds, and the
 * §3.3 cancel cascade stays parked (self-service cancel is #616).
 */

import type { PaymentStatus } from "../domain/entities.js";

export interface PaymentConfig {
  /** Charge the whole price up front, or a deposit now + balance later (11.2b). */
  depositMode: "full" | "deposit";
  /** Deposit as an integer percent (used only when `depositMode === "deposit"`). */
  depositPercent: number;
  /** Sales-tax rate in BASIS POINTS (725 = 7.25%) — integer, float-free (DEC-112). Ohio. */
  taxRateBps: number;
  /** Service fee in BASIS POINTS (300 = 3%) on the FARE only (base + extras) — independent of
   *  tax and tip (DEC-134). Charged IN FULL with the deposit charge; the balance carries none. */
  serviceFeeBps: number;
  /** How many days before the event the balance is due — a formalized default; the
   *  scheduler that reads it (auto-emit) is P12+. Balance is collected on demand for now. */
  balanceDueDaysBeforeEvent: number;
}

/**
 * Defaults (BrewBoat). Overridden per-field by any `payment.*` key in `app_settings`.
 *
 * **`depositMode` is `full`, and that is a deliberate reversal (issue #617).** It was `deposit` at
 * 25% from the day this file was written — and nothing overrides it: production's `app_settings`
 * holds a single row and it isn't this one. So any environment nobody had configured charged 25%
 * and left 75% owed to a collection mechanism **that does not exist**. Nothing reads
 * `balanceDueDaysBeforeEvent` on a schedule; issue #712 is the unbuilt auto-collect. Collecting
 * meant the operator noticing, opening the booking, copying a link and texting it, per booking.
 *
 * A default is what an unconfigured deploy inherits, so it should be the posture that cannot leak
 * revenue by being forgotten. Deposit mode is untouched and fully supported — it is now opt-IN,
 * which is the right direction for a mode whose back half is manual.
 *
 * `depositPercent` stays at 25 so opting in remains one setting rather than two.
 *
 * **This IS the operator's choice, for every environment — recorded as DEC-155**, which reverses
 * DEC-107 on the default and launch posture only. issue #617 also asked for that posture to be an
 * explicit row in production's `app_settings` rather than inherited; it is answered by the
 * decision instead — full payment everywhere, carried by this default, with no per-environment row
 * to set and none to forget.
 */
export const PAYMENT_CONFIG_DEFAULTS: PaymentConfig = {
  depositMode: "full",
  depositPercent: 25,
  taxRateBps: 725, // Ohio state sales tax 7.25% (operator-adjustable)
  serviceFeeBps: 300, // 3% of the fare (operator-adjustable), untaxed + untipped (DEC-134)
  balanceDueDaysBeforeEvent: 14,
};

/** Tax on a taxable amount, integer cents (round half-up). Pure — used by the charge builder. */
export function taxCentsFor(taxableCents: number, taxRateBps: number): number {
  return Math.round((taxableCents * taxRateBps) / 10000);
}

/** Service fee on the FARE (base + extras), integer cents (round half-up) — never on tax or
 *  gratuity (DEC-134). Pure; the checkout builder computes it once and FREEZES it into the
 *  charge metadata (the DEC-107 freeze rule — the webhook never recomputes from live config). */
export function feeCentsFor(fareCents: number, serviceFeeBps: number): number {
  return Math.round((fareCents * serviceFeeBps) / 10000);
}

/**
 * The amount to charge NOW given the config: full price+tax+fee, or the deposit share.
 * `feeCents` is the frozen service fee (DEC-134) — like tax, it is collected IN FULL with
 * the now-charge so the balance carries none. Callers on the pre-fee hosted paths pass 0.
 */
export function chargeNowCents(
  priceCents: number,
  taxCents: number,
  feeCents: number,
  config: PaymentConfig,
): number {
  if (config.depositMode === "full") return priceCents + taxCents + feeCents;
  // Deposit is a share of the price; tax + fee are collected in full with the deposit charge
  // so the balance row carries zero of either (keeps Σ tax == total tax per reservation, and
  // the fee one-shot — the later balance charge carries NO second fee).
  return Math.round((priceCents * config.depositPercent) / 100) + taxCents + feeCents;
}

/**
 * The balance still OWED on a reservation, derived (11.2b, DEC-107) — never a
 * recompute of the deposit share. `total = fare + tax`, minus what every live payment
 * contributed toward fare+tax (the deposit carried all the tax, so the residual is pure
 * principal). The `Payment` entity mandates balance be derived, not stored, so this is
 * the ONE authority: immune to a `depositPercent`/price change between deposit and
 * balance, and the seam a refund reopens. `<= 0` means nothing owed.
 *
 * **Refund handling (amended #522).** This used to sum only `status === "succeeded"`,
 * which was equivalent to "not refunded" while nothing could write a partial. Since
 * `markPaymentRefunded` landed it isn't: a partially refunded deposit would have counted
 * as zero paid and re-billed the customer the whole fare + tax. Now a refund is netted
 * against **gratuity and fee first**, and only the remainder reduces fare+tax — see the
 * body for why that order is the customer-safe one.
 *
 * **`fareCents` is the composed party fare** — `Event.price` base **+** the frozen
 * `Reservation.extrasCents` (#474, DEC-107 amend), NOT the bare base. The base alone
 * undercollects a deposit-mode balance by `extras + tax(extras)`; callers must pass
 * `event.price + (reservation.extrasCents ?? 0)`. Extras are frozen at booking, never
 * recomputed from a live Offering — that would break the "never a config recompute" rule.
 */
/**
 * Is this payment still live money, or has it been handed back in full?
 *
 * The ONE definition of "counts as paid", shared by `balanceOwedCents` and by the
 * operator-facing `paidCents` totals (purchases list, calendar detail). They used to spell
 * it independently as `status === "succeeded"`, which was equivalent while nothing could
 * write a partial — the moment `markPaymentRefunded` landed, one of them started netting
 * partial refunds and the other kept dropping the whole row, so a partially refunded
 * booking rendered "Paid $0.00" beside a balance that said otherwise (#522 review).
 */
export const countsAsPaid = (p: { status: PaymentStatus }): boolean =>
  p.status !== "refunded";

export function balanceOwedCents(
  fareCents: number,
  taxRateBps: number,
  // `PaymentStatus`, not `string`. The body branches on status, and with a bare `string`
  // the branch is a DENY-list: any value that isn't `"refunded"` counts as fully paid.
  // The column carries no CHECK constraint (deliberately — DEC-131), so the compiler is
  // the only thing that forces this function to be revisited when the union widens to
  // disputes or chargebacks. Fail-safe was the old behaviour; keep it typed so it stays.
  payments: readonly {
    status: PaymentStatus;
    amountCents: number;
    gratuityCents?: number;
    serviceFeeCents?: number;
    refundedCents?: number;
  }[],
): number {
  const total = fareCents + taxCentsFor(fareCents, taxRateBps);
  // Net the GRATUITY and the SERVICE FEE out of each paid amount (DEC-124 / DEC-134): the tip
  // is crew money and the fee is a one-shot surcharge — neither is part of fare+tax, so
  // counting either as "paid toward balance" would under-charge a deposit booking's balance.
  //
  // A REFUNDED amount is no longer paid. Before `markPaymentRefunded` existed nothing could
  // write `partially_refunded`, so filtering to `succeeded` was equivalent to "not refunded"
  // — it isn't any more (#522 review). Left as a filter, a partially refunded deposit would
  // count as £0 paid and the balance charge would bill the customer the FULL fare + tax on
  // top of what they already paid. Netting `refundedCents` instead is correct for all three
  // states: `succeeded` has none, `partially_refunded` nets the part, `refunded` nets to 0.
  const paid = payments.reduce((sum, p) => {
    // A fully refunded row contributes nothing regardless of what `refundedCents` says —
    // it may be absent on a hand-reconciled or legacy row, and trusting the amount alone
    // would count refunded money as paid. Status wins for the terminal state.
    if (!countsAsPaid(p)) return sum;

    const notFareOrTax = (p.gratuityCents ?? 0) + (p.serviceFeeCents ?? 0);
    const towardFareAndTax = p.amountCents - notFareOrTax;

    // A refund is attributed to GRATUITY AND FEE FIRST; only what exceeds them reduces
    // fare+tax. Nothing records a refund's composition, so this is an assumption — but it
    // is the only safe one, because the likeliest partial refund an operator makes is a
    // tip-only refund, and the alternative silently re-bills fare the customer already paid.
    //
    // Worked, from a real deposit charge (fare 50000, tax 3625, fee 1500, tip 10000, 25%
    // deposit → amount 27625): toward fare+tax is 16125 and the balance is 37500. Refund
    // the $100 tip. Attributing to fare+tax first gives max(0, 16125 − 10000) = 6125 and a
    // balance of 47500 — the customer is billed $100 MORE for a refund that never touched
    // their fare, and `createBalanceCheckout` mints that charge with no human in the loop.
    // Tip-first gives 16125 and leaves the balance at 37500, which is correct.
    const fareAndTaxRefund = Math.max(0, (p.refundedCents ?? 0) - notFareOrTax);
    return sum + Math.max(0, towardFareAndTax - fareAndTaxRefund);
  }, 0);
  return total - paid;
}
