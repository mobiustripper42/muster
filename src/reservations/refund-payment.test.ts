/**
 * Operator-initiated refund (#616) — one amount typed at the reservation, split across the
 * payment rows underneath it because Stripe refunds a PaymentIntent, never "a booking".
 *
 * Since issue #1278 every refund is a refund record first: written before Stripe is asked, sent
 * under a key taken from the record, finished once its result is written, and finished by the job
 * (`finishUnfinishedRefunds`) when a press could not.
 */
import { describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { asId } from "../domain/ids.js";
import type { NewRefundRecord, Payment, RefundLeg, RefundRecord, Reservation } from "../domain/entities.js";
import { PaymentIndeterminateError, type ProviderRefund, type RefundInput } from "../ports/payment.js";
import type { TellCustomer } from "./cancel-notice.js";
import { safeForAlert } from "./booking-webhook.js";
import { formatCents } from "./calendar-detail.js";
import {
  bookingPanePath,
  finishUnfinishedRefunds,
  movedCentsOf,
  parseDollarsToCents,
  planRefund,
  refundAlertText,
  refundReservation,
  sendRefundRecord,
  soldOutWho,
  type RefundActor,
  type RefundDeps,
} from "./refund-payment.js";

const RESV = asId<"ReservationId">("resv-refund-1");
const NOW = "2026-08-01T12:00:00.000Z";
const ADMIN = "crew-admin-1";
/** The operator's refund box. */
const BY: RefundActor = { reason: "operator_refund", actorKind: "admin", actorId: ADMIN };

const MIN = 60_000;
const HOUR = 60 * MIN;
const after = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();

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

const DEPOSIT = payment({
  id: "pay-deposit",
  kind: "deposit",
  amountCents: 13406,
  stripePaymentIntentId: "pi_deposit",
  createdAt: "2026-07-01T10:00:00.000Z",
});
const BALANCE = payment({
  id: "pay-balance",
  kind: "balance",
  amountCents: 40219,
  stripePaymentIntentId: "pi_balance",
  createdAt: "2026-07-20T10:00:00.000Z",
});

/** A deposit-then-balance booking: two charges, two PaymentIntents, in time order. */
async function twoCharges(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveReservation(reservation);
  await repo.savePayment(DEPOSIT);
  await repo.savePayment(BALANCE);
  return repo;
}

const deps = (repo: InMemoryRepository, payments = new FakePaymentPort(), over: Partial<RefundDeps> = {}) => ({
  repo,
  payments,
  now: () => NOW,
  alert: async (_message: string, _href?: string) => {},
  ...over,
});

const alertSpy = () => vi.fn(async (_message: string, _href?: string) => {});

// ── Refund records, for the tests that start from one ─────────────────────────────────────
const RR = asId<"RefundRecordId">("rr-1");
const newRecord = (over: Partial<NewRefundRecord> = {}): NewRefundRecord => ({
  id: RR,
  reservationId: RESV,
  reason: "operator_refund",
  actorKind: "admin",
  actorId: ADMIN,
  askedCents: 20000,
  expectedRefundedCents: 0,
  createdAt: NOW,
  ...over,
});
/** A customer's own cancel: the customer pressed, so there is no actor id. */
const customerCancelRecord = (): NewRefundRecord => {
  const { actorId: _admin, ...record } = newRecord({ reason: "customer_cancel", actorKind: "customer" });
  return record;
};
const balanceLeg = (over: Partial<RefundLeg> = {}): RefundLeg => ({
  paymentIntentId: "pi_balance",
  paymentId: asId<"PaymentId">("pay-balance"),
  cents: 20000,
  refundedTotalCents: 20000,
  ...over,
});
const recordsOf = (repo: InMemoryRepository) => repo.listRefundRecordsFor(RESV);
const trailOf = (repo: InMemoryRepository) => repo.listTrailEventsFor(RESV, []);

/**
 * Every call the port's `refund` receives, in order — including ones that throw, and ones the fake
 * would dedupe by key. `behave` scripts the next calls: an Error is thrown, `"ok"` goes through.
 */
function recordCalls(payments: FakePaymentPort, behave: Array<"ok" | Error> = []): RefundInput[] {
  const calls: RefundInput[] = [];
  const real = payments.refund.bind(payments);
  payments.refund = async (input) => {
    calls.push(input);
    const next = behave.shift();
    if (next instanceof Error) throw next;
    return real(input);
  };
  return calls;
}

/** What the provider reports for each PaymentIntent; records which ones were asked. */
function listing(payments: FakePaymentPort, answer: (pi: string) => ProviderRefund[] | Error = () => []): string[] {
  const asked: string[] = [];
  payments.listRefunds = async (pi) => {
    asked.push(pi);
    const a = answer(pi);
    if (a instanceof Error) throw a;
    return a;
  };
  return asked;
}

describe("refundReservation", () => {
  it("refunds a single-charge booking against its PaymentIntent", async () => {
    const repo = new InMemoryRepository();
    await repo.saveReservation(reservation);
    await repo.savePayment(payment({ id: "pay-1", stripePaymentIntentId: "pi_1" }));
    const payments = new FakePaymentPort();

    const result = await refundReservation(deps(repo, payments), RESV, 10000, 0, BY);

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

    const result = await refundReservation(deps(repo, payments), RESV, 50000, 0, BY);

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

    const result = await refundReservation(deps(repo, payments), RESV, 53626, 0, BY);

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

    const result = await refundReservation(deps(repo, payments), RESV, 50000, 0, BY);

    expect(result).toMatchObject({ ok: false, reason: "no_payment_intent" });
    expect(payments.refunds).toHaveLength(0);
  });

  it("takes only what it needs from a row it does not have to empty", async () => {
    const repo = await twoCharges();
    const payments = new FakePaymentPort();

    await refundReservation(deps(repo, payments), RESV, 20000, 0, BY);

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

    await refundReservation(deps(repo, payments), RESV, 10000, 0, BY);
    const second = await refundReservation(deps(repo, payments), RESV, 5000, 10000, BY);

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

    const first = await refundReservation(deps(repo, payments), RESV, 10000, 0, BY);
    const replay = await refundReservation(deps(repo, payments), RESV, 10000, 0, BY);

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

    expect(await refundReservation(deps(repo, payments), RESV, 0, 0, BY)).toMatchObject({
      ok: false,
      reason: "invalid_amount",
    });
    expect(await refundReservation(deps(repo, payments), RESV, -100, 0, BY)).toMatchObject({
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

    const result = await refundReservation(deps(repo, payments), RESV, 50000, 0, BY);

    expect(result).toMatchObject({ ok: false, reason: "provider_error", refundedCents: 40219 });
    // The first leg landed and is recorded; the second never happened.
    expect(await repo.getPayment(asId<"PaymentId">("pay-balance"))).toMatchObject({
      refundedCents: 40219,
    });
    expect((await repo.getPayment(asId<"PaymentId">("pay-deposit")))?.refundedCents).toBeUndefined();
  });

  it("two SIMULTANEOUS refunds of different amounts: only one reaches Stripe (#726)", async () => {
    // NOT the double-submit case (closed by the compare-and-swap). Two operators, or one in two
    // tabs, refunding DIFFERENT amounts: both read `refunded = 0` and both pass the compare. Since
    // issue #1278 the record is the lock — one unfinished record per booking — so the second press
    // finds the first's record and is refused as `unfinished`.
    const repo = await twoCharges();
    const payments = new FakePaymentPort();

    // Hold the FIRST refund inside the provider call until the second has started, which is the
    // interleaving that matters — the second must pass its compare while the first is in flight
    // at Stripe. Without this gate the two calls serialize and the bug is invisible.
    let releaseFirst!: () => void;
    const firstInFlight = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let started = 0;
    const original = payments.refund.bind(payments);
    payments.refund = async (input) => {
      started += 1;
      if (started === 1) await firstInFlight;
      return original(input);
    };

    const first = refundReservation(deps(repo, payments), RESV, 5000, 0, BY);
    const second = refundReservation(deps(repo, payments), RESV, 3000, 0, BY);
    // Let the second run to completion (or refusal) before the first is allowed to finish.
    const secondResult = await second;
    releaseFirst();
    const firstResult = await first;

    // Exactly one refund may reach the provider. This is the assertion the money turns on.
    expect(payments.refunds).toHaveLength(1);

    // One winner, one refusal — and the loser must not report success.
    const outcomes = [firstResult, secondResult];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    expect(outcomes.filter((r) => !r.ok && r.reason === "unfinished")).toHaveLength(1);
    // Exactly one record was inserted.
    expect(await recordsOf(repo)).toHaveLength(1);

    // The ledger agrees with what actually moved: one refund's worth, not the max of two.
    const rows = await repo.listPaymentsForReservation(RESV);
    const ledger = rows.reduce((s, p) => s + (p.refundedCents ?? 0), 0);
    expect(ledger).toBe(payments.refunds[0]!.amountCents);
  });

  it("AC10: a finished record does not block a later, separate refund", async () => {
    // The record must not outlive its refund as a lock. If it did, the operator refunding $50 now
    // and $30 an hour later would be refused the second one for no visible reason.
    const repo = await twoCharges();
    const payments = new FakePaymentPort();

    const first = await refundReservation(deps(repo, payments), RESV, 5000, 0, BY);
    expect(first).toMatchObject({ ok: true });

    const second = await refundReservation(deps(repo, payments), RESV, 3000, 5000, BY);
    expect(second).toMatchObject({ ok: true, refundedCents: 3000 });
    expect(payments.refunds).toHaveLength(2);
  });

  it("AC7: a refund the provider refused can be pressed again — a new record, under a key no earlier call used", async () => {
    // A refusal is exactly when the operator presses again, and the second press is a new refund
    // of its own: a key reused from the refused call would get the refusal back from Stripe.
    const repo = await twoCharges();
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments);
    payments.refundError = new Error("card_declined");

    const failed = await refundReservation(deps(repo, payments), RESV, 5000, 0, BY);
    expect(failed).toMatchObject({ ok: false, reason: "provider_error", refundedCents: 0 });

    payments.refundError = null;
    const retry = await refundReservation(deps(repo, payments), RESV, 5000, 0, BY);
    expect(retry).toMatchObject({ ok: true, refundedCents: 5000 });

    expect((await recordsOf(repo)).map((r) => r.state)).toEqual(["short", "whole"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.idempotencyKey).not.toBe(calls[0]!.idempotencyKey);
  });

  it("AC28: a refused plan writes no record, so the next refund is not blocked", async () => {
    // An operator fat-fingering $9,999 must not lock the booking while a colleague's correct
    // refund bounces off it: the plan is checked before anything is written.
    const repo = await twoCharges();
    const payments = new FakePaymentPort();

    expect(await refundReservation(deps(repo, payments), RESV, 999_999, 0, BY)).toMatchObject({
      ok: false,
      reason: "exceeds_refundable",
    });
    expect(await recordsOf(repo)).toEqual([]);
    expect(payments.refunds).toEqual([]);
    expect(await refundReservation(deps(repo, payments), RESV, 5000, 0, BY)).toMatchObject({ ok: true });
  });

  it("refuses a Xola reservation", async () => {
    const repo = await twoCharges();
    await repo.saveReservation({ ...reservation, source: "xola" });

    expect(await refundReservation(deps(repo), RESV, 1000, 0, BY)).toMatchObject({
      ok: false,
      reason: "not_muster",
    });
  });

  it("refuses a PENDING row before touching the provider — §3.4 acts on money that was taken (14.3, §2.8.10)", async () => {
    // Refused on STATUS, not on the money: the charges here are deliberately present so the
    // plan would otherwise succeed. A pending row with payment rows against it is exactly the
    // retry-on-the-same-row shape 14.6 builds, and none of it is refundable until it confirms.
    const repo = await twoCharges();
    await repo.saveReservation({ ...reservation, status: "pending", eventId: null });
    const port = new FakePaymentPort();

    expect(await refundReservation(deps(repo, port), RESV, 1000, 0, BY)).toEqual({
      ok: false,
      reason: "not_booked",
    });
    expect(port.refunds).toEqual([]);
  });

  it("still refunds a CANCELLED row — cancel-then-refund is the flow, and the receipt lives on", async () => {
    const repo = await twoCharges();
    await repo.saveReservation({ ...reservation, status: "cancelled" });

    expect(await refundReservation(deps(repo), RESV, 1000, 0, BY)).toMatchObject({ ok: true, refundedCents: 1000 });
  });
});

// ── Step 1: written down before Stripe is asked ────────────────────────────────────────────

describe("refundReservation — the record comes first (issue #1278)", () => {
  it("AC4: the box writes an unfinished record for the typed amount, by the operator, before the port is called", async () => {
    const repo = await twoCharges();
    const payments = new FakePaymentPort();
    let seen: RefundRecord[] | undefined;
    const real = payments.refund.bind(payments);
    payments.refund = async (input) => {
      seen ??= await recordsOf(repo);
      return real(input);
    };

    expect(await refundReservation(deps(repo, payments), RESV, 20000, 0, BY)).toMatchObject({ ok: true });

    expect(seen).toMatchObject([
      {
        reservationId: RESV,
        reason: "operator_refund",
        actorKind: "admin",
        actorId: ADMIN,
        askedCents: 20000,
        expectedRefundedCents: 0,
        state: "unfinished",
      },
    ]);
  });

  it("AC4: when the insert throws, the port is never called and the press rejects", async () => {
    const repo = await twoCharges();
    repo.createRefundRecord = async () => {
      throw new Error("database unreachable");
    };
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments);

    await expect(refundReservation(deps(repo, payments), RESV, 20000, 0, BY)).rejects.toThrow("database unreachable");
    expect(calls).toEqual([]);
  });

  it("AC28: the plan's refusal is reported first, even on a booking with an unfinished record", async () => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord());

    expect(await refundReservation(deps(repo), RESV, 999_999, 0, BY)).toMatchObject({
      ok: false,
      reason: "exceeds_refundable",
    });
  });

  it("AC10: a booking with an unfinished record refuses the press — unfinished, nothing inserted, no port call", async () => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord({ askedCents: 5000 }));
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments);

    expect(await refundReservation(deps(repo, payments), RESV, 3000, 0, BY)).toEqual({ ok: false, reason: "unfinished" });

    expect(await recordsOf(repo)).toMatchObject([{ id: RR, askedCents: 5000 }]);
    expect(calls).toEqual([]);
  });

  it("AC22: the legs are saved before the first port call, and a re-send uses them — never a new split", async () => {
    const repo = await twoCharges();
    const payments = new FakePaymentPort();
    let legsAtCall: RefundLeg[] | undefined;
    const calls: RefundInput[] = [];
    const real = payments.refund.bind(payments);
    payments.refund = async (input) => {
      calls.push(input);
      if (calls.length === 1) {
        legsAtCall = (await recordsOf(repo))[0]?.legs;
        throw new PaymentIndeterminateError("no answer");
      }
      return real(input);
    };

    await refundReservation(deps(repo, payments), RESV, 20000, 0, BY);
    expect(legsAtCall).toMatchObject([{ paymentIntentId: "pi_balance", cents: 20000 }]);

    // A newer charge lands and the refunded-so-far total moves. A fresh plan would draw from the
    // newer charge, and the record's token is now stale: neither may change what is re-sent.
    await repo.savePayment(
      payment({ id: "pay-newer", kind: "balance", amountCents: 30000, stripePaymentIntentId: "pi_newer", createdAt: "2026-07-25T10:00:00.000Z" }),
    );
    await repo.markPaymentRefunded(asId<"PaymentId">("pay-deposit"), 500);
    listing(payments);

    await finishUnfinishedRefunds(deps(repo, payments, { now: () => after(6 * MIN) }));

    expect(calls.map((c) => [c.paymentIntentId, c.amountCents])).toEqual([
      ["pi_balance", 20000],
      ["pi_balance", 20000],
    ]);
    expect(await recordsOf(repo)).toMatchObject([{ state: "whole", movedCents: 20000 }]);
  });
});

