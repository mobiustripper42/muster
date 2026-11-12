/**
 * 11.2b — the on-demand balance deriver + checkout (DEC-107).
 */
import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { BookingInvoice, Event, Payment, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { balanceOwedCents, type PaymentConfig } from "./payment-config.js";
import { buildReservationDetail } from "./calendar-detail.js";
import { createBalanceCheckout } from "./create-balance-checkout.js";
import { buildManageView } from "./manage-view.js";
import { buildPurchaseRows } from "./purchases-view.js";

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

/** What `priceBooking` froze on the $500 trip at 7.25%, no tip and no fee: tax 3625 → 53625. The
 *  balance reads this, not the Event's price (issue #1241). */
const INVOICE: BookingInvoice = {
  fareCents: 50000,
  extrasCents: 0,
  taxCents: 3625,
  taxRateBps: 725,
  serviceFeeCents: 0,
  serviceFeeBps: 0,
  gratuityCents: 0,
  gratuityBps: 0,
  totalCents: 53625,
  amountDueNowCents: 16125,
};

const reservation = (over: Partial<Reservation> = {}): Reservation => ({
  id: RES,
  eventId: EVENT,
  source: "muster",
  customerName: "Mary",
  partySize: 6,
  status: "booked",
  invoice: INVOICE,
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

async function seed(cfg: Partial<PaymentConfig> = { taxRateBps: 725 }) {
  const repo = new InMemoryRepository();
  await repo.saveEvent(musterEvent());
  await repo.saveReservation(reservation());
  await repo.setPaymentConfig(cfg, "now");
  return repo;
}

describe("balanceOwedCents", () => {
  it("total minus succeeded payments — a deposit leaves the pure principal balance", () => {
    // total = 50000 + 3625 tax = 53625; deposit 16125 paid → 37500 owed (no tax on it)
    expect(balanceOwedCents(INVOICE, [depositPayment()])).toBe(37500);
  });

  it("AC3: a fully refunded deposit leaves the balance where it was", () => {
    expect(balanceOwedCents(INVOICE, [depositPayment({ status: "refunded" })])).toBe(37500);
  });

  it("AC3: a fully refunded row leaves the balance alone even with refundedCents absent", () => {
    // Status decides, not the amount: a hand-reconciled row may carry none.
    expect(
      balanceOwedCents(INVOICE, [depositPayment({ status: "refunded", refundedCents: 0 })]),
    ).toBe(37500);
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
      expect(balanceOwedCents(INVOICE, [charged()])).toBe(37500);
      expect(
        balanceOwedCents(INVOICE, [
          charged({ status: "partially_refunded", refundedCents: 10000 }),
        ]),
      ).toBe(37500); // the whole tip back — fare+tax contribution untouched
      expect(
        balanceOwedCents(INVOICE, [
          charged({ status: "partially_refunded", refundedCents: 11500 }),
        ]),
      ).toBe(37500); // tip AND fee back — still nothing off fare+tax
    });

    it("AC3: a refund past the tip and fee leaves the balance alone", () => {
      expect(
        balanceOwedCents(INVOICE, [
          charged({ status: "partially_refunded", refundedCents: 15000 }),
        ]),
      ).toBe(37500); // 3500 past the 11500 of tip+fee; the old rule said 41000
    });

    it("AC3: a refund of the whole charge leaves the balance alone, in either status", () => {
      expect(
        balanceOwedCents(INVOICE, [
          charged({ status: "partially_refunded", refundedCents: 27625 }),
        ]),
      ).toBe(37500);
      expect(
        balanceOwedCents(INVOICE, [charged({ status: "refunded", refundedCents: 27625 })]),
      ).toBe(37500);
    });

    it("AC3: a refund on a still-succeeded row leaves the balance alone (status and amount can disagree)", () => {
      expect(
        balanceOwedCents(INVOICE, [charged({ refundedCents: 12500 })]),
      ).toBe(37500);
    });
  });

  it("zero when paid in full; negative when overpaid", () => {
    expect(balanceOwedCents(INVOICE, [depositPayment({ amountCents: 53625 })])).toBe(0);
    expect(
      balanceOwedCents(INVOICE, [depositPayment(), depositPayment({ id: asId<"PaymentId">("pay_2"), kind: "balance", amountCents: 40000 })]),
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
    // Operator later raises the deposit to $600 — the balance MUST still be 53625−16125.
    await repo.setPaymentConfig({ depositCents: 60000 }, "now");
    const r = await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS);
    expect(r.ok && r.amountCents).toBe(37500);
  });

  it("no_balance once paid in full", async () => {
    const repo = await seed();
    await repo.savePayment(depositPayment({ amountCents: 53625 }));
    expect(await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS)).toMatchObject({ reason: "no_balance" });
  });

  it("REFUSES to mint a balance charge against a disputed payment (issue #723)", async () => {
    // The trap this guard exists for: `tookMoney` excludes a disputed row, so `owed` above
    // jumps back to the FULL amount and from this function's side a balance is genuinely due.
    // Minting it bills the customer again for money their bank is already clawing back, which
    // turns one dispute into two. Same shape as the refund guard #616 added, arrived at from
    // the other direction — a chargeback sets no `refundedCents`, so nothing else catches it.
    const repo = await seed();
    await repo.savePayment(depositPayment());
    // Sanity: a balance IS owed here, so the refusal below is the guard and not an accident.
    expect(await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS)).toMatchObject({
      ok: true,
    });

    await repo.markPaymentDisputed(asId<"PaymentId">("pay_dep"), "disputed");
    expect(await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS)).toMatchObject({
      reason: "disputed",
    });
  });

  it("REFUSES after a dispute we lost, too", async () => {
    const repo = await seed();
    await repo.savePayment(depositPayment());
    await repo.markPaymentDisputed(asId<"PaymentId">("pay_dep"), "dispute_lost");
    expect(await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS)).toMatchObject({
      reason: "disputed",
    });
  });

  it("mints again once a dispute is WON — the money is back and the balance is real", async () => {
    const repo = await seed();
    await repo.savePayment(depositPayment());
    await repo.markPaymentDisputed(asId<"PaymentId">("pay_dep"), "disputed");
    await repo.markPaymentDisputed(asId<"PaymentId">("pay_dep"), "succeeded");
    expect(await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS)).toMatchObject({
      ok: true,
    });
  });

  it("reservation_missing when it doesn't exist", async () => {
    const repo = new InMemoryRepository();
    await repo.setPaymentConfig({ taxRateBps: 725 }, "now");
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
    await repo.setPaymentConfig({ taxRateBps: 725 }, "now");
    expect(await createBalanceCheckout(repo, new FakePaymentPort(), RES, URLS)).toMatchObject({ reason: "unpriced" });
  });
});

