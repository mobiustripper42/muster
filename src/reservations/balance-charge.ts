/**
 * The scheduled balance charge (issue #1254, `docs/SPEC.md §2.8.4d`, DEC-201).
 *
 * A deposit booking's balance is charged to the card saved at booking, off-session, on its frozen due
 * date. A decline is retried on the days after it (`payment.balance_retry_days`, 3 and 6 by default);
 * a bank that asks the customer to approve ends the attempts; nothing is tried on or after the release
 * date. The customer can also pay on `/b/<code>` with any card.
 *
 * **One balance PaymentIntent per booking, and every path uses it** — each scheduled attempt confirms
 * it off-session, the manage page confirms it with the customer's card. Stripe lets an intent succeed
 * once, which is what makes "never a second payment" hold under a race between the job and the page.
 * Its amount is set to what is owed at each use (`ensureBalanceIntent`).
 *
 * **What is where.** `balanceAttemptTimes` is the rule for when an attempt falls; `balancePayable` the
 * rule for whether a booking can take a payment; `ensureBalanceIntent` the rule for the intent. The
 * job, the manage page's start and the manage view's button all read them rather than restating them.
 */
import { asId, type ReservationId } from "../domain/ids.js";
import { isBooked } from "../domain/entities.js";
import type { Payment, Reservation } from "../domain/entities.js";
import type { PaymentSucceeded } from "../ports/payment.js";
import { logSwallowed } from "../log.js";
import { alertThatNeverThrows, paymentIdFor, type WebhookDeps } from "./booking-webhook.js";
import { bookingCodeRefusal, normalizeBookingCode } from "./booking-code.js";
import { balanceAdminAlertBody, type BalanceFailure, type TellBalanceFailed } from "./balance-notice.js";
import { balanceOwedCents } from "./payment-config.js";

type BalanceDeps = Pick<WebhookDeps, "repo" | "payments" | "now" | "alertPaidButUnbooked">;

/** What the job takes: the balance deps, and the sender that tells the customer of a failed charge
 *  (issue #1273). Required, so a caller that forgets it fails to compile. */
export type ChargeDeps = BalanceDeps & { tellBalanceFailed: TellBalanceFailed };

type Refusal = "not_active" | "no_balance" | "disputed";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How old an unfinished claim must be before a later run takes it over (DEC-202). It sits above the
 * tick route's pinned `maxDuration` (`app/api/cron/tick/route.ts`), so a claim this old has no live
 * owner. Raising that duration to this age breaks the reasoning.
 */
const RECLAIM_AFTER_MS = 60 * 60 * 1000;

/**
 * When the balance is tried: attempt 0 at `dueAt`, then each retry day after it, every time on or
 * after `releaseAt` dropped. An attempt's number is its position in this list, so the due date is 0.
 *
 * "Due + N days" is N × 24 hours, with no time zone: the vessel-local calendar-day arithmetic
 * (`balanceDates`) is an hour off across a daylight-saving change, on a charge nobody watches happen.
 */
export function balanceAttemptTimes(
  dueAt: string,
  releaseAt: string,
  retryDays: readonly number[],
): string[] {
  const due = Date.parse(dueAt);
  const release = Date.parse(releaseAt);
  return [0, ...retryDays]
    .map((days) => due + days * DAY_MS)
    .filter((at) => at < release)
    .map((at) => new Date(at).toISOString());
}

/**
 * Can this booking take a balance payment, and for how much? The checks run in this order: booked,
 * a priced fare, a balance owed, no payment in dispute (a dispute the operator won reads `succeeded`
 * again, so it does not block). The job, the manage page's start and its button all read it.
 *
 * An unpriced booking reads `not_active`: there is no invoice to owe against, and "your balance is
 * already paid" would be false.
 */
