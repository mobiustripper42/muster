/**
 * Operator-initiated refund (#616) — the second half of "make the customer whole", and the
 * first refund in this codebase that a human decides the amount of.
 *
 * **Why one amount splits across rows.** The operator types a single figure at the booking,
 * because "cancel for so many reasons and who knows what the refund amount might be" — a
 * policy-derived number is a prefill, not an answer. But there is no total at Stripe to refund
 * from: money arrived as separate charges (a deposit booking is two PaymentIntents, potentially
 * two cards), `refund()` takes a `paymentIntentId`, and Stripe caps each refund at that charge's
 * own amount. So the typed figure is translated into per-charge calls here. **Newest charge
 * first** — unwinding in the reverse of the order money arrived is the only ordering an operator
 * can predict without being shown the split. In full-payment mode, which is one charge, the
 * split does nothing.
 *
 * **Planned in full before the first call.** Every allocation is validated — enough refundable
 * money, a PaymentIntent on every row it must draw from — before any money moves, so an
 * impossible request is refused whole instead of discovered halfway with two refunds already
 * issued and no way to tell the operator which half landed.
 *
 * **Since issue #1278 a refund is a refund record first.** The record is written before Stripe is
 * asked, its legs are saved before the first call, each leg is sent under a key taken from the
 * record, and the record is finished only once the result is written. `sendRefundRecord` below is
 * the one function in the codebase that calls the payment port's `refund`: the operator's box, a
 * cancel's press and the job (`finishUnfinishedRefunds`) all send through it, so they cannot differ.
 * The record is the lock too — one unfinished record per booking — which replaced the refund lease.
 *
 * **Amended posture (DEC-107).** Refunds were "manual in the Stripe dashboard" with one
 * programmatic exception (the DEC-109 residual-race auto-refund). They stay operator-discretion;
 * what changes is that the operator can now exercise that discretion in Muster, and either route
 * reconciles — a dashboard refund lands via the `charge.refunded` webhook.
 */
import { randomUUID } from "node:crypto";
import {
  isBooked,
  type Payment,
  type RefundLeg,
  type RefundRecord,
  type Reservation,
} from "../domain/entities.js";
import { asId, type ReservationId, type RefundRecordId } from "../domain/ids.js";
import { logSwallowed } from "../log.js";
import { PaymentIndeterminateError, type PaymentPort, type ProviderRefund } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { safeForAlert } from "./alert-text.js";
import { formatCents } from "./calendar-detail.js";
import { noticeRefundOf, tellSafely, type TellCustomer } from "./cancel-notice.js";
import { countsAsPaid } from "./payment-config.js";
import { recordTrail } from "./trail.js";

export interface RefundDeps {
  repo: Repository;
  payments: PaymentPort;
  now: () => string;
  /** Text every active admin, with a link when there is one. Must not reject; the send guards it anyway. */
  alert: (message: string, href?: string) => Promise<void>;
  /** Tell the customer their cancel's outcome (AC15). Absent tells nobody. */
  tellCustomer?: TellCustomer;
}

/** A press's record is its own for this long; after it, the job may take it over (AC13). The pages
 *  and route that host a send cap at 60 seconds, so a claim this old belongs to a dead run. */
export const REFUND_TAKEOVER_AFTER_MS = 5 * 60_000;
/** How long Stripe keeps an idempotency key. A record this old is given up: sending it again could
 *  move the money twice (AC23). */
export const REFUND_GIVE_UP_AFTER_MS = 24 * 60 * 60_000;

export type RefundOutcome =
  | { ok: true; refundedCents: number; legs: RefundLeg[] }
  | {
      ok: false;
      reason:
        | "reservation_missing"
        | "not_muster"
        | "not_booked"
        | "invalid_amount"
        | "exceeds_refundable"
        | "no_payment_intent"
        | "stale"
        /** Whether the refund moved is not known: the record stays unfinished and the job decides. */
        | "unknown"
        /** The booking already has an unfinished refund; nothing was inserted or sent. */
        | "unfinished";
    }
  | {
      /** The provider refused a leg. Whatever DID move is recorded and reported. */
      ok: false;
      reason: "provider_error";
      refundedCents: number;
      legs: RefundLeg[];
      message: string;
    };

