/**
 * The booking-audit seed's pure half (issue #1049) — one row of every event type, built without
 * a clock, a database or a random number.
 *
 * ## What a green run of `db:seed:trail` proves, and what it does not
 *
 * **It proves the SURFACE renders.** Every one of the 33 types gets a row, so
 * `/admin/booking-audit` and a booking's History panel can be looked at with a realistic amount
 * of material in them — labels that wrap, a 40-character id, a borrowed timestamp, the two rows
 * that belong to no booking at all. That is worth having, because most of these types are error
 * paths nobody can trigger on a dev box on demand: a dispute arriving in a state the pinned
 * Stripe SDK cannot name, a refund failing partway, the residual-race loser.
 *
 * **It proves nothing about whether the emitters fire at the right moment.** Not one row here
 * goes through an emitter. The proof for that is the unit tests in issues #1050, #1051 and
 * #1052, each written against its real call site, and reading a green seed run as evidence the
 * audit is CORRECT is reading it wrong.
 *
 * The operator's own caveat, carried because it is the right posture: *"I'll need to decide if
 * it's contrived, but it would prove something."* If the seeded rows read as obviously synthetic
 * with the page open, that is itself a finding about the surface — real rows are terser and less
 * tidy than anything written by hand here.
 *
 * ## Why the derived half needs more than trail rows
 *
 * Seven of the 33 are not stored; they are worked out from `reservations`, `payments`,
 * `gratuity` and `import_run_items` at read time (`reservation-trail-view.ts`). So this returns
 * those supporting facts too — a paid payment, a disputed one, a tip, an import run — and the
 * script writes them. Seeding a `payment_succeeded` trail row instead would produce a page that
 * looks right and exercises none of the union.
 */

import type { Gratuity, Payment, Reservation } from "../domain/entities.js";
import type { ImportRun, ImportRunItem } from "../import/import-audit.js";
import type { ReservationId, TrailEventId } from "../domain/ids.js";
import { asId } from "../domain/ids.js";
import { EMITTED_TRAIL_TYPES, type TrailEvent } from "../domain/reservation-trail.js";

/** Minutes before the anchor instant, so the rows land in a readable order and span six days —
 *  enough that a reader scrolling the feed sees more than one date, and enough that the
 *  booking's History panel is a story rather than a burst. */
const DAY = 24 * 60;

export interface SeededTrail {
  /** The emitted rows — one per member of `EMITTED_TRAIL_TYPES`, plus nothing else. */
  events: TrailEvent[];
  /** Supporting facts the DERIVED half is read from. */
  payments: Payment[];
  gratuity: Gratuity;
  importRun: { run: ImportRun; items: ImportRunItem[] };
  /** Fields the seed sets on the booking itself so `checkout_started` and `confirmation_sent`
   *  have something to project from. */
  reservationPatch: Pick<Reservation, "reservedAt" | "confirmationSentAt" | "checkoutAttempts">;
  /**
   * A SECOND booking, deliberately abandoned — and the seed does not work without it.
   *
   * `checkout_lapsed` is the one type that cannot appear on the main row: the deriver only emits
   * it for a `pending` row past its payment window, and a booked row did not lapse whatever its
   * dates say. The demo world builds only `booked` reservations, so without this the seed
   * covers 32 of 33 and the missing one is the abandoned-checkout story `/admin/abandonment`
   * exists for.
   *
   * **The script's verify step is what found this**, by running the real union read over what it
   * had just written and reporting the gap — which is the entire argument for verifying with
   * the reader rather than counting your own writes.
   */
  lapsedCheckout: Reservation;
}

/**
 * Build the whole set against one booking.
 *
 * `anchorISO` is "now" as the caller sees it; everything is placed before it, so the newest row
 * is minutes old and the oldest is six days back. Ids are deterministic and keyed on the
 * reservation, so re-running upserts rather than accumulating — the adapter's
 * `on conflict (id) do nothing` does the rest.
 */
