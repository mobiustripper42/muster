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

import { parseWholeNumberSetting } from "../config/whole-number-setting.js";
import type { PaymentStatus, ReservationStatus } from "../domain/entities.js";

export interface PaymentConfig {
  /** The deposit a customer may pay now instead of the whole quote, in cents — one fixed number,
   *  not a percent (issue #1250, `docs/SPEC.md §2.8.4d`). Stored as `payment.deposit_cents`. */
  depositCents: number;
  /** Sales-tax rate in BASIS POINTS (725 = 7.25%) — integer, float-free (DEC-112). Ohio. */
  taxRateBps: number;
  /** Service fee in BASIS POINTS (300 = 3%) on everything but tax — fare, extras, insurance and the
   *  tip (DEC-196); untaxed. Formerly the fare only (DEC-134). */
  serviceFeeBps: number;
  /** How many days before the departure the balance is due. Inside this window a booking is paid
   *  whole at checkout (`insideBalanceWindow`). */
  balanceDueDaysBeforeEvent: number;
  /** How many days before the departure an unpaid balance releases the seats. */
  balanceReleaseDaysBeforeEvent: number;
}

/**
 * Defaults (BrewBoat). Overridden per-field by any `payment.*` key in `app_settings`.
 *
 * `depositCents` is $100 (`docs/SPEC.md §2.8.4d`): an unconfigured deploy offers the customer a
 * deposit on a trip more than `balanceDueDaysBeforeEvent` days out, and the whole quote inside it.
 */
export const PAYMENT_CONFIG_DEFAULTS: PaymentConfig = {
  depositCents: 10000,
  taxRateBps: 725, // Ohio state sales tax 7.25% (operator-adjustable)
  serviceFeeBps: 300, // 3% of everything but tax (operator-adjustable), untaxed (DEC-196)
  balanceDueDaysBeforeEvent: 30,
  balanceReleaseDaysBeforeEvent: 21,
};

/** The `app_settings` key for the deposit. */
export const DEPOSIT_CENTS_KEY = "payment.deposit_cents";

/**
 * Parse the stored deposit. Absent ⇒ the default, silently; whole cents ⇒ that; anything else
 * (`"abc"`, `"-5"`, `"10.5"`) ⇒ the default **and a log line**, so a typo in a hand-written SQL row
 * does not turn the deposit off without anyone knowing. Same shape as `parseBookingCutoffHours`.
 */
export function parseDepositCents(raw: string | null | undefined): number {
  return parseWholeNumberSetting(
    raw,
    DEPOSIT_CENTS_KEY,
    PAYMENT_CONFIG_DEFAULTS.depositCents,
    "the deposit reads as the default — customers are offered it, not the figure the operator set",
  );
}

/** Is a deposit offered on this quote? Not inside the balance window, and only when the quote is
 *  more than the deposit — a quote at or below it is just paid whole. */
export function depositOffered(
  totalCents: number,
  depositCents: number,
  insideBalanceWindow: boolean,
): boolean {
  return !insideBalanceWindow && totalCents > depositCents;
}

/** What is due now: the deposit, or the whole quote (no deposit, or a quote at or below it). The one
 *  home of the split — `priceBooking` charges it and `totalsFor` shows it. */
export function dueNowCents(totalCents: number, depositCents: number | null): number {
  return depositCents === null || totalCents <= depositCents ? totalCents : depositCents;
}
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

/**
 * Is this payment still live money, or has it been handed back in full?
 *
 * The ONE definition of "counts as paid" for the operator-facing `paidCents` totals (purchases
 * list, calendar detail), the refund ceiling and the cancel quote. They used to spell it
 * independently as `status === "succeeded"`, which was equivalent while nothing could write a
 * partial — the moment `markPaymentRefunded` landed, one of them started netting partial
 * refunds and the other kept dropping the whole row, so a partially refunded booking rendered
 * "Paid $0.00" beside a balance that said otherwise (#522 review).
 *
 * `balanceOwedCents` does NOT use it: a refunded row still took money, so the balance reads
 * `tookMoney` below (issue #841).
 */
export const countsAsPaid = (p: { status: PaymentStatus }): boolean =>
  PAID_STATUSES.has(p.status);

/**
 * **An ALLOW-list, and the direction is the point (issue #723).**
 *
 * This was `status !== "refunded"` — a deny-list — and the comment on `balanceOwedCents` below
 * claimed the compiler would force a revisit "when the union widens to disputes or chargebacks".
 * It would not have. `!== "refunded"` type-checks cleanly against any wider union, so adding
 * `disputed` to `PaymentStatus` would have compiled green and counted a chargeback as money in
 * all five call sites at once: `balanceOwedCents`, `/admin/purchases` (`purchases-view.ts`), the
 * calendar detail, the cancel refund math, and `refund-payment`'s own guard. (`balanceOwedCents`
 * has since moved to `tookMoney`, issue #841, which is built from this set.)
 *
 * The `payments.status` column carries no CHECK constraint (deliberately — DEC-131), so nothing
 * at the database layer rejects an unexpected value either. This set is the only guard there is.
 *
 * Listed as a `Set<PaymentStatus>` rather than a `switch` because the failure mode to design
 * against is a value arriving that the union does NOT carry — a row written by an older deploy,
 * a hand-edit, a future migration. A `switch` with a `default: return true` reintroduces exactly
 * the bug; a set lookup answers `false` for anything it was never taught, which is the safe
 * answer for a question that means "is this real money".
 */