/**
 * What one charge can still give back: Stripe's real ceiling, `amountCents` minus what has
 * already gone back.
 *
 * **`quoteCancelRefund` now computes from this same base** (#797). It used to quote a fare-only
 * figure — gratuity and the service fee carved out — which made the suggestion and the limit two
 * different numbers. The published terms name one deduction, the $50 customer cancellation fee,
 * so the quote applies that and nothing else; on the operator branch the quote and this ceiling
 * are the same number, which is what "a full refund" means.
 */
function refundableOn(p: Payment): number {
  if (!countsAsPaid(p)) return 0;
  return Math.max(0, p.amountCents - (p.refundedCents ?? 0));
}

// Moved to `dollars.ts` (16.5) so a client form can parse the same way; re-exported for callers.
export { parseDollarsToCents } from "./dollars.js";

/** Total already handed back on this booking — the compare-and-swap token. */
export function refundedTotalFor(payments: readonly Payment[]): number {
  return payments.reduce((sum, p) => sum + (p.refundedCents ?? 0), 0);
}

/**
 * The most this booking can still give back — the ceiling the operator's box is capped at,
 * and the same number `planRefund` plans against, so the form can never offer an
 * amount the action will refuse as `exceeds_refundable`.
 */
export function refundableTotalFor(payments: readonly Payment[]): number {
  return payments.reduce((sum, p) => sum + refundableOn(p), 0);
}

/** The sum of `cents` over the legs whose outcome is `moved` — the one meaning of "what moved". */
export function movedCentsOf(legs: readonly RefundLeg[]): number {
  return legs.reduce((sum, l) => sum + (l.outcome === "moved" ? l.cents : 0), 0);
}

/**
 * Plan a refund of `amountCents`, drawing from the booking's charges newest-first. Pure.
 *
 * `expectedRefundedCents` is the booking's total refunded amount **as the operator's screen was
 * rendered**. It is a compare-and-swap, and it is what makes a double-submit safe: Stripe's
 * idempotency key cannot help, because a second press computes a genuinely different split
 * (cumulative $100 → $200) and therefore keys differently, and a disabled button is not a guard for
 * a no-JS form post. A stale token means someone — or the same person, twice — already moved money
 * since this screen was drawn, so the request is refused and the operator re-reads the page.
 *
 * **Planned in full, before anything is written or sent.** Every leg is validated — enough
 * refundable money, a PaymentIntent on every row it must draw from — so an impossible request is
 * refused whole instead of discovered halfway with a refund already issued.
 */
export function planRefund(
  payments: readonly Payment[],
  amountCents: number,
  expectedRefundedCents: number,
): { ok: true; legs: RefundLeg[] } | { ok: false; reason: "stale" | "exceeds_refundable" | "no_payment_intent" } {
  if (refundedTotalFor(payments) !== expectedRefundedCents) return { ok: false, reason: "stale" };

  // Newest first. `createdAt` is ISO-8601 UTC text throughout this schema, so lexicographic
  // ordering is chronological; the payment id breaks a tie deterministically so two charges
  // stamped in the same millisecond don't allocate differently between adapters.
  const ordered = [...payments].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || String(b.id).localeCompare(String(a.id)),
  );

  const legs: RefundLeg[] = [];
  let remaining = amountCents;
  for (const p of ordered) {
    if (remaining <= 0) break;
    const available = refundableOn(p);
    if (available <= 0) continue;
    const cents = Math.min(available, remaining);
    // Refuse BEFORE moving anything. A row with no PaymentIntent (hand-reconciled, or a legacy
    // pre-DEC-134 row) has nothing for Stripe to refund against, and discovering that after
    // the newer charge has already been refunded leaves the operator half-done.
    if (!p.stripePaymentIntentId) return { ok: false, reason: "no_payment_intent" };
    legs.push({
      paymentIntentId: p.stripePaymentIntentId,
      paymentId: p.id,
      cents,
      refundedTotalCents: (p.refundedCents ?? 0) + cents,
    });
    remaining -= cents;
  }
  if (remaining > 0) return { ok: false, reason: "exceeds_refundable" };
  return { ok: true, legs };
}

