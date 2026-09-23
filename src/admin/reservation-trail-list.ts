/**
 * The reservation trail's cross-booking FEED (issue #1049; tracked by issue #1053).
 *
 * The crew engine's equivalent is `audit-trail.ts` behind `/admin/asks`, and this follows its
 * shape deliberately rather than inventing one: a core module that owns the vocabulary and the
 * filter, a page that owns only the markup.
 *
 * ## What it can and cannot show, and why the page has to say so
 *
 * **The emitted half only.** `reservation-trail-view.ts` assembles ONE booking's history by
 * unioning five sources; doing that across every booking would mean loading every reservation,
 * payment, gratuity and import row in the database on each render. So this reads
 * `listTrailEvents()` and nothing else, and the seven derived types
 * (`checkout_started`, `checkout_lapsed`, `imported`, `confirmation_sent`, `payment_succeeded`,
 * `dispute_opened`, `gratuity_added`) appear only on a booking's own page.
 *
 * **Issue #1048 is what makes that acceptable.** When this surface was specified,
 * `booked`, `cancelled` and `refunded` were derived — so a feed over the emitted half would have
 * been missing the sale, the cancellation and the money going back, which is most of what anyone
 * opens an audit for. They are emitted now, so this carries 26 of the 33 types including every
 * money event.
 *
 * **And it is the ONLY place two classes can be seen at all.** A `charge_unmatched` has no
 * reservation to hang off; a `slot_held` has neither key. A booking-scoped view cannot render
 * them, so without this page they are written and never read.
 *
 * ## Two unbounded reads, and the clock on them is shorter than its model's
 *
 * `listTrailEvents()` returns every row and `listAllReservations()` every booking; the filter
 * runs in memory. That is `buildAuditTrail`'s shape exactly, and DEC-118 named the trade when it
 * chose it — *"**Revisit if:** audit volume outgrows the union read (materialize)."*
 *
 * **The same note is owed here and expires sooner.** The crew log is scoped to a roster that
 * stops growing; this one appends on every checkout attempt, every decline, every sold-out
 * refusal — `sold_out` alone fires on a public form submit with no money behind it. The port
 * already has the precedent for the fix: `listImportRuns(limit)`, whose docstring calls it *"the
 * one place the port's no-DSL thinness yields to a cap."*
 *
 * **Revisit when** the trail passes a few thousand rows, or the first time this page is
 * slow to paint — whichever comes first. The fix is a `limit` on the port method plus a
 * "showing the last N" line here, not a rewrite. Filed rather than built because a cap with no
 * paging control is its own defect, and the paging is not worth designing against 40 rows.
 */

import type { Repository } from "../ports/repository.js";
import type {
  EmittedTrailType,
  TrailActorKind,
  TrailEvent,
  TrailEventType,
} from "../domain/reservation-trail.js";

/**
 * The date capture began — the day `reservation_trail` shipped.
 *
 * **The surface must state this, because an empty trail otherwise reads as "nothing happened".**
 * There is no backfill (issue #886, and DEC-118's posture for the crew log before it: the
 * unlogged history was never persisted, so capture starts at ship). A booking from August has an
 * empty trail because nothing was recording, not because it was uneventful, and those are
 * opposite facts.
 *
 * **One date, and it is deliberately approximate in one direction.** The emitters did not all
 * land together: money-out on 2026-09-20 with the table, money-in and customer-reach on
 * 2026-09-21, and `booked` / `cancelled` / `refunded` with issue #1048 later the same day. A
 * per-type begins-on map would be exact and would be a table nobody keeps true. So the notice
 * states this date and says that some types began recording later — true, checkable, and it
 * promises no precision the data cannot back.
 */
export const TRAIL_BEGINS_AT = "2026-09-20";

/**
 * What each event is called on an operator's screen.
 *
 * Covers BOTH surfaces — the feed renders emitted types, a booking's page renders derived ones
 * too, and one map serves both so the same fact cannot acquire two names. A type added without a
 * label is a build error, not a raw enum string on somebody's screen: the map is a total
 * `Record<TrailEventType, string>` and its test walks both unions.
 *
 * Written to say what HAPPENED rather than to reformat the identifier. `charge_unmatched` is
 * "Charge with no booking" because that is the sentence an operator needs while reconciling a
 * Stripe statement; "Charge unmatched" would make them work it out.
 */
