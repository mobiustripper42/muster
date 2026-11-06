/**
 * Telling the customer their booking was cancelled (issue #1212): one message, sent unchanged by
 * text and by email, saying that it is cancelled, what money is coming back, and where their
 * booking is. Spec: `docs/SPEC.md §2.8.4c`.
 *
 * Sent from the press that cancelled, after the cancel and the refund (DEC-198), so it can state
 * the figure. Best-effort and never throws: a notice that fails must not undo a cancel or a refund,
 * and what the operator reads afterwards (`cancelNoticeMessage` at the edge) says whether to phone.
 *
 * **A log line is not a send** (DEC-170). `skipped` and `logged` read as not told.
 *
 * **Every character stays inside GSM-7** (`sms-alphabet.ts`): this ships verbatim as SMS, and one
 * character outside that alphabet re-encodes the whole text as UCS-2.
 */
import { randomUUID } from "node:crypto";
import type { CancelledBy, Reservation } from "../domain/entities.js";
import { asId, type ReservationId } from "../domain/ids.js";
import { logSwallowed } from "../log.js";
import type { ChannelPort } from "../ports/channel.js";
import type { Repository } from "../ports/repository.js";
import { bookingUrl } from "./booking-code.js";
import { formatCents } from "./calendar-detail.js";
import type { CancelQuote } from "./cancel-reservation.js";
import type { CancelRefund } from "./customer-cancel.js";
import { ensureBookingCode } from "./ensure-booking-code.js";
import { REFUND_TIMING_LINE } from "./refund-terms.js";
import { outcomes, tryChannel, type ChannelOutcome, type ResendResult } from "./resend-booking-link.js";
import { firstNameOf, tripWhen } from "./send-payment-link.js";
import { recordTrail } from "./trail.js";

/** What the customer is told about their money. */
export type CancelNoticeRefund =
  /** The refund went through, in full. */
  | { kind: "issued"; cents: number }
  /** The refund failed partway: `movedCents` went, out of the `cents` this press tried. */
  | { kind: "partial"; movedCents: number; cents: number }
  /** Money was expected and none moved; a person follows up. */
  | { kind: "pending" }
  /** The terms owe $0 and the customer has paid. */
  | { kind: "none_due" }
  /** Nothing refundable on the booking: no refund line at all. */
  | { kind: "nothing_paid" };

export type CancelNoticeActor = { kind: "admin"; id: string } | { kind: "customer" };

/** The edge's sender (`app/lib/cancel-notice.ts`). Resolves to the `<email>-<sms>` code, `skipped`,
 *  `error`, or `null` when this booking gets no notice. */
export type TellCustomer = (
  reservationId: ReservationId,
  by: CancelledBy,
  refund: CancelNoticeRefund,
  actor: CancelNoticeActor,
) => Promise<string | null>;

export interface CancelNoticeDeps {
  repo: Repository;
  now: () => string;
  /** The business's name as the customer knows it (`TENANT_NAME` at the edge). */
  tenantName: string;
  /** Trusted public origin for the link (`APP_BASE_URL` at the edge). */
  linkBase: string;
  email?: ChannelPort;
  sms?: ChannelPort;
  /** Whether the text channel really sends. False means a log line, so no email and no live text
   *  is `skipped` (DEC-170). */
  live: boolean;
  /** Durable observer for a failed send; the operator already sees the outcome on screen. */
  onFailure?: (detail: string) => void;
}

/** `<amount> is on its way back to your card.` Shared with the manage page's notices. */
export function refundOnItsWay(cents: number): string {
  return `${formatCents(cents)} is on its way back to your card.`;
}

function refundLineOf(refund: CancelNoticeRefund): string | null {
  switch (refund.kind) {
    case "issued":
      return `${refundOnItsWay(refund.cents)} ${REFUND_TIMING_LINE}`;
    case "partial":
      return (
        `${formatCents(refund.movedCents)} of your ${formatCents(refund.cents)} refund is on its way ` +
        `back to your card. We'll be in touch about the rest.`
      );
    case "pending":
      return "We'll be in touch about your refund.";
    case "none_due":
      return "No refund is due under your booking's cancellation terms.";
    case "nothing_paid":
      return null;
  }
}

/**
 * The message: opening, the refund line if there is one, the booking link, the sign-off, in
 * paragraphs. `by` picks the opening: when we cancelled, we apologise; when the customer asked,
 * whoever pressed, it is theirs.
 */
export function cancelNoticeBody(input: {
  reservation: Reservation;
  by: CancelledBy;
  refund: CancelNoticeRefund;
  manageUrl: string;
  tenantName: string;
}): string {
  const { reservation, by, refund, manageUrl, tenantName } = input;
  const who = firstNameOf(reservation);
  const when = tripWhen(reservation);
  const opening =
    by === "operator"
      ? `Hi ${who}, we had to cancel your trip${when}. We're sorry.`
      : `Hi ${who}, your trip${when} is cancelled.`;
  const refundLine = refundLineOf(refund);
  return [opening, ...(refundLine ? [refundLine] : []), `Your booking: ${manageUrl}`, `- ${tenantName}`].join(
    "\n\n",
  );
}

