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
