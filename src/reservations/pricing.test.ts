/**
 * Party-fare composition (12.2, DEC-112) — the pure `composeFare` + its wiring into the
 * departure checkout (the actual charge includes extra-guest pricing).
 */
import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { createDepartureCheckout } from "./create-departure-checkout.js";
import {
  GRATUITY_DEFAULT_BPS,
  GRATUITY_TIERS_DEFAULT,
  composeFare,
  effectiveIncludedGuests,
  gratuityCentsFor,
  gratuityTiersFor,
} from "./pricing.js";

describe("composeFare — base + extra-guests × extraGuestPrice (DEC-112)", () => {
  const inp = (over: Partial<Parameters<typeof composeFare>[0]> = {}) =>
    composeFare({ baseCents: 49900, guestCount: 4, includedGuestCount: 12, extraGuestPriceCents: 4000, ...over });

  it("no extras when guests are within the included count", () => {
    expect(inp({ guestCount: 12 })).toEqual({ extraGuests: 0, extrasCents: 0, fareCents: 49900 });
  });

  it("charges per guest above the included count", () => {
    // 14 guests, 12 included, $40 each extra → 2 × 4000 = 8000
    expect(inp({ guestCount: 14 })).toEqual({ extraGuests: 2, extrasCents: 8000, fareCents: 57900 });
  });

  it("a small party still pays the whole-boat base (no discount, DEC-105)", () => {
    expect(inp({ guestCount: 1 })).toEqual({ extraGuests: 0, extrasCents: 0, fareCents: 49900 });
  });

  it("does NOT include gratuity — fareCents is the tip-free taxable base (DEC-124)", () => {
    // composeFare has no gratuity param; the tip is added by the checkout after tax.
    expect(inp({ guestCount: 14 }).fareCents).toBe(57900); // 49900 + 8000, no tip
  });

  it("base resolves from the caller (Event.price / variation), passed straight through", () => {
    expect(inp({ baseCents: 60000, guestCount: 13 }).fareCents).toBe(64000); // 60000 + 1×4000
  });
});

describe("gratuity tiers (DEC-124)", () => {
  it("gratuityCentsFor is bps of the fare, rounded half-up", () => {
    expect(gratuityCentsFor(57900, 2000)).toBe(11580); // 20% of $579
    expect(gratuityCentsFor(49900, 1500)).toBe(7485); // 15%
    expect(gratuityCentsFor(49900, 2500)).toBe(12475); // 25%
  });
  it("gratuityTiersFor uses the offering override, else the default", () => {
    expect(gratuityTiersFor({})).toEqual(GRATUITY_TIERS_DEFAULT);
    expect(gratuityTiersFor({ gratuityTiersBps: [1000, 1800] })).toEqual([1000, 1800]);
    expect(GRATUITY_DEFAULT_BPS).toBe(2000);
  });
});

describe("effectiveIncludedGuests — default to coiMaxPax", () => {
  it("uses includedGuestCount when set", () => {
    expect(effectiveIncludedGuests({ includedGuestCount: 8, coiMaxPax: 16 })).toBe(8);
  });
  it("falls back to coiMaxPax when unset (whole boat included, no extras)", () => {
    expect(effectiveIncludedGuests({ coiMaxPax: 6 })).toBe(6);
  });
});

// ── Wiring: the departure checkout charges the composed fare ──────────────────
const OFF = asId<"OfferingId">("off-1");
const BOAT = asId<"VesselId">("v-1");
const DATE = "2026-07-04"; // Saturday (weekday 5)
const TIME = "13:30";
const NOW = "2026-07-04T12:00:00.000Z";
const now = () => NOW;
const URLS = { successUrl: "https://x/s", cancelUrl: "https://x/c" };

const vessel = (over: Partial<Vessel> = {}): Vessel => ({ id: BOAT, name: "Brew", coiMaxPax: 16, manning: [], ...over });
const offering = (over: Partial<Offering> = {}): Offering => ({
  id: OFF, tenantId: asId<"TenantId">("t"), name: "Cruise", status: "live",
  vesselIds: [BOAT], locationId: asId<"LocationId">("loc-1"),
  schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: [TIME] },
  basePriceCents: 49900, priceVariations: [], extraGuestPriceCents: 4000, ...over,
});

async function seededRepo(v: Vessel): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveOffering(offering());
  await repo.saveVessel(v);
  await repo.markVesselDayMusterOwned(BOAT, DATE, NOW);
  await repo.setPaymentConfig({ depositMode: "full", taxRateBps: 0 }, NOW);
  return repo;
}

// gratuityBps 2000 (20%) is required at checkout (DEC-124); the tip rides on top, untaxed.
const req = (guestCount: number) => ({
  offeringId: OFF, date: DATE, time: TIME, guestCount, gratuityBps: 2000,
  customerName: "Mary", email: "m@x.io",
  waiverConsentAt: "2026-07-13T12:00:00.000Z", waiverVersion: "v1",
});

describe("createDepartureCheckout — charges composed fare + gratuity (12.2/12.3)", () => {
  it("charges base only (+ tip) when guests ≤ includedGuestCount", async () => {
    const repo = await seededRepo(vessel({ includedGuestCount: 12 }));
    const pay = new FakePaymentPort();
    const r = await createDepartureCheckout(repo, pay, req(12), URLS, now);
    expect(r.ok).toBe(true);
    // fare 49900, tax 0, gratuity 20% of 49900 = 9980
    expect(pay.created[0]!.amountCents).toBe(59880);
    expect(pay.created[0]!.metadata).toMatchObject({ priceCents: "49900", extrasCents: "0", gratuityCents: "9980" });
  });

  it("charges base + extras (+ tip), freezing base as Event.price", async () => {
    const repo = await seededRepo(vessel({ includedGuestCount: 12 }));
    const pay = new FakePaymentPort();
    const r = await createDepartureCheckout(repo, pay, req(14), URLS, now); // 2 extra × $40
    expect(r.ok).toBe(true);
    // fare 57900 (49900+8000), tax 0, gratuity 20% of 57900 = 11580
    expect(pay.created[0]!.amountCents).toBe(69480);
    expect(pay.created[0]!.metadata).toMatchObject({ priceCents: "49900", extrasCents: "8000", guestCount: "14" });
  });

  it("a vessel with no includedGuestCount charges base only (default = coiMaxPax)", async () => {
    const repo = await seededRepo(vessel()); // no includedGuestCount, coiMaxPax 16
    const pay = new FakePaymentPort();
    const r = await createDepartureCheckout(repo, pay, req(14), URLS, now);
    expect(r.ok).toBe(true);
    expect(pay.created[0]!.amountCents).toBe(59880); // 14 ≤ 16 → no extras; 49900 + 9980 tip
    expect(pay.created[0]!.metadata.extrasCents).toBe("0");
  });

  it("tax is applied to the composed fare (base + extras) but NOT the gratuity", async () => {
    const repo = await seededRepo(vessel({ includedGuestCount: 12 }));
    await repo.setPaymentConfig({ depositMode: "full", taxRateBps: 1000 }, NOW); // 10%
    const pay = new FakePaymentPort();
    await createDepartureCheckout(repo, pay, req(14), URLS, now); // fare 57900
    expect(pay.created[0]!.taxCents).toBe(5790); // 10% of 57900, not of the base or the tip
    // amount = fare 57900 + tax 5790 + gratuity 11580 (untaxed)
    expect(pay.created[0]!.amountCents).toBe(75270);
  });
});
