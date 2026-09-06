/**
 * Party-fare composition (12.2, DEC-112) — the pure `composeFare` and the gratuity/included-guest
 * helpers.
 *
 * The checkout-wiring block that stood here charged through `createDepartureCheckout`, the hosted
 * builder deleted at 14.5 (issue #793). Its four total assertions were $14.97 low — the hosted
 * builder hardcoded the service fee to 0, so they described a charge Muster never made. The live
 * composed-fare-plus-fee charge is covered on the inline-Elements path in
 * `create-departure-payment-intent.test.ts` ("extra guests bill on top and the fee is on the
 * COMPOSED fare").
 */
import { describe, expect, it } from "vitest";
import {
  GRATUITY_DEFAULT_BPS,
  GRATUITY_TIERS_DEFAULT,
  composeFare,
  effectiveIncludedGuests,
  gratuityCentsFor,
  gratuityKindsFor,
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
  it("gratuityTiersFor reads the offering's pre kind, else the default (12.8)", () => {
    expect(gratuityTiersFor({})).toEqual(GRATUITY_TIERS_DEFAULT);
    expect(
      gratuityTiersFor({
        gratuityKinds: [
          { kind: "pre", tiersBps: [1000, 1800], defaultBps: 1800, required: true },
          { kind: "post", tiersBps: [1500, 2000], defaultBps: 2000, required: false },
        ],
      }),
    ).toEqual([1000, 1800]);
    // A per-kind config WITHOUT a pre entry still offers the default tiers (no dead-end).
    expect(
      gratuityTiersFor({
        gratuityKinds: [{ kind: "post", tiersBps: [1000], defaultBps: 1000, required: false }],
      }),
    ).toEqual(GRATUITY_TIERS_DEFAULT);
    expect(GRATUITY_DEFAULT_BPS).toBe(2000);
  });

  it("gratuityKindsFor defaults to pre-required + post-optional on the standard tiers", () => {
    expect(gratuityKindsFor({})).toEqual([
      { kind: "pre", tiersBps: [1500, 2000, 2500], defaultBps: 2000, required: true },
      { kind: "post", tiersBps: [1500, 2000, 2500], defaultBps: 2000, required: false },
    ]);
    const custom = [{ kind: "pre" as const, tiersBps: [1000], defaultBps: 1000, required: true }];
    expect(gratuityKindsFor({ gratuityKinds: custom })).toEqual(custom);
  });
});

describe("effectiveIncludedGuests — offering count, vessel-cap fallback (12.8)", () => {
  it("uses the OFFERING's includedGuestCount when set", () => {
    expect(effectiveIncludedGuests({ includedGuestCount: 8 }, { coiMaxPax: 16 })).toBe(8);
  });
  it("falls back to the vessel's coiMaxPax when unset (whole boat included, no extras)", () => {
    expect(effectiveIncludedGuests({}, { coiMaxPax: 6 })).toBe(6);
  });
});
