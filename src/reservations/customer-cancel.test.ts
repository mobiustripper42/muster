/**
 * Self-service cancellation (16.9, issue #1074) — the customer cancels from `/b/<code>` and gets
 * back what the published terms owe, with nobody at BrewBoat having to act.
 *
 * Every money figure here is asserted against a payment that carries tax, a tip and a service fee,
 * for the reason `cancel-reservation.test.ts` gives (#797): a payment without them cannot tell
 * "everything back but the $50" from "the fare back but the $50".
 */
import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { zonedWallClockToInstant } from "../config/tenant.js";
import type { BookingInvoice, Event, Payment, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { seedFleet } from "../import/resource-map.js";
import type { TrailEvent } from "../domain/reservation-trail.js";
import {
  cancelByCustomer,
  cancelledNoticeFrom,
  customerCancelQuote,
  manageRedirectFor,
  type CustomerCancelOutcome,
} from "./customer-cancel.js";

const VESSEL = asId<"VesselId">("vessel-brew-2"); // seeded by the fleet
const RESV = asId<"ReservationId">("resv-self-cancel-1");
const NOW = "2026-08-01T16:00:00.000Z";

/** 24 days out — outside both windows. */
const FAR = { date: "2026-08-25", time: "15:30" };
/** 5 days out — inside the 14-day window, outside the 72-hour one. */
const NEAR = { date: "2026-08-06", time: "15:30" };

const HOUR = 3_600_000;
const departureOf = (slot: { date: string; time: string }) => zonedWallClockToInstant(slot.date, slot.time);
const eventIdOf = (slot: { date: string; time: string }) =>
  asId<"EventId">(`slot_${VESSEL}|${slot.date}|${slot.time}`);

/** $500 fare, 8% tax, 3% fee on fare + tip, 20% tip. */
const UNINSURED_INVOICE: BookingInvoice = {
  fareCents: 50000,
  extrasCents: 0,
  taxCents: 4000,
  taxRateBps: 800,
  serviceFeeCents: 1800,
  serviceFeeBps: 300,
  gratuityCents: 10000,
  gratuityBps: 2000,
  totalCents: 65800,
  amountDueNowCents: 65800,
};
const UNINSURED_PAID = 65800;

/** The same trip with the $30 insurance: tax on $530, fee on $630. */
const INSURED_INVOICE: BookingInvoice = {
  ...UNINSURED_INVOICE,
  flexCents: 3000,
  taxCents: 4240,
  serviceFeeCents: 1890,
  totalCents: 69130,
  amountDueNowCents: 69130,
};
const INSURED_PAID = 69130;

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: asId<"PaymentId">("pay-full"),
  reservationId: RESV,
  method: "stripe",
  kind: "full",
  amountCents: UNINSURED_PAID,
  taxCents: 4000,
  gratuityCents: 10000,
  serviceFeeCents: 1800,
  currency: "usd",
  status: "succeeded",
  stripePaymentIntentId: "pi_full",
  createdAt: "2026-07-01T10:00:00.000Z",
  ...over,
});

const insuredPayment = (over: Partial<Payment> = {}): Payment =>
  payment({ amountCents: INSURED_PAID, taxCents: 4240, serviceFeeCents: 1890, flexCents: 3240, ...over });

const event = (slot = FAR, over: Partial<Event> = {}): Event => ({
  id: eventIdOf(slot),
  vesselId: VESSEL,
  date: slot.date,
  time: slot.time,
  capacity: 16,
  status: "scheduled",
  source: "muster",
  price: 50000,
  ...over,
});

const reservation = (slot = FAR, over: Partial<Reservation> = {}): Reservation => ({
  id: RESV,
  eventId: eventIdOf(slot),
  source: "muster",
  customerName: "Rhea Tallis",
  partySize: 6,
  status: "booked",
  invoice: UNINSURED_INVOICE,
  ...over,
});

interface World {
  slot?: { date: string; time: string };
  reservation?: Partial<Reservation>;
  payments?: Payment[];
  /** Leave the event unwritten — a booked row whose event is gone. */
  noEvent?: boolean;
}

async function seeded(w: World = {}): Promise<InMemoryRepository> {
  const slot = w.slot ?? FAR;
  const repo = new InMemoryRepository();
  await seedFleet(repo);
  if (!w.noEvent) await repo.saveEvent(event(slot));
  await repo.saveReservation(reservation(slot, w.reservation));
  for (const p of w.payments ?? [payment()]) await repo.savePayment(p);
  return repo;
}

