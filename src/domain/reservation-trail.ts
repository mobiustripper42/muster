/**
 * The reservation trail (issue #1047; tracked by issue #1053).
 *
 * What happened to a booking, and who did it. The crew engine's equivalent is
 * `src/domain/audit.ts` (`audit_events`, DEC-118) and this deliberately mirrors its
 * shape — actor dimension, ISO-text timestamp, jsonb metadata — but not its key or
 * its rationale. Crew keeps its trail separate from `reliability_events` because an
 * admin removal is not the subject's behaviour and never feeds the scorer.
 * Reservations has no scorer, so that argument is absent here; what replaces it is
 * the store-vs-derive split below.
 *
 * ## Two unions, and the difference is the point
 *
 * **`TrailEventType`** is everything a reader can see in a trail. **`EmittedTrailType`
 * is the subset this table accepts**, and it is a strict subset because half the trail
 * already persists somewhere else.
 *
 * DEC-118's holding is `Read = UNION, not dual-write. One source per fact.` A `booked`
 * fact lives in `reservations.status`; an `imported` fact has lived in
 * `import_run_items` since `db/migrations/0007_import_audit.sql` (DEC-056). Writing
 * those here too would be a second log over facts that already have one, which is what
 * DEC-024 bars. So the write path takes an `EmittedTrailType` and **the compiler
 * refuses the dual-write** — the rule is a type, not a comment somebody has to recall
 * at each of twenty emitter sites.
 *
 * The projection over the already-persisted half is issue #1048.
 */

import type { PaymentIntentId, ReservationId, TrailEventId } from "./ids.js";

/**
 * Facts that only this table records. Each is something the product does today and
 * nothing anywhere writes down — the list was walked from `src/reservations/` for
 * issue #886, because a trail missing events nobody thought of reads as authoritative
 * and is not.
 */
export const EMITTED_TRAIL_TYPES = [
  // ── Checkout (issue #1051) ──────────────────────────────────────────────────
  /** The claim fell through to another boat. The only possible record that a
   *  customer's hull was decided by who got there first, not by what they picked. */
  "hull_contended",
  "sold_out",
  /** A retry OVERWROTE name / party size / email / phone on the pending row
   *  (`src/ports/repository.ts`). The previous values are destroyed; this carries them. */
  "checkout_details_changed",

  // ── Money in (issue #1051) ──────────────────────────────────────────────────
  "payment_failed",
  "payment_superseded",
  /** Money with no booking to hang it on — keyed by `paymentIntentId`, not by a
   *  reservation. Three shapes in `booking-webhook.ts`; see issue #1051. */
  "charge_unmatched",
  /** A live, ungated operator money action. The customer's side of the balance
   *  path is derived from `payments`; this half is not recorded anywhere. */
  "balance_link_created",

  // ── Money out (issue #1050) ─────────────────────────────────────────────────
  /**
   * An operator decided a refund amount. The only human-decided money figure in the
   * product (`refund-payment.ts`: "the first refund in this codebase that a human decides
   * the amount of"), and `quotedCents` carries what the published terms suggested so the
   * delta is readable without recomputing terms that may since have changed.
   *
   * **Named for what the operator DID, not for a comparison.** The first draft was
   * `refund_amount_overridden`, which promises a quote to differ from — and there are two
   * entry points, only one of which has one. `cancelBooking` computes `quoteCancelRefund`
   * and passes it; the standalone refund box has no `CancelledBy` and no notice window, so
   * no quote exists to be derived. `quotedCents` is absent on those rows, and its absence
   * means "there was no policy figure", not "it matched".
   */
  "refund_issued_by_operator",
  /** The residual-race compensation — the one refund no human authorised. */
  "auto_refunded",
  /** The provider failed partway. Whatever DID move is recorded; a `refunded`
   *  projection cannot carry a partial failure. */
  "refund_failed",
  /** Four dispute facts that `payments.status` collapses into one. `inquiry`
   *  carries a response deadline only a human can meet; `won` returns the row to
   *  `succeeded`, so the recovery is otherwise invisible afterwards. */
  "dispute_inquiry",
  "dispute_won",
  "dispute_lost",
  /** **The one worth the whole table.** A dispute state the pinned Stripe SDK does not
   *  know: `booking-webhook.ts`'s `DISPUTE_LEDGER_WRITE` maps it to `null` because "we
   *  cannot tell whether the money moved, so we do not pretend either way". Today that
   *  produces an alert and no record at all — an amount that may or may not have left
   *  the account, with nothing durable saying so. */
  "dispute_unknown",

  // ── Reaching the customer (issue #1052) ─────────────────────────────────────
  /** The messaging flag was off. The booking is written, the operator sees a sale,
   *  the customer never hears — and today there is no log at any level. */
  "confirmation_skipped",
  "link_resent",
  /** DESTRUCTIVE in a way a resend is not: it kills the customer's existing link.
   *  Folding it into `link_resent` loses the only record that a link was killed. */
  "link_reissued",
  /** Recovery is built so the caller CANNOT tell a match from a miss. This is the
   *  only place the truth gets written down. */
  "link_recovery_requested",
  "change_requested",
  /** Best-effort and never throws, so a customer charged, auto-refunded and never
   *  told is silent by construction. */
  "sold_out_notice_sent",
  "sold_out_notice_failed",

  // ── The slot (issue #1052) ──────────────────────────────────────────────────
  /** The operator takes a departure off the market and puts it back. The release
   *  DELETES the block, destroying the record that it ever existed. */
  "slot_held",
  "slot_released",
] as const;
export type EmittedTrailType = (typeof EMITTED_TRAIL_TYPES)[number];