export function balancePayable(
  reservation: Reservation,
  payments: readonly Payment[],
): { ok: true; owedCents: number } | { ok: false; reason: Refusal } {
  if (reservation.status !== "booked") return { ok: false, reason: "not_active" };
  if (!reservation.invoice) return { ok: false, reason: "not_active" };
  const owedCents = balanceOwedCents(reservation.invoice, payments);
  if (owedCents <= 0) return { ok: false, reason: "no_balance" };
  if (payments.some((p) => p.status === "disputed" || p.status === "dispute_lost")) {
    return { ok: false, reason: "disputed" };
  }
  return { ok: true, owedCents };
}

/**
 * The booking's one balance intent, at `amountCents`. Created the first time (keyed per booking,
 * the saved customer, cards only, nothing saved) and its id stored on the row; every later use raises
 * or lowers that same intent. A stored intent Stripe refuses to update (cancelled in the Dashboard) is
 * not replaced here: the update throws and the caller counts it.
 */
export async function ensureBalanceIntent(
  deps: Pick<WebhookDeps, "repo" | "payments">,
  reservation: Reservation,
  amountCents: number,
): Promise<{ paymentIntentId: string; clientSecret: string }> {
  if (reservation.balancePaymentIntentId !== undefined) {
    const { clientSecret } = await deps.payments.updatePaymentIntentAmount(
      reservation.balancePaymentIntentId,
      amountCents,
    );
    return { paymentIntentId: reservation.balancePaymentIntentId, clientSecret };
  }
  const created = await deps.payments.createPaymentIntent({
    amountCents,
    currency: "usd",
    idempotencyKey: `balance_${reservation.id}`,
    metadata: { reservation_id: String(reservation.id), purpose: "balance" },
    ...(reservation.stripeCustomerId !== undefined ? { customerId: reservation.stripeCustomerId } : {}),
    cardsOnly: true,
  });
  await deps.repo.saveBalancePaymentIntentId(reservation.id, created.paymentIntentId);
  return created;
}

/**
 * Has the booking's balance intent already succeeded at Stripe? If so, make sure its `Payment` row
 * exists (written once, by `recordBalancePayment`) and say `true`: the caller must then neither update
 * nor confirm the intent, because Stripe lets an intent succeed once and refuses to change one that
 * has ("A PaymentIntent with a `succeeded` status means that the corresponding payment flow is
 * complete", docs.stripe.com/payments/paymentintents/lifecycle). This is the case of a charge that
 * went through and threw before its row was written, found again by the next job run or the next press
 * on the manage page. `false` when there is no balance intent, or it has not succeeded (an outage
 * reads as not succeeded too, and the update that follows then throws as before).
 */
async function recordIfBalanceIntentSucceeded(deps: BalanceDeps, reservation: Reservation): Promise<boolean> {
  const intentId = reservation.balancePaymentIntentId;
  if (intentId === undefined) return false;
  const charge = await deps.payments.getSucceededPaymentIntent(intentId);
  if (!charge) return false;
  // Not re-recorded: a second look must not re-run `recordBalancePayment`'s alerts.
  if (!(await deps.repo.getPayment(paymentIdFor(intentId)))) {
    await recordBalancePayment(deps, charge, reservation.id);
  }
  return true;
}

type Counts = { charged: number; declined: number; needsApproval: number; errors: number };

/**
 * The job (the tick route runs it): charge every due balance's saved card, off-session, once per
 * attempt.
 *
 * - **Missed attempts are not made up.** Of the attempts whose time has come, only the latest is
 *   made, so a job outage never bursts two charges onto a card.
 * - **An attempt is claimed before it is charged** (the waiver reminders' pattern), so two runs at the
 *   same moment, or a later run, never charge the same attempt twice.
 * - **A throw gives the claim back**, and the next tick re-sends the attempt under the same
 *   idempotency key, which Stripe answers with the first result rather than a second charge.
 * - A booking with no saved card is skipped: no claim, no count, a log line. The past-due list (19.8)
 *   is where it surfaces.
 * - **A declined charge, or one the bank asks the customer to approve, tells both sides** (issue
 *   #1273), after the attempt's outcome is written and outside the block that can give the claim
 *   back: a send that fails can never undo the attempt or charge the card again.
 */
