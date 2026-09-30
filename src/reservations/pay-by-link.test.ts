/**
 * The customer pays an operator's phone booking through the payment link (issue #1082 part B,
 * SPEC §2.10.6) — and the races the issue asks to be tested rather than assumed.
 *
 * The row is the operator's `admin` pending row (`operator-booking.ts`). Each attempt at `/p`
 * attaches an intent to that row with the checkout's own reuse rules (15.8, 15.10, 15.11), and the
 * ordinary confirm books it (§2.8.6) — so these drive the real confirm, not a stand-in.
 */
import { describe, expect, it, vi } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Offering, Reservation, Vessel } from "../domain/entities.js";
import { asId, type ReservationId } from "../domain/ids.js";
import type { WebhookDeps } from "./booking-webhook.js";
import { cancelReservation, cancelUnpaidPhoneBooking } from "./cancel-reservation.js";
import { confirmBookingFromIntent } from "./confirm-booking.js";
import { bookForCustomer } from "./operator-booking.js";
import { maskedPhone, payLinkMoney, payLinkState, startPayByLink } from "./pay-by-link.js";

const BOAT = asId<"VesselId">("v-boat");
const OFF = asId<"OfferingId">("off-1");
const DATE = "2026-07-04";
const TIME = "13:30";
const NOW = "2026-07-01T12:00:00.000Z";
const now = () => NOW;

const vessel: Vessel = { id: BOAT, name: "Brew 3", coiMaxPax: 12, manning: [] };
const offering: Offering = {
  id: OFF,
  tenantId: asId<"TenantId">("t"),
  name: "Reservation Demo Cruise",
  status: "live",
  vesselIds: [BOAT],
  locationId: asId<"LocationId">("loc-1"),
  schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5, 6], departureTimes: [TIME] },
  basePriceCents: 49900,
  priceVariations: [],
  extraGuestPriceCents: 5000,
  tripLengthMinutes: 100,
  holdMinutes: 120,
};

/** A world with one operator's phone booking in it, unpaid. */
async function phoneBooked(email?: string): Promise<{ repo: InMemoryRepository; row: Reservation }> {
  const repo = new InMemoryRepository();
  await repo.saveOffering(offering);
  await repo.saveVessel(vessel);
  const res = await bookForCustomer(
    repo,
    {
      offeringId: OFF,
      vesselId: BOAT,
      date: DATE,
      time: TIME,
      guestCount: 2,
      gratuityBps: 2000,
      customerName: "Phone Caller",
      phone: "216-555-0199",
      ...(email ? { email } : {}),
    },
    now,
  );
  if (!res.ok) throw new Error(`fixture refused: ${res.reason}`);
  return { repo, row: res.reservation };
}

function webhookDeps(repo: InMemoryRepository, payments: FakePaymentPort) {
  const alert = vi.fn(async (_m: string) => {});
  const soldOut = vi.fn(async (_c: unknown) => {});
  const deps: WebhookDeps = {
    repo,
    payments,
    now,
    alertPaidButUnbooked: alert,
    sendConfirmation: vi.fn(async () => true),
    notifyCustomerSoldOut: soldOut,
  };
  return { deps, alert, soldOut };
}

/** The customer's card goes through on this intent — what Stripe reports afterwards. */
function pay(payments: FakePaymentPort, paymentIntentId: string, amountCents: number): void {
  payments.intentStates.set(paymentIntentId, "settled");
  payments.succeededIntents.set(paymentIntentId, {
    paymentIntentId,
    amountReceivedCents: amountCents,
    currency: "usd",
    metadata: {},
  });
}

const start = (repo: InMemoryRepository, payments: FakePaymentPort, id: ReservationId) =>
  startPayByLink({ repo, payments, now }, id);