// ── Step 2: the key comes from the record ──────────────────────────────────────────────────

describe("refund keys (issue #1278)", () => {
  it("AC6: each leg is sent under its own key, carrying the record's id as the refund's only metadata", async () => {
    const repo = await twoCharges();
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments);

    await refundReservation(deps(repo, payments), RESV, 50000, 0, BY);

    const [record] = await recordsOf(repo);
    expect(record).toBeDefined();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.idempotencyKey).not.toBe(calls[1]!.idempotencyKey);
    expect(calls.map((c) => c.metadata)).toEqual([{ refund_record: record?.id }, { refund_record: record?.id }]);
  });
});

// ── Step 3: the result is written, and unknown is never "nothing moved" ─────────────────────

describe("refundReservation — the result (issue #1278)", () => {
  it("AC8: every leg confirmed finishes the record whole, with what was asked, and raises each payment by its leg", async () => {
    const repo = await twoCharges();

    expect(await refundReservation(deps(repo), RESV, 50000, 0, BY)).toMatchObject({ ok: true, refundedCents: 50000 });

    expect(await recordsOf(repo)).toMatchObject([
      {
        state: "whole",
        askedCents: 50000,
        movedCents: 50000,
        legs: [
          { paymentIntentId: "pi_balance", paymentId: "pay-balance", cents: 40219, outcome: "moved" },
          { paymentIntentId: "pi_deposit", paymentId: "pay-deposit", cents: 9781, outcome: "moved" },
        ],
      },
    ]);
    expect((await repo.getPayment(asId<"PaymentId">("pay-balance")))?.refundedCents).toBe(40219);
    expect((await repo.getPayment(asId<"PaymentId">("pay-deposit")))?.refundedCents).toBe(9781);
  });

  it("AC9: a leg the provider took whose result cannot be written leaves the record unfinished and reports unknown", async () => {
    const repo = await twoCharges();
    repo.finishRefundLeg = async () => {
      throw new Error("connection reset");
    };
    const payments = new FakePaymentPort();

    expect(await refundReservation(deps(repo, payments), RESV, 20000, 0, BY)).toEqual({ ok: false, reason: "unknown" });

    expect(payments.refunds).toHaveLength(1);
    expect(await recordsOf(repo)).toMatchObject([{ state: "unfinished" }]);
  });

  it("AC9: no answer from the provider leaves the record unfinished and reports unknown — never provider_error", async () => {
    const repo = await twoCharges();
    const payments = new FakePaymentPort();
    payments.refundError = new PaymentIndeterminateError("timed out");

    expect(await refundReservation(deps(repo, payments), RESV, 20000, 0, BY)).toEqual({ ok: false, reason: "unknown" });

    expect(await recordsOf(repo)).toMatchObject([{ state: "unfinished", movedCents: 0 }]);
  });

  it("AC9: after a leg comes back with no answer, no later leg of the record is sent in that pass", async () => {
    const repo = await twoCharges();
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments, [new PaymentIndeterminateError("timed out"), "ok"]);

    await refundReservation(deps(repo, payments), RESV, 50000, 0, BY);

    expect(calls.map((c) => c.paymentIntentId)).toEqual(["pi_balance"]);
  });

  it("AC9: a failed write of the legs leaves the record unfinished, sends nothing and reports unknown", async () => {
    const repo = await twoCharges();
    repo.saveRefundLegs = async () => {
      throw new Error("connection reset");
    };
    const payments = new FakePaymentPort();

    expect(await refundReservation(deps(repo, payments), RESV, 20000, 0, BY)).toEqual({ ok: false, reason: "unknown" });

    expect(payments.refunds).toEqual([]);
    expect(await recordsOf(repo)).toMatchObject([{ state: "unfinished" }]);
  });

  it("AC11: a leg the provider refuses finishes the record short, stops the send, and the box reports it — no text", async () => {
    const repo = await twoCharges();
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments, [new Error("card_declined")]);
    const alert = alertSpy();

    const result = await refundReservation(deps(repo, payments, { alert }), RESV, 50000, 0, BY);

    expect(result).toMatchObject({ ok: false, reason: "provider_error", refundedCents: 0, message: "card_declined" });
    expect(calls.map((c) => c.paymentIntentId)).toEqual(["pi_balance"]);
    const [record] = await recordsOf(repo);
    expect(record).toMatchObject({ state: "short", movedCents: 0, shortReason: "card_declined" });
    expect(record?.legs[0]).toMatchObject({ paymentIntentId: "pi_balance", outcome: "refused" });
    expect(record?.legs[1]?.outcome).toBeUndefined();
    expect(alert).not.toHaveBeenCalled();
  });

  it("AC11: a refusal after a leg moved finishes short with what did move", async () => {
    const repo = await twoCharges();
    const payments = new FakePaymentPort();
    recordCalls(payments, ["ok", new Error("card_declined")]);

    await refundReservation(deps(repo, payments), RESV, 50000, 0, BY);

    expect(await recordsOf(repo)).toMatchObject([{ state: "short", askedCents: 50000, movedCents: 40219 }]);
  });

  it("AC29: a refund recorded between the plan's check and the send closes the record short — nothing sent, the press told", async () => {
    const repo = await twoCharges();
    const real = repo.createRefundRecord.bind(repo);
    repo.createRefundRecord = async (r) => {
      const out = await real(r);
      // Another refund lands on the booking the moment after this one's record is written.
      await repo.markPaymentRefunded(asId<"PaymentId">("pay-balance"), 1000);
      return out;
    };
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments);
    const alert = alertSpy();

    expect(await refundReservation(deps(repo, payments, { alert }), RESV, 20000, 0, BY)).toEqual({ ok: false, reason: "stale" });

    expect(calls).toEqual([]);
    expect(await recordsOf(repo)).toMatchObject([{ state: "short", movedCents: 0, shortReason: "stale" }]);
    expect(alert).not.toHaveBeenCalled();
  });
});

