/**
 * `totalsFor` — the pay bar's and the summary's figures — must be exactly what `priceBooking`
 * freezes, with and without cancellation insurance (16.8), at every tip tier. The fee moves with the
 * tip and the insurance and the tax moves with the insurance (DEC-196), so the screen re-totals
 * through the core's `chargeTotals` rather than adding them on top.
 */
import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "@core/adapters/fake-payment.js";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Offering, Vessel } from "@core/domain/entities.js";
import { asId } from "@core/domain/ids.js";
import { priceBooking } from "@core/reservations/booking-invoice.js";
import { checkoutQuote } from "@core/reservations/checkout-quote.js";
import { createDeparturePaymentIntent } from "@core/reservations/create-departure-payment-intent.js";
import { applyDiscount } from "@core/reservations/discount.js";
import { payLinkMoney } from "@core/reservations/pay-by-link.js";
import { PAYMENT_CONFIG_DEFAULTS, type PaymentConfig } from "@core/reservations/payment-config.js";
import { depositCopy, elementsOptions, totalsFor } from "./money";

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
const FULL: PaymentConfig = { ...PAYMENT_CONFIG_DEFAULTS, taxRateBps: 725 };
/** Since issue #1250 the deposit is a fixed sum, and only a clock outside the balance window turns
 *  it on. `input`'s departure is 2026-07-04 15:30; this is 33 days before it. */
const DEPOSIT: PaymentConfig = FULL;
const OUTSIDE_WINDOW = "2026-06-01T12:00:00.000Z";

describe("totalsFor on the public checkout", () => {
  for (const [label, config] of [["full", FULL], ["deposit", DEPOSIT]] as const) {
    for (const hasFlex of [false, true]) {
      it(`${label}, insurance ${hasFlex ? "ticked" : "not ticked"}: every tier equals the invoice that gets charged`, () => {
        const deposit = label === "deposit";
        const q = deposit ? checkoutQuote(input(config), OUTSIDE_WINDOW) : checkoutQuote(input(config));
        for (const tier of q.tiers) {
          const inv = priceBooking({
            ...input(config),
            gratuityBps: tier.bps,
            hasFlex,
            ...(deposit ? { deposit: { asOf: OUTSIDE_WINDOW, chosen: true } } : {}),
          });
          expect(totalsFor(q, tier.tipCents, hasFlex ? q.flexCents : 0, deposit)).toEqual({
            tipCents: inv.gratuityCents,
            flexCents: inv.flexCents ?? 0,
            taxCents: inv.taxCents,
            serviceFeeCents: inv.serviceFeeCents,
            totalCents: inv.totalCents,
            dueNowCents: inv.amountDueNowCents,
            balanceCents: inv.totalCents - inv.amountDueNowCents,
          });
        }
      });
    }
  }
});

/**
 * The screen's figures equal the charge (issue #1250): what the pay bar says is due now and what
 * the summary says is left are what `priceBooking` freezes for the same answers — every tip tier,
 * insurance or not, the deposit chosen or not. The last case is a deposit set above the quote, where
 * both sides must fall back to the whole quote through the same `dueNowCents`.
 */
describe("the deposit on screen is the deposit charged", () => {
  const CASES: [string, PaymentConfig][] = [
    ["the $100 deposit", FULL],
    ["a deposit above the quote", { ...FULL, depositCents: 100000 }],
  ];
  for (const [label, config] of CASES) {
    for (const payDeposit of [true, false]) {
      for (const hasFlex of [false, true]) {
        it(`AC13: ${label}, ${payDeposit ? "deposit chosen" : "pay in full"}, insurance ${hasFlex ? "ticked" : "not ticked"}: due now and balance equal the frozen invoice at every tier`, () => {
          const q = checkoutQuote(input(config), OUTSIDE_WINDOW);
          for (const tier of q.tiers) {
            const inv = priceBooking({
              ...input(config),
              gratuityBps: tier.bps,
              hasFlex,
              deposit: { asOf: OUTSIDE_WINDOW, chosen: payDeposit },
            });
            const t = totalsFor(q, tier.tipCents, hasFlex ? q.flexCents : 0, payDeposit);
            expect(t.dueNowCents).toBe(inv.amountDueNowCents);
            expect(t.balanceCents).toBe(inv.totalCents - inv.amountDueNowCents);
          }
        });
      }
    }
  }
});

/**
 * The pin above says the screen and the invoice agree. This one posts the screen's figure through
 * the real write (issue #1217): a refusal that compared the wrong field, or rounded apart from the
 * page, would turn away every honest checkout, and deposit mode is where due-now and the total part.
 */