describe("startPayByLink — the customer pays the operator's booking", () => {
  it("charges the invoice frozen at booking, on the operator's own row, and books it on confirm", async () => {
    const { repo, row } = await phoneBooked("caller@example.com");
    const payments = new FakePaymentPort();

    const res = await start(repo, payments, row.id);
    expect(res).toMatchObject({ ok: true, paymentIntentId: "pi_fake_1" });
    expect(payments.intents).toHaveLength(1);
    expect(payments.intents[0]).toMatchObject({
      amountCents: row.invoice!.amountDueNowCents,
      receiptEmail: "caller@example.com",
      metadata: {},
    });
    expect(payments.intents[0]!.description).toContain("Phone Caller");
    // Still the operator's unpaid row, now carrying the intent confirm will find it by.
    expect(await repo.getReservation(row.id)).toMatchObject({
      source: "admin",
      status: "pending",
      paymentIntentIds: ["pi_fake_1"],
    });

    pay(payments, "pi_fake_1", row.invoice!.amountDueNowCents);
    const { deps } = webhookDeps(repo, payments);
    const confirmed = await confirmBookingFromIntent(deps, (await payments.getSucceededPaymentIntent("pi_fake_1"))!);
    expect(confirmed).toMatchObject({ handled: true, outcome: "booked" });
    expect(await repo.getReservation(row.id)).toMatchObject({ source: "muster", status: "booked" });
  });

  it("opening the link again (a second tab, or a second link for the same row) reuses the intent", async () => {
    const { repo, row } = await phoneBooked();
    const payments = new FakePaymentPort();

    const first = await start(repo, payments, row.id);
    const second = await start(repo, payments, row.id);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.paymentIntentId).toBe(first.paymentIntentId);
    // One payable intent for one booking — never two the customer could both pay.
    expect(payments.intents).toHaveLength(1);
  });

  it("paid in the other tab but not confirmed yet: the next attempt refuses and mints nothing", async () => {
    const { repo, row } = await phoneBooked();
    const payments = new FakePaymentPort();
    await start(repo, payments, row.id);
    pay(payments, "pi_fake_1", row.invoice!.amountDueNowCents);

    expect(await start(repo, payments, row.id)).toEqual({ ok: false, reason: "already_paid" });
    expect(payments.intents).toHaveLength(1);
  });

  it("paid and confirmed: the link says it is paid and mints nothing", async () => {
    const { repo, row } = await phoneBooked();
    const payments = new FakePaymentPort();
    await start(repo, payments, row.id);
    pay(payments, "pi_fake_1", row.invoice!.amountDueNowCents);
    await confirmBookingFromIntent(webhookDeps(repo, payments).deps, (await payments.getSucceededPaymentIntent("pi_fake_1"))!);

    expect(await start(repo, payments, row.id)).toEqual({ ok: false, reason: "paid" });
    expect(payments.intents).toHaveLength(1);
  });

  it("cancelled before paying: refused, nothing minted", async () => {
    const { repo, row } = await phoneBooked();
    const payments = new FakePaymentPort();
    await cancelUnpaidPhoneBooking({ repo, now }, row.id, "operator");

    expect(await start(repo, payments, row.id)).toEqual({ ok: false, reason: "cancelled" });
    expect(payments.intents).toHaveLength(0);
  });

  it("a row that isn't an operator's booking, or doesn't exist, is refused", async () => {
    const { repo } = await phoneBooked();
    const payments = new FakePaymentPort();
    expect(await start(repo, payments, asId<"ReservationId">("resv-nope"))).toEqual({ ok: false, reason: "missing" });
    await repo.saveReservation({
      id: asId<"ReservationId">("resv-web"),
      eventId: null,
      source: "muster",
      status: "pending",
      customerName: "Web Checkout",
      partySize: 2,
      reservedAt: NOW,
      updatedAt: NOW,
    });
    expect(await start(repo, payments, asId<"ReservationId">("resv-web"))).toEqual({ ok: false, reason: "missing" });
    expect(payments.intents).toHaveLength(0);
  });
});

describe("payLinkState — what the /p page shows", () => {
  it("payable, paid, cancelled or missing", async () => {
    const { repo, row } = await phoneBooked();
    expect(payLinkState(row).kind).toBe("payable");
    expect(payLinkState(null).kind).toBe("missing");
    expect(payLinkState({ ...row, source: "muster", status: "booked" }).kind).toBe("paid");
    await cancelUnpaidPhoneBooking({ repo, now }, row.id, "customer");
    expect(payLinkState(await repo.getReservation(row.id)).kind).toBe("cancelled");
  });
});

