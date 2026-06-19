/**
 * The Xola pull orchestrator (DEC-036, 5.4b): window math + the full
 * fetch→map→import→formShifts chain, driven against the in-memory repo with a
 * fake fetcher (no network). `tz: "UTC"` keeps the window deterministic, the way
 * the engine tests pin time.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import { seedFleet } from "./product-map.js";
import { addDays, pullWindow, pullXola, vesselLocalDate } from "./xola-pull.js";
import type { XolaFetcher, XolaOrder, XolaOrderItem, XolaPage } from "./xola-client.js";

describe("window math", () => {
  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-06-18", 8)).toBe("2026-06-26");
  });

  it("vesselLocalDate resolves the instant into the vessel's calendar day", () => {
    // 03:00Z is still the previous evening in New York.
    expect(vesselLocalDate(new Date("2026-06-18T03:00:00Z"), "America/New_York")).toBe("2026-06-17");
    expect(vesselLocalDate(new Date("2026-06-18T12:00:00Z"), "UTC")).toBe("2026-06-18");
  });

  it("pullWindow spans [today-1, today+leadDays+1] vessel-local", () => {
    const w = pullWindow(new Date("2026-06-18T12:00:00Z"), 7, "UTC");
    expect(w).toEqual({ start: "2026-06-17", end: "2026-06-26" });
  });
});

describe("pullXola — fetch → map → import → formShifts", () => {
  let repo: InMemoryRepository;
  const NOW = new Date("2026-06-18T12:00:00Z");

  beforeEach(async () => {
    repo = new InMemoryRepository();
    await seedFleet(repo); // vessels + role types so the builder can derive seats
  });

  /** A fake fetcher that returns `orders` as one terminal page, ignoring the path. */
  const fixedFetcher =
    (orders: XolaOrder[]): XolaFetcher =>
    async (): Promise<XolaPage> => ({ data: orders, paging: { next: null } });

  const order = (over: Partial<XolaOrderItem> = {}, top: Partial<XolaOrder> = {}): XolaOrder => ({
    id: `ord-${over.id ?? "1"}`,
    customerName: "Robert H",
    phone: "440 333 1155",
    phoneCanonical: "4403331155",
    items: [
      {
        id: "resv-1",
        name: "Brew Boat Party Boats with Captain", // a MAPPED product (2-crew)
        arrivalDatetime: "2026-06-20T18:00:00-04:00",
        quantity: 4,
        status: 200,
        ...over,
      },
    ],
    ...top,
  });

  it("imports a booked order and forms its shift", async () => {
    const r = await pullXola(repo, fixedFetcher([order()]), "seller-x", NOW, { tz: "UTC" });

    expect(r.ordersFetched).toBe(1);
    expect(r.recordsMapped).toBe(1);
    expect(r.import.reservationsAdded).toBe(1);
    expect(r.import.eventsCreated).toBe(1);
    expect(r.form.shiftsCreated).toBeGreaterThanOrEqual(1);

    // phone threaded inline (DEC-036 — retires the DEC-017 join).
    // identity is resv-${items[].id}, and the fixture item id is "resv-1".
    const resv = await repo.getReservation(asId<"ReservationId">("resv-resv-1"));
    expect(resv?.phone).toBe("4403331155");
    expect(resv?.partySize).toBe(4);
  });

  it("counts a cancelled item as newly-cancelled", async () => {
    const r = await pullXola(repo, fixedFetcher([order({ status: 700 })]), "seller-x", NOW, { tz: "UTC" });
    expect(r.import.reservationsNewlyCancelled).toBe(1);
  });

  it("quarantines an unmapped product (no event, no shift) — DEC-018", async () => {
    const r = await pullXola(
      repo,
      fixedFetcher([order({ name: "Brewboat Tour - captained" })]), // sandbox name, unmapped
      "seller-x",
      NOW,
      { tz: "UTC" },
    );
    expect(r.recordsMapped).toBe(1); // it maps fine…
    expect(r.import.eventsCreated).toBe(0); // …but resolves to no vessel → quarantined
    expect(r.import.skipped).toHaveLength(1);
  });
});
