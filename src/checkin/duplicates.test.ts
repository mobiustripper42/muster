/**
 * Likely duplicates (Phase 18.6, issue #1120) — the rule every check-in surface counts with.
 *
 * An obvious duplicate is the same name, case and spacing ignored, and the same date of birth, within
 * one booking; walk-ups match only walk-ups (operator, 2026-10-02). It counts once and shows "×2".
 * Every signing stays its own row.
 */
import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { Guest } from "./entities.js";
import { groupSignings, peopleSigned } from "./duplicates.js";

const EVENT = asId<"EventId">("evt-3pm");
const SMITHS = asId<"ReservationId">("res-smith");
const NOWAKS = asId<"ReservationId">("res-nowak");
const tick = { at: "2026-10-10T18:50:00.000Z", by: asId<"CrewMemberId">("crew-quint") };

function guest(id: string, name: string, over: Partial<Guest> = {}): Guest {
  return {
    id: asId<"GuestId">(id),
    eventId: EVENT,
    reservationId: SMITHS,
    name,
    email: `${id}@example.com`,
    dob: "1980-04-02",
    isMinor: false,
    signedAt: "2026-10-01T18:00:00.000Z",
    source: "self",
    createdAt: "2026-10-01T18:00:00.000Z",
    ...over,
  };
}

const ids = (groups: Guest[][]) => groups.map((g) => g.map((x) => String(x.id)));

describe("groupSignings — which signings are one person", () => {
  it("the same name and date of birth on one booking is one person, earliest signing first", () => {
    const later = guest("g-fred-2", "Fred Kowalski", { createdAt: "2026-10-03T09:00:00.000Z" });
    const first = guest("g-fred-1", "Fred Kowalski", { createdAt: "2026-10-01T09:00:00.000Z" });
    expect(ids(groupSignings([later, first]))).toEqual([["g-fred-1", "g-fred-2"]]);
  });

  it("ignores case and spacing in the name", () => {
    const groups = groupSignings([guest("a", "Fred Kowalski"), guest("b", "  fred   KOWALSKI ")]);
    expect(groups).toHaveLength(1);
  });

  it("the same name with a different date of birth is two people — Sr. and Jr. sail together", () => {
    const groups = groupSignings([guest("sr", "Robert Smith", { dob: "1960-01-01" }), guest("jr", "Robert Smith", { dob: "1990-01-01" })]);
    expect(groups).toHaveLength(2);
  });

  it("a shared email is not a match — couples share one", () => {
    const groups = groupSignings([guest("a", "Amy Nowak", { email: "home@example.com" }), guest("b", "Joe Nowak", { email: "home@example.com" })]);
    expect(groups).toHaveLength(2);
  });

  it("only within one booking — a Fred on another booking is a different Fred", () => {
    const groups = groupSignings([guest("a", "Fred Kowalski"), guest("b", "Fred Kowalski", { reservationId: NOWAKS })]);
    expect(groups).toHaveLength(2);
  });

  it("walk-ups match only walk-ups", () => {
    const { reservationId: _none, ...walkUp } = guest("w1", "Fred Kowalski");
    const groups = groupSignings([walkUp, { ...walkUp, id: asId<"GuestId">("w2") }, guest("b", "Fred Kowalski")]);
    expect(ids(groups).map((g) => g.length).sort()).toEqual([1, 2]);
  });

  it("a minor added twice is one minor", () => {
    const kyle = (id: string): Guest => guest(id, "Kyle Smith", { dob: "2014-06-20", isMinor: true, guardianGuestId: asId<"GuestId">("g-robert") });
    expect(groupSignings([kyle("k1"), kyle("k2")])).toHaveLength(1);
  });

  it("with no date of birth (retention cleared it) nothing can be told, so nothing is grouped", () => {
    const { dob: _a, ...one } = guest("a", "Fred Kowalski");
    const { dob: _b, ...two } = guest("b", "Fred Kowalski");
    expect(groupSignings([one, two])).toHaveLength(2);
  });
});

describe("peopleSigned — the count every surface shows", () => {
  it("a duplicate counts once", () => {
    expect(peopleSigned([guest("a", "Fred Kowalski"), guest("b", "Fred Kowalski"), guest("c", "Grace Kim")])).toBe(2);
  });

  it("a 'duplicate' the mate checked in twice was two people, and counts twice (Check in again)", () => {
    const both = [guest("a", "Fred Kowalski", { checkedIn: tick }), guest("b", "Fred Kowalski", { checkedIn: tick })];
    expect(peopleSigned(both)).toBe(2);
  });

  it("one of the two ticked is still one person", () => {
    expect(peopleSigned([guest("a", "Fred Kowalski", { checkedIn: tick }), guest("b", "Fred Kowalski")])).toBe(1);
  });

  it("nobody is zero", () => {
    expect(peopleSigned([])).toBe(0);
  });
});
