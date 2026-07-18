/**
 * Departure claim orchestration (12.1a, DEC-109) — `candidateVessels` (pure boat
 * selection) + `acquireDepartureHold` (fit-and-fallback), driven against the in-memory repo.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { CheckoutHold, Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { acquireDepartureHold, candidateVessels, holdExpiry } from "./claim.js";
import { eventIdForSlot } from "./availability.js";

const SMALL = asId<"VesselId">("v-small"); // coiMaxPax 6
const BIG = asId<"VesselId">("v-big"); //   coiMaxPax 12
const OFF = asId<"OfferingId">("off-1");
const LOC = asId<"LocationId">("loc-1");
const DATE = "2026-07-04";
const TIME = "13:30";
const NOW = "2026-07-04T12:00:00.000Z";
const now = () => NOW;

const vessel = (id: typeof SMALL, coiMaxPax: number): Vessel => ({
  id,
  name: String(id),
  coiMaxPax,
  manning: [],
});

const offering = (over: Partial<Offering> = {}): Offering => ({
  id: OFF,
  tenantId: asId<"TenantId">("t"),
  name: "Cruise",
  status: "live",
  vesselIds: [BIG, SMALL], // deliberately big-first — candidateVessels must reorder
  locationId: LOC,
  schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: [TIME] },
  basePriceCents: 49900,
  priceVariations: [],
  extraGuestPriceCents: 5000,
  ...over,
});

/** A repo seeded with the offering, both boats, and both boats owned on DATE. */
async function seededRepo(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveOffering(offering());
  await repo.saveVessel(vessel(SMALL, 6));
  await repo.saveVessel(vessel(BIG, 12));
  await repo.markVesselDayMusterOwned(SMALL, DATE, NOW);
  await repo.markVesselDayMusterOwned(BIG, DATE, NOW);
  return repo;
}

describe("candidateVessels — smallest-that-fits (DEC-109)", () => {
  const vessels = [vessel(BIG, 12), vessel(SMALL, 6)];
  const ownedDays = [
    { vesselId: SMALL, date: DATE, markedAt: NOW },
    { vesselId: BIG, date: DATE, markedAt: NOW },
  ];
  const call = (over: Partial<Parameters<typeof candidateVessels>[0]> = {}) =>
    candidateVessels({ offering: offering(), vessels, date: DATE, time: TIME, guestCount: 4, ownedDays, blocks: [], ...over });

  it("orders smallest-that-fits first", () => {
    expect(call().map(String)).toEqual(["v-small", "v-big"]);
  });

  it("excludes a boat too small for the party", () => {
    expect(call({ guestCount: 10 }).map(String)).toEqual(["v-big"]); // small (6) can't take 10
  });

  it("excludes a boat not owned on the day", () => {
    expect(call({ ownedDays: [{ vesselId: BIG, date: DATE, markedAt: NOW }] }).map(String)).toEqual(["v-big"]);
  });

  it("excludes a blocked slot", () => {
    const blocks = [{ id: asId<"BlockId">("b"), kind: "vesselHold" as const, vesselId: SMALL, date: DATE, time: TIME }];
    expect(call({ blocks }).map(String)).toEqual(["v-big"]);
  });

  it("tie-break by vesselId when capacities are equal", () => {
    const vs = [vessel(asId<"VesselId">("v-b"), 8), vessel(asId<"VesselId">("v-a"), 8)];
    const owned = [
      { vesselId: asId<"VesselId">("v-a"), date: DATE, markedAt: NOW },
      { vesselId: asId<"VesselId">("v-b"), date: DATE, markedAt: NOW },
    ];
    const out = candidateVessels({
      offering: offering({ vesselIds: [asId<"VesselId">("v-b"), asId<"VesselId">("v-a")] }),
      vessels: vs, date: DATE, time: TIME, guestCount: 4, ownedDays: owned, blocks: [],
    });
    expect(out.map(String)).toEqual(["v-a", "v-b"]);
  });
});

describe("acquireDepartureHold — fit-and-fallback (DEC-109)", () => {
  it("holds the smallest fitting boat on an empty departure", async () => {
    const repo = await seededRepo();
    const res = await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now);
    expect("held" in res && String(res.held.vesselId)).toBe("v-small");
    expect((await repo.listCheckoutHolds())).toHaveLength(1);
    // expiry is acquire + 15 min
    if ("held" in res) expect(res.held.expiresAt).toBe(holdExpiry(NOW));
  });

  it("falls back to the next boat when the smallest is already live-held by a rival", async () => {
    const repo = await seededRepo();
    // a rival hold (different id) already occupies the small boat's slot
    const rival: CheckoutHold = {
      id: asId<"CheckoutHoldId">("rival"),
      vesselId: SMALL, date: DATE, time: TIME, source: "muster",
      offeringId: OFF, guestCount: 2, expiresAt: holdExpiry(NOW), createdAt: NOW,
    };
    await repo.acquireCheckoutHold(rival);
    const res = await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now);
    expect("held" in res && String(res.held.vesselId)).toBe("v-big"); // fell back
  });

  it("skips a boat already BOOKED and holds the next", async () => {
    const repo = await seededRepo();
    const evId = eventIdForSlot(SMALL, DATE, TIME);
    await repo.saveEvent({ id: evId, vesselId: SMALL, date: DATE, time: TIME, capacity: 6, status: "scheduled", source: "muster" });
    await repo.saveReservation({ id: asId<"ReservationId">("r-booked"), eventId: evId, source: "muster", customerName: "X", partySize: 2, status: "booked" });
    const res = await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now);
    expect("held" in res && String(res.held.vesselId)).toBe("v-big"); // small was sold
  });

  it("sold out when every fitting boat is taken", async () => {
    const repo = await seededRepo();
    // both boats live-held by rivals
    for (const v of [SMALL, BIG]) {
      await repo.acquireCheckoutHold({
        id: asId<"CheckoutHoldId">(`rival-${String(v)}`),
        vesselId: v, date: DATE, time: TIME, source: "muster",
        offeringId: OFF, guestCount: 2, expiresAt: holdExpiry(NOW), createdAt: NOW,
      });
    }
    const res = await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now);
    expect(res).toEqual({ soldOut: true });
  });

  it("unbookable: offering missing / not live / invalid guest count", async () => {
    const repo = await seededRepo();
    expect(await acquireDepartureHold(repo, { offeringId: asId<"OfferingId">("nope"), date: DATE, time: TIME, guestCount: 4 }, now))
      .toEqual({ unbookable: "offering_missing" });
    await repo.saveOffering(offering({ status: "draft" }));
    expect(await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now))
      .toEqual({ unbookable: "not_live" });
    await repo.saveOffering(offering()); // back to live
    expect(await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 0 }, now))
      .toEqual({ unbookable: "invalid_guest_count" });
  });

  it("mints a unique hold id per attempt (not slot-derived — so contention is detectable)", async () => {
    const repo = await seededRepo();
    const a = await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now);
    const b = await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now);
    // two different buyers → two different boats → two distinct hold ids
    expect("held" in a && "held" in b && String(a.held.id) !== String(b.held.id)).toBe(true);
  });
});
