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
  /** How many days before the event the balance is due — a formalized default; the
   *  scheduler that reads it (auto-emit) is P12+. Balance is collected on demand for now. */
  balanceDueDaysBeforeEvent: number;
}

/** Defaults (BrewBoat). Overridden per-field by any `payment.*` key set on the settings screen. */
export const PAYMENT_CONFIG_DEFAULTS: PaymentConfig = {
  depositMode: "deposit",
  depositPercent: 25,
  taxRateBps: 725, // Ohio state sales tax 7.25% (operator-adjustable)
  balanceDueDaysBeforeEvent: 14,
};

/** Tax on a taxable amount, integer cents (round half-up). Pure — used by the charge builder. */
export function taxCentsFor(taxableCents: number, taxRateBps: number): number {
  return Math.round((taxableCents * taxRateBps) / 10000);
}

/** The amount to charge NOW given the config: full price+tax, or the deposit share. */
export function chargeNowCents(
  priceCents: number,
  taxCents: number,
  config: PaymentConfig,
): number {
  if (config.depositMode === "full") return priceCents + taxCents;
  // Deposit is a share of the price; tax is collected in full with the deposit charge so
  // the balance row carries zero tax (keeps Σ tax == total tax per reservation).
  return Math.round((priceCents * config.depositPercent) / 100) + taxCents;
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
  payments: readonly { status: string; amountCents: number; gratuityCents?: number }[],
): number {
  const total = fareCents + taxCentsFor(fareCents, taxRateBps);
  // Net the GRATUITY out of each paid amount (DEC-124, 12.3): the tip is crew money bundled
  // into the charge, never part of fare+tax, so counting it as "paid toward balance" would
  // under-charge the balance on a deposit booking.
  const paid = payments
    .filter((p) => p.status === "succeeded")
    .reduce((sum, p) => sum + p.amountCents - (p.gratuityCents ?? 0), 0);
  return total - paid;
}
