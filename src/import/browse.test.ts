/**
 * Browse view over imported data (Task 1.2 / M1, SPEC §2.2).
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import { importReservations } from "./import-reservations.js";
import { buildEventBrowse, buildEventDetail, renderEventList } from "./browse.js";

const BREW = "Brew Boat Party Boats with Captain";
const rows = (): string[][] => [
  ["Reservation ID", "Purchase ID", "Product", "Arrival Date", "Arrival Time", "Customer", "", "Guest Breakdown", "", "Status"],
  ["", "", "", "", "", "Name", "Email", "Total Demographics", "Adults", ""],
  ["r1", "p1", BREW, "16-May-2026", "03:30 PM", "Ada Lovelace", "ada@x.com", "16", "16", "Confirmed"],
  ["r2", "p2", BREW, "16-May-2026", "03:30 PM", "Grace Hopper", "grace@x.com", "4", "4", "Confirmed"],
  ["r3", "p3", BREW, "16-May-2026", "03:30 PM", "Cancelled Carl", "carl@x.com", "5", "5", "Canceled"],
];

describe("browse", () => {
  it("lists events with reservation count and booked-pax vs capacity", async () => {
    const repo = new InMemoryRepository();
    await importReservations(repo, rows());
    const list = await buildEventBrowse(repo);

    expect(list).toHaveLength(1);
    expect(list[0]!.reservationCount).toBe(3); // includes the cancelled one
    expect(list[0]!.paxTotal).toBe(20); // booked only: 16 + 4 (cancelled 5 excluded)
    expect(list[0]!.capacity).toBe(16);
  });

  it("event detail shows name, party size, and a nullable-phone placeholder", async () => {
    const repo = new InMemoryRepository();
    await importReservations(repo, rows());
    const eventId = (await buildEventBrowse(repo))[0]!.eventId;
    const detail = await buildEventDetail(repo, eventId);

    expect(detail.reservations).toHaveLength(3);
    const ada = detail.reservations.find((r) => r.customerName === "Ada Lovelace");
    expect(ada?.partySize).toBe(16);
    expect(ada?.phone).toBe("(no number on file)"); // DEC-017 — joined later
    expect(ada?.email).toBe("ada@x.com");
  });

  it("renders a thin text event list", async () => {
    const repo = new InMemoryRepository();
    await importReservations(repo, rows());
    const text = renderEventList(await buildEventBrowse(repo));
    expect(text).toMatch(/2026-05-16 15:30/);
    expect(text).toMatch(/20\/16 pax/);
  });

  it("renders a placeholder for no events", async () => {
    expect(renderEventList([])).toBe("(no events)");
    // sanity: an unknown event id yields empty detail
    const repo = new InMemoryRepository();
    const detail = await buildEventDetail(repo, asId("evt-none"));
    expect(detail.reservations).toHaveLength(0);
  });
});
