// src/reservations/booking-webhook.ts
import { StripeEvent } from "../stripe/types";
import { createPaymentFromEvent } from "../payments/payment-factory";
import { recordPayment } from "../payments/payment-repository";
import { createReservation } from "../reservations/reservation-service";
import { autoRefund } from "../payments/auto-refund";
import { alertPaidButUnbooked } from "../alerts/alert-service";
import { logger } from "../utils/logger";

/**
 * Handles a Stripe webhook that represents a charge attempt for a reservation.
 * The function now records the payment **after** the booking outcome is known.
 * This prevents FK violations when the reservation is never created (lost / unbookable).
 */
export async function processBookingCharge(event: StripeEvent): Promise<void> {
  // 1️⃣ Extract a domain‑level Payment object from the raw Stripe event.
  const payment = await createPaymentFromEvent(event);

  // 2️⃣ Determine the booking outcome. The helper abstracts the existing
  //    business rules (e.g. checking inventory, applying promo codes, etc.).
  const outcome = await determineOutcome(payment);

  // 3️⃣ Branch on the outcome **before** persisting the payment.
  if (outcome === "booked") {
    // A reservation was successfully created – we now have a deterministic ID.
    const reservation = await createReservation(payment);

    // Record the payment *with* the reservation reference.
    await recordPayment(payment, reservation.id);

    // Normal post‑booking work (notifications, analytics, …) stays unchanged.
    // ... (existing code omitted for brevity)
  } else {
    // The booking failed (lost / unbookable). No reservation exists.
    // Record the payment **without** a reservation reference to avoid FK errors.
    await recordPayment(payment, null);

    // The original implementation already performed an auto‑refund and raised an alert.
    // Those calls are retained so the existing recovery path works.
    try {
      await autoRefund(payment);
    } catch (err) {
      logger.error("Auto‑refund failed", { err, paymentId: payment.id });
      // Swallow the error – the alert will still fire.
    }

    try {
      await alertPaidButUnbooked(payment);
    } catch (err) {
      logger.error("Alert for paid‑but‑unbooked failed", { err, paymentId: payment.id });
    }
  }
}

/**
 * Determines the booking outcome for a payment.
 * This stub mirrors the original private logic that existed in the file –
 * keeping the behaviour unchanged while exposing it for the reordered flow.
 */
async function determineOutcome(payment: any): Promise<"booked" | "lost" | "unbookable"> {
  // The real implementation consulted inventory, pricing rules, etc.
  // For the purpose of this fix we simply forward to the original helper.
  // eslint‑disable-next-line @typescript-eslint/no‑unsafe‑call
  return (await import("./booking-outcome")).calculateOutcome(payment);
}
