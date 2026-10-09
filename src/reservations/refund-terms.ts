/**
 * Cancellation terms as code constants (#619) — the file `payment-config.ts` has cited since
 * Phase 11 and which did not exist until now. Deliberately NOT `app_settings` config: these
 * are the operator's *published* terms (brewcle.com), not a knob, and a term a customer agreed
 * to at booking time must not be silently re-quoted by a later settings edit.
 *
 * The policy, verbatim from the operator (2026-08-06):
 *
 *   > Bookings canceled 14 days prior to your cruise will be refunded minus a $50 cancellation
 *   > fee. Cancellations less than 14 days from your scheduled cruise are non-refundable.
 *   > Likewise, no-shows will not receive any credits or refunds. If your tour is canceled due
 *   > to inclement weather, we will provide you with a full refund. Optional cancellation
 *   > insurance is provided for $30 which allows for a 72 hour cancelation before the tour.
 *
 * All four rules are encoded and rendered here. Cancellation insurance ("flex" in code) is sold
 * with the booking since 16.8 (issue #683): a checkbox at checkout and on the phone booking, frozen
 * onto the invoice as `flexCents`. The copy picks the terms the booking bought — a booking without
 * insurance is told it exists; one with it is told its 72 hours.
 *
 * **What insurance buys** (operator, 2026-10-09): a 72-hour line instead of 14 days, and **no $50
 * fee** — a cancellation 72 hours or more out gets everything paid back except the insurance itself.
 * The published sentence never mentioned the fee; reading it as "still applies" was the spec's
 * inference until the operator corrected it.
 *
 * This file takes the insurance as a number — what was charged for it — and never reads the
 * invoice. `flexChargedCents(invoice)` in `discount.ts` is the one way to ask a booking.
 *
 * Money is integer CENTS (DEC-112). Pure — no clock, no repo. The caller supplies the notice
 * because only it knows the departure instant and the tenant timezone.
 */

/** Refund fee withheld from a customer-initiated cancellation without insurance. $50. */
export const CANCELLATION_FEE_CENTS = 5000;

/** Price of optional cancellation insurance. $30, flat. Taxed and in the service-fee base like
 *  the fare (DEC-196); not in the tip base. Kept on an insured cancellation. */
export const FLEX_INSURANCE_CENTS = 3000;

/** Standard free-cancel line: "canceled 14 days prior … will be refunded minus [the fee]". */
export const STANDARD_CANCEL_DAYS_BEFORE = 14;

/** Flex-insurance line: "a 72 hour cancelation before the tour". */
export const FLEX_CANCEL_HOURS_BEFORE = 72;

const HOURS_PER_DAY = 24;

/** `5000` → `"$50"`, `4950` → `"$49.50"`. Keeps the copy quoting the constants. */
function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/** The cancellation window in hours for this booking: 72 with insurance, 14 days without. */
export function cancelWindowHours(hasFlex = false): number {
  return hasFlex ? FLEX_CANCEL_HOURS_BEFORE : STANDARD_CANCEL_DAYS_BEFORE * HOURS_PER_DAY;
}

export interface RefundInput {
  /**
   * Everything the customer has actually paid and not yet had back — deposit only, or deposit +
   * balance, gratuity, service fee and insurance INCLUDED. The terms name exactly one deduction
   * each way — the $50, or the insurance — so anything netted out before this arrives is a
   * deduction we never published (#797).
   */
  paidCents: number;
  /** Notice given, in hours before departure. Zero or negative ⇒ a no-show. */
  hoursBeforeDeparture: number;
  /** Present ⇒ the booking has insurance, and this is what was charged for it (after any
   *  discount; 0 on a comp). `flexChargedCents(invoice)` answers it. */
  insurance?: { chargedCents: number } | undefined;
}

/**
 * What a CUSTOMER-initiated cancellation is owed back, in integer cents.
 *
 * Without insurance, 14 days or more out: what they paid minus the $50, floored at zero (a 25%
 * deposit can be smaller than the fee — that is a zero refund, never a negative one, and never a
 * charge). With insurance, 72 hours or more out: what they paid minus the insurance, and no fee.
 * Inside the window, and for a no-show: nothing.
 *
 * Both boundaries are inclusive — "14 days prior" reads inclusive and the edge should favour
 * the customer.
 *
 * Operator-initiated cancellations do NOT come through here — see `operatorCancelRefundCents`.
 */
