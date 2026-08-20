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
 * **A Payment row requires a reservation to hang it on (#613).** `payments.reservation_id` is
 * `not null` with an immediate FK, so the row is written only once a reservation exists:
 *  - `lost` / `unbookable` — **no row.** The reservation was never written, so one is impossible;
 *    Stripe holds the record of money that never became a booking.
 *  - a balance whose reservation is **missing** — no row, same reason.
 *  - a balance whose reservation is **cancelled or unpriced** — the row EXISTS, so the FK is
 *    satisfied and the payment IS recorded, then flagged. Unreconcilable is not unrecordable.
 *  - an **OVERPAID** balance — recorded, then flagged.
 *
 * Every case that cannot be recorded, and every case that is recorded but cannot be reconciled,
 * LOUDLY ALERTS ALL ADMINS to refund manually. Refunds are always manual (Stripe dashboard)
 * except the DEC-109 residual-race auto-refund. Provider-agnostic + `FakePaymentPort`-testable.
 */
import { formShifts, type FormResult } from "../builder/form-shifts.js";
import { logFormAudit } from "../oracle/audit-log.js";
import type { Payment, Reservation } from "../domain/entities.js";
import {
  asId,
  type PaymentId,
  type ReservationId,
} from "../domain/ids.js";
import type { CheckoutCompleted, DisputeUpdated, PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { balanceOwedCents } from "./payment-config.js";
import {
  reservationIdFor,
  writeSlotBooking,
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
  /**
   * Relay a re-form's crew notices — "you're off" (`cancelledCrew`) and "you're on"
   * (`restoredCrew`), DEC-084/#244. Injected because the channel wiring lives in `app/`.
   *
   * Optional so existing test harnesses and any caller that genuinely has no channel keep
   * compiling; absent, the notices are skipped and the audit row is still written. **The Stripe
   * route must wire it** — after DEC-126 this webhook is one of only two `formShifts` triggers in
   * production, and an unrelayed `cancelledCrew` is a crew member who is never told.
   */
  relayFormNotices?: (form: FormResult) => Promise<void>;
}

export type WebhookResult =
  | { handled: false } // verified but ignorable (unknown type / a hosted session's bare PI) → ack + ignore
  | {
      handled: true;
      outcome:
        | "booked"
        | "already"
        | "lost"
        | "unbookable"
        | "balance_paid"
        | "gratuity_paid"
        | "refund_recorded"
        | "dispute_recorded"
        | "ignored";
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


  // A REFUND landed (#616) — reconcile it into the ledger.
  //
  // Deliberately BEFORE the RESERVATIONS gate and outside the booking spine entirely. The gate
  // guards new bookings (#588); money that has already gone back must be recorded in every
  // deployment, flag on or off, exactly like the balance payment the gate was moved off for.
  //
  // This is the path that makes a STRIPE DASHBOARD refund visible at all. Before it, the docs
  // told the operator to refund there and Muster never learned: the reservation kept reading
  // paid, the slot stayed booked, `balanceOwedCents` kept billing, and `/admin/purchases` kept
  // counting the revenue. It also catches Muster's own refunds a second time, harmlessly —
  // `markPaymentRefunded` takes a cumulative total, so the write is the same one
  // `refundReservation` already made.
  if (event.type === "refund_recorded") return recordRefund(deps, event.data);

  // A CHARGEBACK moved (issue #723) — same posture as the refund above, and before the
  // RESERVATIONS gate for the same reason: money that has already left the account must be
  // recorded in every deployment, flag on or off.
  if (event.type === "dispute_updated") return recordDispute(deps, event.data);

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
        `Stripe payment intent with unknown purpose="${purpose}" - ${pi.paymentIntentId}. ` +
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
      `Stripe checkout with unknown purpose="${purpose}" - session ${completed.sessionId}. ` +
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
      `booking metadata is missing a usable ${field} (got ${JSON.stringify(raw)}) on charge ${chargeKey} - ` +
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
      `Verified booking charge received while RESERVATIONS is off - acked and NOT booked ` +
        `(${charge.key}). Money has moved; investigate before flipping the flag on.`,
    );
    return { handled: false };
  }

  const m = charge.metadata;
  const idempotencyKey = charge.key;
  const kind = m.kind === "deposit" ? "deposit" : "full";
  // A booking session MUST carry the slot (12.1). The legacy 11.2 shape — an `eventId` and
  // `partySize` instead — is retired (issue #693): it is refused here rather than booked.
  //
  // It claimed by row-locking one `event_id`, which is what #615/#691 replaced. Those put the
  // hull-overlap guard and the hull-day advisory lock on `saveBookingIfSlotFree`;
  // `saveReservationIfUnclaimed` never got them, so this branch still reverted to the exact
  // pre-#691 behaviour where two overlapping trips on one hull both succeed — silently, since
  // a clean reservation is written and #613's net only fires on a REJECTED write.
  //
  // Nothing minted this shape (`createBookingCheckout`, now deleted, had no caller under
  // `app/`), so it was an unguarded FALLBACK rather than a removed path: dead in practice and
  // reachable the moment anything started minting a legacy session again. Deleting it makes the
  // deadness enforced instead of assumed, and a future caller has to consciously build a path
  // rather than inherit one with no guard on it.
  //
  // Loud, not silent — money has already moved, same posture as the flag-off branch above.
  const isSlotBooking = Boolean(m.vesselId && m.date && m.time && m.offeringId);
  if (!isSlotBooking) {
    await deps.alertPaidButUnbooked(
      `PAID but NOT booked - booking session ${charge.key} carries no slot ` +
        `(${charge.amountCents} ${charge.currency}). The legacy eventId booking path was retired ` +
        `(#693) because it wrote without the hull-overlap guard. REFUND MANUALLY and find what ` +
        `minted a session with this shape - nothing in the app should.`,
    );
    return { handled: true, outcome: "unbookable" };
  }
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
        `PAID but NOT booked - unusable booking metadata on Stripe charge ${charge.key} ` +
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

  const money = await parseSlotMoney();

  const result: SlotBookingResult = await writeSlotBooking(
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
    // effects already live (`sendConfirmation` below). It used to cover the legacy `writeBooking`
    // path in the same stroke; there is only one path now (#693). Best-effort by the same
    // contract: the booking is committed and
    // PAID, so a formation failure must never 500 — Stripe would retry a booking that already
    // exists, resolve `already`, and still not form. The cron tick re-forms as the backstop.
    //
    // `notifyTripChanges: true` (#765). This used to be off, reasoning "nobody is on this shift
    // yet — it is being born". True of the shift being born, and it is not the only shift this
    // booking can touch: `formShifts` groups events by vessel + day, so a booking onto a day that
    // ALREADY has a crewed shift joins that shift's trip set. Somebody's committed day just grew
    // a trip and they were told nothing. The gate stays diff-gated in `form-shifts.ts`, so a
    // newborn shift still notifies nobody and a re-form that changes nothing still sends nothing.
    //
    // This is also why the flag cannot stay off "until the import needs it": after DEC-126 turns
    // off the Xola pull, this webhook and the cron tick are the only formation triggers left, so
    // "your shift changed" would have stopped firing entirely — dead code, nothing failing.
    //
    // **The result must be forwarded, not discarded (@code-review).** The first cut dropped it on
    // the reasoning that a newborn shift has nobody to notify. That is true of the shift being
    // born and irrelevant to the call: `formShifts` re-derives EVERY vessel-day, and
    // `cancelledCrew`/`restoredCrew` are NOT gated by `notifyTripChanges` — they fire whenever
    // this call is the first to observe a shift collapsing or resurrecting anywhere. Every other
    // caller relays and audits them (`app/lib/xola.ts`, the split and merge commands). Once
    // DEC-126 turns off the Xola pull, this and the cron tick are the ONLY `formShifts` triggers
    // left, so a crew member dropped from an unrelated shift would be told nothing, forever.
    //
    // Audit is called here (core); the notice relay rides a dep, because the channel wiring lives
    // in `app/` and core cannot import it — the same seam `sendConfirmation` uses.
    try {
      const form = await formShifts(deps.repo, {
        now: new Date(deps.now()),
        notifyTripChanges: true,
      });
      await relayAndAudit(deps, form);
    } catch (e) {
      console.error(
        `[reservations] formShifts after booking ${reservationId} failed - the tick will re-form`,
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
  // the atomic claim. The money moved, and is NOT recorded here (#613 — no reservation to
  // reference). AUTO-REFUND the loser + tell them
  // "sold out while you were paying" (DEC-107 amended, 12.1b). The loud manual-refund alert
  // is the FALLBACK, only when the refund can't run programmatically.
  if (result.outcome === "lost") {
    if (!charge.paymentIntentId) {
      await deps.alertPaidButUnbooked(
        `Residual-race loss with NO payment_intent to auto-refund - Stripe charge ` +
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
        `Residual-race loss AND the auto-refund FAILED (${e instanceof Error ? e.message : "unknown error"}) - ` +
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

  // The anomalous-`unbookable` tail that used to sit here is GONE (#693), and TypeScript is what
  // proved it could go: with the legacy path retired, `result` is a `SlotBookingResult`, which
  // has no `unbookable` variant, so this code narrowed to `never`. Its own comment had already
  // said as much — "only reachable via the legacy seeded-Event path or a genuinely broken
  // session" — and the legacy half of that is what just went away.
  //
  // The genuinely-broken-session half did not evaporate; it moved EARLIER, to the metadata guard
  // near the top, which alerts REFUND MANUALLY before anything is parsed or written. That is the
  // better place for it: it fires before the money is reasoned about rather than after.
  //
  // `writeSlotBooking` returns only `booked` / `already` / `lost`, all handled above, so control
  // never reaches here — TypeScript agrees, which is why the old tail narrowed to `never`. The
  // throw exists to satisfy the compiler's return check and to fail loudly if the union ever
  // grows a variant without someone handling it here.
  throw new Error(
    `unreachable: unhandled writeSlotBooking outcome ${JSON.stringify(result)} for charge ${charge.key}`,
  );
}

/**
 * Relay + audit a re-form's crew transitions. Each leg is independently best-effort: the booking
 * is committed and PAID, so neither a channel hiccup nor an audit write may 500 the webhook — and
 * a relay failure must not skip the audit, or vice versa. Same posture as the cron edge's
 * `forwardToOutbox` / `forwardBoardAlerts` pair.
 */
async function relayAndAudit(deps: WebhookDeps, form: FormResult): Promise<void> {
  try {
    await deps.relayFormNotices?.(form);
  } catch (e) {
    console.error("[reservations] form-notice relay failed — crew may not have been told", e);
  }
  try {
    // Actor `engine`: nobody pressed anything. The booking webhook is autonomous (DEC-118).
    await logFormAudit(deps.repo, form, { kind: "engine" }, new Date(deps.now()));
  } catch (e) {
    console.error("[reservations] form audit failed — the transition is unrecorded", e);
  }
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
 * Reconcile a refund into the ledger (#616) — ours or one taken in the Stripe dashboard.
 *
 * `amountRefundedCents` is the charge's CUMULATIVE refunded total, which is the contract
 * `markPaymentRefunded` already had, so redelivery and a second partial refund are the same
 * write and neither needs a guard here (`greatest()` in SQL, `Math.max` in the double).
 *
 * **Never throws on an unrecognized charge.** A refund on a PaymentIntent Muster never recorded
 * is real — a Xola-era charge, a payment taken by hand, a booking whose write was lost — and a
 * throw would 500 into a Stripe retry loop that can never succeed. Alert a human and ack.
 */
async function recordRefund(
  deps: WebhookDeps,
  refund: { paymentIntentId: string; amountRefundedCents: number },
): Promise<WebhookResult> {
  const payment = await deps.repo.getPaymentByIntentId(refund.paymentIntentId);
  if (!payment) {
    await deps.alertPaidButUnbooked(
      `Refund of ${refund.amountRefundedCents} cents recorded in Stripe for payment intent ` +
        `${refund.paymentIntentId}, which matches NO payment in Muster. The ledger is unchanged; ` +
        `RECONCILE MANUALLY (this is expected for a Xola-era or hand-taken charge).`,
    );
    return { handled: true, outcome: "refund_recorded" };
  }
  await deps.repo.markPaymentRefunded(payment.id, refund.amountRefundedCents);
  return { handled: true, outcome: "refund_recorded" };
}

/** What each dispute state does to the ledger row. `null` = leave the row alone. */
const DISPUTE_LEDGER_WRITE: Record<
  DisputeUpdated["state"],
  "disputed" | "dispute_lost" | "succeeded" | null
> = {
  // A retrieval request. The network is asking a question; no money has moved, so touching
  // the ledger here would invent a loss that never happened. Alert only.
  inquiry: null,
  live: "disputed",
  lost: "dispute_lost",
  // A status the pinned Stripe SDK does not know (see `disputeState`). We cannot tell whether
  // the money moved, so we do not pretend either way — no write, and an alert that names the
  // gap rather than dressing it as a dispute we understood.
  unknown: null,
  // We won: the funds are reinstated, so the row goes back to being ordinary revenue. The
  // argument itself is not re-litigated here — the evidence and the deadlines live in the
  // Stripe dashboard, which stays the system of record for the dispute WORKFLOW (issue #723
  // is deliberately record-only).
  won: "succeeded",
};

/**
 * Reconcile a chargeback into the ledger and tell a human (issue #723).
 *
 * **Why this exists at all:** a dispute is the one way money leaves the account with nobody in
 * Muster pressing anything. Before this, the reservation kept reading paid, the boat stayed
 * held, and `/admin/purchases` kept counting revenue that Stripe had already pulled back — the
 * same blindness `charge.refunded` fixed for refunds in #616.
 *
 * **The alert fires on every state, including the ones that write nothing.** An inquiry moves
 * no money and changes no row, and it is still the earliest warning the operator will ever get
 * that a booking is heading for a chargeback — with a response deadline attached that only a
 * human can act on. Recording it silently would be the "job ran, nobody found out" failure this
 * whole class of work exists to prevent.
 *
 * **Never throws on an unrecognized charge**, same as `recordRefund`: a dispute against a
 * Xola-era or hand-taken payment is real, and a throw would 500 into a Stripe retry loop that
 * can never succeed.
 */
async function recordDispute(
  deps: WebhookDeps,
  dispute: DisputeUpdated,
): Promise<WebhookResult> {
  // Plain ASCII, no emoji and no typographic dashes (issue #777): these bodies are TEXTED to
  // the admins now, and one non-GSM-7 character forces the whole message to UCS-2 — halving
  // the segment and eating the payment-intent id off the end of the preview, which is the one
  // thing in here nobody can reconstruct.
  const money = `${dispute.amountCents} cents (${dispute.currency.toUpperCase()})`;
  const payment = await deps.repo.getPaymentByIntentId(dispute.paymentIntentId);

  if (!payment) {
    await deps.alertPaidButUnbooked(
      `Stripe DISPUTE (${dispute.state}, reason: ${dispute.reason}) for ${money} on payment ` +
        `intent ${dispute.paymentIntentId}, which matches NO payment in Muster. The ledger is ` +
        `unchanged; RESPOND IN STRIPE (this is expected for a Xola-era or hand-taken charge).`,
    );
    return { handled: true, outcome: "dispute_recorded" };
  }

  const write = DISPUTE_LEDGER_WRITE[dispute.state];
  if (write) await deps.repo.markPaymentDisputed(payment.id, write);

  await deps.alertPaidButUnbooked(
    dispute.state === "unknown"
      ? `Stripe dispute on ${money} for reservation ${payment.reservationId} reported a status ` +
          `this deploy does not recognise. The ledger was NOT changed because we cannot tell ` +
          `whether the money moved. CHECK STRIPE, and update the Stripe SDK.`
      : dispute.state === "inquiry"
      ? `Stripe INQUIRY (reason: ${dispute.reason}) on ${money} for reservation ` +
          `${payment.reservationId}. No money has moved and the booking still stands, but this ` +
          `is the warning before a chargeback. RESPOND IN STRIPE before the deadline.`
      : dispute.state === "won"
        ? `Stripe dispute WON on ${money} for reservation ${payment.reservationId}. The funds ` +
            `are back and the payment reads as paid again.`
        : `Stripe DISPUTE ${dispute.state === "lost" ? "LOST" : "OPENED"} (reason: ` +
            `${dispute.reason}) on ${money} for reservation ${payment.reservationId}. The ` +
            `funds are OUT of the account and this booking no longer counts as paid` +
            `${dispute.state === "lost" ? ". This is final." : ". RESPOND IN STRIPE."}`,
  );
  return { handled: true, outcome: "dispute_recorded" };
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
      `Post-trip gratuity paid for reservation ${reservationId}, but it is missing/cancelled - ` +
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
 * booking write (the boat was won at deposit, DEC-109), no confirmation emit. The Payment
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
  // **Only the MISSING case may skip the write (#613, review).** The first cut of this fix
  // reordered the whole three-way guard — missing / cancelled / unpriced — and that was wrong:
  // the FK requires the reservation ROW to exist, nothing more. `cancelled` is a legitimate
  // `ReservationStatus`, so a cancelled-but-present reservation has always satisfied it and the
  // pre-#613 code recorded that payment successfully before alerting. Reordering all three legs
  // silently dropped the ledger row for money that had genuinely moved — the exact defect class
  // this issue exists to remove, reintroduced one branch over.
  const reservation = await deps.repo.getReservation(reservationId);
  if (!reservation) {
    // No row to reference. Recording is impossible, not merely undesirable — the insert would
    // violate the FK, throw, and take this alert with it, which is the original #613 failure.
    await deps.alertPaidButUnbooked(
      `Balance payment could NOT be recorded - reservation ${reservationId} does not exist. ` +
        `Stripe session ${completed.sessionId}. RECONCILE / REFUND MANUALLY in Stripe.`,
    );
    return { handled: true, outcome: "balance_paid" };
  }

  // The reservation exists, so the FK is satisfied whatever its status: record the money that
  // moved, THEN reconcile. An unreconcilable payment is still a payment, and a ledger that
  // quietly omits it is worse than one that shows it flagged.
  await deps.repo.savePayment(payment);

  const event = await deps.repo.getEvent(reservation.eventId);
  if (reservation.status !== "booked" || event?.price === undefined) {
    await deps.alertPaidButUnbooked(
      `Balance payment recorded for reservation ${reservationId}, but it is cancelled or ` +
        `unpriced - Stripe session ${completed.sessionId}. RECONCILE / REFUND MANUALLY in Stripe.`,
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
      `Reservation ${reservationId} OVERPAID by ${-owed} cents - a balance was likely paid ` +
        `twice (two checkout sessions raced). REFUND the excess MANUALLY in Stripe.`,
    );
  }
  return { handled: true, outcome: "balance_paid" };
}
