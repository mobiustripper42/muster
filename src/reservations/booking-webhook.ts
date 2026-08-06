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
import { formShifts } from "../builder/form-shifts.js";
import type { Payment, Reservation } from "../domain/entities.js";
import {
  asId,
  type EventId,
  type GratuityId,
  type OfferingId,
  type PaymentId,
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
  /**
   * Is the reservations feature on for this deployment (`RESERVATIONS`, DEC-111)? Injected
   * rather than read here — the core does not touch `process.env`.
   *
   * The route comment used to claim this handler was "gated behind the RESERVATIONS flag."
   * It wasn't. It was inert only *by consequence*: the sole live PaymentIntent-creating path
   * is gated, so with the flag off nothing upstream could produce an event. That chain holds
   * today and the #522 audit verified it — but it rests on a Stripe dashboard nobody can read
   * from the repo (#544) and on the checkout gate never being removed. A replayed event, a
   * dashboard test send, or a leftover intent from a flag-on window arrives signature-valid
   * and books. This makes it inert *because we said so* (#588).
   */
  reservationsEnabled: boolean;
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

/**
 * The Payment row id for a charge — deterministic from the charge key (session id, or PI id
 * on the Elements path per DEC-134), which is what makes the write idempotent.
 *
 * Extracted because the refund write-back now needs to name the same row `recordPayment`
 * created. Two inline template literals would be one edit away from silently disagreeing,
 * and the failure mode is an update that matches nothing.
 */
/** Deterministic payment id from the charge key ⇒ an idempotent upsert on Stripe redelivery.
 *  Exported so the Postgres suite can assert NO orphan row survives a lost/unbookable charge (#613). */
export const paymentIdFor = (chargeKey: string): PaymentId => asId<"PaymentId">(`pay_${chargeKey}`);

/**
 * Read a required cents value out of charge metadata, or throw.
 *
 * Money read from metadata must never fall back to a default: a zero that flows into the
 * booking is indistinguishable downstream from a genuinely free one. Throwing surfaces as
 * a 500, which is the correct answer to Stripe — it retries, and the failure is visible.
 */
function requireCents(raw: string | undefined, field: string, chargeKey: string): number {
  // Validate the STRING, not the coercion. `Number("  ")` is 0 — finite and not negative
  // — so a whitespace-only value walked straight through the first version of this guard
  // and booked at price zero, which is the exact defect it exists to prevent. `Number`
  // also accepts `"0x10"` (→ 16) and `"1e3"`, neither of which our builders emit; Stripe
  // makes no promise about what a metadata value contains. Integer cents only (DEC-112).
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new Error(
      `booking metadata is missing a usable ${field} (got ${JSON.stringify(raw)}) on charge ${chargeKey} — ` +
        `refusing to book at a defaulted price`,
    );
  }
  return Number(raw);
}

