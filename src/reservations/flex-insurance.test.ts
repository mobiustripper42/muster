/**
 * Cancellation insurance in the money core (16.8, issue #683, SPEC §2.8.4a / §2.8.4c), and the
 * charge rule it arrived with (operator, 2026-10-09):
 *
 *   - Taxed: what reaches our bank — fare, extras, insurance. Not the tip, not the service fee.
 *   - Service fee: on everything except tax — fare, extras, insurance AND the tip.
 *   - Tip: a tier of fare + extras only.
 *
 * The operator's discount comes off fare + extras first and only then off the insurance, so a
 * partial discount never touches it and the whole thing can still be comped.
 */
import { describe, expect, it } from "vitest";
import type { Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { hasFlex, priceBooking } from "./booking-invoice.js";
import {
  applyDiscount,
  bookedFareCents,
  chargedFareCents,
  chargeTotals,
  flexCarveOutCents,
  flexChargedCents,
} from "./discount.js";
import { PAYMENT_CONFIG_DEFAULTS } from "./payment-config.js";
import { FLEX_INSURANCE_CENTS } from "./refund-terms.js";

// 8% tax, 3% fee, 20% tip on a $500 trip.
const rates = { taxRateBps: 800, serviceFeeBps: 300, gratuityBps: 2000 };
const FLEX = FLEX_INSURANCE_CENTS;

describe("chargeTotals — the operator's grid", () => {
  it("$499 at 7.25%, 20% tip, no insurance: $652.94", () => {
    // fee 3% of 499 + 99.80 = 17.96; tax 7.25% of 499 = 36.18 (the fee is not taxed).
    expect(chargeTotals({ baseCents: 49900, flexDueCents: 0, gratuityCents: 9980, taxRateBps: 725, serviceFeeBps: 300 })).toEqual({
      taxCents: 3618,
      serviceFeeCents: 1796,
      totalCents: 65294,
    });
  });

  it("$499 at 7.25%, 20% tip, with insurance: $686.01", () => {
    // fee 3% of 499 + 30 + 99.80 = 18.86; tax 7.25% of 499 + 30 = 38.35.
    expect(chargeTotals({ baseCents: 49900, flexDueCents: 3000, gratuityCents: 9980, taxRateBps: 725, serviceFeeBps: 300 })).toEqual({
      taxCents: 3835,
      serviceFeeCents: 1886,
      totalCents: 68601,
    });
  });
});

describe("applyDiscount with insurance", () => {
  it("insurance is taxed and in the fee base; the tip is in the fee base and untaxed", () => {
    const d = applyDiscount({ fareAndExtrasCents: 50000, requestedCents: 0, flexCents: FLEX, ...rates });
    expect(d).toEqual({
      discountCents: 0,
      baseCents: 50000,
      taxCents: 4240, // 8% of 53000
      serviceFeeCents: 1890, // 3% of 53000 + 10000
      gratuityCents: 10000, // 20% of the fare only
      flexDueCents: 3000,
      totalCents: 69130,
      comped: false,
    });
  });

  it("a partial discount never touches the insurance", () => {
    const d = applyDiscount({ fareAndExtrasCents: 50000, requestedCents: 10000, flexCents: FLEX, ...rates });
    // 40000 + 3000 + 8000 tip + 3440 tax + 1530 fee.
    expect(d).toMatchObject({ discountCents: 10000, baseCents: 40000, flexDueCents: 3000, totalCents: 55970 });
  });

  it("the whole fare off still owes the insurance and its tax and fee — not a comp", () => {
    const d = applyDiscount({ fareAndExtrasCents: 50000, requestedCents: 50000, flexCents: FLEX, ...rates });
    expect(d).toMatchObject({ discountCents: 50000, baseCents: 0, gratuityCents: 0, flexDueCents: 3000, totalCents: 3330, comped: false });
  });

  it("past the fare the discount goes on to the insurance", () => {
    const d = applyDiscount({ fareAndExtrasCents: 50000, requestedCents: 51000, flexCents: FLEX, ...rates });
    expect(d).toMatchObject({ discountCents: 51000, baseCents: 0, flexDueCents: 2000, totalCents: 2220, comped: false });
  });

  it("fare plus insurance off is a comp, capped there", () => {
    const d = applyDiscount({ fareAndExtrasCents: 50000, requestedCents: 99999, flexCents: FLEX, ...rates });
    expect(d).toMatchObject({ discountCents: 53000, baseCents: 0, flexDueCents: 0, totalCents: 0, comped: true });
  });

  it("under $2 left on the insurance is raised to a comp of everything", () => {
    const d = applyDiscount({ fareAndExtrasCents: 50000, requestedCents: 52900, flexCents: FLEX, ...rates });
    expect(d).toMatchObject({ discountCents: 53000, flexDueCents: 0, totalCents: 0, comped: true });
  });

  it("without insurance the cap is still fare plus extras", () => {
    const d = applyDiscount({ fareAndExtrasCents: 50000, requestedCents: 51000, ...rates });
    expect(d).toMatchObject({ discountCents: 50000, flexDueCents: 0, totalCents: 0, comped: true });
  });
});

describe("priceBooking with insurance", () => {
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
    guestCount: 4,
    gratuityBps: 2000,
  };

  it("freezes the insurance on the invoice and in the charge", () => {
    expect(priceBooking({ ...input, hasFlex: true })).toEqual({
      fareCents: 50000,
      extrasCents: 0,
      taxCents: 4240,
      taxRateBps: 800,
      serviceFeeCents: 1890,
      serviceFeeBps: 300,
      gratuityCents: 10000,
      gratuityBps: 2000,
      flexCents: 3000,
      totalCents: 69130,
      amountDueNowCents: 69130,
    });
  });

  it("deposit mode charges the insurance in full up front, like the tip", () => {
    const inv = priceBooking({ ...input, hasFlex: true, config: { ...config, depositMode: "deposit", depositPercent: 25 } });
    // 25% of 50000 + 4240 tax + 1890 fee + 10000 tip + 3000 insurance.
    expect(inv.amountDueNowCents).toBe(12500 + 4240 + 1890 + 10000 + 3000);
    expect(inv.totalCents).toBe(69130);
  });

  it("no insurance writes no insurance line", () => {
    expect(priceBooking({ ...input, hasFlex: false })).toEqual(priceBooking(input));
    expect(priceBooking(input)).not.toHaveProperty("flexCents");
    expect(hasFlex(priceBooking(input))).toBe(false);
  });

  it("a comp keeps the insurance — and with it the 72-hour window", () => {
    const inv = priceBooking({ ...input, hasFlex: true, discountCents: 53000 });
    expect(inv).toMatchObject({ flexCents: 3000, discountCents: 53000, totalCents: 0, amountDueNowCents: 0 });
    expect(hasFlex(inv)).toBe(true);
    expect(flexChargedCents(inv)).toBe(0);
  });
});

