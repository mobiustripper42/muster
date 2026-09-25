/**
 * Process a Stripe payment webhook (Phase 11.2, DEC-107; event union 12.5, DEC-134).
 *
 * Two event types drive it (`parseEvent`):
 *  - **`checkout.session.completed`** (hosted Checkout) — dispatches on `metadata.purpose`
 *    (11.2b): `"balance"` → record a `Payment{kind:'balance'}` against the already-claimed
 *    reservation (no re-booking); absent/`"booking"` → the charge→booking spine. Any OTHER
 *    purpose is loudly flagged, never silently booked — including `"gratuity"`, whose branch
 *    went with post-trip tipping in 15.18.
 *  - **`payment_intent.succeeded`** (inline Elements, 12.5) — the SAME booking spine, keyed
 *    on the PaymentIntent id. **The booking charge sends no metadata (15.6)**, so the PENDING ROW
 *    is what tells our payments apart: checkout writes it before calling Stripe, so an intent that
 *    is ours resolves to a row and one that is not resolves to nothing and books nothing. The
 *    `purpose` guard this replaced could not survive a charge that sends no keys at all.
 *
 * **A Payment row requires a reservation to hang it on (#613).** `payments.reservation_id` is
 * `not null` with an immediate FK, so no Payment is written unless a reservation exists:
 *  - `lost` — **no Payment row, and it is a CHOICE rather than an impossibility.** The
 *    reservation row is right there and still `pending`: `write-booking.ts` returns it, because
 *    the residual-race compensation needs the customer's name and phone and 15.7 left the charge
 *    carrying neither. The FK would be perfectly satisfied. Nothing is written because there is
 *    nothing worth reconciling — see `compensateResidualRaceLoss`, "Stripe holds the record of
 *    money that never became a booking." **Anything keyed off a `lost` outcome therefore HAS a
 *    reservation id to use, and must use it** (issue #1051; this paragraph previously claimed the
 *    row did not exist, and issue #1050's two engine-side trail rows were keyed accordingly).
 *  - `unbookable` — no Payment row, and whether a reservation exists depends on the shape.
 *    `not_pending` and `unusable_row` both resolved to a real row; the hosted-session and
 *    flag-off branches never had one. Only the second pair is money Muster cannot place.
 *  - a balance whose reservation is **missing** — no row, and here it genuinely is impossible.
 *  - a balance whose reservation is **cancelled or unpriced** — the row EXISTS, so the FK is
 *    satisfied and the payment IS recorded, then flagged. Unreconcilable is not unrecordable.
 *  - an **OVERPAID** balance — recorded, then flagged.
 *
 * Every case that cannot be recorded, and every case that is recorded but cannot be reconciled,
 * LOUDLY ALERTS ALL ADMINS to refund manually — a person refunds these, from the booking's page in
 * Muster (DEC-153) or the Stripe dashboard. The one automatic refund is the DEC-109
 * residual-race loser. Provider-agnostic + `FakePaymentPort`-testable.
 */