export function buildSeededTrail(input: {
  reservationId: ReservationId;
  paymentIntentId: string;
  anchorISO: string;
  customerName: string;
  eventId: string;
  /** The slot the abandoned second booking sits on — any real one from the demo world. */
  slot: { vesselId: string; date: string; time: string; offeringId: string };
}): SeededTrail {
  const { reservationId, paymentIntentId, anchorISO, customerName, eventId, slot } = input;
  const at = (minutesAgo: number): string =>
    new Date(Date.parse(anchorISO) - minutesAgo * 60_000).toISOString();
  const pi = asId<"PaymentIntentId">(paymentIntentId);
  const id = (type: string): TrailEventId =>
    asId<"TrailEventId">(`seed:${type}:${String(reservationId)}`);

  /** Every emitted type, with the metadata its real emitter would carry and a minutes-ago slot.
   *  Ordered as the story happened, oldest first; the table sorts on `timestamp` either way. */
  const spec: {
    type: (typeof EMITTED_TRAIL_TYPES)[number];
    minutesAgo: number;
    actorKind: TrailEvent["actorKind"];
    actorId?: string;
    metadata: TrailEvent["metadata"];
    /** Set for the two rows that belong to no booking — the class a booking-scoped view cannot
     *  show, and the reason the feed page exists. */
    keyless?: "chargeOnly" | "neither";
  }[] = [
    // ── Six days back: the checkout that did not go smoothly ──────────────
    { type: "sold_out", minutesAgo: 6 * DAY, actorKind: "customer",
      metadata: { offeringId: "off-demo", date: "2026-09-19", time: "17:00", guestCount: 6 } },
    { type: "hull_contended", minutesAgo: 6 * DAY - 30, actorKind: "customer",
      metadata: { wantedVesselId: "vessel-brew-2", gotVesselId: "vessel-brew-4", offeringId: "off-demo", date: "2026-09-19", time: "17:00", guestCount: 4 } },
    { type: "checkout_details_changed", minutesAgo: 6 * DAY - 45, actorKind: "customer",
      metadata: { previous: { customerName: "Mary Brody", phone: "+12165550100" } } },
    { type: "payment_failed", minutesAgo: 6 * DAY - 50, actorKind: "stripe",
      metadata: { reason: "card_declined" } },
    { type: "payment_superseded", minutesAgo: 6 * DAY - 55, actorKind: "engine",
      metadata: { reason: "replaced by a fresh intent at the current amount" } },

    // ── Five days back: the sale ──────────────────────────────────────────
    { type: "booked", minutesAgo: 5 * DAY, actorKind: "customer", metadata: { via: "webhook" } },
    { type: "confirmation_skipped", minutesAgo: 5 * DAY - 1, actorKind: "engine",
      metadata: { reason: "MESSAGING is off for this deployment" } },
    { type: "link_resent", minutesAgo: 5 * DAY - 120, actorKind: "admin", actorId: "crew-demo-admin",
      metadata: { reason: "email=sent sms=sent" } },
    { type: "change_requested", minutesAgo: 4 * DAY, actorKind: "customer",
      metadata: { reason: "asked to move from 5:30 to 7:30" } },
    { type: "link_recovery_requested", minutesAgo: 4 * DAY - 60, actorKind: "customer",
      metadata: { reason: "sent" } },
    { type: "link_reissued", minutesAgo: 4 * DAY - 90, actorKind: "admin", actorId: "crew-demo-admin",
      metadata: { reason: "LOCKED OUT — old link revoked, new link not delivered" } },

    // ── Three days back: the money coming back ────────────────────────────
    { type: "balance_link_created", minutesAgo: 3 * DAY, actorKind: "admin", actorId: "crew-demo-admin",
      metadata: { actualCents: 37500, chargeRef: "cs_seed_balance" } },
    { type: "refund_issued_by_operator", minutesAgo: 3 * DAY - 30, actorKind: "admin", actorId: "crew-demo-admin",
      metadata: { quotedCents: 45000, actualCents: 50000, reason: "cancel-and-refund" } },
    { type: "refund_failed", minutesAgo: 3 * DAY - 25, actorKind: "admin", actorId: "crew-demo-admin",
      metadata: { actualCents: 0, reason: "the provider refused the second charge" } },
    { type: "refunded", minutesAgo: 3 * DAY - 20, actorKind: "stripe", metadata: { actualCents: 50000 } },
    { type: "cancelled", minutesAgo: 3 * DAY - 15, actorKind: "admin", actorId: "crew-demo-admin",
      metadata: { reason: "cancelled by operator" } },

    // ── Two days back: the residual race, start to finish ─────────────────
    { type: "auto_refunded", minutesAgo: 2 * DAY, actorKind: "engine",
      metadata: { reason: "residual-race loss" } },
    { type: "sold_out_notice_sent", minutesAgo: 2 * DAY - 5, actorKind: "engine",
      metadata: { reason: "email" } },
    { type: "sold_out_notice_failed", minutesAgo: 2 * DAY - 4, actorKind: "engine",
      metadata: { reason: "sms — the carrier rejected the number" } },

    // ── Yesterday: the chargeback, all four states ────────────────────────
    { type: "dispute_inquiry", minutesAgo: DAY + 180, actorKind: "stripe",
      metadata: { reason: "product_not_received" } },
    { type: "dispute_lost", minutesAgo: DAY + 120, actorKind: "stripe",
      metadata: { reason: "product_not_received" } },
    { type: "dispute_won", minutesAgo: DAY + 60, actorKind: "stripe",
      metadata: { reason: "fraudulent" } },
    { type: "dispute_unknown", minutesAgo: DAY, actorKind: "stripe",
      metadata: { reason: "a status this deploy does not recognise" } },

    // ── Today: the operator's own hands, and the two orphans ──────────────
    { type: "slot_held", minutesAgo: 240, actorKind: "admin", actorId: "crew-demo-admin",
      metadata: { reason: "mechanical — taken off the market" }, keyless: "neither" },
    { type: "slot_released", minutesAgo: 120, actorKind: "admin", actorId: "crew-demo-admin",
      metadata: { reason: "back on the market" }, keyless: "neither" },
    // **The row the feed page exists for.** Money Muster cannot place against any booking; a
    // booking-scoped view has nowhere to render it, so without the feed it is written and never
    // read. Deliberately last so it is the first thing on screen.
    { type: "charge_unmatched", minutesAgo: 15, actorKind: "stripe",
      metadata: { reason: "refund_on_unknown_charge", chargeRef: "pi_seed_orphan" },
      keyless: "chargeOnly" },
  ];

  const events: TrailEvent[] = spec.map((s) => ({
    id: id(s.type),
    ...(s.keyless === undefined ? { reservationId } : {}),
    ...(s.keyless === "neither"
      ? {}
      : { paymentIntentId: s.keyless === "chargeOnly" ? asId<"PaymentIntentId">("pi_seed_orphan") : pi }),
    actorKind: s.actorKind,
    ...(s.actorId !== undefined ? { actorId: s.actorId } : {}),
    type: s.type,
    timestamp: at(s.minutesAgo),
    metadata: s.metadata,
  }));

  return {
    events,
    payments: [
      // `payment_succeeded` reads this row; `refunded` used to and no longer does.
      {
        id: asId<"PaymentId">(`seed-pay-${String(reservationId)}`),
        reservationId,
        method: "stripe",
        kind: "deposit",
        amountCents: 16125,
        taxCents: 3625,
        currency: "usd",
        stripePaymentIntentId: paymentIntentId,
        status: "succeeded",
        createdAt: at(5 * DAY),
      },
      // A second charge in a dispute state, so `dispute_opened` — the last derived fact with no
      // clock of its own — has something to project from.
      {
        id: asId<"PaymentId">(`seed-pay-disputed-${String(reservationId)}`),
        reservationId,
        method: "stripe",
        kind: "balance",
        amountCents: 37500,
        taxCents: 0,
        currency: "usd",
        status: "disputed",
        createdAt: at(3 * DAY),
      },
    ],
    gratuity: {
      id: asId<"GratuityId">(`seed-grat-${String(reservationId)}`),
      eventId: asId<"EventId">(eventId),
      reservationId,
      kind: "pre",
      amountCents: 9980,
      bps: 2000,
      createdAt: at(5 * DAY - 2),
    },
    importRun: {
      run: {
        id: asId<"ImportRunId">(`seed-run-${String(reservationId)}`),
        source: "manual-pull",
        ranAt: at(6 * DAY + 60),
        window: { start: "2026-09-15", end: "2026-10-15" },
        // Every counter, because `ImportRunSummary` requires them. Only `reservationsAdded`
        // matters to the audit — the rest exist so `/admin/import` can render this run too
        // rather than choking on a half-built one.
        summary: {
          ordersFetched: 1,
          eventsFetched: 1,
          boatedEvents: 1,
          excludedResources: 0,
          recordsMapped: 1,
          mapSkipped: 0,
          eventsCreated: 0,
          reservationsAdded: 1,
          reservationsUpdated: 0,
          reservationsNewlyCancelled: 0,
          shiftsCreated: 0,
          shiftsCancelled: 0,
          seatsCreated: 0,
          seatsPruned: 0,
          seatsStranded: 0,
          unmappedResources: [],
          skipped: [],
          bookedNoBoat: [],
          warnings: [],
          assignments: [],
          splitDaysChanged: [],
        },
      },
      items: [
        {
          id: asId<"ImportRunItemId">(`seed-run-${String(reservationId)}-item-0001`),
          runId: asId<"ImportRunId">(`seed-run-${String(reservationId)}`),
          kind: "reservation_added",
          refId: String(reservationId),
          label: customerName,
        },
      ],
    },
    reservationPatch: {
      reservedAt: at(6 * DAY - 60),
      confirmationSentAt: at(5 * DAY - 1),
      checkoutAttempts: 3,
    },
    // Reserved two days ago against a 15-minute window, so it is unambiguously lapsed at any
    // plausible reading clock. `source: "muster"` matters: an admin-source pending row has no
    // window and never lapses (DEC-163), which would reintroduce the gap this row closes.
    lapsedCheckout: {
      id: asId<"ReservationId">(`resv-seed-abandoned-${String(reservationId)}`),
      eventId: null,
      source: "muster",
      status: "pending",
      customerName: "Dana Quint",
      partySize: 2,
      vesselId: asId<"VesselId">(slot.vesselId),
      date: slot.date,
      time: slot.time,
      offeringId: asId<"OfferingId">(slot.offeringId),
      reservedAt: at(2 * DAY),
      holdMinutes: 120,
      tripMinutes: 100,
      checkoutAttempts: 2,
      updatedAt: at(2 * DAY),
    },
  };
}
