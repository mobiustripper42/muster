/**
 * Start a POST-TRIP GRATUITY checkout (Phase 12.3, DEC-124) — a customer adds a tip after the
 * trip via the booking-link manage page. Mirrors `createBalanceCheckout`: its own Stripe
 * session (`purpose:"gratuity"`), **writes nothing** — the webhook records a `Gratuity{kind:'post'}`
 * (and, deliberately, NO `Payment`) on completion. Gratuity is untaxed crew money (DEC-124), so
 * the whole amount is the charge, `taxCents:0`.
 *
 * The manage-page UI that calls this is 12.6 (DEC-122 living link); 12.3 provides the mechanism.
 */
import { isBooked } from "../domain/entities.js";
import type { ReservationId } from "../domain/ids.js";
import type { PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";

export type GratuityCheckoutStart =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; reason: "reservation_missing" | "not_active" | "invalid_amount" };

export async function createGratuityCheckout(
  repo: Repository,
  payments: PaymentPort,
  reservationId: ReservationId,
  amountCents: number,
  urls: { successUrl: string; cancelUrl: string },
): Promise<GratuityCheckoutStart> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }
  const reservation = await repo.getReservation(reservationId);
  // Gratuity is a Muster-native concept only (Xola owns its own money, DEC-105).
  if (!reservation || reservation.source !== "muster") {
    return { ok: false, reason: "reservation_missing" };
  }
  if (!isBooked(reservation)) return { ok: false, reason: "not_active" };

  const session = await payments.createCheckoutSession({
    amountCents,
    taxCents: 0, // gratuity is tax-exempt (DEC-124)
    currency: "usd",
    productName: "Gratuity for your crew",
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    metadata: {
      purpose: "gratuity",
      reservationId: String(reservationId),
      taxCents: "0",
    },
  });
  return { ok: true, url: session.url, sessionId: session.id };
}
