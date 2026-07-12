/**
 * Availability read model (11.1) — whole-boat mutex, DEC-108/109 amended.
 */
import { describe, expect, it } from "vitest";
import type { Event, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { canBook, deriveAvailability } from "./availability.js";

const V = asId<"VesselId">("vessel-brew-2");

const ev = (id: string, over: Partial<Event> = {}): Event => ({
  id: asId<"EventId">(id),
  vesselId: V,
  date: "2026-07-04",
  time: "17:00",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  ...over,
});

const res = (id: string, eventId: string, over: Partial<Reservation> = {}): Reservation => ({
  id: asId<"ReservationId">(id),
  eventId: asId<"EventId">(eventId),
  source: "muster",
  customerName: "Mary",
  partySize: 6,
  status: "booked",
  ...over,
});

describe("deriveAvailability — whole-boat mutex", () => {
  it("includes only scheduled Muster events; drops Xola + cancelled", () => {
    const out = deriveAvailability(
      [
        ev("m-open"),
        ev("x-boat", { source: "xola" }), // Xola event — never in the Muster funnel
        ev("m-cancelled", { status: "cancelled" }),
      ],
      [],
    );
    expect(out.map((a) => String(a.eventId))).toEqual(["m-open"]);
    expect(out[0]!.available).toBe(true);
  });

  it("available=false once the boat carries an active Muster reservation (mutex, not a seat count)", () => {
    const out = deriveAvailability(
      [ev("m1")],
      [res("r1", "m1", { partySize: 4 })], // party of 4 on a 12-cap boat...
    );
    // ...still UNAVAILABLE — the whole boat is taken, not "8 seats left" (the old
    // COI − Σ formula would wrongly re-offer it).
    expect(out[0]!.available).toBe(false);
  });

  it("a cancelled reservation does not claim the boat", () => {
    const out = deriveAvailability([ev("m1")], [res("r1", "m1", { status: "cancelled" })]);
    expect(out[0]!.available).toBe(true);
  });

  it("a Xola reservation never claims a Muster event", () => {
    const out = deriveAvailability([ev("m1")], [res("r1", "m1", { source: "xola" })]);
    expect(out[0]!.available).toBe(true);
  });

  it("surfaces price (DEC-112) when present, omits it when unpriced", () => {
    const [priced, free] = deriveAvailability(
      [ev("m1", { price: 49900 }), ev("m2")],
      [],
    );
    expect(priced!.price).toBe(49900);
    expect("price" in free!).toBe(false);
  });
});

describe("canBook — the whole-boat claim predicate", () => {
  const event = ev("m1", { capacity: 12 });

  it("true: unclaimed Muster event, party within the COI cap", () => {
    expect(canBook(event, [], 12)).toBe(true); // party == capacity is allowed
    expect(canBook(event, [], 1)).toBe(true);
  });

  it("false: the boat is already claimed by an active Muster reservation", () => {
    expect(canBook(event, [res("r1", "m1")], 2)).toBe(false);
  });

  it("false: party exceeds the boat's COI cap", () => {
    expect(canBook(event, [], 13)).toBe(false);
  });

  it("false: non-positive or non-integer party size", () => {
    expect(canBook(event, [], 0)).toBe(false);
    expect(canBook(event, [], -1)).toBe(false);
    expect(canBook(event, [], 2.5)).toBe(false);
  });

  it("false: not a sellable event (Xola, or cancelled)", () => {
    expect(canBook(ev("x", { source: "xola" }), [], 4)).toBe(false);
    expect(canBook(ev("c", { status: "cancelled" }), [], 4)).toBe(false);
  });

  it("a cancelled reservation on the boat does not block a new booking", () => {
    expect(canBook(event, [res("r1", "m1", { status: "cancelled" })], 4)).toBe(true);
  });
});