// ── One send for a press and for the job ───────────────────────────────────────────────────

describe("sendRefundRecord (issue #1278)", () => {
  it("AC25: a press and the job send the same record with the same port calls", async () => {
    const pressRepo = await twoCharges();
    const jobRepo = await twoCharges();
    await pressRepo.createRefundRecord(newRecord({ askedCents: 50000 }));
    await jobRepo.createRefundRecord(newRecord({ askedCents: 50000 }));
    const pressPort = new FakePaymentPort();
    const jobPort = new FakePaymentPort();
    listing(pressPort);
    listing(jobPort);

    await sendRefundRecord(deps(pressRepo, pressPort), RR, "press");
    await finishUnfinishedRefunds(deps(jobRepo, jobPort, { now: () => after(6 * MIN) }));

    expect(pressPort.refunds).toHaveLength(2);
    expect(jobPort.refunds).toEqual(pressPort.refunds);
  });

  it("AC25: sending a record that is already finished returns its finished state and calls no port", async () => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord());
    const payments = new FakePaymentPort();
    expect(await sendRefundRecord(deps(repo, payments), RR, "press")).toMatchObject({ state: "whole", movedCents: 20000 });
    const calls = recordCalls(payments);

    expect(await sendRefundRecord(deps(repo, payments), RR, "job")).toMatchObject({ state: "whole", movedCents: 20000 });
    expect(calls).toEqual([]);
  });

  it("AC11: a short record from a customer's cancel texts every active admin once, linking the booking — whoever sends it", async () => {
    // Only the operator's own presses are reported by their redirect; anything else is a text.
    const repo = await twoCharges();
    await repo.saveReservation({ ...reservation, status: "cancelled", cancelledBy: "customer" });
    await repo.createRefundRecord(customerCancelRecord());
    const payments = new FakePaymentPort();
    payments.refundError = new Error("card_declined");
    const alert = alertSpy();

    expect(await sendRefundRecord(deps(repo, payments, { alert }), RR, "press")).toMatchObject({
      state: "short",
      cause: "provider_refused",
      movedCents: 0,
      askedCents: 20000,
    });

    const record = (await repo.getRefundRecord(RR))!;
    const row = (await repo.getReservation(RESV))!;
    expect(alert.mock.calls).toEqual([[refundAlertText("short", record, row), bookingPanePath(RESV)]]);
  });
});

