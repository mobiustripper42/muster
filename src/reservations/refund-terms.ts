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
 * All four rules are encoded here. Only three are *rendered* — flex insurance is a published
 * term Muster cannot yet sell (#683: no add-on picker exists, #622), and a checkout that offers
 * a $30 product with no buy button is a term we would have to talk our way out of. The copy
 * states what governs a booking made today; `hasFlex` is one boolean away from the fourth.
 *
 * `hasFlex` is a BOOLEAN on the reservation, per DEC-113 — this file must never learn about
 * add-on ids. How the $30 gets collected is #683's problem and does not reach the refund math.
 * The operator has since chosen an `add_ons` row (2026-08-06), which DEC-113's 2026-07-25
 * correction forbids; #683 owns the amendment. Do not treat that as settled from here.
 *
 * Money is integer CENTS (DEC-112). Pure — no clock, no repo. The caller supplies the notice
 * because only it knows the departure instant and the tenant timezone.
 */

/** Refund fee withheld from every customer-initiated cancellation. $50. */
export const CANCELLATION_FEE_CENTS = 5000;

/** Price of optional flex insurance. $30. Unsellable today — see #683. */
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

/**
 * The cancellation window in hours for this booking. Flex insurance narrows it — it does not
 * waive the fee.
 */
export function cancelWindowHours(hasFlex = false): number {
  return hasFlex ? FLEX_CANCEL_HOURS_BEFORE : STANDARD_CANCEL_DAYS_BEFORE * HOURS_PER_DAY;
}

export interface RefundInput {
  /** Everything the customer has actually paid — deposit only, or deposit + balance. */
  paidCents: number;
  /** Notice given, in hours before departure. Zero or negative ⇒ a no-show. */
  hoursBeforeDeparture: number;
  /** Did this booking buy flex insurance? Unsellable today (#683), so effectively always false. */
  hasFlex?: boolean;
}

/**
 * What a CUSTOMER-initiated cancellation is owed back, in integer cents.
 *
 * Outside the window: what they paid, minus the fee, floored at zero (a 25% deposit can be
 * smaller than the $50 fee — that is a zero refund, never a negative one, and never a charge).
 * Inside the window, and for a no-show: nothing.
 *
 * The boundary is inclusive — exactly 14 days out is refundable. "14 days prior" reads
 * inclusive and the edge should favour the customer.
 *
 * Operator-initiated cancellations do NOT come through here — see `operatorCancelRefundCents`.
 */
export function refundOwedCents({
  paidCents,
  hoursBeforeDeparture,
  hasFlex = false,
}: RefundInput): number {
  if (hoursBeforeDeparture < cancelWindowHours(hasFlex)) return 0;
  return Math.max(0, paidCents - CANCELLATION_FEE_CENTS);
}

/**
 * What an OPERATOR-initiated cancellation is owed — weather, crew shortage, mechanical.
 * Everything paid, no fee, at any notice ("we will provide you with a full refund"), which is
 * also the SPEC.md §3.3 principled default. Kept as its own function precisely so no caller can
 * reach the fee path by passing the wrong notice: who cancelled is the discriminator, not when.
 */
export function operatorCancelRefundCents(paidCents: number): number {
  return Math.max(0, paidCents);
}

/**
 * Customer-facing terms — checkout (before the pay button) and the manage page. Quotes the
 * constants above so the prose can never drift from the math.
 */
export const CANCELLATION_TERMS =
  `Cancel ${STANDARD_CANCEL_DAYS_BEFORE} days or more before your cruise for a refund ` +
  `minus a ${dollars(CANCELLATION_FEE_CENTS)} cancellation fee. Cancellations less than ` +
  `${STANDARD_CANCEL_DAYS_BEFORE} days out are non-refundable, as are no-shows. If we cancel ` +
  `for inclement weather, you'll receive a full refund.`;

/**
 * The SMS clause. `bookingConfirmationBody` is sent VERBATIM as a text, and that body is
 * ALREADY multi-segment: the `— Muster` sign-off's em dash is outside GSM-7, which forces the
 * whole message to UCS-2 at 67 chars per concatenated segment (not 153). So every character
 * here is expensive — this clause is roughly a segment of its own, and the long paragraph would
 * be three. Keep it short; the manage link the confirmation already carries is where the full
 * terms live. (Dropping the em dash would buy GSM-7 back across every confirmation — not this
 * task's copy to change.)
 */
export const CANCELLATION_TERMS_SHORT =
  `Cancel ${STANDARD_CANCEL_DAYS_BEFORE}+ days out for a refund minus a ` +
  `${dollars(CANCELLATION_FEE_CENTS)} fee.`;