const deps = (repo: InMemoryRepository, payments = new FakePaymentPort(), relay?: (f: unknown) => Promise<void>) => ({
  repo,
  now: () => NOW,
  payments,
  ...(relay ? { relayFormNotices: relay as never } : {}),
});

const trail = (repo: InMemoryRepository) => repo.listTrailEventsFor(RESV, []);
const refundedSum = (fake: FakePaymentPort) => fake.refunds.reduce((s, r) => s + (r.amountCents ?? 0), 0);

/** Nothing was cancelled, refunded or written. */
async function expectUntouched(repo: InMemoryRepository, fake: FakePaymentPort, slot = FAR): Promise<void> {
  expect((await repo.getReservation(RESV))?.status).not.toBe("cancelled");
  expect((await repo.getEvent(eventIdOf(slot)))?.status).toBe("scheduled");
  expect(fake.refunds).toEqual([]);
  expect(await trail(repo)).toEqual([]);
}

// ── customerCancelQuote ────────────────────────────────────────────────────────

describe("customerCancelQuote", () => {
  const quote = (o: {
    slot?: { date: string; time: string };
    reservation?: Partial<Reservation>;
    event?: Event | null;
    payments?: Payment[];
    now?: Date;
  }) => {
    const slot = o.slot ?? FAR;
    return customerCancelQuote({
      reservation: reservation(slot, o.reservation),
      event: o.event === undefined ? event(slot) : o.event,
      payments: o.payments ?? [payment()],
      now: o.now ?? new Date(NOW),
    });
  };

  it("AC1: an uninsured booking 14+ days out quotes everything paid minus the $50 — tax, fee and tip included", () => {
    expect(quote({})).toEqual({
      refundCents: UNINSURED_PAID - 5000,
      expectedRefundedCents: 0,
      basis: "fee",
      keptCents: 5000,
    });
  });

  it("AC2: an insured booking 72+ hours out quotes everything paid minus the insurance, with no $50", () => {
    // 5 days out: inside 14 days, so only the insurance makes this refundable. The insurance's own
    // tax ($2.40) is NOT withheld — BrewBoat absorbs it.
    expect(
      quote({ slot: NEAR, reservation: { invoice: INSURED_INVOICE }, payments: [insuredPayment()] }),
    ).toEqual({
      refundCents: INSURED_PAID - 3000,
      expectedRefundedCents: 0,
      basis: "insurance",
      keptCents: 3000,
    });
  });

  it("AC2: discounted insurance keeps what was charged for it, not the list $30", () => {
    // A discount past the whole fare reaches the insurance: $502.50 off a $500 fare leaves $27.50
    // of insurance charged, plus its tax.
    const invoice: BookingInvoice = {
      ...INSURED_INVOICE,
      discountCents: 50250,
      taxCents: 220,
      serviceFeeCents: 83,
      gratuityCents: 0,
      totalCents: 3053,
      amountDueNowCents: 3053,
    };
    const q = quote({
      slot: NEAR,
      reservation: { invoice },
      payments: [payment({ amountCents: 3053, taxCents: 220, gratuityCents: 0, serviceFeeCents: 83, flexCents: 2970 })],
    });
    expect(q).toEqual({ refundCents: 3053 - 2750, expectedRefundedCents: 0, basis: "insurance", keptCents: 2750 });
  });

  it("AC3: an uninsured booking under 14 days out is not offered", () => {
    expect(quote({})).not.toBeNull(); // the same booking, outside the window, is
    expect(quote({ slot: NEAR })).toBeNull();
  });

  it("AC3: an insured booking under 72 hours out is not offered", () => {
    const insured = { slot: NEAR, reservation: { invoice: INSURED_INVOICE }, payments: [insuredPayment()] };
    expect(quote(insured)).not.toBeNull();
    expect(quote({ ...insured, now: new Date(departureOf(NEAR).getTime() - 71 * HOUR) })).toBeNull();
  });

  it("AC4: an uninsured booking 14+ days out with $50 or less paid is not offered — a $0 refund", () => {
    expect(quote({})).not.toBeNull();
    expect(quote({ payments: [payment({ amountCents: 5000, taxCents: 0, gratuityCents: 0, serviceFeeCents: 0 })] })).toBeNull();
    expect(quote({ payments: [payment({ amountCents: 4000, taxCents: 0, gratuityCents: 0, serviceFeeCents: 0 })] })).toBeNull();
  });

  it("AC5: exactly 14 days before departure is refundable", () => {
    const now = new Date(departureOf(FAR).getTime() - 14 * 24 * HOUR);
    expect(quote({ now })?.refundCents).toBe(UNINSURED_PAID - 5000);
  });

  it("AC5: an insured booking exactly 72 hours before departure is refundable", () => {
    const now = new Date(departureOf(NEAR).getTime() - 72 * HOUR);
    expect(
      quote({ slot: NEAR, reservation: { invoice: INSURED_INVOICE }, payments: [insuredPayment()], now })?.refundCents,
    ).toBe(INSURED_PAID - 3000);
  });

  it("AC7: expectedRefundedCents is what has already gone back, and the quote nets it", () => {
    const q = quote({ payments: [payment({ refundedCents: 800, status: "partially_refunded" })] });
    expect(q).toMatchObject({ refundCents: UNINSURED_PAID - 800 - 5000, expectedRefundedCents: 800 });
  });

  it.each<[string, Parameters<typeof quote>[0]]>([
    ["a Xola booking", { reservation: { source: "xola" } }],
    ["an unpaid phone booking", { reservation: { source: "admin", status: "pending", eventId: null } }],
    ["a pending row", { reservation: { status: "pending", eventId: null } }],
    ["a cancelled booking", { reservation: { status: "cancelled", cancelledBy: "operator" } }],
    ["a booking with no event", { event: null }],
  ])("AC9: %s is not offered", (_label, variant) => {
    expect(quote({})).not.toBeNull();
    expect(quote(variant)).toBeNull();
  });

  it("AC9: a departure at this exact instant counts as departed and is not offered", () => {
    const insured = { reservation: { invoice: INSURED_INVOICE }, payments: [insuredPayment()] };
    expect(quote(insured)).not.toBeNull();
    expect(quote({ ...insured, now: departureOf(FAR) })).toBeNull();
  });
});

