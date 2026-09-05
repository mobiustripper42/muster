/**
 * Customers list + detail view models (12.12b, DEC-132). The load-bearing case is lifetime
 * value: base + frozen extras, cancelled excluded, gratuity NEVER included (DEC-124).
 */
import { describe, expect, it } from "vitest";
import type { Customer, Event, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import {
  buildCustomerDetail,
  buildCustomerRows,
  filterCustomerRows,
  soleMatch,
} from "./customer-view.js";

const CUST = asId<"CustomerId">("cust-1");

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: CUST,
  displayCode: "C-K7X3P9",
  name: "Jordan Ellis",
  phoneE164: "+12165550148",
  createdAt: "2026-06-01T12:00:00.000Z",
  active: true,
  ...over,
});

const event = (id: string, over: Partial<Event> = {}): Event => ({
  id: asId<"EventId">(id),
  vesselId: asId<"VesselId">("v1"),
  date: "2026-07-18",
  time: "13:30",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  price: 49900,
  ...over,
});

const reservation = (id: string, eventId: string, over: Partial<Reservation> = {}): Reservation => ({
  id: asId<"ReservationId">(id),
  eventId: asId<"EventId">(eventId),
  source: "muster",
  customerName: "Jordan Ellis",
  partySize: 8,
  status: "booked",
  customerId: CUST,
  ...over,
});

/** A reservation with NO customer link — the historical/unlinkable shape (DEC-132). */
const unlinked = (id: string, eventId: string): Reservation => {
  const { customerId: _drop, ...rest } = reservation(id, eventId);
  return rest;
};

const eventsById = (...events: Event[]) => new Map(events.map((e) => [String(e.id), e]));

describe("lifetime value", () => {
  it("sums base + FROZEN extras across booked reservations", () => {
    const rows = buildCustomerRows(
      [customer()],
      [
        reservation("r1", "e1", { extrasCents: 5000 }),
        reservation("r2", "e2"),
      ],
      eventsById(event("e1"), event("e2", { price: 43900 })),
    );
    expect(rows[0]!.lifetimeCents).toBe(49900 + 5000 + 43900);
    expect(rows[0]!.bookingCount).toBe(2);
  });

  it("EXCLUDES gratuity — tips are crew money, never revenue (DEC-124)", () => {
    // Gratuity lives on its own rows and is never an input here; the assertion is that the
    // view model has no seam through which a tip could reach the total.
    const rows = buildCustomerRows(
      [customer()],
      [reservation("r1", "e1")],
      eventsById(event("e1")),
    );
    expect(rows[0]!.lifetimeCents).toBe(49900); // fare only — no tip, no tax
  });

  it("excludes cancelled bookings from both the total and the count", () => {
    const rows = buildCustomerRows(
      [customer()],
      [reservation("r1", "e1"), reservation("r2", "e2", { status: "cancelled" })],
      eventsById(event("e1"), event("e2", { price: 99900 })),
    );
    expect(rows[0]!.lifetimeCents).toBe(49900);
    expect(rows[0]!.bookingCount).toBe(1);
  });

  it("a PENDING row is not history — not in the list, the count, or the total (14.3, SPEC §2.8.10)", () => {
    // A checkout in flight is not something the customer did yet. Whether a pending row even
    // carries a `customerId` is 14.4's; if one does, this view must not show an undated
    // "Trip" for it. Cancelled stays in history (marked) — the two are named, not `!== pending`.
    const pending = reservation("r-p", "e-none", { status: "pending", eventId: null });
    const rows = buildCustomerRows(
      [customer()],
      [reservation("r1", "e1"), pending],
      eventsById(event("e1")),
    );
    expect(rows[0]!).toMatchObject({ lifetimeCents: 49900, bookingCount: 1 });

    const detail = buildCustomerDetail(customer(), [reservation("r1", "e1"), pending], eventsById(event("e1")));
    expect(detail.history.map((h) => h.reservationId)).toEqual(["r1"]);
  });

  it("treats an unpriced event as zero rather than throwing off the total", () => {
    const unpriced = event("e1");
    delete (unpriced as { price?: number }).price;
    const rows = buildCustomerRows([customer()], [reservation("r1", "e1")], eventsById(unpriced));
    expect(rows[0]!.lifetimeCents).toBe(0);
  });

  it("is zero for a customer with no bookings", () => {
    const rows = buildCustomerRows([customer()], [], eventsById());
    expect(rows[0]).toMatchObject({ lifetimeCents: 0, bookingCount: 0 });
  });
});