/** The charge→booking spine, shared by both event paths (11.2 / 12.5). */
async function processBookingCharge(
  deps: WebhookDeps,
  charge: BookingCharge,
): Promise<WebhookResult> {
  // The RESERVATIONS gate (#588, DEC-111) lives HERE — on the new-booking path only, and after
  // both event shapes have resolved their purpose.
  //
  // The first version of this gated the whole handler right after signature verification, which
  // read as the safer place and was not. Balance and post-trip gratuity collection ride the same
  // webhook on EXISTING reservations, and their entry point (`createBalanceLink`) is admin-gated,
  // not RESERVATIONS-gated. Since the flag is off by default, that version dropped every real
  // balance payment in a default deployment: Stripe charges the customer, `recordBalancePayment`
  // never runs, and the operator gets an alert about new-booking readiness that has nothing to do
  // with what happened. Caught in review before merge.
  //
  // Verification still happens first — `parseEvent` throws on a bad signature well upstream — so
  // an unsigned request still gets its 400 and the flag cannot be used to probe the endpoint.
  // Metadata-less shadow intents (DEC-134) return before reaching here, so the expected noise of
  // a hosted session's bare PI never trips the alert.
  if (!deps.reservationsEnabled) {
    // Loud, because reaching here means a verified charge SUCCEEDED and Muster is deliberately
    // not booking it. With the flag off nothing can mint a new booking intent, so this is a
    // replay, a dashboard send, or a leftover from a flag-on window — in all three money has
    // already moved. Dropping it silently is how a paying customer ends up with no booking and
    // nobody knowing. Acked so Stripe stops retrying; alerted so a human looks.
    await deps.alertPaidButUnbooked(
      `⚠️ Verified booking charge received while RESERVATIONS is off — acked and NOT booked ` +
        `(${charge.key}). Money has moved; investigate before flipping the flag on.`,
    );
    return { handled: false };
  }

  const m = charge.metadata;
  const idempotencyKey = charge.key;
  const kind = m.kind === "deposit" ? "deposit" : "full";
  // Slot-first (12.1) sessions carry the SLOT (no eventId); legacy 11.2 sessions carry an
  // eventId. Guest count is `guestCount` on the new path, `partySize` on the old.
  const isSlotBooking = Boolean(m.vesselId && m.date && m.time && m.offeringId);
  const partySize = Number(m.guestCount ?? m.partySize);
  const reservationId = reservationIdFor(idempotencyKey);

  // Money has already moved by the time we get here, so a metadata problem must be LOUD
  // before it is fatal. `requireCents` throws below (correctly — a 500 makes Stripe
  // retry), but a bare throw from inside the `writeSlotBooking` argument list would run
  // before `recordPayment` and before any alert: no Payment row, no reservation, no
  // notification, and Stripe gives up after ~3 days. The only trace would be a
  // `console.error` in the route. That inverts this module's own posture — every other
  // paid-but-unbooked branch records the payment and alerts (#522 review).
  //
  // Alert first, then rethrow: the retry behaviour is unchanged, the money is visible.
  //
  // SCOPED TO THE PARSE, not the write. Wrapping the write too would alert "PAID but NOT
  // booked — unusable booking metadata … REFUND MANUALLY" for a pg connection blip or a
  // serialization failure, which the route already documents as expected and retryable
  // (`app/api/webhooks/stripe/route.ts:68`). Telling an operator to refund a booking that
  // will land on the next retry is worse than saying nothing, and it gets worse still once
  // the alert fans out to admins over SMS.
  const alertUnusableMetadata = async (e: unknown): Promise<void> => {
    await deps
      .alertPaidButUnbooked(
        `⚠️ PAID but NOT booked — unusable booking metadata on Stripe charge ${charge.key} ` +
          `(${charge.amountCents} ${charge.currency}): ${e instanceof Error ? e.message : String(e)}. ` +
          `Stripe will retry; if it keeps failing, REFUND MANUALLY and investigate the builder that minted it.`,
      )
      .catch(() => {
        // An alert failure must not replace the underlying error — the caller rethrows that.
      });
  };

  // Parse the money metadata BEFORE the write, in its own guard. A defect here is our bug
  // and needs the alert; a write failure is infra and Stripe's retry already covers it.
  const parseSlotMoney = async (): Promise<{ priceCents: number; extrasCents: number }> => {
    try {
      return {
        // Never default. `?? 0` materialized the event at price 0, after which
        // `balanceOwedCents` derives "nothing owed" and `purchases-view` reports
        // `priceKnown: true` — a free boat that reads as a normal paid booking (#522).
        priceCents: requireCents(m.priceCents, "priceCents", charge.key),
        // Extras frozen at checkout (composeFare, #474) — carried so the deposit-mode
        // balance deriver bills base + extras, not the bare base (DEC-107 amend). Absent is
        // legitimate (a pre-#474 charge) and reads 0; present-but-unusable is not, and used
        // to slip through the same `Number()` coercion `priceCents` was hardened against.
        extrasCents: requireCents(m.extrasCents ?? "0", "extrasCents", charge.key),
      };
    } catch (e) {
      await alertUnusableMetadata(e);
      throw e;
    }
  };

  const money = isSlotBooking ? await parseSlotMoney() : null;

  const result: BookingResult | SlotBookingResult = money
    ? await writeSlotBooking(
        deps.repo,
        {
          offeringId: asId<"OfferingId">(m.offeringId ?? ""),
          vesselId: asId<"VesselId">(m.vesselId ?? ""),
          date: m.date ?? "",
          time: m.time ?? "",
          guestCount: partySize,
          priceCents: money.priceCents,
          extrasCents: money.extrasCents,
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

  // **Record the Payment ONLY once a reservation exists to hang it on (#613).**
  //
  // This used to run unconditionally, right here, "against the (would-be) reservation either
  // way". It cannot: `payments.reservation_id` is `not null` with an immediate FK to
  // `reservations(id)`, and on a `lost` or `unbookable` outcome that reservation was never
  // written. The insert violated the FK and threw — taking out the auto-refund, the sold-out
  // notice and the operator alert, all of which live below. Stripe then retried into the same
  // violation for ~3 days and gave up. Charged, unbooked, unrefunded, unreported.
  //
  // The in-memory double is a `Map.set` with no referential integrity (DEC-131), so every unit
  // test of this path passed while production could only ever fail. The guard now lives in
  // `postgres-repository.test.ts`, which is the only place it can be proven.
  if (result.outcome === "booked" || result.outcome === "already") {
    await recordPayment(deps, charge, kind, reservationId);

    // **Form the shift the booking just earned (#614).** `writeSlotBooking` writes the Event and
    // the Reservation and stops; nothing downstream created a Shift, so a Muster-native booking
    // produced an event with no seats, no asks and no crew.
    //
    // It has worked so far only because the operator keeps pressing "Pull from Xola", which
    // re-forms shifts from ALL events including Muster-native ones. That inverts the dependency
    // the docs assume — Muster bookings are crewable BECAUSE Xola is still being polled — and
    // DEC-126 turns that pull off at cutover. The first Muster-only Saturday would have produced
    // boats that were sold and uncrewed.
    //
    // Here rather than inside `writeSlotBooking` because this is where a completed booking's side
    // effects already live (`sendConfirmation` below), and it covers the legacy `writeBooking`
    // path in the same stroke. Best-effort by the same contract: the booking is committed and
    // PAID, so a formation failure must never 500 — Stripe would retry a booking that already
    // exists, resolve `already`, and still not form. The cron tick re-forms as the backstop.
    //
    // No `notifyTripChanges`: that flag is the import's, for relaying "your shift changed" to
    // crew whose committed day moved. Nobody is on this shift yet — it is being born.
    try {
      await formShifts(deps.repo, { now: new Date(deps.now()) });
    } catch (e) {
      console.error(
        `[reservations] formShifts after booking ${reservationId} failed — the tick will re-form`,
        e,
      );
    }
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
    }

    // Record the PRE-gratuity (DEC-124) — crew money, keyed to the event pool. Slot
    // bookings only carry a tip.
    //
    // Runs on `already` as well as `booked`, and MUST. Idempotency here is the
    // deterministic id plus `on conflict (id) do nothing`, not the outcome gate — a
    // redelivery cannot double-record whichever branch it lands in. Gating on `booked`
    // (as the confirmation legitimately does) made the tip unrecoverable instead: if
    // anything after the booking commit throws — `recordPayment` above, or this write —
    // the webhook 500s, Stripe redelivers, `writeSlotBooking` short-circuits to `already`,
    // and the `booked` branch is false forever. The result was silent: `Payment.gratuityCents`
    // still nets out of the customer's balance, so nothing looks wrong, but `splitGratuity`
    // builds the crew pool from `Gratuity` rows alone — so the tip stays in the operator's
    // Stripe account and the crew is never paid it (#522 sweep 1).
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
      // No ledger write here, and that is the #613 change. #522 sweep 1 added a
      // `markPaymentRefunded` call so a refunded loser wasn't left reading `succeeded` — the
      // right goal, reached the wrong way: the row it marked could never exist, because its
      // reservation never existed (the comment there said as much: "it doesn't reach the
      // purchases list"). Not writing the row achieves the same goal more completely — nothing
      // to inflate a `listAllPayments` rollup and nothing to reconcile. Stripe holds the record
      // of money that never became a booking, which is what it is.
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
    id: paymentIdFor(charge.key), // deterministic ⇒ idempotent upsert
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
  // Reconcile BEFORE writing (#613). This used to `savePayment` first and load the reservation
  // after — the same inversion as the booking path, and the same failure: a balance session
  // whose `reservationId` metadata is missing or garbled has no row to reference, the FK
  // rejects the insert, and the "RECONCILE MANUALLY" alert below — the only thing that tells
  // anyone — never fires. Stripe retries into the identical violation until it gives up.
  const reservation = await deps.repo.getReservation(reservationId);
  const event = reservation ? await deps.repo.getEvent(reservation.eventId) : null;
  if (!reservation || reservation.status !== "booked" || event?.price === undefined) {
    await deps.alertPaidButUnbooked(
      `⚠️ Balance payment could NOT be recorded — reservation ${reservationId} is missing, ` +
        `cancelled, or unpriced. Stripe session ${completed.sessionId}. RECONCILE / REFUND MANUALLY in Stripe.`,
    );
    return { handled: true, outcome: "balance_paid" };
  }

  await deps.repo.savePayment(payment);

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