// Issue #841 — a refund on a booking still going ahead lowers the price and the amount paid
// together, so it never raises the balance. The fixture is the `db:seed:self-cancel` booking, a
// booking paid in full: fare 49900 + tax 3618 + tip 9980 + fee 1796 = 65294. The refund must be
// larger than tip + fee (11776), or the old rule passes too: the part past them is what it counted
// as fare no longer paid.
describe("a refund never raises the balance (issue #841)", () => {
  const FARE = 49900;
  const TAX_BPS = 725;
  const FARE_AND_TAX = 53518;
  const PAID_IN_FULL: BookingInvoice = {
    fareCents: FARE,
    extrasCents: 0,
    taxCents: 3618,
    taxRateBps: TAX_BPS,
    serviceFeeCents: 1796,
    serviceFeeBps: 300,
    gratuityCents: 9980,
    gratuityBps: 2000,
    totalCents: 65294,
    amountDueNowCents: 65294,
  };

  const paidInFull = (over: Partial<Payment> = {}): Payment => ({
    id: asId<"PaymentId">("pay_full"),
    reservationId: RES,
    method: "stripe",
    kind: "full",
    amountCents: 65294,
    taxCents: 3618,
    gratuityCents: 9980,
    serviceFeeCents: 1796,
    currency: "usd",
    status: "succeeded",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  });

  const refunded200 = () => paidInFull({ status: "partially_refunded", refundedCents: 20000 });

  async function fullyPaidBooking(payment: Payment) {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent({ price: FARE }));
    await repo.saveReservation(reservation({ invoice: PAID_IN_FULL }));
    await repo.setPaymentConfig({ taxRateBps: TAX_BPS }, "now");
    await repo.savePayment(payment);
    return repo;
  }

  const detailInput = () => ({
    reservation: reservation({ invoice: PAID_IN_FULL }),
    event: musterEvent({ price: FARE }),
    payments: [refunded200()],
    gratuities: [],
  });

  it("AC1: a $200 refund on a booking paid in full still owes 0", () => {
    expect(balanceOwedCents(PAID_IN_FULL, [paidInFull()])).toBe(0);
    expect(balanceOwedCents(PAID_IN_FULL, [refunded200()])).toBe(0);
  });

  it("AC2: a booking refunded in full still owes 0 — the row counts at its gross amount", () => {
    expect(
      balanceOwedCents(PAID_IN_FULL, [paidInFull({ status: "refunded", refundedCents: 65294 })]),
    ).toBe(0);
  });

  it.each(["disputed", "dispute_lost"] as const)(
    "AC4: a %s row contributes nothing, so the whole fare + tax is owed",
    (status) => {
      expect(balanceOwedCents(PAID_IN_FULL, [paidInFull({ status })])).toBe(FARE_AND_TAX);
    },
  );

  it.each(["disputed", "dispute_lost"] as const)(
    "AC4: createBalanceCheckout refuses a booking paid in full and now %s",
    async (status) => {
      // A full payment, not the deposit the #723 tests use: if a dispute counted as money this
      // booking would owe nothing and answer `no_balance`, where a deposit would still say
      // `disputed`.
      const repo = await fullyPaidBooking(paidInFull({ status }));
      const pay = new FakePaymentPort();
      expect(await createBalanceCheckout(repo, pay, RES, URLS)).toEqual({
        ok: false,
        reason: "disputed",
      });
      expect(pay.created).toHaveLength(0);
    },
  );

  it("AC5: createBalanceCheckout has nothing to charge after the refund, and opens no session", async () => {
    const repo = await fullyPaidBooking(refunded200());
    const pay = new FakePaymentPort();
    expect(await createBalanceCheckout(repo, pay, RES, URLS)).toEqual({
      ok: false,
      reason: "no_balance",
    });
    expect(pay.created).toHaveLength(0);
  });

  it("AC6: buildReservationDetail shows no balance after the refund", () => {
    expect(buildReservationDetail(detailInput()).money.balanceCents).toBe(0);
  });

  it("AC6: buildManageView still reads paid in full after the refund", () => {
    const v = buildManageView({ ...detailInput(), now: { date: "2026-06-01", time: "09:00" } });
    expect(v.paidInFull).toBe(true);
  });

  it("AC6: buildPurchaseRows shows no balance after the refund, and the state stays refunded", () => {
    const [row] = buildPurchaseRows({
      reservations: [reservation({ invoice: PAID_IN_FULL })],
      eventsById: new Map([[String(EVENT), musterEvent({ price: FARE })]]),
      paymentsByReservation: new Map([[String(RES), [refunded200()]]]),
    });
    expect(row!.balanceCents).toBe(0);
    expect(row!.state).toBe("refunded");
  });

  it("AC7: two balance payments past what is owed leave the balance negative", () => {
    // What the webhook's overpay alert reads: the arithmetic must not floor at 0.
    const balance = (id: string) =>
      depositPayment({ id: asId<"PaymentId">(id), kind: "balance", amountCents: 37500, taxCents: 0 });
    expect(
      balanceOwedCents(INVOICE, [depositPayment(), balance("bal_1"), balance("bal_2")]),
    ).toBe(-37500);
  });
});