// ── cancelByCustomer ───────────────────────────────────────────────────────────

describe("cancelByCustomer", () => {
  const FEE_REFUND = UNINSURED_PAID - 5000;
  const posted = (quotedCents = FEE_REFUND, expectedRefundedCents = 0) => ({ quotedCents, expectedRefundedCents });

  it("AC1: cancels the booking and its event as the customer's, and refunds paid minus $50", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();

    const outcome = await cancelByCustomer(deps(repo, fake), RESV, posted());

    expect(outcome).toEqual({ ok: true, refund: { kind: "issued", cents: FEE_REFUND } });
    expect(await repo.getReservation(RESV)).toMatchObject({ status: "cancelled", cancelledBy: "customer" });
    expect((await repo.getEvent(eventIdOf(FAR)))?.status).toBe("cancelled");
    expect(fake.refunds).toHaveLength(1);
    expect(fake.refunds[0]).toMatchObject({ paymentIntentId: "pi_full", amountCents: FEE_REFUND });
    expect((await repo.getPayment(asId<"PaymentId">("pay-full")))?.refundedCents).toBe(FEE_REFUND);
  });

  it("AC2: an insured booking 72+ hours out refunds everything but the insurance", async () => {
    const repo = await seeded({ slot: NEAR, reservation: { invoice: INSURED_INVOICE }, payments: [insuredPayment()] });
    const fake = new FakePaymentPort();

    const outcome = await cancelByCustomer(deps(repo, fake), RESV, posted(INSURED_PAID - 3000));

    expect(outcome).toEqual({ ok: true, refund: { kind: "issued", cents: INSURED_PAID - 3000 } });
    expect(refundedSum(fake)).toBe(INSURED_PAID - 3000);
    expect((await repo.getReservation(RESV))?.status).toBe("cancelled");
  });

  it("AC3: a post for a booking inside its window, with no figure above $0, refuses not_offered and changes nothing", async () => {
    const repo = await seeded({ slot: NEAR });
    const fake = new FakePaymentPort();

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted(0))).toEqual({ ok: false, reason: "not_offered" });
    await expectUntouched(repo, fake, NEAR);
  });

  it("AC4: a post for a $0 refund outside the window refuses not_offered and changes nothing", async () => {
    const repo = await seeded({ payments: [payment({ amountCents: 5000, taxCents: 0, gratuityCents: 0, serviceFeeCents: 0 })] });
    const fake = new FakePaymentPort();

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted(0))).toEqual({ ok: false, reason: "not_offered" });
    await expectUntouched(repo, fake);
  });

  it("AC6: a figure that changed but is still above $0 refuses quote_changed with the new figure, and cancels nothing", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted(FEE_REFUND + 100))).toEqual({
      ok: false,
      reason: "quote_changed",
      newRefundCents: FEE_REFUND,
    });
    await expectUntouched(repo, fake);
  });

  it("AC6: a page left open across the window line refuses quote_changed at $0, and cancels nothing", async () => {
    // The confirm showed a figure; by the press the booking is inside 14 days.
    const repo = await seeded({ slot: NEAR });
    const fake = new FakePaymentPort();

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted(FEE_REFUND))).toEqual({
      ok: false,
      reason: "quote_changed",
      newRefundCents: 0,
    });
    await expectUntouched(repo, fake, NEAR);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["missing (NaN)", Number.NaN],
  ])("AC6: a posted figure that is %s is not_offered even on a booking that is still offered", async (_label, quotedCents) => {
    const repo = await seeded();
    const fake = new FakePaymentPort();

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted(quotedCents))).toEqual({
      ok: false,
      reason: "not_offered",
    });
    await expectUntouched(repo, fake);
  });

  it("AC7: a second post for a booking it already cancelled cancels and refunds nothing again", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    expect((await cancelByCustomer(deps(repo, fake), RESV, posted())).ok).toBe(true);

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted())).toEqual({ ok: false, reason: "already_cancelled" });
    expect(fake.refunds).toHaveLength(1);
    expect((await trail(repo)).filter((e) => e.type === "cancelled")).toHaveLength(1);
  });

  it("AC7: a booking already cancelled at the read returns already_cancelled — no trail row, no refund", async () => {
    const repo = await seeded({ reservation: { status: "cancelled", cancelledBy: "customer" } });
    const fake = new FakePaymentPort();

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted())).toEqual({ ok: false, reason: "already_cancelled" });
    expect(fake.refunds).toEqual([]);
    expect(await trail(repo)).toEqual([]);
  });

  it("AC7: cancelReservation answering alreadyCancelled returns already_cancelled — no trail row, no refund", async () => {
    // Another press cancelled between this press's read and its cancel: the read sees `booked`,
    // `cancelReservation`'s own read sees `cancelled`.
    const repo = await seeded({ reservation: { status: "cancelled", cancelledBy: "customer" } });
    const real = repo.getReservation.bind(repo);
    let reads = 0;
    repo.getReservation = async (id) => {
      const row = await real(id);
      if (reads++ > 0 || !row) return row;
      const { cancelledBy: _by, ...live } = row;
      return { ...live, status: "booked" };
    };
    const fake = new FakePaymentPort();

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted())).toEqual({ ok: false, reason: "already_cancelled" });
    expect(fake.refunds).toEqual([]);
    expect(await trail(repo)).toEqual([]);
  });

  it("AC7: a posted expectedRefundedCents that no longer matches refuses quote_changed with the current figure, and cancels nothing", async () => {
    // The figure is unchanged; only the refunded-so-far token is stale.
    const repo = await seeded();
    const fake = new FakePaymentPort();

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted(FEE_REFUND, 500))).toEqual({
      ok: false,
      reason: "quote_changed",
      newRefundCents: FEE_REFUND,
    });
    await expectUntouched(repo, fake);
  });

  it("AC7: stale because another press refunded it while holding the lease is already_cancelled — no refund_failed row", async () => {
    const repo = await seeded();
    await repo.acquireRefundLease(RESV, "the-other-press", NOW, "2026-08-01T16:01:00.000Z");
    // The other press, holding the lease, lands its refund for the same figure.
    const realAcquire = repo.acquireRefundLease.bind(repo);
    let landed = false;
    repo.acquireRefundLease = async (...args) => {
      if (!landed) {
        landed = true;
        await repo.markPaymentRefunded(asId<"PaymentId">("pay-full"), FEE_REFUND);
      }
      return realAcquire(...args);
    };
    const fake = new FakePaymentPort();

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted())).toEqual({ ok: false, reason: "already_cancelled" });
    expect(fake.refunds).toEqual([]);
    expect((await trail(repo)).filter((e) => e.type === "refund_failed")).toEqual([]);
  });

  it("AC7: stale with nothing refunded by anyone ends as a failed refund with a refund_failed row", async () => {
    const repo = await seeded();
    await repo.acquireRefundLease(RESV, "an-operator-refund", NOW, "2026-08-01T16:01:00.000Z");
    const fake = new FakePaymentPort();

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted())).toEqual({
      ok: true,
      refund: { kind: "failed", cents: FEE_REFUND, movedCents: 0 },
    });
    expect((await repo.getReservation(RESV))?.status).toBe("cancelled");
    expect((await trail(repo)).filter((e) => e.type === "refund_failed")).toMatchObject([
      { actorKind: "customer", metadata: { actualCents: 0 } },
    ]);
  });

  it("AC8: a provider error after the cancel leaves it cancelled, reports failed, and writes refund_failed", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    fake.refundError = new Error("card_declined");

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted())).toEqual({
      ok: true,
      refund: { kind: "failed", cents: FEE_REFUND, movedCents: 0 },
    });
    expect((await repo.getReservation(RESV))?.status).toBe("cancelled");
    expect((await repo.getEvent(eventIdOf(FAR)))?.status).toBe("cancelled");
    expect((await trail(repo)).filter((e) => e.type === "refund_failed")).toMatchObject([
      { actorKind: "customer", type: "refund_failed", metadata: { actualCents: 0 } },
    ]);
  });

  it("AC8: a partial provider error reports what moved, and refund_failed records it", async () => {
    // Deposit $200 then balance $458: the refund takes the balance whole, then fails on the deposit.
    const repo = await seeded({
      payments: [
        payment({ id: asId<"PaymentId">("pay-deposit"), kind: "deposit", amountCents: 20000, stripePaymentIntentId: "pi_deposit", createdAt: "2026-07-01T10:00:00.000Z" }),
        payment({ id: asId<"PaymentId">("pay-balance"), kind: "balance", amountCents: 45800, taxCents: 0, gratuityCents: 0, serviceFeeCents: 0, stripePaymentIntentId: "pi_balance", createdAt: "2026-07-20T10:00:00.000Z" }),
      ],
    });
    const fake = new FakePaymentPort();
    const realRefund = fake.refund.bind(fake);
    let legs = 0;
    fake.refund = async (input) => {
      if (legs++ > 0) throw new Error("card_declined");
      return realRefund(input);
    };

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted())).toEqual({
      ok: true,
      refund: { kind: "failed", cents: FEE_REFUND, movedCents: 45800 },
    });
    expect((await repo.getReservation(RESV))?.status).toBe("cancelled");
    expect((await trail(repo)).filter((e) => e.type === "refund_failed")).toMatchObject([
      { actorKind: "customer", metadata: { actualCents: 45800 } },
    ]);
  });

  it("AC8: any other refund refusal after the cancel is a failed refund with movedCents 0", async () => {
    // No PaymentIntent on the row: `refundReservation` refuses `no_payment_intent` before moving anything.
    const { stripePaymentIntentId: _pi, ...noIntent } = payment();
    const repo = await seeded({ payments: [noIntent] });
    const fake = new FakePaymentPort();

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted())).toEqual({
      ok: true,
      refund: { kind: "failed", cents: FEE_REFUND, movedCents: 0 },
    });
    expect((await repo.getReservation(RESV))?.status).toBe("cancelled");
    expect((await trail(repo)).filter((e) => e.type === "refund_failed")).toMatchObject([
      { actorKind: "customer", metadata: { actualCents: 0 } },
    ]);
  });

  it("AC8: refundReservation throwing after the cancel is caught and reported as a failed refund", async () => {
    const repo = await seeded();
    repo.acquireRefundLease = async () => {
      throw new Error("database unreachable");
    };
    const fake = new FakePaymentPort();

    await expect(cancelByCustomer(deps(repo, fake), RESV, posted())).resolves.toEqual({
      ok: true,
      refund: { kind: "failed", cents: FEE_REFUND, movedCents: 0 },
    });
    expect((await repo.getReservation(RESV))?.status).toBe("cancelled");
    expect((await trail(repo)).filter((e) => e.type === "refund_failed")).toMatchObject([
      { actorKind: "customer", metadata: { actualCents: 0 } },
    ]);
  });

  it("AC8: cancelReservation throwing after its status write carries on — the cancelled row is written and the refund issued", async () => {
    // `cancelReservation` writes the status, then releases the hull through `cancelEventIfUnclaimed`
    // (cancel-reservation.ts:241, :262). A throw there leaves the booking cancelled: the cancel has
    // committed, so the press must still record it and send the money.
    const repo = await seeded();
    repo.cancelEventIfUnclaimed = async () => {
      throw new Error("hull-day lock timed out");
    };
    const fake = new FakePaymentPort();

    await expect(cancelByCustomer(deps(repo, fake), RESV, posted())).resolves.toEqual({
      ok: true,
      refund: { kind: "issued", cents: FEE_REFUND },
    });
    expect(await repo.getReservation(RESV)).toMatchObject({ status: "cancelled", cancelledBy: "customer" });
    expect((await trail(repo)).filter((e) => e.type === "cancelled")).toMatchObject([
      { actorKind: "customer", metadata: { reason: "cancelled by the customer from the booking page", quotedCents: FEE_REFUND } },
    ]);
    expect(fake.refunds).toHaveLength(1);
    expect(refundedSum(fake)).toBe(FEE_REFUND);
  });

  it("AC8: cancelReservation throwing before its status write propagates the throw — nothing cancelled, refunded or written", async () => {
    // The re-read finds the booking still booked: nothing changed, so the action's `cancel_failed`
    // ("Nothing changed") is true and the throw must reach it.
    const repo = await seeded();
    repo.saveReservation = async () => {
      throw new Error("database unreachable");
    };
    const fake = new FakePaymentPort();

    await expect(cancelByCustomer(deps(repo, fake), RESV, posted())).rejects.toThrow("database unreachable");
    await expectUntouched(repo, fake);
  });

  it("AC9: a post for a departed booking that carries a figure refuses quote_changed at $0", async () => {
    // Insured, so only the departure — not the 14-day window — is between this and a refund.
    const repo = await seeded({ reservation: { invoice: INSURED_INVOICE }, payments: [insuredPayment()] });
    const fake = new FakePaymentPort();
    const atDeparture = { ...deps(repo, fake), now: () => departureOf(FAR).toISOString() };

    expect(await cancelByCustomer(atDeparture, RESV, posted(INSURED_PAID - 3000))).toEqual({
      ok: false,
      reason: "quote_changed",
      newRefundCents: 0,
    });
    await expectUntouched(repo, fake);
  });

  it.each<[string, World]>([
    ["a Xola booking", { reservation: { source: "xola" } }],
    ["a pending row", { reservation: { status: "pending", eventId: null } }],
    ["a booked row whose event is gone", { noEvent: true }],
  ])("AC9: a post for %s refuses not_offered and changes nothing", async (_label, world) => {
    const repo = await seeded(world);
    const fake = new FakePaymentPort();

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted())).toEqual({ ok: false, reason: "not_offered" });
    expect((await repo.getReservation(RESV))?.status).not.toBe("cancelled");
    expect(fake.refunds).toEqual([]);
    expect(await trail(repo)).toEqual([]);
  });

  it("AC10: a cancel by this press writes one cancelled row, the customer's, carrying the refund figure", async () => {
    const repo = await seeded();

    await cancelByCustomer(deps(repo), RESV, posted());

    const rows = await trail(repo);
    expect(rows.map((e) => e.type)).toEqual(["cancelled"]);
    expect(rows[0]).toMatchObject({
      reservationId: RESV,
      actorKind: "customer",
      type: "cancelled",
      metadata: { reason: "cancelled by the customer from the booking page", quotedCents: FEE_REFUND },
    });
  });

  it("AC12: the crew are told and the hull is freed — the re-form is relayed and the event cancelled", async () => {
    const repo = await seeded();
    const relayed: unknown[] = [];

    await cancelByCustomer(
      deps(repo, new FakePaymentPort(), async (f) => {
        relayed.push(f);
      }),
      RESV,
      posted(),
    );

    expect((await repo.getEvent(eventIdOf(FAR)))?.status).toBe("cancelled");
    expect(relayed).toHaveLength(1);
  });
});

