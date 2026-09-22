/**
 * The reservation trail's UNION READ (issue #1048; tracked by issue #1053).
 *
 * One booking's whole history, in order, assembled from five sources. `src/domain/
 * reservation-trail.ts` splits the vocabulary in two and this is the other half of that split:
 * `EMITTED_TRAIL_TYPES` are the facts only `reservation_trail` records, `DERIVED_TRAIL_TYPES`
 * are the ones that already persist somewhere, and DEC-118's holding is *"Read = UNION, not
 * dual-write. One source per fact."* Emitting the derived half would be a second log over facts
 * that already have one, which DEC-024 bars — so they are projected here instead, at read time.
 *
 * ## The problem this module actually solves: five sources, four notions of "when"
 *
 * A trail whose ordering is wrong is worse than no trail, because it reads as authoritative.
 *
 * | Fact | Source | What dates it |
 * |---|---|---|
 * | `checkout_started` | `reservations.reservedAt` | its own column, frozen at the first write (§2.8.7) |
 * | `confirmation_sent` | `reservations.confirmationSentAt` | its own column |
 * | `payment_succeeded` | `payments` | `createdAt` — the row IS the charge |
 * | `gratuity_added` | `gratuity` | `createdAt` |
 * | `imported` | `import_run_items` | the RUN's clock; the item has no timestamp (0007) |
 * | `checkout_lapsed` | computed | `reservedAt + holdMinutes` — exact arithmetic, but no row exists |
 * | `dispute_opened` | `payments.status` | nothing — see its note in `DERIVED_TRAIL_TYPES` |
 *
 * ## Three facts USED to be on that table, and building this is what moved them
 *
 * `booked`, `cancelled` and `refunded` were derived, and every one of them was dated from a
 * column that does not hold the moment it happened. `reservations.updated_at` is last-write-wins,
 * so a cancel overwrites the booking's time and both events land on one instant.
 * `payments.refunded_cents` is a running total with no clock at all, so a refund was dated from
 * the charge — possibly months earlier — and two partial refunds collapsed into one entry.
 *
 * They are emitted now (issue #1048). The rule that put them here was DEC-118's *"one source per
 * fact"*, applied to the wrong question: DEC-118's actual test is whether the **transition**
 * persists, not whether the **fact** does. `reservations.status` persists a state — this booking
 * *is* booked. Nothing persisted the event. The operator's version, which is shorter: *"it seems
 * like `booked` would be the single most important event to capture ... you know ... in a booking
 * system."*
 *
 * ## `when` is a value, not a string
 *
 * Every entry says which of three things its time is. That is the whole design, and it is what
 * makes the answer trustworthy rather than merely present — issue #1048's own words. A renderer
 * (issue #1049) can show an inherited time differently instead of printing a confident clock over
 * a column that never held one.
 *
 * **Deliberately NOT solved by adding timestamp columns.** That is issue #1015 (`row_inserted_at`
 * / `row_updated_at`, stamped by the database), it only fixes bookings made after it lands, and
 * every row already in the table would still need this.
 */