/**
 * Facts the trail SHOWS but never stores. Each already has exactly one source, named
 * beside it, and issue #1048 projects them. Listed here rather than left implicit so
 * that "why is `booked` not emitted?" has an answer at the place someone asks it.
 */
export const DERIVED_TRAIL_TYPES = [
  "checkout_started", //     reservations.reserved_at, checkout_attempts
  "checkout_lapsed", //      computed — src/reservations/abandonment.ts
  "booked", //               reservations.status, updated_at
  "cancelled", //            reservations.status, cancelled_by
  "admin_booked", //         reservations.source = 'admin'
  "imported", //             import_run_items (DEC-056) — also upstream change/cancel
  "confirmation_sent", //    reservations.confirmation_sent_at
  "payment_succeeded", //    payments.status
  "refunded", //             payments.refunded_cents
  "dispute_opened", //       payments.status
  "gratuity_added", //       gratuity
] as const;
export type DerivedTrailType = (typeof DERIVED_TRAIL_TYPES)[number];

/** Everything a reader can see. The read model's vocabulary; NOT the table's. */
export type TrailEventType = EmittedTrailType | DerivedTrailType;

/**
 * Who acted. `engine` covers anything no person triggered — a lapse, a sweep, the
 * residual-race auto-refund. That distinction is load-bearing on the money path:
 * an `auto_refunded` and an operator refund must not read alike.
 */
export const TRAIL_ACTOR_KINDS = ["customer", "admin", "stripe", "engine"] as const;
export type TrailActorKind = (typeof TRAIL_ACTOR_KINDS)[number];

/** Side-channel facts. All optional; different types populate different fields. */
export interface TrailEventMetadata {
  /** `refund_issued_by_operator`: what the published terms quoted, in CENTS. Absent
   *  when no quote exists — the standalone refund box has no notice window to derive one. */
  quotedCents?: number;
  /** `refund_issued_by_operator` / `refund_failed`: what actually moved, in CENTS. */
  actualCents?: number;
  /** `confirmation_skipped`: which flag or failure suppressed it. */
  reason?: string;
  /** `checkout_details_changed`: the values the retry destroyed. */
  previous?: Record<string, string | number>;
  /** `hull_contended`: the hull the claim wanted, and the one it settled for. */
  wantedVesselId?: string;
  gotVesselId?: string;
  /**
   * `sold_out` / `hull_contended`: which departure this was about (issue #1051).
   *
   * **`sold_out` is the only event in the set that carries NEITHER key** — no reservation
   * row was written and no charge exists, so without these four the row says a customer was
   * turned away and not from what. `hull_contended` has a reservation and carries them
   * anyway, so the two read alike in a list where one of them can never be joined to
   * anything.
   */
  offeringId?: string;
  date?: string;
  time?: string;
  guestCount?: number;
  /** `charge_unmatched` / `balance_link_created`: the provider handle this is about, when it
   *  is not a PaymentIntent id. A hosted session id, or a charge key with no intent behind
   *  it — which is precisely the `charge_unmatched` shape that leaves the row keyless. */
  chargeRef?: string;
  /** `booked` (projected): which path confirmed it — webhook | success_page |
   *  reconciler. A dimension rather than three types, because §2.8.6 requires all
   *  three to call one idempotent confirm and the reconciler is not built yet. */
  via?: string;
}

/**
 * One row. **Both keys are optional and neither is a foreign key** — see the
 * migration header for why (the §2.8.8 reaper, not cascade semantics).
 *
 * A row with neither key is legal and is not a defect: `charge_unmatched` for a
 * charge Muster never recorded has no reservation, and a `slot_held` has neither.
 * What every row has is a `timestamp` and a `type`.
 */
export interface TrailEvent {
  id: TrailEventId;
  /** The booking this happened to, when there is one. */
  reservationId?: ReservationId;
  /** The charge this happened to, when there is no booking to name. */
  paymentIntentId?: PaymentIntentId;
  actorKind: TrailActorKind;
  /** The acting identity; undefined for `engine` and for an anonymous customer. */
  actorId?: string;
  type: EmittedTrailType;
  /** ISO-8601 UTC. A string, to keep the domain serialization-pure. */
  timestamp: string;
  metadata: TrailEventMetadata;
}