// ── Step 4: the job finishes what is unfinished ────────────────────────────────────────────

describe("finishUnfinishedRefunds — the job (issue #1278)", () => {
  const job = (repo: InMemoryRepository, payments: FakePaymentPort, at: string, over: Partial<RefundDeps> = {}) =>
    finishUnfinishedRefunds(deps(repo, payments, { now: () => at, ...over }));

  it("AC12: a record left with no legs — a break right after step 1 — is planned, its legs saved, then sent and finished", async () => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord({ askedCents: 50000 }));
    const payments = new FakePaymentPort();
    listing(payments);

    expect(await job(repo, payments, after(6 * MIN))).toEqual({ finished: 1, short: 0, alerted: 0, errors: 0 });

    expect(payments.refunds.map((r) => [r.paymentIntentId, r.amountCents, r.metadata])).toEqual([
      ["pi_balance", 40219, { refund_record: RR }],
      ["pi_deposit", 9781, { refund_record: RR }],
    ]);
    expect(await repo.getRefundRecord(RR)).toMatchObject({
      state: "whole",
      movedCents: 50000,
      legs: [
        { paymentIntentId: "pi_balance", paymentId: "pay-balance", cents: 40219, refundedTotalCents: 40219, outcome: "moved" },
        { paymentIntentId: "pi_deposit", paymentId: "pay-deposit", cents: 9781, refundedTotalCents: 9781, outcome: "moved" },
      ],
    });
  });

  it("AC12: a refund Stripe already made under the record is found by its metadata — written, and not sent again", async () => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord());
    await repo.saveRefundLegs(RR, [balanceLeg()]);
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments);
    const asked = listing(payments, () => [
      { refundId: "re_someone_else", amountCents: 1000, status: "succeeded", metadata: { refund_record: "rr-other" } },
      { refundId: "re_ours", amountCents: 20000, status: "succeeded", metadata: { refund_record: RR } },
    ]);

    expect(await job(repo, payments, after(6 * MIN))).toMatchObject({ finished: 1, errors: 0 });

    expect(asked).toEqual(["pi_balance"]);
    expect(calls).toEqual([]);
    expect(await repo.getRefundRecord(RR)).toMatchObject({
      state: "whole",
      movedCents: 20000,
      legs: [{ paymentIntentId: "pi_balance", refundId: "re_ours", outcome: "moved" }],
    });
    expect((await repo.getPayment(asId<"PaymentId">("pay-balance")))?.refundedCents).toBe(20000);
  });

  it.each<[ProviderRefund["status"], "moved" | "refused"]>([
    ["succeeded", "moved"],
    ["pending", "moved"],
    ["requires_action", "moved"],
    ["failed", "refused"],
    ["canceled", "refused"],
  ])("AC12: a refund found by metadata with status %s counts as %s", async (status, outcome) => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord());
    await repo.saveRefundLegs(RR, [balanceLeg()]);
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments);
    listing(payments, () => [{ refundId: "re_ours", amountCents: 20000, status, metadata: { refund_record: RR } }]);

    await job(repo, payments, after(6 * MIN));

    expect(calls).toEqual([]);
    expect(await repo.getRefundRecord(RR)).toMatchObject({
      state: outcome === "moved" ? "whole" : "short",
      movedCents: outcome === "moved" ? 20000 : 0,
      legs: [{ outcome }],
    });
  });

  it("AC12: not found and under 24 hours old, the leg is sent under its own key — the press's, again", async () => {
    const repo = await twoCharges();
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments, [new PaymentIndeterminateError("timed out")]);
    listing(payments);
    expect(await refundReservation(deps(repo, payments), RESV, 20000, 0, BY)).toEqual({ ok: false, reason: "unknown" });

    await job(repo, payments, after(6 * MIN));

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(await recordsOf(repo)).toMatchObject([{ state: "whole", movedCents: 20000 }]);
  });

  it("AC12: a leg that already has an outcome is neither looked up nor sent again", async () => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord({ askedCents: 50000 }));
    await repo.saveRefundLegs(RR, [
      balanceLeg({ cents: 40219, refundedTotalCents: 40219 }),
      { paymentIntentId: "pi_deposit", paymentId: asId<"PaymentId">("pay-deposit"), cents: 9781, refundedTotalCents: 9781 },
    ]);
    await repo.finishRefundLeg({ recordId: RR, paymentIntentId: "pi_balance", outcome: "moved", refundId: "re_1" });
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments);
    const asked = listing(payments);

    await job(repo, payments, after(6 * MIN));

    expect(asked).toEqual(["pi_deposit"]);
    expect(calls.map((c) => c.paymentIntentId)).toEqual(["pi_deposit"]);
    expect(await repo.getRefundRecord(RR)).toMatchObject({ state: "whole", movedCents: 50000 });
  });

  it("AC13: a record claimed more recently than the takeover age is left alone; past it, the job takes it", async () => {
    // A press's fresh record is its own: its claim starts when it was written.
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord());
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments);
    const asked = listing(payments);

    expect(await job(repo, payments, after(4 * MIN))).toEqual({ finished: 0, short: 0, alerted: 0, errors: 0 });
    expect(calls).toEqual([]);
    expect(asked).toEqual([]);
    expect(await repo.getRefundRecord(RR)).toMatchObject({ state: "unfinished" });

    expect(await job(repo, payments, after(6 * MIN))).toMatchObject({ finished: 1 });
    expect(calls).toHaveLength(1);
  });

  it("AC13: two runs at the same moment — exactly one claims the record, and it is sent once", async () => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord());
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments);
    listing(payments);

    const runs = await Promise.all([job(repo, payments, after(6 * MIN)), job(repo, payments, after(6 * MIN))]);

    expect(calls).toHaveLength(1);
    expect(runs.reduce((s, r) => s + r.finished, 0)).toBe(1);
  });

  it("AC13: a run that dies leaves the record unfinished; a later run takes it once the age has passed since the last claim", async () => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord());
    // Legs already saved: a press may have sent one, so the job must ask Stripe before sending.
    await repo.saveRefundLegs(RR, [balanceLeg()]);
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments);
    let stripeDown = true;
    const asked = listing(payments, () => (stripeDown ? new Error("stripe is down") : []));

    await job(repo, payments, after(6 * MIN)); // claims at +6, then cannot finish
    expect(await repo.getRefundRecord(RR)).toMatchObject({ state: "unfinished" });
    stripeDown = false;
    const askedBefore = asked.length;

    // Ten minutes after the record was written, but only four after the last claim.
    await job(repo, payments, after(10 * MIN));
    expect(asked).toHaveLength(askedBefore);
    expect(calls).toEqual([]);

    await job(repo, payments, after(12 * MIN));
    expect(calls).toHaveLength(1);
    expect(await repo.getRefundRecord(RR)).toMatchObject({ state: "whole" });
  });

  it.each<[string, (payments: FakePaymentPort) => void]>([
    [
      "listRefunds throws",
      (payments) => {
        listing(payments, (pi) => (pi === "pi_balance" ? new Error("stripe is down") : []));
      },
    ],
    [
      "refund gives no answer",
      (payments) => {
        listing(payments);
        const real = payments.refund.bind(payments);
        payments.refund = async (input) => {
          if (input.paymentIntentId === "pi_balance") throw new PaymentIndeterminateError("timed out");
          return real(input);
        };
      },
    ],
  ])("AC14: a record the job cannot finish (%s) is counted as an error and does not stop the others", async (_label, breakIt) => {
    const repo = await twoCharges();
    const OTHER = asId<"ReservationId">("resv-refund-2");
    await repo.saveReservation({ ...reservation, id: OTHER });
    await repo.savePayment(payment({ id: "pay-other", reservationId: OTHER, amountCents: 30000, stripePaymentIntentId: "pi_other" }));
    await repo.createRefundRecord(newRecord());
    // Legs already saved: a press may have sent one, so the job must ask Stripe before sending.
    await repo.saveRefundLegs(RR, [balanceLeg()]);
    await repo.createRefundRecord(newRecord({ id: asId<"RefundRecordId">("rr-2"), reservationId: OTHER, askedCents: 30000 }));
    const payments = new FakePaymentPort();
    breakIt(payments);

    expect(await job(repo, payments, after(6 * MIN))).toEqual({ finished: 1, short: 0, alerted: 0, errors: 1 });

    expect(await repo.getRefundRecord(RR)).toMatchObject({ state: "unfinished" });
    expect(await repo.getRefundRecord(asId<"RefundRecordId">("rr-2"))).toMatchObject({ state: "whole", movedCents: 30000 });
  });

  it("AC11: a record the job finishes short texts every active admin once, linking the booking, and counts as short", async () => {
    // An operator's own refund, but no operator pressed this send: the redirect is long gone.
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord());
    const payments = new FakePaymentPort();
    payments.refundError = new Error("card_declined");
    listing(payments);
    const alert = alertSpy();

    expect(await job(repo, payments, after(6 * MIN), { alert })).toEqual({ finished: 0, short: 1, alerted: 1, errors: 0 });

    const record = (await repo.getRefundRecord(RR))!;
    expect(record).toMatchObject({ state: "short", movedCents: 0, shortReason: "card_declined" });
    const row = (await repo.getReservation(RESV))!;
    expect(alert.mock.calls).toEqual([[refundAlertText("short", record, row), bookingPanePath(RESV)]]);
  });

  it("AC11: the short alert is sent once per record, even when finishing it takes two runs", async () => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord());
    let failFinish = true;
    const realFinish = repo.finishRefundRecord.bind(repo);
    repo.finishRefundRecord = async (input) => {
      if (failFinish) throw new Error("connection reset");
      return realFinish(input);
    };
    const payments = new FakePaymentPort();
    payments.refundError = new Error("card_declined");
    listing(payments);
    const alert = alertSpy();

    await job(repo, payments, after(6 * MIN), { alert });
    failFinish = false;
    await job(repo, payments, after(12 * MIN), { alert });

    expect(await repo.getRefundRecord(RR)).toMatchObject({ state: "short" });
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("AC29: a record the job plans and the plan refuses is closed short — nothing sent, the admins told", async () => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord({ expectedRefundedCents: 0 }));
    // Money went back on the booking after the record was written: its token is stale.
    await repo.markPaymentRefunded(asId<"PaymentId">("pay-balance"), 1000);
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments);
    listing(payments);
    const alert = alertSpy();

    expect(await job(repo, payments, after(6 * MIN), { alert })).toMatchObject({ short: 1, errors: 0 });

    expect(calls).toEqual([]);
    const record = (await repo.getRefundRecord(RR))!;
    expect(record).toMatchObject({ state: "short", movedCents: 0, shortReason: "stale" });
    const row = (await repo.getReservation(RESV))!;
    expect(alert.mock.calls).toEqual([[refundAlertText("short", record, row), bookingPanePath(RESV)]]);
  });

  // ── The catch-all (AC23) ───────────────────────────────────────────────────────────────
  it("AC23: a record unfinished 24 hours after it was written is finished short for every cent not known to have moved, and the admins told once", async () => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord({ askedCents: 50000 }));
    await repo.saveRefundLegs(RR, [
      balanceLeg({ cents: 40219, refundedTotalCents: 40219 }),
      { paymentIntentId: "pi_deposit", paymentId: asId<"PaymentId">("pay-deposit"), cents: 9781, refundedTotalCents: 9781 },
    ]);
    await repo.finishRefundLeg({ recordId: RR, paymentIntentId: "pi_balance", outcome: "moved", refundId: "re_1" });
    const payments = new FakePaymentPort();
    const calls = recordCalls(payments);
    const asked = listing(payments);
    const alert = alertSpy();

    expect(await job(repo, payments, after(24 * HOUR), { alert })).toEqual({ finished: 0, short: 1, alerted: 1, errors: 0 });

    // No port call at all for a record this old, the lookup included.
    expect(calls).toEqual([]);
    expect(asked).toEqual([]);
    const record = (await repo.getRefundRecord(RR))!;
    expect(record).toMatchObject({ state: "short", movedCents: 40219, shortReason: "not_confirmed_in_24_hours" });
    const row = (await repo.getReservation(RESV))!;
    expect(alert.mock.calls).toEqual([[refundAlertText("gave_up", record, row), bookingPanePath(RESV)]]);
  });

  it("AC23: with every port call throwing and no legs saved, it still finishes short for the whole amount, and the admins are told", async () => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord());
    const payments = new FakePaymentPort();
    payments.refundError = new PaymentIndeterminateError("timed out");
    listing(payments, () => new Error("stripe is down"));
    const alert = alertSpy();

    expect(await job(repo, payments, after(25 * HOUR), { alert })).toMatchObject({ short: 1, alerted: 1 });

    expect(await repo.getRefundRecord(RR)).toMatchObject({ state: "short", movedCents: 0, shortReason: "not_confirmed_in_24_hours" });
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("AC23: if the write that finishes it throws too, the alert is still sent, and the record counts as an error", async () => {
    const repo = await twoCharges();
    await repo.createRefundRecord(newRecord());
    repo.finishRefundRecord = async () => {
      throw new Error("connection reset");
    };
    const payments = new FakePaymentPort();
    listing(payments);
    const alert = alertSpy();

    expect(await job(repo, payments, after(25 * HOUR), { alert })).toEqual({ finished: 0, short: 0, alerted: 1, errors: 1 });

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]![1]).toBe(bookingPanePath(RESV));
  });

  it("AC23: 24 hours is the line — a millisecond before it the job still sends; at it, it gives up", async () => {
    const before = await twoCharges();
    await before.createRefundRecord(newRecord());
    const beforePort = new FakePaymentPort();
    const beforeCalls = recordCalls(beforePort);
    listing(beforePort);
    await job(before, beforePort, after(24 * HOUR - 1));
    expect(beforeCalls).toHaveLength(1);
    expect(await before.getRefundRecord(RR)).toMatchObject({ state: "whole" });

    const at = await twoCharges();
    await at.createRefundRecord(newRecord());
    const atPort = new FakePaymentPort();
    const atCalls = recordCalls(atPort);
    listing(atPort);
    await job(at, atPort, after(24 * HOUR));
    expect(atCalls).toEqual([]);
    expect(await at.getRefundRecord(RR)).toMatchObject({ state: "short", shortReason: "not_confirmed_in_24_hours" });
  });

  it("AC23: a sold-out record given up at 24 hours sends the sold-out text, with no link", async () => {
    const repo = new InMemoryRepository();
    const LOST = asId<"ReservationId">("resv-lost");
    await repo.saveReservation({ ...reservation, id: LOST, status: "pending", eventId: null, customerName: "Dana Reyes", partySize: 6 });
    const SOLD_OUT = asId<"RefundRecordId">("rr_sold_out_pi_lost");
    await repo.createRefundRecord({
      id: SOLD_OUT,
      reservationId: LOST,
      reason: "sold_out",
      actorKind: "engine",
      askedCents: 53625,
      createdAt: NOW,
      legs: [{ paymentIntentId: "pi_lost", cents: 53625 }],
    });
    const payments = new FakePaymentPort();
    listing(payments);
    const alert = alertSpy();

    await job(repo, payments, after(24 * HOUR), { alert });

    const record = (await repo.getRefundRecord(SOLD_OUT))!;
    expect(record).toMatchObject({ state: "short", shortReason: "not_confirmed_in_24_hours" });
    const row = (await repo.getReservation(LOST))!;
    expect(alert.mock.calls.map((c) => c[0])).toEqual([refundAlertText("sold_out_short", record, row)]);
    expect(alert.mock.calls.map((c) => c[1])).toEqual([undefined]);
  });

  // ── The cancel's notice (AC15) ─────────────────────────────────────────────────────────
  function spyTell() {
    const calls: Parameters<TellCustomer>[] = [];
    const tell: TellCustomer = async (...args) => {
      calls.push(args);
      return "sent-sent";
    };
    return { tell, calls };
  }

  it("AC15: finishing a cancel's record nobody told the customer about, the job tells them once, with the outcome", async () => {
    const repo = await twoCharges();
    await repo.saveReservation({ ...reservation, status: "cancelled", cancelledBy: "customer" });
    await repo.createRefundRecord(customerCancelRecord());
    const payments = new FakePaymentPort();
    listing(payments);
    const { tell, calls } = spyTell();

    await job(repo, payments, after(6 * MIN), { tellCustomer: tell });
    await job(repo, payments, after(30 * MIN), { tellCustomer: tell });

    expect(calls).toEqual([[RESV, "customer", { kind: "issued", cents: 20000 }, { kind: "customer" }]]);
    expect((await repo.getRefundRecord(RR))?.noticeSentAt).toBeDefined();
  });

  it("AC15: the job's notice takes who cancelled from the booking, and who pressed from the record", async () => {
    // An operator's cancel can be one the customer asked for.
    const repo = await twoCharges();
    await repo.saveReservation({ ...reservation, status: "cancelled", cancelledBy: "customer" });
    await repo.createRefundRecord(newRecord({ reason: "operator_cancel" }));
    const payments = new FakePaymentPort();
    listing(payments);
    const { tell, calls } = spyTell();

    await job(repo, payments, after(6 * MIN), { tellCustomer: tell });

    expect(calls).toEqual([[RESV, "customer", { kind: "issued", cents: 20000 }, { kind: "admin", id: ADMIN }]]);
  });

  it("AC15: a notice claimed and never marked sent is not sent again; every active admin is told to check, once", async () => {
    const repo = await twoCharges();
    await repo.saveReservation({ ...reservation, status: "cancelled", cancelledBy: "customer" });
    await repo.createRefundRecord(customerCancelRecord());
    // The press claimed the notice and died before marking it sent.
    expect(await repo.claimRefundNotice(RR, NOW)).toBe(true);
    const payments = new FakePaymentPort();
    listing(payments);
    const { tell, calls } = spyTell();
    const alert = alertSpy();

    expect(await job(repo, payments, after(6 * MIN), { tellCustomer: tell, alert })).toMatchObject({ finished: 1, alerted: 1 });

    expect(calls).toEqual([]);
    const record = (await repo.getRefundRecord(RR))!;
    expect(record).toMatchObject({ state: "whole" });
    const row = (await repo.getReservation(RESV))!;
    expect(alert.mock.calls).toEqual([[refundAlertText("notice_in_doubt", record, row), bookingPanePath(RESV)]]);
  });
});