// #474 (DEC-107 amend) — the balance must bill the composed party fare (base + frozen extras),
// not the bare Event.price base. Scenario: base 50000 + extras 6000 (2 guests over the included
// count) = fare 56000; 7.25% tax on the FULL fare = 4060; a 20% tip = 11200. Deposit at 25% =
// round(0.25·56000) + tax + tip = 14000 + 4060 + 11200 = 29260 (gratuity 11200 bundled in).
// total = 56000 + 4060 = 60060; paid (tip netted, DEC-124) = 29260 − 11200 = 18060;
// balance = 42000 = the remaining 75% of the FULL fare (tax + tip both net out).
describe("balance composes the party fare — includes frozen extras (#474)", () => {
  // The invoice the booking froze: 56000 at 7.25% (4060), the 20% tip; no fee in this scenario.
  const WITH_EXTRAS: BookingInvoice = {
    ...INVOICE,
    extrasCents: 6000,
    taxCents: 4060,
    gratuityCents: 11200,
    gratuityBps: 2000,
    totalCents: 71260,
    amountDueNowCents: 29260,
  };
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
    expect(balanceOwedCents(WITH_EXTRAS, [depositWithExtras()])).toBe(42000);
    expect(balanceOwedCents(INVOICE, [depositWithExtras()])).toBe(35565); // the #474 bug value
  });

  it("createBalanceCheckout adds the reservation's frozen extras to the base", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent()); // price 50000 base
    await repo.saveReservation(reservation({ extrasCents: 6000, invoice: WITH_EXTRAS }));
    await repo.setPaymentConfig({ taxRateBps: 725 }, "now");
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

