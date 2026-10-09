/**
 * `totalsFor` — the pay bar's and the summary's figures — must be exactly what `priceBooking`
 * freezes, with and without cancellation insurance (16.8), at every tip tier. The fee moves with the
 * tip and the insurance and the tax moves with the insurance (DEC-196), so the screen re-totals
 * through the core's `chargeTotals` rather than adding them on top.
 */
import { describe, expect, it } from "vitest";
import type { Offering, Vessel } from "@core/domain/entities.js";
import { asId } from "@core/domain/ids.js";
import { priceBooking } from "@core/reservations/booking-invoice.js";
import { checkoutQuote } from "@core/reservations/checkout-quote.js";
import { applyDiscount } from "@core/reservations/discount.js";
import { payLinkMoney } from "@core/reservations/pay-by-link.js";
import { PAYMENT_CONFIG_DEFAULTS, type PaymentConfig } from "@core/reservations/payment-config.js";
import { totalsFor } from "./money";

const V = asId<"VesselId">("v");
const vessel: Vessel = { id: V, name: "Boat", coiMaxPax: 12, manning: [] };
const offering: Offering = {
  id: asId<"OfferingId">("off-1"), tenantId: asId<"TenantId">("t"), name: "Cruise", status: "live",
  vesselIds: [V], locationId: asId<"LocationId">("loc-1"),
  schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [6], departureTimes: ["15:30"] },
  basePriceCents: 49900, priceVariations: [], extraGuestPriceCents: 4000, includedGuestCount: 10,
};
const input = (config: PaymentConfig) => ({
  offering, vessel, vesselId: V, events: [], config, date: "2026-07-04", time: "15:30", guestCount: 11,
});
const FULL: PaymentConfig = { ...PAYMENT_CONFIG_DEFAULTS, depositMode: "full", taxRateBps: 725 };
const DEPOSIT: PaymentConfig = { ...FULL, depositMode: "deposit", depositPercent: 25 };

describe("totalsFor on the public checkout", () => {
  for (const [label, config] of [["full", FULL], ["deposit", DEPOSIT]] as const) {
    for (const hasFlex of [false, true]) {
      it(`${label}, insurance ${hasFlex ? "ticked" : "not ticked"}: every tier equals the invoice that gets charged`, () => {
        const q = checkoutQuote(input(config));
        for (const tier of q.tiers) {
          const inv = priceBooking({ ...input(config), gratuityBps: tier.bps, hasFlex });
          expect(totalsFor(q, tier.tipCents, hasFlex ? q.flexCents : 0)).toEqual({
            tipCents: inv.gratuityCents,
            flexCents: inv.flexCents ?? 0,
            taxCents: inv.taxCents,
            serviceFeeCents: inv.serviceFeeCents,
            totalCents: inv.totalCents,
            dueNowCents: inv.amountDueNowCents,
          });
        }
      });
    }
  }
});

describe("totalsFor on the operator's form, with a discount", () => {
  for (const discountCents of [0, 10000, 53900, 54900, 56900]) {
    it(`insurance with $${discountCents / 100} off: equals the invoice`, () => {
      const q = checkoutQuote(input(FULL));
      const d = applyDiscount({
        fareAndExtrasCents: q.fareCents,
        requestedCents: discountCents,
        taxRateBps: q.taxRateBps,
        serviceFeeBps: q.serviceFeeBps,
        gratuityBps: 2000,
        flexCents: q.flexCents,
      });
      const inv = priceBooking({ ...input(FULL), gratuityBps: 2000, hasFlex: true, discountCents });
      const t = totalsFor({ ...q, discountCents: d.discountCents }, d.gratuityCents, q.flexCents);
      expect(t.totalCents).toBe(inv.totalCents);
      expect(t.dueNowCents).toBe(inv.amountDueNowCents);
      expect(t.taxCents).toBe(inv.taxCents);
      expect(t.serviceFeeCents).toBe(inv.serviceFeeCents);
    });
  }
});

describe("the payment link shows the frozen invoice, never a recompute", () => {
  it("an invoice frozen under the old fee rule keeps its own fee and total", () => {
    const inv = { ...priceBooking({ ...input(FULL), gratuityBps: 2000 }), serviceFeeCents: 1617, totalCents: 70000, amountDueNowCents: 70000 };
    const { totals } = payLinkMoney(inv);
    expect(totals).toMatchObject({ serviceFeeCents: 1617, totalCents: 70000, dueNowCents: 70000 });
  });
});
