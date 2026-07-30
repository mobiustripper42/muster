// src/reservations/record-balance-payment.ts
import { Payment } from "../payments/payment-model";
import { findReservationById } from "../reservations/reservation-repository";
import { savePayment } from "../payments/payment-repository";
import { alertBalancePaymentUnknown } from "../alerts/alert-service";
import { logger } from "../utils/logger";

/**
 * Records a balance‑type payment. The original implementation saved the payment
 * **before** loading the reservation, which caused a FK violation when the
 * reservation ID in the metadata was missing or malformed.
 *
 * The function now loads the reservation first, validates the reference and
 * only then persists the payment. If the reservation cannot be found we emit an
 * alert and **do not** attempt to write the payment, avoiding the 500 loop.
 */
export async function recordBalancePayment(payment: Payment): Promise<void> {
  // Load the reservation that the payment claims to belong to.
  const reservationId = payment.metadata?.reservationId;
  if (!reservationId) {
    await alertBalancePaymentUnknown(payment);
    logger.warn("Balance payment missing reservationId", { paymentId: payment.id });
    return;
  }

  const reservation = await findReservationById(reservationId);
  if (!reservation) {
    // No reservation – raise an alert and abort the write.
    await alertBalancePaymentUnknown(payment);
    logger.warn("Balance payment references unknown reservation", {
      paymentId: payment.id,
      reservationId,
    });
    return;
  }

  // At this point the reservation exists, so persisting the payment is safe.
  await savePayment(payment, reservation.id);
}
