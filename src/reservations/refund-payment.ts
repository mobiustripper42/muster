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
 * **Amended posture (DEC-107).** Refunds were "manual in the Stripe dashboard" with one
 * programmatic exception (the DEC-109 residual-race auto-refund). They stay operator-discretion;
 * what changes is that the operator can now exercise that discretion in Muster, and either route
 * reconciles — a dashboard refund lands via the `charge.refunded` webhook.
 */
import { randomUUID } from "node:crypto";
import type { Payment } from "../domain/entities.js";
import type { PaymentId, ReservationId } from "../domain/ids.js";
import type { PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { countsAsPaid } from "./payment-config.js";

export interface RefundDeps {
  repo: Repository;
  payments: PaymentPort;
  now: () => string;
}

/**
 * How long a refund lease is held before it is considered abandoned (#726).
 *
 * Longer than any Stripe round-trip, shorter than an operator's patience. Not env-overridable:
 * nothing about it is per-deploy, and the two failure modes are symmetric and both bounded —
 * too short reopens the double-refund window for a pathologically slow call, too long makes a
 * crashed refund un-retryable for that much longer.
 */
const LEASE_TTL_MS = 60_000;

/** One leg of the split — what actually went back off a single charge. */
export interface RefundAllocation {
  paymentId: PaymentId;
  paymentIntentId: string;
  cents: number;
  /** Cumulative refunded on that row afterwards — what `markPaymentRefunded` records. */
  refundedTotalCents: number;
}

export type RefundOutcome =
  | { ok: true; refundedCents: number; allocations: RefundAllocation[] }
  | {
      ok: false;
      reason:
        | "reservation_missing"
        | "not_muster"
        | "invalid_amount"
        | "exceeds_refundable"
        | "no_payment_intent"
        | "stale";
    }
  | {
      /** The provider failed partway. Whatever DID move is recorded and reported. */
      ok: false;
      reason: "provider_error";
      refundedCents: number;
      allocations: RefundAllocation[];
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

/**
 * Parse a dollars string an operator typed into integer cents (DEC-112), or `null`.
 *
 * **Validate the string, never the coercion** — the same rule the webhook's `requireCents`
 * exists for, and for a sharper reason here: this figure is chosen by a human under time
 * pressure and every permissive parse fails toward moving the WRONG amount of real money.
 * `Number("")` is 0, `parseFloat("50abc")` is 50, `Number("5e2")` is 500, `Number("0x10")` is
 * 16. None of those are things a person meant to type into a refund box.
 *
 * Accepts a leading `$` and thousands commas because operators paste from Stripe, and one or
 * two decimal places. Refuses three (`1.005` is not a refundable amount; silently rounding it
 * would pick a direction on the operator's behalf) and refuses a negative (a refund's direction
 * is the button, not the sign).
 *
 * Cents are assembled from the two halves as INTEGERS rather than by multiplying the parsed
 * float: `70.55 * 100` is `7054.999999999999`, and truncating that loses a cent on an ordinary
 * amount.
 */
export function parseDollarsToCents(raw: string): number | null {
  const trimmed = raw.trim().replace(/^\$/, "");
  // **Commas must be in thousands positions or the value is refused.** Stripping them
  // unconditionally turns a DECIMAL comma into a 100× refund: `"1,50"` → `"150"` → $150.00
  // against an intended $1.50, with the success message, the ledger and the compare-and-swap
  // all agreeing on the wrong number. `,` and `.` are adjacent kinds of typo, and a decimal
  // comma is what you get pasting from most of the world. The only backstop was
  // `exceeds_refundable`, which does nothing on a booking large enough to absorb it.
  //
  // So: either no commas at all, or `1,234,567` exactly. Anything else is refused rather
  // than interpreted, because there is no reading of `1,50` that is safe to guess at.
  const grouped = /^\d{1,3}(,\d{3})+$/;
  const [intPart = "", ...restParts] = trimmed.split(".");
  if (intPart.includes(",") && !grouped.test(intPart)) return null;
  if (restParts.some((p) => p.includes(","))) return null;
  const cleaned = trimmed.replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const dollars = Number(m[1]);
  const cents = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  if (!Number.isSafeInteger(dollars)) return null;
  return dollars * 100 + cents;
}

/** Total already handed back on this booking — the compare-and-swap token. */
export function refundedTotalFor(payments: readonly Payment[]): number {
  return payments.reduce((sum, p) => sum + (p.refundedCents ?? 0), 0);
}

/**
 * The most this booking can still give back — the ceiling the operator's box is capped at,
 * and the same number `refundReservation` plans against, so the form can never offer an
 * amount the action will refuse as `exceeds_refundable`.
 */
export function refundableTotalFor(payments: readonly Payment[]): number {
  return payments.reduce((sum, p) => sum + refundableOn(p), 0);
}

/**
 * Refund `amountCents` against a booking, drawing from its charges newest-first.
 *
 * `expectedRefundedCents` is the booking's total refunded amount **as the operator's screen was
 * rendered**. It is a compare-and-swap, and it is what makes a double-submit safe: Stripe's
 * idempotency key cannot help, because a second press computes a genuinely different allocation
 * (cumulative $100 → $200) and therefore keys differently, and a disabled button is not a guard
 * for a no-JS form post. A stale token means someone — or the same person, twice — already moved
 * money since this screen was drawn, so the request is refused and the operator re-reads the
 * page before deciding again.
 */
export async function refundReservation(
  deps: RefundDeps,
  reservationId: ReservationId,
  amountCents: number,
  expectedRefundedCents: number,
): Promise<RefundOutcome> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }
  const reservation = await deps.repo.getReservation(reservationId);
  if (!reservation) return { ok: false, reason: "reservation_missing" };
  // Xola holds its own money (DEC-105) — there is nothing here to hand back.
  if (reservation.source !== "muster") return { ok: false, reason: "not_muster" };

  // ── The mutex (#726) ──────────────────────────────────────────────────────
  // Taken BEFORE the payments are read, and that ordering is the fix, not an implementation
  // detail. A lease acquired *after* planning would guard only the writes, leaving the
  // read-modify-write open: two callers plan from the same `refunded = 0`, the first executes
  // and releases, and the second then acquires cleanly and executes its STALE plan. Everything
  // the plan is derived from has to be read inside the lease.
  //
  // The cost is that a request refused on its plan (over the ceiling, no PaymentIntent) does
  // hold the lease — for the duration of one database read, released immediately in the
  // `finally`. That is not the 60-second block the earlier ordering was avoiding.
  const token = randomUUID();
  const lease = await deps.repo.acquireRefundLease(
    reservationId,
    token,
    deps.now(),
    new Date(Date.parse(deps.now()) + LEASE_TTL_MS).toISOString(),
  );
  // Reported as `stale` deliberately: from the operator's seat the two situations are the same
  // — someone else is acting on this booking, re-read the screen before deciding again — and the
  // copy for it already exists and already says the safe thing.
  if (!lease.acquired) return { ok: false, reason: "stale" };

  try {
    const payments = await deps.repo.listPaymentsForReservation(reservationId);
    if (refundedTotalFor(payments) !== expectedRefundedCents) {
      return { ok: false, reason: "stale" };
    }
    // The compare-and-swap still earns its place: it catches a DOUBLE-SUBMIT of the same amount
    // arriving after the first has finished and released, which no lease can see. The lease
    // catches genuine concurrency, which the compare-and-swap cannot. Complementary, not
    // redundant — and now the compare reads inside the mutex, so it cannot be raced either.

    // Newest first. `createdAt` is ISO-8601 UTC text throughout this schema, so lexicographic
    // ordering is chronological; the payment id breaks a tie deterministically so two charges
    // stamped in the same millisecond don't allocate differently between adapters.
    const ordered = [...payments].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || String(b.id).localeCompare(String(a.id)),
    );

    const plan: RefundAllocation[] = [];
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
      plan.push({
        paymentId: p.id,
        paymentIntentId: p.stripePaymentIntentId,
        cents,
        refundedTotalCents: (p.refundedCents ?? 0) + cents,
      });
      remaining -= cents;
    }
    if (remaining > 0) return { ok: false, reason: "exceeds_refundable" };

    return await executeRefundPlan(deps, plan);
  } finally {
    // ALWAYS released, including on every refusal above, on `provider_error`, and on a throw. A
    // lease that outlives its refund blocks the booking until it expires, and the operator's
    // retry is exactly what a partial failure demands. `token` makes this own-lease-only: if
    // this lease expired mid-call and someone else acquired, that successor's lease survives.
    await deps.repo.releaseRefundLease(reservationId, token);
  }
}

