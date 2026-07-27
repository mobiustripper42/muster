/**
 * Process a Stripe payment webhook (Phase 11.2, DEC-107; event union 12.5, DEC-134).
 *
 * Two event types drive it (`parseEvent`):
 *  - **`checkout.session.completed`** (hosted Checkout) — dispatches on `metadata.purpose`
 *    (11.2b): `"balance"` → record a `Payment{kind:'balance'}` against the already-claimed
 *    reservation (no re-booking); `"gratuity"` → the post-trip tip; absent/`"booking"` → the
 *    charge→booking spine. Any OTHER purpose is loudly flagged, never silently booked.
 *  - **`payment_intent.succeeded`** (inline Elements, 12.5) — the SAME booking spine, keyed
 *    on the PaymentIntent id. **Double-write guard (DEC-134):** processes ONLY intents whose
 *    metadata carries `purpose` — the metadata-less PI underlying every hosted session is
 *    acked-and-ignored, so one charge can never book twice.
 *
 * **On a paid-but-unbooked outcome (`lost`/`unbookable`) or an OVERPAID balance: record the
 * payment and LOUDLY ALERT ALL ADMINS to refund manually.** Refunds are always manual (Stripe
 * dashboard) except the DEC-109 residual-race auto-refund. Provider-agnostic +
 * `FakePaymentPort`-testable.
 */
