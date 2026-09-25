/**
 * The checkout's money, as the client islands receive it (16.1d, issue #1092).
 *
 * `CheckoutMoney` is `checkoutQuote`'s figures minus the tip tiers, which travel as their own prop.
 * A type-only import from the core, so nothing but the shape reaches the client bundle.
 */
import type { CheckoutQuote } from "@core/reservations/checkout-quote.js";

export type CheckoutMoney = Omit<CheckoutQuote, "tiers" | "defaultBps">;
export type TipTier = CheckoutQuote["tiers"][number];

/** Local mirror of `formatCents` — inlined so the client bundle stays tiny (book-controls idiom). */
export function money(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * What the pay bar and the summary total show once a tip is chosen. One function so the two
 * figures on screen cannot be summed two ways: the tip rides on top of the charge-now figure,
 * outside the deposit split and untaxed (DEC-124), exactly as `priceBooking` adds it.
 */
export function totalsWithTip(m: CheckoutMoney, tipCents: number): { dueNowCents: number; totalCents: number } {
  return {
    dueNowCents: m.dueNowBeforeTipCents + tipCents,
    totalCents: m.fareCents + m.taxCents + m.serviceFeeCents + tipCents,
  };
}