describe("the total the page shows goes through the real write", () => {
  // `offering` runs Sundays (Mon-0 weekdays), and this is well outside insurance's 72 hours.
  const SUNDAY = "2026-07-05";
  const weeksBefore = () => "2026-06-01T12:00:00.000Z";

  for (const [label, config] of [["full", FULL], ["deposit", DEPOSIT]] as const) {
    for (const hasFlex of [false, true]) {
      it(`AC1: ${label}, insurance ${hasFlex ? "ticked" : "not ticked"}: every tier's shown total is charged, not refused`, async () => {
        // "deposit" is the deposit chosen, 34 days out — outside the balance window (issue #1250).
        const payDeposit = label === "deposit";
        const q = checkoutQuote({ ...input(config), date: SUNDAY }, weeksBefore());
        for (const tier of q.tiers) {
          const repo = new InMemoryRepository();
          await repo.saveOffering(offering);
          await repo.saveVessel(vessel);
          await repo.setPaymentConfig(config, weeksBefore());
          const pay = new FakePaymentPort();
          const t = totalsFor(q, tier.tipCents, hasFlex ? q.flexCents : 0, payDeposit);
          const shown = t.dueNowCents;

          const r = await createDeparturePaymentIntent(
            repo,
            pay,
            {
              offeringId: offering.id,
              date: SUNDAY,
              time: "15:30",
              guestCount: 11,
              gratuityBps: tier.bps,
              hasFlex,
              customerName: "Mary",
              shownDueNowCents: shown,
              payDeposit,
              shownBalanceCents: t.balanceCents,
            },
            weeksBefore,
          );

          expect(r.ok).toBe(true);
          expect(pay.intents[0]!.amountCents).toBe(shown);
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

/**
 * The payment choice and the terms box's last line (issue #1250) — `depositCopy` is the seam: the
 * form renders its strings, and shows `termsLine` only while Pay deposit is chosen. The wording is
 * new in this task, so it is typed here once rather than read from anywhere.
 *
 * SPEC §2.8.4a's worked example, departing Wed, Nov 11 at 15:30, with the balance due 30 days before:
 * $652.94, a $100 deposit, $552.94 on Mon, Oct 12.
 */
describe("depositCopy", () => {
  const NOV_11 = { ...input(FULL), date: "2026-11-11", guestCount: 2 };
  const OCT_1 = "2026-10-01T12:00:00.000Z";
  const TIP_20 = 9980;
  const quoteAt = (config: PaymentConfig, asOf: string) => checkoutQuote({ ...NOV_11, config }, asOf);

  it("AC16: a deposit offered reads Pay deposit · $100.00, the balance and its day under it, and Pay in full · $652.94", () => {
    const m = quoteAt(FULL, OCT_1);
    expect(depositCopy(m, totalsFor(m, TIP_20, 0, true))).toMatchObject({
      depositLabel: "Pay deposit · $100.00",
      depositNote: "$552.94 charged to this card on Mon, Oct 12",
      fullLabel: "Pay in full · $652.94",
    });
  });

  it("AC16: with Pay in full chosen the choice still states the deposit's balance", () => {
    const m = quoteAt(FULL, OCT_1);
    expect(depositCopy(m, totalsFor(m, TIP_20, 0, false))).toEqual(depositCopy(m, totalsFor(m, TIP_20, 0, true)));
    expect(depositCopy(m, totalsFor(m, TIP_20, 0, false))?.depositNote).toBe("$552.94 charged to this card on Mon, Oct 12");
  });

  it("AC16: inside the balance window no choice is offered", () => {
    const m = quoteAt(FULL, "2026-10-20T12:00:00.000Z");
    expect(depositCopy(m, totalsFor(m, TIP_20, 0, true))).toBeNull();
  });

  it("AC16: a quote at or below the deposit is offered no choice", () => {
    const config = { ...FULL, depositCents: 65294 };
    const m = quoteAt(config, OCT_1);
    expect(depositCopy(m, totalsFor(m, TIP_20, 0, true))).toBeNull();
  });

  it("AC14: the terms box's last line names the balance and the day it is charged", () => {
    const m = quoteAt(FULL, OCT_1);
    expect(depositCopy(m, totalsFor(m, TIP_20, 0, true))?.termsLine).toBe(
      "We'll charge the balance of $552.94 to this card on Mon, Oct 12.",
    );
  });

  it("AC14: the amount is the quote's — insurance moves it", () => {
    // $499 + tax $38.35 + fee $18.86 + tip $99.80 + insurance $30 = $686.01, less the $100 deposit.
    const m = quoteAt(FULL, OCT_1);
    expect(depositCopy(m, totalsFor(m, TIP_20, m.flexCents, true))?.termsLine).toBe(
      "We'll charge the balance of $586.01 to this card on Mon, Oct 12.",
    );
  });
});

/**
 * The payment form's options (issue #1250, from review 2026-11-10) — one home, so the `<Elements>`
 * the form mounts and the intent the server mints agree. Stripe's deferred Elements docs:
 * `setupFutureUsage` "should match the setup_future_usage provided on the Intent used when
 * confirming payment". With the deposit the form offers cards only; pay in full keeps today's methods.
 */
describe("elementsOptions", () => {
  it("AC9: with the deposit chosen the form saves the card for later and offers cards only", () => {
    expect(elementsOptions(10000, true)).toEqual({
      mode: "payment",
      amount: 10000,
      currency: "usd",
      setupFutureUsage: "off_session",
      paymentMethodTypes: ["card"],
    });
  });

  it("AC15: with pay in full the form saves nothing and keeps the methods it shows today", () => {
    expect(elementsOptions(65294, false)).toEqual({ mode: "payment", amount: 65294, currency: "usd" });
  });
});
