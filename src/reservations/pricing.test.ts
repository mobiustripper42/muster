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
import { composeFare, effectiveIncludedGuests } from "./pricing.js";

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

  it("folds gratuity in when provided (DEC-124 seam, 12.3)", () => {
    expect(inp({ guestCount: 14, gratuityCents: 10000 }).fareCents).toBe(67900); // 49900 + 8000 + 10000
  });

  it("base resolves from the caller (Event.price / variation), passed straight through", () => {
    expect(inp({ baseCents: 60000, guestCount: 13 }).fareCents).toBe(64000); // 60000 + 1×4000
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

const req = (guestCount: number) => ({
  offeringId: OFF, date: DATE, time: TIME, guestCount,
  customerName: "Mary", email: "m@x.io",
  waiverConsentAt: "2026-07-13T12:00:00.000Z", waiverVersion: "v1",
});

describe("createDepartureCheckout — charges the composed fare (12.2)", () => {
  it("charges base only when guests ≤ includedGuestCount", async () => {
    const repo = await seededRepo(vessel({ includedGuestCount: 12 }));
    const pay = new FakePaymentPort();
    const r = await createDepartureCheckout(repo, pay, req(12), URLS, now);
    expect(r.ok).toBe(true);
    expect(pay.created[0]!.amountCents).toBe(49900); // no extras, tax 0
    expect(pay.created[0]!.metadata).toMatchObject({ priceCents: "49900", extrasCents: "0" });
  });

  it("charges base + extras above the included count, freezing base as Event.price", async () => {
    const repo = await seededRepo(vessel({ includedGuestCount: 12 }));
    const pay = new FakePaymentPort();
    const r = await createDepartureCheckout(repo, pay, req(14), URLS, now); // 2 extra × $40
    expect(r.ok).toBe(true);
    expect(pay.created[0]!.amountCents).toBe(57900); // 49900 + 8000
    // base stays the frozen per-departure price; extras carried separately
    expect(pay.created[0]!.metadata).toMatchObject({ priceCents: "49900", extrasCents: "8000", guestCount: "14" });
  });

  it("a vessel with no includedGuestCount charges base only (default = coiMaxPax)", async () => {
    const repo = await seededRepo(vessel()); // no includedGuestCount, coiMaxPax 16
    const pay = new FakePaymentPort();
    const r = await createDepartureCheckout(repo, pay, req(14), URLS, now);
    expect(r.ok).toBe(true);
    expect(pay.created[0]!.amountCents).toBe(49900); // 14 ≤ 16 included → no extras
    expect(pay.created[0]!.metadata.extrasCents).toBe("0");
  });

  it("tax is applied to the composed fare (base + extras), not the base alone", async () => {
    const repo = await seededRepo(vessel({ includedGuestCount: 12 }));
    await repo.setPaymentConfig({ depositMode: "full", taxRateBps: 1000 }, NOW); // 10%
    const pay = new FakePaymentPort();
    await createDepartureCheckout(repo, pay, req(14), URLS, now); // fare 57900
    expect(pay.created[0]!.taxCents).toBe(5790); // 10% of 57900, not of 49900
    expect(pay.created[0]!.amountCents).toBe(63690); // 57900 + 5790
  });
});
