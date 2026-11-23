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
import { PAYMENT_CONFIG_DEFAULTS, type PaymentConfig } from "./payment-config.js";

const BOAT = asId<"VesselId">("v-boat");
const OFF = asId<"OfferingId">("off-1");
const DATE = "2026-07-04";
const TIME = "13:30";
const NOW = "2026-07-01T12:00:00.000Z";
const now = () => NOW;

/** 40 days before the departure: outside the balance window, so the deposit is offered (issue #1251). */
const FAR = "2026-05-25T12:00:00.000Z";
/** 20 days before: inside the balance window (30 days by default), so the whole quote is due. */
const NEAR = "2026-06-14T12:00:00.000Z";

/** The split the page and the charge work out, at `asOf`, for this file's departure. */
const splitAt = (asOf: string, config: PaymentConfig = PAYMENT_CONFIG_DEFAULTS) => ({
  config,
  date: DATE,
  time: TIME,
  asOf,
});

/** The split at NOW, three days out — inside the balance window, so no deposit is offered and the
 *  frozen figures are shown as they are. */
const INSIDE_SPLIT = splitAt(NOW);

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
async function phoneBooked(
  email?: string,
  extra: { hasFlex?: boolean; discountCents?: number } = {},
): Promise<{ repo: InMemoryRepository; row: Reservation }> {
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
      ...extra,
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
  startPayByLink({ repo, payments, now }, id, { payDeposit: false });

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

  it("a comp that never confirmed owes nothing, so it is not payable (DEC-194)", async () => {
    // The comp's own confirm failed after the write: pending, `admin`, $0 due. There is nothing to
    // take, and a $0 payment must never reach the provider.
    const { row } = await phoneBooked();
    const stuck = { ...row, invoice: { ...row.invoice!, totalCents: 0, amountDueNowCents: 0 } };
    expect(payLinkState(stuck).kind).toBe("missing");
  });
});