/**
 * Money F6 at the balance link (issue #1241): the amount is worked off the invoice frozen at booking,
 * so raising the live tax rate after booking mints nothing new. The F6 booking — $499 at 7.25%, 3%
 * fee, no tip: 49900 + 3618 + 1497 = 55015 — read with the live rate at 8%, where re-taxing the fare
 * gives $39.92 and a $3.74 balance on a booking paid in full.
 */
describe("the balance link reads the frozen invoice, not the live rate (issue #1241)", () => {
  const F6: BookingInvoice = {
    fareCents: 49900,
    extrasCents: 0,
    taxCents: 3618,
    taxRateBps: 725,
    serviceFeeCents: 1497,
    serviceFeeBps: 300,
    gratuityCents: 0,
    gratuityBps: 0,
    totalCents: 55015,
    amountDueNowCents: 55015,
  };

  async function bookedAtSevenPointTwoFive(invoice: BookingInvoice, paid: Payment) {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent({ price: 49900 }));
    await repo.saveReservation(reservation({ invoice }));
    await repo.savePayment(paid);
    await repo.setPaymentConfig({ taxRateBps: 800 }, "2026-07-02T00:00:00.000Z");
    return repo;
  }

  it("issue #1241 AC6: a booking paid in full has no balance to charge, and opens no session", async () => {
    const repo = await bookedAtSevenPointTwoFive(
      F6,
      depositPayment({ kind: "full", amountCents: 55015, taxCents: 3618, serviceFeeCents: 1497 }),
    );
    const pay = new FakePaymentPort();
    expect(await createBalanceCheckout(repo, pay, RES, URLS)).toEqual({ ok: false, reason: "no_balance" });
    expect(pay.created).toHaveLength(0);
  });

  it("issue #1241 AC6: a deposit-only booking is charged its frozen balance", async () => {
    // The $100 deposit carried the fee: 55015 − 10000 = 45015. At the live 8% it would be 45389.
    const repo = await bookedAtSevenPointTwoFive(
      { ...F6, amountDueNowCents: 10000 },
      depositPayment({ amountCents: 10000, taxCents: 3618, serviceFeeCents: 1497 }),
    );
    const pay = new FakePaymentPort();
    expect(await createBalanceCheckout(repo, pay, RES, URLS)).toMatchObject({ ok: true, amountCents: 45015 });
    expect(pay.created[0]!.amountCents).toBe(45015);
  });
});