// ── cancelledNoticeFrom ────────────────────────────────────────────────────────

describe("cancelledNoticeFrom", () => {
  const QUOTED = 60800;
  let seq = 0;
  /** One trail row, timestamps rising in the order rows are built — the trail is oldest first. */
  const row = (type: TrailEvent["type"], over: Partial<TrailEvent> = {}): TrailEvent => {
    seq += 1;
    return {
      id: asId<"TrailEventId">(`${type}:${seq}`),
      reservationId: RESV,
      actorKind: "engine",
      type,
      timestamp: new Date(Date.parse(NOW) + seq * 1000).toISOString(),
      metadata: {},
      ...over,
    };
  };
  const customerCancelled = () =>
    row("cancelled", {
      actorKind: "customer",
      metadata: { reason: "cancelled by the customer from the booking page", quotedCents: QUOTED },
    });
  const refundFailed = () => row("refund_failed", { actorKind: "customer", metadata: { actualCents: 0 } });
  const refunded = () => row("refunded", { actorKind: "stripe" });

  it("AC8: a cancel whose refund went through is issued, at the cancelled row's quotedCents", () => {
    expect(cancelledNoticeFrom([customerCancelled(), refunded()])).toEqual({ kind: "issued", cents: QUOTED });
  });

  it("AC8: a cancelled row alone is issued", () => {
    expect(cancelledNoticeFrom([customerCancelled()])).toEqual({ kind: "issued", cents: QUOTED });
  });

  it("AC8: a refund_failed row after the customer cancelled row is failed", () => {
    expect(cancelledNoticeFrom([customerCancelled(), refundFailed()])).toEqual({ kind: "failed", cents: QUOTED });
  });

  it("AC8: a refunded row after the refund_failed row is issued — the operator re-sent it", () => {
    expect(cancelledNoticeFrom([customerCancelled(), refundFailed(), refunded()])).toEqual({
      kind: "issued",
      cents: QUOTED,
    });
  });

  it("AC8: a refund_failed row before the customer cancelled row does not make it failed", () => {
    // An earlier operator refund that failed is not this cancel's refund.
    const earlier = row("refund_failed", { actorKind: "admin", metadata: { actualCents: 0 } });
    expect(cancelledNoticeFrom([earlier, customerCancelled()])).toEqual({ kind: "issued", cents: QUOTED });
  });

  it("AC10: with no customer cancelled row there is no notice — an operator's cancel is not one", () => {
    expect(cancelledNoticeFrom([customerCancelled()])).not.toBeNull(); // the control
    expect(cancelledNoticeFrom([])).toBeNull();
    expect(cancelledNoticeFrom([row("cancelled", { actorKind: "admin", metadata: { reason: "weather" } })])).toBeNull();
  });
});

