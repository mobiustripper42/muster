/**
 * Trip links (Phase 18.3b, issue #1141, DEC-190) — one 8-character code per departure, and what
 * opening it resolves to. The signing form behind an open link is 18.4's.
 */
import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Event, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { BOOKING_CODE_ALPHABET } from "../reservations/booking-code.js";
import {
  ensureTripLink,
  mintTripCode,
  normalizeTripCode,
  openTripLink,
  resolveTripLink,
  TRIP_CODE_LENGTH,
  TRIP_LINK_LIMIT,
  tripLinkUrl,
} from "./trip-link.js";

const NOW = "2026-10-10T18:00:00.000Z"; // 2:00 PM in New York
const EVENT = asId<"EventId">("evt-trip");
const vessel: Vessel = { id: asId<"VesselId">("vessel-hops"), name: "Hops", coiMaxPax: 16, manning: [] };
const event = (over: Partial<Event> = {}): Event => ({
  id: EVENT,
  vesselId: vessel.id,
  date: "2026-10-10",
  time: "15:00",
  capacity: 16,
  status: "scheduled",
  source: "muster",
  ...over,
});

async function world(over: Partial<Event> = {}) {
  const repo = new InMemoryRepository();
  await repo.saveVessel(vessel);
  await repo.saveEvent(event(over));
  return repo;
}

/** Bytes that mint a known code: byte i picks alphabet letter i. */
const bytesFor = (code: string) => () => Buffer.from([...code].map((ch) => BOOKING_CODE_ALPHABET.indexOf(ch)));

describe("the code", () => {
  it(`is ${TRIP_CODE_LENGTH} characters of the booking-code alphabet, from the bytes it is given`, () => {
    expect(TRIP_CODE_LENGTH).toBe(8);
    expect(mintTripCode(bytesFor("K3F9QZ2M"))).toBe("K3F9QZ2M");
    expect(mintTripCode()).toMatch(new RegExp(`^[${BOOKING_CODE_ALPHABET}]{8}$`));
  });

  it("reads a code typed back from a text: any case, spaces and dashes, I and L as 1, O as 0", () => {
    expect(normalizeTripCode(" k3f9-qz2m ")).toBe("K3F9QZ2M");
    expect(normalizeTripCode("K3F9QZ2O")).toBe("K3F9QZ20");
    expect(normalizeTripCode("K3F9QZIL")).toBe("K3F9QZ11");
  });

  it.each([undefined, "", "K3F9QZ2", "K3F9QZ2MX", "K3F9QZ2U", "K3F9QZ2M".repeat(50)])(
    "is not a code: %j",
    (raw) => {
      expect(normalizeTripCode(raw)).toBeNull();
    },
  );

  it("builds the link from a trusted base", () => {
    expect(tripLinkUrl("https://crew.brewcle.com/", "K3F9QZ2M")).toBe("https://crew.brewcle.com/w/K3F9QZ2M");
  });
});

describe("ensureTripLink", () => {
  it("mints once per departure and returns the same code after", async () => {
    const repo = await world();
    const code = await ensureTripLink(repo, EVENT, () => NOW, bytesFor("K3F9QZ2M"));
    expect(code).toBe("K3F9QZ2M");
    expect(await ensureTripLink(repo, EVENT, () => NOW)).toBe("K3F9QZ2M");
    expect(await repo.getTripLinkForEvent(EVENT)).toEqual({ code: "K3F9QZ2M", eventId: EVENT, createdAt: NOW });
  });

  it("mints again when a new code collides with another trip's", async () => {
    const repo = await world();
    await repo.saveEvent(event({ id: asId<"EventId">("evt-other"), time: "17:00" }));
    await repo.insertTripLink({ code: "AAAAAAAA", eventId: asId<"EventId">("evt-other"), createdAt: NOW });
    let calls = 0;
    const bytes = () => Buffer.from([...(calls++ === 0 ? "AAAAAAAA" : "BBBBBBBB")].map((c) => BOOKING_CODE_ALPHABET.indexOf(c)));
    expect(await ensureTripLink(repo, EVENT, () => NOW, bytes)).toBe("BBBBBBBB");
  });

  it("losing a race for the SAME trip returns the winner's code, never a second one", async () => {
    // Another request inserted between this one's read and its insert: the first read sees
    // nothing, the insert hits the one-link-per-trip unique, and the answer is the winner's.
    class ReadBeforeWinner extends InMemoryRepository {
      #stale = true;
      override async getTripLinkForEvent(eventId: Parameters<InMemoryRepository["getTripLinkForEvent"]>[0]) {
        if (this.#stale) {
          this.#stale = false;
          return null;
        }
        return super.getTripLinkForEvent(eventId);
      }
    }
    const repo = new ReadBeforeWinner();
    await repo.saveVessel(vessel);
    await repo.saveEvent(event());
    await repo.insertTripLink({ code: "WWWWWWWW", eventId: EVENT, createdAt: NOW });

    expect(await ensureTripLink(repo, EVENT, () => NOW, bytesFor("BBBBBBBB"))).toBe("WWWWWWWW");
    expect(await repo.getTripLinkByCode("BBBBBBBB")).toBeNull();
  });
});