describe("payLinkMoney — the summary is the invoice frozen at booking", () => {
  it("adds back up to exactly what the row will be charged, with the tip fixed at the operator's tier", async () => {
    const { row } = await phoneBooked();
    const inv = row.invoice!;
    const { money, tip, totals } = payLinkMoney(inv, INSIDE_SPLIT);
    expect(tip).toEqual({ bps: 2000, tipCents: inv.gratuityCents });
    expect(money.fareCents).toBe(inv.fareCents + inv.extrasCents);
    expect(money.baseCents).toBe(inv.fareCents);
    expect(money.extrasCents).toBe(inv.extrasCents);
    // What the pay bar shows is what Stripe is asked for — the frozen figures, not a recompute.
    expect(totals).toEqual({
      tipCents: inv.gratuityCents,
      flexCents: 0,
      taxCents: inv.taxCents,
      serviceFeeCents: inv.serviceFeeCents,
      totalCents: inv.totalCents,
      dueNowCents: inv.amountDueNowCents,
      balanceCents: 0,
    });
  });

  it("insurance bought on the phone rides the link at its frozen figures (16.8)", async () => {
    const { row } = await phoneBooked(undefined, { hasFlex: true });
    const inv = row.invoice!;
    expect(inv.flexCents).toBe(3000);
    const { totals } = payLinkMoney(inv, INSIDE_SPLIT);
    expect(totals.flexCents).toBe(3000);
    expect(totals.dueNowCents).toBe(inv.amountDueNowCents);
    expect(totals.balanceCents).toBe(0);
  });

  it("a discount that reached the insurance: the link charges what is left of it, and its tax and fee", async () => {
    const { row: plain } = await phoneBooked(undefined, { hasFlex: true });
    const fare = plain.invoice!.fareCents + plain.invoice!.extrasCents;
    const { row } = await phoneBooked(undefined, { hasFlex: true, discountCents: fare + 1000 });
    const inv = row.invoice!;
    // $20 of insurance left: 7.25% tax $1.45 and 3% fee $0.60.
    expect(inv.amountDueNowCents).toBe(2000 + 145 + 60);
    const { totals } = payLinkMoney(inv, INSIDE_SPLIT);
    expect(totals.dueNowCents).toBe(2205);
    expect(totals.balanceCents).toBe(0);
  });

  it("a deposit-mode invoice shows what is due now and what is left", async () => {
    const { row } = await phoneBooked();
    const inv = { ...row.invoice!, amountDueNowCents: 20000 + row.invoice!.gratuityCents };
    const { money, totals } = payLinkMoney(inv, splitAt(FAR));
    // The split is the link's own, worked out from the total and the live deposit at the page's clock
    // (issue #1251) — never the due-now the row happens to hold.
    expect(money.depositCents).toBe(PAYMENT_CONFIG_DEFAULTS.depositCents);
    expect(totals.dueNowCents).toBe(PAYMENT_CONFIG_DEFAULTS.depositCents);
    expect(totals.balanceCents).toBe(inv.totalCents - PAYMENT_CONFIG_DEFAULTS.depositCents);
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

/**
 * The payment link takes the deposit (issue #1251, `docs/SPEC.md §2.8.4d`). The operator's invoice
 * — the price — is frozen when they book and never changes; the split (due now, the balance, its
 * due and release dates) is decided when the customer pays the link, from the live settings.
 *
 * The window's edge and "at or below the deposit" are pinned where they live (`deposit.test.ts`,
 * `payment-config.test.ts`); here each boundary gets one case either side, at the page
 * (`payLinkMoney`) and at the charge (`startPayByLink`).
 *
 * 2 guests at 13:30 on Sat Jul 4 with the operator's 20% tip: $499 + tax $36.18 + tip $99.80 + fee
 * $17.96 = $652.94. The $100 deposit leaves $552.94, due 30 days before (Thu Jun 4, 13:30 EDT) with
 * the seats released 21 days before (Sat Jun 13).
 */
describe("the payment link takes the deposit (issue #1251)", () => {
  const QUOTE = 65294;
  const DEPOSIT = 10000;
  const BALANCE = QUOTE - DEPOSIT;
  const DUE_AT = "2026-06-04T17:30:00.000Z";
  const RELEASE_AT = "2026-06-13T17:30:00.000Z";

  /** What the form sends with the deposit chosen on a page that showed it. */
  const DEPOSIT_SHOWN = { payDeposit: true, shownDueNowCents: DEPOSIT, shownBalanceCents: BALANCE };
  /** What the form sends with Pay in full chosen: the whole quote, no balance. */
  const FULL_SHOWN = { payDeposit: false, shownDueNowCents: QUOTE, shownBalanceCents: 0 };

  /** The operator's phone booking, written at `at`, unpaid. */
  async function phoneBookedAt(at: string, email?: string): Promise<{ repo: InMemoryRepository; row: Reservation }> {
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
      () => at,
    );
    if (!res.ok) throw new Error(`fixture refused: ${res.reason}`);
    expect(res.reservation.invoice!.totalCents).toBe(QUOTE);
    return { repo, row: res.reservation };
  }

  const startAt = (
    repo: InMemoryRepository,
    payments: FakePaymentPort,
    id: ReservationId,
    at: string,
    choice: { payDeposit: boolean; shownDueNowCents?: number; shownBalanceCents?: number },
  ) => startPayByLink({ repo, payments, now: () => at }, id, choice);

  /** The card goes through on this intent, paid with `paymentMethodId`, and the confirm runs at `at`. */
  async function payAndConfirm(
    repo: InMemoryRepository,
    payments: FakePaymentPort,
    paymentIntentId: string,
    amountCents: number,
    at: string,
    paymentMethodId = "pm_card_visa",
  ) {
    payments.intentStates.set(paymentIntentId, "settled");
    payments.succeededIntents.set(paymentIntentId, {
      paymentIntentId,
      amountReceivedCents: amountCents,
      currency: "usd",
      metadata: {},
      paymentMethodId,
    });
    const deps: WebhookDeps = {
      repo,
      payments,
      now: () => at,
      alertPaidButUnbooked: vi.fn(async () => {}),
      sendConfirmation: vi.fn(async () => true),
      notifyCustomerSoldOut: vi.fn(async () => {}),
    };
    return confirmBookingFromIntent(deps, (await payments.getSucceededPaymentIntent(paymentIntentId))!);
  }

  describe("the page", () => {
    it("AC1: outside the window, a quote above the deposit: the $100 deposit is offered, its balance day named, and preselected", async () => {
      const { row } = await phoneBookedAt(FAR);
      const inv = row.invoice!;
      const { money, totals } = payLinkMoney(inv, splitAt(FAR));
      expect(money.depositCents).toBe(DEPOSIT);
      expect(money.balanceDueOn).toBe("Thu, Jun 4");
      expect(totals).toEqual({
        tipCents: inv.gratuityCents,
        flexCents: 0,
        taxCents: inv.taxCents,
        serviceFeeCents: inv.serviceFeeCents,
        totalCents: QUOTE,
        dueNowCents: DEPOSIT,
        balanceCents: BALANCE,
      });
    });

    it("AC4: inside the window: no deposit, no balance day, the whole quote due", async () => {
      const { row } = await phoneBookedAt(FAR);
      const { money, totals } = payLinkMoney(row.invoice!, splitAt(NEAR));
      expect(money.depositCents).toBeNull();
      expect(money.balanceDueOn).toBeNull();
      expect(totals).toMatchObject({ totalCents: QUOTE, dueNowCents: QUOTE, balanceCents: 0 });
    });

    it("AC5: a quote at the deposit: no deposit offered, the whole quote due", async () => {
      const { row } = await phoneBookedAt(FAR);
      const { money, totals } = payLinkMoney(row.invoice!, splitAt(FAR, { ...PAYMENT_CONFIG_DEFAULTS, depositCents: QUOTE }));
      expect(money.depositCents).toBeNull();
      expect(money.balanceDueOn).toBeNull();
      expect(totals).toMatchObject({ totalCents: QUOTE, dueNowCents: QUOTE, balanceCents: 0 });
    });

    it("AC6: reloaded inside the window after a deposit attempt, the page shows the whole quote — never the row's stored deposit", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      await startAt(repo, new FakePaymentPort(), row.id, FAR, DEPOSIT_SHOWN);
      const stored = (await repo.getReservation(row.id))!;
      expect(stored.invoice!.amountDueNowCents).toBe(DEPOSIT);

      const { money, totals } = payLinkMoney(stored.invoice!, splitAt(NEAR));
      expect(money.depositCents).toBeNull();
      expect(totals).toMatchObject({ totalCents: QUOTE, dueNowCents: QUOTE, balanceCents: 0 });
    });
  });

  describe("paying with the deposit", () => {
    it("AC2: $100 is charged and the card saved for this booking, to a provider customer made for it", async () => {
      const { repo, row } = await phoneBookedAt(FAR, "caller@example.com");
      const payments = new FakePaymentPort();

      const res = await startAt(repo, payments, row.id, FAR, DEPOSIT_SHOWN);
      expect(res).toMatchObject({ ok: true, paymentIntentId: "pi_fake_1" });
      const customerId = `cus_fake_customer_${row.id}`;
      expect(payments.createdCustomers).toEqual([{ idempotencyKey: `customer_${row.id}`, name: "Phone Caller" }]);
      expect(payments.intents).toHaveLength(1);
      expect(payments.intents[0]).toMatchObject({
        amountCents: DEPOSIT,
        customerId,
        setupFutureUsage: "off_session",
        receiptEmail: "caller@example.com",
      });
    });

    it("AC2: the split is written — due now is the deposit, the due and release dates set — and the price is the operator's", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      await startAt(repo, new FakePaymentPort(), row.id, FAR, DEPOSIT_SHOWN);

      const stored = (await repo.getReservation(row.id))!;
      expect(stored.invoice).toEqual({ ...row.invoice!, amountDueNowCents: DEPOSIT });
      expect(stored.balanceDueAt).toBe(DUE_AT);
      expect(stored.balanceReleaseAt).toBe(RELEASE_AT);
      expect(stored.stripeCustomerId).toBe(`cus_fake_customer_${row.id}`);
    });

    it("AC2: the deposit and its dates are read from the settings when the link is paid", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      // Changed after the operator booked, before the customer pays.
      await repo.setPaymentConfig({ depositCents: 15000, balanceDueDaysBeforeEvent: 35, balanceReleaseDaysBeforeEvent: 25 }, FAR);
      const payments = new FakePaymentPort();

      const res = await startAt(repo, payments, row.id, FAR, { payDeposit: true });
      expect(res.ok).toBe(true);
      expect(payments.intents[0]!.amountCents).toBe(15000);
      const stored = (await repo.getReservation(row.id))!;
      expect(stored.invoice!.amountDueNowCents).toBe(15000);
      // 35 days before Jul 4 is May 30; 25 days before is Jun 9. Both 13:30 EDT.
      expect(stored.balanceDueAt).toBe("2026-05-30T17:30:00.000Z");
      expect(stored.balanceReleaseAt).toBe("2026-06-09T17:30:00.000Z");
    });

    it("AC2: the booking books on confirm, keeping the card the deposit was paid with for the balance", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      const payments = new FakePaymentPort();
      await startAt(repo, payments, row.id, FAR, DEPOSIT_SHOWN);

      const confirmed = await payAndConfirm(repo, payments, "pi_fake_1", DEPOSIT, FAR, "pm_card_visa");
      expect(confirmed).toMatchObject({ handled: true, outcome: "booked" });
      const stored = (await repo.getReservation(row.id))!;
      expect(stored).toMatchObject({ source: "muster", status: "booked", stripePaymentMethodId: "pm_card_visa" });
      expect(stored.invoice!.amountDueNowCents).toBe(DEPOSIT);
    });
  });

  describe("paying in full", () => {
    it("AC3: Pay in full on a page that offered the deposit: the whole quote, no provider customer, no saved card, no dates", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      const payments = new FakePaymentPort();

      const res = await startAt(repo, payments, row.id, FAR, FULL_SHOWN);
      expect(res.ok).toBe(true);
      expect(payments.intents).toHaveLength(1);
      expect(payments.intents[0]!.amountCents).toBe(QUOTE);
      expect(payments.intents[0]!.customerId).toBeUndefined();
      expect(payments.intents[0]!.setupFutureUsage).toBeUndefined();
      expect(payments.createdCustomers).toEqual([]);
      const stored = (await repo.getReservation(row.id))!;
      expect(stored.invoice).toEqual(row.invoice);
      expect(stored.balanceDueAt).toBeUndefined();
      expect(stored.balanceReleaseAt).toBeUndefined();

      await payAndConfirm(repo, payments, "pi_fake_1", QUOTE, FAR, "pm_card_visa");
      const booked = (await repo.getReservation(row.id))!;
      expect(booked.status).toBe("booked");
      expect(booked.stripePaymentMethodId).toBeUndefined();
    });

    it("AC3: Pay in full after a deposit attempt clears the split and both dates", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      const payments = new FakePaymentPort();
      await startAt(repo, payments, row.id, FAR, DEPOSIT_SHOWN);
      expect((await repo.getReservation(row.id))!.balanceDueAt).toBe(DUE_AT);

      const res = await startAt(repo, payments, row.id, FAR, FULL_SHOWN);
      expect(res.ok).toBe(true);
      const stored = (await repo.getReservation(row.id))!;
      expect(stored.invoice).toEqual(row.invoice);
      expect(stored.balanceDueAt).toBeUndefined();
      expect(stored.balanceReleaseAt).toBeUndefined();
    });
  });

  describe("no choice", () => {
    it("AC4: paid inside the window, the whole quote is charged even when the deposit is asked for — no customer, no saved card, no dates", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      const payments = new FakePaymentPort();

      const res = await startAt(repo, payments, row.id, NEAR, { payDeposit: true });
      expect(res.ok).toBe(true);
      expect(payments.intents[0]!.amountCents).toBe(QUOTE);
      expect(payments.intents[0]!.setupFutureUsage).toBeUndefined();
      expect(payments.createdCustomers).toEqual([]);
      const stored = (await repo.getReservation(row.id))!;
      expect(stored.invoice).toEqual(row.invoice);
      expect(stored.balanceDueAt).toBeUndefined();
      expect(stored.balanceReleaseAt).toBeUndefined();
    });

    it("AC5: a quote at the deposit is charged whole, even outside the window and with the deposit asked for", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      await repo.setPaymentConfig({ depositCents: QUOTE }, FAR);
      const payments = new FakePaymentPort();

      const res = await startAt(repo, payments, row.id, FAR, { payDeposit: true });
      expect(res.ok).toBe(true);
      expect(payments.intents[0]!.amountCents).toBe(QUOTE);
      expect(payments.intents[0]!.setupFutureUsage).toBeUndefined();
      expect(payments.createdCustomers).toEqual([]);
      const stored = (await repo.getReservation(row.id))!;
      expect(stored.balanceDueAt).toBeUndefined();
      expect(stored.balanceReleaseAt).toBeUndefined();
    });
  });

  describe("the split changed under the page", () => {
    it("AC6: the page showed the deposit and the trip has crossed into the window: refused — nothing written, nothing charged, no card saved", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      const before = await repo.getReservation(row.id);
      const payments = new FakePaymentPort();

      expect(await startAt(repo, payments, row.id, NEAR, DEPOSIT_SHOWN)).toEqual({ ok: false, reason: "stale" });
      expect(await repo.getReservation(row.id)).toEqual(before);
      expect(payments.intents).toHaveLength(0);
      expect(payments.createdCustomers).toEqual([]);
    });

    it("AC6: the deposit setting changed between the page and the press: refused — nothing written, nothing charged, no card saved", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      const before = await repo.getReservation(row.id);
      await repo.setPaymentConfig({ depositCents: 15000 }, FAR);
      const payments = new FakePaymentPort();

      expect(await startAt(repo, payments, row.id, FAR, DEPOSIT_SHOWN)).toEqual({ ok: false, reason: "stale" });
      expect(await repo.getReservation(row.id)).toEqual(before);
      expect(payments.intents).toHaveLength(0);
      expect(payments.createdCustomers).toEqual([]);
    });

    it("AC6: refused on a retry too — the deposit attempt's intent and the row are left exactly as they were", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      const payments = new FakePaymentPort();
      await startAt(repo, payments, row.id, FAR, DEPOSIT_SHOWN);
      const before = await repo.getReservation(row.id);

      expect(await startAt(repo, payments, row.id, NEAR, DEPOSIT_SHOWN)).toEqual({ ok: false, reason: "stale" });
      expect(await repo.getReservation(row.id)).toEqual(before);
      expect(payments.intents).toHaveLength(1);
      expect(payments.amountUpdates).toEqual([]);
      expect(payments.cancelled).toEqual([]);
    });

    it("AC6: Pay in full on a page that showed the deposit sends what it charges, so it goes through after the window is crossed", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      const payments = new FakePaymentPort();

      const res = await startAt(repo, payments, row.id, NEAR, FULL_SHOWN);
      expect(res.ok).toBe(true);
      expect(payments.intents[0]!.amountCents).toBe(QUOTE);
    });

    it("AC6: a stale attempt whose last intent was paid in the other tab is already paid — never \"you have not been charged\"", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      const payments = new FakePaymentPort();
      await startAt(repo, payments, row.id, FAR, DEPOSIT_SHOWN);
      pay(payments, "pi_fake_1", DEPOSIT);

      expect(await startAt(repo, payments, row.id, NEAR, DEPOSIT_SHOWN)).toEqual({ ok: false, reason: "already_paid" });
      expect(payments.intents).toHaveLength(1);
    });
  });

  describe("a retry that changes the answer", () => {
    it("AC7: a deposit attempt, then Pay in full: the card-saving intent is retired and a fresh one minted, never switched in place", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      const payments = new FakePaymentPort();
      await startAt(repo, payments, row.id, FAR, DEPOSIT_SHOWN);

      const again = await startAt(repo, payments, row.id, FAR, FULL_SHOWN);
      expect(again).toMatchObject({ ok: true, paymentIntentId: "pi_fake_2" });
      expect(payments.amountUpdates).toEqual([]);
      expect(payments.cancelled).toEqual([{ paymentIntentId: "pi_fake_1", reason: "abandoned" }]);
      expect(payments.liveAmountCents.has("pi_fake_1")).toBe(false);
      expect(payments.intents[1]!.amountCents).toBe(QUOTE);
      expect(payments.intents[1]!.customerId).toBeUndefined();
      expect(payments.intents[1]!.setupFutureUsage).toBeUndefined();
      expect((await repo.getReservation(row.id))!.paymentIntentIds).toEqual(["pi_fake_1", "pi_fake_2"]);
    });

    it("AC7: Pay in full, then the deposit: retired and re-minted, the fresh intent saving the card", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      const payments = new FakePaymentPort();
      await startAt(repo, payments, row.id, FAR, FULL_SHOWN);

      const again = await startAt(repo, payments, row.id, FAR, DEPOSIT_SHOWN);
      expect(again).toMatchObject({ ok: true, paymentIntentId: "pi_fake_2" });
      expect(payments.amountUpdates).toEqual([]);
      expect(payments.cancelled).toEqual([{ paymentIntentId: "pi_fake_1", reason: "abandoned" }]);
      expect(payments.intents[1]).toMatchObject({
        amountCents: DEPOSIT,
        customerId: `cus_fake_customer_${row.id}`,
        setupFutureUsage: "off_session",
      });
    });

    it("AC7: a deposit attempt, then a retry inside the window: retired and re-minted at the whole quote", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      const payments = new FakePaymentPort();
      await startAt(repo, payments, row.id, FAR, DEPOSIT_SHOWN);

      const again = await startAt(repo, payments, row.id, NEAR, { payDeposit: true });
      expect(again).toMatchObject({ ok: true, paymentIntentId: "pi_fake_2" });
      expect(payments.amountUpdates).toEqual([]);
      expect(payments.cancelled).toEqual([{ paymentIntentId: "pi_fake_1", reason: "abandoned" }]);
      expect(payments.intents[1]!.amountCents).toBe(QUOTE);
      expect(payments.intents[1]!.setupFutureUsage).toBeUndefined();
    });

    it("AC7: two attempts with the deposit keep the one card-saving intent and mint nothing", async () => {
      const { repo, row } = await phoneBookedAt(FAR);
      const payments = new FakePaymentPort();
      const first = await startAt(repo, payments, row.id, FAR, DEPOSIT_SHOWN);
      const second = await startAt(repo, payments, row.id, FAR, DEPOSIT_SHOWN);

      expect(first.ok && second.ok && second.paymentIntentId).toBe("pi_fake_1");
      expect(payments.intents).toHaveLength(1);
      expect(payments.intents[0]).toMatchObject({ amountCents: DEPOSIT, setupFutureUsage: "off_session" });
      expect(payments.cancelled).toEqual([]);
      expect(payments.createdCustomers).toHaveLength(1);
    });
  });

  it("AC8: the phone booking is written due in full with no dates, however far out — only the link's payment sets the split, and the price stays the operator's", async () => {
    const { repo, row } = await phoneBookedAt(FAR);
    const written = (await repo.getReservation(row.id))!;
    expect(written.invoice!.amountDueNowCents).toBe(QUOTE);
    expect(written.balanceDueAt).toBeUndefined();
    expect(written.balanceReleaseAt).toBeUndefined();

    await startAt(repo, new FakePaymentPort(), row.id, FAR, DEPOSIT_SHOWN);
    const { amountDueNowCents: dueBefore, ...priceBefore } = written.invoice!;
    const { amountDueNowCents: dueAfter, ...priceAfter } = (await repo.getReservation(row.id))!.invoice!;
    expect(dueBefore).toBe(QUOTE);
    expect(dueAfter).toBe(DEPOSIT);
    expect(priceAfter).toEqual(priceBefore);
  });
});