// ── manageRedirectFor ──────────────────────────────────────────────────────────

describe("manageRedirectFor", () => {
  const CODE = "K3F9QZ2MX7RN4P";
  const to = (outcome: CustomerCancelOutcome, code = CODE) => manageRedirectFor(code, outcome);

  it("AC1: an issued refund lands on the cancelled page's issued notice — no figure in the URL", () => {
    expect(to({ ok: true, refund: { kind: "issued", cents: 41240 } })).toBe(`/b/${CODE}?cancelled=1&refund=issued`);
  });

  it("AC8: a failed refund lands on the cancelled page's failed notice — no figure in the URL", () => {
    expect(to({ ok: true, refund: { kind: "failed", cents: 41240, movedCents: 0 } })).toBe(
      `/b/${CODE}?cancelled=1&refund=failed`,
    );
  });

  it("AC6: a changed figure still above $0 re-opens the confirm with cancel_changed", () => {
    expect(to({ ok: false, reason: "quote_changed", newRefundCents: 41000 })).toBe(
      `/b/${CODE}?cancel=1&error=cancel_changed`,
    );
  });

  it("AC6: a figure now $0 renders the page without the confirm, with cancel_closed", () => {
    expect(to({ ok: false, reason: "quote_changed", newRefundCents: 0 })).toBe(`/b/${CODE}?error=cancel_closed`);
  });

  it("AC7: already_cancelled goes to the plain booking page, the code encoded into the path", () => {
    expect(to({ ok: false, reason: "already_cancelled" })).toBe(`/b/${CODE}`);
    expect(to({ ok: false, reason: "already_cancelled" }, "AB CD/1")).toBe("/b/AB%20CD%2F1");
  });

  it("AC3: not_offered, and every other refusal, is cancel_failed", () => {
    expect(to({ ok: false, reason: "not_offered" })).toBe(`/b/${CODE}?error=cancel_failed`);
    expect(to({ ok: false, reason: "reservation_missing" })).toBe(`/b/${CODE}?error=cancel_failed`);
  });
});