/** Who asked for a refund, and why. */
export interface RefundActor {
  reason: RefundRecord["reason"];
  actorKind: RefundRecord["actorKind"];
  actorId?: string;
}

/** What sending one record ended in. */
export type SendOutcome =
  | { state: "whole"; movedCents: number; told?: string }
  | {
      state: "short";
      movedCents: number;
      askedCents: number;
      cause: "plan_refused" | "provider_refused" | "gave_up";
      reason: string;
      told?: string;
    }
  | { state: "unknown" };

/**
 * Refund `amountCents` against a booking from the operator's box (issue #1278): check the plan, write
 * an unfinished record, send it.
 *
 * The plan is checked BEFORE anything is written (AC28), so a fat-fingered amount does not lock the
 * booking. The booking's unfinished record, if it has one, is found only at the insert (AC10) — the
 * insert is what the partial unique index guards, so it is the one answer that cannot be raced.
 *
 * Rejects when the insert throws: nothing was written and nothing sent, and the box says so.
 */
export async function refundReservation(
  deps: RefundDeps,
  reservationId: ReservationId,
  amountCents: number,
  expectedRefundedCents: number,
  by: RefundActor,
): Promise<RefundOutcome> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }
  const reservation = await deps.repo.getReservation(reservationId);
  if (!reservation) return { ok: false, reason: "reservation_missing" };
  // Xola holds its own money (DEC-105) — there is nothing here to hand back.
  if (reservation.source !== "muster") return { ok: false, reason: "not_muster" };
  // §2.8.10: a refund is money that was taken going back. Allow-list (§2.8.1): `booked`, and
  // `cancelled` because cancel-then-refund is the flow. A `pending` row is refused on status
  // and never on the money — once 14.6 records a declined attempt's payment id on the row, a
  // pending row CAN carry payment rows, and none of them is a taken charge.
  const refundable = isBooked(reservation) || reservation.status === "cancelled";
  if (!refundable) return { ok: false, reason: "not_booked" };

  const plan = planRefund(await deps.repo.listPaymentsForReservation(reservationId), amountCents, expectedRefundedCents);
  if (!plan.ok) return { ok: false, reason: plan.reason };

  const id = asId<"RefundRecordId">(`rr_${randomUUID()}`);
  const { created } = await deps.repo.createRefundRecord({
    id,
    reservationId,
    reason: by.reason,
    actorKind: by.actorKind,
    ...(by.actorId !== undefined ? { actorId: by.actorId } : {}),
    askedCents: amountCents,
    expectedRefundedCents,
    createdAt: deps.now(),
  });
  if (!created) return { ok: false, reason: "unfinished" };

  const sent = await sendRefundRecord(deps, id, "press");
  switch (sent.state) {
    case "unknown":
      return { ok: false, reason: "unknown" };
    case "whole":
      return { ok: true, refundedCents: sent.movedCents, legs: await legsOf(deps, id) };
    case "short":
      if (sent.cause === "plan_refused") {
        return { ok: false, reason: sent.reason as Extract<RefundOutcome, { reason: "stale" }>["reason"] };
      }
      return {
        ok: false,
        reason: "provider_error",
        refundedCents: sent.movedCents,
        legs: await legsOf(deps, id),
        message: sent.reason,
      };
  }
}

