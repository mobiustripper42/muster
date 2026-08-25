/**
 * The one place the app wires up a booking confirm (issue #827).
 *
 * `SPEC.md` §2.8.6 requires the success page, the webhook and (later) the reconciler to run the
 * SAME idempotent confirm. That is a rule about the core function — but it is defeated just as
 * thoroughly by two callers assembling *different dependencies* for it. A page that forgot
 * `relayFormNotices` would book correctly and silently stop telling crew their day changed;
 * one that forgot `sendConfirmation` would book a customer and never send their link.
 *
 * So the wiring lives here and both callers import it. Adding a dependency is one edit, and no
 * caller can quietly have an older set.
 */
import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import type { WebhookDeps } from "@core/reservations/booking-webhook.js";
import { alertMoneyProblem } from "./alert";
import { sendReservationConfirmation } from "./booking-confirmation";
import { forwardFormNotices } from "./channel";
import { reservationsEnabled } from "./flags";
import { getRepo } from "./repo";
import { sendReservationSoldOutNotice } from "./sold-out-notice";

/**
 * Build the confirm dependencies, or `null` when Stripe is not configured.
 *
 * `webhookSecret` is optional because only signature verification needs it: the success page
 * resolves a PaymentIntent by id and has no signed payload to check. A caller that verifies
 * signatures must pass it and must refuse to run without one.
 */
export function bookingDeps(secretKey: string, webhookSecret?: string): WebhookDeps {
  return {
    repo: getRepo(),
    payments: new StripePaymentPort(secretKey, webhookSecret ?? ""),
    reservationsEnabled: reservationsEnabled(),
    now: () => new Date().toISOString(),
    // Texts every active admin AND logs (issue #723). Never throws: a failed alert must not 500
    // the webhook into a Stripe redelivery loop.
    alertPaidButUnbooked: alertMoneyProblem,
    // Best-effort email + SMS of the manage link on a fresh booking (11.4, DEC-122).
    sendConfirmation: sendReservationConfirmation,
    // Best-effort "sold out while you paid — fully refunded" on a residual-race loss (12.1b).
    notifyCustomerSoldOut: sendReservationSoldOutNotice,
    // A booking re-forms shifts (#614), and that re-form can be the first to observe a shift
    // collapsing or resurrecting. Without this wire a crew member dropped from a shift is never
    // told (DEC-084, #244) — and it matters MORE now the success page can be the confirming
    // caller, because that path runs while the customer waits rather than in a background POST.
    relayFormNotices: forwardFormNotices,
  };
}