import type { Payment, Reservation } from "../domain/entities.js";
import {
  asId,
  type EventId,
  type GratuityId,
  type OfferingId,
  type ReservationId,
  type VesselId,
} from "../domain/ids.js";
import type { CheckoutCompleted, PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { balanceOwedCents } from "./payment-config.js";
import {
  reservationIdFor,
  writeBooking,
  writeSlotBooking,
  type BookingResult,
  type SlotBookingResult,
} from "./write-booking.js";

export interface WebhookDeps {
  repo: Repository;
  payments: PaymentPort;
  now: () => string;
  /**
   * Loudly notify all active admins that a PAID customer needs a MANUAL refund. Post-12.1b
   * this is the FALLBACK, not the default: a residual-race loss is auto-refunded (below); this
   * fires only when the auto-refund itself fails or there's no `paymentIntentId` to refund
   * against, and for other unreconcilable money (e.g. an overpaid balance).
   */
  alertPaidButUnbooked: (message: string) => Promise<void>;
  /**
   * Tell the customer their departure sold out while they were paying and they've been fully
   * refunded (DEC-109 residual race). Best-effort — a notify failure must never 500 the
   * webhook (the refund already succeeded; a 500 would make Stripe retry the whole event).
   * Receives the normalized charge (contact lives in `metadata`) — works for both the hosted
   * session and the Elements PaymentIntent path (DEC-134).
   */
  notifyCustomerSoldOut: (charge: SoldOutCharge) => Promise<void>;
  /**
   * Email + SMS the customer their booking-management link (11.4, DEC-122). Fires ONLY on a
   * fresh `booked` outcome — never on the idempotent `already` (Stripe redelivers
   * `checkout.session.completed`; each redelivery resolves to `already`, and re-sending would
   * re-notify the customer every retry). MUST be best-effort — a confirmation failure never
   * throws here, so a committed booking never 500s the webhook (which would trigger a retry).
   */
  sendConfirmation: (reservation: Reservation) => Promise<void>;
}

export type WebhookResult =
  | { handled: false } // verified but ignorable (unknown type / a hosted session's bare PI) → ack + ignore
  | {
      handled: true;
      outcome: "booked" | "already" | "lost" | "unbookable" | "balance_paid" | "gratuity_paid" | "ignored";
    };

/** The contact-bearing slice of a charge the sold-out notice needs (both event paths). */
export interface SoldOutCharge {
  /** Loggable handle: the session id (hosted) or PaymentIntent id (Elements). */
  chargeRef: string;
  metadata: Record<string, string>;
}

/**
 * A charge that should BOOK, normalized off either event type. The booking spine below is
 * identical for both; only the provenance fields differ (session id vs PaymentIntent id).
 */
interface BookingCharge {
  /** Booking idempotency key: the session id (hosted) or the PaymentIntent id (Elements) —
   *  also the seed for the Payment id (`pay_${key}`), gratuity id (`grat_pre_${key}`), and
   *  refund key (`refund_${key}`). */
  key: string;
  sessionId?: string;
  paymentIntentId?: string;
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
}

export async function processBookingWebhook(
  deps: WebhookDeps,
  rawBody: string,
  signature: string,
): Promise<WebhookResult> {
  const event = deps.payments.parseEvent(rawBody, signature); // throws on bad sig
  if (!event) return { handled: false };

  if (event.type === "payment_succeeded") {
    const pi = event.data;
    const purpose = pi.metadata.purpose;
    // DOUBLE-WRITE GUARD (DEC-134): every hosted Checkout session has an underlying
    // PaymentIntent that ALSO emits `payment_intent.succeeded` — but carries NO metadata
    // (the adapter never sets `payment_intent_data.metadata`). Only OUR minted intents
    // carry `purpose`, so a metadata-less PI is acked-and-ignored, never booked twice.
    if (purpose === undefined) return { handled: false };
    if (purpose !== "booking") {
      await deps.alertPaidButUnbooked(
        `⚠️ Stripe payment intent with unknown purpose="${purpose}" — ${pi.paymentIntentId}. ` +
          `NOT auto-processed; investigate (money may have moved).`,
      );
      return { handled: true, outcome: "ignored" };
    }
    return processBookingCharge(deps, {
      key: pi.paymentIntentId,
      paymentIntentId: pi.paymentIntentId,
      amountCents: pi.amountReceivedCents,
      currency: pi.currency,
      metadata: pi.metadata,
    });
  }

  const completed = event.data;
  // Dispatch on purpose (11.2b). A balance payment records against the existing reservation;
  // it must NEVER reach the booking path (no eventId → an orphan reservation).
  const purpose = completed.metadata.purpose;
  if (purpose === "balance") return recordBalancePayment(deps, completed);
  if (purpose === "gratuity") return recordPostGratuity(deps, completed);
  if (purpose !== undefined && purpose !== "booking") {
    await deps.alertPaidButUnbooked(
      `⚠️ Stripe checkout with unknown purpose="${purpose}" — session ${completed.sessionId}. ` +
        `NOT auto-processed; investigate (money may have moved).`,
    );
    return { handled: true, outcome: "ignored" };
  }
  return processBookingCharge(deps, {
    key: completed.sessionId, // Stripe's session id keys the booking (11.2)
    sessionId: completed.sessionId,
    ...(completed.paymentIntentId !== undefined
      ? { paymentIntentId: completed.paymentIntentId }
      : {}),
    amountCents: completed.amountTotalCents,
    currency: completed.currency,
    metadata: completed.metadata,
  });
}

/** The charge→booking spine, shared by both event paths (11.2 / 12.5). */
async function processBookingCharge(
  deps: WebhookDeps,
  charge: BookingCharge,
): Promise<WebhookResult> {
  const m = charge.metadata;
  const idempotencyKey = charge.key;
  const kind = m.kind === "deposit" ? "deposit" : "full";
  // Slot-first (12.1) sessions carry the SLOT (no eventId); legacy 11.2 sessions carry an
  // eventId. Guest count is `guestCount` on the new path, `partySize` on the old.
  const isSlotBooking = Boolean(m.vesselId && m.date && m.time && m.offeringId);
  const partySize = Number(m.guestCount ?? m.partySize);
  const reservationId = reservationIdFor(idempotencyKey);

  const result: BookingResult | SlotBookingResult = isSlotBooking
    ? await writeSlotBooking(
        deps.repo,
        {
          offeringId: asId<"OfferingId">(m.offeringId ?? ""),
          vesselId: asId<"VesselId">(m.vesselId ?? ""),
          date: m.date ?? "",
          time: m.time ?? "",
          guestCount: partySize,
          priceCents: Number(m.priceCents ?? 0),
          // Extras frozen at checkout (composeFare, #474) — carried so the deposit-mode
          // balance deriver bills base + extras, not the bare base (DEC-107 amend).
          extrasCents: Number(m.extrasCents ?? 0),
          customerName: m.customerName ?? "",
          ...(m.email ? { email: m.email } : {}),
          ...(m.phone ? { phone: m.phone } : {}),
          ...(m.waiverConsentAt ? { waiverConsentAt: m.waiverConsentAt } : {}),
          ...(m.waiverVersion ? { waiverVersion: m.waiverVersion } : {}),
          idempotencyKey,
        },
        deps.now,
      )
    : await writeBooking(
        deps.repo,
        {
          eventId: asId<"EventId">(m.eventId ?? ""),
          customerName: m.customerName ?? "",
          partySize,
          ...(m.email ? { email: m.email } : {}),
          ...(m.phone ? { phone: m.phone } : {}),
          ...(m.waiverConsentAt ? { waiverConsentAt: m.waiverConsentAt } : {}),
          ...(m.waiverVersion ? { waiverVersion: m.waiverVersion } : {}),
          idempotencyKey,
        },
        deps.now,
      );

  // The money moved — record the Payment against the (would-be) reservation either way.
  await recordPayment(deps, charge, kind, reservationId);

  if (result.outcome === "booked" || result.outcome === "already") {
    // Confirm ONLY the fresh booking — never the idempotent `already` (a Stripe
    // redelivery), or the customer gets re-texted on every retry (DEC-122).
    if (result.outcome === "booked") {
      // Structurally best-effort: the booking is committed, so a confirmation
      // failure — from a channel OR from anything upstream in the injected dep —
      // must never bubble to a 500 (Stripe would retry the whole webhook). The
      // dep owns surfacing its own failure detail (DEC-122); here we only ensure
      // it can't break the booking, whatever dep is wired in.
      try {
        await deps.sendConfirmation(result.reservation);
      } catch {
        // swallowed by contract — see above
      }
      // Record the PRE-gratuity (DEC-124) — crew money, keyed to the event pool. Slot bookings
      // only carry a tip; deterministic id ⇒ idempotent (gated to the fresh `booked`, like the
      // confirmation, so a redelivery — which resolves `already` — never re-records).
      const gratuityCents = Number(m.gratuityCents ?? 0);
      if (isSlotBooking && gratuityCents > 0) {
        await deps.repo.saveGratuity({
          id: asId<"GratuityId">(`grat_pre_${charge.key}`),
          eventId: result.reservation.eventId,
          reservationId: result.reservation.id,
          kind: "pre",
          amountCents: gratuityCents,
          ...(m.gratuityBps ? { bps: Number(m.gratuityBps) } : {}),
          // Reconciliation handle: the hosted path keeps the session id; an Elements
          // gratuity's handle is the PI id baked into the deterministic row id.
          ...(charge.sessionId !== undefined
            ? { stripeCheckoutSessionId: charge.sessionId }
            : {}),
          createdAt: deps.now(),
        });
      }
    }
    return { handled: true, outcome: result.outcome };
  }

  const who = `${m.customerName || "customer"} party of ${partySize}`;

  // The DEC-109 RESIDUAL RACE (`lost`): a hold expired mid-payment, another buyer took the
  // freed slot and paid first, and this payment then completed. Both captured money, one won
  // the atomic claim. The money moved (recorded above). AUTO-REFUND the loser + tell them
  // "sold out while you were paying" (DEC-107 amended, 12.1b). The loud manual-refund alert
  // is the FALLBACK, only when the refund can't run programmatically.
  if (result.outcome === "lost") {
    if (!charge.paymentIntentId) {
      await deps.alertPaidButUnbooked(
        `⚠️ Residual-race loss with NO payment_intent to auto-refund — Stripe charge ` +
          `${charge.key}, ${who}. REFUND MANUALLY in Stripe.`,
      );
      return { handled: true, outcome: result.outcome };
    }
    try {
      // Keyed on the charge key (session id / PI id — DEC-134) ⇒ a redelivered losing-charge
      // webhook re-calls with the same key and Stripe returns the same refund (no double
      // refund, DEC-107 amended).
      await deps.payments.refund({
        paymentIntentId: charge.paymentIntentId,
        idempotencyKey: `refund_${charge.key}`,
      });
    } catch (e) {
      await deps.alertPaidButUnbooked(
        `⚠️ Residual-race loss AND the auto-refund FAILED (${e instanceof Error ? e.message : "unknown error"}) — ` +
          `Stripe charge ${charge.key}, ${who}. REFUND MANUALLY in Stripe.`,
      );
      return { handled: true, outcome: result.outcome };
    }
    // Refunded — tell the customer. Best-effort: a notify failure must not 500 (a retry would
    // re-run this path, and the keyed refund would no-op, but re-notify needlessly).
    try {
      await deps.notifyCustomerSoldOut({ chargeRef: charge.key, metadata: charge.metadata });
    } catch {
      // swallowed by contract — the refund succeeded; a missing notice is not a 500
    }
    return { handled: true, outcome: result.outcome };
  }

  // Anomalous `unbookable` (event_missing / not_sellable / … — only reachable via the legacy
  // seeded-Event path or a genuinely broken session). NOT auto-refunded — a human investigates
  // (money may or may not have moved as expected). Loud manual-refund alert (architect ruling).
  const detail = `${result.outcome}/${result.reason}`;
  await deps.alertPaidButUnbooked(
    `⚠️ Paid booking could NOT be placed (${detail}) — Stripe charge ${charge.key}, ` +
      `${who}. REFUND MANUALLY in Stripe.`,
  );
  return { handled: true, outcome: result.outcome };
}

async function recordPayment(
  deps: WebhookDeps,
  charge: BookingCharge,
  kind: "full" | "deposit",
  reservationId: ReservationId,
): Promise<void> {
  const payment: Payment = {
    id: asId<"PaymentId">(`pay_${charge.key}`), // deterministic ⇒ idempotent upsert
    reservationId,
    method: "stripe",
    kind,
    amountCents: charge.amountCents,
    taxCents: Number(charge.metadata.taxCents ?? 0),
    // The gratuity bundled into amountCents (DEC-124) — carved out so balanceOwedCents nets it.
    ...(Number(charge.metadata.gratuityCents ?? 0) > 0
      ? { gratuityCents: Number(charge.metadata.gratuityCents) }
      : {}),
    // The service fee bundled into amountCents (DEC-134) — same carve-out, same reason.
    ...(Number(charge.metadata.serviceFeeCents ?? 0) > 0
      ? { serviceFeeCents: Number(charge.metadata.serviceFeeCents) }
      : {}),
    currency: charge.currency,
    ...(charge.sessionId !== undefined ? { stripeCheckoutSessionId: charge.sessionId } : {}),
    ...(charge.paymentIntentId ? { stripePaymentIntentId: charge.paymentIntentId } : {}),
    status: "succeeded",
    createdAt: deps.now(),
  };
  await deps.repo.savePayment(payment);
}

/**
 * Record a POST-trip gratuity (12.3, DEC-124) against an already-booked reservation — its own
 * `purpose:"gratuity"` Stripe session (mirrors the balance flow). **Writes NO `Payment`** — a
 * Payment would inflate the "paid" sum and drive `balanceOwedCents` negative → a false overpay
 * alert. Gratuity-only, keyed to the reservation's event pool. Idempotent on the session.
 */
async function recordPostGratuity(
  deps: WebhookDeps,
  completed: CheckoutCompleted,
): Promise<WebhookResult> {
  const reservationId = asId<"ReservationId">(completed.metadata.reservationId ?? "");
  const reservation = await deps.repo.getReservation(reservationId);
  if (!reservation || reservation.source !== "muster" || reservation.status !== "booked") {
    await deps.alertPaidButUnbooked(
      `⚠️ Post-trip gratuity paid for reservation ${reservationId}, but it is missing/cancelled — ` +
        `Stripe session ${completed.sessionId}. RECONCILE MANUALLY (gratuity received, not attached).`,
    );
    return { handled: true, outcome: "gratuity_paid" };
  }
  await deps.repo.saveGratuity({
    id: asId<"GratuityId">(`grat_post_${completed.sessionId}`),
    eventId: reservation.eventId,
    reservationId,
    kind: "post",
    amountCents: completed.amountTotalCents,
    stripeCheckoutSessionId: completed.sessionId,
    createdAt: deps.now(),
  });
  return { handled: true, outcome: "gratuity_paid" };
}

/**
 * Record an on-demand BALANCE payment (11.2b) against an already-claimed reservation. No
 * `writeBooking` (the boat was won at deposit, DEC-109), no confirmation emit. The Payment
 * id is deterministic from the balance session id, so a re-delivery is idempotent.
 *
 * Overpay guard: a two-session race (two balance checkouts, both paid) over-collects. The
 * append log must reflect the money that moved, so we record then — if the derived balance
 * has gone NEGATIVE — loudly flag the excess for a MANUAL refund (DEC-107 posture).
 */
async function recordBalancePayment(
  deps: WebhookDeps,
  completed: CheckoutCompleted,
): Promise<WebhookResult> {
  const reservationId = asId<"ReservationId">(completed.metadata.reservationId ?? "");
  const payment: Payment = {
    id: asId<"PaymentId">(`pay_${completed.sessionId}`),
    reservationId,
    method: "stripe",
    kind: "balance",
    amountCents: completed.amountTotalCents,
    taxCents: 0, // the balance carries no tax — it was collected in full with the deposit
    currency: completed.currency,
    stripeCheckoutSessionId: completed.sessionId,
    ...(completed.paymentIntentId ? { stripePaymentIntentId: completed.paymentIntentId } : {}),
    status: "succeeded",
    createdAt: deps.now(),
  };
  await deps.repo.savePayment(payment);

  // Reconcile against the reservation. If it went missing / cancelled / unpriced underneath
  // the checkout session, the money can't be applied — LOUDLY flag for manual review, same
  // posture as a paid-but-unbooked booking (never silently keep an unreconcilable payment).
  const reservation = await deps.repo.getReservation(reservationId);
  const event = reservation ? await deps.repo.getEvent(reservation.eventId) : null;
  if (!reservation || reservation.status !== "booked" || event?.price === undefined) {
    await deps.alertPaidButUnbooked(
      `⚠️ Balance payment recorded for reservation ${reservationId}, but it is missing, ` +
        `cancelled, or unpriced — Stripe session ${completed.sessionId}. RECONCILE / REFUND MANUALLY in Stripe.`,
    );
    return { handled: true, outcome: "balance_paid" };
  }

  // Overpay guard: a two-session race over-collects. The append log reflects the money that
  // moved; if the derived balance has gone NEGATIVE, flag the excess for a manual refund.
  const config = await deps.repo.getPaymentConfig();
  const payments = await deps.repo.listPaymentsForReservation(reservationId);
  // Fare = base + frozen extras (#474): the bare base would trip a false overpay alert on a
  // genuine extras balance (or mask a real overpay).
  const owed = balanceOwedCents(
    event.price + (reservation.extrasCents ?? 0),
    config.taxRateBps,
    payments,
  );
  if (owed < 0) {
    await deps.alertPaidButUnbooked(
      `⚠️ Reservation ${reservationId} OVERPAID by ${-owed} cents — a balance was likely paid ` +
        `twice (two checkout sessions raced). REFUND the excess MANUALLY in Stripe.`,
    );
  }
  return { handled: true, outcome: "balance_paid" };
}