import type { Gratuity, Payment, Reservation } from "../domain/entities.js";
import type { ReservationId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import type { ImportItemAtRun } from "../import/import-audit.js";
import type {
  TrailActorKind,
  TrailEvent,
  TrailEventMetadata,
  TrailEventType,
} from "../domain/reservation-trail.js";
import { isLivePending, pendingLiveSince, PAYMENT_WINDOW_MINUTES } from "./pending.js";

/**
 * How well this entry's time is known. Three cases because there are three, and collapsing them
 * to a plain string is how a guess starts reading like a measurement.
 */
export type TrailWhen =
  /** A column or a row holds this instant. It is when the thing happened. */
  | { kind: "recorded"; at: string }
  /** Exact arithmetic over recorded values, but nothing fired and no row exists — the only
   *  member is `checkout_lapsed`, which is a moment the clock passed rather than an event. */
  | { kind: "computed"; at: string; from: string }
  /** Borrowed from a neighbouring fact because this one has no clock of its own. `from` says
   *  which clock and why, so a reader is never left to assume it is the event's own. */
  | { kind: "inherited"; at: string; from: string };

/** The instant an entry sorts at, whatever the provenance. */
export const whenAt = (w: TrailWhen): string => w.at;

export interface TrailEntry {
  /** Stable across renders: the emitted row's id, or `<type>:<source key>` for a derived one. */
  id: string;
  type: TrailEventType;
  when: TrailWhen;
  actorKind: TrailActorKind;
  actorId?: string;
  metadata: TrailEventMetadata;
}

/**
 * Everything the read needs, already loaded. Pure in, pure out — the loader is the caller's job
 * (same split as `calendar-detail.ts`), which is what lets the whole union be unit-tested
 * without a repository.
 */
export interface TrailInputs {
  reservation: Reservation;
  payments: readonly Payment[];
  gratuities: readonly Gratuity[];
  /** From `listImportItemsForRef` — each already carrying the run clock that dates it. */
  imports: readonly ImportItemAtRun[];
  /** From `listTrailEventsFor` — the emitted half, matched on EITHER key. */
  emitted: readonly TrailEvent[];
  /** The reading clock. Decides whether a still-`pending` row has lapsed. */
  asOf: string;
  /**
   * The payment window in minutes, for the `checkout_lapsed` arithmetic. Injected so a test need
   * not depend on the env-resolved default; absent falls back to `PAYMENT_WINDOW_MINUTES`.
   *
   * **Named for the window and NOT `holdMinutes`, deliberately.** `Reservation.holdMinutes` is a
   * different number — how long the row occupies the hull — and the field's own docstring calls
   * the collision out: *"confusingly the same word."* The first cut of this module named this one
   * `holdMinutes` and then read the row's, which is how the wrong number got used.
   */
  paymentWindowMinutes?: number;
}

/**
 * Order for entries landing on the SAME instant.
 *
 * **The collisions it was written for are gone, and it still earns its place** (`@code-review`
 * caught the stale rationale). It used to cover `booked`/`cancelled` sharing `updatedAt` and the
 * three money facts sharing `payments.createdAt` — all of which this same task moved to emitted
 * rows with independent timestamps. What is left is subtler: `payment_succeeded` reads
 * `payments.createdAt` and the emitted `booked` row is stamped by a `deps.now()` call a few
 * statements later in the same handler, so the two land in the same millisecond routinely. A
 * booking must not sort ahead of the charge that paid for it.
 *
 * Everything else — every other emitted type — takes `DEFAULT_RANK` and then sorts by id.
 * Emitted rows carry real per-row timestamps, so a tie is rare and arbitrary-but-deterministic
 * is an honest answer for it. Enumerating all 33 types here would be a table nobody could keep
 * true, to settle ties that do not happen.
 */
const DEFAULT_RANK = 55;
const TIE_RANK: Partial<Record<TrailEventType, number>> = {
  checkout_started: 10,
  imported: 20,
  checkout_lapsed: 30,
  payment_succeeded: 40,
  booked: 50,
  confirmation_sent: 60,
  gratuity_added: 70,
  dispute_opened: 80,
  refunded: 90,
  cancelled: 100,
};

/** Import-audit kinds that are about a RESERVATION. Shift kinds share the table and the ref
 *  column, so a shift id could collide with nothing here — but the filter is cheap and the
 *  alternative is a trail that would show `shift_created` on a booking. */
const RESERVATION_IMPORT_KINDS = new Set([
  "reservation_added",
  "reservation_updated",
  "reservation_cancelled",
]);

/**
 * One booking's history, oldest first.
 *
 * Oldest-first rather than the newest-first `listTrailEvents` contract, because this is a story
 * about one booking and a story runs forwards. Issue #1049 can reverse it for a feed; it cannot
 * recover an order this function got wrong.
 *
 * **No fact appears twice.** The two places that could double-count are handled explicitly:
 * `admin_booked` REPLACES `booked` rather than joining it (one booking, one way it was made),
 * and the emitted half is never re-derived — `EmittedTrailType` is a strict subset that the
 * compiler keeps out of the projected set.
 */
export function reservationTrail(input: TrailInputs): TrailEntry[] {
  const { reservation: r, payments, gratuities, imports, emitted, asOf } = input;
  const out: TrailEntry[] = [];

  // ── The emitted half: already real events with real timestamps ──────────────
  for (const e of emitted) {
    out.push({
      id: String(e.id),
      type: e.type,
      when: { kind: "recorded", at: e.timestamp },
      actorKind: e.actorKind,
      ...(e.actorId !== undefined ? { actorId: e.actorId } : {}),
      metadata: e.metadata,
    });
  }

  // ── imported: one entry per run that touched this booking ───────────────────
  //
  // **Per RUN, not one `imported` for the booking.** `import_run_items` carries
  // `reservation_added`, `_updated` and `_cancelled` as separate rows, and an upstream change
  // or cancellation is a different fact from the original import. Collapsing them to a single
  // "imported" would discard precisely what makes that table the authoritative source for this
  // (DEC-056) — and the trail would then be silent about a Xola-side cancellation, which is the
  // kind of hole this whole feature exists to close.
  for (const item of imports) {
    if (!RESERVATION_IMPORT_KINDS.has(item.kind)) continue;
    out.push({
      id: `imported:${String(item.runId)}:${item.kind}`,
      type: "imported",
      when: {
        kind: "inherited",
        at: item.ranAt,
        from: "the import run's clock — import_run_items carries no timestamp of its own",
      },
      actorKind: "engine",
      metadata: { reason: item.kind },
    });
  }

  // ── checkout_started ────────────────────────────────────────────────────────
  // `reservedAt` is set on the FIRST write and never moved (§2.8.7), so unlike `updatedAt` it
  // still means what it says after any number of retries. An imported row has none.
  if (r.reservedAt !== undefined) {
    out.push({
      id: `checkout_started:${String(r.id)}`,
      type: "checkout_started",
      when: { kind: "recorded", at: r.reservedAt },
      actorKind: "customer",
      metadata: { ...(r.checkoutAttempts !== undefined ? { reason: `${r.checkoutAttempts} attempt(s)` } : {}) },
    });
  }

  // ── checkout_lapsed: the one entry with no row anywhere ─────────────────────
  //
  // **Asked through `isLivePending`, not re-derived** (`@code-review`). The first cut computed
  // the lapse from `r.holdMinutes`, which is the wrong number and the wrong shape both:
  //
  //   - `Reservation.holdMinutes` is how long the row occupies the HULL (§2.8.3, frozen from the
  //     offering, commonly 120m). `entities.ts` labels the trap in the field's own docstring —
  //     *"Not the payment window — that is `PAYMENT_WINDOW_MINUTES`, a setting, and confusingly
  //     the same word."* §2.8.1 is equally blunt: *"the payment window is a setting, not a
  //     column."* The trail was dating the lapse hours after it happened.
  //   - An **admin-source** pending row has no payment window and never lapses at all (DEC-163),
  //     which `isLivePending` knows and open-coded arithmetic does not. That row was getting a
  //     `checkout_lapsed` entry for an event that cannot occur.
  //
  // Both disappear by asking the predicate the rest of the engine asks. This is the fifth time
  // this session that a helper existed and a new call site hand-rolled past it — after
  // `pgConnectionConfig`, `logSwallowed`, the truncate list and `describeSendFailure`.
  //
  // `computed` rather than `inherited`: the arithmetic is exact. What is notional is the EVENT —
  // nothing fires at the lapse, `abandonment.ts` says so directly (*"Nothing deletes a lapsed
  // row"*), and the instant exists only because something subtracted. A reader should know that
  // no system observed this moment.
  if (r.status === "pending" && r.reservedAt !== undefined && !isLivePending(r, pendingLiveSince(asOf))) {
    const minutes = input.paymentWindowMinutes ?? PAYMENT_WINDOW_MINUTES;
    const lapsedAt = new Date(Date.parse(r.reservedAt) + minutes * 60_000).toISOString();
    out.push({
      id: `checkout_lapsed:${String(r.id)}`,
      type: "checkout_lapsed",
      when: {
        kind: "computed",
        at: lapsedAt,
        from: `reservedAt + the ${minutes}m payment window — nothing fires at the lapse and no row records it`,
      },
      actorKind: "engine",
      metadata: {},
    });
  }

  // ── booked, cancelled and refunded are NOT here any more (issue #1048) ─────
  //
  // They were, and projecting them was the module's ugliest code: all three read
  // `reservations.updated_at` or `payments.created_at`, neither of which holds the moment the
  // thing happened. `updated_at` is last-write-wins, so a cancel overwrites the booking's time;
  // `payments.created_at` is the charge's, not the refund's. The projections carried an
  // `inherited` stamp explaining that the time was borrowed, which was honest and was still a
  // timeline whose most important line was a guess.
  //
  // They are emitted now — `EMITTED_TRAIL_TYPES` carries the reasoning and DEC-118 carries the
  // test (does the TRANSITION persist, not does the FACT). `admin_booked` went with them and was
  // not replaced: it was `source = 'admin'` wearing a type, and the emitted `booked` row says it
  // with `actorKind`.
  //
  // **Nothing replaces them here, deliberately.** A fallback that projected `booked` for a row
  // with no emitted event would quietly resurrect the bad timestamp for every booking made
  // before the emitter shipped — and DEC-118's posture on exactly this is "no backfill: the
  // unlogged history was never persisted, so capture starts at ship, and the UI says so."

  // ── confirmation_sent ───────────────────────────────────────────────────────
  // Its own column, written by the claim that won the right to send (15.3, issue #971). One of
  // the few derived facts whose time is genuinely its own.
  if (r.confirmationSentAt !== undefined) {
    out.push({
      id: `confirmation_sent:${String(r.id)}`,
      type: "confirmation_sent",
      when: { kind: "recorded", at: r.confirmationSentAt },
      actorKind: "engine",
      metadata: {},
    });
  }

  // ── Money: payment_succeeded, and dispute_opened ────────────────────────────
  //
  // `payment_succeeded` has an honest time: `payments.createdAt` IS when the charge was
  // recorded, so the row and the event are the same thing.
  //
  // `refunded` used to be derived here from `refundedCents > 0` and is emitted now — that field
  // is a running total with no clock, so the entry was dated from the charge, which could be
  // months earlier. It is the one of the three that also had a *correctness* problem beyond the
  // date: `refundedCents` is cumulative, so two partial refunds produced one entry.
  //
  // `dispute_opened` stays, and stays undated. Its transition leaves a durable artifact a human
  // can reach — Stripe owns the dispute workflow (issue #723 is record-only) and the dashboard
  // has the date — which is the difference between it and `booked`. Every state an operator must
  // act on is emitted: `dispute_inquiry`, `_lost`, `_won`, `_unknown`.
  for (const p of payments) {
    out.push({
      id: `payment_succeeded:${String(p.id)}`,
      type: "payment_succeeded",
      when: { kind: "recorded", at: p.createdAt },
      actorKind: "customer",
      metadata: { actualCents: p.amountCents, reason: p.kind },
    });
    if (p.status === "disputed" || p.status === "dispute_lost") {
      out.push({
        id: `dispute_opened:${String(p.id)}`,
        type: "dispute_opened",
        when: {
          kind: "inherited",
          at: p.createdAt,
          from: "the CHARGE's time — no column records when the dispute opened",
        },
        actorKind: "stripe",
        metadata: { actualCents: p.amountCents },
      });
    }
  }

  // ── gratuity_added ──────────────────────────────────────────────────────────
  for (const g of gratuities) {
    out.push({
      id: `gratuity_added:${String(g.id)}`,
      type: "gratuity_added",
      when: { kind: "recorded", at: g.createdAt },
      actorKind: g.kind === "pre" ? "customer" : "admin",
      metadata: { actualCents: g.amountCents, reason: g.kind },
    });
  }

  // Oldest first. `TIE_RANK` settles the instants that genuinely collide; `id` settles the rest
  // deterministically, so two adapters and two renders cannot disagree about the order.
  return out.sort(
    (a, b) =>
      whenAt(a.when).localeCompare(whenAt(b.when)) ||
      (TIE_RANK[a.type] ?? DEFAULT_RANK) - (TIE_RANK[b.type] ?? DEFAULT_RANK) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Load one booking's five sources and derive its trail.
 *
 * The thin half. `reservationTrail` above is pure and holds every rule; this does four reads and
 * hands them over — the same split as `calendar-detail.ts`, and what lets the whole union be
 * tested without a repository.
 *
 * Four reads rather than one, and that is fine HERE and nowhere else: this runs once per detail
 * pane. Issue #1049 must not call it in a loop — a list of bookings would be 4N round trips, and
 * `listImportItemsForRef` has no index on `ref_id`.
 *
 * Returns `null` for a reservation that does not exist, rather than an empty trail: "no history"
 * and "no such booking" are different answers and a surface should be able to tell them apart.
 */
export async function loadReservationTrail(
  repo: Repository,
  reservationId: ReservationId,
  now: () => string,
): Promise<TrailEntry[] | null> {
  const reservation = await repo.getReservation(reservationId);
  if (!reservation) return null;
  const [payments, gratuities, imports, emitted] = await Promise.all([
    repo.listPaymentsForReservation(reservationId),
    repo.listGratuitiesForReservation(reservationId),
    repo.listImportItemsForRef(String(reservationId)),
    // §2.8.5 keeps every intent this checkout minted, so a superseded one's rows are this
    // booking's too. Absent on an imported or admin row, where the empty list is correct.
    repo.listTrailEventsFor(reservationId, reservation.paymentIntentIds ?? []),
  ]);
  return reservationTrail({ reservation, payments, gratuities, imports, emitted, asOf: now() });
}
