/**
 * Browse view over imported data (Task 1.2 / M1, SPEC §2.2). Data is set up via the
 * event-id-keyed seam (DEC-043) — one trip, three bookings (two booked, one
 * cancelled) on a real Brew 2 (cap 16).
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import { buildEventBrowse, buildEventDetail, renderEventList } from "./browse.js";
import { importRecords, type RawReservationRecord } from "./import-reservations.js";

const BREW = "Brew Boat Party Boats with Captain";
const V_BREW2 = asId<"VesselId">("vessel-brew-2"); // cap 16

const records = (): RawReservationRecord[] => [
  { reservationId: "r1", product: BREW, eventId: "evt-1", vesselId: V_BREW2, date: "2026-05-16", time: "15:30", customerName: "Ada Lovelace", email: "ada@x.com", partySize: 16, status: "booked" },
  { reservationId: "r2", product: BREW, eventId: "evt-1", vesselId: V_BREW2, date: "2026-05-16", time: "15:30", customerName: "Grace Hopper", email: "grace@x.com", partySize: 4, status: "booked" },
  { reservationId: "r3", product: BREW, eventId: "evt-1", date: "2026-05-16", time: "15:30", customerName: "Cancelled Carl", email: "carl@x.com", partySize: 5, status: "cancelled" },
];

describe("browse", () => {
  it("lists events with reservation count and booked-pax vs capacity", async () => {
    const repo = new InMemoryRepository();
    await importRecords(repo, records());
    const list = await buildEventBrowse(repo);

    expect(list).toHaveLength(1);
    expect(list[0]!.reservationCount).toBe(3); // includes the cancelled one
    expect(list[0]!.paxTotal).toBe(20); // booked only: 16 + 4 (cancelled 5 excluded)
    expect(list[0]!.capacity).toBe(16);
  });

  it("event detail shows name, party size, and a nullable-phone placeholder", async () => {
    const repo = new InMemoryRepository();
    await importRecords(repo, records());
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
    await importRecords(repo, records());
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
