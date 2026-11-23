/**
 * Tax and service-fee arithmetic on a base, integer cents — a leaf with no imports, so
 * `payment-config.ts` and `discount.ts` can both depend on it without depending on each other
 * (issue #1266).
 */

/** Tax on a taxable amount, integer cents (round half-up). Pure — used by the charge builder. */
export function taxCentsFor(taxableCents: number, taxRateBps: number): number {
  return Math.round((taxableCents * taxRateBps) / 10000);
}

/** Service fee on its base, integer cents (round half-up). The base is everything charged except
 *  tax — fare + extras + insurance + tip (operator 2026-10-09, DEC-196, which reverses DEC-134's
 *  fare-only base). Composed in one place, `chargeTotals`; frozen on the invoice, never recomputed
 *  from live config. */
export function feeCentsFor(baseCents: number, serviceFeeBps: number): number {
  return Math.round((baseCents * serviceFeeBps) / 10000);
}
