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