describe("payLinkMoney — the summary is the invoice frozen at booking", () => {
  it("adds back up to exactly what the row will be charged, with the tip fixed at the operator's tier", async () => {
    const { row } = await phoneBooked();
    const inv = row.invoice!;
    const { money, tip } = payLinkMoney(inv);
    expect(tip).toEqual({ bps: 2000, tipCents: inv.gratuityCents });
    expect(money.fareCents).toBe(inv.fareCents + inv.extrasCents);
    expect(money.baseCents).toBe(inv.fareCents);
    expect(money.extrasCents).toBe(inv.extrasCents);
    // What the pay bar shows is what Stripe is asked for.
    expect(money.dueNowBeforeTipCents + tip.tipCents).toBe(inv.amountDueNowCents);
    expect(money.fareCents + money.taxCents + money.serviceFeeCents + tip.tipCents).toBe(inv.totalCents);
    expect(money.depositMode).toBe(false);
  });

  it("a deposit-mode invoice shows what is due now and what is left", async () => {
    const { row } = await phoneBooked();
    const inv = { ...row.invoice!, amountDueNowCents: 20000 + row.invoice!.gratuityCents };
    const { money } = payLinkMoney(inv);
    expect(money.depositMode).toBe(true);
    expect(money.balanceLaterCents).toBe(inv.totalCents - inv.amountDueNowCents);
  });
});

describe("maskedPhone — the already-paid page names the number without printing it", () => {
  it("keeps the area code, the exchange and the last two digits", () => {
    expect(maskedPhone("+12165550199")).toBe("(216) 555-…99");
    expect(maskedPhone("+447700900123")).toBe("…23");
  });

  it("reads a number stored as it was typed, not only canonical (older and imported rows)", () => {
    expect(maskedPhone("216-555-0148")).toBe("(216) 555-…48");
    expect(maskedPhone("+1 216 555 0148")).toBe("(216) 555-…48");
  });
});

describe("cancelling retires the open payment (issue #1082 part C)", () => {
  it("cancelling an unpaid phone booking cancels its open Stripe payment, and says so on its history", async () => {
    const { repo, row } = await phoneBooked();
    const payments = new FakePaymentPort();
    await start(repo, payments, row.id);

    const res = await cancelUnpaidPhoneBooking({ repo, now, payments }, row.id, "operator");
    expect(res).toEqual({ ok: true, alreadyCancelled: false });
    expect(payments.cancelled).toEqual([{ paymentIntentId: "pi_fake_1", reason: "abandoned" }]);
    // Nobody can pay it now — a customer sitting on their bank's approval screen gets a failure.
    expect(payments.liveAmountCents.has("pi_fake_1")).toBe(false);
    const trail = await repo.listTrailEventsFor(row.id, ["pi_fake_1"]);
    expect(trail.map((e) => e.type)).toContain("payment_superseded");
  });

  it("Stripe refusing the cancel doesn't stop the booking being cancelled, and records nothing false", async () => {
    const { repo, row } = await phoneBooked();
    const payments = new FakePaymentPort();
    await start(repo, payments, row.id);
    payments.cancelError = new Error("already succeeded");

    expect(await cancelUnpaidPhoneBooking({ repo, now, payments }, row.id, "customer")).toEqual({
      ok: true,
      alreadyCancelled: false,
    });
    expect(await repo.getReservation(row.id)).toMatchObject({ status: "cancelled" });
    const trail = await repo.listTrailEventsFor(row.id, ["pi_fake_1"]);
    expect(trail.map((e) => e.type)).not.toContain("payment_superseded");
  });

  it("the general cancel, handed a phone booking, retires its payment too", async () => {
    const { repo, row } = await phoneBooked();
    const payments = new FakePaymentPort();
    await start(repo, payments, row.id);

    expect(await cancelReservation({ repo, now, payments }, row.id, "operator")).toEqual({
      ok: true,
      alreadyCancelled: false,
    });
    expect(payments.cancelled).toEqual([{ paymentIntentId: "pi_fake_1", reason: "abandoned" }]);
  });

  it("a booking that never reached the card screen has nothing to cancel", async () => {
    const { repo, row } = await phoneBooked();
    const payments = new FakePaymentPort();
    await cancelUnpaidPhoneBooking({ repo, now, payments }, row.id, "operator");
    expect(payments.cancelled).toEqual([]);
  });
});