/** The customer's own cancel: what its refund leg did, as the notice says it. */
export function noticeRefundOf(refund: CancelRefund): CancelNoticeRefund {
  if (refund.kind === "issued") return { kind: "issued", cents: refund.cents };
  return refund.movedCents > 0
    ? { kind: "partial", movedCents: refund.movedCents, cents: refund.cents }
    : { kind: "pending" };
}

/**
 * For the one operator exit that sent no refund because the figure was `null` or `<= 0`: what the
 * customer is told. No quote means no figure was read, so a person follows up; nothing paid is no
 * refund line; the terms owing $0 is said so; anything else (the operator typed $0 while the terms
 * owe more) is a refund still to come.
 */
export function noRefundSentNotice(quote: CancelQuote | null): CancelNoticeRefund {
  if (!quote) return { kind: "pending" };
  if (quote.paidCents <= 0) return { kind: "nothing_paid" };
  if (quote.refundCents <= 0) return { kind: "none_due" };
  return { kind: "pending" };
}

/** Email, then text, each reported on its own. Neither can stop the other being attempted. */
export async function sendCancelNotice(
  deps: {
    tenantName: string;
    linkBase: string;
    email?: ChannelPort;
    sms?: ChannelPort;
    onFailure?: (detail: string) => void;
  },
  input: { reservation: Reservation; by: CancelledBy; refund: CancelNoticeRefund },
  bookingCode: string,
): Promise<ResendResult> {
  const { reservation } = input;
  const body = cancelNoticeBody({
    reservation,
    by: input.by,
    refund: input.refund,
    manageUrl: bookingUrl(deps.linkBase, bookingCode),
    tenantName: deps.tenantName,
  });
  const ctx = { body, what: "cancel notice", onFailure: deps.onFailure, reservation };
  const email = await tryChannel(deps.email, reservation.email, "email", ctx);
  const sms = await tryChannel(deps.sms, reservation.phone, "SMS", ctx);
  return { email, sms };
}

/**
 * Read the booking, send the notice, write the trail row, and answer with the code the pane reads:
 * `<email>-<sms>`, `skipped`, or `error`. `null` for a booking that gets no notice: gone, or not a
 * Muster booking (an unpaid phone booking has no booking link to send, and nothing was charged).
 *
 * On `skipped` the send still runs, so the body reaches the log (`deliverPaymentLink`'s order).
 * Never throws.
 */
export async function deliverCancelNotice(
  deps: CancelNoticeDeps,
  reservationId: ReservationId,
  by: CancelledBy,
  refund: CancelNoticeRefund,
  actor: CancelNoticeActor,
): Promise<string | null> {
  let code: string;
  try {
    const reservation = await deps.repo.getReservation(reservationId);
    if (!reservation || reservation.source !== "muster") return null;
    const bookingCode = await ensureBookingCode(deps.repo, reservationId, deps.now);
    const result = await sendCancelNotice(deps, { reservation, by, refund }, bookingCode);
    code = !deps.email && !deps.live ? "skipped" : `${result.email}-${result.sms}`;
  } catch (e) {
    logSwallowed("reservations:cancelNotice", e, `${reservationId} is cancelled but the customer may not have been told`);
    code = "error";
  }
  await recordCancelNotice(deps, reservationId, code, actor);
  return code;
}

/** `<email>-<sms>` as the two outcomes, or `null` for `skipped` and `error`. */
function splitCode(code: string): [ChannelOutcome, ChannelOutcome] | null {
  const [email, sms, ...rest] = code.split("-");
  if (email === undefined || sms === undefined || rest.length > 0) return null;
  return [email as ChannelOutcome, sms as ChannelOutcome];
}

/** True when either half of `<email>-<sms>` is `sent`: the one test of "the customer was reached". */
export function cancelNoticeReached(code: string): boolean {
  return splitCode(code)?.includes("sent") ?? false;
}

/**
 * The notice's trail row: `cancel_notice_sent` when a channel reached them, otherwise
 * `cancel_notice_failed`. The reason is per channel (or `skipped` / `error`), never the link or a
 * provider's message, which can echo the recipient.
 */
export async function recordCancelNotice(
  deps: { repo: Repository; now: () => string },
  reservationId: ReservationId,
  code: string,
  actor: CancelNoticeActor,
): Promise<void> {
  const type = cancelNoticeReached(code) ? "cancel_notice_sent" : "cancel_notice_failed";
  const channels = splitCode(code);
  await recordTrail(deps, {
    // A press has no redelivery, and a notice is a fact of this press.
    id: asId<"TrailEventId">(`${type}:${randomUUID()}`),
    reservationId,
    actorKind: actor.kind,
    ...(actor.kind === "admin" ? { actorId: actor.id } : {}),
    type,
    metadata: { reason: channels ? outcomes(channels[0], channels[1]) : code },
  });
}

/**
 * The one way a cancel asks for a notice. `undefined` is no sender wired: `null`. A rejection is
 * `error`, logged: the cancel and the refund have committed and must stand.
 */
export async function tellSafely(
  tell: TellCustomer | undefined,
  reservationId: ReservationId,
  by: CancelledBy,
  refund: CancelNoticeRefund,
  actor: CancelNoticeActor,
): Promise<string | null> {
  if (!tell) return null;
  try {
    return await tell(reservationId, by, refund, actor);
  } catch (e) {
    logSwallowed("reservations:cancelNotice", e, `${reservationId} is cancelled but asking to tell the customer threw`);
    return "error";
  }
}
