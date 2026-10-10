/**
 * The checkout's money, as the client islands receive it (16.1d, issue #1092).
 *
 * `CheckoutMoney` is `checkoutQuote`'s figures minus the tip tiers, which travel as their own prop.
 * Type-only imports from the core for the shapes; `chargeTotals` is the one runtime import, and it
 * is pure.
 */
import type { CheckoutQuote, ScreenTotals } from "@core/reservations/checkout-quote.js";
import { chargeTotals } from "@core/reservations/discount.js";

export type CheckoutMoney = Omit<CheckoutQuote, "tiers" | "defaultBps">;
export type TipTier = CheckoutQuote["tiers"][number];
export type { ScreenTotals };

/** Local mirror of `formatCents` — inlined so the client bundle stays tiny (book-controls idiom). */
export function money(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * The summary's and the pay bar's figures once a tip and the insurance are chosen. One function so
 * the figures on screen cannot be summed two ways — and through `chargeTotals`, the same one
 * `priceBooking` freezes with, because the fee moves with the tip and the insurance and the tax
 * moves with the insurance (DEC-196). Adding them on top would round apart from the charge.
 *
 * `flexCents` is the insurance chosen — 0, or its undiscounted price. The discount reaches it last:
 * only what is left of `discountCents` after the whole fare comes off it, as in `applyDiscount`.
 * The deposit balance is what neither the tip, the fee, the tax nor the insurance touch, so due now
 * is the total less it.
 */
export function totalsFor(m: CheckoutMoney, tipCents: number, flexCents = 0): ScreenTotals {
  const fareDiscountCents = Math.min(m.discountCents, m.fareCents);
  const flexDueCents = Math.max(0, flexCents - (m.discountCents - fareDiscountCents));
  const t = chargeTotals({
    baseCents: m.fareCents - fareDiscountCents,
    flexDueCents,
    gratuityCents: tipCents,
    taxRateBps: m.taxRateBps,
    serviceFeeBps: m.serviceFeeBps,
  });
  return {
    tipCents,
    flexCents,
    taxCents: t.taxCents,
    serviceFeeCents: t.serviceFeeCents,
    totalCents: t.totalCents,
    dueNowCents: t.totalCents - m.balanceLaterCents,
  };
}