describe("invoice readers keep insurance off the fare", () => {
  // $510 off a $500 fare with insurance: $500 off the fare, $10 off the insurance.
  const inv = { fareCents: 45000, extrasCents: 5000, discountCents: 51000, flexCents: 3000 };

  it("chargedFareCents takes only the fare's share of the discount", () => {
    expect(chargedFareCents(inv)).toBe(0);
    expect(chargedFareCents({ ...inv, discountCents: 10000 })).toBe(40000);
  });

  it("bookedFareCents takes only the fare's share of the discount", () => {
    expect(bookedFareCents(45000, { extrasCents: 5000, invoice: { ...inv, taxCents: 0, taxRateBps: 0, serviceFeeCents: 0, serviceFeeBps: 0, gratuityCents: 0, gratuityBps: 0, totalCents: 2000, amountDueNowCents: 2000 } })).toBe(0);
  });

  it("flexChargedCents is the insurance less the discount's spill onto it", () => {
    expect(flexChargedCents(inv)).toBe(2000);
    expect(flexChargedCents({ ...inv, discountCents: 0 })).toBe(3000);
    expect(flexChargedCents({ fareCents: 45000, extrasCents: 5000 })).toBe(0);
  });

  it("the payment carve-out is the insurance plus the tax on it — what fare + tax never counts", () => {
    const priced = { ...inv, discountCents: 0, taxCents: 4240, taxRateBps: 800 }; // 8% of 50000 + 3000
    // 8% of the fare alone is 4000, so 240 of the tax is the insurance's.
    expect(flexCarveOutCents(priced)).toBe(3000 + 240);
    expect(flexCarveOutCents({ ...priced, flexCents: 0, taxCents: 4000 })).toBe(0);
  });
});