/** The legs a send ended with, for the box's result. A read that fails is `[]`: the money has moved. */
async function legsOf(deps: RefundDeps, id: RefundRecordId): Promise<RefundLeg[]> {
  try {
    return (await deps.repo.getRefundRecord(id))?.legs ?? [];
  } catch (e) {
    logSwallowed("reservations:refundReservation", e, `could not re-read the legs of ${id} after it was sent`);
    return [];
  }
}

/** The key a leg is sent under: the record and the PaymentIntent, so a re-send of the same record
 *  re-keys identically and Stripe returns the same refund, and a new record never reuses it. */
function refundKey(recordId: RefundRecordId, paymentIntentId: string): string {
  return `refund_${recordId}_${paymentIntentId}`;
}

const PLAN_REFUSALS: readonly string[] = ["stale", "exceeds_refundable", "no_payment_intent"];

/** What an already-finished record answers when it is sent again: its finished state, no port call. */
function finishedOutcome(record: RefundRecord): SendOutcome {
  if (record.state === "whole") return { state: "whole", movedCents: record.movedCents };
  const reason = record.shortReason ?? "unknown";
  let cause: "plan_refused" | "provider_refused" | "gave_up" = "provider_refused";
  if (reason === "not_confirmed_in_24_hours") cause = "gave_up";
  else if (PLAN_REFUSALS.includes(reason)) cause = "plan_refused";
  return { state: "short", movedCents: record.movedCents, askedCents: record.askedCents, cause, reason };
}

/** The leg result Stripe already holds for this record, if it made one. `failed` and `canceled` are
 *  refusals; every other status counts as moved (AC12). */
function legResultFromProvider(found: ProviderRefund): { outcome: "moved" | "refused"; refundId: string; reason?: string } {
  if (found.status === "failed" || found.status === "canceled") {
    return { outcome: "refused", refundId: found.refundId, reason: `Stripe reported the refund ${found.status}` };
  }
  return { outcome: "moved", refundId: found.refundId };
}

/**
 * Send one refund record — the ONLY code that calls the payment port's `refund` (AC19), and the one
 * path a press and the job share (AC25). `from` decides only whether a short record is texted (AC11):
 * the operator's own press reports it by redirect.
 *
 * Does not claim. The press that inserted the record owns it for the takeover age, and
 * `finishUnfinishedRefunds` claims before it calls this with `"job"`.
 *
 * Order, for a press and the job alike: the legs are planned and saved (AC22), each leg is looked up
 * (job only) or sent under its own key, its result is written, then the customer's notice is claimed,
 * sent and marked (AC15), the history row is written (AC32), the alerts go (AC11, AC23), and the
 * record is finished last — so a claim never marked is always on an unfinished record, which the job
 * reads, and finishing twice writes one row.
 *
 * Never throws. Any throw once the record exists leaves it unfinished and answers `unknown`: the
 * money may have moved, and only the job, asking Stripe, can say.
 */
export async function sendRefundRecord(
  deps: RefundDeps,
  recordId: RefundRecordId,
  from: "press" | "job",
): Promise<SendOutcome> {
  try {
    return await send(deps, recordId, from);
  } catch (e) {
    logSwallowed(
      "reservations:sendRefundRecord",
      e,
      `refund record ${recordId} stays unfinished — it may or may not have moved, and the job will ask Stripe`,
    );
    return { state: "unknown" };
  }
}

type Conclusion =
  | { state: "whole" }
  | { state: "short"; cause: "plan_refused" | "provider_refused" | "gave_up"; reason: string };

