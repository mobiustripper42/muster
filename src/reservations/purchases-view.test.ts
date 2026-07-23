/**
 * Purchases (order) list view model (12.12a, #465). The load-bearing behaviour is the derived
 * payment state — especially that "no money arrived" never reads as "deposit taken".
 */
import { describe, expect, it } from "vitest";
import type { Event, Payment, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import {
  buildPurchaseRows,
  filterByState,
  groupPaymentsByReservation,
  searchPurchases,
  stateCounts,
  type PurchasesInput,
} from "./purchases-view.js";

const TAX = 725;

const event = (id: string, over: Partial<Event> = {}): Event => ({
  id: asId<"EventId">(id),
  vesselId: asId<"VesselId">("v1"),
  date: "2026-08-12",
  time: "13:30",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  price: 49900,
  ...over,
});

const reservation = (id: string, over: Partial<Reservation> = {}): Reservation => ({
  id: asId<"ReservationId">(id),
  eventId: asId<"EventId">("e1"),
  source: "muster",
  customerName: "Jordan Ellis",
  partySize: 8,
  status: "booked",
  ...over,
});

const payment = (id: string, resv: string, over: Partial<Payment> = {}): Payment => ({
  id: asId<"PaymentId">(id),
  reservationId: asId<"ReservationId">(resv),
  method: "stripe",
  kind: "deposit",
  amountCents: 10000,
  taxCents: 0,
  currency: "usd",
  status: "succeeded",
  createdAt: "2026-07-01T12:00:00.000Z",
  ...over,
});

const build = (over: Partial<PurchasesInput> = {}) =>
  buildPurchaseRows({
    reservations: [reservation("r1")],
    eventsById: new Map([["e1", event("e1")]]),
    paymentsByReservation: new Map(),
    taxRateBps: TAX,
    ...over,
  });

describe("payment state", () => {
  it("is `unpaid` when nothing succeeded — never `deposit`", () => {
    // The error this list must not make: reporting money that never arrived.
    expect(build()[0]!.state).toBe("unpaid");
    expect(build()[0]!.paidCents).toBe(0);
  });

  it("is `deposit` when something is paid but a balance remains", () => {
    const rows = build({
      paymentsByReservation: new Map([["r1", [payment("p1", "r1")]]]),
    });
    expect(rows[0]!.state).toBe("deposit");
    expect(rows[0]!.balanceCents).toBeGreaterThan(0);
  });

  it("is `paid` once the balance is settled", () => {
    const fare = 49900;
    const total = fare + Math.round((fare * TAX) / 10000);
    const rows = build({
      paymentsByReservation: new Map([["r1", [payment("p1", "r1", { amountCents: total })]]]),
    });
    expect(rows[0]!.state).toBe("paid");
    expect(rows[0]!.balanceCents).toBeLessThanOrEqual(0);
  });

  it("is `refunded` when any refund landed, outranking paid/deposit", () => {
    const rows = build({
      paymentsByReservation: new Map([
        ["r1", [payment("p1", "r1", { amountCents: 60000, refundedCents: 5000 })]],
      ]),
    });
    expect(rows[0]!.state).toBe("refunded");
    expect(rows[0]!.refundedCents).toBe(5000);
  });

  it("is `cancelled` regardless of money — a cancelled booking isn't a live order", () => {
    const rows = build({
      reservations: [reservation("r1", { status: "cancelled" })],
      paymentsByReservation: new Map([["r1", [payment("p1", "r1", { amountCents: 99999 })]]]),
    });
    expect(rows[0]!.state).toBe("cancelled");
  });

  it("counts only succeeded payments toward paid", () => {
    const rows = build({
      paymentsByReservation: new Map([
        ["r1", [payment("p1", "r1"), payment("p2", "r1", { status: "refunded" })]],
      ]),
    });
    expect(rows[0]!.paidCents).toBe(10000);
  });
});

describe("money", () => {
  it("totals fare + frozen extras + tax, and EXCLUDES gratuity (DEC-124)", () => {
    const rows = build({
      reservations: [reservation("r1", { extrasCents: 5000 })],
    });
    const fare = 49900 + 5000;
    expect(rows[0]!.totalCents).toBe(fare + Math.round((fare * TAX) / 10000));
  });

  it("flags an unpriced event instead of showing a confident zero", () => {
    const unpriced = event("e1");
    delete (unpriced as { price?: number }).price;
    const rows = build({ eventsById: new Map([["e1", unpriced]]) });
    expect(rows[0]!.priceKnown).toBe(false);
  });

  it("survives a missing event row", () => {
    const rows = build({ eventsById: new Map() });
    expect(rows[0]).toMatchObject({ priceKnown: false, date: undefined });
  });
});

describe("scope", () => {
  it("excludes Xola reservations — Xola owns its own money (DEC-105)", () => {
    const rows = build({
      reservations: [reservation("r1"), reservation("r2", { source: "xola" })],
    });
    expect(rows.map((r) => r.reservationId)).toEqual(["r1"]);
  });

  it("sorts newest departure first", () => {
    const rows = build({
      reservations: [
        reservation("old", { eventId: asId<"EventId">("e-old") }),
        reservation("new", { eventId: asId<"EventId">("e-new") }),
      ],
      eventsById: new Map([
        ["e-old", event("e-old", { date: "2026-06-01" })],
        ["e-new", event("e-new", { date: "2026-09-01" })],
      ]),
    });
    expect(rows.map((r) => r.reservationId)).toEqual(["new", "old"]);
  });
});

describe("groupPaymentsByReservation", () => {
  it("buckets a flat list by reservation", () => {
    const grouped = groupPaymentsByReservation([
      payment("p1", "r1"),
      payment("p2", "r1"),
      payment("p3", "r2"),
    ]);
    expect(grouped.get("r1")).toHaveLength(2);
    expect(grouped.get("r2")).toHaveLength(1);
    expect(grouped.get("nope")).toBeUndefined();
  });
});

describe("filters and search", () => {
  const rows = () =>
    build({
      reservations: [
        reservation("r1", { phone: "+12165550148", email: "jordan@example.com" }),
        reservation("r2", { customerName: "Dana Cho", eventId: asId<"EventId">("e2") }),
      ],
      eventsById: new Map([
        ["e1", event("e1")],
        ["e2", event("e2", { date: "2026-08-13" })],
      ]),
      paymentsByReservation: new Map([["r1", [payment("p1", "r1")]]]),
    });

  it("filters by state, and `all` passes everything", () => {
    expect(filterByState(rows(), "deposit").map((r) => r.reservationId)).toEqual(["r1"]);
    expect(filterByState(rows(), "unpaid").map((r) => r.reservationId)).toEqual(["r2"]);
    expect(filterByState(rows(), "all")).toHaveLength(2);
    expect(filterByState(rows(), "refunded")).toEqual([]);
  });

  it("counts every state plus the total", () => {
    expect(stateCounts(rows())).toMatchObject({ all: 2, deposit: 1, unpaid: 1, paid: 0 });
  });

  it("searches name, email, reservation id, and punctuation-insensitive phone", () => {
    expect(searchPurchases(rows(), "dana").map((r) => r.reservationId)).toEqual(["r2"]);
    expect(searchPurchases(rows(), "jordan@").map((r) => r.reservationId)).toEqual(["r1"]);
    expect(searchPurchases(rows(), "r2").map((r) => r.reservationId)).toEqual(["r2"]);
    for (const q of ["2165550148", "(216) 555-0148", "216 555 0148"]) {
      expect(searchPurchases(rows(), q).map((r) => r.reservationId)).toEqual(["r1"]);
    }
  });

  it("returns everything for a blank query and nothing for a miss", () => {
    expect(searchPurchases(rows(), "  ")).toHaveLength(2);
    expect(searchPurchases(rows(), "nobody")).toHaveLength(0);
  });

  it("doesn't let a letters-only query match every phone on the empty digit string", () => {
    expect(searchPurchases(rows(), "zzz")).toHaveLength(0);
  });
});
