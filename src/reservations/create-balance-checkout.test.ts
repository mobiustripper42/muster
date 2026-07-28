/**
 * 11.2b — the on-demand balance deriver + checkout (DEC-107).
 */
import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Event, Payment, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { balanceOwedCents, type PaymentConfig } from "./payment-config.js";
import { createBalanceCheckout } from "./create-balance-checkout.js";

const EVENT = asId<"EventId">("m-evt-1");
const RES = asId<"ReservationId">("resv-1");
const URLS = { successUrl: "https://x/success", cancelUrl: "https://x/cancel" };

const musterEvent = (over: Partial<Event> = {}): Event => ({
  id: EVENT,
  vesselId: asId<"VesselId">("v"),
  date: "2026-07-04",
  time: "17:00",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  price: 50000, // $500.00
  ...over,
});

const reservation = (over: Partial<Reservation> = {}): Reservation => ({
  id: RES,
  eventId: EVENT,
  source: "muster",
  customerName: "Mary",
  partySize: 6,
  status: "booked",
  ...over,
});

// The deposit that was already collected: 25% of 500 (12500) + full tax (3625) = 16125.
const depositPayment = (over: Partial<Payment> = {}): Payment => ({
  id: asId<"PaymentId">("pay_dep"),
  reservationId: RES,
  method: "stripe",
  kind: "deposit",
  amountCents: 16125,
  taxCents: 3625,
  currency: "usd",
  status: "succeeded",
  createdAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

async function seed(cfg: Partial<PaymentConfig> = { depositMode: "deposit", depositPercent: 25, taxRateBps: 725 }) {
  const repo = new InMemoryRepository();
  await repo.saveEvent(musterEvent());
  await repo.saveReservation(reservation());
  await repo.setPaymentConfig(cfg, "now");
  return repo;
}

describe("balanceOwedCents", () => {
  it("total minus succeeded payments — a deposit leaves the pure principal balance", () => {
    // total = 50000 + 3625 tax = 53625; deposit 16125 paid → 37500 owed (no tax on it)
    expect(balanceOwedCents(50000, 725, [depositPayment()])).toBe(37500);
  });

  it("counts only succeeded — a refunded payment re-opens the balance", () => {
    expect(balanceOwedCents(50000, 725, [depositPayment({ status: "refunded" })])).toBe(53625);
  });

  it("a fully refunded row re-opens the balance even with refundedCents absent", () => {
    // Status wins for the terminal state — a hand-reconciled row may carry no amount, and
    // trusting the amount alone would count refunded money as still paid.
    expect(
      balanceOwedCents(50000, 725, [depositPayment({ status: "refunded", refundedCents: 0 })]),
    ).toBe(53625);
  });

  describe("partial refunds (#522)", () => {
    // A real Elements deposit charge: fare 50000, tax 3625, fee 1500, tip 10000, 25%
    // deposit → amountCents 27625, of which 16125 went toward fare+tax.
    const charged = (over: Partial<Payment> = {}): Payment =>
      depositPayment({
        amountCents: 27625,
        gratuityCents: 10000,
        serviceFeeCents: 1500,
        ...over,
      });

    it("nets nothing while the refund is covered by the tip and fee", () => {
      // THE bug this replaced: attributing the refund to fare+tax first turned a tip-only
      // refund into a $100 re-bill of fare the customer had already paid, and
      // `createBalanceCheckout` would mint that charge with nobody in the loop.
      expect(balanceOwedCents(50000, 725, [charged()])).toBe(37500);
      expect(
        balanceOwedCents(50000, 725, [
          charged({ status: "partially_refunded", refundedCents: 10000 }),
        ]),
      ).toBe(37500); // the whole tip back — fare+tax contribution untouched
      expect(
        balanceOwedCents(50000, 725, [
          charged({ status: "partially_refunded", refundedCents: 11500 }),
        ]),
      ).toBe(37500); // tip AND fee back — still nothing off fare+tax
    });

    it("reduces fare+tax only by the excess over tip and fee", () => {
      expect(
        balanceOwedCents(50000, 725, [
          charged({ status: "partially_refunded", refundedCents: 12500 }),
        ]),
      ).toBe(38500); // 1000 past the 11500 of tip+fee → 1000 more owed
    });

    it("a refund of the whole charge leaves the full balance, never more", () => {
      // The floor: netting tip+fee a second time would push the contribution negative and
      // inflate the balance past the total.
      expect(
        balanceOwedCents(50000, 725, [
          charged({ status: "partially_refunded", refundedCents: 27625 }),
        ]),
      ).toBe(53625);
      expect(
        balanceOwedCents(50000, 725, [
          charged({ status: "partially_refunded", refundedCents: 999999 }),
        ]),
      ).toBe(53625);
    });

    it("nets a refund on a still-succeeded row (status and amount can disagree)", () => {
      expect(
        balanceOwedCents(50000, 725, [charged({ refundedCents: 12500 })]),
      ).toBe(38500);
    });
  });

  it("zero when paid in full; negative when overpaid", () => {
    expect(balanceOwedCents(50000, 725, [depositPayment({ amountCents: 53625 })])).toBe(0);
    expect(
      balanceOwedCents(50000, 725, [depositPayment(), depositPayment({ id: asId<"PaymentId">("pay_2"), kind: "balance", amountCents: 40000 })]),
    ).toBe(-2500); // 16125 + 40000 = 56125 > 53625
  });
});

describe("createBalanceCheckout", () => {
  it("opens a checkout for the outstanding balance, purpose=balance, zero tax", async () => {
    const repo = await seed();
    await repo.savePayment(depositPayment());
    const pay = new FakePaymentPort();

    const r = await createBalanceCheckout(repo, pay, RES, URLS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amountCents).toBe(37500);
    expect(pay.created[0]!.amountCents).toBe(37500);
    expect(pay.created[0]!.taxCents).toBe(0);
    expect(pay.created[0]!.metadata).toMatchObject({ purpose: "balance", reservationId: "resv-1", taxCents: "0" });
  });

  it("computes from actual payments, not the config — no drift when depositPercent changes", async () => {
    const repo = await seed();
    await repo.savePayment(depositPayment()); // 16125 was actually collected at 25%
    // Operator later cranks the deposit to 60% — the balance MUST still be 53625−16125.
    await repo.setPaymentConfig({ depositPercent: 60 }, "now");
    const r = await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS);
    expect(r.ok && r.amountCents).toBe(37500);
  });

  it("no_balance once paid in full", async () => {
    const repo = await seed();
    await repo.savePayment(depositPayment({ amountCents: 53625 }));
    expect(await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS)).toMatchObject({ reason: "no_balance" });
  });

  it("reservation_missing when it doesn't exist", async () => {
    const repo = new InMemoryRepository();
    await repo.setPaymentConfig({ depositMode: "deposit", depositPercent: 25, taxRateBps: 725 }, "now");
    expect(await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS)).toMatchObject({ reason: "reservation_missing" });
  });

  it("not_active when the reservation is cancelled", async () => {
    const repo = await seed();
    await repo.saveReservation(reservation({ status: "cancelled" }));
    expect(await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS)).toMatchObject({ reason: "not_active" });
  });

  it("unpriced when the event has no price", async () => {
    const repo = new InMemoryRepository();
    const { price: _p, ...noPrice } = musterEvent();
    await repo.saveEvent(noPrice);
    await repo.saveReservation(reservation());
    await repo.setPaymentConfig({ depositMode: "deposit", depositPercent: 25, taxRateBps: 725 }, "now");
    expect(await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS)).toMatchObject({ reason: "unpriced" });
  });
});

