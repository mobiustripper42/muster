/**
 * The union read (issue #1048).
 *
 * Every case here is about ONE of two things: does the union find the fact at all, and does it
 * tell the truth about when the fact happened. The second is the hard half — four of the eleven
 * derived types have no timestamp of their own, and a trail that hides that reads as
 * authoritative while being partly invented.
 */

import { describe, expect, it } from "vitest";
import type { Gratuity, Payment, Reservation } from "../domain/entities.js";
import type { ImportItemAtRun } from "../import/import-audit.js";
import type { TrailEvent } from "../domain/reservation-trail.js";
import { asId } from "../domain/ids.js";
import { reservationTrail, type TrailInputs } from "./reservation-trail-view.js";

const RES = asId<"ReservationId">("resv-1");
const ASOF = "2026-07-04T18:00:00.000Z";

const reservation = (over: Partial<Reservation> = {}): Reservation => ({
  id: RES,
  eventId: null,
  source: "muster",
  status: "pending",
  customerName: "Mary",
  partySize: 4,
  reservedAt: "2026-07-04T12:00:00.000Z",
  holdMinutes: 15,
  updatedAt: "2026-07-04T12:05:00.000Z",
  ...over,
});

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: asId<"PaymentId">("pay-1"),
  reservationId: RES,
  method: "stripe",
  kind: "full",
  amountCents: 50000,
  taxCents: 0,
  currency: "usd",
  status: "succeeded",
  createdAt: "2026-07-04T12:04:00.000Z",
  ...over,
});

const inputs = (over: Partial<TrailInputs> = {}): TrailInputs => ({
  reservation: reservation(),
  payments: [],
  gratuities: [],
  imports: [],
  emitted: [],
  asOf: ASOF,
  ...over,
});

const types = (rows: { type: string }[]) => rows.map((r) => r.type);

