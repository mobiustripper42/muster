/**
 * Customer manage view model (12.6, #459) — the pure "Your booking" shaping: trip-phase flip,
 * post-trip gratuity tiers, trip timing. Money is delegated to `buildReservationDetail` (tested
 * in calendar-detail.test.ts), so these tests focus on the customer-facing extras.
 */
import { describe, expect, it } from "vitest";
import type { Event, Offering, Reservation, Vessel } from "../domain/entities.js";
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

  it("a CANCELLED booking reads paid-in-full, because it owes nothing (issue #803)", () => {
    // The guest-visible consequence of zeroing a cancelled booking's balance, pinned because it
    // is derived rather than written: `paidInFull` is `balanceCents <= 0`, so `/b/<code>` swaps
    // "Paid so far" for "Paid in full" and drops the balance row entirely. Confirmed correct by
    // the operator (2026-08-21) on a cancelled + refunded booking — they did pay in full, and
    // the Refunded row directly beneath carries the rest of the story.
    //
    // The payment is a partial one — $200 against a larger fare — so without the fix the balance
    // is a real positive number and `paidInFull` is false. That is what makes this bite.
    //
    // Written AFTER the change: a regression guard on a knock-on effect, not a proof of it.
    const v = buildManageView(
      input({
        reservation: { ...RES, status: "cancelled" },
        payments: [
          { id: asId<"PaymentId">("p1"), status: "succeeded", amountCents: 20000 } as never,
        ],
      }),
    );
    expect(v.paidInFull).toBe(true);
  });

  it("a FULLY refunded cancelled booking is not 'paid in full' — nothing is paid (issue #803)", () => {
    // The trap zeroing the balance opened, caught by @code-review. A fully refunded payment row
    // is `refunded`, which `countsAsPaid` excludes, so `paidCents` is 0 — and with the balance
    // also 0 the guest page's headline money line said "Paid in full $0.00" above the refund.
    // This is the ordinary end state of an operator cancel (#797), not an edge case.
    //
    // Written AFTER the change, like the guard above it.
    const v = buildManageView(
      input({
        reservation: { ...RES, status: "cancelled" },
        payments: [
          {
            id: asId<"PaymentId">("p1"),
            status: "refunded",
            amountCents: 20000,
            refundedCents: 20000,
          } as never,
        ],
      }),
    );
    expect(v.detail.money.paidCents).toBe(0);
    expect(v.detail.money.balanceCents).toBe(0);
    expect(v.paidInFull).toBe(false);
  });
});