export function refundOwedCents({ paidCents, hoursBeforeDeparture, insurance }: RefundInput): number {
  if (hoursBeforeDeparture < cancelWindowHours(insurance !== undefined)) return 0;
  const kept = insurance ? insurance.chargedCents : CANCELLATION_FEE_CENTS;
  return Math.max(0, paidCents - kept);
}

/**
 * What an OPERATOR-initiated cancellation is owed — weather, crew shortage, mechanical.
 * Everything paid, no fee, at any notice ("we will provide you with a full refund"), which is
 * also the SPEC.md §3.3 principled default. Kept as its own function precisely so no caller can
 * reach the fee path by passing the wrong notice: who cancelled is the discriminator, not when.
 *
 * **This was correct in isolation and wrong in use for its whole life, because its INPUT was
 * short** (#797): the caller netted out gratuity and the service fee before calling, so
 * "everything paid" could only ever return the fare. Whatever `paidCents` is handed is what comes
 * back — the identity is the policy, so the guard has to be on what the caller passes.
 */
export function operatorCancelRefundCents(paidCents: number): number {
  return Math.max(0, paidCents);
}

/** "14 days" or "72 hours" — the window a booking's copy quotes. */
function windowWords(hasFlex: boolean): string {
  return hasFlex ? `${FLEX_CANCEL_HOURS_BEFORE} hours` : `${STANDARD_CANCEL_DAYS_BEFORE} days`;
}

/**
 * Customer-facing terms — checkout (beside the insurance box), the payment link and the manage
 * page. Quotes the constants above so the prose can never drift from the math. Without insurance
 * the fourth sentence offers it; with it, 72 hours, a full refund less the insurance, and no fee.
 */
export function cancellationTerms(hasFlex: boolean): string {
  const w = windowWords(hasFlex);
  const deduction = hasFlex
    ? `a full refund, less the ${dollars(FLEX_INSURANCE_CENTS)} insurance`
    : `a refund minus a ${dollars(CANCELLATION_FEE_CENTS)} cancellation fee`;
  const terms =
    `Cancel ${w} or more before your cruise for ${deduction}. Cancellations less than ${w} out are ` +
    `non-refundable, as are no-shows. If we cancel for inclement weather, you'll receive a full refund.`;
  if (hasFlex) return terms;
  return (
    `${terms} Optional cancellation insurance (${dollars(FLEX_INSURANCE_CENTS)}) moves the ` +
    `${windowWords(false)} to ${windowWords(true)}.`
  );
}

/**
 * The line under the insurance box (16.8). A customer at checkout reads what it does; an operator
 * on the phone booking reads what to ask. Quotes the constants like the terms above.
 */
export function insuranceHint(reader: "customer" | "operator"): string {
  if (reader === "operator") {
    return `Ask them — it's ${dollars(FLEX_INSURANCE_CENTS)} and moves their cancel window to ${windowWords(true)}.`;
  }
  return `Cancel up to ${windowWords(true)} before your cruise instead of ${windowWords(false)}, with no cancellation fee.`;
}

/**
 * The SMS clause. `bookingConfirmationBody` ships VERBATIM as a text, so length here is a
 * recurring per-booking cost. The body is ~210 chars before this clause and GSM-7 concatenated
 * segments are 153, so a short clause rides in the second segment's slack for free — the
 * confirmation costs 2 segments with it or without it. The full paragraph would not; the manage
 * link the confirmation already carries is where the complete terms live.
 *
 * That accounting only holds while the body stays inside GSM-7. It did not until #619 — the
 * sign-off's em dash forced UCS-2 (67 chars/segment) and made the same message cost 4.
 * `booking-confirmation.test.ts` guards the alphabet; keep this clause ASCII.
 */
export function cancellationTermsShort(hasFlex: boolean): string {
  if (hasFlex) return `Cancel ${FLEX_CANCEL_HOURS_BEFORE}+ hours out for a refund less the ${dollars(FLEX_INSURANCE_CENTS)} insurance.`;
  return `Cancel ${STANDARD_CANCEL_DAYS_BEFORE}+ days out for a refund minus a ${dollars(CANCELLATION_FEE_CENTS)} fee.`;
}
