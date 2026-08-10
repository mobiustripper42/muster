/**
 * Operator-initiated refund (#616) — one amount typed at the reservation, split across the
 * payment rows underneath it because Stripe refunds a PaymentIntent, never "a booking".
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { asId } from "../domain/ids.js";
import type { Payment, Reservation } from "../domain/entities.js";
import type { PaymentId, ReservationId } from "../domain/ids.js";
import { parseDollarsToCents, refundReservation } from "./refund-payment.js";

const RESV = asId<"ReservationId">("resv-refund-1");
const NOW = "2026-08-01T12:00:00.000Z";

const reservation: Reservation = {
  id: RESV,
  eventId: asId<"EventId">("evt-1"),
  source: "muster",
  customerName: "Ann",
  partySize: 4,
  status: "booked",
};

const payment = (over: Omit<Partial<Payment>, "id"> & { id: string }): Payment => ({
  reservationId: RESV,
  method: "stripe",
  kind: "deposit",
  amountCents: 10000,
  taxCents: 0,
  currency: "usd",
  status: "succeeded",
  createdAt: NOW,
  ...over,
  id: asId<"PaymentId">(over.id),
});

/** A deposit-then-balance booking: two charges, two PaymentIntents, in time order. */
async function twoCharges(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveReservation(reservation);
  await repo.savePayment(
    payment({
      id: "pay-deposit",
      kind: "deposit",
      amountCents: 13406,
      stripePaymentIntentId: "pi_deposit",
      createdAt: "2026-07-01T10:00:00.000Z",
    }),
  );
  await repo.savePayment(
    payment({
      id: "pay-balance",
      kind: "balance",
      amountCents: 40219,
      stripePaymentIntentId: "pi_balance",
      createdAt: "2026-07-20T10:00:00.000Z",
    }),
  );
  return repo;
}

const deps = (repo: InMemoryRepository, payments = new FakePaymentPort()) => ({
  repo,
  payments,
  now: () => NOW,
});