describe("the races (issue #1082)", () => {
  it("the operator cancels while the customer pays: the charge alerts as paid-but-unbookable and nothing books", async () => {
    const { repo, row } = await phoneBooked();
    const payments = new FakePaymentPort();
    await start(repo, payments, row.id);

    // The customer is on the card screen; the operator cancels; then the card goes through.
    await cancelUnpaidPhoneBooking({ repo, now }, row.id, "operator");
    pay(payments, "pi_fake_1", row.invoice!.amountDueNowCents);
    const { deps, alert } = webhookDeps(repo, payments);
    const res = await confirmBookingFromIntent(deps, (await payments.getSucceededPaymentIntent("pi_fake_1"))!);

    expect(res).toEqual({ handled: true, outcome: "unbookable" });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]![0]).toContain("PAID but NOT booked - charge pi_fake_1");
    expect(await repo.getReservation(row.id)).toMatchObject({ status: "cancelled", eventId: null });
    expect(await repo.listEvents()).toHaveLength(0);
  });

  it("two intents on one row both paid: the second finds a booked row and books nothing twice", async () => {
    const { repo, row } = await phoneBooked();
    const payments = new FakePaymentPort();
    await start(repo, payments, row.id);
    // The first intent's state can't be read and can't be retired, so the second attempt mints a
    // second payable intent (15.10's rare path) — both links are now live for one row.
    payments.intentStateError = new Error("stripe unreachable");
    payments.cancelError = new Error("refused");
    const second = await start(repo, payments, row.id);
    expect(second).toMatchObject({ ok: true, paymentIntentId: "pi_fake_2" });
    delete payments.intentStateError;

    const amount = row.invoice!.amountDueNowCents;
    pay(payments, "pi_fake_1", amount);
    pay(payments, "pi_fake_2", amount);
    const { deps } = webhookDeps(repo, payments);
    const a = await confirmBookingFromIntent(deps, (await payments.getSucceededPaymentIntent("pi_fake_1"))!);
    const b = await confirmBookingFromIntent(deps, (await payments.getSucceededPaymentIntent("pi_fake_2"))!);

    expect(a).toMatchObject({ outcome: "booked" });
    expect(b).toMatchObject({ outcome: "already" });
    expect(await repo.listEvents()).toHaveLength(1);
    expect(await repo.getReservation(row.id)).toMatchObject({ status: "booked", source: "muster" });
  });

  it("a residual-race loss on the operator's row is auto-refunded, the customer told, the office alerted", async () => {
    const { repo, row } = await phoneBooked();
    const payments = new FakePaymentPort();
    await start(repo, payments, row.id);
    // A trip lands on the same boat at the same time from outside the claim (a Xola import), so
    // the flip finds the hull taken.
    await repo.saveEvent({
      id: asId<"EventId">("xola-evt-1"),
      vesselId: BOAT,
      date: DATE,
      time: TIME,
      capacity: 12,
      status: "scheduled",
      source: "xola",
      price: 49900,
    });

    const amount = row.invoice!.amountDueNowCents;
    pay(payments, "pi_fake_1", amount);
    const { deps, alert, soldOut } = webhookDeps(repo, payments);
    const res = await confirmBookingFromIntent(deps, (await payments.getSucceededPaymentIntent("pi_fake_1"))!);

    expect(res).toEqual({ handled: true, outcome: "lost" });
    expect(payments.refunds).toEqual([{ paymentIntentId: "pi_fake_1", idempotencyKey: "refund_pi_fake_1" }]);
    expect(soldOut).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]![0]).toContain("SOLD OUT WHILE PAYING - charge pi_fake_1");
    const trail = await repo.listTrailEventsFor(row.id, []);
    expect(trail.map((e) => e.type)).toContain("auto_refunded");
    // Never booked: still the operator's unpaid row, holding nothing new.
    expect(await repo.getReservation(row.id)).toMatchObject({ source: "admin", status: "pending" });
  });
});