// ── The history rows the screens still read (AC32) ─────────────────────────────────────────

describe("the history rows a finished record writes (issue #1278)", () => {
  it("AC32: a whole refund from the box writes refund_issued_by_operator, by the operator, named for its record", async () => {
    const repo = await twoCharges();

    await refundReservation(deps(repo), RESV, 20000, 0, BY);

    const [record] = await recordsOf(repo);
    expect(record).toBeDefined();
    const rows = (await trailOf(repo)).filter((r) => r.type === "refund_issued_by_operator");
    expect(rows).toMatchObject([
      { actorKind: "admin", actorId: ADMIN, metadata: { actualCents: 20000, reason: "standalone refund" } },
    ]);
    expect(rows[0]?.metadata.quotedCents).toBeUndefined();
    expect(rows[0]?.id).toContain(String(record?.id));
  });

  it("AC32: a short record writes refund_failed with what moved and why, by the record's actor", async () => {
    const repo = await twoCharges();
    const payments = new FakePaymentPort();
    recordCalls(payments, ["ok", new Error("card_declined")]);

    await refundReservation(deps(repo, payments), RESV, 50000, 0, BY);

    expect((await trailOf(repo)).filter((r) => r.type === "refund_failed")).toMatchObject([
      { actorKind: "admin", actorId: ADMIN, metadata: { actualCents: 40219, reason: "card_declined" } },
    ]);
  });

  it("AC32: a whole record from a customer's cancel writes no refund row", async () => {
    const repo = await twoCharges();
    await repo.saveReservation({ ...reservation, status: "cancelled", cancelledBy: "customer" });
    await repo.createRefundRecord(customerCancelRecord());

    await sendRefundRecord(deps(repo), RR, "press");

    const types = (await trailOf(repo)).map((r) => r.type);
    expect(types).not.toContain("refund_issued_by_operator");
    expect(types).not.toContain("refund_failed");
    expect(types).not.toContain("auto_refunded");
  });

  it("AC32: finishing a record twice writes one row — the finishing write throws once, the job sends it again", async () => {
    const repo = await twoCharges();
    let failFinish = true;
    const realFinish = repo.finishRefundRecord.bind(repo);
    repo.finishRefundRecord = async (input) => {
      if (failFinish) {
        failFinish = false;
        throw new Error("connection reset");
      }
      return realFinish(input);
    };
    const payments = new FakePaymentPort();
    listing(payments);

    expect(await refundReservation(deps(repo, payments), RESV, 20000, 0, BY)).toEqual({ ok: false, reason: "unknown" });
    await finishUnfinishedRefunds(deps(repo, payments, { now: () => after(6 * MIN) }));

    expect(await recordsOf(repo)).toMatchObject([{ state: "whole" }]);
    expect((await trailOf(repo)).filter((r) => r.type === "refund_issued_by_operator")).toHaveLength(1);
  });

  it("AC32: a failed history write does not unfinish the record", async () => {
    const repo = await twoCharges();
    repo.appendTrailEvent = async () => {
      throw new Error("trail unreachable");
    };

    expect(await refundReservation(deps(repo), RESV, 20000, 0, BY)).toMatchObject({ ok: true, refundedCents: 20000 });
    expect(await recordsOf(repo)).toMatchObject([{ state: "whole", movedCents: 20000 }]);
  });
});