describe("buildCustomerRows", () => {
  it("ignores reservations belonging to another customer, and unlinked ones", () => {
    const rows = buildCustomerRows(
      [customer()],
      [
        reservation("r1", "e1"),
        reservation("r2", "e2", { customerId: asId<"CustomerId">("cust-other") }),
        unlinked("r3", "e3"),
      ],
      eventsById(event("e1"), event("e2"), event("e3")),
    );
    expect(rows[0]!.bookingCount).toBe(1);
  });

  it("sorts by name", () => {
    const rows = buildCustomerRows(
      [
        customer({ id: asId<"CustomerId">("c2"), name: "Zoe" }),
        customer({ id: asId<"CustomerId">("c1"), name: "Adam" }),
      ],
      [],
      eventsById(),
    );
    expect(rows.map((r) => r.name)).toEqual(["Adam", "Zoe"]);
  });

  it("omits an absent email rather than emitting undefined", () => {
    const rows = buildCustomerRows([customer()], [], eventsById());
    expect("email" in rows[0]!).toBe(false);
  });
});

describe("buildCustomerDetail", () => {
  it("orders history newest departure first and marks cancelled", () => {
    const detail = buildCustomerDetail(
      customer(),
      [
        reservation("r-old", "e-old"),
        reservation("r-new", "e-new"),
        reservation("r-cancelled", "e-cancelled", { status: "cancelled" }),
      ],
      eventsById(
        event("e-old", { date: "2026-05-30" }),
        event("e-new", { date: "2026-07-18" }),
        event("e-cancelled", { date: "2026-06-21" }),
      ),
    );
    expect(detail.history.map((h) => h.date)).toEqual(["2026-07-18", "2026-06-21", "2026-05-30"]);
    // Cancelled shows in history (the operator wants to see it) but is worth nothing.
    expect(detail.history.find((h) => h.status === "cancelled")!.valueCents).toBe(0);
    expect(detail.bookingCount).toBe(2);
  });

  it("survives a reservation whose event row is missing", () => {
    const detail = buildCustomerDetail(customer(), [reservation("r1", "gone")], eventsById());
    expect(detail.history[0]).toMatchObject({ date: undefined, valueCents: 0 });
  });

  it("carries the contact record's own fields through", () => {
    const detail = buildCustomerDetail(
      customer({ email: "j@example.com", notes: "Repeat guest" }),
      [],
      eventsById(),
    );
    expect(detail).toMatchObject({
      displayCode: "C-K7X3P9",
      email: "j@example.com",
      notes: "Repeat guest",
      createdAt: "2026-06-01T12:00:00.000Z",
    });
  });
});

describe("filterCustomerRows — what the operator types", () => {
  const rows = () =>
    buildCustomerRows(
      [
        customer({ email: "jordan.ellis@gmail.com" }),
        customer({
          id: asId<"CustomerId">("cust-2"),
          name: "Dana Whit",
          phoneE164: "+14405550102",
          displayCode: "C-AAAAAA",
        }),
      ],
      [],
      eventsById(),
    );

  it("matches on name, case-insensitively and partially", () => {
    expect(filterCustomerRows(rows(), "jord").map((r) => r.name)).toEqual(["Jordan Ellis"]);
    expect(filterCustomerRows(rows(), "WHIT").map((r) => r.name)).toEqual(["Dana Whit"]);
  });

  it("matches on email and display code", () => {
    expect(filterCustomerRows(rows(), "gmail")).toHaveLength(1);
    expect(filterCustomerRows(rows(), "C-AAAAAA").map((r) => r.name)).toEqual(["Dana Whit"]);
  });

  it("matches a phone however the operator punctuates it", () => {
    for (const q of ["2165550148", "(216) 555-0148", "216 555 0148", "5550148"]) {
      expect(filterCustomerRows(rows(), q).map((r) => r.name)).toEqual(["Jordan Ellis"]);
    }
  });

  it("returns everything for an empty query, nothing for a miss", () => {
    expect(filterCustomerRows(rows(), "")).toHaveLength(2);
    expect(filterCustomerRows(rows(), "   ")).toHaveLength(2);
    expect(filterCustomerRows(rows(), "nobody")).toHaveLength(0);
  });

  it("doesn't let a letters-only query match every phone on the empty digit string", () => {
    // Regression guard: stripping non-digits from "zzz" yields "", and "".includes("") is true
    // for every row — the filter must not fall into that.
    expect(filterCustomerRows(rows(), "zzz")).toHaveLength(0);
  });
});

describe("soleMatch", () => {
  const rows = () =>
    buildCustomerRows(
      [customer(), customer({ id: asId<"CustomerId">("c2"), name: "Jordan Baker", phoneE164: "+13305550111", displayCode: "C-BBBBBB" })],
      [],
      eventsById(),
    );

  it("returns the row when exactly one matches", () => {
    expect(soleMatch(rows(), "Ellis")?.name).toBe("Jordan Ellis");
  });
  it("returns undefined when the query is ambiguous or empty", () => {
    expect(soleMatch(rows(), "Jordan")).toBeUndefined();
    expect(soleMatch(rows(), "nobody")).toBeUndefined();
  });
});
