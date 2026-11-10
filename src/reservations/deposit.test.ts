/**
 * The deposit at checkout (issue #1250, `docs/SPEC.md §2.8.4d`) — the pieces that live outside the
 * checkout write: the balance window and its dates, "does this attempt have a balance?", and the
 * operator's phone booking, which never takes a deposit.
 *
 * The window's exact boundary is pinned here, on `insideBalanceWindow`, and only here; the checkout,
 * the quote and the screen each take one case either side in their own files.
 *
 * Every instant below is for a departure on Wed, Nov 11 2026 at 13:30 in the vessel zone
 * (America/New_York, the suite's default). Daylight time ends on Nov 1, between the departure and
 * its balance dates — so a date computed by subtracting 30 × 24 hours from the departure instant
 * lands an hour off, and these tests can tell.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { balanceDates, insideBalanceWindow } from "./availability.js";
import { hasBalance } from "./booking-invoice.js";
import { bookForCustomer } from "./operator-booking.js";
import { PAYMENT_CONFIG_DEFAULTS, type PaymentConfig } from "./payment-config.js";

const config = (over: Partial<PaymentConfig> = {}): PaymentConfig => ({ ...PAYMENT_CONFIG_DEFAULTS, ...over });

const DATE = "2026-11-11";
const TIME = "13:30";
/** 30 days before, Mon Oct 12, 13:30 EDT. */
const DUE_AT = "2026-10-12T17:30:00.000Z";
/** 21 days before, Wed Oct 21, 13:30 EDT. */
const RELEASE_AT = "2026-10-21T17:30:00.000Z";

describe("balanceDates", () => {
  it("AC8: the due and release instants are the departure's clock time on the day N days before, in the vessel zone", () => {
    expect(balanceDates(DATE, TIME, config())).toEqual({ dueAt: DUE_AT, releaseAt: RELEASE_AT });
  });

  it("AC8: each date reads its own setting", () => {
    // 45 days before is Sun Sep 27; 10 days before is Sun Nov 1, the morning daylight time ends —
    // 13:30 that afternoon is EST, 18:30Z.
    expect(
      balanceDates(DATE, TIME, config({ balanceDueDaysBeforeEvent: 45, balanceReleaseDaysBeforeEvent: 10 })),
    ).toEqual({ dueAt: "2026-09-27T17:30:00.000Z", releaseAt: "2026-11-01T18:30:00.000Z" });
  });
});

describe("insideBalanceWindow", () => {
  it("AC5: the exact due instant is inside", () => {
    expect(insideBalanceWindow(DATE, TIME, DUE_AT, config())).toBe(true);
  });

  it("AC5: a millisecond before it is outside", () => {
    expect(insideBalanceWindow(DATE, TIME, "2026-10-12T17:29:59.999Z", config())).toBe(false);
  });

  it("AC5: any time after it is inside, and well before it is outside", () => {
    expect(insideBalanceWindow(DATE, TIME, "2026-11-01T12:00:00.000Z", config())).toBe(true);
    expect(insideBalanceWindow(DATE, TIME, "2026-09-01T12:00:00.000Z", config())).toBe(false);
  });

  it("AC5: the window is the balance-due setting's", () => {
    const oct1 = "2026-10-01T12:00:00.000Z";
    expect(insideBalanceWindow(DATE, TIME, oct1, config())).toBe(false);
    expect(insideBalanceWindow(DATE, TIME, oct1, config({ balanceDueDaysBeforeEvent: 45 }))).toBe(true);
  });
});

describe("hasBalance", () => {
  it("AC10: an attempt charging less than the quote has a balance", () => {
    expect(hasBalance({ amountDueNowCents: 10000, totalCents: 65294 })).toBe(true);
  });

  it("AC10: an attempt charging the whole quote has none", () => {
    expect(hasBalance({ amountDueNowCents: 65294, totalCents: 65294 })).toBe(false);
  });
});

/**
 * The operator's phone booking says neither when the deposit is judged nor that one was chosen, so it
 * stays on the whole quote — however far out the trip is. The payment link takes a deposit in 19.2,
 * not here.
 */
describe("bookForCustomer — the phone booking takes no deposit", () => {
  const SMALL = asId<"VesselId">("v-small");
  const OFF = asId<"OfferingId">("off-1");
  const vessel: Vessel = { id: SMALL, name: "small", coiMaxPax: 6, manning: [] };
  const offering: Offering = {
    id: OFF,
    tenantId: asId<"TenantId">("t"),
    name: "Cruise",
    status: "live",
    vesselIds: [SMALL],
    locationId: asId<"LocationId">("loc-1"),
    schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: ["13:30"] },
    basePriceCents: 49900,
    priceVariations: [],
    extraGuestPriceCents: 5000,
    tripLengthMinutes: 100,
    holdMinutes: 120,
  };

  it("AC7: 40 days out, the frozen invoice is due whole and carries no balance dates", async () => {
    const repo = new InMemoryRepository();
    await repo.saveOffering(offering);
    await repo.saveVessel(vessel);
    const res = await bookForCustomer(
      repo,
      {
        offeringId: OFF,
        vesselId: SMALL,
        date: "2026-07-04",
        time: "13:30",
        guestCount: 4,
        gratuityBps: 2000,
        customerName: "Martin Brody",
        phone: "(216) 555-0142",
      },
      () => "2026-05-25T12:00:00.000Z",
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const stored = (await repo.getReservation(res.reservation.id))!;
    expect(stored.invoice!.totalCents).toBe(65294);
    expect(stored.invoice!.amountDueNowCents).toBe(stored.invoice!.totalCents);
    expect(stored.balanceDueAt).toBeUndefined();
    expect(stored.balanceReleaseAt).toBeUndefined();
  });
});