export async function chargeDueBalances(deps: ChargeDeps): Promise<Counts> {
  const counts: Counts = { charged: 0, declined: 0, needsApproval: 0, errors: 0 };
  const now = deps.now();
  const due = await deps.repo.listBalancesDue(now);
  if (due.length === 0) return counts;
  const retryDays = (await deps.repo.getPaymentConfig()).balanceRetryDaysAfterDue;

  for (const reservation of due) {
    try {
      await chargeOne(deps, reservation, retryDays, now, counts);
    } catch (e) {
      counts.errors++;
      logSwallowed("balance-charge:job", e, `the balance charge for ${reservation.id} did not complete`);
    }
  }
  return counts;
}

async function chargeOne(
  deps: ChargeDeps,
  reservation: Reservation,
  retryDays: readonly number[],
  now: string,
  counts: Counts,
): Promise<void> {
  const payable = balancePayable(reservation, await deps.repo.listPaymentsForReservation(reservation.id));
  if (!payable.ok) return;
  const { stripeCustomerId, stripePaymentMethodId, balanceDueAt, balanceReleaseAt } = reservation;
  if (stripeCustomerId === undefined || stripePaymentMethodId === undefined) {
    logSwallowed(
      "balance-charge:job",
      new Error(`reservation ${reservation.id} has no saved card`),
      "its balance is due and nothing was charged",
    );
    return;
  }
  if (balanceDueAt === undefined || balanceReleaseAt === undefined) return;

  // The latest attempt whose time has come (at or before now).
  const times = balanceAttemptTimes(balanceDueAt, balanceReleaseAt, retryDays);
  let attempt = -1;
  times.forEach((at, i) => {
    if (Date.parse(at) <= Date.parse(now)) attempt = i;
  });
  if (attempt < 0) return;

  // No later attempt once the bank has asked the customer to approve; none already made. The current
  // attempt's own unfinished row is not "made": it goes on to the claim, which reclaims it only when
  // it is older than the reclaim age (DEC-202).
  const made = await deps.repo.listBalanceAttempts(reservation.id);
  if (
    made.some(
      (a) =>
        a.outcome === "needs_approval" ||
        a.attempt > attempt ||
        (a.attempt === attempt && a.outcome !== undefined),
    )
  ) {
    return;
  }

  const staleBefore = new Date(Date.parse(now) - RECLAIM_AFTER_MS).toISOString();
  if (!(await deps.repo.claimBalanceAttempt({ reservationId: reservation.id, attempt, at: now, staleBefore }))) return;
  let failure: BalanceFailure | undefined;
  try {
    // A previous run's charge that went through but was not recorded: record it, charge nothing. Not
    // counted as `charged` — this run charged nothing.
    if (await recordIfBalanceIntentSucceeded(deps, reservation)) {
      await deps.repo.finishBalanceAttempt({ reservationId: reservation.id, attempt, outcome: "succeeded" });
      return;
    }
    const { paymentIntentId } = await ensureBalanceIntent(deps, reservation, payable.owedCents);
    const result = await deps.payments.confirmOffSession({
      paymentIntentId,
      customerId: stripeCustomerId,
      paymentMethodId: stripePaymentMethodId,
      idempotencyKey: `balance_${reservation.id}_${attempt}`,
    });
    if (result.outcome === "succeeded") {
      await recordBalancePayment(deps, result.charge, reservation.id);
      await deps.repo.finishBalanceAttempt({ reservationId: reservation.id, attempt, outcome: "succeeded" });
      counts.charged++;
    } else if (result.outcome === "needs_approval") {
      await deps.repo.finishBalanceAttempt({ reservationId: reservation.id, attempt, outcome: "needs_approval" });
      counts.needsApproval++;
      // The job makes no later attempt once the bank has asked the customer to approve.
      failure = { attempt, owedCents: payable.owedCents, nextAttemptAt: null, outcome: "needs_approval" };
    } else {
      await deps.repo.finishBalanceAttempt({
        reservationId: reservation.id,
        attempt,
        outcome: "declined",
        ...(result.declineCode !== undefined ? { declineCode: result.declineCode } : {}),
      });
      counts.declined++;
      failure = {
        attempt,
        owedCents: payable.owedCents,
        nextAttemptAt: times[attempt + 1] ?? null,
        outcome: "declined",
        ...(result.declineCode !== undefined ? { declineCode: result.declineCode } : {}),
      };
    }
  } catch (e) {
    // Give the claim back so the next tick re-sends it. A failed release is logged, not thrown: the
    // original failure is the one to report.
    await deps.repo
      .releaseBalanceAttempt({ reservationId: reservation.id, attempt })
      .catch((releaseError: unknown) =>
        logSwallowed("balance-charge:job", releaseError, `the claim on attempt ${attempt} of ${reservation.id} was not given back`),
      );
    throw e;
  }
  if (failure) await tellFailure(deps, reservation, failure);
}

