/**
 * Customer manage view model (12.6, #459) — the pure "Your booking" shaping: trip-phase flip,
 * post-trip gratuity tiers, trip timing. Money is delegated to `buildReservationDetail` (tested
 * in calendar-detail.test.ts), so these tests focus on the customer-facing extras.
 */
import { describe, expect, it } from "vitest";
import type { Event, Gratuity, Offering, Reservation, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import {
  buildManageView,
  postTipTiersFor,
  tripPhaseOf,
  type ManageViewInput,
} from "./manage-view.js";

const RES: Reservation = {
  id: asId<"ReservationId">("resv-1"),
  eventId: asId<"EventId">("evt-1"),
  source: "muster",
  customerName: "Jordan Ellis",
  partySize: 10,
  status: "booked",
  waiverConsentAt: "2026-07-16T12:00:00Z",
  waiverVersion: "v1",
} as Reservation;

const EVENT: Event = {
  id: asId<"EventId">("evt-1"),
  source: "muster",
  vesselId: asId<"VesselId">("v1"),
  date: "2026-07-18",
  time: "13:30",
  capacity: 12,
  price: 54900,
  status: "scheduled",
} as Event;

const OFFERING = {
  id: asId<"OfferingId">("off-1"),
  name: "Brew Boat Party",
  tripLengthMinutes: 100,
  arriveBeforeMinutes: 15,
} as Offering;

const VESSEL: Vessel = { id: asId<"VesselId">("v1"), name: "Brew 3", coiMaxPax: 12 } as Vessel;

function input(over: Partial<ManageViewInput> = {}): ManageViewInput {
  return {
    reservation: RES,
    event: EVENT,
    offering: OFFERING,
    vessel: VESSEL,
    payments: [],
    gratuities: [],
    taxRateBps: 725,
    now: { date: "2026-07-10", time: "09:00" },
    ...over,
  };
}

describe("tripPhaseOf", () => {
  it("is upcoming before the trip day and completed after", () => {
    expect(tripPhaseOf("2026-07-18", "13:30", { date: "2026-07-10", time: "09:00" })).toBe("upcoming");
    expect(tripPhaseOf("2026-07-18", "13:30", { date: "2026-07-20", time: "09:00" })).toBe("completed");
  });
  it("flips at the departure time on the trip day", () => {
    expect(tripPhaseOf("2026-07-18", "13:30", { date: "2026-07-18", time: "13:29" })).toBe("upcoming");
    expect(tripPhaseOf("2026-07-18", "13:30", { date: "2026-07-18", time: "13:30" })).toBe("completed");
    expect(tripPhaseOf("2026-07-18", "13:30", { date: "2026-07-18", time: "18:00" })).toBe("completed");
  });
  it("never prematurely closes a trip when a clock is malformed", () => {
    expect(tripPhaseOf("2026-07-18", "bogus", { date: "2026-07-18", time: "09:00" })).toBe("upcoming");
  });
});

describe("postTipTiersFor", () => {
  it("prices the default post tiers (15/20/25%) off the fare", () => {
    const tiers = postTipTiersFor(undefined, 54900);
    expect(tiers.map((t) => t.pct)).toEqual([15, 20, 25]);
    expect(tiers.map((t) => t.amountCents)).toEqual([8235, 10980, 13725]);
  });
  it("honors an offering that disables the post kind", () => {
    const offering = { gratuityKinds: [{ kind: "pre" as const, tiersBps: [2000], defaultBps: 2000, required: true }] };
    expect(postTipTiersFor(offering, 54900)).toEqual([]);
  });
  it("uses the offering's own post tiers when set", () => {
    const offering = {
      gratuityKinds: [{ kind: "post" as const, tiersBps: [500, 1000], defaultBps: 500, required: false }],
    };
    expect(postTipTiersFor(offering, 54900).map((t) => t.pct)).toEqual([5, 10]);
  });
});

describe("buildManageView", () => {
  it("flips phase, computes back-by / arrive-by, and carries the money through", () => {
    const v = buildManageView(input());
    expect(v.phase).toBe("upcoming");
    expect(v.timing.startLabel).toBe("1:30 PM");
    expect(v.timing.backByLabel).toBe("3:10 PM"); // 13:30 + 1h40m
    expect(v.timing.arriveByLabel).toBe("1:15 PM"); // 13:30 − 15m
    expect(v.detail.money.fareCents).toBe(54900);
    expect(v.postTipTiers).toHaveLength(3);
  });
  it("omits back-by / arrive-by when the offering leaves the timings unset", () => {
    const bare = { id: asId<"OfferingId">("off-1"), name: "Bare" } as Offering;
    const v = buildManageView(input({ offering: bare }));
    expect(v.timing.backByLabel).toBeNull();
    expect(v.timing.arriveByLabel).toBeNull();
    expect(v.timing.durationMinutes).toBeNull();
  });
  it("reports paid-in-full only when the fare is known and the balance is settled", () => {
    const paid = buildManageView(
      input({
        payments: [
          { id: asId<"PaymentId">("p1"), status: "succeeded", amountCents: 588_80 + 54900 } as never,
        ],
      }),
    );
    expect(paid.paidInFull).toBe(true);
    expect(buildManageView(input()).paidInFull).toBe(false); // nothing paid ⇒ balance owed
  });
});