import { formShifts, type FormResult } from "../builder/form-shifts.js";
import { confirmBookingFromIntent } from "./confirm-booking.js";
import { logFormAudit } from "../oracle/audit-log.js";
import { logSwallowed } from "../log.js";
import { eventIdOfBooked, isBooked } from "../domain/entities.js";
import type { BookingInvoice, Payment, Reservation } from "../domain/entities.js";
import {
  asId,
  type PaymentId,
  type ReservationId,
} from "../domain/ids.js";
import type { CheckoutCompleted, DisputeUpdated, PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { balanceOwedCents } from "./payment-config.js";
import type { SoldOutContact } from "./sold-out-notice.js";
import { confirmPendingRow, type ConfirmResult } from "./write-booking.js";
import { recordTrail } from "./trail.js";
import type { EmittedTrailType } from "../domain/reservation-trail.js";

export interface WebhookDeps {
  // No feature-flag dependency (issue #1093). The `RESERVATIONS` switch and its gate here are gone:
  // reservations are not an optional half of the product, and a deployment with no Stripe keys
  // receives no signed events to gate.
  repo: Repository;
  payments: PaymentPort;
  now: () => string;
  /**
   * Notify all active admins about money that moved without Muster deciding it should. Most of
   * its callers need a MANUAL refund and say so in the body.
   *
   * **Not only that (15.5).** A residual-race loss whose auto-refund SUCCEEDS also alerts, with
   * no action asked for. That path told nobody until 15.5, and the silence was justified on the
   * grounds that nothing needed doing — true, and beside the point: a customer was charged for a
   * trip they did not get, and how often that happens is the evidence deciding issue #1012.
   * Read the body, not the call site, to know whether an alert wants a human.
   *
   * **An implementation must not reject (15.17).** Thirteen call sites await this on paths where
   * money has already moved, and a throw becomes a 500, which Stripe reads as a failed delivery
   * and retries for three days. Wrap yours in `alertThatNeverThrows` below — the type cannot state
   * the requirement, so the wrapper is how it is kept.
   */
  alertPaidButUnbooked: (message: string) => Promise<void>;
  /**
   * Tell the customer their departure sold out while they were paying and they've been fully
   * refunded (DEC-109 residual race). Best-effort — a notify failure must never 500 the
   * webhook (the refund already succeeded; a 500 would make Stripe retry the whole event).
   * Receives a loggable charge ref and the contact **read off the reservation row** (15.5) —
   * §2.8.7's rule, and the only source that survives 15.7 deleting the charge metadata.
   */
  notifyCustomerSoldOut: (charge: SoldOutCharge) => Promise<void>;
  /**
   * Email + SMS the customer their booking-management link (11.4, §2.8.6).
   *
   * **Fires when the ROW says nobody has been told, not on a fresh `booked` outcome** (15.3,
   * issue #971, DEC-169). It used to be outcome-gated, and the reasoning was sound but the
   * mechanism was not: avoiding a re-send on every Stripe redelivery is right, inferring it from
   * "is this delivery the first one" is not. Any failure between the flip committing and the send
   * left the redelivery resolving `already` and the gate false forever — charged, booked, never
   * told. `Reservation.confirmationSentAt` is the memory that replaced it.
   *
   * MUST be best-effort — a confirmation failure never throws here, so a committed booking never
   * 500s the webhook (which would trigger a retry).
   *
   * The old text credited DEC-122. That record was retired on 2026-08-26 with every ruling
   * adjudicated dead; the live authority is §2.8.6.
   */
  /**
   * **Returns whether the customer was actually told.** `false` covers both "tried and failed"
   * and "deliberately not sent" — no channel configured, messaging switched off — because from
   * the row's point of view those are the same fact: nobody has been told.
   *
   * The caller claims the right to send before calling this and gives the claim back on `false`,
   * so a `void` return would make that release unreachable and a carrier outage would mark every
   * booking as told with nobody told (`/security-review`). Still must never THROW.
   */
  sendConfirmation: (reservation: Reservation) => Promise<boolean>;
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

/**
 * Wrap a money alert so it cannot 500 a webhook (15.17, issue #985).
 *
 * **Apply this at every `WebhookDeps` construction.** Thirteen call sites in this file `await
 * deps.alertPaidButUnbooked(...)` on paths where money has already moved, and all but one are
 * unguarded — a rejecting implementation would throw out of the handler, Stripe would read the 500
 * as a delivery failure and redeliver the same event for three days, and every redelivery would
 * re-reach the same alert and throw again. A notification failure would have become a delivery
 * failure on the one class of event where the money is already gone.
 *
 * **That cannot happen today, and this exists so it stays that way.** The production wiring is
 * `alertMoneyProblem` (`app/lib/alert.ts:110-124`), which logs first and unconditionally and puts
 * everything else inside a `try/catch` — the guarantee is real, and it lives in one function's
 * prose where the type says nothing. An email lane, a second product, or a wiring assembled in a
 * hurry supplies a throwing implementation and the thirteen sites behave exactly as above, with no
 * compile error and no test failing. The contract belongs beside the type that states it.
 *
 * **Not a per-call-site guard, deliberately.** Thirteen `try/catch` blocks around a path whose
 * implementation cannot throw is machinery for a case the code does not currently produce. One
 * wrapper at the wiring covers all thirteen and survives a future implementation that can.
 *
 * The existing guard in `compensateResidualRaceLoss` **stays** — it is there for a different
 * reason (that call runs after irreversible customer-facing work), and that reason outlives this.
 */
export function alertThatNeverThrows(
  alert: (message: string) => Promise<void>,
): (message: string) => Promise<void> {
  return async (message: string): Promise<void> => {
    try {
      await alert(message);
    } catch (e) {
      // **The whole message, not just the failure.** Swallowing quietly would turn "the office was
      // never told money moved" into an event with no artifact anywhere. An operator reading
      // runtime logs after a Twilio outage needs the alert's CONTENT — the charge id and the
      // amount — because this line is then the only record that it happened.
      logSwallowed("reservations:alertPaidButUnbooked", e, `the office was NOT told: ${message}`);
    }
  };
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
        | "refund_recorded"
        | "dispute_recorded"
        | "ignored";
    };

/**
 * What the sold-out notice needs: a loggable handle, and who to tell.
 *
 * **The contact comes off the reservation row, never off the charge (15.5).** `SPEC.md` §2.8.7
 * always said so — "the phone on the reservation; phone is required, email is not" — but the
 * code read `charge.metadata` until now, and 15.7 deletes those keys. The `metadata` field is
 * GONE rather than merely unused, because a field that still exists is one a future edit can
 * read from, and this notice reaching nobody is silent by construction.
 */
export interface SoldOutCharge {
  /** Loggable handle: the session id (hosted) or PaymentIntent id (Elements). */
  chargeRef: string;
  contact: SoldOutContact;
}

/**
 * A charge that should BOOK, normalized off either event type. The booking spine below is
 * identical for both; only the provenance fields differ (session id vs PaymentIntent id).
 */
interface BookingCharge {
  /** Booking idempotency key — the PaymentIntent id, which is also the seed for the Payment id
   *  (`pay_${key}`), the gratuity id (`grat_pre_${key}`) and the refund key (`refund_${key}`).
   *  It was "session id (hosted) OR PaymentIntent id (Elements)" until 15.19; the hosted booking
   *  path has been retired since 14.5 and is refused at the purpose dispatch, before anything
   *  builds one of these. */
  key: string;
  /**
   * **Required as of 15.19, and the requirement is the point.** Both were optional because the
   * hosted `checkout_completed` shape carries an optional `payment_intent`. That shape no longer
   * reaches here, so two branches existed for a charge that could not arrive — each alerting
   * "REFUND MANUALLY" for a case with no caller.
   *
   * `processBookingCharge` has exactly one non-test caller, `confirmBookingFromIntent`
   * (`confirm-booking.ts`), which sets this from `PaymentSucceeded.paymentIntentId` — a required
   * `string`. Typing it required is what keeps those branches from being re-added: a caller that
   * cannot supply one now fails to compile rather than landing in dead code.
   *
   * `sessionId` went with them. Two places DID read it — typecheck named both the moment it was
   * removed, which is the whole reason to delete a field rather than stop setting it — but each
   * was a conditional spread onto a row, and the condition had been false since 14.5.
   */
  paymentIntentId: string;
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
  // **Everything past here is wrapped so a failure can name the delivery that caused it (15.13).**
  //
  // The route turns any throw after a valid signature into a 500 — deliberately, so Stripe retries
  // rather than dropping a paid event — and logs `Stripe webhook processing failed: <message>`. It
  // cannot do better than that on its own: parsing happens HERE, so by the time the route catches,
  // it holds an error and no event. Stripe's Workbench meanwhile shows a delivery with an id. Two
  // records of one failure, and nothing naming both.
  //
  // **The core does not log; it puts the id where the edge's existing line will carry it.** The
  // first cut wrote a `console.error` here and lint refused it — `src/log.ts`'s rule (#902) wants
  // one shape for core logging, and `logSwallowed` is the wrong shape anyway, since its whole
  // meaning is an error that was NOT rethrown. The rule was right and the better design fell out
  // of it: one log line at the edge instead of two, and no I/O added to the core.
  //
  // **Safe for the route's 400-vs-500 split**, which reads the error's TYPE. `parseEvent` throws
  // `PaymentSignatureError` ABOVE this try, so a forged request never reaches the wrap and still
  // gets its 400. Only post-verification failures are re-thrown, and those are all 500s already.
  //
  // `cause` rather than interpolation for the original: `${e}` renders "Error: boom" and drops the
  // stack, which is the half naming the repository method and the table.
  try {
    return await routeVerifiedEvent(deps, event);
  } catch (e) {
    throw new Error(
      `[reservations:webhook] ${event.stripeEventId} (${event.type}): ` +
        `${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
}

/** The handler proper, wrapped by `processBookingWebhook` so a throw can name its delivery. */
async function routeVerifiedEvent(
  deps: WebhookDeps,
  event: NonNullable<ReturnType<PaymentPort["parseEvent"]>>,
): Promise<WebhookResult> {


  // A REFUND landed (#616) — reconcile it into the ledger. Outside the booking spine entirely:
  // money that has already gone back is recorded whatever state the booking is in.
  //
  // This is the path that makes a STRIPE DASHBOARD refund visible at all. Before it, the docs
  // told the operator to refund there and Muster never learned: the reservation kept reading
  // paid, the slot stayed booked, `balanceOwedCents` kept billing, and `/admin/purchases` kept
  // counting the revenue. It also catches Muster's own refunds a second time, harmlessly —
  // `markPaymentRefunded` takes a cumulative total, so the write is the same one
  // `refundReservation` already made.
  // `stripeEventId` is threaded in because a charge can be refunded more than once and the
  // cumulative field cannot tell the deliveries apart — see `recordChargeUnmatched`.
  if (event.type === "refund_recorded") return recordRefund(deps, event.data, event.stripeEventId);

  // A CHARGEBACK moved (issue #723) — same posture as the refund above: money that has already
  // left the account is recorded, full stop.
  if (event.type === "dispute_updated") return recordDispute(deps, event.data);

  // The inline-Elements booking. The body of this branch lives in `confirm-booking.ts` because
  // the SUCCESS PAGE runs it too (issue #827, SPEC §2.8.6): one idempotent confirm, called from
  // both, because Stripe re-delivers events processed elsewhere and a second path that books its
  // own way books the same sale twice. The DEC-134 metadata guard travels with it.
  if (event.type === "payment_succeeded") {
    return confirmBookingFromIntent(deps, event.data, { via: "webhook" });
  }

  // A DECLINED CARD — acked, and deliberately nothing else (14.8, criterion 11:
  // *"A `payment_intent.payment_failed` does **not** expire the reservation."*).
  //
  // The pending row stays exactly as it is. The customer is still inside their payment window,
  // still holding the boat, and their retry lands on that same row (14.6, §2.8.5). Cancelling it
  // here is the instinct a failed payment invites and it would be the bug: it takes the boat away
  // from somebody standing at the till with a second card out. Lapsing is the clock's job, not
  // this handler's — and if they walk away, §2.8.8's surface is where that shows up.
  //
  // Named rather than left to `parseEvent`'s null: acked-on-purpose and never-heard-of must not
  // be the same signal.
  //
  // **It records, though (issue #1051).** "Do nothing to the booking" and "keep no record" are
  // different instructions, and only the first one is criterion 11's. A decline is the fact that
  // explains everything the abandonment surface shows — a row that sat at one attempt and lapsed
  // reads identically whether the customer walked away or was refused three times.
  if (event.type === "payment_failed") {
    // One lookup, on a path that did none. A decline against one of our bookings belongs on THAT
    // booking's trail, and the intent id is the only handle either way: an intent that is not
    // ours (the bare PaymentIntent under a hosted balance session) resolves to nothing and the
    // row carries the second key alone.
    const row = await deps.repo.getReservationByPaymentIntentId(event.data.paymentIntentId);
    // **Keyed on the STRIPE EVENT, unlike every other derived id in this file, and it has to
    // be.** 15.8 reuses one PaymentIntent across retries — decline, fix the card, retry, decline
    // again is one intent id and two separate facts. Keyed on the intent, the second row would
    // collide with the first and `on conflict (id) do nothing` would drop it: the customer whose
    // card failed three times would look exactly like the one whose card failed once. The Stripe
    // event id changes per decline and is stable across redeliveries of the same decline, which
    // is precisely the property the id needs.
    //
    // `declineCode` is a provider ENUM (`card_declined`, `insufficient_funds`) read off
    // `last_payment_error.decline_code` — not a message, and it echoes nothing the customer
    // typed. That is the line the "no provider strings in metadata" rule draws.
    await recordTrail(deps, {
      id: asId<"TrailEventId">(`payment_failed:${event.stripeEventId}`),
      ...(row ? { reservationId: row.id } : {}),
      paymentIntentId: asId<"PaymentIntentId">(event.data.paymentIntentId),
      actorKind: "stripe",
      type: "payment_failed",
      ...(event.data.declineCode !== undefined
        ? { metadata: { reason: event.data.declineCode } }
        : { metadata: {} }),
    });
    return { handled: true, outcome: "ignored" };
  }

  // A retired intent (15.10), and there is nothing to do with it. Every cancel Muster makes is one
  // it already knows about — the port call returned before Stripe wrote this event — so acting on
  // it here would be acting twice. Named for the same reason as the line above: a cancel an
  // operator made in the dashboard is then a thing this code has a word for, rather than noise
  // indistinguishable from an event type we have never heard of.
  if (event.type === "payment_canceled") return { handled: true, outcome: "ignored" };

  // **A delayed payment method is settling (15.12) — acked, and the one ignored event that TELLS
  // somebody.** The two above are silent for good reasons that do not apply here: a decline leaves
  // a customer still holding a second card, and a cancel is something Muster did itself. This is a
  // booking in flight for days, with no screen anywhere showing it.
  //
  // It also cannot arrive at all unless somebody enabled a delayed payment method in the Stripe
  // Dashboard — `/book` sends `automatic_payment_methods: { enabled: true }`, so method selection
  // lives there, and a change there leaves no diff in this repository. Reading the account on
  // 2026-09-19 showed every delayed method off. This alert is how anyone finds out that changed.
  //
  // Deliberately NOT "REFUND MANUALLY": no money is at risk and there is nothing to undo. It
  // shares a channel with the paid-but-unbooked alerts and must not read like one — the same call
  // 15.5 made for the residual-race notice, on the reasoning that an alert which cries wolf is how
  // the real ones stop being read.
  //
  // **NOT deduped, and that is a known limit rather than an oversight** (`@code-review`, 15.12).
  // Every other side effect in this file is built for Stripe's at-least-once redelivery; this one
  // is not, so a redelivered `processing` pages every admin again — which is the same crying-wolf
  // noise the paragraph above argues against. It ships that way on the operator's call (2026-09-19)
  // because **this branch cannot execute today**: reading the account showed every delayed payment
  // method `off`, and only a Dashboard toggle can produce this event. Building a dedupe for an
  // unreachable path is machinery ahead of need.
  //
  // **Whoever enables a delayed method owes this a dedupe first.** The cheap one needs no
  // migration: `claimRecoverySend` (`ports/repository.ts`) is already a keyed claim with lazy
  // expiry — `"processing:" + paymentIntentId` gives exactly one alert per intent, at the cost of a
  // table named for the recovery bound doing double duty. Recorded on issue #712.
  if (event.type === "payment_processing") {
    await deps.alertPaidButUnbooked(
      `Payment ${event.data.paymentIntentId} is PROCESSING - a delayed payment method is ` +
        `settling and will confirm in a few days. Nothing to do and no money at risk. Worth ` +
        `knowing because /book takes whatever methods the Stripe Dashboard has enabled, and this ` +
        `event means one of the delayed ones is now on. No screen shows an in-flight payment.`,
    );
    return { handled: true, outcome: "ignored" };
  }

  // Everything past here is a hosted `checkout.session.completed`. The union is closed and every
  // other member returned above, so this narrows — but say it, because an event type added to the
  // port and not handled here would otherwise arrive at `completed.metadata` and throw on a shape
  // it never had.
  if (event.type !== "checkout_completed") {
    return { handled: false };
  }
  const completed = event.data;
  // Dispatch on purpose (11.2b). A balance payment records against the existing reservation;
  // it must NEVER reach the booking path (no eventId → an orphan reservation).
  const purpose = completed.metadata.purpose;
  if (purpose === "balance") return recordBalancePayment(deps, completed);
  if (purpose !== undefined && purpose !== "booking") {
    await deps.alertPaidButUnbooked(
      `Stripe checkout with unknown purpose="${purpose}" - session ${completed.sessionId}. ` +
        `NOT auto-processed; investigate (money may have moved).`,
    );
    return { handled: true, outcome: "ignored" };
  }
  // A booking-purposed hosted Checkout session. Nothing mints these since 14.5 — the live flow
  // is inline Elements (`createDeparturePaymentIntent`), which writes a `pending` row and books
  // via `payment_intent.succeeded`, flipping that row. A hosted booking session arriving here is
  // a replay from a flag-on window, a dashboard send, or a leftover, and money has moved: refuse
  // loudly, same posture as the flag-off and #613 branches. Balance and gratuity hosted sessions
  // are handled above; only a booking-shaped one reaches here.
  await deps.alertPaidButUnbooked(
    `PAID but NOT booked - hosted Checkout booking session ${completed.sessionId} ` +
      `(${completed.amountTotalCents} ${completed.currency}). The hosted booking path was retired ` +
      `(14.5); the live flow books from a pending row via payment_intent.succeeded. REFUND MANUALLY ` +
      `and find what minted a hosted booking session - nothing in the app should.`,
  );
  // The alert reaches a person today; the row is what survives the week. Keyed on the session id,
  // because that is the only handle a hosted session is guaranteed to have.
  await recordChargeUnmatched(deps, "retired_hosted_session", {
    idKey: completed.sessionId,
    chargeRef: completed.sessionId,
    paymentIntentId: completed.paymentIntentId,
  });
  return { handled: true, outcome: "unbookable" };
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
 * Money that arrived with no booking to hang it on (issue #1051).
 *
 * **Why the shape is a parameter rather than a sentence in `reason`.** These are not one
 * situation seen twice: one is a charge Muster never knew about, and one is a call that cannot
 * happen today. An operator reading a trail needs to tell "we chose not to book this" from "this
 * was never ours." (`reservations_off`, a charge refused while the `RESERVATIONS` switch was off,
 * went with the switch in issue #1093; rows already written with it stay readable as history.)
 *
 * **The shape is in the ID, and as of 15.19 that is belt-and-braces rather than load-bearing.**
 * It was load-bearing when there were four shapes: `reservations_off` and `no_payment_intent`
 * both keyed on `charge.key` and both were reachable for one charge, so without the shape the
 * second hit `on conflict (id) do nothing` and vanished. 15.19 then deleted the branch
 * `no_payment_intent` recorded — correctly, with three independent proofs it was unreachable —
 * and the three surviving shapes draw their keys from disjoint Stripe namespaces: a PaymentIntent
 * id, a session id, an event id. **So nothing can collide today, and the collision test that used
 * to prove this was deleted rather than rewritten into something that cannot fail.** The shape
 * stays in the id because "these namespaces happen not to overlap" is an invariant Stripe owns
 * and nothing here checks — and because the next shape added is the one that would collide.
 *
 * **`idKey` and `chargeRef` are separate, and the separation is the whole finding.** For three
 * of the four shapes they are the same string, and the fourth is why this is a parameter rather
 * than one field used twice: `refund_on_unknown_charge` can fire more than once for one
 * PaymentIntent, because `amountRefundedCents` is CUMULATIVE and Stripe sends the event again
 * for each additional partial refund. Two different facts, one charge. So its id keys on the
 * STRIPE EVENT — the same derivation `payment_failed` uses, for the same reason — while
 * `chargeRef` keeps naming the charge a human would go looking for. `@code-review` caught this
 * after the first cut had already written that derivation twice elsewhere in this file.
 *
 * `paymentIntentId` is absent on a charge that carries none, which is legal and is the reason
 * `TrailEvent` has two optional keys rather than one required one. `chargeRef` then carries the
 * only handle there is — a hosted session id — so the row still names something.
 *
 * Deliberately NOT emitted for `not_pending` or `unusable_row`: both resolved to a real
 * reservation, so the charge is matched and the problem is the row, not the money's provenance.
 */
type UnmatchedShape =
  /** `charge.refunded` for a PaymentIntent that matches no Payment AND no pending row of ours —
   *  a Xola-era charge, or one taken by hand in the dashboard. */
  | "refund_on_unknown_charge"
  /** A hosted Checkout booking session. Nothing has minted one since 14.5. */
  | "retired_hosted_session";

async function recordChargeUnmatched(
  deps: WebhookDeps,
  shape: UnmatchedShape,
  charge: {
    /** What makes this row unique. Must change when the FACT changes, and must NOT change on a
     *  redelivery of the same fact. Usually the charge; the Stripe event id when one charge can
     *  produce the fact more than once. */
    idKey: string;
    /** The handle a human goes looking for. Often the same string as `idKey`, and deliberately
     *  not for `refund_on_unknown_charge`. */
    chargeRef: string;
    paymentIntentId?: string | undefined;
  },
): Promise<void> {
  await recordTrail(deps, {
    id: asId<"TrailEventId">(`charge_unmatched:${shape}:${charge.idKey}`),
    ...(charge.paymentIntentId
      ? { paymentIntentId: asId<"PaymentIntentId">(charge.paymentIntentId) }
      : {}),
    actorKind: "stripe",
    type: "charge_unmatched",
    metadata: { reason: shape, chargeRef: charge.chargeRef },
  });
}


/** Options for callers that are not the signed webhook (issue #827). */
export interface ConfirmOptions {
  /**
   * Run the DEC-109 residual-race compensation — the auto-refund and the sold-out notice — when
   * the claim is lost. **True for the webhook, false for any public entry point.**
   *
   * A residual-race loss is a stable outcome: no reservation row is ever written, so every replay
   * with the same key re-derives `lost`. On a signed webhook that is fine — Stripe redelivers a
   * bounded number of times. On an unauthenticated GET it is a re-send of a customer-facing SMS
   * and email per request, and a re-attempted refund whose idempotency key expires after a day,
   * after which the failure alert texts every admin instead.
   */
  notifyOnResidualRaceLoss?: boolean;
  /**
   * Which of §2.8.6's three confirms is running, for the `booked` trail row (issue #1048).
   *
   * **The field this answers has existed unpopulated since issue #1047.** `TrailEventMetadata.via`
   * was specified as a dimension rather than three separate types, and nothing could fill it while
   * `booked` was projected from a row afterwards — the row records that it IS booked and not who
   * confirmed it. Emitting moves the decision to the one place that knows.
   *
   * Defaults to `webhook` because that is the only caller which passes no options; both real
   * entry points set it explicitly, so the default is never the answer in production.
   */
  via?: "webhook" | "success_page" | "reconciler";
}


/**
 * The residual-race compensation (`docs/SPEC.md` §2.8.7): what happens to the buyer whose payment
 * landed second. Cited to the spec on purpose — the surrounding comments in this file all say
 * "DEC-109", and that record is `status: withdrawn`, a signpost whose own ruling reads "Retired.
 * The spec replaced the checkout hold with the pending reservation." New code should not grow the
 * pile of citations to a retired decision; §2.8.7 is the live answer.
 *
 * Extracted from `processBookingCharge` in 15.5, and not only for the complexity ceiling it
 * crossed — this is one coherent job with its own rules (refund, tell them, tell the office) and
 * three exits, sitting inside a function whose job is dispatch.
 *
 * **Everything said about this customer comes off the ROW**, never the charge. The row was read
 * and proven `pending` at the top of `confirmPendingRow`; the CAS that failed was against
 * somebody else's. Before 15.5 this read `charge.metadata`, so a missing key silently degraded
 * the operator's text to "customer party of ?" — and 15.7 deletes those keys outright.
 */
/**
 * A customer-supplied name, made safe to interpolate into an operator's SMS (`/security-review`
 * on 15.5).
 *
 * **This is the first path on which a customer's own typed text reaches an admin's phone, and the
 * customer can trigger it on demand** — start a checkout, let its hold lapse, take the freed slot
 * with a second checkout, pay the second, then pay the first. The failure-path alerts below carry
 * the same string but need a refund outage, which nobody can induce. `customerName` is trimmed and
 * checked non-empty at the edge (`app/(public)/book/checkout/actions.ts`) and nothing else: no
 * length cap, no charset.
 *
 * Without this, a name reading "…PAID but NOT booked - charge pi_VICTIM. REFUND MANUALLY in
 * Stripe." forges an instruction to refund a real, unrelated charge, and the genuine
 * "no action needed" tail is pushed past where a phone truncates the preview.
 *
 * Conservative by design: names that legitimately carry other characters are degraded, not
 * rejected, and the operator still has the charge id, which is the part they act on.
 */
function safeForAlert(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 .,'-]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned.length > 40 ? `${cleaned.slice(0, 40)}...` : cleaned) || "customer";
}

/**
 * Cancel every intent on a booked row except the one that paid for it (15.10, issue #978).
 *
 * **One function so the best-effort contract lives in one place.** Each cancel is an independent
 * failure — Stripe refuses from most terminal states, and a webhook REDELIVERY re-cancels an
 * already-cancelled sibling every single time — and a throw escaping here would 500 a booking that
 * has already committed, which makes Stripe retry a completed sale for three days. That is a worse
 * outcome than the payable intent this exists to remove, so nothing in here may reject.
 *
 * `paid` is excluded by id rather than by position: it is the intent this webhook is FOR, and the
 * row's array is ordered by when each was minted, not by which one succeeded.
 *
 * **What it cannot fix**: a sibling that already succeeded. Stripe will not cancel it, the money is
 * taken, and that is the residual race — `compensateResidualRaceLoss` below still owns it. This
 * makes that path rarer rather than unreachable.
 */
async function retireSiblingIntents(
  deps: WebhookDeps,
  row: Reservation,
  paid: string | undefined,
): Promise<void> {
  const others = (row.paymentIntentIds ?? []).filter((id) => id !== paid);
  for (const id of others) {
    const retired = await deps.payments
      .cancelPaymentIntent(id, "duplicate")
      .then(() => true)
      .catch((e: unknown) => {
        // Logged before swallowing, like every other best-effort catch in this file
        // (`@code-review`). "Must not throw" and "must leave no trace" are different
        // requirements, and conflating them makes an ordinary refusal — an already-cancelled
        // sibling on a redelivery — indistinguishable from a persistent bug such as a
        // permissions error, forever. Not an operator alert: no money moved and the booking is
        // fine, so this is a log line for whoever is already looking.
        console.error(`[reservations] could not retire superseded intent ${id} on ${row.id}`, e);
        return false;
      });
    // **Only a cancel that TOOK is a supersession (issue #1051).** The refusals above are the
    // ordinary case, not the exception — a redelivery re-cancels an already-cancelled sibling
    // every single time, and Stripe refuses a sibling that already succeeded, which is the
    // residual race and the single case anybody would open this trail to check. A row asserting
    // an intent is dead while it is still chargeable is worse than no row.
    //
    // Derived id on the retired intent: an intent can be superseded exactly once, so a second
    // emit for the same id is a redelivery rather than a second fact — which is what makes the
    // adapter's `on conflict (id) do nothing` do the work here.
    if (retired) {
      await recordTrail(deps, {
        id: asId<"TrailEventId">(`payment_superseded:${id}`),
        reservationId: row.id,
        paymentIntentId: asId<"PaymentIntentId">(id),
        actorKind: "engine",
        type: "payment_superseded",
        metadata: { reason: "a sibling intent on a row that is now settled" },
      });
    }
  }
}

async function compensateResidualRaceLoss(
  deps: WebhookDeps,
  charge: BookingCharge,
  row: Reservation,
  opts: ConfirmOptions,
): Promise<WebhookResult> {
  const contact: SoldOutContact = {
    customerName: row.customerName,
    ...(row.email !== undefined ? { email: row.email } : {}),
    ...(row.phone !== undefined ? { phone: row.phone } : {}),
  };
  const who = `${safeForAlert(row.customerName)} party of ${row.partySize ?? "?"}`;
  const amount = `$${(charge.amountCents / 100).toFixed(2)}`;

  if (opts.notifyOnResidualRaceLoss === false) {
    // A public caller (issue #827). The loss is real, but the compensation is the webhook's —
    // see `confirmBookingByPaymentIntent`. Reported, not acted on.
    return { handled: true, outcome: "lost" };
  }
  try {
    // Keyed on the charge key (session id / PI id — DEC-134) ⇒ a redelivered losing-charge
    // webhook re-calls with the same key and Stripe returns the same refund (no double
    // refund, DEC-107 amended).
    await deps.payments.refund({
      paymentIntentId: charge.paymentIntentId,
      idempotencyKey: `refund_${charge.key}`,
    });
    // The one refund no human authorised (issue #1050). Actor `engine`, deliberately: an
    // operator refund and this must never read alike in the trail. Emitted after the
    // provider call returns, so a trail outage cannot stop the money going back.
    //
    // **`reservationId` was missing until issue #1051, and the module header is why.** It said a
    // `lost` outcome means no row exists; `row` is right here, still `pending`, and its name and
    // phone are what the alert below interpolates. Without this key the auto-refund never appears
    // on the trail of the booking it refunded.
    await recordTrail(deps, {
      id: asId<"TrailEventId">(`auto_refunded:${charge.key}`),
      reservationId: row.id,
      paymentIntentId: asId<"PaymentIntentId">(charge.paymentIntentId),
      actorKind: "engine",
      type: "auto_refunded",
      metadata: { reason: "residual-race loss" },
    });
    // No ledger write here, and that is the #613 change. #522 sweep 1 added a
    // `markPaymentRefunded` call so a refunded loser wasn't left reading `succeeded` — the
    // right goal, reached the wrong way: the row it marked could never exist, because its
    // reservation never existed (the comment there said as much: "it doesn't reach the
    // purchases list"). Not writing the row achieves the same goal more completely — nothing
    // to inflate a `listAllPayments` rollup and nothing to reconcile. Stripe holds the record
    // of money that never became a booking, which is what it is.
  } catch (e) {
    // The alert reaches a person now; the trail is what answers "how often does this
    // happen" three months later, which no alert can.
    await recordTrail(deps, {
      id: asId<"TrailEventId">(`refund_failed:${charge.key}`),
      // Same correction as its sibling above (issue #1051). This is the worse of the two to have
      // had unkeyed: a customer charged, not refunded, and their booking's trail silent about it.
      reservationId: row.id,
      paymentIntentId: asId<"PaymentIntentId">(charge.paymentIntentId),
      actorKind: "engine",
      type: "refund_failed",
      metadata: { reason: e instanceof Error ? e.message : "unknown error" },
    });
    await deps.alertPaidButUnbooked(
      `Residual-race loss AND the auto-refund FAILED (${e instanceof Error ? e.message : "unknown error"}) - ` +
        `Stripe charge ${charge.key}. REFUND MANUALLY in Stripe. Customer: ${who}`,
    );
    return { handled: true, outcome: "lost" };
  }
  // **This row will never book, so nothing on it may stay payable (15.10, `@code-review`).**
  //
  // The first cut retired siblings only on the BOOKED path, and missed the one row class where an
  // un-retired intent is payable *forever* rather than for a window. A residual-race loser lost the
  // hull to somebody else; its flip is refused and no later delivery can succeed. Any other live id
  // on it — an earlier mint whose best-effort cancel failed at checkout time — has no other route to
  // retirement, because nothing reaps lapsed rows (`abandonment.ts`: "Nothing deletes a lapsed row")
  // and these are the only two call sites of `cancelPaymentIntent` in the codebase.
  //
  // The just-refunded id is excluded by the same argument as the booked path, and by Stripe's rules:
  // it succeeded, so a cancel would be refused anyway.
  await retireSiblingIntents(deps, row, charge.paymentIntentId);

  // Refunded — tell the customer. Best-effort: a notify failure must not 500 (a retry would
  // re-run this path, and the keyed refund would no-op, but re-notify needlessly).
  try {
    await deps.notifyCustomerSoldOut({ chargeRef: charge.key, contact });
  } catch (e) {
    // Swallowed by contract — the refund succeeded; a missing notice is not a 500.
    // But the customer is now owed an explanation nobody gave them: their card was
    // charged, the money is coming back over days, and the only message saying so
    // did not send. The office alert below still fires, so the operator learns a
    // race happened — this line is what says the customer was not told about it.
    logSwallowed(
      "reservations:soldOutRefund",
      e,
      `the sold-out refund notice did not reach the customer for charge ${charge.key}`,
    );
  }
  // **And tell the office, every single time (15.5).** This path alerted nobody until now, on the
  // reasoning that a self-resolving outcome needs no operator. That reasoning was about ACTION and
  // it answered the wrong question. A customer was charged real money for a trip they did not get
  // and waits days for it back, and the operator is who they will phone about a charge they cannot
  // explain. It is also the only evidence of how often this race fires, which is what decides
  // whether the payment flow moves to separate authorize/capture (issue #1012) — a rewrite nobody
  // should buy on a hunch about frequency.
  //
  // Deliberately NOT "REFUND MANUALLY": this one is handled, and an alert that reads like an
  // emergency when nothing is owed is how the real emergencies stop being read.
  //
  // Guarded, unlike every other `alertPaidButUnbooked` call in this file, and the exception is
  // deliberate: this is the only one that runs AFTER irreversible customer-facing work. A throw
  // here would 500, Stripe would redeliver, and the customer would be told a second time about a
  // refund they already know about. The edge implementation writes its log line first and
  // unconditionally, so a swallowed throw still leaves the trace.
  //
  // **The customer's name goes LAST**, after the charge id and the disposition. A phone that
  // truncates the preview then cuts only the untrusted fragment, never the part saying what
  // happened and to which charge. `safeForAlert` is the other half of that, and both are needed:
  // a clamped 40 characters is still 40 characters of somebody else's prose.
  try {
    await deps.alertPaidButUnbooked(
      `SOLD OUT WHILE PAYING - charge ${charge.key} for ${amount} was auto-refunded in full. ` +
        `No action needed; the customer has been told. This should not happen - if you are ` +
        `seeing it more than rarely, say so. Customer: ${who}`,
    );
  } catch (e) {
    // Swallowed for the reason above. The edge implementation writes its log line
    // first and unconditionally, so the alert's own content is already on record —
    // what is lost here is the knowledge that the SEND failed, which is the half
    // that decides whether an operator ever saw it.
    logSwallowed(
      "reservations:soldOutRefund",
      e,
      `the office was not alerted that charge ${charge.key} was auto-refunded`,
    );
  }
  return { handled: true, outcome: "lost" };
}

/** The charge→booking spine, shared by both event paths (11.2 / 12.5). */
export async function processBookingCharge(
  deps: WebhookDeps,
  charge: BookingCharge,
  opts: ConfirmOptions = {},
): Promise<WebhookResult> {
  // The booking is the `pending` row checkout wrote (§2.8.6), found by the PaymentIntent id. The
  // only caller is the inline-Elements `payment_intent.succeeded` path, whose charge key IS that
  // id — so it is always present, which `BookingCharge` now states in the type (15.19). A hosted
  // booking session never gets this far: it is refused at the purpose dispatch above.

  // Money has already moved by the time we get here, so a metadata problem must be LOUD
  // before it is fatal. `requireCents` throws below (correctly — a 500 makes Stripe
  // retry), but a bare throw from inside the confirm argument list would run before any
  // alert: no Payment row, no notification, and Stripe gives up after ~3 days, the only
  // trace a `console.error`. That inverts this module's posture — every other
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

  // Flip the pending row (§2.8.6). Everything the booking needs is on the row — slot, party
  // size, both durations and, as of 15.6, the money. The metadata parser that used to stand here
  // is gone with the metadata it read.
  const result: ConfirmResult = await confirmPendingRow(
    deps.repo,
    charge.paymentIntentId,
    deps.now,
  );

  // **`no_row` is not a problem; it means the charge is not one of our bookings (15.6).**
  //
  // The pending row is written BEFORE Stripe is called, and the customer never receives a payable
  // client secret unless that write succeeded — so a booking payment always has a row to find.
  // "No row" therefore means somebody else's payment, and the commonest one is routine: the
  // PaymentIntent underneath every hosted Checkout Session, which `stripe-payment.ts` leaves
  // metadata-less on purpose. A balance top-up or a post-trip tip fires one alongside its own
  // `checkout.session.completed`.
  //
  // The `purpose` gate used to drop those before any lookup. Deleting it (the charge sends no
  // metadata now) moved the filter here, and `@code-review` caught that the first cut alerted
  // instead — which would have paged every admin with REFUND MANUALLY on every balance payment.
  // Acked and ignored, exactly as the `purpose` gate did.
  if (result.outcome === "unconfirmable" && result.reason === "no_row") {
    return { handled: false };
  }
  // `not_pending` IS a problem: the row exists and is not bookable, so a payment landed against a
  // cancelled reservation. Money moved and a human has to decide what happens to it.
  if (result.outcome === "unconfirmable") {
    await deps.alertPaidButUnbooked(
      `PAID but NOT booked - charge ${charge.key} (${charge.amountCents} ${charge.currency}) ` +
        `resolved to a reservation that cannot be booked (${result.reason}). REFUND MANUALLY if ` +
        `unrecognised; investigate either way.`,
    );
    return { handled: true, outcome: "unbookable" };
  }

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
    const reservationId = result.reservation.id;

    // ── The trail: a boat was sold (issue #1048) ──────────────────────────────
    //
    // **The event this whole product exists to produce**, and it had no row until now — it was
    // projected from `reservations.status`, which persists that a booking IS booked and never
    // when it became so, because `updated_at` is overwritten by the next write.
    //
    // **`booked` only, never `already`, and this guard is LOAD-BEARING** — the first version of
    // this comment called it belt-and-braces behind the derived id, and `@code-review` found the
    // case that makes it false. `confirmPendingRow` resolves `already` for ANY row that is
    // already `booked`, including every booking made before this emitter shipped — and those
    // have no `booked:<id>` row for a derived id to collide with. Drop this check and the first
    // redelivery against an old booking inserts a `booked` row **backdated to whenever Stripe
    // happened to retry**, which is the opposite of the no-backfill posture this task ships
    // under (DEC-118: capture starts at ship).
    //
    // First in this block, before `recordPayment` — which is deliberately unwrapped, so a throw
    // there makes Stripe redeliver, `confirmPendingRow` resolve `already`, and this branch never
    // run again. The ledger heals on the retry; a missing `booked` row would not.
    if (result.outcome === "booked") {
      await recordTrail(deps, {
        id: asId<"TrailEventId">(`booked:${String(reservationId)}`),
        reservationId,
        ...(charge.paymentIntentId
          ? { paymentIntentId: asId<"PaymentIntentId">(charge.paymentIntentId) }
          : {}),
        // `admin` when an operator sold it — which is what `admin_booked` was a whole type for
        // until issue #1048 folded it into this dimension. From the confirm's `soldBy`, never
        // `result.reservation.source`: the flip has already turned an `admin` row into `muster`
        // (16.1), so this row is the only place who sold it survives.
        actorKind: result.soldBy,
        type: "booked",
        metadata: { via: opts.via ?? "webhook" },
      });
    }

    // **The sale is made, so nothing else on this row may still be payable (15.10).** §2.8.5 keeps
    // every id the checkout minted so a superseded one that succeeds late still RESOLVES here —
    // that is about findability and was never a licence to leave them chargeable. SPEC's own answer
    // for one that gets paid afterwards is "refund it and tell the customer": a charge, a refund
    // and an apology for something that should not have been possible.
    //
    // After the flip, never before it. Cancelling first would kill a payable intent on the strength
    // of a booking that might then fail to commit.
    await retireSiblingIntents(deps, result.reservation, charge.paymentIntentId);

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
      // #999: the one vessel-day this booking landed on. Read off the EVENT — `Reservation`'s
      // slot fields are optional (a Xola row carries none) and the event is what formation keys
      // on. `confirmPendingRow` has already materialised it (§2.8.2), so it is there.
      //
      // **This is the call the comment above argued must stay unscoped, and the argument is now
      // answered elsewhere.** An unscoped re-form here was how a crew member dropped from an
      // UNRELATED shift got told — real, and no longer this call's job: the cron tick's
      // `reformWindow` sweeps and relays on the same contract. Narrowing here without that pass
      // in place WOULD have silently stopped those notices.
      const bookedEvent = await deps.repo.getEvent(eventIdOfBooked(result.reservation));
      const form = await formShifts(
        deps.repo,
        bookedEvent ? [{ vesselId: bookedEvent.vesselId, date: bookedEvent.date }] : [],
        { now: new Date(deps.now()), notifyTripChanges: true },
      );
      await relayAndAudit(deps, form);
      // #957: this is the bug's own site. One unmanned vessel six weeks out used to abort the
      // whole run, so this booking's own vessel-day never formed — sold, paid, no crew, no row
      // on the board. Those days now land here while every other vessel-day still forms. They
      // still have no shift, so somebody has to look; making that reach a person is #1001.
      if (form.failures.length > 0) {
        console.error(
          `[reservations] booking ${reservationId}: ${form.failures.length} vessel-day(s) failed to form`,
          form.failures.map((f) => ({ vesselId: f.vesselId, date: f.date, error: String(f.error) })),
        );
      }
    } catch (e) {
      // Since #957 only a failure OUTSIDE the per-vessel-day loop reaches here — reading the
      // event or shift set, not deriving any one day. Nothing formed, so there is nothing to
      // relay, and the `PartialFormError` branch that used to relay it has no case left.
      //
      // The message no longer promises the tick will re-form. It was false about the notices
      // when written (#766), and it is false about the shifts too: the tick calls this same
      // function against this same repo and fails the same way.
      logSwallowed(
        "reservations:formShifts",
        e,
        `booking ${reservationId} is paid and booked, but no vessel-day formed — nobody is rostered`,
      );
    }
    // **A CLAIM on the row, not a check of it (15.3, issue #971).**
    //
    // This was `if (result.outcome === "booked")`, whose comment read "never the idempotent
    // `already` … or the customer gets re-texted on every retry". Avoiding the double send was
    // right; inferring it from the outcome was not. Any failure between the flip committing and
    // this line made the provider redeliver, `confirmPendingRow` resolve `already`, and the gate
    // false FOREVER — charged, booked, never told, nothing alerting.
    //
    // The outcome cannot answer "has this customer been told?", because it describes only what
    // THIS delivery did, and three paths reach here: this webhook, `/book/success` (a public
    // repeatable GET running the same confirm), and §2.8.9's reconciler.
    //
    // **But a read-then-send is not enough either, and the first cut of this got that wrong.**
    // The webhook and `/book/success` race for every ordinary booking — seconds apart, by design
    // — so both could read "nobody told" before either wrote, and both would send. The gate this
    // replaced could not do that: `outcome === "booked"` was true only for the caller that won
    // the atomic flip. `claimConfirmationSend` restores that guarantee at the send instead of the
    // flip: one conditional statement, one winner.
    //
    // **Claim, send, release on failure.** Releasing matters — a claim held over a send that
    // never happened records a confirmation nobody received, which is this defect in better
    // clothes. What release cannot cover is the process dying between the two; that window is
    // milliseconds where the old one was the whole downstream block.
    if (await deps.repo.claimConfirmationSend(reservationId, deps.now())) {
      // Structurally best-effort: the booking is committed, so a confirmation failure — from a
      // channel OR from anything upstream in the injected dep — must never bubble to a 500 (the
      // provider would retry the whole webhook).
      let told = false;
      try {
        told = await deps.sendConfirmation(result.reservation);
      } catch (e) {
        // The dep's contract says it never throws; this is the belt for a dep that breaks it.
        // Logged rather than only counted: `told = false` releases the claim so the next
        // caller retries, which means a dep throwing every time produces an endless quiet
        // retry loop and a customer who is never told. This line is what distinguishes
        // that from a channel that is merely down for a minute.
        logSwallowed(
          "reservations:sendConfirmation",
          e,
          `the confirmation dep threw for booking ${reservationId}, against its own contract`,
        );
        told = false;
      }
      // **Give the claim back when nobody was told**, so the next caller — a provider redelivery,
      // the success page, §2.8.9's reconciler — can claim and try. Holding a claim over a send
      // that did not happen records a confirmation the customer never received, which is this
      // task's own defect wearing better clothes.
      // Swallowed deliberately: the booking is committed, and letting a failed
      // cleanup escape would 500 the webhook and make Stripe redeliver the whole
      // thing. But it must not be SILENT — if the release fails the claim stays
      // held, which records a confirmation the customer never received, and that is
      // precisely the state this claim/release pair exists to prevent.
      if (!told) {
        await deps.repo
          .releaseConfirmationSend(reservationId)
          .catch((e: unknown) =>
            logSwallowed(
              "reservations:releaseConfirmationSend",
              e,
              `booking ${reservationId} is marked as confirmed but nobody was told — the claim is stuck`,
            ),
          );
      }
    }

    // Record the PRE-gratuity (DEC-124) — crew money, keyed to the event pool. Slot
    // bookings only carry a tip.
    //
    // Runs on `already` as well as `booked`, and MUST. Idempotency here is the
    // deterministic id plus `on conflict (id) do nothing`, not the outcome gate — a
    // redelivery cannot double-record whichever branch it lands in. Gating on `booked`
    // (as the confirmation legitimately does) made the tip unrecoverable instead: if
    // anything after the booking commit throws — this write, or the ledger record now BELOW it —
    // the webhook 500s, Stripe redelivers, `writeSlotBooking` short-circuits to `already`,
    // and the `booked` branch is false forever. The result was silent: `Payment.gratuityCents`
    // still nets out of the customer's balance, so nothing looks wrong, but `splitGratuity`
    // builds the crew pool from `Gratuity` rows alone — so the tip stays in the operator's
    // Stripe account and the crew is never paid it (#522 sweep 1).
    //
    // The tip and its tier come off the ROW's frozen invoice as of 15.6, like every other money
    // number here. They used to be read from the charge's metadata, which is money arriving from
    // outside to decide what the crew is paid.
    const invoice = result.reservation.invoice;
    const gratuityCents = invoice?.gratuityCents ?? 0;
    if (gratuityCents > 0) {
      await deps.repo.saveGratuity({
        id: asId<"GratuityId">(`grat_pre_${charge.key}`),
        // Just flipped to `booked` by `confirmPendingRow`, so its event exists (§2.8.2).
        eventId: eventIdOfBooked(result.reservation),
        reservationId: result.reservation.id,
        kind: "pre",
        amountCents: gratuityCents,
        ...(invoice?.gratuityBps !== undefined ? { bps: invoice.gratuityBps } : {}),
        // No `stripeCheckoutSessionId`: this row's reconciliation handle is the PI id baked
        // into its deterministic id. The hosted spread here was a no-op from 14.5 (15.19).
        createdAt: deps.now(),
      });
    }

    // **The ledger goes LAST, and it still throws (15.3, DEC-169).**
    //
    // It used to run first, immediately after the flip, uncaught — so a Neon blip here 500'd the
    // webhook before the confirmation was even attempted. The customer had paid, had a boat, and
    // waited on a Stripe retry to be told.
    //
    // Ordering is free because every write after the flip is individually idempotent: `formShifts`
    // is diff-gated, the confirmation is row-gated as of this task, `saveGratuity` and
    // `savePayment` are both `on conflict (id) do nothing` on deterministic ids. So the rule is
    // simply: the people first, the bookkeeping last.
    //
    // **Deliberately NOT wrapped.** A throw here is the right outcome — Stripe's three-day
    // redelivery is the cheapest durable retry available and it is already wired, and
    // `recordPayment` runs on `already` too, so the retry heals the row. Swallowing it would
    // trade a self-healing gap for a permanently missing ledger row, and `balanceOwedCents` reads
    // payments — a missing one makes a paid booking look unpaid.
    // Deposit or full, DERIVED from the row rather than taken from a metadata key (15.6): the
    // invoice says what the whole trip costs and what we asked for now, and a charge for less
    // than the total is a deposit by definition.
    const kind =
      invoice !== undefined && invoice.amountDueNowCents < invoice.totalCents ? "deposit" : "full";
    await recordPayment(deps, charge, kind, reservationId, invoice);

    return { handled: true, outcome: result.outcome };
  }

  // The DEC-109 RESIDUAL RACE (`lost`): a hold expired mid-payment, another buyer took the
  // freed slot and paid first, and this payment then completed. Both captured money, one won
  // the atomic claim. The money moved, and is NOT recorded here (#613 — no reservation to
  // reference). AUTO-REFUND the loser + tell them
  // "sold out while you were paying" (DEC-107 amended, 12.1b). The loud manual-refund alert
  // is the FALLBACK, only when the refund can't run programmatically.
  if (result.outcome === "lost") {
    return compensateResidualRaceLoss(deps, charge, result.reservation, opts);
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
  // `confirmPendingRow` returns `booked` / `already` / `unconfirmable` / `lost`, all handled
  // above, so control never reaches here — TypeScript narrows `result` to `never`. The throw
  // satisfies the compiler's return check and fails loudly if the union grows a variant nobody
  // handles here.
  throw new Error(
    `unreachable: unhandled confirmPendingRow outcome ${JSON.stringify(result)} for charge ${charge.key}`,
  );
}

/**
 * Relay + audit a re-form's crew transitions. Each leg is independently best-effort: the booking
 * is committed and PAID, so neither a channel hiccup nor an audit write may 500 the webhook — and
 * a relay failure must not skip the audit, or vice versa. Same posture as the cron edge's
 * `relayAsks` / `forwardBoardAlerts` pair.
 */
async function relayAndAudit(deps: WebhookDeps, form: FormResult): Promise<void> {
  try {
    await deps.relayFormNotices?.(form);
  } catch (e) {
    logSwallowed("reservations:relayFormNotices", e, "crew may not have been told about a booking");
  }
  try {
    // Actor `engine`: nobody pressed anything. The booking webhook is autonomous (DEC-118).
    await logFormAudit(deps.repo, form, { kind: "engine" }, new Date(deps.now()));
  } catch (e) {
    logSwallowed("reservations:formAudit", e, "the shift transition is unrecorded in the audit log");
  }
}

async function recordPayment(
  deps: WebhookDeps,
  charge: BookingCharge,
  kind: "full" | "deposit",
  reservationId: ReservationId,
  /** The row's frozen quote (15.6). The carve-outs below used to come from Stripe metadata. */
  invoice: BookingInvoice | undefined,
): Promise<void> {
  // Stripe's hosted receipt (#679), for the guest's manage page. Best-effort by construction:
  // a receipt link is a convenience and the payment row is the ledger, so a provider hiccup
  // here must cost the link and nothing else. Not alerted — there is no money problem and
  // nothing for a human to do about it.
  let receiptUrl: string | undefined;
  try {
    receiptUrl = await deps.payments.getReceiptUrl(charge.paymentIntentId);
  } catch (e) {
    // Stays best-effort — the payment row is the ledger and the receipt link is a
    // convenience, so this must cost the link and nothing else. Logged because the
    // guest's manage page will show no receipt and nothing else explains why.
    logSwallowed(
      "reservations:receiptUrl",
      e,
      `no Stripe receipt link on the manage page for charge ${charge.key}`,
    );
    receiptUrl = undefined;
  }

  const payment: Payment = {
    id: paymentIdFor(charge.key), // deterministic ⇒ idempotent upsert
    reservationId,
    method: "stripe",
    kind,
    amountCents: charge.amountCents,
    // Every carve-out off the ROW's frozen invoice (15.6), not the charge's metadata. These are
    // what `balanceOwedCents` nets out, so a number arriving from outside decides what a customer
    // still owes — which is the whole reason DEC-164 put the quote on our own row.
    taxCents: invoice?.taxCents ?? 0,
    // The gratuity bundled into amountCents (DEC-124) — carved out so balanceOwedCents nets it.
    ...((invoice?.gratuityCents ?? 0) > 0 ? { gratuityCents: invoice!.gratuityCents } : {}),
    // The service fee bundled into amountCents (DEC-134) — same carve-out, same reason.
    ...((invoice?.serviceFeeCents ?? 0) > 0 ? { serviceFeeCents: invoice!.serviceFeeCents } : {}),
    currency: charge.currency,
    // `stripeCheckoutSessionId` is not set on this path and its spread was a no-op from 14.5
    // (15.19). The balance path sets it directly from its own session.
    stripePaymentIntentId: charge.paymentIntentId,
    ...(receiptUrl !== undefined ? { receiptUrl } : {}),
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
  /** This delivery's Stripe event id. The ledger write does not need it — `markPaymentRefunded`
   *  takes a cumulative total, so redelivery and a second partial refund are the same write — but
   *  the trail row below does, because for the trail they are two different facts. */
  stripeEventId: string,
): Promise<WebhookResult> {
  const payment = await deps.repo.getPaymentByIntentId(refund.paymentIntentId);
  if (!payment) {
    // **"No payment" has two causes, and only one of them wants a human (15.5).**
    //
    // A residual-race loser is auto-refunded and deliberately gets no payment row — #613, because
    // there is no booking to hang it on. Stripe then sends `charge.refunded` for our own refund,
    // and this reconciler read the missing row as "a charge Muster never recorded". The operator
    // got "No action needed" and "RECONCILE MANUALLY" about the same PaymentIntent, seconds apart.
    // Found by staging the real race in the app; no test and no dev script would have shown it,
    // because both stop at the refund.
    //
    // The reservation carrying this intent id is what tells them apart. It exists and is still
    // `pending` for our own loser (the flip never happened), and does not exist at all for a
    // Xola-era or hand-taken charge — which keeps its alert, because that one really is money
    // moving outside Muster.
    const ownLoser = await deps.repo.getReservationByPaymentIntentId(refund.paymentIntentId);
    if (ownLoser?.status === "pending") return { handled: true, outcome: "refund_recorded" };
    await deps.alertPaidButUnbooked(
      `Refund of ${refund.amountRefundedCents} cents recorded in Stripe for payment intent ` +
        `${refund.paymentIntentId}, which matches NO payment in Muster. The ledger is unchanged; ` +
        `RECONCILE MANUALLY (this is expected for a Xola-era or hand-taken charge).`,
    );
    // AFTER the `ownLoser` guard above, deliberately. Our own residual-race refund also finds no
    // payment row — on purpose (#613) — and it is already recorded as `auto_refunded`. Calling it
    // unmatched would be the 15.5 defect again in a new place: two records of one refund saying
    // opposite things about whether Muster knows where the money went.
    // **Keyed on the DELIVERY, not the charge** (`@code-review`). A Xola-era charge refunded in
    // two parts sends this event twice with two cumulative totals — two facts about one intent,
    // and keying on the intent would drop the second silently. `chargeRef` still names the
    // charge, because that is what somebody reconciling a statement searches for.
    await recordChargeUnmatched(deps, "refund_on_unknown_charge", {
      idKey: stripeEventId,
      chargeRef: refund.paymentIntentId,
      paymentIntentId: refund.paymentIntentId,
    });
    return { handled: true, outcome: "refund_recorded" };
  }
  await deps.repo.markPaymentRefunded(payment.id, refund.amountRefundedCents);

  // ── The trail: money confirmed back (issue #1048) ───────────────────────────
  //
  // **The only record a DASHBOARD refund will ever have.** `refunded` was projected from
  // `payments.refunded_cents`, which is a cumulative total with no clock — so the entry was dated
  // from the charge, possibly months earlier, and two partial refunds collapsed into one.
  //
  // Distinct from `refund_issued_by_operator` and `auto_refunded`, which record a DECISION taken
  // inside Muster. This records the provider confirming money moved, so an operator's in-app
  // refund gets both the decision and its settlement — different facts, different actors, not a
  // dual-write.
  //
  // **It does NOT fire for the residual-race auto-refund, and that is deliberate** — an earlier
  // version of this comment claimed it fired "for all three" and `@code-review` caught that the
  // code says otherwise. A loser has no `Payment` row at all (#613, nothing to hang one on), so
  // the lookup above returns null and the `ownLoser` guard returns before this line. Correct
  // rather than a gap: for that one path the decision and the settlement ARE the same event —
  // Muster called `refund()` and Stripe echoed it back — so `auto_refunded` is the whole story
  // and a second row would say the money came back twice.
  //
  // Keyed on the STRIPE EVENT, like `payment_failed` and for the same reason: one charge can be
  // refunded in parts, `amountRefundedCents` is cumulative, and keying on the intent would drop
  // every refund after the first.
  //
  // AFTER the ledger write. The trail records what happened; it does not decide whether it did.
  await recordTrail(deps, {
    id: asId<"TrailEventId">(`refunded:${stripeEventId}`),
    reservationId: payment.reservationId,
    paymentIntentId: asId<"PaymentIntentId">(refund.paymentIntentId),
    actorKind: "stripe",
    type: "refunded",
    metadata: { actualCents: refund.amountRefundedCents },
  });
  return { handled: true, outcome: "refund_recorded" };
}

/**
 * Which trail event each dispute state emits (issue #1050). `null` for `live`, whose fact
 * is DERIVED from `payments.status` reading `disputed` — DEC-118, one source per fact.
 *
 * The other four are store-only for different reasons. `inquiry` carries a response
 * deadline only a human can meet and touches no money, so nothing in the ledger ever
 * records that it happened. `won` returns the row to `succeeded`, which erases the
 * argument afterwards. `unknown` is the sharp one: the SDK cannot tell whether money
 * moved, so the ledger is deliberately NOT written — leaving an alert and, until now,
 * no durable record of an amount that may have left the account.
 */
const DISPUTE_TRAIL_TYPE: Record<DisputeUpdated["state"], EmittedTrailType | null> = {
  inquiry: "dispute_inquiry",
  live: null,
  lost: "dispute_lost",
  won: "dispute_won",
  unknown: "dispute_unknown",
};

/**
 * One dispute state → one trail row. `reservationId` is absent when the charge matches no
 * payment in Muster, which is legal and is why the trail has two keys.
 *
 * The id is `<type>:<payment intent>`, deterministic so a redelivered dispute webhook
 * collides on the primary key and is dropped rather than writing a second row — the
 * adapter's `on conflict (id) do nothing` is worth nothing against a random id.
 */
async function recordDisputeTrail(
  deps: WebhookDeps,
  dispute: DisputeUpdated,
  reservationId: ReservationId | undefined,
): Promise<void> {
  const type = DISPUTE_TRAIL_TYPE[dispute.state];
  if (!type) return;
  await recordTrail(deps, {
    id: asId<"TrailEventId">(`${type}:${dispute.paymentIntentId}`),
    ...(reservationId ? { reservationId } : {}),
    paymentIntentId: asId<"PaymentIntentId">(dispute.paymentIntentId),
    actorKind: "stripe",
    type,
    metadata: { reason: dispute.reason },
  });
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
    // A dispute on a charge Muster never recorded — Xola-era, or hand-taken. There is no
    // payment row and no reservation, so the PaymentIntent is the only thing that names
    // it. Stripe's dashboard and this row are the entire record that it happened.
    await recordDisputeTrail(deps, dispute, undefined);
    return { handled: true, outcome: "dispute_recorded" };
  }

  const write = DISPUTE_LEDGER_WRITE[dispute.state];
  if (write) await deps.repo.markPaymentDisputed(payment.id, write);

  // AFTER the ledger write, never before and never inside it (issue #1050). The trail
  // records what happened; it does not get to decide whether it happened.
  await recordDisputeTrail(deps, dispute, payment.reservationId);

  await deps.alertPaidButUnbooked(
    dispute.state === "unknown"
      ? `Stripe dispute on ${money} for reservation ${payment.reservationId} reported a status ` +
          `this deploy does not recognise. The ledger was NOT changed because we cannot tell ` +
          `whether the money moved. CHECK STRIPE, and update the Stripe SDK.`
      // eslint-disable-next-line sonarjs/no-nested-conditional -- baselined, lift to a named function (#928)
      : dispute.state === "inquiry"
      ? `Stripe INQUIRY (reason: ${dispute.reason}) on ${money} for reservation ` +
          `${payment.reservationId}. No money has moved and the booking still stands, but this ` +
          `is the warning before a chargeback. RESPOND IN STRIPE before the deadline.`
      // eslint-disable-next-line sonarjs/no-nested-conditional -- baselined, lift to a named function (#928)
      : dispute.state === "won"
        ? `Stripe dispute WON on ${money} for reservation ${payment.reservationId}. The funds ` +
            `are back and the payment reads as paid again.`
        // eslint-disable-next-line sonarjs/no-nested-conditional -- baselined, lift to a named function (#928)
        : `Stripe DISPUTE ${dispute.state === "lost" ? "LOST" : "OPENED"} (reason: ` +
            `${dispute.reason}) on ${money} for reservation ${payment.reservationId}. The ` +
            `funds are OUT of the account and this booking no longer counts as paid` +
            // eslint-disable-next-line sonarjs/no-nested-conditional -- baselined, lift to a named function (#928)
            `${dispute.state === "lost" ? ". This is final." : ". RESPOND IN STRIPE."}`,
  );
  return { handled: true, outcome: "dispute_recorded" };
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

  // A pending row has no event (§2.8.2); the payment is already recorded above and must not
  // be lost to a throw, so it falls through to the same alert as an unpriced or cancelled one.
  const event = reservation.eventId === null ? undefined : await deps.repo.getEvent(reservation.eventId);
  if (!isBooked(reservation) || event?.price === undefined) {
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