/**
 * Issue the planned legs. Split out so the lease's `try`/`finally` wraps the whole of the
 * money-moving half and nothing else — the acquire must not be inside its own `finally`.
 */
async function executeRefundPlan(
  deps: RefundDeps,
  plan: RefundAllocation[],
): Promise<RefundOutcome> {
  const done: RefundAllocation[] = [];
  for (const leg of plan) {
    try {
      await deps.payments.refund({
        paymentIntentId: leg.paymentIntentId,
        amountCents: leg.cents,
        // Keyed on the resulting CUMULATIVE total, not on the leg amount: a retry of this exact
        // operation re-keys identically and Stripe returns the same refund, while a later,
        // genuinely different refund on the same charge gets a fresh key. Keying on the leg
        // amount alone would make "refund $100 again next week" a silent no-op.
        idempotencyKey: `refund_op_${String(leg.paymentId)}_${leg.refundedTotalCents}`,
      });
    } catch (e) {
      // Money that already moved must be in the ledger even though the operation failed —
      // unreconcilable is not unrecordable (#613 posture). The legs before this one are
      // recorded below via `done`; this one did not happen.
      return {
        ok: false,
        reason: "provider_error",
        refundedCents: done.reduce((s, d) => s + d.cents, 0),
        allocations: done,
        message: e instanceof Error ? e.message : String(e),
      };
    }
    // Record immediately, per leg. Batching the writes until the end would lose the whole
    // ledger record if the SECOND provider call threw after the first one moved money.
    await deps.repo.markPaymentRefunded(leg.paymentId, leg.refundedTotalCents);
    done.push(leg);
  }

  return {
    ok: true,
    refundedCents: done.reduce((s, d) => s + d.cents, 0),
    allocations: done,
  };
}
