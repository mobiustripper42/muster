/**
 * The operator's discount (16.5, DEC-194, SPEC §2.8.4a) — dollars off fare plus extras, with tax,
 * the service fee and the tip recomputed on what is left, and anything under $2 due made a comp.
 */
import { describe, expect, it } from "vitest";
import type { Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { priceBooking } from "./booking-invoice.js";
import { applyDiscount, COMP_FLOOR_CENTS } from "./discount.js";
import { PAYMENT_CONFIG_DEFAULTS } from "./payment-config.js";

// 8% tax, 3% fee, 20% tip on a $500 trip: 50000 + 4000 tax + 10000 tip + 1800 fee (3% of fare
// AND tip, operator 2026-10-09) = 65800.
const rates = { taxRateBps: 800, serviceFeeBps: 300, gratuityBps: 2000 };

describe("applyDiscount", () => {
  it("takes dollars off the base and recomputes tax, fee and tip on what is left", () => {
    const d = applyDiscount({ fareAndExtrasCents: 50000, requestedCents: 10000, ...rates });
    expect(d).toEqual({
      discountCents: 10000,
      baseCents: 40000,
      taxCents: 3200,
      serviceFeeCents: 1440, // 3% of 40000 + 8000
      gratuityCents: 8000,
      flexDueCents: 0,
      totalCents: 52640,
      comped: false,
    });
  });

  it("no discount is the undiscounted charge", () => {
    const d = applyDiscount({ fareAndExtrasCents: 50000, requestedCents: 0, ...rates });
    expect(d).toMatchObject({ discountCents: 0, baseCents: 50000, totalCents: 65800, comped: false });
  });

  it("caps the discount at fare plus extras — more than the trip is a comp, never a negative charge", () => {
    const d = applyDiscount({ fareAndExtrasCents: 8000, requestedCents: 10000, ...rates });
    expect(d).toMatchObject({ discountCents: 8000, baseCents: 0, totalCents: 0, comped: true });
  });

  it("the whole fare off is a comp, and the comp zeroes the tip", () => {
    const d = applyDiscount({ fareAndExtrasCents: 50000, requestedCents: 50000, ...rates });
    expect(d).toEqual({
      discountCents: 50000,
      baseCents: 0,
      taxCents: 0,
      serviceFeeCents: 0,
      gratuityCents: 0,
      flexDueCents: 0,
      totalCents: 0,
      comped: true,
    });
  });

  it("anything under $2 due is raised to a comp", () => {
    // $1 of base left → 100 + 8 tax + 20 tip + 4 fee = 132 cents due, under the floor.
    const d = applyDiscount({ fareAndExtrasCents: 50000, requestedCents: 49900, ...rates });
    expect(COMP_FLOOR_CENTS).toBe(200);
    expect(d).toMatchObject({ discountCents: 50000, totalCents: 0, comped: true });
  });

  it("$2 or more due stands as a partial discount", () => {
    // $1.53 of base → 153 + 12 tax + 31 tip + 6 fee (3% of 184) = 202 cents due.
    const d = applyDiscount({ fareAndExtrasCents: 50000, requestedCents: 49847, ...rates });
    expect(d).toMatchObject({ discountCents: 49847, totalCents: 202, comped: false });
  });
});

describe("priceBooking with a discount", () => {
  const SMALL = asId<"VesselId">("v-small");
  const vessel: Vessel = { id: SMALL, name: "small", coiMaxPax: 6, manning: [] };
  const offering: Offering = {
    id: asId<"OfferingId">("off-1"),
    tenantId: asId<"TenantId">("t"),
    name: "Cruise",
    status: "live",
    vesselIds: [SMALL],
    locationId: asId<"LocationId">("loc-1"),
    schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: ["13:30"] },
    basePriceCents: 50000,
    priceVariations: [],
    extraGuestPriceCents: 5000,
    includedGuestCount: 4,
    tripLengthMinutes: 100,
    holdMinutes: 120,
  };
  const config = { ...PAYMENT_CONFIG_DEFAULTS, taxRateBps: 800, serviceFeeBps: 300 };
  const input = {
    offering,
    vessel,
    vesselId: SMALL,
    events: [],
    config,
    date: "2026-07-03",
    time: "13:30",
    guestCount: 6,
    gratuityBps: 2000,
  };

  it("keeps fare and extras undiscounted and freezes the discount as its own line", () => {
    // 50000 fare + 2 × 5000 extras = 60000; $100 off → 50000 base.
    const inv = priceBooking({ ...input, discountCents: 10000 });
    expect(inv).toEqual({
      fareCents: 50000,
      extrasCents: 10000,
      discountCents: 10000,
      taxCents: 4000,
      taxRateBps: 800,
      serviceFeeCents: 1800,
      serviceFeeBps: 300,
      gratuityCents: 10000,
      gratuityBps: 2000,
      totalCents: 65800,
      amountDueNowCents: 65800,
    });
  });

  it("a comp freezes $0 due and $0 tip", () => {
    const inv = priceBooking({ ...input, discountCents: 60000 });
    expect(inv).toMatchObject({ discountCents: 60000, gratuityCents: 0, totalCents: 0, amountDueNowCents: 0 });
  });

  it("no discount writes no discount line — an undiscounted invoice is unchanged", () => {
    expect(priceBooking({ ...input, discountCents: 0 })).toEqual(priceBooking(input));
    expect(priceBooking(input)).not.toHaveProperty("discountCents");
  });
});
