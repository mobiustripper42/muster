/**
 * Departure claim orchestration (12.1a, DEC-109; 14.7) — `candidateVessels` (pure boat
 * selection) + `claimDepartureSlot` (fit-and-fallback, writing the pending row), driven against
 * the in-memory repo.
 *
 * 14.7 dropped `checkout_holds`. Every case here that used to plant a rival *hold* now plants a
 * rival *pending row*, because that is the only thing a checkout produces — and the assertions
 * are unchanged, which is the point: the occupancy rules survived losing the table.
 */
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Offering, Reservation, Vessel } from "../domain/entities.js";
import { asId, type VesselId } from "../domain/ids.js";
import {
  candidateVessels,
  claimDepartureSlot,
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

/**
 * A stand-in for the caller's builder (`create-departure-payment-intent.ts`). Mints a fresh id
 * per row, and — the contract the real one must also keep — carries a prior row's id and reserved
 * time straight through so a retry neither forks a second row nor moves its payment window.
 */
let seq = 0;
const builder = (ask: { date: string; time: string; guestCount: number; holderToken?: string }) =>
  (vesselId: VesselId, prior: Reservation | null, at: string): Reservation => ({
    id: prior?.id ?? asId<"ReservationId">(`resv-${++seq}`),
    eventId: null,
    source: "muster",
    status: "pending",
    customerName: "Brody",
    partySize: ask.guestCount,
    vesselId,
    date: ask.date,
    time: ask.time,
    offeringId: OFF,
    reservedAt: prior?.reservedAt ?? at,
    holdMinutes: 120,
    tripMinutes: 100,
    updatedAt: at,
    ...(ask.holderToken !== undefined ? { holderToken: ask.holderToken } : {}),
  });

/** The ordinary call: ask for a departure, build a row for whatever boat the claim picks. */
function claim(
  repo: InMemoryRepository,
  ask: { offeringId?: typeof OFF; date?: string; time?: string; guestCount?: number; holderToken?: string },
  clock: () => string = now,
) {
  const req = {
    offeringId: ask.offeringId ?? OFF,
    date: ask.date ?? DATE,
    time: ask.time ?? TIME,
    guestCount: ask.guestCount ?? 4,
    ...(ask.holderToken !== undefined ? { holderToken: ask.holderToken } : {}),
  };
  return claimDepartureSlot(repo, req, builder(req), clock);
}

/** The vessel a claim landed on, or null — so an assertion reads as one line and a `soldOut`
 *  result fails loudly rather than skipping the expect. */
const claimedVessel = (res: Awaited<ReturnType<typeof claim>>): string | null =>
  "claimed" in res ? String(res.claimed.vesselId) : null;

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

describe("claimDepartureSlot — fit-and-fallback (DEC-109)", () => {
  it("writes the pending row on the smallest fitting boat of an empty departure", async () => {
    const repo = await seededRepo();
    const res = await claim(repo, {});
    expect(claimedVessel(res)).toBe("v-small");
    // ONE row, `pending`, no Event — the claim IS the reservation now (§2.8.2).
    const rows = await repo.listAllReservations();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.eventId).toBeNull();
    expect(rows[0]!.reservedAt).toBe(NOW);
  });

  it("falls back to the next boat when a rival's live pending row holds the smallest", async () => {
    const repo = await seededRepo();
    await claim(repo, { holderToken: "rival-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    const res = await claim(repo, { holderToken: "mine-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    expect(claimedVessel(res)).toBe("v-big"); // fell back
  });

  it("skips a boat already BOOKED and claims the next", async () => {
    const repo = await seededRepo();
    const evId = eventIdForSlot(SMALL, DATE, TIME);
    await repo.saveEvent({ id: evId, vesselId: SMALL, date: DATE, time: TIME, capacity: 6, status: "scheduled", source: "muster" });
    await repo.saveReservation({ id: asId<"ReservationId">("r-booked"), eventId: evId, source: "muster", customerName: "X", partySize: 2, status: "booked" });
    expect(claimedVessel(await claim(repo, {}))).toBe("v-big"); // small was sold
  });

  it("sold out when every fitting boat is taken, and writes no row", async () => {
    const repo = await seededRepo();
    await claim(repo, { holderToken: "tok-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    await claim(repo, { holderToken: "tok-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    const third = await claim(repo, { holderToken: "tok-c-cccccccccccccccccccccccccccccccc" });
    expect(third).toEqual({ soldOut: true });
    expect(await repo.listAllReservations()).toHaveLength(2); // no third row
  });

  it("unbookable: offering missing / not live / invalid guest count", async () => {
    const repo = await seededRepo();
    expect(await claim(repo, { offeringId: asId<"OfferingId">("nope") })).toEqual({ unbookable: "offering_missing" });
    await repo.saveOffering(offering({ status: "draft" }));
    expect(await claim(repo, {})).toEqual({ unbookable: "not_live" });
    await repo.saveOffering(offering()); // back to live
    expect(await claim(repo, { guestCount: 0 })).toEqual({ unbookable: "invalid_guest_count" });
    expect(await repo.listAllReservations()).toHaveLength(0);
  });

  it("two different buyers get two DISTINCT rows, one per boat", async () => {
    const repo = await seededRepo();
    const a = await claim(repo, { holderToken: "tok-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    const b = await claim(repo, { holderToken: "tok-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    expect("claimed" in a && "claimed" in b && String(a.claimed.id) !== String(b.claimed.id)).toBe(true);
    expect([claimedVessel(a), claimedVessel(b)]).toEqual(["v-small", "v-big"]);
  });
});

/**
 * The write is the contention point now (14.7) — so losing it falls through.
 *
 * This is the behaviour the hold table made impossible. The hold picked the hull; the pending
 * write happened afterwards at the caller, all-or-nothing, and a race lost THERE ended the
 * checkout with `sold_out` while a perfectly free boat sat next to it. Losing the write is not
 * "the departure is gone" — it is "that hull is gone", and there may be another.
 */
describe("claimDepartureSlot — a lost write falls through to the next boat (14.7)", () => {
  /** A repo whose pending write loses for one named vessel, exactly as a rival committing
   *  between our read and our write would. Everything else is the real in-memory adapter. */
  function repoLosingOn(repo: InMemoryRepository, loser: VesselId): InMemoryRepository {
    const real = repo.savePendingIfHullFree.bind(repo);
    repo.savePendingIfHullFree = async (row: Reservation, liveSince: string) =>
      String(row.vesselId) === String(loser) ? { result: "lost" as const } : real(row, liveSince);
    return repo;
  }

  it("tries the NEXT hull when the CAS rejects the first, instead of reporting sold out", async () => {
    const repo = repoLosingOn(await seededRepo(), SMALL);
    const res = await claim(repo, {});
    expect(claimedVessel(res)).toBe("v-big");
    const rows = await repo.listAllReservations();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.vesselId)).toBe("v-big");
  });

  it("still reports sold out once EVERY fitting hull loses its write", async () => {
    const repo = await seededRepo();
    repo.savePendingIfHullFree = async () => ({ result: "lost" as const });
    expect(await claim(repo, {})).toEqual({ soldOut: true });
    expect(await repo.listAllReservations()).toHaveLength(0);
  });
});

/**
 * The (date, time) must be on the offering's schedule GRID (issue #799).
 *
 * The engine trusted `req.date`/`req.time` verbatim — a scripted call could park a claim at any
 * string. Two harms: (1) `13:31` is not a real departure so nothing legitimate ever asks for it,
 * yet it OVERLAPS the real `13:30` in the claim path (interval math) while the availability
 * deriver keys a materialized slot on EXACT identity — so an off-grid row makes `/book` show
 * `13:30` available while every real buyer's checkout returns sold_out, an invisible lockout; (2)
 * an unbounded set of distinct off-grid identities to spam. Rejecting off-grid at the write path
 * is what makes the deriver's exact-identity match correct by construction.
 *
 * A rejection writes NO row. The offering runs Saturdays only (`weekdays:[5]`), season
 * 2026-06-01..2026-08-31, departures [13:30]; DATE 2026-07-04 is a Saturday inside it.
 */
describe("claimDepartureSlot — the slot must be on the schedule grid (#799)", () => {
  it("refuses a time that is not a listed departure, and writes no row", async () => {
    const repo = await seededRepo();
    expect(await claim(repo, { time: "13:31" })).toEqual({ unbookable: "off_schedule" });
    expect(await repo.listAllReservations()).toHaveLength(0);
  });

  it("refuses a date outside the season", async () => {
    const repo = await seededRepo();
    // 2026-09-05 is a Saturday (right weekday) but past seasonEnd 2026-08-31.
    expect(await claim(repo, { date: "2026-09-05" })).toEqual({ unbookable: "off_schedule" });
    expect(await repo.listAllReservations()).toHaveLength(0);
  });

  it("refuses a date on a weekday the offering does not run", async () => {
    const repo = await seededRepo();
    // 2026-07-05 is a Sunday; the offering runs Saturdays only.
    expect(await claim(repo, { date: "2026-07-05" })).toEqual({ unbookable: "off_schedule" });
  });

  it("refuses a malformed date or time rather than trusting it", async () => {
    const repo = await seededRepo();
    for (const [d, t] of [["2026-07-04", "13:3 0"], ["2026-13-45", TIME], ["not-a-date", TIME], ["2026-09-31", TIME]]) {
      expect(await claim(repo, { date: d!, time: t! })).toEqual({ unbookable: "off_schedule" });
    }
    expect(await repo.listAllReservations()).toHaveLength(0);
  });

  it("still claims a slot that IS on the grid — the guard doesn't over-reject", async () => {
    const repo = await seededRepo();
    expect(claimedVessel(await claim(repo, {}))).toBe("v-small");
    expect(await repo.listAllReservations()).toHaveLength(1);
  });
});

/**
 * The dev-only payment-window override (`CHECKOUT_HOLD_MINUTES`).
 *
 * The reason it exists is testability of the residual race: at 15 minutes, reproducing a
 * window-expires-mid-payment collision by hand means two browsers and a fifteen-minute wait, so
 * nobody ever does it. At 0.5 it is a two-minute job.
 *
 * **The assertion that matters is the last one.** Shortening a real buyer's window lapses their
 * row while their card is still processing — manufacturing the very race the constant bounds. A
 * stray env var on a production deploy would cost real customers real bookings, so production
 * must ignore it no matter what it says.
 */
describe("payment-window override (CHECKOUT_HOLD_MINUTES)", () => {
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

  it("falls back on garbage and on zero rather than minting a zero-length window", () => {
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = "development";
    for (const bad of ["", "abc", "0", "-5", "NaN", "Infinity"]) {
      process.env.CHECKOUT_HOLD_MINUTES = bad;
      // A zero-length window would make every buyer lose the race to themselves.
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

describe("claimDepartureSlot — the hull, not just the slot (#615, #691)", () => {
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
    // Small is physically taken by Xola, so the claim falls through to the big boat. Before
    // #615 the funnel could not see the Xola trip at all and would have taken the small one.
    expect(claimedVessel(await claim(repo, {}))).toBe("v-big");
  });

  it("skips a boat busy at an OVERLAPPING time, not just the same one (#691)", async () => {
    const repo = await seededRepo();
    // 13:00 + 100min runs to 14:40, straight through a 13:30 departure. Different slot
    // identity, which is exactly why the old exact-triple check missed it.
    await repo.saveEvent(xolaTrip("13:00", "x-2"));
    expect(claimedVessel(await claim(repo, {}))).toBe("v-big");
  });

  it("still claims a boat whose trip ends exactly when ours starts", async () => {
    const repo = await seededRepo();
    await repo.saveEvent(xolaTrip("11:50", "x-3")); // 11:50 + 100 = 13:30, abuts
    expect(claimedVessel(await claim(repo, {}))).toBe("v-small");
  });

  it("falls THROUGH an unbooked override event of its own, because the write still counts it", async () => {
    // An override Event materialized at the very slot being claimed is not an occupant — it IS
    // the slot, and the READ side has exempted it since #691: `vesselIsAvailable` drops a muster
    // event at our own slot identity before measuring the hull.
    //
    // **The WRITE side does not.** `savePendingIfHullFree` refuses any scheduled event over the
    // interval with no self-exemption ("a pending row has no Event, so any scheduled trip at its
    // slot is somebody else's"), which is true of every row that exists today and false of this
    // one. So the read offers v-small, the CAS rejects it, and 14.7's fall-through takes v-big.
    //
    // **Latent, not live.** Nothing in the app materializes an unbooked scheduled muster Event —
    // `saveEvent` is called only by the Xola import (source `xola`) and by cancellation. It arms
    // when an operator can create an Event at a slot before a booking exists — a per-departure
    // price override, or 16.1's operator-created booking. Filed as issue #945, which blocks 16.1:
    // the write must exempt a muster event at its own slot identity UNLESS an active claim is
    // already booked on it. Pinned here so the disagreement is observable rather than discovered
    // by a customer.
    //
    // 14.7 improves this without fixing it: before the fall-through, the lost write ended the
    // checkout with `sold_out` on a departure that had a free hull sitting next to it.
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
    expect(claimedVessel(await claim(repo, {}))).toBe("v-big");
  });

  it("sold out when a Xola trip occupies every fitting boat", async () => {
    const repo = await seededRepo();
    for (const [i, v] of [SMALL, BIG].entries()) {
      await repo.saveEvent({ ...xolaTrip(TIME, `x-all-${i}`), vesselId: v, capacity: 12 });
    }
    expect(await claim(repo, {})).toEqual({ soldOut: true });
  });
});

describe("claimDepartureSlot — a live PENDING row occupies the hull for its own hold minutes (14.4, §2.8.3)", () => {
  // The SPEC's worked case (criterion 4): a 100-minute trip with 120 hold minutes. A pending row
  // at 13:30 commits the boat until 15:30; measured by its trip it would be back at 15:10 and a
  // 15:15 departure would sell. Everything in here asks for 15:15.
  const ASK = "15:15";
  const pendingRow = (over: Partial<Reservation> = {}): Reservation => ({
    id: asId<"ReservationId">("pend-rival"),
    eventId: null,
    source: "muster",
    customerName: "Hooper",
    partySize: 2,
    status: "pending",
    vesselId: SMALL,
    date: DATE,
    time: "13:30",
    offeringId: OFF,
    reservedAt: "2026-07-04T11:55:00.000Z", // 5 min before `now` — live
    holdMinutes: 120,
    tripMinutes: 100,
    ...over,
  });
  async function repoWith(row: Reservation, over: Partial<Offering> = {}) {
    const repo = await seededRepo();
    await repo.saveOffering(
      offering({
        tripLengthMinutes: 100,
        holdMinutes: 120,
        schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: [TIME, ASK] },
        ...over,
      }),
    );
    await repo.saveReservation(row);
    return repo;
  }

  it("skips the boat a rival's pending row holds, measured by the ROW's hold minutes (criterion 4)", async () => {
    const repo = await repoWith(pendingRow());
    expect(claimedVessel(await claim(repo, { time: ASK }))).toBe("v-big");
  });

  it("the row's frozen hold minutes govern even after the offering's value changed (criterion 2)", async () => {
    const repo = await repoWith(pendingRow({ holdMinutes: 120 }), { holdMinutes: 60 });
    expect(claimedVessel(await claim(repo, { time: ASK }))).toBe("v-big");
  });

  it("still claims the boat when the row's hold minutes end before our departure", async () => {
    const repo = await repoWith(pendingRow({ holdMinutes: 100 })); // to 15:10
    expect(claimedVessel(await claim(repo, { time: ASK }))).toBe("v-small");
  });

  it("a LAPSED pending row does not occupy anything", async () => {
    const repo = await repoWith(pendingRow({ reservedAt: "2026-07-04T11:30:00.000Z" })); // 30 min ago
    expect(claimedVessel(await claim(repo, { time: ASK }))).toBe("v-small");
  });

  it("the buyer's OWN pending row (same holder token) does not block their retry", async () => {
    const repo = await repoWith(pendingRow({ holderToken: "tok-mine" }));
    // Their own row is on the 13:30 departure, so this is a genuinely new checkout at 15:15 —
    // it must neither be blocked by, nor reuse, the earlier one.
    const res = await claim(repo, { time: ASK, holderToken: "tok-mine" });
    expect(claimedVessel(res)).toBe("v-small");
    expect("claimed" in res && res.reused).toBe(false);
  });

  it("a rival's 13:30 pending row is measured by hold minutes, not trip time (issue #825)", async () => {
    // 13:30 + 120 hold minutes runs to 15:30, over a 15:15 departure. Measured by the 100-minute
    // TRIP it would be back at 15:10 and this would sell — the boat double-booked.
    const repo = await repoWith(pendingRow());
    expect(claimedVessel(await claim(repo, { time: ASK }))).toBe("v-big");
  });
});

/**
 * One buyer, one ROW per departure (#575, §2.8.5).
 *
 * The claim exists to turn "you paid and we refunded you" into "sold out, before you paid".
 * Before this, a declined card — the commonest checkout failure there is — made it do the
 * opposite: each retry took another boat, and the third reported sold_out on a departure nobody
 * had paid for. 14.7 moved the rule off the hold table and onto the pending row itself; the
 * behaviour it protects is identical.
 */
describe("claimDepartureSlot — session reuse (#575)", () => {
  // A real-shaped holder token (32 CSPRNG bytes, base64url) — the cookie value, not an identity.
  const TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";
  const OTHER_TOKEN = "b3RoZXJzZXNzaW9udG9rZW4wMTIzNDU2Nzg5YWJjZGU";

  it("returns the SAME row on a retry instead of taking a second boat", async () => {
    const repo = await seededRepo();
    const first = await claim(repo, { holderToken: TOKEN });
    const second = await claim(repo, { holderToken: TOKEN });

    expect("claimed" in first && "claimed" in second).toBe(true);
    if ("claimed" in first && "claimed" in second) {
      expect(String(second.claimed.id)).toBe(String(first.claimed.id));
      expect(String(second.claimed.vesselId)).toBe("v-small");
      expect(second.reused).toBe(true);
    }
    // The retry writes NOTHING: its row already exists and already occupies the hull.
    expect(await repo.listAllReservations()).toHaveLength(1);
  });

  it("does NOT move the reserved time — a retry cannot park a boat indefinitely (§2.8.7)", async () => {
    // A resubmit that re-stamped `reservedAt` would push the payment window forward on every
    // attempt, so a script could hold a hull forever by retrying once a minute.
    const repo = await seededRepo();
    const first = await claim(repo, { holderToken: TOKEN });
    const later = () => "2026-07-04T12:10:00.000Z";
    const second = await claim(repo, { holderToken: TOKEN }, later);

    // UNCONDITIONAL, and it is the point: with every assertion inside the type guard, a
    // regression that returned `soldOut` would run zero expects and pass green — pinning
    // nothing while looking like coverage.
    expect("claimed" in first && "claimed" in second).toBe(true);
    if ("claimed" in first && "claimed" in second) {
      expect(second.claimed.reservedAt).toBe(first.claimed.reservedAt);
      expect(second.claimed.reservedAt).toBe(NOW);
    }
  });

  it("a DIFFERENT session still takes the next boat, and the third is still sold out", async () => {
    // The sold-out path is real and must survive the fix — this is capacity, not a retry.
    const repo = await seededRepo();
    await claim(repo, { holderToken: TOKEN });
    const other = await claim(repo, { holderToken: OTHER_TOKEN });
    expect(claimedVessel(other)).toBe("v-big");

    const third = await claim(repo, { holderToken: "dGhpcmRzZXNzaW9udG9rZW4wMTIzNDU2Nzg5YWJjZGU" });
    expect(third).toEqual({ soldOut: true });
  });

  it("takes a bigger boat when the retry no longer FITS — and leaves the old row alone", async () => {
    // Claimed the small boat (cap 6) for 4, comes back with 9. Silently keeping it would book a
    // party onto a boat too small for them, so the reuse is refused and a fitting boat claimed.
    //
    // The old row is NOT cancelled. An earlier cut released it here, and `/security-review`
    // showed why that was dangerous while claims were keyed on the buyer's email: anyone could
    // destroy a named person's claim by submitting their address with an absurd guest count. The
    // token makes that unreachable, but deleting is still the wrong instinct on a path whose
    // input is a raw guest count — so the stale row simply lapses. One boat idle for the rest of
    // a payment window is a smaller cost than a destroyed checkout.
    const repo = await seededRepo();
    const first = await claim(repo, { holderToken: TOKEN });
    const bigger = await claim(repo, { holderToken: TOKEN, guestCount: 9 });

    expect(claimedVessel(bigger)).toBe("v-big");
    if ("claimed" in first && "claimed" in bigger) {
      expect(String(bigger.claimed.id)).not.toBe(String(first.claimed.id));
      expect(bigger.reused).toBe(false);
    }
    const rows = await repo.listAllReservations();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => String(r.vesselId)).sort()).toEqual(["v-big", "v-small"]);
  });

  it("does NOT hand back a claimed boat that has since been blocked", async () => {
    // The world changes inside a payment window. Operator blocks the vessel at 10:00 for a
    // mechanical fault; the customer's retry at 10:02 must not be handed that boat and charged
    // for it. The reuse path re-asks every question the write loop asks — before this it asked
    // only "is it mine, live, and big enough".
    const repo = await seededRepo();
    expect(claimedVessel(await claim(repo, { holderToken: TOKEN }))).toBe("v-small");

    await repo.saveBlock({
      id: asId<"BlockId">("b-mech"),
      kind: "vesselHold",
      vesselId: SMALL,
      date: DATE,
      time: TIME,
    });

    expect(claimedVessel(await claim(repo, { holderToken: TOKEN }))).toBe("v-big");
  });

  it("does NOT hand back a claimed boat that has since been BOOKED", async () => {
    // Same shape, different cause: the residual race resolved against this session while its
    // row was live. Handing the boat back would take payment for a boat already sold.
    const repo = await seededRepo();
    await claim(repo, { holderToken: TOKEN });

    const evId = eventIdForSlot(SMALL, DATE, TIME);
    await repo.saveEvent({ id: evId, vesselId: SMALL, date: DATE, time: TIME, capacity: 6, status: "scheduled", source: "muster" });
    await repo.saveReservation({ id: asId<"ReservationId">("r-won"), eventId: evId, source: "muster", customerName: "Rival", partySize: 2, status: "booked" });

    expect(claimedVessel(await claim(repo, { holderToken: TOKEN }))).toBe("v-big");
  });

  it("two sessions with NO token never share a row", async () => {
    // The one way this rule could sell one boat twice. A tokenless row is never reused, by
    // anybody — including the person who wrote it.
    const repo = await seededRepo();
    const a = await claim(repo, {});
    const b = await claim(repo, {});

    expect("claimed" in a && "claimed" in b).toBe(true);
    if ("claimed" in a && "claimed" in b) {
      expect(String(b.claimed.id)).not.toBe(String(a.claimed.id));
      expect(String(b.claimed.vesselId)).toBe("v-big"); // took the next boat, as before #575
    }
    expect(await repo.listAllReservations()).toHaveLength(2);
  });

  it("a LAPSED row of the same buyer is not reused", async () => {
    const repo = await seededRepo();
    const first = await claim(repo, { holderToken: TOKEN });
    // Past the payment window: the old row is inert everywhere (§2.8.1 lazy lapse), so this is a
    // fresh claim rather than a resurrection — new id, new reserved time.
    const muchLater = () => "2026-07-04T12:30:00.000Z";
    const again = await claim(repo, { holderToken: TOKEN }, muchLater);
    expect("claimed" in again).toBe(true);
    if ("claimed" in first && "claimed" in again) {
      expect(String(again.claimed.id)).not.toBe(String(first.claimed.id));
      expect(again.claimed.reservedAt).toBe("2026-07-04T12:30:00.000Z");
      expect(again.reused).toBe(false);
    }
  });

  it("does not reuse a row from a different departure", async () => {
    // Same person, same day, different time — a genuinely separate purchase. Both times must be
    // real departures on the grid (#799), so the offering here runs two of them.
    const repo = await seededRepo();
    await repo.saveOffering(offering({ schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: [TIME, "16:00"] } }));
    const first = await claim(repo, { holderToken: TOKEN });
    const otherTime = await claim(repo, { holderToken: TOKEN, time: "16:00" });
    if ("claimed" in first && "claimed" in otherTime) {
      expect(String(otherTime.claimed.id)).not.toBe(String(first.claimed.id));
    }
    expect(await repo.listAllReservations()).toHaveLength(2);
  });
});