describe("reservationTrail — finding the facts", () => {
  it("unions all five sources into one ordered list", () => {
    // The acceptance criterion from the issue, stated as one case: an import, a payment, a
    // confirmation and an emitted event all show up, in the order they happened.
    const rows = reservationTrail(
      inputs({
        reservation: reservation({
          status: "booked",
          eventId: asId<"EventId">("ev-1"),
          updatedAt: "2026-07-04T12:05:00.000Z",
          confirmationSentAt: "2026-07-04T12:06:00.000Z",
        }),
        payments: [payment()],
        gratuities: [
          {
            id: asId<"GratuityId">("grat-1"),
            eventId: asId<"EventId">("ev-1"),
            reservationId: RES,
            kind: "pre",
            amountCents: 5000,
            createdAt: "2026-07-04T12:07:00.000Z",
          } satisfies Gratuity,
        ],
        imports: [
          {
            kind: "reservation_added",
            runId: asId<"ImportRunId">("run-1"),
            ranAt: "2026-07-04T11:00:00.000Z",
            label: "Mary",
          } satisfies ImportItemAtRun,
        ],
        emitted: [
          {
            // `booked` is an EMITTED row as of issue #1048 — a real event with its own time,
            // where it used to be projected from `status` and dated from `updated_at`.
            id: asId<"TrailEventId">("booked:resv-1"),
            reservationId: RES,
            actorKind: "customer",
            type: "booked",
            timestamp: "2026-07-04T12:05:00.000Z",
            metadata: { via: "webhook" },
          } satisfies TrailEvent,
          {
            id: asId<"TrailEventId">("confirmation_skipped:x"),
            reservationId: RES,
            actorKind: "engine",
            type: "confirmation_skipped",
            timestamp: "2026-07-04T12:08:00.000Z",
            metadata: {},
          } satisfies TrailEvent,
        ],
      }),
    );

    expect(types(rows)).toEqual([
      "imported", //             11:00  the run's clock
      "checkout_started", //     12:00  reservedAt
      "payment_succeeded", //    12:04  payments.createdAt
      "booked", //               12:05  emitted — its OWN row and clock
      "confirmation_sent", //    12:06  its own column
      "gratuity_added", //       12:07  gratuity.createdAt
      "confirmation_skipped", // 12:08  emitted, its own row
    ]);
    // And the dimension that could never be filled while this was a projection.
    expect(rows.find((r) => r.type === "booked")?.metadata.via).toBe("webhook");
  });

  it("matches an emitted row on the PAYMENT INTENT key, not just the reservation", () => {
    // The trail has two keys on purpose and some types only ever carry the second. A union
    // that matched on `reservationId` alone would drop the money events for a booking that was
    // never written — the exact class the second key exists for.
    const rows = reservationTrail(
      inputs({
        emitted: [
          {
            id: asId<"TrailEventId">("auto_refunded:pi_9"),
            paymentIntentId: asId<"PaymentIntentId">("pi_9"),
            actorKind: "engine",
            type: "auto_refunded",
            timestamp: "2026-07-04T12:09:00.000Z",
            metadata: {},
          } satisfies TrailEvent,
        ],
      }),
    );
    // The adapter does the matching; this pins that the view does not then DROP a row whose
    // reservation key is absent.
    expect(types(rows)).toContain("auto_refunded");
  });

  it("shows one entry per import run, because an upstream change is its own fact", () => {
    // `import_run_items` carries added / updated / cancelled as separate rows. Collapsing them
    // into one `imported` would discard exactly what makes that table authoritative (DEC-056),
    // and the trail would go silent about a Xola-side cancellation.
    const rows = reservationTrail(
      inputs({
        imports: [
          { kind: "reservation_added", runId: asId<"ImportRunId">("r1"), ranAt: "2026-07-01T00:00:00.000Z", label: "M" },
          { kind: "reservation_updated", runId: asId<"ImportRunId">("r2"), ranAt: "2026-07-02T00:00:00.000Z", label: "M" },
          { kind: "reservation_cancelled", runId: asId<"ImportRunId">("r3"), ranAt: "2026-07-03T00:00:00.000Z", label: "M" },
        ],
      }),
    );
    const imported = rows.filter((r) => r.type === "imported");
    expect(imported).toHaveLength(3);
    expect(imported.map((r) => r.metadata.reason)).toEqual([
      "reservation_added",
      "reservation_updated",
      "reservation_cancelled",
    ]);
  });

  it("ignores a SHIFT import item that happens to share the ref column", () => {
    const rows = reservationTrail(
      inputs({
        imports: [
          { kind: "shift_created", runId: asId<"ImportRunId">("r1"), ranAt: "2026-07-01T00:00:00.000Z", label: null },
        ],
      }),
    );
    expect(types(rows)).not.toContain("imported");
  });

});

/**
 * **The three facts that stopped being derived (issue #1048).**
 *
 * `booked`, `cancelled` and `refunded` were projected here, each dated from a column that does
 * not hold the moment it happened. They are emitted now, so this module must project NONE of
 * them — and must not grow a fallback that re-invents the bad timestamp for a booking made
 * before the emitters shipped. DEC-118's posture on that is explicit: no backfill, capture
 * starts at ship, and the surface says so.
 */