async function send(deps: RefundDeps, recordId: RefundRecordId, from: "press" | "job"): Promise<SendOutcome> {
  const record = await deps.repo.getRefundRecord(recordId);
  if (!record) throw new Error(`refund record ${recordId} does not exist`);
  if (record.state !== "unfinished") return finishedOutcome(record);
  const reservation = await deps.repo.getReservation(record.reservationId);
  if (!reservation) throw new Error(`refund record ${recordId} names reservation ${record.reservationId}, which does not exist`);

  const at = deps.now();
  // The catch-all (AC23): on the clock alone, and with no port call of any kind. A key older than
  // this may no longer be remembered by Stripe, so sending again could move the money twice.
  if (Date.parse(at) - Date.parse(record.createdAt) >= REFUND_GIVE_UP_AFTER_MS) {
    return conclude(deps, from, record, reservation, record.legs, {
      state: "short",
      cause: "gave_up",
      reason: "not_confirmed_in_24_hours",
    });
  }

  // A break right after step 1 left no legs: plan them now, and save them before the first call (AC22).
  let legs = record.legs;
  if (legs.length === 0) {
    const payments = await deps.repo.listPaymentsForReservation(record.reservationId);
    const plan = planRefund(payments, record.askedCents, record.expectedRefundedCents ?? refundedTotalFor(payments));
    if (!plan.ok) {
      return conclude(deps, from, record, reservation, [], { state: "short", cause: "plan_refused", reason: plan.reason });
    }
    await deps.repo.saveRefundLegs(record.id, plan.legs);
    // First write wins: if another run saved legs first, those are the ones to send.
    legs = (await deps.repo.getRefundRecord(record.id))?.legs ?? plan.legs;
  }

  const current = legs.map((l) => ({ ...l }));
  for (const leg of current) {
    // A refused leg stops the send, now and on every run after it.
    if (leg.outcome === "refused") return conclude(deps, from, record, reservation, current, refusal("refused earlier"));
    if (leg.outcome === "moved") {
      // A leg written as moved by a run that broke before raising its payment: raise it now, or the
      // box would offer the same money again. `markPaymentRefunded` only raises, so this is safe on
      // every send that sees the leg as moved.
      await raiseForMovedLeg(deps, leg);
      continue;
    }
    if (leg.outcome !== undefined) continue;

    let result: { outcome: "moved" | "refused"; refundId?: string; reason?: string };
    // Only the job looks first: a press is sending a record it just wrote, and Stripe's key covers
    // a repeat; the job is picking up after a run that may have got as far as Stripe.
    const found =
      from === "job"
        ? (await deps.payments.listRefunds(leg.paymentIntentId)).find((r) => r.metadata?.refund_record === record.id)
        : undefined;
    if (found) {
      result = legResultFromProvider(found);
    } else {
      try {
        const sent = await deps.payments.refund({
          paymentIntentId: leg.paymentIntentId,
          amountCents: leg.cents,
          idempotencyKey: refundKey(record.id, leg.paymentIntentId),
          metadata: { refund_record: record.id },
        });
        result = { outcome: "moved", refundId: sent.refundId };
      } catch (e) {
        // No answer from the provider is not "nothing moved": stop here, and leave the record
        // unfinished for the job to ask Stripe about (AC9).
        if (e instanceof PaymentIndeterminateError) return { state: "unknown" };
        result = { outcome: "refused", reason: e instanceof Error ? e.message : String(e) };
      }
    }

    // Record immediately, per leg: batching the writes until the end would lose the whole ledger
    // record if the SECOND call threw after the first moved money. A throw here propagates: the leg
    // may have moved, the record stays unfinished, and the job finds the refund by its metadata.
    await deps.repo.finishRefundLeg({
      recordId: record.id,
      paymentIntentId: leg.paymentIntentId,
      outcome: result.outcome,
      ...(result.refundId !== undefined ? { refundId: result.refundId } : {}),
    });
    leg.outcome = result.outcome;
    if (result.refundId !== undefined) leg.refundId = result.refundId;
    if (result.outcome === "moved") {
      await raiseForMovedLeg(deps, leg);
    } else {
      return conclude(deps, from, record, reservation, current, refusal(result.reason ?? "refused"));
    }
  }
  return conclude(deps, from, record, reservation, current, { state: "whole" });
}

