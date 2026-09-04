/**
 * Start a BALANCE checkout (Phase 11.2b, DEC-107) — collect the remaining balance on a
 * deposit booking, ON DEMAND. Computes the owed amount from the canonical deriver
 * (`balanceOwedCents` — total minus Σ succeeded payments, never a config recompute of the
 * deposit share) so it can't drift if `depositPercent`/price changed since the deposit,
 * and opens a Stripe Checkout for exactly that. **Writes nothing** — the `Payment{kind:'balance'}`
 * is written by the webhook on completion (`metadata.purpose="balance"`), against the
 * already-claimed reservation (no re-claim; the boat was won at deposit, DEC-109).
 *
 * The returned Stripe URL IS the balance link — re-minted per request, so it always
 * reflects the current outstanding balance (no durable token). The auto-emit scheduler
 * (`balanceDueDaysBeforeEvent`) and the customer-facing email/page are P12+.
 */
import { eventIdOfBooked } from "../domain/entities.js";
import type { ReservationId } from "../domain/ids.js";
import type { PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { balanceOwedCents } from "./payment-config.js";

export type BalanceCheckoutStart =
  | { ok: true; url: string; sessionId: string; amountCents: number }
  | {
      ok: false;
      reason: "reservation_missing" | "not_active" | "unpriced" | "no_balance" | "disputed";
    };

export async function createBalanceCheckout(
  repo: Repository,
  payments: PaymentPort,
  reservationId: ReservationId,
  urls: { successUrl: string; cancelUrl: string },
): Promise<BalanceCheckoutStart> {
  const reservation = await repo.getReservation(reservationId);
  // Balances are a Muster-native concept only (Xola owns its own money).
  if (!reservation || reservation.source !== "muster") {
    return { ok: false, reason: "reservation_missing" };
  }
  // Don't collect a balance on a cancelled booking.
  if (reservation.status !== "booked") return { ok: false, reason: "not_active" };

  const event = await repo.getEvent(eventIdOfBooked(reservation)); // allow-listed `booked` above
  if (!event || event.price === undefined) return { ok: false, reason: "unpriced" };

  const config = await repo.getPaymentConfig();
  const payments_ = await repo.listPaymentsForReservation(reservationId);
  // The composed fare (base + frozen extras, #474) — the bare base undercollects the balance.
  const owed = balanceOwedCents(
    event.price + (reservation.extrasCents ?? 0),
    config.taxRateBps,
    payments_,
  );
  // `<= 0` folds no_balance, already-paid, and full-mode into one predicate.
  if (owed <= 0) return { ok: false, reason: "no_balance" };

  // A CHARGEBACK re-opens the balance exactly the way a refund does (issue #723): `countsAsPaid`
  // excludes `disputed`, so `owed` above jumps back to the full amount. Without this guard the
  // operator is offered a link that bills the customer AGAIN for the money their bank is
  // currently clawing back — which is the fastest way to turn one dispute into two.
  //
  // Server-side, not just hidden in the pane. The pane's button is a courtesy; this is the
  // thing that makes minting the charge impossible, including from a stale tab or a re-post.
  // #616 added the same pair for refunds and this is the state that arrived after it.
  if (payments_.some((p) => p.status === "disputed" || p.status === "dispute_lost")) {
    return { ok: false, reason: "disputed" };
  }

  const session = await payments.createCheckoutSession({
    amountCents: owed,
    taxCents: 0, // tax was collected in full with the deposit
    currency: "usd",
    productName: `Balance — whole-boat charter ${event.date} ${event.time}`,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    // `purpose:"balance"` routes the webhook to record a balance Payment (no booking write).
    metadata: {
      purpose: "balance",
      reservationId: String(reservationId),
      taxCents: "0",
    },
  });
  return { ok: true, url: session.url, sessionId: session.id, amountCents: owed };
}
