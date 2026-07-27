/**
 * Start a booking checkout (Phase 11.2, DEC-107). Resolves the event's price, computes the
 * charge (full or deposit) + Ohio tax from `PaymentConfig`, and opens a hosted Checkout
 * session via the `PaymentPort`. **Writes nothing** — the reservation + Payment are written
 * by the webhook when Stripe confirms payment (DEC-107/109). The fast `canBook` pre-check
 * only avoids sending a customer to pay for an already-taken boat; the webhook's
 * `writeBooking` is the authoritative claim.
 */
import type { EventId } from "../domain/ids.js";
import type { PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { canBook } from "./availability.js";
import { chargeNowCents, taxCentsFor } from "./payment-config.js";

export interface BookingCheckoutRequest {
  eventId: EventId;
  customerName: string;
  partySize: number;
  email?: string;
  phone?: string;
  /**
   * Liability-waiver consent (11.5, DEC-110) — REQUIRED to check out: no consent,
   * no charge, so a paid reservation can never exist without a recorded waiver.
   * `waiverConsentAt` is the agreement instant (ISO-8601 UTC), `waiverVersion` the
   * terms version — both stamped server-side at the edge (not trusted from the form).
   */
  waiverConsentAt?: string;
  waiverVersion?: string;
}

export type CheckoutStart =
  | { ok: true; url: string; sessionId: string }
  | {
      ok: false;
      reason:
        | "event_missing"
        | "not_sellable"
        | "unpriced"
        | "invalid_party"
        | "already_claimed"
        | "waiver_required";
    };

export async function createBookingCheckout(
  repo: Repository,
  payments: PaymentPort,
  req: BookingCheckoutRequest,
  urls: { successUrl: string; cancelUrl: string },
): Promise<CheckoutStart> {
  const event = await repo.getEvent(req.eventId);
  if (!event) return { ok: false, reason: "event_missing" };
  if (event.source !== "muster" || event.status !== "scheduled") {
    return { ok: false, reason: "not_sellable" };
  }
  if (event.price === undefined) return { ok: false, reason: "unpriced" };
  if (!Number.isInteger(req.partySize) || req.partySize < 1 || req.partySize > event.capacity) {
    return { ok: false, reason: "invalid_party" };
  }
  // Waiver consent is a hard gate (DEC-110): no consent → no checkout → no charge,
  // so no paid reservation can exist without a recorded waiver. Both fields required.
  if (!req.waiverConsentAt || !req.waiverVersion) {
    return { ok: false, reason: "waiver_required" };
  }
  if (!canBook(event, await repo.listReservationsForEvent(req.eventId), req.partySize)) {
    return { ok: false, reason: "already_claimed" };
  }

  const config = await repo.getPaymentConfig();
  const taxCents = taxCentsFor(event.price, config.taxRateBps);
  // Fee-free by design: this legacy 11.2 harness path predates the DEC-134 service fee; the
  // live customer checkout (createDeparturePaymentIntent, 12.5) is where the fee is charged.
  const amountCents = chargeNowCents(event.price, taxCents, 0, config);
  const kind = config.depositMode === "deposit" ? "deposit" : "full";

  const session = await payments.createCheckoutSession({
    amountCents,
    taxCents,
    currency: "usd",
    productName: `Whole-boat charter — ${event.date} ${event.time}`,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    metadata: {
      eventId: String(event.id),
      partySize: String(req.partySize),
      kind,
      taxCents: String(taxCents),
      customerName: req.customerName,
      ...(req.email !== undefined ? { email: req.email } : {}),
      ...(req.phone !== undefined ? { phone: req.phone } : {}),
      waiverConsentAt: req.waiverConsentAt,
      waiverVersion: req.waiverVersion,
    },
  });
  return { ok: true, url: session.url, sessionId: session.id };
}