/** Raise a moved leg's payment total. `markPaymentRefunded` only raises, so a second write of this
 *  leg, or a `charge.refunded` event that landed first, counts it once. */
async function raiseForMovedLeg(deps: RefundDeps, leg: RefundLeg): Promise<void> {
  if (leg.paymentId !== undefined && leg.refundedTotalCents !== undefined) {
    await deps.repo.markPaymentRefunded(leg.paymentId, leg.refundedTotalCents);
  }
}

const refusal = (reason: string): Conclusion => ({ state: "short", cause: "provider_refused", reason });

/** The alert lane, which must never undo a refund that is otherwise done. */
async function alertSafely(deps: RefundDeps, message: string, href?: string): Promise<void> {
  try {
    await (href === undefined ? deps.alert(message) : deps.alert(message, href));
  } catch (e) {
    logSwallowed("reservations:refundAlert", e, `the office was NOT told: ${message}`);
  }
}

/**
 * Everything after the legs' results are written: the customer's notice, the history row, the
 * alerts, and last the record's own finish. See `sendRefundRecord` for why this order.
 */
async function conclude(
  deps: RefundDeps,
  from: "press" | "job",
  record: RefundRecord,
  reservation: Reservation,
  legs: RefundLeg[],
  how: Conclusion,
): Promise<SendOutcome> {
  const at = deps.now();
  const movedCents = movedCentsOf(legs);
  // What the record will read once finished: the text and the notice are made from this, so the one
  // the press sends and the one a later read would make are the same.
  const finished: RefundRecord = {
    ...record,
    legs,
    movedCents,
    state: how.state,
    ...(how.state === "short" ? { shortReason: how.reason } : {}),
    finishedAt: at,
  };

  // ── the customer's notice (AC15) ───────────────────────────────────────────
  const told = await tellOfCancel(deps, finished, reservation, how.state);

  // ── the history row the screens still read (AC32) ──────────────────────────
  await writeHistory(deps, finished, how);

  // ── the alert (AC11, AC23) ─────────────────────────────────────────────────
  if (how.state === "short") await alertShort(deps, from, finished, reservation, how.cause, at);

  // ── finished, last ─────────────────────────────────────────────────────────
  await deps.repo.finishRefundRecord({
    id: record.id,
    state: how.state,
    movedCents,
    ...(how.state === "short" ? { shortReason: how.reason } : {}),
    at,
  });
  if (how.state === "whole") return { state: "whole", movedCents, ...(told !== undefined ? { told } : {}) };
  return {
    state: "short",
    movedCents,
    askedCents: record.askedCents,
    cause: how.cause,
    reason: how.reason,
    ...(told !== undefined ? { told } : {}),
  };
}

/**
 * The customer's notice for a cancel's record, claimed before it is sent and marked after (AC15).
 * Only a `customer_cancel` or `operator_cancel` record has one, and only when a sender is wired.
 * Returns the send code when THIS call told the customer.
 *
 * A notice already claimed and never marked sent is not sent again: the run that claimed it died
 * somewhere between, so it may or may not have gone, and every active admin is told once to check.
 */
async function tellOfCancel(
  deps: RefundDeps,
  record: RefundRecord,
  reservation: Reservation,
  state: "whole" | "short",
): Promise<string | undefined> {
  const isCancel = record.reason === "customer_cancel" || record.reason === "operator_cancel";
  if (!isCancel || !deps.tellCustomer) return undefined;
  const at = deps.now();
  if (!(await deps.repo.claimRefundNotice(record.id, at))) {
    if (record.noticeSentAt === undefined && (await deps.repo.claimRefundAlert(record.id, "notice_in_doubt", at))) {
      await alertSafely(deps, refundAlertText("notice_in_doubt", record, reservation), bookingPanePath(record.reservationId));
    }
    return undefined;
  }
  const code = await tellSafely(
    deps.tellCustomer,
    record.reservationId,
    reservation.cancelledBy ?? (record.reason === "customer_cancel" ? "customer" : "operator"),
    // Whole is `issued`, part moved is `partial`, nothing moved is `pending`.
    noticeRefundOf(
      state === "whole"
        ? { kind: "issued", cents: record.movedCents }
        : { kind: "failed", cents: record.askedCents, movedCents: record.movedCents },
    ),
    record.actorKind === "admin" ? { kind: "admin", id: record.actorId ?? "" } : { kind: "customer" },
  );
  // Marked whatever the code: a send that failed is on the history, and only a claim with no mark is
  // in doubt.
  await deps.repo.markRefundNoticeSent(record.id, deps.now());
  return code ?? undefined;
}