describe("reservationTrail — booked / cancelled / refunded are NOT projected", () => {
  it("projects nothing for a booked row with no emitted event", () => {
    const rows = reservationTrail(
      inputs({
        reservation: reservation({ status: "booked", eventId: asId<"EventId">("ev-1") }),
      }),
    );
    expect(types(rows)).not.toContain("booked");
    expect(types(rows)).not.toContain("admin_booked");
  });

  it("projects nothing for an ADMIN-sourced booking either", () => {
    // `admin_booked` is gone from the vocabulary entirely — it was `source = 'admin'` wearing a
    // type, and the emitted `booked` row says it with `actorKind` instead.
    //
    // **That half is enforced by the compiler, not by this case.** The first draft asserted
    // `r.type === "admin_booked"` and typecheck refused it: the literal is no longer a member of
    // `TrailEventType`, so the comparison could never be true and the assertion was a tautology
    // dressed as a check. A type that makes the wrong answer unwriteable beats a test that looks
    // for it — which is the same argument `EMITTED_TRAIL_TYPES` is built on.
    const rows = reservationTrail(
      inputs({
        reservation: reservation({ source: "admin", status: "booked", eventId: asId<"EventId">("ev-1") }),
      }),
    );
    expect(types(rows)).not.toContain("booked");
  });

  it("projects nothing for a cancelled row", () => {
    const rows = reservationTrail(
      inputs({
        reservation: reservation({
          status: "cancelled",
          eventId: asId<"EventId">("ev-1"),
          cancelledBy: "operator",
          updatedAt: "2026-07-04T15:00:00.000Z",
        }),
      }),
    );
    expect(types(rows)).not.toContain("cancelled");
  });

  it("projects nothing from refundedCents — a cumulative total is not an event", () => {
    // The extra reason this one had to move: `refundedCents` is a RUNNING TOTAL, so two partial
    // refunds produced one entry however it was dated.
    const rows = reservationTrail(inputs({ payments: [payment({ refundedCents: 50000 })] }));
    expect(types(rows)).not.toContain("refunded");
  });

  it("shows them when they ARE emitted, with their own times", () => {
    const rows = reservationTrail(
      inputs({
        reservation: reservation({ status: "cancelled", eventId: asId<"EventId">("ev-1") }),
        emitted: [
          {
            id: asId<"TrailEventId">("booked:resv-1"),
            reservationId: RES,
            actorKind: "admin",
            actorId: "crew-9",
            type: "booked",
            timestamp: "2026-07-04T12:05:00.000Z",
            metadata: { via: "webhook" },
          } satisfies TrailEvent,
          {
            id: asId<"TrailEventId">("cancelled:x"),
            reservationId: RES,
            actorKind: "admin",
            actorId: "crew-9",
            type: "cancelled",
            timestamp: "2026-07-04T17:00:00.000Z",
            metadata: { reason: "cancelled by operator" },
          } satisfies TrailEvent,
        ],
      }),
    );
    const booked = rows.find((r) => r.type === "booked");
    const cancelled = rows.find((r) => r.type === "cancelled");
    // Five hours apart, each recorded, each its own — which is the whole point of the move.
    expect(booked?.when).toEqual({ kind: "recorded", at: "2026-07-04T12:05:00.000Z" });
    expect(cancelled?.when).toEqual({ kind: "recorded", at: "2026-07-04T17:00:00.000Z" });
  });
});

describe("reservationTrail — telling the truth about WHEN", () => {
  it("marks a recorded time as recorded", () => {
    const [row] = reservationTrail(inputs()).filter((r) => r.type === "checkout_started");
    expect(row?.when).toEqual({ kind: "recorded", at: "2026-07-04T12:00:00.000Z" });
  });

  it("an import inherits the RUN's clock and says so", () => {
    const [row] = reservationTrail(
      inputs({
        imports: [
          { kind: "reservation_added", runId: asId<"ImportRunId">("r1"), ranAt: "2026-07-01T00:00:00.000Z", label: "M" },
        ],
      }),
    ).filter((r) => r.type === "imported");
    expect(row?.when.kind).toBe("inherited");
    // The reason has to name the borrowed clock, or a reader takes it for the item's own.
    expect(row?.when.kind === "inherited" && row.when.from).toMatch(/import run/i);
  });

  it("a dispute inherits the CHARGE's clock — the last derived fact with no column", () => {
    // `dispute_opened` stays derived where `refunded` moved, and the difference is where the
    // truth lives: Stripe owns the dispute workflow and its dashboard has the date, so the
    // transition is not lost — just not ours. Every state an operator must act on is emitted.
    const rows = reservationTrail(inputs({ payments: [payment({ status: "dispute_lost" })] }));
    const row = rows.find((r) => r.type === "dispute_opened");
    expect(row?.when.kind).toBe("inherited");
    expect(row?.when.at).toBe("2026-07-04T12:04:00.000Z"); // the charge, not the dispute
    expect(row?.when.kind === "inherited" && row.when.from).toMatch(/CHARGE/);
  });
});

