/**
 * Purchases (order) list view model (12.12a, #465). The load-bearing behaviour is the derived
 * payment state — especially that "no money arrived" never reads as "deposit taken".
 */
import { describe, expect, it } from "vitest";
import type { BalanceChargeAttempt, BookingInvoice, Event, Payment, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { TrailEvent } from "../domain/reservation-trail.js";
import {
  bookedAtByReservation,
  buildPurchaseRows,
  filterByState,
  groupPaymentsByReservation,
  groupPurchases,
  listPurchases,
  purchasesHref,
  purchasesParams,
  searchPurchases,
  sortPurchases,
  stateCounts,
  windowPurchases,
  type PurchaseRow,
  type PurchasesInput,
} from "./purchases-view.js";

const TAX = 725;

/** What `priceBooking` froze on the $499 trip at 7.25%, no tip and no fee: tax 3618 (3617.75). */
const FROZEN: BookingInvoice = {
  fareCents: 49900,
  extrasCents: 0,
  taxCents: 3618,
  taxRateBps: TAX,
  serviceFeeCents: 0,
  serviceFeeBps: 0,
  gratuityCents: 0,
  gratuityBps: 0,
  totalCents: 53518,
  amountDueNowCents: 53518,
};

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

/** Wednesday 2026-10-21, noon EDT — the list's clock. */
const NOW = "2026-10-21T16:00:00.000Z";

const build = (over: Partial<PurchasesInput> = {}) =>
  buildPurchaseRows({
    reservations: [reservation("r1")],
    eventsById: new Map([["e1", event("e1")]]),
    paymentsByReservation: new Map(),
    now: NOW,
    ...over,
  });

describe("payment state", () => {
  it("is `unpaid` when nothing succeeded — never `deposit`", () => {
    // The error this list must not make: reporting money that never arrived.
    expect(build()[0]!.state).toBe("unpaid");
    expect(build()[0]!.paidCents).toBe(0);
  });

  it("is `disputed` on a live chargeback — not `unpaid` (issue #723)", () => {
    // Before the Disputed state existed this rendered as "Unpaid", which is true (the money is
    // gone) and useless: indistinguishable from a booking whose webhook never landed. The
    // operator could not tell a chargeback from a plumbing failure on the only screen that
    // shows the money.
    const rows = build({
      paymentsByReservation: new Map([["r1", [payment("p1", "r1", { status: "disputed" })]]]),
    });
    expect(rows[0]!.state).toBe("disputed");
    expect(rows[0]!.paidCents).toBe(0);
  });

  it("is `disputed` on a chargeback we LOST — same chip, money is still gone", () => {
    const rows = build({
      paymentsByReservation: new Map([["r1", [payment("p1", "r1", { status: "dispute_lost" })]]]),
    });
    expect(rows[0]!.state).toBe("disputed");
  });

  it("drops off Disputed once we WIN — the funds are back, so it reads paid again", () => {
    // The webhook writes the row back to `succeeded` on a win, so nothing special happens here.
    // Asserted anyway because it is the behaviour someone will question: the Disputed filter is
    // a worklist that shrinks, and Muster keeps no trace of a won dispute (Stripe does).
    const rows = build({
      reservations: [reservation("r1", { invoice: FROZEN })],
      paymentsByReservation: new Map([
        ["r1", [payment("p1", "r1", { amountCents: FROZEN.totalCents, status: "succeeded" })]],
      ]),
    });
    expect(rows[0]!.state).toBe("paid");
  });

  it("a pending row reads `pending` — never `cancelled`, never `unpaid` (14.3, SPEC §2.8.10)", () => {
    // Before 14.3 `stateOf` returned `cancelled` for any status that was not `booked`, so a
    // checkout in flight would have shown the operator **Cancelled**. It is not `unpaid` either:
    // that word is a BOOKED row whose payment never landed — a different problem.
    const rows = build({ reservations: [reservation("r1", { status: "pending", eventId: null })] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("pending");
    // No event yet (§2.8.2) ⇒ no departure and no trusted money columns.
    expect(rows[0]!.date).toBeUndefined();
    expect(rows[0]!.priceKnown).toBe(false);
  });

  it("a cancelled booking still reads `cancelled` even with a dispute on it", () => {
    // Reservation status outranks money, unchanged: a cancelled booking is not a live order,
    // and showing it in the Disputed worklist would put something there nobody can act on.
    const rows = build({
      reservations: [reservation("r1", { status: "cancelled" })],
      paymentsByReservation: new Map([["r1", [payment("p1", "r1", { status: "disputed" })]]]),
    });
    expect(rows[0]!.state).toBe("cancelled");
  });

  it("a cancelled row owes nothing, so /admin/purchases stops showing it as due (issue #803)", () => {
    // `stateOf` already returns `cancelled` here (`purchases-view.ts:104`), but the row's
    // `balanceCents` was still the live arithmetic — and the due chip on the page is gated on
    // `balanceCents > 0` alone, so a cancelled booking rendered "$538.18 due".
    const rows = build({
      reservations: [reservation("r1", { status: "cancelled" })],
      paymentsByReservation: new Map([["r1", [payment("p1", "r1")]]]),
    });
    expect(rows[0]!.balanceCents).toBe(0);
    // The state label must NOT move — it is already correct and comes from the reservation, not
    // from the money. Without this, zeroing the balance could flip it via `stateOf`'s last line.
    expect(rows[0]!.state).toBe("cancelled");
  });

  it("is `deposit` when something is paid but a balance remains", () => {
    const rows = build({
      reservations: [reservation("r1", { invoice: FROZEN })],
      paymentsByReservation: new Map([["r1", [payment("p1", "r1")]]]),
    });
    expect(rows[0]!.state).toBe("deposit");
    expect(rows[0]!.balanceCents).toBeGreaterThan(0);
  });

  it("is `paid` once the balance is settled", () => {
    const rows = build({
      reservations: [reservation("r1", { invoice: FROZEN })],
      paymentsByReservation: new Map([["r1", [payment("p1", "r1", { amountCents: FROZEN.totalCents })]]]),
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
    // 54900 at 7.25% → 3980 (3980.25), frozen on the invoice.
    const invoice = { ...FROZEN, extrasCents: 5000, taxCents: 3980, totalCents: 58880, amountDueNowCents: 58880 };
    const rows = build({
      reservations: [reservation("r1", { extrasCents: 5000, invoice })],
    });
    expect(rows[0]!.totalCents).toBe(54900 + 3980);
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

/**
 * Money F6 on `/admin/purchases` (issue #1241): a booked row's total and balance are the ones frozen
 * on its invoice, so a rate change after booking moves neither. The builder takes no rate any more;
 * the booking is frozen at 7.25% and read with nothing else to go on — before the fix the row
 * re-taxed $499 at the live rate. The total is fare + tax (`chargedFareCents` + `taxCents`), never
 * `invoice.totalCents`, which also holds the fee, the tip and the insurance.
 */
describe("a booked row's money is the frozen invoice (issue #1241)", () => {
  // $499 at 7.25%, 3% fee, no tip: 49900 + 3618 + 1497 = 55015.
  const F6: BookingInvoice = { ...FROZEN, serviceFeeCents: 1497, serviceFeeBps: 300, totalCents: 55015, amountDueNowCents: 55015 };

  it("issue #1241 AC2: a booking paid in full shows the frozen total and owes nothing", () => {
    const [row] = build({
      reservations: [reservation("r1", { invoice: F6 })],
      paymentsByReservation: new Map([["r1", [payment("p1", "r1", { kind: "full", amountCents: 55015, serviceFeeCents: 1497 })]]]),
    });
    expect(row).toMatchObject({ totalCents: 53518, balanceCents: 0, state: "paid", priceKnown: true });
  });

  it("issue #1241 AC2: a deposit-only booking shows the frozen total and the frozen balance", () => {
    // The $100 deposit carried the fee: 55015 − 10000 = 45015 owed.
    const [row] = build({
      reservations: [reservation("r1", { invoice: { ...F6, amountDueNowCents: 10000 } })],
      paymentsByReservation: new Map([["r1", [payment("p1", "r1", { amountCents: 10000, serviceFeeCents: 1497 })]]]),
    });
    expect(row).toMatchObject({ totalCents: 53518, balanceCents: 45015, state: "deposit" });
  });
});

describe("scope", () => {
  it("excludes Xola reservations — Xola owns its own money (DEC-105)", () => {
    const rows = build({
      reservations: [reservation("r1"), reservation("r2", { source: "xola" })],
    });
    expect(rows.map((r) => r.reservationId)).toEqual(["r1"]);
  });

  // Retargeted (issue #1142): `buildPurchaseRows` no longer sorts, and the order it guarded is
  // reversed — `sortPurchases` by trip puts the soonest departure first. Renamed with it, since the
  // old name would now describe the opposite of what the test asserts.
  it("sorts soonest departure first (sortPurchases by trip; was newest departure first)", () => {
    const rows = build({
      reservations: [
        reservation("new", { eventId: asId<"EventId">("e-new") }),
        reservation("old", { eventId: asId<"EventId">("e-old") }),
      ],
      eventsById: new Map([
        ["e-old", event("e-old", { date: "2026-06-01" })],
        ["e-new", event("e-new", { date: "2026-09-01" })],
      ]),
    });
    expect(sortPurchases(rows, "trip").map((r) => r.reservationId)).toEqual(["old", "new"]);
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
        reservation("r1", { phone: "+12165550148", email: "jordan@example.com", invoice: FROZEN }),
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

describe("an operator's phone booking (issue #1082 part C)", () => {
  /** The operator's unpaid row: no Event, its trip and money on the row itself. */
  const phone = (id: string, over: Partial<Reservation> = {}): Reservation =>
    reservation(id, {
      eventId: null,
      source: "admin",
      status: "pending",
      customerName: "Phone Caller",
      phone: "+12165550199",
      partySize: 2,
      vesselId: asId<"VesselId">("v1"),
      date: "2026-10-21",
      time: "15:30",
      invoice: {
        fareCents: 49900,
        extrasCents: 4000,
        taxCents: 3908,
        taxRateBps: TAX,
        serviceFeeCents: 1617,
        serviceFeeBps: 300,
        gratuityCents: 10780,
        gratuityBps: 2000,
        totalCents: 70205,
        amountDueNowCents: 70205,
      },
      ...over,
    });

  it("awaiting payment is listed, with its own state", () => {
    const [row] = build({ reservations: [phone("p1")], eventsById: new Map() });
    expect(row).toMatchObject({ reservationId: "p1", customerName: "Phone Caller", state: "awaiting" });
  });

  it("with no Event yet, the trip comes from the booking itself", () => {
    const [row] = build({
      reservations: [phone("p1")],
      eventsById: new Map(),
      vesselNameById: new Map([["v1", "Brew 3"]]),
    });
    expect(row).toMatchObject({ date: "2026-10-21", time: "15:30", vesselName: "Brew 3", guestCount: 2 });
  });

  it("the total is fare + extras + tax off the frozen invoice — no tip, as every row", () => {
    const [row] = build({ reservations: [phone("p1")], eventsById: new Map() });
    expect(row).toMatchObject({ totalCents: 49900 + 4000 + 3908, paidCents: 0, priceKnown: true });
  });

  it("cancelled before it was paid: listed under cancelled, owing nothing", () => {
    const [row] = build({ reservations: [phone("p1", { status: "cancelled" })], eventsById: new Map() });
    expect(row).toMatchObject({ state: "cancelled", balanceCents: 0 });
  });

  it("a web checkout in flight gets its trip from the row too, instead of a dash", () => {
    const { invoice: _none, ...web } = phone("w1", { source: "muster" });
    const [row] = build({ reservations: [web], eventsById: new Map() });
    expect(row).toMatchObject({ state: "pending", date: "2026-10-21", time: "15:30" });
  });

  it("counts awaiting payment for its chip", () => {
    const rows = build({ reservations: [phone("p1"), phone("p2"), reservation("r1")] });
    expect(stateCounts(rows)).toMatchObject({ all: 3, awaiting: 2, unpaid: 1 });
    expect(filterByState(rows, "awaiting").map((r) => r.reservationId).sort()).toEqual(["p1", "p2"]);
  });
});

// ── issue #1142: windows, grouping, sorting and the Owed column ─────────────────────────────

/** A list row built directly, for the functions that take rows rather than reservations. */
const prow = (id: string, over: Partial<PurchaseRow> = {}): PurchaseRow => ({
  reservationId: id,
  customerName: `Guest ${id}`,
  guestCount: 2,
  totalCents: 10000,
  paidCents: 10000,
  balanceCents: 0,
  refundedCents: 0,
  state: "paid",
  priceKnown: true,
  ...over,
});

const ids = (rows: readonly PurchaseRow[]) => rows.map((r) => r.reservationId);

/** The next 7 days from Wednesday 2026-10-21, as `resolveWindow` answers it. */
const WEEK = { from: "2026-10-21", to: "2026-10-27", kind: "next7" } as const;
const ALL = { from: "", to: "", kind: "all" } as const;

const trail = (id: string, type: TrailEvent["type"], timestamp: string, reservationId?: string): TrailEvent => ({
  id: asId<"TrailEventId">(id),
  ...(reservationId ? { reservationId: asId<"ReservationId">(reservationId) } : {}),
  actorKind: "customer",
  type,
  timestamp,
  metadata: {},
});

const attempt = (resv: string, n: number, over: Partial<BalanceChargeAttempt> = {}): BalanceChargeAttempt => ({
  reservationId: asId<"ReservationId">(resv),
  attempt: n,
  attemptedAt: NOW,
  ...over,
});

describe("issue #1142 — the window", () => {
  const rows = () => [
    prow("before", { date: "2026-10-20" }),
    prow("first", { date: "2026-10-21" }),
    prow("last", { date: "2026-10-27" }),
    prow("after", { date: "2026-10-28" }),
    prow("undated"),
  ];

  it("AC3: a row stays iff its trip date is inside [from, to], both ends included", () => {
    expect(ids(windowPurchases(rows(), WEEK)).sort()).toEqual(["first", "last"]);
  });

  it("AC3: a row with no date stays only under all", () => {
    expect(ids(windowPurchases(rows(), ALL)).sort()).toEqual(["after", "before", "first", "last", "undated"]);
    const past = { from: "2026-09-21", to: "2026-10-20", kind: "past" } as const;
    expect(ids(windowPurchases(rows(), past))).toEqual(["before"]);
  });
});

describe("issue #1142 — when it was bought", () => {
  it("AC4: bookedAtByReservation maps each booking to its earliest booked row", () => {
    const got = bookedAtByReservation([
      trail("t1", "booked", "2026-10-03T10:00:00.000Z", "r1"),
      trail("t2", "booked", "2026-10-02T09:00:00.000Z", "r1"),
      trail("t3", "cancelled", "2026-10-01T08:00:00.000Z", "r2"),
      trail("t4", "booked", "2026-10-04T08:00:00.000Z", "r3"),
      // A fact with no booking to name is not a purchase.
      trail("t5", "booked", "2026-10-01T07:00:00.000Z"),
    ]);
    expect(Object.fromEntries(got)).toEqual({
      r1: "2026-10-02T09:00:00.000Z",
      r3: "2026-10-04T08:00:00.000Z",
    });
  });

  it("AC4: purchasedAt is the booked row's timestamp, else reservedAt, else absent", () => {
    const rows = build({
      reservations: [
        reservation("booked", { reservedAt: "2026-10-01T10:00:00.000Z" }),
        reservation("reserved", { reservedAt: "2026-10-05T10:00:00.000Z" }),
        reservation("neither"),
      ],
      bookedAtByReservation: new Map([["booked", "2026-10-02T11:00:00.000Z"]]),
    });
    const at = Object.fromEntries(rows.map((r) => [r.reservationId, r.purchasedAt]));
    expect(at).toEqual({
      booked: "2026-10-02T11:00:00.000Z",
      reserved: "2026-10-05T10:00:00.000Z",
      neither: undefined,
    });
  });
});

describe("issue #1142 — sorting", () => {
  it("AC4: by trip, soonest first by date then time, and a row with no date last", () => {
    const rows = [
      prow("undated"),
      prow("thu-am", { date: "2026-10-22", time: "09:00" }),
      prow("wed-pm", { date: "2026-10-21", time: "15:30" }),
      prow("wed-am", { date: "2026-10-21", time: "11:00" }),
    ];
    expect(ids(sortPurchases(rows, "trip"))).toEqual(["wed-am", "wed-pm", "thu-am", "undated"]);
  });

  it("AC4: by purchase, newest bought first, and a row with no purchasedAt last", () => {
    const rows = [
      prow("never"),
      prow("older", { purchasedAt: "2026-10-01T10:00:00.000Z" }),
      prow("newer", { purchasedAt: "2026-10-05T10:00:00.000Z" }),
    ];
    expect(ids(sortPurchases(rows, "purchase"))).toEqual(["newer", "older", "never"]);
  });
});

describe("issue #1142 — grouping by day", () => {
  it("AC5: by trip, one group per trip day, labelled by the day alone, rows in their sorted order", () => {
    const groups = groupPurchases(
      [
        prow("wed-am", { date: "2026-10-21", time: "11:00" }),
        prow("wed-pm", { date: "2026-10-21", time: "15:30" }),
        prow("thu", { date: "2026-10-22", time: "09:00" }),
      ],
      "trip",
    );
    expect(groups.map((g) => ({ key: g.key, label: g.label, rows: ids(g.rows), count: g.count }))).toEqual([
      { key: "2026-10-21", label: "Wednesday, Oct 21", rows: ["wed-am", "wed-pm"], count: 2 },
      { key: "2026-10-22", label: "Thursday, Oct 22", rows: ["thu"], count: 1 },
    ]);
  });

  it("AC5: a group's total is its priced rows' totals and its owed is the sum of their owed", () => {
    const [g] = groupPurchases(
      [
        prow("deposit", { date: "2026-10-21", totalCents: 53518, owed: { cents: 43518, pastDue: false, dueAt: NOW } }),
        prow("unpaid", { date: "2026-10-21", totalCents: 47083, owed: { cents: 47083, pastDue: false } }),
        prow("paid", { date: "2026-10-21", totalCents: 20000 }),
        prow("unpriced", { date: "2026-10-21", totalCents: 999, priceKnown: false }),
      ],
      "trip",
    );
    expect(g).toMatchObject({ count: 4, totalCents: 53518 + 47083 + 20000, owedCents: 43518 + 47083 });
  });

  it("AC5: count and total take cancelled and refunded rows too — the heading sums what it lists", () => {
    const [g] = groupPurchases(
      [
        prow("cancelled", { date: "2026-10-21", state: "cancelled", totalCents: 30000 }),
        prow("refunded", { date: "2026-10-21", state: "refunded", totalCents: 12000 }),
      ],
      "trip",
    );
    expect(g).toMatchObject({ count: 2, totalCents: 42000, owedCents: 0 });
  });

  it("AC5: a row with no date groups under undated, labelled No date, always last", () => {
    const groups = groupPurchases(
      [prow("no-date"), prow("wed", { date: "2026-10-21" }), prow("also-no-date")],
      "trip",
    );
    expect(groups.map((g) => ({ key: g.key, label: g.label, rows: ids(g.rows) }))).toEqual([
      { key: "2026-10-21", label: "Wednesday, Oct 21", rows: ["wed"] },
      { key: "undated", label: "No date", rows: ["no-date", "also-no-date"] },
    ]);
  });

  it("AC5: by purchase, groups are the vessel-local day bought, newest first as sorted", () => {
    const groups = groupPurchases(
      [
        // 22:30 EDT on the 21st: the 22nd in UTC, the 21st on the vessel's calendar.
        prow("late-wed", { date: "2026-11-02", purchasedAt: "2026-10-22T02:30:00.000Z" }),
        prow("wed", { date: "2026-12-01", purchasedAt: "2026-10-21T14:00:00.000Z" }),
        prow("mon", { date: "2026-10-30", purchasedAt: "2026-10-19T15:00:00.000Z" }),
        prow("never", { date: "2026-10-23" }),
      ],
      "purchase",
    );
    expect(groups.map((g) => ({ key: g.key, label: g.label, rows: ids(g.rows) }))).toEqual([
      { key: "2026-10-21", label: "Wednesday, Oct 21", rows: ["late-wed", "wed"] },
      { key: "2026-10-19", label: "Monday, Oct 19", rows: ["mon"] },
      { key: "undated", label: "No date", rows: ["never"] },
    ]);
  });
});

describe("issue #1142 — what a booking still owes", () => {
  const DUE_LATER = "2026-10-26T13:00:00.000Z";
  const DUE_BEFORE = "2026-10-20T13:00:00.000Z";
  const deposit = (over: Partial<Reservation> = {}) =>
    reservation("r1", { invoice: { ...FROZEN, amountDueNowCents: 10000 }, balanceDueAt: DUE_LATER, ...over });
  const depositPaid = new Map([["r1", [payment("p1", "r1")]]]);

  it("AC6: a deposit booking owes its balance, due on its balanceDueAt", () => {
    const [row] = build({ reservations: [deposit()], paymentsByReservation: depositPaid });
    expect(row!.owed).toEqual({ cents: 43518, dueAt: DUE_LATER, pastDue: false });
  });

  it("AC6: a booked row with no payment owes its whole total, with no due date, and still reads unpaid", () => {
    const [row] = build({ reservations: [reservation("r1", { invoice: FROZEN })] });
    expect(row!.owed).toEqual({ cents: 53518, pastDue: false });
    expect(row!.state).toBe("unpaid");
  });

  it("AC6: past due once its due date is before now", () => {
    const [row] = build({ reservations: [deposit({ balanceDueAt: DUE_BEFORE })], paymentsByReservation: depositPaid });
    expect(row!.owed).toMatchObject({ dueAt: DUE_BEFORE, pastDue: true });
  });

  it("AC6: past due at the instant it falls due — the charge run's own <=", () => {
    const [row] = build({ reservations: [deposit({ balanceDueAt: NOW })], paymentsByReservation: depositPaid });
    expect(row!.owed).toMatchObject({ dueAt: NOW, pastDue: true });
  });

  it("AC6: a partly refunded deposit booking with its balance still to charge owes it, and reads refunded", () => {
    const [row] = build({
      reservations: [deposit()],
      paymentsByReservation: new Map([["r1", [payment("p1", "r1", { refundedCents: 2000 })]]]),
    });
    expect(row!.state).toBe("refunded");
    expect(row!.owed).toMatchObject({ dueAt: DUE_LATER, pastDue: false });
    expect(row!.owed!.cents).toBe(row!.balanceCents);
    expect(row!.owed!.cents).toBeGreaterThan(0);
  });

  it("AC6: a row that owes nothing carries no owed", () => {
    const paidInFull = build({
      reservations: [reservation("r1", { invoice: FROZEN })],
      paymentsByReservation: new Map([["r1", [payment("p1", "r1", { kind: "full", amountCents: FROZEN.totalCents })]]]),
    });
    // A paid balance keeps its due date on the booking, and owes nothing.
    const balancePaid = build({
      reservations: [deposit({ balanceDueAt: DUE_BEFORE })],
      paymentsByReservation: new Map([
        ["r1", [payment("p1", "r1"), payment("p2", "r1", { kind: "balance", amountCents: 43518 })]],
      ]),
    });
    const cancelled = build({
      reservations: [deposit({ status: "cancelled" })],
      paymentsByReservation: depositPaid,
    });
    const slot = { eventId: null, date: "2026-10-23", time: "15:30", vesselId: asId<"VesselId">("v1") };
    const awaiting = build({
      reservations: [reservation("r1", { ...slot, source: "admin", status: "pending", invoice: FROZEN })],
      eventsById: new Map(),
    });
    const webPending = build({
      reservations: [reservation("r1", { ...slot, source: "muster", status: "pending", invoice: FROZEN })],
      eventsById: new Map(),
    });
    expect(balancePaid[0]!.state).toBe("paid");
    for (const [row] of [paidInFull, balancePaid, cancelled, awaiting, webPending]) {
      expect(row!.owed).toBeUndefined();
    }
  });

  it("AC6: a disputed row carries no owed, though money is missing", () => {
    const [row] = build({
      reservations: [deposit()],
      paymentsByReservation: new Map([["r1", [payment("p1", "r1", { status: "disputed" })]]]),
    });
    expect(row!.state).toBe("disputed");
    expect(row!.balanceCents).toBeGreaterThan(0);
    expect(row!.owed).toBeUndefined();
  });

  it("AC6: lastFailure is absent when no attempt has failed", () => {
    const none = build({ reservations: [deposit({ balanceDueAt: DUE_BEFORE })], paymentsByReservation: depositPaid });
    const inFlight = build({
      reservations: [deposit({ balanceDueAt: DUE_BEFORE })],
      paymentsByReservation: depositPaid,
      attemptsByReservation: new Map([["r1", [attempt("r1", 0)]]]),
    });
    for (const [row] of [none, inFlight]) {
      expect(row!.owed).toMatchObject({ pastDue: true });
      expect(row!.owed?.lastFailure).toBeUndefined();
    }
  });

  it.each([
    {
      name: "a decline reads its code alone",
      attempts: [attempt("r1", 0, { outcome: "declined", declineCode: "card_declined" })],
      want: "card_declined",
    },
    {
      name: "a decline with no code reads declined",
      attempts: [attempt("r1", 0, { outcome: "declined" })],
      want: "declined",
    },
    {
      name: "needs_approval reads needs approval",
      attempts: [attempt("r1", 0, { outcome: "needs_approval" })],
      want: "needs approval",
    },
    {
      name: "the highest failed attempt wins, whatever the list order",
      attempts: [
        attempt("r1", 1, { outcome: "needs_approval" }),
        attempt("r1", 0, { outcome: "declined", declineCode: "card_declined" }),
      ],
      want: "needs approval",
    },
    {
      name: "a claim in flight or a success above a failure is skipped",
      attempts: [
        attempt("r1", 0, { outcome: "declined", declineCode: "insufficient_funds" }),
        attempt("r1", 1, { outcome: "succeeded" }),
        attempt("r1", 2),
      ],
      want: "insufficient_funds",
    },
  ])("AC6: lastFailure — $name", ({ attempts, want }) => {
    const [row] = build({
      reservations: [deposit({ balanceDueAt: DUE_BEFORE })],
      paymentsByReservation: depositPaid,
      attemptsByReservation: new Map([["r1", attempts]]),
    });
    expect(row!.owed).toMatchObject({ pastDue: true, lastFailure: want });
  });
});

describe("issue #1142 — the Balance due chip", () => {
  it("AC7: filterByState balance_due selects rows owing a dated balance, whatever their state", () => {
    const rows = [
      prow("deposit", { state: "deposit", owed: { cents: 100, dueAt: NOW, pastDue: true } }),
      prow("refunded", { state: "refunded", owed: { cents: 100, dueAt: NOW, pastDue: true } }),
      prow("unpaid", { state: "unpaid", owed: { cents: 100, pastDue: false } }),
      prow("paid"),
    ];
    expect(ids(filterByState(rows, "balance_due")).sort()).toEqual(["deposit", "refunded"]);
    expect(stateCounts(rows)).toMatchObject({ balance_due: 2, all: 4 });
  });

  describe("listPurchases", () => {
    const set = () => [
      prow("paid-wed", { customerName: "Ann Paid", date: "2026-10-21" }),
      prow("unpaid-thu", { customerName: "Ben Unpaid", date: "2026-10-22", state: "unpaid", owed: { cents: 100, pastDue: false } }),
      prow("deposit-fri", {
        customerName: "Cat Deposit",
        date: "2026-10-23",
        state: "deposit",
        owed: { cents: 200, dueAt: "2026-10-22T13:00:00.000Z", pastDue: false },
      }),
      // 31 days out, outside any default window: the worklist must not hide it.
      prow("refunded-far", {
        customerName: "Dee Faraway",
        date: "2026-11-21",
        state: "refunded",
        owed: { cents: 300, dueAt: "2026-10-20T13:00:00.000Z", pastDue: true },
      }),
      prow("paid-far", { customerName: "Eve Later", date: "2026-11-25" }),
    ];
    const shown = (r: ReturnType<typeof listPurchases>) => r.groups.flatMap((g) => ids(g.rows));

    it("AC7: every chip counts the window, except Balance due, which counts the whole set", () => {
      const { counts } = listPurchases(set(), { q: "", state: "all", window: WEEK, sort: "trip" });
      expect(counts).toMatchObject({ all: 3, paid: 1, unpaid: 1, deposit: 1, refunded: 0, balance_due: 2 });
    });

    it("AC7: Balance due shows dated balances from the whole set, not the window", () => {
      const r = listPurchases(set(), { q: "", state: "balance_due", window: WEEK, sort: "trip" });
      expect(shown(r)).toEqual(["deposit-fri", "refunded-far"]);
    });

    it("AC7: any other chip shows the window, then the state, sorted and grouped", () => {
      const all = listPurchases(set(), { q: "", state: "all", window: WEEK, sort: "trip" });
      expect(shown(all)).toEqual(["paid-wed", "unpaid-thu", "deposit-fri"]);
      expect(all.groups.map((g) => g.key)).toEqual(["2026-10-21", "2026-10-22", "2026-10-23"]);
      const paid = listPurchases(set(), { q: "", state: "paid", window: WEEK, sort: "trip" });
      expect(shown(paid)).toEqual(["paid-wed"]);
    });

    it("AC7: search narrows the Balance due list but no chip's count", () => {
      const r = listPurchases(set(), { q: "faraway", state: "balance_due", window: WEEK, sort: "trip" });
      expect(shown(r)).toEqual(["refunded-far"]);
      expect(r.counts).toMatchObject({ all: 3, balance_due: 2 });
    });

    it("AC7: windowEmpty when the window holds no row and the set does", () => {
      const quiet = { from: "2026-10-28", to: "2026-11-04", kind: "next8to15" } as const;
      const r = listPurchases(set(), { q: "", state: "all", window: quiet, sort: "trip" });
      expect(r.windowEmpty).toBe(true);
      expect(r.groups).toEqual([]);
    });

    it("AC7: windowEmpty never under Balance due, nor for an empty set, nor when only search empties it", () => {
      const quiet = { from: "2026-10-28", to: "2026-11-04", kind: "next8to15" } as const;
      expect(listPurchases(set(), { q: "", state: "balance_due", window: quiet, sort: "trip" }).windowEmpty).toBe(false);
      expect(listPurchases([], { q: "", state: "all", window: WEEK, sort: "trip" }).windowEmpty).toBe(false);
      expect(listPurchases(set(), { q: "nobody", state: "all", window: WEEK, sort: "trip" }).windowEmpty).toBe(false);
    });
  });
});

describe("issue #1142 — the carried params", () => {
  const params = (p: URLSearchParams) => Object.fromEntries(p);
  const current = { q: "dana", state: "unpaid", preset: "days30", sort: "purchase" };

  it.each([
    { change: { q: "marcus" }, want: { q: "marcus", state: "unpaid", preset: "days30", sort: "purchase" } },
    { change: { state: "paid" }, want: { q: "dana", state: "paid", preset: "days30", sort: "purchase" } },
    { change: { preset: "today" }, want: { q: "dana", state: "unpaid", preset: "today", sort: "purchase" } },
    { change: { sort: "trip" }, want: { q: "dana", state: "unpaid", preset: "days30" } },
  ])("AC8: changing $change keeps the other three", ({ change, want }) => {
    expect(params(purchasesParams(current, change))).toEqual(want);
  });

  it("AC8: defaults are dropped — state=all, sort=trip, an empty q, and the bare default window", () => {
    expect(params(purchasesParams({ q: "", state: "all", sort: "trip" }))).toEqual({});
    expect(params(purchasesParams(current, { q: "", state: "all" }))).toEqual({ preset: "days30", sort: "purchase" });
  });

  it("AC8: an explicit preset=next7 stays in the URL", () => {
    expect(params(purchasesParams({ preset: "next7" }))).toEqual({ preset: "next7" });
  });

  it("AC8: past and all are carried; an unknown preset is not", () => {
    expect(params(purchasesParams({ preset: "past" }))).toEqual({ preset: "past" });
    expect(params(purchasesParams({ preset: "all", q: "x" }))).toEqual({ preset: "all", q: "x" });
    expect(params(purchasesParams({ preset: "bogus", q: "x" }))).toEqual({ q: "x" });
  });

  it("AC8: a change naming preset, from or to replaces the whole window, never merges", () => {
    const range = { state: "paid", from: "2026-10-01", to: "2026-10-05" };
    expect(params(purchasesParams(range, { preset: "today" }))).toEqual({ state: "paid", preset: "today" });
    expect(params(purchasesParams({ state: "paid", preset: "days30" }, { from: "2026-10-01", to: "2026-10-05" }))).toEqual(
      { state: "paid", from: "2026-10-01", to: "2026-10-05" },
    );
    expect(params(purchasesParams(range, { from: "2026-10-03" }))).toEqual({ state: "paid", from: "2026-10-03" });
  });

  it("AC8: purchasesHref is /admin/purchases, plus ? and the params when any", () => {
    expect(purchasesHref({})).toBe("/admin/purchases");
    expect(purchasesHref({ state: "all", sort: "trip" })).toBe("/admin/purchases");
    const url = new URL(purchasesHref(current, { state: "paid" }), "http://muster.test");
    expect(url.pathname).toBe("/admin/purchases");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "dana", state: "paid", preset: "days30", sort: "purchase" });
  });
});
