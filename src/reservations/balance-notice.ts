/**
 * Telling both sides of a failed balance charge (issue #1273, `docs/SPEC.md §2.8.4d`): the customer
 * gets one body by email and by text, saying the balance did not go through and where to pay it with
 * any card; the admins get one text through the money alert, naming the booking, the amount, the
 * bank's reason and what is next.
 *
 * Sent by the scheduled job right after it writes the attempt's outcome and outside the block that
 * can give the claim back, so a failed send can never undo the attempt or charge the card twice.
 * Best-effort and never throws, in the cancel notice's shape (`cancel-notice.ts`).
 *
 * **A log line is not a send** (DEC-170). `skipped` and `logged` read as not told.
 *
 * **The customer body stays inside GSM-7** (`sms-alphabet.ts`): it ships verbatim as SMS, and one
 * character outside that alphabet re-encodes the whole text as UCS-2. The admin body is plain ASCII.
 */
import type { Reservation } from "../domain/entities.js";
import { asId, type ReservationId } from "../domain/ids.js";
import { logSwallowed } from "../log.js";
import type { Repository } from "../ports/repository.js";
import { bookingUrl } from "./booking-code.js";
import { safeForAlert } from "./booking-webhook.js";
import { formatCents } from "./calendar-detail.js";
import type { CancelNoticeDeps } from "./cancel-notice.js";
import { dueDayLabel } from "./checkout-quote.js";
import { ensureBookingCode } from "./ensure-booking-code.js";
import { declineReasonOf } from "./purchases-view.js";
import { outcomes, tryChannel } from "./resend-booking-link.js";
import { firstNameOf, tripDayTime, tripWhen } from "./send-payment-link.js";
import { recordTrail } from "./trail.js";

export type BalanceFailure = {
  /** The job's attempt number, the due date being 0. */
  attempt: number;
  /** What was still owed, the figure the card was charged. */
  owedCents: number;
  /** The next scheduled attempt, or `null` for the last one and for a bank approval. */
  nextAttemptAt: string | null;
} & ({ outcome: "declined"; declineCode?: string } | { outcome: "needs_approval" });

/** The edge's sender (`app/lib/balance-notice.ts`), handed to the job. */
export type TellBalanceFailed = (reservation: Reservation, failure: BalanceFailure) => Promise<void>;

export type BalanceNoticeDeps = CancelNoticeDeps;

/** The customer's message, one body for both channels. They are never shown the bank's code. */
export function balanceFailedBody(input: {
  reservation: Reservation;
  owedCents: number;
  manageUrl: string;
  tenantName: string;
  outcome: BalanceFailure["outcome"];
}): string {
  const { reservation, owedCents, manageUrl, tenantName, outcome } = input;
  const who = firstNameOf(reservation);
  const balance = `the balance of ${formatCents(owedCents)} for your ${tenantName} trip${tripWhen(reservation)}`;
  const opening =
    outcome === "needs_approval"
      ? `Hi ${who}, your bank asked for your approval before charging ${balance}, so it didn't go through.`
      : `Hi ${who}, ${balance} didn't go through on the card you saved.`;
  return [opening, `Pay it here, with any card: ${manageUrl}`, `- ${tenantName}`].join("\n\n");
}

/** The admins' text: who, when, how much, the bank's reason, and what is next. Plain ASCII. */
export function balanceAdminAlertBody(input: { reservation: Reservation; failure: BalanceFailure }): string {
  const { reservation, failure } = input;
  const subject = [safeForAlert(reservation.customerName ?? ""), tripDayTime(reservation), `${formatCents(failure.owedCents)} owed`]
    .filter((part) => part !== "")
    .join(", ");
  if (failure.outcome === "needs_approval") {
    return (
      `Balance charge needs the customer's approval: ${subject}. ` +
      `The bank asked them to approve it, so Muster will not retry. They can pay from their booking page.`
    );
  }
  const next =
    failure.nextAttemptAt === null ? "this was the last scheduled one" : `next on ${dueDayLabel(failure.nextAttemptAt)}`;
  return (
    `Balance charge declined: ${subject}. Reason: ${declineReasonOf(failure.declineCode)}. ` +
    `Attempt ${failure.attempt + 1}; ${next}.`
  );
}

/**
 * Send the customer's notice, write the trail row, and answer with the outcome the row carries:
 * `email=<o> sms=<o>`, `skipped` or `error`. On `skipped` the send still runs, so the body reaches
 * the log (`deliverCancelNotice`'s order). Never throws.
 */
export async function deliverBalanceNotice(
  deps: BalanceNoticeDeps,
  reservation: Reservation,
  failure: BalanceFailure,
): Promise<string> {
  let outcome: string;
  try {
    const bookingCode = await ensureBookingCode(deps.repo, reservation.id, deps.now);
    const body = balanceFailedBody({
      reservation,
      owedCents: failure.owedCents,
      manageUrl: bookingUrl(deps.linkBase, bookingCode),
      tenantName: deps.tenantName,
      outcome: failure.outcome,
    });
    const ctx = { body, what: "balance notice", onFailure: deps.onFailure, reservation };
    const email = await tryChannel(deps.email, reservation.email, "email", ctx);
    const sms = await tryChannel(deps.sms, reservation.phone, "SMS", ctx);
    outcome = !deps.email && !deps.live ? "skipped" : outcomes(email, sms);
  } catch (e) {
    logSwallowed(
      "reservations:balanceNotice",
      e,
      `the balance charge for ${reservation.id} failed and the customer may not have been told`,
    );
    outcome = "error";
  }
  await recordBalanceFailed(deps, reservation.id, failure, outcome);
  return outcome;
}

/**
 * The failed charge's trail row. The id carries the attempt, so an attempt told twice is one row. The
 * reason is the decline code (`declined` when the bank sent none) or `needs_approval`, never the
 * bank's message or the link; `outcome` is how the customer notice fared.
 */
export async function recordBalanceFailed(
  deps: { repo: Repository; now: () => string },
  reservationId: ReservationId,
  failure: BalanceFailure,
  outcome: string,
): Promise<void> {
  await recordTrail(deps, {
    id: asId<"TrailEventId">(`balance_charge_failed:${reservationId}:${failure.attempt}`),
    reservationId,
    actorKind: "engine",
    type: "balance_charge_failed",
    metadata: {
      attempt: failure.attempt,
      reason: failure.outcome === "declined" ? declineReasonOf(failure.declineCode) : "needs_approval",
      outcome,
    },
  });
}