describe("refundReservation", () => {
  it("refunds a single-charge booking against its PaymentIntent", async () => {
    const repo = new InMemoryRepository();
    await repo.saveReservation(reservation);
    await repo.savePayment(payment({ id: "pay-1", stripePaymentIntentId: "pi_1" }));
    const payments = new FakePaymentPort();

    const result = await refundReservation(deps(repo, payments), RESV, 10000, 0);

    expect(result).toMatchObject({ ok: true, refundedCents: 10000 });
    expect(payments.refunds).toHaveLength(1);
    expect(payments.refunds[0]).toMatchObject({
      paymentIntentId: "pi_1",
      amountCents: 10000,
    });
    const row = await repo.getPayment(asId<"PaymentId">("pay-1"));
    expect(row).toMatchObject({ refundedCents: 10000, status: "refunded" });
  });

  it("draws from the NEWEST charge first, then spills into the older one", async () => {
    // Unwinding in the order the money arrived is the only ordering an operator can predict
    // without being shown the split. $500 against a $134.06 deposit + $402.19 balance takes
    // the balance whole and $97.81 of the deposit.
    const repo = await twoCharges();
    const payments = new FakePaymentPort();

    const result = await refundReservation(deps(repo, payments), RESV, 50000, 0);

    expect(result).toMatchObject({ ok: true, refundedCents: 50000 });
    expect(payments.refunds.map((r) => [r.paymentIntentId, r.amountCents])).toEqual([
      ["pi_balance", 40219],
      ["pi_deposit", 9781],
    ]);
    expect(await repo.getPayment(asId<"PaymentId">("pay-balance"))).toMatchObject({
      refundedCents: 40219,
      status: "refunded",
    });
    expect(await repo.getPayment(asId<"PaymentId">("pay-deposit"))).toMatchObject({
      refundedCents: 9781,
      status: "partially_refunded",
    });
  });

  it("refuses more than the booking can give back, and moves NO money doing it", async () => {
    // Planned in full before the first call, so an over-ask is refused whole rather than
    // discovered three rows in with two refunds already issued.
    const repo = await twoCharges();
    const payments = new FakePaymentPort();

    const result = await refundReservation(deps(repo, payments), RESV, 53626, 0);

    expect(result).toMatchObject({ ok: false, reason: "exceeds_refundable" });
    expect(payments.refunds).toHaveLength(0);
  });

  it("refuses when a row it must draw from has no PaymentIntent — before refunding anything", async () => {
    // A hand-reconciled or legacy row has nothing for Stripe to refund against. The refusal
    // must come BEFORE the newer row is refunded, or the operator is left half-done with no
    // way to tell which half.
    // Seeded directly rather than by overwriting `twoCharges` — `savePayment` is insert-only
    // (a payment row is immutable once written), so a re-save would silently keep the PI id
    // and this test would assert nothing.
    const repo = new InMemoryRepository();
    await repo.saveReservation(reservation);
    await repo.savePayment(
      payment({
        id: "pay-deposit",
        kind: "deposit",
        amountCents: 13406,
        createdAt: "2026-07-01T10:00:00.000Z",
      }),
    );
    await repo.savePayment(
      payment({
        id: "pay-balance",
        kind: "balance",
        amountCents: 40219,
        stripePaymentIntentId: "pi_balance",
        createdAt: "2026-07-20T10:00:00.000Z",
      }),
    );
    const payments = new FakePaymentPort();

    const result = await refundReservation(deps(repo, payments), RESV, 50000, 0);

    expect(result).toMatchObject({ ok: false, reason: "no_payment_intent" });
    expect(payments.refunds).toHaveLength(0);
  });

  it("takes only what it needs from a row it does not have to empty", async () => {
    const repo = await twoCharges();
    const payments = new FakePaymentPort();

    await refundReservation(deps(repo, payments), RESV, 20000, 0);

    expect(payments.refunds).toHaveLength(1);
    expect(payments.refunds[0]).toMatchObject({
      paymentIntentId: "pi_balance",
      amountCents: 20000,
    });
  });

  it("accumulates across separate refunds instead of replacing", async () => {
    // Refund $100 today, $50 next week. The second must not re-refund the first, and the row
    // must end at $150 rather than $50.
    const repo = await twoCharges();
    const payments = new FakePaymentPort();

    await refundReservation(deps(repo, payments), RESV, 10000, 0);
    const second = await refundReservation(deps(repo, payments), RESV, 5000, 10000);

    expect(second).toMatchObject({ ok: true, refundedCents: 5000 });
    expect(payments.refunds).toHaveLength(2);
    expect(await repo.getPayment(asId<"PaymentId">("pay-balance"))).toMatchObject({
      refundedCents: 15000,
      status: "partially_refunded",
    });
  });

  it("a double-submit of the same form refunds ONCE", async () => {
    // The dangerous press. Stripe's idempotency key cannot save us here: the second call
    // computes a DIFFERENT allocation (cumulative $100 → $200), so it keys differently and is
    // a genuine second refund. Disabling the button is not a guard either — a no-JS post goes
    // through twice.
    //
    // So the form carries the refunded total it was RENDERED against, and the action refuses
    // if the ledger has moved since. A compare-and-swap on money, the same posture as every
    // other claim in this codebase.
    const repo = await twoCharges();
    const payments = new FakePaymentPort();

    const first = await refundReservation(deps(repo, payments), RESV, 10000, 0);
    const replay = await refundReservation(deps(repo, payments), RESV, 10000, 0);

    expect(first).toMatchObject({ ok: true });
    expect(replay).toMatchObject({ ok: false, reason: "stale" });
    expect(payments.refunds).toHaveLength(1);
    expect(await repo.getPayment(asId<"PaymentId">("pay-balance"))).toMatchObject({
      refundedCents: 10000,
    });
  });

  it("refuses a non-positive amount", async () => {
    const repo = await twoCharges();
    const payments = new FakePaymentPort();

    expect(await refundReservation(deps(repo, payments), RESV, 0, 0)).toMatchObject({
      ok: false,
      reason: "invalid_amount",
    });
    expect(await refundReservation(deps(repo, payments), RESV, -100, 0)).toMatchObject({
      ok: false,
      reason: "invalid_amount",
    });
    expect(payments.refunds).toHaveLength(0);
  });

  it("records what DID move when the provider fails partway", async () => {
    // Money that moved must be in the ledger even though the operation failed overall —
    // the #613 posture: unreconcilable is not unrecordable.
    const repo = await twoCharges();
    const payments = new FakePaymentPort();
    let calls = 0;
    const original = payments.refund.bind(payments);
    payments.refund = async (input) => {
      calls += 1;
      if (calls === 2) throw new Error("stripe is down");
      return original(input);
    };

    const result = await refundReservation(deps(repo, payments), RESV, 50000, 0);

    expect(result).toMatchObject({ ok: false, reason: "provider_error", refundedCents: 40219 });
    // The first leg landed and is recorded; the second never happened.
    expect(await repo.getPayment(asId<"PaymentId">("pay-balance"))).toMatchObject({
      refundedCents: 40219,
    });
    expect((await repo.getPayment(asId<"PaymentId">("pay-deposit")))?.refundedCents).toBeUndefined();
  });

  it("refuses a Xola reservation", async () => {
    const repo = await twoCharges();
    await repo.saveReservation({ ...reservation, source: "xola" });

    expect(await refundReservation(deps(repo), RESV, 1000, 0)).toMatchObject({
      ok: false,
      reason: "not_muster",
    });
  });
});

/**
 * The operator types dollars. A wrong parse moves the wrong amount of real money, and the
 * failure is silent — `Number("12.3.4")` is `NaN`, `Number("")` is 0, and `parseFloat("50abc")`
 * is 50. Same posture as the webhook's `requireCents`: validate the STRING, never the coercion.
 */
describe("parseDollarsToCents", () => {
  it("parses the shapes an operator actually types", () => {
    expect(parseDollarsToCents("50")).toBe(5000);
    expect(parseDollarsToCents("50.00")).toBe(5000);
    expect(parseDollarsToCents("536.25")).toBe(53625);
    expect(parseDollarsToCents("0.99")).toBe(99);
    expect(parseDollarsToCents("  536.25  ")).toBe(53625);
    expect(parseDollarsToCents("$536.25")).toBe(53625);
    expect(parseDollarsToCents("1,536.25")).toBe(153625);
    expect(parseDollarsToCents("536.2")).toBe(53620);
  });

  it("refuses everything else rather than guessing", () => {
    // Each of these is a value some coercion would happily turn into a number.
    for (const bad of ["", "   ", "abc", "50abc", "12.3.4", "-50", "5e2", "0x10", "50.123", "."]) {
      expect(parseDollarsToCents(bad)).toBeNull();
    }
  });

  it("does not lose a cent to floating point", () => {
    // `Math.round(1.15 * 100)` is 115, but `70.55 * 100` is 7054.999999999999 — a naive
    // multiply truncates a cent off some perfectly ordinary amounts.
    expect(parseDollarsToCents("70.55")).toBe(7055);
    expect(parseDollarsToCents("1.005")).toBeNull(); // three decimals: refused, not rounded
    expect(parseDollarsToCents("8.87")).toBe(887);
  });
});