/**
 * Tell both sides of a failed charge: the customer through the injected sender, then the admins
 * through the money alert. Neither can stop the other, and neither can throw: the attempt is
 * recorded and stands. A sender that rejects is logged and writes no row of its own.
 */
async function tellFailure(deps: ChargeDeps, reservation: Reservation, failure: BalanceFailure): Promise<void> {
  try {
    await deps.tellBalanceFailed(reservation, failure);
  } catch (e) {
    logSwallowed(
      "balance-charge:job",
      e,
      `the balance charge for ${reservation.id} failed and asking to tell the customer threw`,
    );
  }
  await alertThatNeverThrows(deps.alertPaidButUnbooked)(balanceAdminAlertBody({ reservation, failure }));
}

/**
 * The manage page's start: the balance intent at what is owed now, or why it cannot be paid. The
 * checks are `balancePayable`'s, so a balance the job already collected is refused here, and a stale
 * page's press creates and changes nothing.
 */
export async function startBalancePayment(
  deps: BalanceDeps,
  reservationId: ReservationId,
): Promise<{ ok: true; clientSecret: string; amountCents: number } | { ok: false; reason: Refusal }> {
  const reservation = await deps.repo.getReservation(reservationId);
  if (!reservation) return { ok: false, reason: "not_active" };
  const payable = balancePayable(reservation, await deps.repo.listPaymentsForReservation(reservationId));
  if (!payable.ok) return payable;
  // An intent that already succeeded but was never recorded: record it, then judge again — the
  // balance is paid, so the press is refused rather than handed an intent Stripe will not change.
  if (await recordIfBalanceIntentSucceeded(deps, reservation)) {
    const after = balancePayable(reservation, await deps.repo.listPaymentsForReservation(reservationId));
    if (!after.ok) return after;
  }
  const { clientSecret } = await ensureBalanceIntent(deps, reservation, payable.owedCents);
  return { ok: true, clientSecret, amountCents: payable.owedCents };
}

/**
 * Record a succeeded balance charge: one `Payment{kind:'balance'}` against the booking, the id
 * deterministic from the intent (`pay_<intent id>`) so the job, the webhook and the manage page's
 * return all write the same row, once (`savePayment` is insert-only). No booking write, no
 * confirmation. It carries no tax, tip, fee or insurance: the deposit's row already carries the whole
 * invoice's (`booking-webhook.ts`), so the balance is pure fare.
 *
 * **Refuses a charge whose intent is not the booking's balance intent** — no row, an alert — because
 * the manage page's return reads the id from the address bar.
 *
 * The money alerts are the webhook's: a booking that is missing (no row to hang the payment on, so
 * nothing is recorded), cancelled or unpriced (recorded, then flagged), and an overpaid one — an
 * intent that succeeded for more than is now owed, such as after the fare was lowered — recorded, then
 * flagged for a manual refund.
 */
