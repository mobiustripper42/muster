/**
 * Customer "request cancellation / change" — the out-of-band operator notice (Phase 12.6, #459,
 * option (b)). Self-service cancel/refund is deferred to 16.9 (issue #1074) — the refund policy and
 * cancellation insurance it needed are both built (#472, 16.8); until then the manage page lets
 * the customer REQUEST a cancel or a date/time change,
 * and the operator handles it manually. This module is the pure email body the app-side action
 * sends to the operator inbox (best-effort via `EmailChannel`).
 *
 * Deliberately NOT a customer→crew message (#119): it reaches the OPERATOR, never the crew line
 * (the same rule the mockup settled — "Message us reaches the operator, never the crew").
 */

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

/** Compose the operator-facing email for a change/cancel request. Pure. */
export function bookingChangeRequestEmail(input: ChangeRequestInput): OperatorEmail {
  const verb = input.kind === "cancel" ? "Cancellation" : "Change";
  const contact = [input.phone, input.email].filter(Boolean).join(" · ") || "no contact on file";
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
  const contact = [input.phone, input.email].filter(Boolean).join(" · ") || "no contact on file";
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
