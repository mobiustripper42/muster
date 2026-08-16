/**
 * Departure claim orchestration (12.1a, DEC-109) — `candidateVessels` (pure boat
 * selection) + `acquireDepartureHold` (fit-and-fallback), driven against the in-memory repo.
 */
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { CheckoutHold, Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import {
  acquireDepartureHold,
  candidateVessels,
  holdExpiry,
  resolveHoldMinutes,
  HOLD_MINUTES_DEFAULT,
} from "./claim.js";
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
  return repo;
}

describe("candidateVessels — smallest-that-fits (DEC-109)", () => {
  const vessels = [vessel(BIG, 12), vessel(SMALL, 6)];
  const call = (over: Partial<Parameters<typeof candidateVessels>[0]> = {}) =>
    candidateVessels({ offering: offering(), vessels, date: DATE, time: TIME, guestCount: 4, blocks: [], ...over });

  it("orders smallest-that-fits first", () => {
    expect(call().map(String)).toEqual(["v-small", "v-big"]);
  });

  it("excludes a boat too small for the party", () => {
    expect(call({ guestCount: 10 }).map(String)).toEqual(["v-big"]); // small (6) can't take 10
  });

  it("excludes a blocked slot", () => {
    const blocks = [{ id: asId<"BlockId">("b"), kind: "vesselHold" as const, vesselId: SMALL, date: DATE, time: TIME }];
    expect(call({ blocks }).map(String)).toEqual(["v-big"]);
  });

  it("tie-break by vesselId when capacities are equal", () => {
    const vs = [vessel(asId<"VesselId">("v-b"), 8), vessel(asId<"VesselId">("v-a"), 8)];
    const out = candidateVessels({
      offering: offering({ vesselIds: [asId<"VesselId">("v-b"), asId<"VesselId">("v-a")] }),
      vessels: vs, date: DATE, time: TIME, guestCount: 4, blocks: [],
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

/**
 * The dev-only hold-TTL override (`CHECKOUT_HOLD_MINUTES`).
 *
 * The reason it exists is testability of the residual race: at 15 minutes, reproducing a
 * hold-expires-mid-payment collision by hand means two browsers and a fifteen-minute wait, so
 * nobody ever does it. At 0.5 it is a two-minute job.
 *
 * **The assertion that matters is the last one.** Shortening a real buyer's hold releases their
 * slot while their card is still processing — manufacturing the very race the constant bounds. A
 * stray env var on a production deploy would cost real customers real bookings, so production
 * must ignore it no matter what it says.
 */
describe("hold TTL override (CHECKOUT_HOLD_MINUTES)", () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
  });

  it("defaults to 15 minutes with nothing set", () => {
    delete process.env.CHECKOUT_HOLD_MINUTES;
    expect(resolveHoldMinutes()).toBe(HOLD_MINUTES_DEFAULT);
  });

  it("accepts a fraction — 0.5 is the thirty seconds that makes this usable", () => {
    process.env.CHECKOUT_HOLD_MINUTES = "0.5";
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = "development";
    expect(resolveHoldMinutes()).toBe(0.5);
  });

  it("falls back on garbage and on zero rather than minting a zero-length hold", () => {
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = "development";
    for (const bad of ["", "abc", "0", "-5", "NaN", "Infinity"]) {
      process.env.CHECKOUT_HOLD_MINUTES = bad;
      // A zero-length hold would make every buyer lose the race to themselves.
      expect(resolveHoldMinutes()).toBe(HOLD_MINUTES_DEFAULT);
    }
  });

  it("is IGNORED on a production deploy, however it is set", () => {
    process.env.CHECKOUT_HOLD_MINUTES = "0.5";

    // Vercel production.
    process.env.VERCEL_ENV = "production";
    expect(resolveHoldMinutes()).toBe(HOLD_MINUTES_DEFAULT);

    // Self-hosted production — no VERCEL_ENV, NODE_ENV says production.
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = "production";
    expect(resolveHoldMinutes()).toBe(HOLD_MINUTES_DEFAULT);
  });

  it("still applies on a PREVIEW deploy, which is why VERCEL_ENV is checked first", () => {
    // Vercel sets NODE_ENV=production on previews too. A NODE_ENV-only guard would silently
    // disable the override exactly where a reviewer would want to exercise the race.
    process.env.CHECKOUT_HOLD_MINUTES = "0.5";
    process.env.VERCEL_ENV = "preview";
    process.env.NODE_ENV = "production";
    expect(resolveHoldMinutes()).toBe(0.5);
  });
});

describe("acquireDepartureHold — the hull, not just the slot (#615, #691)", () => {
  const xolaTrip = (time: string, id: string) => ({
    id: asId<"EventId">(id),
    vesselId: SMALL,
    date: DATE,
    time,
    capacity: 6,
    status: "scheduled" as const,
    source: "xola" as const,
  });

  it("skips a boat a XOLA trip is already using", async () => {
    const repo = await seededRepo();
    await repo.saveEvent(xolaTrip(TIME, "x-1"));
    const res = await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now);
    // Small is physically taken by Xola, so the hold falls through to the big boat. Before
    // #615 the funnel could not see the Xola trip at all and would have held the small one.
    expect("held" in res && String(res.held.vesselId)).toBe("v-big");
  });

  it("skips a boat busy at an OVERLAPPING time, not just the same one (#691)", async () => {
    const repo = await seededRepo();
    // 13:00 + 100min runs to 14:40, straight through a 13:30 departure. Different slot
    // identity, which is exactly why the old exact-triple check missed it.
    await repo.saveEvent(xolaTrip("13:00", "x-2"));
    const res = await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now);
    expect("held" in res && String(res.held.vesselId)).toBe("v-big");
  });

  it("still holds a boat whose trip ends exactly when ours starts", async () => {
    const repo = await seededRepo();
    await repo.saveEvent(xolaTrip("11:50", "x-3")); // 11:50 + 100 = 13:30, abuts
    const res = await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now);
    expect("held" in res && String(res.held.vesselId)).toBe("v-small");
  });

  it("still holds a slot that has an UNBOOKED override event of its own", async () => {
    // An override Event materialized at the very slot being held is not an occupant — it IS
    // the slot. Counting it made the hold see the boat as busy against itself, so a departure
    // the calendar shows as available would report sold_out at checkout.
    const repo = await seededRepo();
    await repo.saveEvent({
      id: eventIdForSlot(SMALL, DATE, TIME),
      vesselId: SMALL,
      date: DATE,
      time: TIME,
      capacity: 6,
      status: "scheduled",
      source: "muster",
      price: 42000, // an operator override price on this departure
    });
    const res = await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now);
    expect("held" in res && String(res.held.vesselId)).toBe("v-small");
  });

  it("sold out when a Xola trip occupies every fitting boat", async () => {
    const repo = await seededRepo();
    for (const [i, v] of [SMALL, BIG].entries()) {
      await repo.saveEvent({ ...xolaTrip(TIME, `x-all-${i}`), vesselId: v, capacity: 12 });
    }
    const res = await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now);
    expect(res).toEqual({ soldOut: true });
  });
});

