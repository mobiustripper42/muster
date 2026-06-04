/**
 * Import Map+Reconcile — header-name resolution, grain, idempotency, quarantine
 * (Task 1.2 / M1). Tested against raw rows (no xlsx needed); the xlsx reader has
 * its own smoke test.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import {
  importReservations,
  parseXolaDate,
  parseXolaTime,
} from "./import-reservations.js";

// Mirrors the real sheet: row 0 = parent groups, row 1 = sub-headers, with a
// drifting add-on column (idx 11) to prove targets resolve by name, not letter.
const HEADER_PARENT = [
  "Reservation ID", "Purchase ID", "Product", "Arrival Date", "Arrival Time",
  "Customer", "", "Guest Breakdown", "", "Status", "Guides", "Flex Insurance: Yes",
];
const HEADER_SUB = [
  "", "", "", "", "", "Name", "Email", "Total Demographics", "Adults", "", "", "Quantity",
];

const BREW = "Brew Boat Party Boats with Captain";
const DUFFY = "Duffy Boat Rental | (1-12 Guests) | Self Captained";

const sampleRows = (): string[][] => [
  HEADER_PARENT,
  HEADER_SUB,
  ["resvA", "pA", BREW, "16-May-2026", "03:30 PM", "Ada Lovelace", "ada@example.com", "16", "16", "Confirmed", "Eric Stoffer", "1"],
  ["resvB", "pB", BREW, "16-May-2026", "03:30 PM", "Grace Hopper", "grace@example.com", "4", "4", "Confirmed", "Eric Stoffer", ""],
  ["resvC", "pC", BREW, "17-May-2026", "01:30 PM", "Alan Turing", "alan@example.com", "2", "2", "Canceled", "", ""],
  ["resvD", "pD", DUFFY, "27-Jun-2026", "06:30 PM", "Edsger Dijkstra", "ed@example.com", "1", "", "Confirmed", "", ""],
  ["resvE", "pE", "JAEGER TRIAL Copy of " + DUFFY, "20-May-2026", "04:00 PM", "Test User", "t@example.com", "0", "", "Confirmed", "", ""],
  ["resvF", "pF", "Mystery Pontoon Sunset Cruise", "01-Jul-2026", "05:00 PM", "Kay Johnson", "kj@example.com", "3", "", "Confirmed", "", ""],
  ["", "", "", "", "", "", "", "", "", "", "", ""],
  ["resvG", "pG", BREW, "Mayberry", "03:30 PM", "Bad Date", "bad@example.com", "2", "", "Confirmed", "", ""],
];

describe("date / time parsing", () => {
  it("parses Xola date and time formats", () => {
    expect(parseXolaDate("16-May-2026")).toBe("2026-05-16");
    expect(parseXolaDate("01-Jan-2027")).toBe("2027-01-01");
    expect(parseXolaTime("03:30 PM")).toBe("15:30");
    expect(parseXolaTime("11:30 AM")).toBe("11:30");
    expect(parseXolaTime("12:00 AM")).toBe("00:00");
    expect(parseXolaTime("12:00 PM")).toBe("12:00");
  });
  it("returns null on unparseable values", () => {
    expect(parseXolaDate("Mayberry")).toBeNull();
    expect(parseXolaTime("noon")).toBeNull();
  });
});

describe("importReservations", () => {
  it("maps rows to events + reservations, grouping by vessel+date+time", async () => {
    const repo = new InMemoryRepository();
    const result = await importReservations(repo, sampleRows());

    // 3 events: brew 05-16 15:30 (A+B), brew 05-17 13:30 (C), duffy 06-27 18:30 (D)
    expect(result.eventsCreated).toBe(3);
    expect((await repo.listEvents()).length).toBe(3);
    // added/updated partition all 4 imported rows (A,B,C,D); C is also new-cancelled.
    expect(result.reservationsAdded).toBe(4);
    expect(result.reservationsUpdated).toBe(0);
    expect(result.reservationsNewlyCancelled).toBe(1); // C
  });

  it("resolves columns by header name despite drifting add-on columns", async () => {
    const repo = new InMemoryRepository();
    await importReservations(repo, sampleRows());
    const resvA = await repo.getReservation(
      // internal id is derived from the Xola Reservation ID
      (await import("../domain/ids.js")).asId("resv-resvA"),
    );
    expect(resvA?.customerName).toBe("Ada Lovelace");
    expect(resvA?.email).toBe("ada@example.com");
    expect(resvA?.partySize).toBe(16);
    expect(resvA?.phone).toBeUndefined(); // phone joined later (DEC-017)
  });

  it("quarantines unmapped products, ignores trial listings, skips blank rows", async () => {
    const repo = new InMemoryRepository();
    const result = await importReservations(repo, sampleRows());
    const reasons = result.skipped.map((s) => s.reason).join(" | ");
    expect(result.skipped).toHaveLength(3); // trial, unmapped, bad-date
    expect(reasons).toMatch(/trial/i);
    expect(reasons).toMatch(/unmapped product/i);
    expect(reasons).toMatch(/unparseable date/i);
  });

  it("is idempotent on re-import — updates in place, no duplicates", async () => {
    const repo = new InMemoryRepository();
    await importReservations(repo, sampleRows());
    const second = await importReservations(repo, sampleRows());

    expect((await repo.listEvents()).length).toBe(3); // no duplicate events
    expect(second.eventsCreated).toBe(0); // all already present
    expect(second.reservationsUpdated).toBe(4); // A, B, C, D re-seen as updates
    expect(second.reservationsAdded).toBe(0);
    expect(second.reservationsNewlyCancelled).toBe(0); // C was already cancelled
  });

  it("returns an empty result for a header-only sheet", async () => {
    const repo = new InMemoryRepository();
    const result = await importReservations(repo, [HEADER_PARENT, HEADER_SUB]);
    expect(result.reservationsAdded).toBe(0);
    expect(result.eventsCreated).toBe(0);
  });

  it("warns (does not silently mis-bind) when a target header is ambiguous", async () => {
    const repo = new InMemoryRepository();
    // A drifted add-on column reintroduces a colliding "Status" header.
    const parent = [...HEADER_PARENT];
    parent[11] = "Status";
    const result = await importReservations(repo, [
      parent,
      HEADER_SUB,
      ["resvA", "pA", BREW, "16-May-2026", "03:30 PM", "Ada", "a@x.com", "2", "2", "Confirmed", "", "Confirmed"],
    ]);
    expect(result.warnings.some((w) => /ambiguous header "Status"/.test(w))).toBe(true);
  });
});
