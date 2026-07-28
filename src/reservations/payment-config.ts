/**
 * Operator-tunable payment config (DEC-107) — lives in `app_settings` (the DEC-054
 * typed-port KV), NOT env vars (env is for secrets: the Stripe keys) and NOT a new
 * table. A cohesive cluster edited on one P12 admin settings screen, so it's exposed as
 * ONE struct via `getPaymentConfig`/`setPaymentConfig` (the adapter maps each field to
 * its own `payment.*` key, applying the per-field default on an absent key — the DEC-054
 * absent⇒default idiom). Code holds the defaults below (BrewBoat's numbers).
 *
 * Refund tiers are deliberately NOT here — refunds are always manual (Stripe dashboard),
 * and the refund cascade is parked (DEC-107); config for an unbuilt surface is
 * speculative. They live as code constants in `refund-terms.ts`, inert until that phase.
 */

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

/** Defaults (BrewBoat). Overridden per-field by any `payment.*` key set on the settings screen. */
export const PAYMENT_CONFIG_DEFAULTS: PaymentConfig = {
  depositMode: "deposit",
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
 * recompute of the deposit share. `total = fare + tax`, minus the sum of every
 * SUCCEEDED payment already collected (the deposit carried all the tax, so the
 * residual is pure principal). The `Payment` entity mandates balance be derived,
 * not stored, so this is the ONE authority: immune to a `depositPercent`/price
 * change between deposit and balance, and the single seam a future refund reopens
 * (a refund drops a payment out of the succeeded sum → balance re-opens). `<= 0`
 * means nothing owed (paid in full, or full-mode).
 *
 * **`fareCents` is the composed party fare** — `Event.price` base **+** the frozen
 * `Reservation.extrasCents` (#474, DEC-107 amend), NOT the bare base. The base alone
 * undercollects a deposit-mode balance by `extras + tax(extras)`; callers must pass
 * `event.price + (reservation.extrasCents ?? 0)`. Extras are frozen at booking, never
 * recomputed from a live Offering — that would break the "never a config recompute" rule.
 */
export function balanceOwedCents(
  fareCents: number,
  taxRateBps: number,
  payments: readonly {
    status: string;
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
    if (p.status === "refunded") return sum;
    const towardFareAndTax =
      p.amountCents - (p.gratuityCents ?? 0) - (p.serviceFeeCents ?? 0);
    // Refunds come off what was paid toward fare+tax, floored at zero — a FULL refund
    // returns the tip and fee too, so netting them a second time would push this negative
    // and inflate the balance. Which part of a PARTIAL refund came back is not modelled
    // (nothing records a refund's composition), so it is attributed to fare+tax first,
    // which errs toward still-owed rather than silently forgiving a balance.
    return sum + Math.max(0, towardFareAndTax - (p.refundedCents ?? 0));
  }, 0);
  return total - paid;
}