export const TRAIL_TYPE_LABEL: Record<TrailEventType, string> = {
  // ── The spine ────────────────────────────────────────────────────────────
  booked: "Booked",
  cancelled: "Cancelled",
  refunded: "Refund settled",

  // ── Checkout ─────────────────────────────────────────────────────────────
  checkout_started: "Checkout started",
  checkout_lapsed: "Checkout lapsed",
  hull_contended: "Boat decided by a race",
  sold_out: "Sold out at checkout",
  checkout_details_changed: "Customer details overwritten",

  // ── Money in ─────────────────────────────────────────────────────────────
  payment_succeeded: "Paid",
  payment_failed: "Card declined",
  payment_superseded: "Old payment link retired",
  charge_unmatched: "Charge with no booking",
  balance_link_created: "Balance link created",

  // ── Money out ────────────────────────────────────────────────────────────
  refund_issued_by_operator: "Refund issued by operator",
  auto_refunded: "Auto-refunded after losing the boat",
  refund_failed: "Refund failed",
  dispute_opened: "Dispute opened",
  dispute_inquiry: "Dispute inquiry",
  dispute_won: "Dispute won",
  dispute_lost: "Dispute lost",
  dispute_unknown: "Dispute state not recognised",

  // ── Reaching the customer ────────────────────────────────────────────────
  confirmation_sent: "Confirmation sent",
  confirmation_skipped: "Confirmation NOT sent",
  link_resent: "Link resent",
  link_reissued: "Link reissued, old one killed",
  link_recovery_requested: "Link recovery requested",
  change_requested: "Change requested",
  sold_out_notice_sent: "Sold-out notice sent",
  sold_out_notice_failed: "Sold-out notice failed",

  // ── The slot, and the rest ───────────────────────────────────────────────
  slot_held: "Slot held",
  slot_released: "Slot released",
  imported: "Imported from Xola",
  gratuity_added: "Tip added",
};

/** Who acted. `engine` is Muster itself — a sweep, a lapse, the residual-race auto-refund — and
 *  is named for the product rather than the word, because "Engine" means nothing to an operator. */
export const TRAIL_ACTOR_LABEL: Record<TrailActorKind, string> = {
  customer: "Customer",
  admin: "Operator",
  stripe: "Stripe",
  engine: "Muster",
};

export interface TrailListFilter {
  type?: EmittedTrailType;
  actorKind?: TrailActorKind;
}

/**
 * One feed row: the event, plus the customer's name when there is still a booking to read it off.
 *
 * `customerName` is absent in two different situations and the surface must not conflate them —
 * a row with no `reservationId` never had a booking (that is the class this page exists for),
 * while a row WITH one whose booking is gone has outlived it, which is the designed steady state
 * for a table with no foreign key.
 */
export type TrailListRow = TrailEvent & { customerName?: string };

/**
 * The feed, newest first, filtered.
 *
 * Two reads, not N+1: `listTrailEvents` plus one `listAllReservations` to build the name map.
 * That is the same trade `purchases-view.ts` makes and for the same reason — a per-row lookup
 * across a list is the shape that quietly becomes a timeout.
 *
 * Ordering comes from the port contract (`timestamp desc`, insertion-desc tiebreak, identical on
 * both adapters) rather than being re-sorted here, so the feed cannot disagree with the table.
 */
export async function buildReservationTrailList(
  repo: Repository,
  filter: TrailListFilter,
): Promise<TrailListRow[]> {
  const [events, reservations] = await Promise.all([
    repo.listTrailEvents(),
    repo.listAllReservations(),
  ]);
  const nameById = new Map(reservations.map((r) => [String(r.id), r.customerName]));

  return events
    .filter((e) => filter.type === undefined || e.type === filter.type)
    .filter((e) => filter.actorKind === undefined || e.actorKind === filter.actorKind)
    .map((e) => {
      const name = e.reservationId === undefined ? undefined : nameById.get(String(e.reservationId));
      return { ...e, ...(name !== undefined ? { customerName: name } : {}) };
    });
}