describe("acquireDepartureHold — a live HOLD occupies the hull too (#694 review)", () => {
  it("skips a boat whose overlapping departure is already held by a rival", async () => {
    // Two buyers, one boat, 13:30 and a departure inside its trip length. The events check
    // could not see this — a hold materializes nothing — so both started paying and the write
    // CAS refunded the loser. That refund is exactly what the hold system exists to prevent.
    const repo = await seededRepo();
    await repo.acquireCheckoutHold({
      id: asId<"CheckoutHoldId">("rival-overlap"),
      vesselId: SMALL,
      date: DATE,
      time: "13:00", // 13:00 + 100min runs to 14:40, over a 13:30 departure
      source: "muster",
      offeringId: OFF,
      guestCount: 2,
      expiresAt: holdExpiry(NOW),
      createdAt: NOW,
    });
    const res = await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now);
    expect("held" in res && String(res.held.vesselId)).toBe("v-big"); // fell back off the held hull
  });

  it("an EXPIRED overlapping hold does not occupy anything", async () => {
    // Lazy-on-read expiry (DEC-109). A stale row must not hold a boat hostage.
    const repo = await seededRepo();
    await repo.acquireCheckoutHold({
      id: asId<"CheckoutHoldId">("stale-overlap"),
      vesselId: SMALL,
      date: DATE,
      time: "13:00",
      source: "muster",
      offeringId: OFF,
      guestCount: 2,
      expiresAt: "2026-07-04T11:00:00.000Z", // before `now`
      createdAt: "2026-07-04T10:45:00.000Z",
    });
    const res = await acquireDepartureHold(repo, { offeringId: OFF, date: DATE, time: TIME, guestCount: 4 }, now);
    expect("held" in res && String(res.held.vesselId)).toBe("v-small");
  });
});


/**
 * One buyer, one hold per departure (#575).
 *
 * The hold exists to turn "you paid and we refunded you" into "sold out, before you paid". Before
 * this, a declined card — the commonest checkout failure there is — made it do the opposite: each
 * retry took another boat, and the third reported sold_out on a departure nobody had paid for.
 */