describe("reservationTrail — checkout_lapsed, the entry with no row anywhere", () => {
  it("fires for a pending row past its window, marked computed", () => {
    const [row] = reservationTrail(inputs()).filter((r) => r.type === "checkout_lapsed");
    // reservedAt 12:00 + the 15m payment window
    expect(row?.when).toEqual({
      kind: "computed",
      at: "2026-07-04T12:15:00.000Z",
      from: expect.stringContaining("payment window"),
    });
  });

  it("does NOT fire while the row is still inside its window", () => {
    // Showing it here would be predicting, not recording.
    const rows = reservationTrail(inputs({ asOf: "2026-07-04T12:10:00.000Z" }));
    expect(types(rows)).not.toContain("checkout_lapsed");
  });

  it("does NOT fire for a booked row, whatever its dates say", () => {
    const rows = reservationTrail(
      inputs({
        reservation: reservation({ status: "booked", eventId: asId<"EventId">("ev-1") }),
      }),
    );
    expect(types(rows)).not.toContain("checkout_lapsed");
  });

  it("uses the PAYMENT WINDOW, not the row's frozen hull hold — they are different numbers", () => {
    // **This case asserted the opposite until `@code-review` caught it.** `Reservation.
    // holdMinutes` is how long the row occupies the HULL (§2.8.3, frozen from the offering);
    // the payment window is a setting (§2.8.1: "not a column"). `entities.ts` labels the trap in
    // the field's own docstring — "confusingly the same word" — and I used it anyway, then wrote
    // a test citing §2.8.3 to lock it in. A real checkout freezes 120m of hull for a 15m window,
    // so the trail dated the lapse nearly two hours late.
    const [row] = reservationTrail(
      inputs({ reservation: reservation({ holdMinutes: 120 }), paymentWindowMinutes: 15 }),
    ).filter((r) => r.type === "checkout_lapsed");
    expect(row?.when.at).toBe("2026-07-04T12:15:00.000Z"); // reservedAt 12:00 + the WINDOW
  });

  it("does NOT fire for an ADMIN-source row, which has no window and never lapses", () => {
    // DEC-163, which `isLivePending` already knew and the open-coded arithmetic did not. An
    // admin booking held indefinitely was being shown an expiry that cannot happen.
    const rows = reservationTrail(
      inputs({
        reservation: reservation({ source: "admin" }),
        asOf: "2026-08-01T00:00:00.000Z", // weeks later
      }),
    );
    expect(types(rows)).not.toContain("checkout_lapsed");
  });
});

describe("reservationTrail — ordering is deterministic", () => {
  it("settles a same-instant money collision by cause, not by chance", () => {
    // Both of these read `payments.createdAt`. Without a causal rank their order would be
    // whatever the loop produced — and a dispute cannot precede the charge it is against.
    const rows = reservationTrail(
      inputs({ payments: [payment({ status: "dispute_lost" })] }),
    ).filter((r) => ["payment_succeeded", "dispute_opened"].includes(r.type));
    expect(types(rows)).toEqual(["payment_succeeded", "dispute_opened"]);
  });

  it("produces the same order however the inputs are arranged", () => {
    const base = inputs({
      reservation: reservation({ status: "booked", eventId: asId<"EventId">("ev-1") }),
      payments: [payment(), payment({ id: asId<"PaymentId">("pay-2"), createdAt: "2026-07-04T12:04:00.000Z" })],
      gratuities: [],
      imports: [
        { kind: "reservation_added", runId: asId<"ImportRunId">("r2"), ranAt: "2026-07-01T00:00:00.000Z", label: "M" },
        { kind: "reservation_added", runId: asId<"ImportRunId">("r1"), ranAt: "2026-07-01T00:00:00.000Z", label: "M" },
      ],
    });
    const forward = reservationTrail(base).map((r) => r.id);
    const reversed = reservationTrail({
      ...base,
      payments: [...base.payments].reverse(),
      imports: [...base.imports].reverse(),
    }).map((r) => r.id);
    expect(reversed).toEqual(forward);
  });
});