describe("resolveTripLink", () => {
  it("opens a departure still to come", async () => {
    const repo = await world();
    await repo.insertTripLink({ code: "K3F9QZ2M", eventId: EVENT, createdAt: NOW });
    expect(await resolveTripLink(repo, "k3f9qz2m", NOW)).toEqual({
      state: "open",
      trip: { eventId: EVENT, date: "2026-10-10", time: "15:00" },
    });
  });

  it("says a departure has sailed from its departure time on", async () => {
    const repo = await world();
    await repo.insertTripLink({ code: "K3F9QZ2M", eventId: EVENT, createdAt: NOW });
    // 3:00 PM New York is 19:00 UTC.
    expect((await resolveTripLink(repo, "K3F9QZ2M", "2026-10-10T18:59:59.000Z")).state).toBe("open");
    expect((await resolveTripLink(repo, "K3F9QZ2M", "2026-10-10T19:00:00.000Z")).state).toBe("departed");
  });

  it("says a cancelled departure was cancelled, even before it would have sailed", async () => {
    const repo = await world({ status: "cancelled" });
    await repo.insertTripLink({ code: "K3F9QZ2M", eventId: EVENT, createdAt: NOW });
    expect(await resolveTripLink(repo, "K3F9QZ2M", NOW)).toEqual({
      state: "cancelled",
      trip: { eventId: EVENT, date: "2026-10-10", time: "15:00" },
    });
  });

  it("finds nothing for a code nobody minted, or something that is not a code", async () => {
    const repo = await world();
    expect(await resolveTripLink(repo, "ZZZZZZZZ", NOW)).toEqual({ state: "not_found" });
    expect(await resolveTripLink(repo, "../../etc", NOW)).toEqual({ state: "not_found" });
  });
});

describe("openTripLink — limited before it looks anything up", () => {
  it(`allows ${TRIP_LINK_LIMIT.limit} opens a minute from one address, then says wait, without resolving`, async () => {
    const repo = await world();
    await repo.insertTripLink({ code: "K3F9QZ2M", eventId: EVENT, createdAt: NOW });
    const deps = { repo, now: () => NOW };
    for (let i = 0; i < TRIP_LINK_LIMIT.limit; i++) {
      expect((await openTripLink(deps, "K3F9QZ2M", "203.0.113.9")).state).toBe("open");
    }
    // Neither a real code nor a guess is looked up once the address is over the limit.
    expect(await openTripLink(deps, "K3F9QZ2M", "203.0.113.9")).toEqual({ state: "throttled", retryAfterMs: 60_000 });
    expect(await openTripLink(deps, "ZZZZZZZZ", "203.0.113.9")).toEqual({ state: "throttled", retryAfterMs: 60_000 });
    // Another address is unaffected.
    expect((await openTripLink(deps, "K3F9QZ2M", "198.51.100.4")).state).toBe("open");
  });

  it("with no address known, nothing is limited", async () => {
    const repo = await world();
    await repo.insertTripLink({ code: "K3F9QZ2M", eventId: EVENT, createdAt: NOW });
    for (let i = 0; i <= TRIP_LINK_LIMIT.limit; i++) {
      expect((await openTripLink({ repo, now: () => NOW }, "K3F9QZ2M", null)).state).toBe("open");
    }
  });
});
