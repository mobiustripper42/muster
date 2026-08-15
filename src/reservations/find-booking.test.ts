/**
 * Booking recovery matching (12.7, issue #460) — "lost your link?".
 *
 * The pure half: which booking, if any, does a typed contact + name refer to. Everything about
 * *sending* is the caller's; this decides only what was matched, which is the part that has to
 * be right and the part worth testing exhaustively.
 */
import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { Event, Reservation } from "../domain/entities.js";
import { matchBookingForRecovery, type RecoveryRow } from "./find-booking.js";

const TODAY = "2026-08-15";

const row = (over: {
  id: string;
  name?: string;
  email?: string | undefined;
  phone?: string | undefined;
  date?: string;
  status?: Reservation["status"];
}): RecoveryRow => {
  const reservation = {
    id: asId<"ReservationId">(over.id),
    eventId: asId<"EventId">(`evt-${over.id}`),
    source: "muster",
    customerName: over.name ?? "Marcus Webb",
    partySize: 4,
    status: over.status ?? "booked",
    ...(over.email !== undefined ? { email: over.email } : {}),
    ...(over.phone !== undefined ? { phone: over.phone } : {}),
  } as Reservation;
  const event = {
    id: asId<"EventId">(`evt-${over.id}`),
    vesselId: asId<"VesselId">("v-1"),
    date: over.date ?? "2026-09-12",
    time: "13:30",
    capacity: 12,
    status: "scheduled",
    source: "muster",
  } as Event;
  return { reservation, event };
};

describe("matchBookingForRecovery", () => {
  it("matches on email + last name", () => {
    const rows = [row({ id: "r1", email: "marcus@example.com" })];
    expect(
      matchBookingForRecovery(rows, { contact: "marcus@example.com", lastName: "Webb" }, TODAY)
        ?.reservation.id,
    ).toBe("r1");
  });

  it("matches on a phone typed any way a human types one", () => {
    // The stored value and the typed value are canonicalized through the SAME function the
    // booking form uses, so "(216) 555-0148", "216-555-0148" and "+12165550148" are one number.
    const rows = [row({ id: "r1", phone: "216-555-0148" })];
    for (const typed of ["(216) 555-0148", "216.555.0148", "+1 216 555 0148", "2165550148"]) {
      expect(matchBookingForRecovery(rows, { contact: typed, lastName: "Webb" }, TODAY)?.reservation.id).toBe("r1");
    }
  });

  it("is case- and space-insensitive on both fields", () => {
    const rows = [row({ id: "r1", email: "Marcus@Example.com" })];
    expect(
      matchBookingForRecovery(rows, { contact: "  MARCUS@example.COM ", lastName: " webb " }, TODAY)
        ?.reservation.id,
    ).toBe("r1");
  });

  it("accepts ANY token of the stored name, not just the last one", () => {
    // `customerName` is one string — there is no first/last split — so "last name" can only be a
    // guess at tokenization. "Ana Maria de la Cruz" has no single right answer, and the name is
    // not doing authentication here (the link goes to the contact on file either way), so a
    // stricter rule would only fail honest customers at a step that protects nothing.
    const rows = [row({ id: "r1", name: "Ana Maria de la Cruz", email: "ana@example.com" })];
    for (const typed of ["Cruz", "ana", "Maria"]) {
      expect(matchBookingForRecovery(rows, { contact: "ana@example.com", lastName: typed }, TODAY)?.reservation.id).toBe("r1");
    }
  });

  it("refuses when the name does not match the contact's booking", () => {
    // Contact alone is not enough: knowing someone's phone number should not summon their trip.
    const rows = [row({ id: "r1", phone: "216-555-0148" })];
    expect(matchBookingForRecovery(rows, { contact: "216-555-0148", lastName: "Nguyen" }, TODAY)).toBeNull();
  });

  it("refuses an unusable contact rather than matching loosely", () => {
    const rows = [row({ id: "r1", phone: "216-555-0148" })];
    for (const junk of ["", "   ", "nope", "555"]) {
      expect(matchBookingForRecovery(rows, { contact: junk, lastName: "Webb" }, TODAY)).toBeNull();
    }
  });

  it("prefers the SOONEST UPCOMING trip when a contact has several", () => {
    // The person asking for their link is almost always asking about the trip they are about to
    // take. Handing them the oldest booking would be technically a match and useless.
    const rows = [
      row({ id: "past", date: "2026-07-01", email: "m@example.com" }),
      row({ id: "soon", date: "2026-08-20", email: "m@example.com" }),
      row({ id: "later", date: "2026-10-05", email: "m@example.com" }),
    ];
    expect(matchBookingForRecovery(rows, { contact: "m@example.com", lastName: "Webb" }, TODAY)?.reservation.id).toBe("soon");
  });

  it("falls back to the most recent PAST trip when nothing is upcoming", () => {
    // A completed trip's link is still worth recovering — the receipt and the post-trip tip live
    // behind it.
    const rows = [
      row({ id: "old", date: "2026-05-01", email: "m@example.com" }),
      row({ id: "recent", date: "2026-07-01", email: "m@example.com" }),
    ];
    expect(matchBookingForRecovery(rows, { contact: "m@example.com", lastName: "Webb" }, TODAY)?.reservation.id).toBe("recent");
  });

  it("skips cancelled bookings when a live one exists, but recovers one if that is all there is", () => {
    const both = [
      row({ id: "dead", date: "2026-08-20", email: "m@example.com", status: "cancelled" }),
      row({ id: "live", date: "2026-09-12", email: "m@example.com" }),
    ];
    expect(matchBookingForRecovery(both, { contact: "m@example.com", lastName: "Webb" }, TODAY)?.reservation.id).toBe("live");

    const onlyDead = [row({ id: "dead", date: "2026-08-20", email: "m@example.com", status: "cancelled" })];
    expect(matchBookingForRecovery(onlyDead, { contact: "m@example.com", lastName: "Webb" }, TODAY)?.reservation.id).toBe("dead");
  });

  it("never matches a Xola-sourced booking — it has no Muster link to recover", () => {
    const rows = [row({ id: "x1", email: "m@example.com" })];
    rows[0]!.reservation = { ...rows[0]!.reservation, source: "xola" };
    expect(matchBookingForRecovery(rows, { contact: "m@example.com", lastName: "Webb" }, TODAY)).toBeNull();
  });
});