// ── The shared homes ───────────────────────────────────────────────────────────────────────

describe("planRefund — the plan's one home (issue #1278)", () => {
  it("AC28: draws the newest charge first and spills into the older, each leg carrying its payment's total after it", () => {
    expect(planRefund([DEPOSIT, BALANCE], 50000, 0)).toEqual({
      ok: true,
      legs: [
        { paymentIntentId: "pi_balance", paymentId: "pay-balance", cents: 40219, refundedTotalCents: 40219 },
        { paymentIntentId: "pi_deposit", paymentId: "pay-deposit", cents: 9781, refundedTotalCents: 9781 },
      ],
    });
  });

  it("AC28: takes only what it needs, and counts what a charge already gave back", () => {
    const partly = { ...BALANCE, refundedCents: 10000, status: "partially_refunded" as const };
    expect(planRefund([DEPOSIT, partly], 5000, 10000)).toEqual({
      ok: true,
      legs: [{ paymentIntentId: "pi_balance", paymentId: "pay-balance", cents: 5000, refundedTotalCents: 15000 }],
    });
  });

  it("AC28: refuses stale when the refunded-so-far token no longer matches", () => {
    expect(planRefund([DEPOSIT, BALANCE], 5000, 0)).toMatchObject({ ok: true });
    expect(planRefund([DEPOSIT, BALANCE], 5000, 100)).toEqual({ ok: false, reason: "stale" });
  });

  it("AC28: refuses exceeds_refundable for a cent more than the booking can give back", () => {
    expect(planRefund([DEPOSIT, BALANCE], 53625, 0)).toMatchObject({ ok: true });
    expect(planRefund([DEPOSIT, BALANCE], 53626, 0)).toEqual({ ok: false, reason: "exceeds_refundable" });
  });

  it("AC28: refuses no_payment_intent when a charge it must draw from has none", () => {
    const { stripePaymentIntentId: _pi, ...noIntent } = DEPOSIT;
    expect(planRefund([noIntent, BALANCE], 20000, 0)).toMatchObject({ ok: true });
    expect(planRefund([noIntent, BALANCE], 50000, 0)).toEqual({ ok: false, reason: "no_payment_intent" });
  });
});

