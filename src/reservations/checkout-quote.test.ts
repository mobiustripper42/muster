/**
 * `checkoutQuote` (16.1d, issue #1092) — the money a checkout screen DISPLAYS, from the one model
 * that CHARGES.
 *
 * Two claims, and each block below pins one of them:
 *
 *  1. **It reproduces what `/book/checkout` showed before 16.1d.** The page used to compose the
 *     fare, tax, fee and tip tiers itself (`guestPricing` → `taxCentsFor` → `feeCentsFor` →
 *     `chargeNowCents`). `oldPageArithmetic` below is that code, copied from the page as it stood,
 *     so the refactor is held to the numbers customers were already shown.
 *  2. **It agrees with `priceBooking` at every tip tier** — the function that freezes the invoice
 *     onto the row and sets the amount Stripe is asked for. The screen and the charge used to agree
 *     because two copies of the arithmetic happened to match; now the screen reads the charge's.
 */
import { describe, expect, it } from "vitest";
import type { Event, Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { guestPricing } from "./availability-screen.js";
import { priceBooking } from "./booking-invoice.js";
import { checkoutQuote } from "./checkout-quote.js";
import { PAYMENT_CONFIG_DEFAULTS, chargeNowCents, feeCentsFor, taxCentsFor, type PaymentConfig } from "./payment-config.js";
import { GRATUITY_DEFAULT_BPS, gratuityCentsFor, gratuityKindsFor, gratuityTiersFor } from "./pricing.js";

const V12 = asId<"VesselId">("v-12");
const DATE = "2026-07-04";
const TIME = "15:30";

const vessel: Vessel = { id: V12, name: "Twelve", coiMaxPax: 12, manning: [] };
const offering = (over: Partial<Offering> = {}): Offering => ({
  id: asId<"OfferingId">("off-1"), tenantId: asId<"TenantId">("t"), name: "Cruise", status: "live",
  vesselIds: [V12], locationId: asId<"LocationId">("loc-1"),
  schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [6], departureTimes: [TIME] },
  basePriceCents: 49900, priceVariations: [], extraGuestPriceCents: 4000, includedGuestCount: 10, ...over,
});

const FULL: PaymentConfig = { ...PAYMENT_CONFIG_DEFAULTS, depositMode: "full" };
const DEPOSIT: PaymentConfig = { ...PAYMENT_CONFIG_DEFAULTS, depositMode: "deposit", depositPercent: 25 };

/** `app/(public)/book/checkout/page.tsx` before 16.1d, lines 209–223, verbatim but for names. */
function oldPageArithmetic(o: Offering, boatCapacity: number, baseCents: number, guests: number, config: PaymentConfig) {
  const fare = guestPricing(o, boatCapacity, baseCents, guests);
  const taxCents = taxCentsFor(fare.fareCents, config.taxRateBps);
  const serviceFeeCents = feeCentsFor(fare.fareCents, config.serviceFeeBps);
  const dueNowBeforeTipCents = chargeNowCents(fare.fareCents, taxCents, serviceFeeCents, config);
  const depositMode = config.depositMode === "deposit";
  const balanceLaterCents = depositMode ? fare.fareCents + taxCents + serviceFeeCents - dueNowBeforeTipCents : 0;
  const tiersBps = gratuityTiersFor(o);
  const defaultBps = gratuityKindsFor(o).find((k) => k.kind === "pre")?.defaultBps ?? GRATUITY_DEFAULT_BPS;
  return {
    fareCents: fare.fareCents,
    baseCents,
    extraGuests: fare.extraGuests,
    extrasCents: fare.extrasCents,
    extraGuestPriceCents: fare.extraGuestPriceCents,
    includedGuests: fare.included,
    taxCents,
    taxRateBps: config.taxRateBps,
    serviceFeeCents,
    serviceFeeBps: config.serviceFeeBps,
    dueNowBeforeTipCents,
    depositMode,
    balanceLaterCents,
    tiers: tiersBps.map((bps) => ({ bps, tipCents: gratuityCentsFor(fare.fareCents, bps) })),
    defaultBps: tiersBps.includes(defaultBps) ? defaultBps : tiersBps[0]!,
  };
}

const quote = (o: Offering, guests: number, config: PaymentConfig, events: Event[] = []) =>
  checkoutQuote({ offering: o, vessel, vesselId: V12, events, config, date: DATE, time: TIME, guestCount: guests });

describe("checkoutQuote reproduces what /book/checkout showed before 16.1d", () => {
  it("full payment, a party inside the included count", () => {
    expect(quote(offering(), 2, FULL)).toEqual(oldPageArithmetic(offering(), 12, 49900, 2, FULL));
  });

  it("deposit mode, with extra guests over the included count", () => {
    // 12 guests, 10 included → 2 extras at $40. Deposit mode puts a balance on the screen.
    const q = quote(offering(), 12, DEPOSIT);
    expect(q.extraGuests).toBe(2);
    expect(q.balanceLaterCents).toBeGreaterThan(0);
    expect(q).toEqual(oldPageArithmetic(offering(), 12, 49900, 12, DEPOSIT));
  });

  it("no included count on the offering: the whole boat is included", () => {
    const { includedGuestCount: _unset, ...rest } = offering();
    const o: Offering = rest;
    expect(quote(o, 12, FULL)).toEqual(oldPageArithmetic(o, 12, 49900, 12, FULL));
  });

  it("an override Event's price on the slot is the base, as the calendar derives it", () => {
    const ev: Event = {
      id: asId<"EventId">("ev-1"), vesselId: V12, date: DATE, time: TIME, capacity: 12,
      status: "scheduled", source: "muster", price: 61500,
    };
    expect(quote(offering(), 4, FULL, [ev])).toEqual(oldPageArithmetic(offering(), 12, 61500, 4, FULL));
  });

  it("an offering whose default tip is not one of its tiers preselects the first tier", () => {
    const o = offering({ gratuityKinds: [{ kind: "pre", tiersBps: [1000, 1800], defaultBps: 2000, required: true }] });
    expect(quote(o, 2, FULL).defaultBps).toBe(1000);
    expect(quote(o, 2, FULL)).toEqual(oldPageArithmetic(o, 12, 49900, 2, FULL));
  });
});

describe("checkoutQuote agrees with what is charged, at every tip tier", () => {
  for (const [label, config] of [["full", FULL], ["deposit", DEPOSIT]] as const) {
    it(`${label}: due now and total, plus each tier's tip, equal priceBooking's invoice`, () => {
      const q = quote(offering(), 11, config);
      for (const tier of q.tiers) {
        const invoice = priceBooking({
          offering: offering(), vessel, vesselId: V12, events: [], config,
          date: DATE, time: TIME, guestCount: 11, gratuityBps: tier.bps,
        });
        expect(tier.tipCents).toBe(invoice.gratuityCents);
        // What the pay bar shows is what Stripe is asked for.
        expect(q.dueNowBeforeTipCents + tier.tipCents).toBe(invoice.amountDueNowCents);
        expect(q.fareCents + q.taxCents + q.serviceFeeCents + tier.tipCents).toBe(invoice.totalCents);
      }
    });
  }
});
