/**
 * Customer "request cancellation / change" — the out-of-band operator notice (Phase 12.6, #459,
 * option (b)). A date/time change stays a REQUEST the operator handles by hand, and so does a
 * cancel the customer cannot do themselves (inside the window, or at a $0 refund). A cancel the
 * terms pay for is the customer's own action since 16.9 (issue #1074, `customer-cancel.ts`), and the
 * operator hears of it with `customerCancelledEmail` below. This module is the pure email bodies the
 * app-side actions send to the operator inbox (best-effort via `EmailChannel`).
 *
 * Deliberately NOT a customer→crew message (#119): it reaches the OPERATOR, never the crew line
 * (the same rule the mockup settled — "Message us reaches the operator, never the crew").
 */
import type { CancelRefund } from "./customer-cancel.js";
import { formatCents } from "./calendar-detail.js";

export type ChangeRequestKind = "cancel" | "change";

export interface ChangeRequestInput {
  kind: ChangeRequestKind;
  reservationId: string;
  customerName: string;
  /** The trip the request is about — "Sat, Jul 18 · 1:30 PM · Brew Boat Party". */
  tripLabel: string;
  phone?: string | undefined;
  email?: string | undefined;
  /** Optional free-text the customer typed (already length-clamped by the caller). */
  note?: string | undefined;
  /** The manage link, so the operator can open the booking directly. */
  manageUrl: string;
}

export interface OperatorEmail {
  subject: string;
  /** Plain-text body (the EmailChannel sends text). */
  text: string;
}

/** The customer's phone and email on one line, or the plain fact that there is neither. */
function contactLine(input: { phone?: string | undefined; email?: string | undefined }): string {
  return [input.phone, input.email].filter(Boolean).join(" · ") || "no contact on file";
}

/** Compose the operator-facing email for a change/cancel request. Pure. */
export function bookingChangeRequestEmail(input: ChangeRequestInput): OperatorEmail {
  const verb = input.kind === "cancel" ? "Cancellation" : "Change";
  const contact = contactLine(input);
  const lines = [
    `${input.customerName} requested a ${input.kind === "cancel" ? "cancellation" : "date/time change"}.`,
    "",
    `Trip: ${input.tripLabel}`,
    `Booking: ${input.reservationId}`,
    `Contact: ${contact}`,
    ...(input.note ? ["", `Their note:`, input.note] : []),
    "",
    `Open the booking: ${input.manageUrl}`,
    "",
    `— Muster (this request was sent from the customer's booking link; reply to the customer directly).`,
  ];
  return {
    subject: `${verb} request — ${input.customerName} (${input.tripLabel})`,
    text: lines.join("\n"),
  };
}

export interface CustomerCancelledInput {
  reservationId: string;
  customerName: string;
  /** "Wed, Oct 21 · 3:30 PM · Reservation Demo Cruise". */
  tripLabel: string;
  phone?: string | undefined;
  email?: string | undefined;
  /** The booking's pane on the operator's calendar. */
  paneUrl: string;
}

/**
 * The customer cancelled an unpaid phone booking from its payment link (issue #1082 part B). The
 * operator hears the way a change request reaches them — an email to the operator inbox — but this
 * one is DONE, not asked for: nothing was charged, so there is nothing for a person to decide, and
 * the boat is already back on the calendar. Pure.
 */
export function customerCancelledUnpaidEmail(input: CustomerCancelledInput): OperatorEmail {
  const contact = contactLine(input);
  const lines = [
    `${input.customerName} cancelled their unpaid phone booking from the payment link.`,
    "Nothing was charged, and the boat is free again.",
    "",
    `Trip: ${input.tripLabel}`,
    `Booking: ${input.reservationId}`,
    `Contact: ${contact}`,
    "",
    `Open the booking: ${input.paneUrl}`,
    "",
    "— Muster",
  ];
  return {
    subject: `Cancelled by the customer — ${input.customerName} (${input.tripLabel})`,
    text: lines.join("\n"),
  };
}

/**
 * The customer cancelled a paid booking from the manage page (16.9, issue #1074). DONE, not asked
 * for: the booking is cancelled and the crew told. What is left for a person is only the money —
 * and only when the refund did not go through, which is the case the email must not bury.
 * `refund.cents` is the figure tried, in both outcomes. Pure.
 */
export function customerCancelledEmail(
  input: CustomerCancelledInput & { refund: CancelRefund },
): OperatorEmail {
  const figure = formatCents(input.refund.cents);
  const issued = input.refund.kind === "issued";
  const lines = [
    `${input.customerName} cancelled their booking from the booking page.`,
    issued
      ? `Refunded ${figure} to their card.`
      : `The refund of ${figure} did not go through — refund it from the booking.`,
    "",
    `Trip: ${input.tripLabel}`,
    `Booking: ${input.reservationId}`,
    `Contact: ${contactLine(input)}`,
    "",
    `Open the booking: ${input.paneUrl}`,
    "",
    "— Muster",
  ];
  return {
    subject: issued
      ? `Cancelled by the customer — ${input.customerName} (${input.tripLabel})`
      : `Refund needed — ${input.customerName} cancelled (${input.tripLabel})`,
    text: lines.join("\n"),
  };
}