describe("movedCentsOf (issue #1278)", () => {
  it("AC8: is the sum over the legs that moved, and nothing else", () => {
    expect(
      movedCentsOf([
        { paymentIntentId: "pi_a", cents: 100, outcome: "moved" },
        { paymentIntentId: "pi_b", cents: 200, outcome: "refused" },
        { paymentIntentId: "pi_c", cents: 400, outcome: "failed_later" },
        { paymentIntentId: "pi_d", cents: 800 },
        { paymentIntentId: "pi_e", cents: 1600, outcome: "moved" },
      ]),
    ).toBe(1700);
  });
});

describe("bookingPanePath (issue #1278)", () => {
  it("AC11: is the booking's pane, its id encoded", () => {
    expect(bookingPanePath(asId<"ReservationId">("resv 1/2"))).toBe("/admin/calendar/resv%201%2F2");
  });
});

describe("soldOutWho (issue #1278)", () => {
  it("AC5: is the customer's alert-safe name and party size", () => {
    expect(soldOutWho({ ...reservation, customerName: "Dana Reyes", partySize: 6 })).toBe("Dana Reyes party of 6");
    expect(soldOutWho({ ...reservation, customerName: "Dana <Reyes>", partySize: 6 })).toBe(
      `${safeForAlert("Dana <Reyes>")} party of 6`,
    );
  });
});