export async function recordBalancePayment(
  deps: BalanceDeps,
  charge: PaymentSucceeded,
  reservationId: ReservationId,
): Promise<void> {
  const alert = alertThatNeverThrows(deps.alertPaidButUnbooked);
  const reservation = await deps.repo.getReservation(reservationId);
  if (!reservation) {
    // No row to reference: the insert would violate the foreign key (#613).
    await alert(
      `Balance payment could NOT be recorded - reservation ${reservationId} does not exist. ` +
        `Stripe payment intent ${charge.paymentIntentId}. RECONCILE / REFUND MANUALLY in Stripe.`,
    );
    return;
  }
  if (reservation.balancePaymentIntentId !== charge.paymentIntentId) {
    await alert(
      `Balance payment could NOT be recorded - payment intent ${charge.paymentIntentId} is not the ` +
        `balance intent of reservation ${reservationId}. RECONCILE / REFUND MANUALLY in Stripe.`,
    );
    return;
  }
  const payment: Payment = {
    id: paymentIdFor(charge.paymentIntentId),
    reservationId,
    method: "stripe",
    kind: "balance",
    amountCents: charge.amountReceivedCents,
    taxCents: 0,
    currency: charge.currency,
    stripePaymentIntentId: charge.paymentIntentId,
    status: "succeeded",
    createdAt: deps.now(),
  };
  // The row exists, so the FK is satisfied whatever its status: record the money that moved, THEN
  // reconcile. An unreconcilable payment is still a payment.
  await deps.repo.savePayment(payment);

  // A pending row has no event (§2.8.2); the payment is recorded above and must not be lost to a
  // throw, so it falls through to the alert like an unpriced or cancelled one.
  const event = reservation.eventId === null ? undefined : await deps.repo.getEvent(reservation.eventId);
  const invoice = reservation.invoice;
  if (!isBooked(reservation) || event?.price === undefined || !invoice) {
    await alert(
      `Balance payment recorded for reservation ${reservationId}, but it is cancelled or ` +
        `unpriced - Stripe payment intent ${charge.paymentIntentId}. RECONCILE / REFUND MANUALLY in Stripe.`,
    );
    return;
  }
  // Worked off the invoice frozen at booking (issue #1241): today's tax-rate setting would trip a
  // false overpay alert on an exact payment, or mask a real one, after a rate change.
  const owed = balanceOwedCents(invoice, await deps.repo.listPaymentsForReservation(reservationId));
  if (owed < 0) {
    await alert(
      `Reservation ${reservationId} OVERPAID by ${-owed} cents - the balance intent ` +
        `${charge.paymentIntentId} took more than was owed. REFUND the excess MANUALLY in Stripe.`,
    );
  }
}

/**
 * The manage page's `?payment_intent=` return: find the booking by its code, ignore an id that is not
 * its balance intent, read the intent from Stripe, and record it once it has succeeded — so `Paid in
 * full` shows without waiting for the webhook. A revisit after the row exists says `recorded` again
 * and writes nothing new. A code the booking-code check refuses, an intent that has not succeeded and
 * an id that is not the booking's all say `ignored`.
 */
export async function recordBalanceReturn(
  deps: BalanceDeps,
  code: string,
  paymentIntentId: string,
): Promise<"recorded" | "ignored"> {
  const normalized = normalizeBookingCode(code);
  if (!normalized) return "ignored";
  const codeRow = await deps.repo.getBookingCode(normalized);
  if (!codeRow || bookingCodeRefusal(codeRow, deps.now())) return "ignored";
  const reservation = await deps.repo.getReservation(asId<"ReservationId">(String(codeRow.reservationId)));
  if (!reservation || reservation.balancePaymentIntentId !== paymentIntentId) return "ignored";
  // A revisit: the row is there, and a second look must not re-run the alerts.
  if (await deps.repo.getPayment(paymentIdFor(paymentIntentId))) return "recorded";
  const charge = await deps.payments.getSucceededPaymentIntent(paymentIntentId);
  if (!charge) return "ignored";
  await recordBalancePayment(deps, charge, reservation.id);
  return "recorded";
}