// #474 (DEC-107 amend) — the balance must bill the composed party fare (base + frozen extras),
// not the bare Event.price base. Scenario: base 50000 + extras 6000 (2 guests over the included
// count) = fare 56000; 7.25% tax on the FULL fare = 4060; a 20% tip = 11200. Deposit at 25% =
// round(0.25·56000) + tax + tip = 14000 + 4060 + 11200 = 29260 (gratuity 11200 bundled in).
// total = 56000 + 4060 = 60060; paid (tip netted, DEC-124) = 29260 − 11200 = 18060;
// balance = 42000 = the remaining 75% of the FULL fare (tax + tip both net out).
describe("balance composes the party fare — includes frozen extras (#474)", () => {
  const depositWithExtras = (over: Partial<Payment> = {}): Payment => ({
    id: asId<"PaymentId">("pay_dep_x"),
    reservationId: RES,
    method: "stripe",
    kind: "deposit",
    amountCents: 29260,
    taxCents: 4060,
    gratuityCents: 11200,
    currency: "usd",
    status: "succeeded",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  });

  it("balanceOwedCents on the fare returns the remaining 75%, tax and tip netted", () => {
    // fare = base 50000 + extras 6000; base ALONE would undercollect by extras + tax(extras) = 6435.
    expect(balanceOwedCents(56000, 725, [depositWithExtras()])).toBe(42000);
    expect(balanceOwedCents(50000, 725, [depositWithExtras()])).toBe(35565); // the #474 bug value
  });

  it("createBalanceCheckout adds the reservation's frozen extras to the base", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent()); // price 50000 base
    await repo.saveReservation(reservation({ extrasCents: 6000 }));
    await repo.setPaymentConfig({ depositMode: "deposit", depositPercent: 25, taxRateBps: 725 }, "now");
    await repo.savePayment(depositWithExtras());

    const r = await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS);
    expect(r.ok && r.amountCents).toBe(42000); // NOT 35565 — the extras are billed
  });

  it("a reservation with no extras (Xola/legacy/pre-12.2) reads extrasCents as 0 — bare base", async () => {
    const repo = await seed();
    await repo.savePayment(depositPayment()); // the base-only deposit
    const r = await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS);
    expect(r.ok && r.amountCents).toBe(37500); // unchanged from the base-only path
  });
});