describe("refundAlertText — every admin text of the refund path (issue #1278)", () => {
  // The words are Wording, read at the hand-back. What is checked here is what each text carries.
  const dana: Reservation = { ...reservation, customerName: "Dana <b>Reyes</b>", partySize: 6 };
  const asked = (over: Partial<RefundRecord> = {}): RefundRecord => ({
    id: RR,
    reservationId: RESV,
    reason: "operator_refund",
    actorKind: "admin",
    actorId: ADMIN,
    askedCents: 59400,
    expectedRefundedCents: 0,
    movedCents: 0,
    state: "unfinished",
    createdAt: NOW,
    claimedAt: NOW,
    legs: [],
    ...over,
  });
  const name = safeForAlert(dana.customerName);

  it("AC11: the short text carries the amount short, the amount asked and the customer's safe name", () => {
    const record = asked({
      state: "short",
      movedCents: 25000,
      shortReason: "card_declined",
      legs: [
        { paymentIntentId: "pi_b", cents: 25000, outcome: "moved" },
        { paymentIntentId: "pi_d", cents: 34400, outcome: "refused" },
      ],
    });
    const text = refundAlertText("short", record, dana);
    expect(text).toContain(formatCents(34400));
    expect(text).toContain(formatCents(59400));
    expect(text).toContain(name);
    expect(text).not.toContain("<b>");
  });

  it("AC23: the gave-up text carries the amount and the customer's safe name", () => {
    const text = refundAlertText("gave_up", asked({ state: "short", shortReason: "not_confirmed_in_24_hours" }), dana);
    expect(text).toContain(formatCents(59400));
    expect(text).toContain(name);
  });

  it("AC24: the failed-at-the-bank text carries that leg's amount and the customer's safe name", () => {
    const failed: RefundLeg = { paymentIntentId: "pi_d", cents: 34400, outcome: "failed_later" };
    const text = refundAlertText(
      "failed_later",
      asked({ state: "short", legs: [{ paymentIntentId: "pi_b", cents: 25000, outcome: "moved" }, failed] }),
      dana,
      failed,
    );
    expect(text).toContain(formatCents(34400));
    expect(text).toContain(name);
  });

  it("AC15: the notice-in-doubt text names the customer", () => {
    expect(refundAlertText("notice_in_doubt", asked({ reason: "customer_cancel" }), dana)).toContain(name);
  });

  const soldOut = (over: Partial<RefundRecord> = {}): RefundRecord => {
    const { actorId: _admin, ...record } = asked({
      id: asId<"RefundRecordId">("rr_sold_out_pi_3Qlost"),
      reason: "sold_out",
      actorKind: "engine",
      askedCents: 59400,
      legs: [{ paymentIntentId: "pi_3Qlost", cents: 59400 }],
      ...over,
    });
    return record;
  };

  it("AC5: the sold-out-not-confirmed text names the charge, the amount and the customer's tail", () => {
    const text = refundAlertText("sold_out_unknown", soldOut(), dana);
    expect(text).toContain("pi_3Qlost");
    expect(text).toContain(formatCents(59400));
    expect(text).toContain(soldOutWho(dana));
  });

  it("AC11: the sold-out-short text names the charge, the cause and the customer's tail", () => {
    const text = refundAlertText("sold_out_short", soldOut({ state: "short", shortReason: "charge_already_refunded" }), dana);
    expect(text).toContain("pi_3Qlost");
    expect(text).toContain("charge_already_refunded");
    expect(text).toContain(soldOutWho(dana));
  });

  it("AC11: every kind reads differently", () => {
    const record = asked({ state: "short", shortReason: "card_declined", legs: [{ paymentIntentId: "pi_b", cents: 59400, outcome: "failed_later" }] });
    const texts = (["short", "gave_up", "failed_later", "notice_in_doubt", "sold_out_short", "sold_out_unknown"] as const).map(
      (kind) => refundAlertText(kind, kind.startsWith("sold_out") ? soldOut({ state: "short", shortReason: "x" }) : record, dana, record.legs[0]),
    );
    expect(new Set(texts).size).toBe(6);
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

  it("refuses a DECIMAL comma rather than reading it as a thousands separator", () => {
    // The 100x bug (security review). `"1,50"` stripped to `"150"` is $150.00 against an
    // intended $1.50 — and every downstream number agrees with it, so nothing catches it
    // except a refundable ceiling that a large enough booking clears.
    expect(parseDollarsToCents("1,50")).toBeNull();
    expect(parseDollarsToCents("1,5")).toBeNull();
    expect(parseDollarsToCents("536,25")).toBeNull();
    expect(parseDollarsToCents("1,2345")).toBeNull();
    expect(parseDollarsToCents("1,23.45")).toBeNull();
    expect(parseDollarsToCents("12,34,567")).toBeNull();
    // Real thousands grouping still parses — operators paste it from Stripe.
    expect(parseDollarsToCents("1,536.25")).toBe(153625);
    expect(parseDollarsToCents("1,234,567")).toBe(123456700);
    expect(parseDollarsToCents("536.25")).toBe(53625);
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