/**
 * Text every active admin that a record finished short, once per record (AC11, AC23). The operator's
 * own press is told by its redirect, so it is not texted; a sold-out record gets today's alert with no
 * link, since a booking that never booked cannot be refunded from the booking.
 */
async function alertShort(
  deps: RefundDeps,
  from: "press" | "job",
  record: RefundRecord,
  reservation: Reservation,
  cause: "plan_refused" | "provider_refused" | "gave_up",
  at: string,
): Promise<void> {
  const operators = record.reason === "operator_refund" || record.reason === "operator_cancel";
  if (from === "press" && operators && cause !== "gave_up") return;
  const gaveUp = cause === "gave_up";
  // The catch-all takes no claim: every run that finds the record unfinished at 24 hours sends it and
  // then finishes the record, so a break between the two can repeat the text and cannot lose it.
  if (!gaveUp && !(await deps.repo.claimRefundAlert(record.id, "short", at))) return;
  if (record.reason === "sold_out") {
    await alertSafely(deps, refundAlertText("sold_out_short", record, reservation));
    return;
  }
  await alertSafely(deps, refundAlertText(gaveUp ? "gave_up" : "short", record, reservation), bookingPanePath(record.reservationId));
}

/** The row a finished record writes, once, named for the record. Never throws (`recordTrail`). */
async function writeHistory(deps: RefundDeps, record: RefundRecord, how: Conclusion): Promise<void> {
  const draft = {
    reservationId: record.reservationId,
    actorKind: record.actorKind,
    ...(record.actorId !== undefined ? { actorId: record.actorId } : {}),
    ...(record.reason === "sold_out" && record.legs[0] ? { paymentIntentId: asId<"PaymentIntentId">(record.legs[0].paymentIntentId) } : {}),
  };
  if (how.state === "short") {
    await recordTrail(deps, {
      id: asId<"TrailEventId">(`refund_failed:${record.id}`),
      ...draft,
      type: "refund_failed",
      metadata: { actualCents: record.movedCents, reason: how.reason },
    });
    return;
  }
  if (record.reason === "sold_out") {
    await recordTrail(deps, {
      id: asId<"TrailEventId">(`auto_refunded:${record.id}`),
      ...draft,
      type: "auto_refunded",
      metadata: { reason: "residual-race loss" },
    });
    return;
  }
  // A customer's whole refund writes no row: the manage page reads the absence of a failure.
  if (record.reason === "customer_cancel") return;
  await recordTrail(deps, {
    id: asId<"TrailEventId">(`refund_issued_by_operator:${record.id}`),
    ...draft,
    type: "refund_issued_by_operator",
    metadata: {
      actualCents: record.movedCents,
      ...(record.quotedCents !== undefined ? { quotedCents: record.quotedCents } : {}),
      reason: record.reason === "operator_cancel" ? "cancel-and-refund" : "standalone refund",
    },
  });
}

/**
 * The refund pass in the tick (issue #1278, AC12–AC14, AC23): find every unfinished record, claim
 * the ones nobody has held for the takeover age, and send each through the same function a press
 * uses. A record it cannot finish is counted and does not stop the ones after it.
 *
 * `finished` is the records finished whole; `short` those finished short, the catch-all's included;
 * `errors` the records the run could not finish (a record whose finishing write threw is one, though
 * its alert went); `alerted` how many times the run called `deps.alert`.
 */
