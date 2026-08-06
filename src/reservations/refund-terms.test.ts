/**
 * Cancellation terms (#619) — pins the operator's published policy as code, and pins the
 * customer-facing copy to the SAME constants it quotes.
 *
 * The copy assertions are the ones that bite. A dollar figure typed into a sentence is a
 * second source of truth that no type checks and no test catches when the fee moves; these
 * fail the moment the prose and the constant disagree.
 */
import { describe, expect, it } from "vitest";
import {
  CANCELLATION_FEE_CENTS,
  CANCELLATION_TERMS,
  CANCELLATION_TERMS_SHORT,
  FLEX_CANCEL_HOURS_BEFORE,
  FLEX_INSURANCE_CENTS,
  STANDARD_CANCEL_DAYS_BEFORE,
  operatorCancelRefundCents,
  refundOwedCents,
} from "./refund-terms.js";

const HOURS_PER_DAY = 24;
const standardWindow = STANDARD_CANCEL_DAYS_BEFORE * HOURS_PER_DAY; // 336h

describe("the published policy, as constants", () => {
  it("is the operator's numbers (2026-08-06)", () => {
    expect(CANCELLATION_FEE_CENTS).toBe(5000); // $50
    expect(FLEX_INSURANCE_CENTS).toBe(3000); // $30
    expect(STANDARD_CANCEL_DAYS_BEFORE).toBe(14);
    expect(FLEX_CANCEL_HOURS_BEFORE).toBe(72);
  });
});

describe("refundOwedCents — customer cancels, no flex insurance", () => {
  it("refunds what was paid minus the fee, outside the 14-day window", () => {
    expect(refundOwedCents({ paidCents: 49900, hoursBeforeDeparture: 500 })).toBe(44900);
  });

  it("treats exactly 14 days out as refundable — the boundary favours the customer", () => {
    expect(refundOwedCents({ paidCents: 49900, hoursBeforeDeparture: standardWindow })).toBe(44900);
    expect(refundOwedCents({ paidCents: 49900, hoursBeforeDeparture: standardWindow - 1 })).toBe(0);
  });

  it("refunds nothing inside the window — 'less than 14 days ... are non-refundable'", () => {
    expect(refundOwedCents({ paidCents: 49900, hoursBeforeDeparture: 100 })).toBe(0);
    expect(refundOwedCents({ paidCents: 49900, hoursBeforeDeparture: 0 })).toBe(0);
  });

  it("refunds nothing for a no-show — departure already past", () => {
    expect(refundOwedCents({ paidCents: 49900, hoursBeforeDeparture: -3 })).toBe(0);
  });

  it("floors at zero when the fee exceeds what was paid", () => {
    // A 25% deposit on a $160 booking is $40 — less than the $50 fee. Never negative,
    // and never an accidental charge dressed up as a refund.
    expect(refundOwedCents({ paidCents: 4000, hoursBeforeDeparture: 500 })).toBe(0);
    expect(refundOwedCents({ paidCents: 0, hoursBeforeDeparture: 500 })).toBe(0);
  });

  it("returns integer cents (DEC-112) — never a float", () => {
    const r = refundOwedCents({ paidCents: 49900, hoursBeforeDeparture: 500 });
    expect(Number.isInteger(r)).toBe(true);
  });
});

describe("refundOwedCents — flex insurance moves the line to 72 hours", () => {
  it("still refunds minus the fee inside 14 days but outside 72 hours", () => {
    expect(refundOwedCents({ paidCents: 49900, hoursBeforeDeparture: 100, hasFlex: true })).toBe(
      44900,
    );
  });

  it("treats exactly 72 hours out as refundable", () => {
    expect(
      refundOwedCents({
        paidCents: 49900,
        hoursBeforeDeparture: FLEX_CANCEL_HOURS_BEFORE,
        hasFlex: true,
      }),
    ).toBe(44900);
    expect(
      refundOwedCents({
        paidCents: 49900,
        hoursBeforeDeparture: FLEX_CANCEL_HOURS_BEFORE - 1,
        hasFlex: true,
      }),
    ).toBe(0);
  });

  it("does not make the booking free to cancel — the $50 fee still applies", () => {
    expect(refundOwedCents({ paidCents: 49900, hoursBeforeDeparture: 500, hasFlex: true })).toBe(
      44900,
    );
  });
});

describe("operatorCancelRefundCents — weather, crew, mechanical", () => {
  it("returns everything paid, with no fee, at any notice", () => {
    expect(operatorCancelRefundCents(49900)).toBe(49900);
    expect(operatorCancelRefundCents(4000)).toBe(4000);
    expect(operatorCancelRefundCents(0)).toBe(0);
  });
});

describe("the copy quotes the constants, not hardcoded dollars", () => {
  it("states the fee and the window in the long form", () => {
    expect(CANCELLATION_TERMS).toContain("$50");
    expect(CANCELLATION_TERMS).toContain("14 days");
  });

  it("states the fee and the window in the SMS clause", () => {
    expect(CANCELLATION_TERMS_SHORT).toContain("$50");
    expect(CANCELLATION_TERMS_SHORT).toContain("14");
  });

  it("keeps the SMS clause to about one segment", () => {
    // bookingConfirmationBody ships VERBATIM as SMS, and the `— Muster` sign-off's em dash
    // forces the whole body to UCS-2 — 67 chars per concatenated segment, not 153. One
    // segment's worth is the budget for the part this file controls.
    expect(CANCELLATION_TERMS_SHORT.length).toBeLessThanOrEqual(67);
  });

  it("never advertises flex insurance — it cannot be bought yet (#683)", () => {
    expect(CANCELLATION_TERMS.toLowerCase()).not.toContain("insurance");
    expect(CANCELLATION_TERMS_SHORT.toLowerCase()).not.toContain("insurance");
  });

  it("promises a full refund when WE cancel", () => {
    expect(CANCELLATION_TERMS.toLowerCase()).toContain("full refund");
  });
});
