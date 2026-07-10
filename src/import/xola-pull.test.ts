/**
 * The Xola pull orchestrator (DEC-043) — the full fetch(events ⨝ orders) → map →
 * import → formShifts chain, driven against the in-memory repo with a path-routing
 * fake fetcher (no network). `tz: "UTC"` pins the window math the way the engine
 * tests pin time. This is the G1–G9 harness: what reservation/event changes ripple
 * to a shift, and which correctly DON'T.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { SeatId, ShiftId, VesselId } from "../domain/ids.js";
import { STAFFING_HORIZON_LEAD_DAYS } from "../builder/derive.js";
import { seedFleet } from "./resource-map.js";
import { addDays, pullWindow, pullXola, vesselLocalDate } from "./xola-pull.js";
import type { XolaEvent, XolaFetcher, XolaOrder, XolaOrderItem } from "./xola-client.js";

// Real Xola resource ids → seeded vessels (Session 22).
const RES = {
  brew1: "656e10bc5b8ef1b1800a02c4",
  brew2: "656e10ce46c61175bd0de305",
  brew3: "656e0fcdf9f593e84b0e1782",
  brew4: "656e0feb91aa27f36908371b",
  duffy: "656e0f760c4f4326c10c1b8b",
};
const V = {
  brew1: asId<"VesselId">("vessel-brew-1"),
  brew2: asId<"VesselId">("vessel-brew-2"),
  brew3: asId<"VesselId">("vessel-brew-3"),
  brew4: asId<"VesselId">("vessel-brew-4"),
};

describe("window math", () => {
  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("vesselLocalDate resolves the instant into the vessel's calendar day", () => {
    expect(vesselLocalDate(new Date("2026-06-18T03:00:00Z"), "America/New_York")).toBe("2026-06-17");
  });
  it("pullWindow spans [today-1, today+leadDays+1] vessel-local", () => {
    expect(pullWindow(new Date("2026-07-01T12:00:00Z"), 7, "UTC")).toEqual({
      start: "2026-06-30",
      end: "2026-07-09",
    });
  });
});

describe("pull window decoupled from staffing horizon (DEC-080)", () => {
  let repo: InMemoryRepository;
  const NOW = new Date("2026-07-01T12:00:00Z");
  // Empty fetch — we only care about the computed window, which pullXola returns.
  const fetcher: XolaFetcher = async (path) =>
    path.startsWith("/events") ? [] : { data: [], paging: { next: null } };

  beforeEach(async () => {
    repo = new InMemoryRepository();
    await seedFleet(repo);
  });

  it("pullLeadDays widens the /orders fetch window", async () => {
    const r = await pullXola(repo, fetcher, "seller-x", NOW, { pullLeadDays: 30, tz: "UTC" });
    expect(r.window).toEqual({ start: "2026-06-30", end: "2026-08-01" });
  });

  it("the staffing horizon (leadDays) no longer moves the pull window", async () => {
    // Pre-DEC-080 this widened the window too; now it must not — the window
    // stays at the default pull lead while leadDays only feeds shift formation.
    const r = await pullXola(repo, fetcher, "seller-x", NOW, { leadDays: 30, tz: "UTC" });
    expect(r.window).toEqual({ start: "2026-06-30", end: "2026-07-09" });
  });

  it("pullWindow defaults its lead to XOLA_PULL_LEAD_DAYS (== horizon when unset)", () => {
    expect(pullWindow(NOW, undefined, "UTC")).toEqual(
      pullWindow(NOW, STAFFING_HORIZON_LEAD_DAYS, "UTC"),
    );
  });
});

describe("pullXola — G1–G9 reconcile harness", () => {
  let repo: InMemoryRepository;
  const NOW = new Date("2026-07-01T12:00:00Z");
  const LATER = new Date("2026-07-01T13:00:00Z");

  beforeEach(async () => {
    repo = new InMemoryRepository();
    await seedFleet(repo); // the 4 real boats + captain/mate roles
  });

  // ── fixture builders ────────────────────────────────────────────────────────
  const ev = (id: string, resource: string | null, start = "2026-07-04T18:00:00+00:00"): XolaEvent => ({
    id,
    start,
    resourceUsages: resource ? [{ resource: { id: resource } }] : [],
  });
  const item = (eventId: string, over: Partial<XolaOrderItem> = {}): XolaOrderItem => ({
    id: over.id ?? `r-${eventId}`,
    name: "Brew Boat Party Boats with Captain",
    arrivalDatetime: over.arrivalDatetime ?? "2026-07-04T18:00:00-04:00",
    quantity: over.quantity ?? 6,
    status: over.status ?? 200,
    event: { id: eventId },
    ...over,
  });
  const ordersOf = (...items: XolaOrderItem[]): XolaOrder[] => [
    { id: "ord", customerName: "Cust", phoneCanonical: "5550000", items },
  ];
  const fetcherFor = (events: XolaEvent[], orders: XolaOrder[]): XolaFetcher => async (path) =>
    path.startsWith("/events") ? events : { data: orders, paging: { next: null } };
  const pull = (events: XolaEvent[], orders: XolaOrder[], now = NOW) =>
    pullXola(repo, fetcherFor(events, orders), "seller-x", now, { tz: "UTC" });

  const shiftId = (v: VesselId, date = "2026-07-04"): ShiftId => asId<"ShiftId">(`shift-${v}-${date}`);
  const seatCount = async (v: VesselId, date = "2026-07-04") =>
    (await repo.listSeatsForShift(shiftId(v, date))).length;
  const crewShift = async (v: VesselId, date = "2026-07-04") => {
    for (const s of await repo.listSeatsForShift(shiftId(v, date))) {
      await repo.saveSeat({ ...s, state: "Confirmed", assignedCrewMemberId: asId<"CrewMemberId">("c1") });
    }
  };

  // ── G1: the collapse fix ──────────────────────────────────────────────────
  it("G1.1 four boats at the same slot → four distinct shifts, 2 seats each", async () => {
    const events = [ev("e1", RES.brew1), ev("e2", RES.brew2), ev("e3", RES.brew3), ev("e4", RES.brew4)];
    const orders = ordersOf(item("e1"), item("e2"), item("e3"), item("e4"));
    await pull(events, orders);

    expect((await repo.listEvents()).length).toBe(4);
    expect((await repo.listShifts()).length).toBe(4);
    for (const v of [V.brew1, V.brew2, V.brew3, V.brew4]) expect(await seatCount(v)).toBe(2);
  });

  it("G1.2 same boat, two trips one day → one shift batching both, still 2 seats", async () => {
    const events = [
      ev("e1", RES.brew3, "2026-07-04T12:00:00+00:00"),
      ev("e2", RES.brew3, "2026-07-04T18:00:00+00:00"),
    ];
    const orders = ordersOf(
      item("e1", { arrivalDatetime: "2026-07-04T12:00:00-04:00" }),
      item("e2", { arrivalDatetime: "2026-07-04T18:00:00-04:00" }),
    );
    await pull(events, orders);

    expect((await repo.listShifts()).length).toBe(1);
    const shift = await repo.getShift(shiftId(V.brew3));
    expect(shift?.eventIds.length).toBe(2);
    expect(await seatCount(V.brew3)).toBe(2);
  });

  // ── G2: idempotency ─────────────────────────────────────────────────────────
  it("G2.1 identical re-pull creates nothing and does not bump updatedAt", async () => {
    const fx: [XolaEvent[], XolaOrder[]] = [[ev("e1", RES.brew2)], ordersOf(item("e1"))];
    await pull(...fx, NOW);
    const before = (await repo.getReservation(asId<"ReservationId">("resv-r-e1")))?.updatedAt;

    const second = await pull(...fx, LATER);
    expect(second.import.eventsCreated).toBe(0);
    expect(second.form.shiftsCreated).toBe(0);
    const after = (await repo.getReservation(asId<"ReservationId">("resv-r-e1")))?.updatedAt;
    expect(after).toBe(before); // not material → timestamp preserved
  });

  it("G2.2 a material change (partySize) bumps updatedAt but not the shift/seats", async () => {
    await pull([ev("e1", RES.brew2)], ordersOf(item("e1", { quantity: 6 })), NOW);
    await pull([ev("e1", RES.brew2)], ordersOf(item("e1", { quantity: 12 })), LATER);

    const resv = await repo.getReservation(asId<"ReservationId">("resv-r-e1"));
    expect(resv?.partySize).toBe(12);
    expect(resv?.updatedAt).toBe(LATER.toISOString());
    expect(await seatCount(V.brew2)).toBe(2); // pax ≠ crew
  });

  it("G2.3 a non-material change (phone) does NOT bump updatedAt", async () => {
    await pull([ev("e1", RES.brew2)], ordersOf(item("e1")), NOW);
    const before = (await repo.getReservation(asId<"ReservationId">("resv-r-e1")))?.updatedAt;
    await pull([ev("e1", RES.brew2)], [{ id: "ord", customerName: "Cust", phone: "9", phoneCanonical: "9", items: [item("e1")] }], LATER);
    const after = (await repo.getReservation(asId<"ReservationId">("resv-r-e1")))?.updatedAt;
    expect(after).toBe(before);
  });

  // ── G3: reservation adds that (do or don't) move a shift ──────────────────────
  it("G3.1 a booking on a new boat-trip → a new shift with 2 open seats", async () => {
    await pull([], []); // nothing yet
    const r = await pull([ev("e1", RES.brew1)], ordersOf(item("e1")), LATER);
    expect(r.import.reservationsAdded).toBe(1);
    expect(r.form.shiftsCreated).toBe(1);
    expect(await seatCount(V.brew1)).toBe(2);
  });

  it("G3.2 a second booking on an already-boated trip adds pax, NOT crew", async () => {
    await pull([ev("e1", RES.brew2)], ordersOf(item("e1", { id: "a" })), NOW);
    const r = await pull([ev("e1", RES.brew2)], ordersOf(item("e1", { id: "a" }), item("e1", { id: "b" })), LATER);
    expect(r.import.reservationsAdded).toBe(1); // the new booking
    expect(r.form.shiftsCreated).toBe(0);
    expect(r.form.seatsCreated).toBe(0);
    expect(await seatCount(V.brew2)).toBe(2);
  });

  it("G3.MULTI a trip added to a CREWED boat-day → crew covers it, no new seat/ask", async () => {
    // Crewed Brew 2 day running 11:30 + 15:30.
    await pull(
      [ev("e1", RES.brew2, "2026-07-04T11:30:00+00:00"), ev("e2", RES.brew2, "2026-07-04T15:30:00+00:00")],
      ordersOf(item("e1", { arrivalDatetime: "2026-07-04T11:30:00-04:00" }), item("e2", { arrivalDatetime: "2026-07-04T15:30:00-04:00" })),
      NOW,
    );
    await crewShift(V.brew2); // captain + mate confirmed for the boat-day

    // A 13:30 booking lands on the SAME boat-day.
    const r = await pull(
      [
        ev("e1", RES.brew2, "2026-07-04T11:30:00+00:00"),
        ev("e2", RES.brew2, "2026-07-04T15:30:00+00:00"),
        ev("e3", RES.brew2, "2026-07-04T13:30:00+00:00"),
      ],
      ordersOf(
        item("e1", { arrivalDatetime: "2026-07-04T11:30:00-04:00" }),
        item("e2", { arrivalDatetime: "2026-07-04T15:30:00-04:00" }),
        item("e3", { arrivalDatetime: "2026-07-04T13:30:00-04:00" }),
      ),
      LATER,
    );

    const shift = await repo.getShift(shiftId(V.brew2));
    expect(shift?.eventIds.length).toBe(3); // the new trip joined the day
    expect(r.form.seatsCreated).toBe(0); // no new seat
    const seats = await repo.listSeatsForShift(shiftId(V.brew2));
    expect(seats).toHaveLength(2);
    expect(seats.every((s) => s.state === "Confirmed")).toBe(true); // existing crew still cover it
    expect(shift?.state).toBe("Crewed");
  });

  it("G3.4 a booking on a boat-less event is skipped; once boated, the shift forms", async () => {
    const r1 = await pull([ev("e1", null)], ordersOf(item("e1")), NOW); // no resource yet
    expect(r1.form.shiftsCreated).toBe(0);
    expect(r1.mapSkipped).toBe(1);
    expect(await repo.getShift(shiftId(V.brew1))).toBeNull();

    const r2 = await pull([ev("e1", RES.brew1)], ordersOf(item("e1")), LATER); // boat assigned
    expect(r2.form.shiftsCreated).toBe(1);
    expect(await seatCount(V.brew1)).toBe(2);
  });

  it("G3.4b an IN-WINDOW booked boat-less trip is flagged in bookedNoBoat (#338)", async () => {
    const r = await pull([ev("e1", null)], ordersOf(item("e1")), NOW); // 2026-07-04, in window
    expect(r.mapSkipped).toBe(1);
    expect(r.bookedNoBoat).toHaveLength(1);
    expect(r.bookedNoBoat[0]).toMatchObject({
      date: "2026-07-04",
      category: "booked_no_boat",
      product: "Brew Boat Party Boats with Captain",
    });
  });

  it("G3.4c an OUT-OF-WINDOW booked boat-less trip counts but is NOT flagged (#338)", async () => {
    // Window is [today-1, today+lead+1]; a December trip is well past it → benign edge.
    const far = item("e1", { arrivalDatetime: "2026-12-25T18:00:00-04:00" });
    const r = await pull([ev("e1", null, "2026-12-25T18:00:00+00:00")], ordersOf(far), NOW);
    expect(r.mapSkipped).toBe(1);
    expect(r.bookedNoBoat).toHaveLength(0);
  });

  // ── G4: cancellations (the 11pm-call signal) ─────────────────────────────────
  it("G4.1 one of several bookings cancels → trip stays scheduled, shift unchanged", async () => {
    await pull([ev("e1", RES.brew2)], ordersOf(item("e1", { id: "a" }), item("e1", { id: "b" })), NOW);
    const r = await pull(
      [ev("e1", RES.brew2)],
      ordersOf(item("e1", { id: "a", status: 700 }), item("e1", { id: "b" })),
      LATER,
    );
    expect(r.import.reservationsNewlyCancelled).toBe(1);
    expect(r.form.shiftsCancelled).toBe(0);
    expect((await repo.getEvent(asId<"EventId">("e1")))?.status).toBe("scheduled");
  });

  it("G4.2 the last booking cancels (trip de-boats) → shift Cancelled", async () => {
    await pull([ev("e1", RES.brew2)], ordersOf(item("e1")), NOW);
    expect((await repo.getShift(shiftId(V.brew2)))?.state).not.toBe("Cancelled");

    // The trip de-boats (gone from /events) and its booking is now 700.
    const r = await pull([], ordersOf(item("e1", { status: 700 })), LATER);
    expect(r.import.reservationsNewlyCancelled).toBe(1);
    expect((await repo.getEvent(asId<"EventId">("e1")))?.status).toBe("cancelled");
    expect((await repo.getShift(shiftId(V.brew2)))?.state).toBe("Cancelled");
  });

  it("G4.3 re-pulling an already-reconciled cancel is not re-counted", async () => {
    await pull([ev("e1", RES.brew2)], ordersOf(item("e1")), NOW);
    await pull([], ordersOf(item("e1", { status: 700 })), LATER);
    const r3 = await pull([], ordersOf(item("e1", { status: 700 })), LATER);
    expect(r3.import.reservationsNewlyCancelled).toBe(0);
  });

  // ── G5: boat reassignment (reconciles in place) ──────────────────────────────
  it("G5.1 reassigning the boat re-keys the shift in place, no orphan", async () => {
    await pull([ev("e1", RES.brew3)], ordersOf(item("e1")), NOW);
    expect(await repo.getShift(shiftId(V.brew3))).not.toBeNull();

    await pull([ev("e1", RES.brew1)], ordersOf(item("e1")), LATER); // Drew moves it 3 → 1
    expect((await repo.listEvents()).length).toBe(1); // same event.id, not a duplicate
    expect((await repo.getEvent(asId<"EventId">("e1")))?.vesselId).toBe(V.brew1);
    expect((await repo.getShift(shiftId(V.brew3)))?.state).toBe("Cancelled");
    expect(await repo.getShift(shiftId(V.brew1))).not.toBeNull();
  });

  it("G5.2 a confirmed crew does NOT auto-follow a reassigned boat", async () => {
    await pull([ev("e1", RES.brew3)], ordersOf(item("e1")), NOW);
    await crewShift(V.brew3);

    await pull([ev("e1", RES.brew1)], ordersOf(item("e1")), LATER);
    // old shift cancelled with its confirmed seat still on it (surfaced, not moved)
    expect((await repo.getShift(shiftId(V.brew3)))?.state).toBe("Cancelled");
    const oldSeats = await repo.listSeatsForShift(shiftId(V.brew3));
    expect(oldSeats.some((s) => s.state === "Confirmed")).toBe(true);
    // new shift opens fresh seats to crew
    const newSeats = await repo.listSeatsForShift(shiftId(V.brew1));
    expect(newSeats).toHaveLength(2);
    expect(newSeats.every((s) => s.state === "Open")).toBe(true);
  });

  // ── G6: filtering / exclusion (DEC-018 on the resource axis) ──────────────────
  it("G6.1 a Duffy (self-captained) trip forms no shift", async () => {
    const r = await pull([ev("e1", RES.duffy)], ordersOf(item("e1")), NOW);
    expect(r.excludedResources).toBe(1);
    expect((await repo.listShifts()).length).toBe(0);
  });

  it("G6.2 an unknown resource id is quarantined, surfaced, forms no shift", async () => {
    const r = await pull([ev("e1", "ffffffffffffffffffffffff")], ordersOf(item("e1")), NOW);
    expect(r.unmappedResources).toHaveLength(1);
    expect((await repo.listShifts()).length).toBe(0);
  });

  it("G6.3 a boat-less event forms no shift", async () => {
    const r = await pull([ev("e1", null)], ordersOf(item("e1")), NOW);
    expect(r.mapSkipped).toBe(1);
    expect((await repo.listShifts()).length).toBe(0);
  });

  // ── G7: timezone / wall-clock (DEC-032) ──────────────────────────────────────
  it("G7.1 event/order time is the local wall-clock (string-sliced, never parsed)", async () => {
    await pull([ev("e1", RES.brew2, "2026-07-04T18:00:00+00:00")], ordersOf(item("e1")), NOW);
    const e = await repo.getEvent(asId<"EventId">("e1"));
    expect([e?.date, e?.time]).toEqual(["2026-07-04", "18:00"]); // not 22:00 / next day
    expect((await repo.getShift(shiftId(V.brew2)))?.date).toBe("2026-07-04");
  });

  it("G7.2 a DST-boundary trip keeps its wall-clock — no ±1h drift", async () => {
    // 2026-11-01 01:30 is the fall-back ambiguous hour; the slice must not shift it.
    await pull(
      [ev("e-dst", RES.brew2, "2026-11-01T01:30:00+00:00")],
      ordersOf(item("e-dst", { arrivalDatetime: "2026-11-01T01:30:00-04:00" })),
      NOW,
    );
    const e = await repo.getEvent(asId<"EventId">("e-dst"));
    expect([e?.date, e?.time]).toEqual(["2026-11-01", "01:30"]);
  });

  // ── G8: horizon birth (DEC-022) ──────────────────────────────────────────────
  it("G8.3 birth is horizon-aware: Pending before the horizon, Filling after", async () => {
    // trip 2026-07-04; horizon = trip − 7d ≈ 2026-06-27 (vessel tz).
    await pull([ev("e1", RES.brew2)], ordersOf(item("e1")), new Date("2026-06-20T12:00:00Z"));
    expect((await repo.getShift(shiftId(V.brew2)))?.state).toBe("Pending");

    repo = new InMemoryRepository();
    await seedFleet(repo);
    await pull([ev("e1", RES.brew2)], ordersOf(item("e1")), NOW); // 2026-07-01, past horizon
    expect((await repo.getShift(shiftId(V.brew2)))?.state).toBe("Filling");
  });

  // ── G9: result contract + assignment summary ─────────────────────────────────
  it("G9.1 reports accurate counts and a per-day boat→times assignment summary", async () => {
    const events = [
      ev("e1", RES.brew1, "2026-07-04T11:30:00+00:00"),
      ev("e2", RES.brew1, "2026-07-04T15:30:00+00:00"),
      ev("e3", RES.brew2, "2026-07-04T13:30:00+00:00"),
    ];
    const orders = ordersOf(
      item("e1", { arrivalDatetime: "2026-07-04T11:30:00-04:00" }),
      item("e2", { arrivalDatetime: "2026-07-04T15:30:00-04:00" }),
      item("e3", { arrivalDatetime: "2026-07-04T13:30:00-04:00" }),
    );
    const r = await pull(events, orders);

    expect(r.eventsFetched).toBe(3);
    expect(r.boatedEvents).toBe(3);
    expect(r.recordsMapped).toBe(3);
    expect(r.import.reservationsAdded).toBe(3);
    expect(r.assignments).toEqual([
      {
        date: "2026-07-04",
        boats: [
          { vesselId: V.brew1, times: ["11:30", "15:30"] },
          { vesselId: V.brew2, times: ["13:30"] },
        ],
      },
    ]);
  });
});
