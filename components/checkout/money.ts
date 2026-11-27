/**
 * The checkout's money, as the client islands receive it (16.1d, issue #1092).
 *
 * `CheckoutMoney` is `checkoutQuote`'s figures minus the tip tiers, which travel as their own prop.
 * Type-only imports from the core for the shapes; `chargeTotals`, `dueNowCents` and
 * `depositOffered` are the runtime imports, and they are pure.
 */
import type { StripePaymentElementOptions } from "@stripe/stripe-js";
import type { CheckoutQuote, ScreenTotals } from "@core/reservations/checkout-quote.js";
import { chargeTotals } from "@core/reservations/discount.js";
import { ALLOWED_PAYMENT_METHOD_TYPES, depositOffered, dueNowCents } from "@core/reservations/payment-config.js";

export type CheckoutMoney = Omit<CheckoutQuote, "tiers" | "defaultBps">;
export type TipTier = CheckoutQuote["tiers"][number];
export type { ScreenTotals };

/** What a refused price says to a customer, for both public actions (issues #1217, #1251). Here
 *  because a `"use server"` module may export only async functions. */
export const PRICE_CHANGED_MESSAGE =
  "The price changed while you were checking out — reload to see the new total. You have not been charged.";

/** Local mirror of `formatCents` — inlined so the client bundle stays tiny (book-controls idiom). */
export function money(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** The options the deferred `<Elements>` mounts with (`StripeElementsOptionsMode`'s fields we use). */
export interface ElementsOptions {
  mode: "payment";
  amount: number;
  currency: "usd";
  setupFutureUsage?: "off_session";
  allowedPaymentMethodTypes: string[];
}

/** Which payment the form takes: the whole quote, the deposit (saves the card), or the balance. */
export type ElementsMode = "full" | "deposit" | "balance";

/**
 * The one home for the payment form's options (issue #1250). Every payment offers cards only, from
 * `ALLOWED_PAYMENT_METHOD_TYPES` (issue #1288, DEC-203). With the deposit chosen the form also saves
 * the card for the balance. Pay in full and the balance (issue #1254) save nothing — the card is
 * being charged now, matching the intents `createPaymentIntent` makes.
 *
 * Stripe's deferred Elements docs: `setupFutureUsage` "should match the setup_future_usage provided on
 * the Intent used when confirming payment" — so the form is remounted on the choice, not
 * `elements.update`d, to change the saving.
 */
export function elementsOptions(amountCents: number, mode: ElementsMode): ElementsOptions {
  return {
    mode: "payment",
    amount: amountCents,
    currency: "usd",
    allowedPaymentMethodTypes: [...ALLOWED_PAYMENT_METHOD_TYPES],
    ...(mode === "deposit" ? { setupFutureUsage: "off_session" as const } : {}),
  };
}

/**
 * The card box's own options, for both `<PaymentElement>` mounts (issue #1288, DEC-203): Apple Pay,
 * Google Pay and Link are off on every payment. The checkout (full, deposit) also leaves name and
 * phone to the contact fields above the box (#679); the balance form has no contact fields, so it
 * sets no `fields`. Name and phone only — a field disabled here becomes REQUIRED at confirm, and
 * email is optional at `/book`.
 */
export function paymentElementOptions(mode: ElementsMode): StripePaymentElementOptions {
  return {
    wallets: { applePay: "never", googlePay: "never", link: "never" },
    ...(mode === "balance" ? {} : { fields: { billingDetails: { name: "never", phone: "never" } } }),
  };
}

/**
 * The payment choice's and the terms box's wording (issue #1250), or null when no deposit is offered
 * — inside the balance window, or a quote at or below the deposit. Pure, so the strings are tested
 * here and the form only renders them, showing `termsLine` while Pay deposit is chosen.
 *
 * The balance in these strings is the deposit's, **whatever the current choice**: the choice states
 * what the deposit would leave, so it reads the same with Pay in full selected.
 */
export function depositCopy(
  m: CheckoutMoney,
  totals: ScreenTotals,
): { depositLabel: string; depositNote: string; fullLabel: string; termsLine: string } | null {
  if (m.depositCents === null || m.balanceDueOn === null) return null;
  if (!depositOffered(totals.totalCents, m.depositCents, false)) return null;
  const balance = money(totals.totalCents - dueNowCents(totals.totalCents, m.depositCents));
  return {
    depositLabel: `Pay deposit · ${money(m.depositCents)}`,
    depositNote: `${balance} charged to this card on ${m.balanceDueOn}`,
    fullLabel: `Pay in full · ${money(totals.totalCents)}`,
    termsLine: `We'll charge the balance of ${balance} to this card on ${m.balanceDueOn}.`,
  };
}

/**
 * The split of a frozen invoice (issue #1251): the frozen totals unchanged except what is due now
 * and the balance it leaves. The one home for it — the payment link's page and its form's two
 * choices both read it, so nothing re-prices an invoice the operator already froze.
 */
export function splitFrozen(totals: ScreenTotals, depositCents: number | null, payDeposit: boolean): ScreenTotals {
  const dueNow = dueNowCents(totals.totalCents, payDeposit ? depositCents : null);
  return { ...totals, dueNowCents: dueNow, balanceCents: totals.totalCents - dueNow };
}

/**
 * The summary's and the pay bar's figures once a tip and the insurance are chosen. One function so
 * the figures on screen cannot be summed two ways — and through `chargeTotals`, the same one
 * `priceBooking` freezes with, because the fee moves with the tip and the insurance and the tax
 * moves with the insurance (DEC-196). Adding them on top would round apart from the charge.
 *
 * `flexCents` is the insurance chosen — 0, or its undiscounted price. The discount reaches it last:
 * only what is left of `discountCents` after the whole fare comes off it, as in `applyDiscount`.
 * `payDeposit` is the customer's choice: due now is then `dueNowCents` — the one split `priceBooking`
 * charges with — and the balance is what is left of the total. Without a deposit on the quote
 * (`m.depositCents` null) the whole total is due whatever was asked.
 */
export function totalsFor(m: CheckoutMoney, tipCents: number, flexCents = 0, payDeposit = false): ScreenTotals {
  const fareDiscountCents = Math.min(m.discountCents, m.fareCents);
  const flexDueCents = Math.max(0, flexCents - (m.discountCents - fareDiscountCents));
  const t = chargeTotals({
    baseCents: m.fareCents - fareDiscountCents,
    flexDueCents,
    gratuityCents: tipCents,
    taxRateBps: m.taxRateBps,
    serviceFeeBps: m.serviceFeeBps,
  });
  const dueNow = dueNowCents(t.totalCents, payDeposit ? m.depositCents : null);
  return {
    tipCents,
    flexCents,
    taxCents: t.taxCents,
    serviceFeeCents: t.serviceFeeCents,
    totalCents: t.totalCents,
    dueNowCents: dueNow,
    balanceCents: t.totalCents - dueNow,
  };
}