describe("acquireDepartureHold — buyer reuse (#575)", () => {
  const BUYER = "+12165550148";
  const ask = (over: Record<string, unknown> = {}) => ({
    offeringId: OFF,
    date: DATE,
    time: TIME,
    guestCount: 4,
    buyerKey: BUYER,
    ...over,
  });

  it("returns the SAME hold on a retry instead of taking a second boat", async () => {
    const repo = await seededRepo();
    const first = await acquireDepartureHold(repo, ask(), now);
    const second = await acquireDepartureHold(repo, ask(), now);

    expect("held" in first && "held" in second).toBe(true);
    if ("held" in first && "held" in second) {
      expect(String(second.held.id)).toBe(String(first.held.id));
      expect(String(second.held.vesselId)).toBe("v-small");
    }
    expect(await repo.listCheckoutHolds()).toHaveLength(1);
  });

  it("does NOT extend the expiry — a retry cannot park a boat indefinitely", async () => {
    // Decided at build (#575): a decline-and-retry happens inside a minute, so extension buys
    // almost nothing, and refusing it closes the hole where resubmitting holds a boat forever.
    const repo = await seededRepo();
    const first = await acquireDepartureHold(repo, ask(), now);
    const later = () => "2026-07-04T12:10:00.000Z";
    const second = await acquireDepartureHold(repo, ask(), later);

    if ("held" in first && "held" in second) {
      expect(second.held.expiresAt).toBe(first.held.expiresAt);
      expect(second.held.expiresAt).toBe(holdExpiry(NOW));
    }
  });

  it("a DIFFERENT buyer still takes the next boat, and the third is still sold out", async () => {
    // The sold-out path is real and must survive the fix — this is capacity, not a retry.
    const repo = await seededRepo();
    await acquireDepartureHold(repo, ask(), now);
    const other = await acquireDepartureHold(repo, ask({ buyerKey: "+14405550102" }), now);
    expect("held" in other && String(other.held.vesselId)).toBe("v-big");

    const third = await acquireDepartureHold(repo, ask({ buyerKey: "sam@x.io" }), now);
    expect(third).toEqual({ soldOut: true });
  });

  it("releases and re-acquires when the retry no longer FITS the held boat", async () => {
    // Held the small boat (cap 6) for 4, comes back with 9. Silently keeping it would book a
    // party onto a boat too small for them — worse than the bug being fixed.
    const repo = await seededRepo();
    const first = await acquireDepartureHold(repo, ask(), now);
    const bigger = await acquireDepartureHold(repo, ask({ guestCount: 9 }), now);

    expect("held" in bigger && String(bigger.held.vesselId)).toBe("v-big");
    if ("held" in first && "held" in bigger) {
      expect(String(bigger.held.id)).not.toBe(String(first.held.id));
    }
    // The small boat's hold is gone, not orphaned — it must not block anyone else.
    const holds = await repo.listCheckoutHolds();
    expect(holds).toHaveLength(1);
    expect(String(holds[0]!.vesselId)).toBe("v-big");
  });

  it("two buyers with NO contact never share a hold", async () => {
    // The one way this rule could sell one boat twice. A keyless hold is never reused, by
    // anybody — including the person who minted it.
    const repo = await seededRepo();
    const a = await acquireDepartureHold(repo, ask({ buyerKey: undefined }), now);
    const b = await acquireDepartureHold(repo, ask({ buyerKey: undefined }), now);

    expect("held" in a && "held" in b).toBe(true);
    if ("held" in a && "held" in b) {
      expect(String(b.held.id)).not.toBe(String(a.held.id));
      expect(String(b.held.vesselId)).toBe("v-big"); // took the next boat, as before #575
    }
    expect(await repo.listCheckoutHolds()).toHaveLength(2);
  });

  it("an EXPIRED hold of the same buyer is not reused", async () => {
    const repo = await seededRepo();
    await acquireDepartureHold(repo, ask(), now);
    // Past the 15 minutes: the old row is inert everywhere (DEC-109 lazy expiry), so this is a
    // fresh acquire rather than a resurrection.
    const muchLater = () => "2026-07-04T12:30:00.000Z";
    const again = await acquireDepartureHold(repo, ask(), muchLater);
    if ("held" in again) expect(again.held.expiresAt).toBe(holdExpiry("2026-07-04T12:30:00.000Z"));
  });

  it("does not reuse a hold from a different departure", async () => {
    // Same person, same day, different time — a genuinely separate purchase.
    const repo = await seededRepo();
    const first = await acquireDepartureHold(repo, ask(), now);
    const otherTime = await acquireDepartureHold(repo, ask({ time: "16:00" }), now);
    if ("held" in first && "held" in otherTime) {
      expect(String(otherTime.held.id)).not.toBe(String(first.held.id));
    }
    expect(await repo.listCheckoutHolds()).toHaveLength(2);
  });
});
