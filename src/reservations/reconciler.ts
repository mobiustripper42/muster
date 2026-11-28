/**
 * The reconciler (issue #1236): the tick's one pass over timed-out public checkouts with a payment
 * started. Each is asked about once. A paid one is booked through the one confirm the success page
 * and the webhook already use (`docs/SPEC.md` §2.8.6), a sold-out one is refunded through it, and one
 * Muster cannot get an answer for 2 hours past its payment window is texted to every admin.
 *
 * A checkout is **checked** when this job has finished with it and will not look at it again: Stripe
 * said nothing was paid, the confirm returned, or the 2-hour text went out. `paymentCheckedAt` says
 * so, and `listCheckoutsToCheck` leaves a checked row out.
 */
import type { Reservation } from "../domain/entities.js";
import { logSwallowed } from "../log.js";
import type { PaymentSucceeded } from "../ports/payment.js";
import { safeForAlert } from "./alert-text.js";
import type { WebhookDeps } from "./booking-webhook.js";
import { confirmBookingFromIntent } from "./confirm-booking.js";
import { PAYMENT_WINDOW_MINUTES, pendingLiveSince } from "./pending.js";

/** How long after the end of a checkout's payment window the job texts every admin. */
export const UNCHECKED_ALERT_AFTER_MS = 2 * 60 * 60_000;

/**
 * Where the 2-hour text links: the Abandoned checkouts list. A checkout that was never booked has no
 * booking page, so the admin finds the payment in Stripe by the customer's name. A literal, as
 * `bookingPanePath` is: the core cannot import the admin's link table.
 */
const ABANDONMENT_PATH = "/admin/abandonment";

/** The admin text for a checkout Muster could not get an answer for. The name goes through `safeForAlert`. */
export function uncheckedAlertText(reservation: Reservation): string {
  return `${safeForAlert(reservation.customerName)} started a payment and Muster could not confirm whether it went through. Check Stripe. If they paid, book or refund by hand.`;
}

/**
 * The job. `confirmed` counts rows, once each, where a confirm returned `booked` or `already`;
 * `nothingPaid` rows marked because every id answered and none had succeeded; `alerted` every call
 * the run makes to `deps.alertPaidButUnbooked`, the confirm's own admin texts included; `errors` rows
 * the run could not finish (a lookup, a confirm or a mark threw, short of the 2-hour text). A row is
 * in one of `confirmed`, `nothingPaid` and `errors`, never two; a sold-out row is in none.
 */
export async function reconcileLapsedCheckouts(
  deps: WebhookDeps,
): Promise<{ confirmed: number; nothingPaid: number; alerted: number; errors: number }> {
  const counts = { confirmed: 0, nothingPaid: 0, alerted: 0, errors: 0 };
  const counted: WebhookDeps = {
    ...deps,
    alertPaidButUnbooked: async (message, href) => {
      counts.alerted += 1;
      await (href === undefined ? deps.alertPaidButUnbooked(message) : deps.alertPaidButUnbooked(message, href));
    },
  };
  for (const row of await deps.repo.listCheckoutsToCheck(pendingLiveSince(deps.now()))) {
    try {
      await reconcileOne(deps, counted, row, counts);
    } catch (e) {
      counts.errors += 1;
      logSwallowed("reservations:reconcileLapsedCheckouts", e, `checkout ${row.id} could not be finished this run`);
    }
  }
  return counts;
}

async function reconcileOne(
  deps: WebhookDeps,
  counted: WebhookDeps,
  row: Reservation,
  counts: { confirmed: number; nothingPaid: number; errors: number },
): Promise<void> {
  const at = deps.now();
  let booked = false;
  let anyPaid = false;
  let answered = true;
  try {
    // Look at every id before confirming anything: one id with no answer holds the whole row back.
    const paid: PaymentSucceeded[] = [];
    for (const id of row.paymentIntentIds ?? []) {
      const pi = await deps.payments.readPaymentIntentSucceeded(id);
      if (pi) paid.push(pi);
    }
    anyPaid = paid.length > 0;
    for (const pi of paid) {
      const result = await confirmBookingFromIntent(counted, pi, { via: "reconciler" });
      if (result.handled && (result.outcome === "booked" || result.outcome === "already")) booked = true;
    }
  } catch (e) {
    answered = false;
    logSwallowed("reservations:reconcileLapsedCheckouts", e, `no answer for checkout ${row.id} this run`);
  }

  if (!answered) {
    const alertAt = Date.parse(row.reservedAt ?? at) + PAYMENT_WINDOW_MINUTES * 60_000 + UNCHECKED_ALERT_AFTER_MS;
    if (Date.parse(at) < alertAt) {
      counts.errors += 1;
      return;
    }
    // The text goes before the mark: if the mark throws, the text may go again next run, and a
    // repeated text costs less than a missed one.
    await counted.alertPaidButUnbooked(uncheckedAlertText(row), ABANDONMENT_PATH);
    await deps.repo.markPaymentChecked(row.id, at);
    return;
  }

  await deps.repo.markPaymentChecked(row.id, at);
  if (booked) counts.confirmed += 1;
  else if (!anyPaid) counts.nothingPaid += 1;
}