const PAID_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  "succeeded",
  // Still money: the refunded PART is netted out of the paid totals by their callers, not here.
  "partially_refunded",
]);

const TOOK_MONEY_STATUSES: ReadonlySet<PaymentStatus> = new Set([...PAID_STATUSES, "refunded"]);

/**
 * Did this payment take money from the customer at some point? `succeeded`,
 * `partially_refunded` and `refunded` — what counts as paid, plus `refunded`, the one status that
 * took money and no longer counts as paid.
 *
 * Used by `balanceOwedCents` only. A refund on a booking that is still going ahead lowers the
 * price and the amount paid together (issue #841), so the balance counts a refunded row at its
 * gross amount. Built from `PAID_STATUSES` so the two cannot drift, and an allow-list for the same
 * reason (issue #723): a status it was never taught — `disputed`, `dispute_lost`, a value from an
 * older deploy — answers `false`.
 */
export const tookMoney = (p: { status: PaymentStatus }): boolean =>
  TOOK_MONEY_STATUSES.has(p.status);

/**
 * The balance still OWED on a reservation, derived (11.2b, DEC-107) — never a
 * recompute of the deposit share. `total = fare + tax`, minus what every payment that took
 * money contributed toward fare+tax (the deposit carried all the tax, so the residual is pure
 * principal). The `Payment` entity mandates balance be derived, not stored, so this is
 * the ONE authority: immune to a `depositCents`/price change between deposit and
 * balance. `<= 0` means nothing owed.
 *
 * **A refund never changes the balance (issue #841).** Money that went back to the card lowers
 * the trip's price by the same amount, so a booking paid in full that is refunded part or all of
 * the way still owes nothing. Each row counts at its gross amount, whatever its refund status
 * (`tookMoney`), and `refundedCents` is not read. This replaces the tip-first netting the
 * balance used since #522, under which a refund past the tip and fee re-opened a balance that
 * `createBalanceCheckout` would then charge. A refund that comes off the balance instead is
 * issue #1222.
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
    flexCents?: number;
  }[],
): number {
  const total = fareCents + taxCentsFor(fareCents, taxRateBps);
  // Net the GRATUITY, the SERVICE FEE and the INSURANCE out of each amount taken (DEC-124 /
  // DEC-134 / 16.8): the tip is crew money, the fee a one-shot surcharge, insurance a flat
  // untaxed $30 — none is part of fare+tax, so counting any as "paid toward balance" would
  // under-charge a deposit booking's balance.
  //
  // A refunded row still counts, at its gross amount: a refund lowers the price and the amount
  // paid together, so it never re-opens the balance (issue #841). Only a row that took no money
  // (`tookMoney`) is skipped — `disputed` and `dispute_lost` contribute nothing, unchanged.
  const paid = payments.reduce((sum, p) => {
    if (!tookMoney(p)) return sum;
    const notFareOrTax = (p.gratuityCents ?? 0) + (p.serviceFeeCents ?? 0) + (p.flexCents ?? 0);
    return sum + p.amountCents - notFareOrTax;
  }, 0);
  return total - paid;
}

/**
 * The balance a SURFACE should show: `balanceOwedCents`, except that a **cancelled booking owes
 * nothing** (issue #803).
 *
 * `balanceOwedCents` above is arithmetic — fare + tax minus what was taken — and it is a live
 * number for a live trip. Once the trip is cancelled it is meaningless: the guest's own page said
 * "Balance · due before your trip $575.32" on a cruise that had been cancelled AND refunded.
 *
 * **Deliberately a separate function rather than a `status` parameter on `balanceOwedCents`.**
 * The two non-presentation callers already refuse a cancelled reservation before they reach the
 * arithmetic — `createBalanceCheckout` returns `not_active` (`create-balance-checkout.ts`), and
 * the balance webhook early-returns on "cancelled or unpriced" (`booking-webhook.ts`). So folding
 * the status in there would be dead code, not a fix.
 *
 * The reason to keep them apart is the one that survives that: `balanceOwedCents` answers "what
 * does the arithmetic say", and the webhook's OVERPAY guard is a caller that genuinely wants that
 * answer and nothing else — it alerts when the derived balance has gone NEGATIVE, so a policy
 * rule quietly returning 0 is the wrong shape of answer for it, whether or not today's control
 * flow can reach it. Arithmetic stays arithmetic; the status rule belongs where the number is
 * presented.
 */
export function balanceDueCents(
  status: ReservationStatus,
  fareCents: number,
  taxRateBps: number,
  payments: Parameters<typeof balanceOwedCents>[2],
): number {
  if (status !== "booked") return 0;
  return balanceOwedCents(fareCents, taxRateBps, payments);
}
