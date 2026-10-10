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
  cancellationTerms,
  cancellationTermsShort,
  FLEX_CANCEL_HOURS_BEFORE,
  FLEX_INSURANCE_CENTS,
  insuranceHint,
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

describe("refundOwedCents — cancellation insurance (operator, 2026-10-09)", () => {
  // $499 + $30 insurance paid. Insurance moves the line to 72 hours, takes no $50, and keeps itself.
  const insured = { paidCents: 52900, insurance: { chargedCents: 3000 } };

  it("72 hours or more out: everything paid back except the insurance — no $50 fee", () => {
    expect(refundOwedCents({ ...insured, hoursBeforeDeparture: 100 })).toBe(49900);
    expect(refundOwedCents({ ...insured, hoursBeforeDeparture: 500 })).toBe(49900);
  });

  it("treats exactly 72 hours out as refundable, and an hour less as not", () => {
    expect(refundOwedCents({ ...insured, hoursBeforeDeparture: FLEX_CANCEL_HOURS_BEFORE })).toBe(49900);
    expect(refundOwedCents({ ...insured, hoursBeforeDeparture: FLEX_CANCEL_HOURS_BEFORE - 1 })).toBe(0);
  });

  it("keeps what was charged for the insurance, not its list price — a discounted $20 keeps $20", () => {
    expect(refundOwedCents({ paidCents: 51900, insurance: { chargedCents: 2000 }, hoursBeforeDeparture: 100 })).toBe(49900);
  });

  it("a comped insurance keeps nothing, and a comp paid nothing, so it refunds nothing", () => {
    expect(refundOwedCents({ paidCents: 0, insurance: { chargedCents: 0 }, hoursBeforeDeparture: 100 })).toBe(0);
  });

  it("without insurance, the same 100 hours out is inside 14 days: nothing", () => {
    expect(refundOwedCents({ paidCents: 52900, hoursBeforeDeparture: 100 })).toBe(0);
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
    expect(cancellationTerms(false)).toContain("$50");
    expect(cancellationTerms(false)).toContain("14 days");
  });

  it("states the fee and the window in the SMS clause", () => {
    expect(cancellationTermsShort(false)).toContain("$50");
    expect(cancellationTermsShort(false)).toContain("14");
  });

  it("keeps the SMS clause inside the second segment's slack, with or without insurance", () => {
    // bookingConfirmationBody ships VERBATIM as SMS and runs ~210 chars without this clause.
    // GSM-7 concatenated segments are 153, so anything under ~90 keeps the confirmation at
    // two segments — the clause is free. Longer buys a third on every booking.
    expect(cancellationTermsShort(false).length).toBeLessThanOrEqual(90);
    expect(cancellationTermsShort(true).length).toBeLessThanOrEqual(90);
  });

  it("promises a full refund when WE cancel", () => {
    expect(cancellationTerms(false).toLowerCase()).toContain("full refund");
    expect(cancellationTerms(true).toLowerCase()).toContain("full refund");
  });
});

describe("the copy picks the window the booking bought (16.8)", () => {
  it("without insurance: the 14-day terms, and the fourth sentence offering it", () => {
    expect(cancellationTerms(false)).toBe(
      "Cancel 14 days or more before your cruise for a refund minus a $50 cancellation fee. " +
        "Cancellations less than 14 days out are non-refundable, as are no-shows. If we cancel for " +
        "inclement weather, you'll receive a full refund. Optional cancellation insurance ($30) " +
        "moves the 14 days to 72 hours.",
    );
  });

  it("with insurance: 72 hours, a full refund less the insurance, no fee, and no offer of what they have", () => {
    expect(cancellationTerms(true)).toBe(
      "Cancel 72 hours or more before your cruise for a full refund, less the $30 insurance. " +
        "Cancellations less than 72 hours out are non-refundable, as are no-shows. If we cancel for " +
        "inclement weather, you'll receive a full refund.",
    );
    expect(cancellationTerms(true)).not.toContain("$50");
  });

  it("the line under the insurance box, for whoever is reading it", () => {
    expect(insuranceHint("customer")).toBe(
      "Cancel up to 72 hours before your cruise instead of 14 days, with no cancellation fee.",
    );
    expect(insuranceHint("operator")).toBe("Ask them — it's $30 and moves their cancel window to 72 hours.");
  });

  it("the SMS clause: 14 days, or 72 hours", () => {
    expect(cancellationTermsShort(false)).toBe("Cancel 14+ days out for a refund minus a $50 fee.");
    expect(cancellationTermsShort(true)).toBe("Cancel 72+ hours out for a refund less the $30 insurance.");
  });
});
