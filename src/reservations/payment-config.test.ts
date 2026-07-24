/**
 * Payment-config money math (DEC-107 / DEC-134) — pins the fee formula and the
 * deposit→balance arithmetic so the service fee can never be charged twice or leak into
 * the balance. Pure functions only; the builders/webhook are covered by their own suites.
 */
import { describe, expect, it } from "vitest";
import {
  balanceOwedCents,
  chargeNowCents,
  feeCentsFor,
  taxCentsFor,
  PAYMENT_CONFIG_DEFAULTS,
  type PaymentConfig,
} from "./payment-config.js";

const cfg = (over: Partial<PaymentConfig> = {}): PaymentConfig => ({
  ...PAYMENT_CONFIG_DEFAULTS,
  ...over,
});

describe("feeCentsFor (DEC-134)", () => {
  it("is serviceFeeBps of the fare, rounded half-up, integer cents", () => {
    expect(feeCentsFor(49900, 300)).toBe(1497); // 3% of $499.00
    expect(feeCentsFor(57900, 300)).toBe(1737); // 3% of $579.00 (mockup's $17.37)
    expect(feeCentsFor(10001, 300)).toBe(300); // 300.03 → 300
    expect(feeCentsFor(10050, 300)).toBe(302); // 301.5 rounds half-up
    expect(feeCentsFor(0, 300)).toBe(0);
    expect(feeCentsFor(49900, 0)).toBe(0); // fee disabled
  });

  it("default rate is 300 bps (3%)", () => {
    expect(PAYMENT_CONFIG_DEFAULTS.serviceFeeBps).toBe(300);
  });
});

describe("chargeNowCents with the service fee (DEC-134)", () => {
  it("full mode: fare + tax + fee, one charge", () => {
    expect(chargeNowCents(49900, 3618, 1497, cfg({ depositMode: "full" }))).toBe(55015);
  });

  it("deposit mode: deposit share of the fare + FULL tax + FULL fee", () => {
    // 25% of 49900 = 12475; tax + fee ride the deposit charge in full.
    expect(
      chargeNowCents(49900, 3618, 1497, cfg({ depositMode: "deposit", depositPercent: 25 })),
    ).toBe(12475 + 3618 + 1497);
  });

  it("fee of 0 preserves the pre-DEC-134 charge (the hosted builders' path)", () => {
    expect(chargeNowCents(49900, 3618, 0, cfg({ depositMode: "full" }))).toBe(53518);
  });
});

describe("deposit→balance arithmetic (the DEC-134 no-second-fee pin)", () => {
  // One deposit-mode booking, walked end to end: the deposit charge carries the fare
  // share + FULL tax + FULL fee + FULL gratuity; the balance is the remaining fare
  // ONLY (tax was fully collected, fee is one-shot, tip is crew money).
  const fare = 49900;
  const taxRateBps = 725;
  const tax = taxCentsFor(fare, taxRateBps); // 3618
  const fee = feeCentsFor(fare, 300); // 1497
  const gratuity = 9980; // 20% of the fare
  const config = cfg({ depositMode: "deposit", depositPercent: 25, taxRateBps });

  it("deposit = fareShare + fullTax + fullFee + fullGratuity", () => {
    const depositCharge = chargeNowCents(fare, tax, fee, config) + gratuity;
    expect(depositCharge).toBe(12475 + 3618 + 1497 + 9980); // 27570
  });

  it("balance = remaining fare only — no second fee, no second tax, no tip", () => {
    const depositCharge = chargeNowCents(fare, tax, fee, config) + gratuity;
    const owed = balanceOwedCents(fare, taxRateBps, [
      {
        status: "succeeded",
        amountCents: depositCharge,
        gratuityCents: gratuity,
        serviceFeeCents: fee,
      },
    ]);
    // total (fare + tax) − netted deposit (fareShare + tax) = remaining fare share.
    expect(owed).toBe(fare - 12475); // 37425 — pure remaining principal
    // And paying exactly that closes the balance to zero: Σ fee across all charges = ONE fee.
    const closed = balanceOwedCents(fare, taxRateBps, [
      { status: "succeeded", amountCents: depositCharge, gratuityCents: gratuity, serviceFeeCents: fee },
      { status: "succeeded", amountCents: owed },
    ]);
    expect(closed).toBe(0);
  });

  it("a fee-less legacy payment nets exactly as before (serviceFeeCents absent ⇒ 0)", () => {
    const owed = balanceOwedCents(fare, taxRateBps, [
      { status: "succeeded", amountCents: 12475 + tax },
    ]);
    expect(owed).toBe(fare - 12475);
  });
});