export async function finishUnfinishedRefunds(
  deps: RefundDeps,
): Promise<{ finished: number; short: number; alerted: number; errors: number }> {
  const counts = { finished: 0, short: 0, alerted: 0, errors: 0 };
  const counted: RefundDeps = {
    ...deps,
    alert: async (message, href) => {
      counts.alerted += 1;
      await (href === undefined ? deps.alert(message) : deps.alert(message, href));
    },
  };
  for (const record of await deps.repo.listUnfinishedRefundRecords()) {
    try {
      const at = deps.now();
      const staleBefore = new Date(Date.parse(at) - REFUND_TAKEOVER_AFTER_MS).toISOString();
      if (!(await deps.repo.claimRefundRecord({ id: record.id, at, staleBefore }))) continue;
      const outcome = await sendRefundRecord(counted, record.id, "job");
      if (outcome.state === "whole") counts.finished += 1;
      else if (outcome.state === "short") counts.short += 1;
      else counts.errors += 1;
    } catch (e) {
      counts.errors += 1;
      logSwallowed("reservations:finishUnfinishedRefunds", e, `refund record ${record.id} could not be finished this run`);
    }
  }
  return counts;
}

/** The booking's pane, `/admin/calendar/<reservationId>`: where every refund alert links. */
export function bookingPanePath(reservationId: ReservationId): string {
  return `/admin/calendar/${encodeURIComponent(String(reservationId))}`;
}

/** `<safeForAlert name> party of <N>`: the customer, as a sold-out alert names them. */
export function soldOutWho(reservation: Reservation): string {
  return `${safeForAlert(reservation.customerName)} party of ${reservation.partySize ?? "?"}`;
}

/**
 * Every admin text of the refund path, composed in one place so a press and the job cannot word
 * one differently (issue #1278). The customer's name always goes through `safeForAlert`, and goes
 * last where the text has a tail, so a phone that truncates cuts only the untrusted fragment.
 */
export function refundAlertText(
  kind: "short" | "gave_up" | "failed_later" | "notice_in_doubt" | "sold_out_short" | "sold_out_unknown",
  record: RefundRecord,
  reservation: Reservation,
  leg?: RefundLeg,
): string {
  const name = safeForAlert(reservation.customerName);
  const charge = record.legs[0]?.paymentIntentId ?? "unknown";
  switch (kind) {
    case "short":
      return (
        `Refund fell short: ${formatCents(record.askedCents - record.movedCents)} of ` +
        `${formatCents(record.askedCents)} did not go back to ${name}. Send the rest from the booking.`
      );
    case "gave_up":
      return (
        `Refund not confirmed after 24 hours: ${formatCents(record.askedCents - record.movedCents)} to ${name}. ` +
        `Muster sent nothing more. Check Stripe, then refund from the booking.`
      );
    case "failed_later":
      return (
        `A ${formatCents(leg?.cents ?? record.askedCents)} refund to ${name} failed at their bank. ` +
        `The money is back in Stripe. Refund them another way.`
      );
    case "notice_in_doubt":
      return `${name} may not have been told their booking was cancelled. Check, and message them.`;
    case "sold_out_short":
      // Today's text (the residual-race alert), with the record's reason as the cause.
      return (
        `Residual-race loss AND the auto-refund FAILED (${record.shortReason ?? "unknown error"}) - ` +
        `Stripe charge ${charge}. REFUND MANUALLY in Stripe. Customer: ${soldOutWho(reservation)}`
      );
    case "sold_out_unknown":
      return (
        `Sold out while paying: the ${formatCents(record.askedCents)} refund on charge ${charge} is not confirmed yet. ` +
        `Muster is checking with Stripe and will text again only if it fails. ` +
        `The customer has not been told; message them. Customer: ${soldOutWho(reservation)}`
      );
  }
}
