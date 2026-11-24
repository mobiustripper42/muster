/**
 * The scheduled balance charge (issue #1254, `docs/SPEC.md §2.8.4d`, DEC-201).
 *
 * A deposit booking's balance is charged to the card saved at booking, off-session, on its frozen
 * due date; a decline is retried 3 and 6 days later (a live setting); a bank that asks the customer
 * to approve ends the attempts; nothing is tried on or after the release date. The customer can
 * also pay on `/b/<code>` with any card. Every path — each scheduled attempt and the manage page —
 * uses the booking's ONE balance PaymentIntent, so Stripe itself refuses a second successful
 * charge.
 *
 * The world below is the `db:seed:self-cancel` booking (Dana Whitcomb), booked through the real
 * deposit confirm: $499 + 20% tip at 7.25% + 3% fee = $652.94, $100 down, $552.94 owed. The deposit
 * carried the tip and the fee, so `balanceOwedCents` reads 55294.
 *
 * Asserted on `confirmOffSessionCalls` throughout, never on charges: the fake dedupes a repeated
 * idempotency key the way Stripe does, which would hide a missing claim.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeChannel } from "../adapters/fake-channel.js";
import { FAKE_SIGNATURE, FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { BookingInvoice, Payment, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { OutboundMessage, SendResult } from "../ports/channel.js";
import { eventIdForSlot } from "./availability.js";
import {
  balanceAttemptTimes,
  balancePayable,
  chargeDueBalances,
  ensureBalanceIntent,
  recordBalancePayment,
  recordBalanceReturn,
  startBalancePayment,
} from "./balance-charge.js";
import {
  balanceAdminAlertBody,
  balanceFailedBody,
  deliverBalanceNotice,
  type BalanceFailure,
  type TellBalanceFailed,
} from "./balance-notice.js";
import { bookingUrl } from "./booking-code.js";
import { processBookingWebhook, type WebhookDeps } from "./booking-webhook.js";
import { confirmBookingByPaymentIntent } from "./confirm-booking.js";
import { balanceRefusalMessage, buildManageView } from "./manage-view.js";
import { balanceOwedCents } from "./payment-config.js";

const V = asId<"VesselId">("v-1");
const RES = asId<"ReservationId">("resv-bal");
const DATE = "2026-08-31";
const TIME = "17:00";
const EVENT = eventIdForSlot(V, DATE, TIME);
const PI_DEP = "pi_dep";
const CUS = "cus_dana";
const PM = "pm_card_visa";
const CODE = "ABCDEFGHJKMNPQ";

const BOOKED_AT = "2026-07-01T15:00:00.000Z";
/** The frozen due date, and the retries the default setting makes of it: N × 24 hours. */
const DUE = "2026-08-01T13:00:00.000Z";
const DUE_3 = "2026-08-04T13:00:00.000Z";
const DUE_6 = "2026-08-07T13:00:00.000Z";
const RELEASE = "2026-08-10T13:00:00.000Z";
const OWED = 55294;

const later = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

/** What `priceBooking` froze on Dana's booking, deposit chosen. */
const DANA: BookingInvoice = {
  fareCents: 49900,
  extrasCents: 0,
  taxCents: 3618,
  taxRateBps: 725,
  serviceFeeCents: 1796,
  serviceFeeBps: 300,
  gratuityCents: 9980,
  gratuityBps: 2000,
  totalCents: 65294,
  amountDueNowCents: 10000,
};

const pendingRow = (over: Partial<Reservation> = {}): Reservation => ({
  id: RES,
  eventId: null,
  source: "muster",
  status: "pending",
  customerName: "Dana Whitcomb",
  partySize: 6,
  phone: "+12165550148",
  vesselId: V,
  date: DATE,
  time: TIME,
  offeringId: asId<"OfferingId">("off-1"),
  reservedAt: BOOKED_AT,
  holdMinutes: 120,
  tripMinutes: 100,
  paymentIntentIds: [PI_DEP],
  invoice: DANA,
  balanceDueAt: DUE,
  balanceReleaseAt: RELEASE,
  ...over,
});

const LINK_BASE = "https://muster.example";
const BOTH = { email: "dana@example.com", phone: "+12165550148" };

/** The console stand-in for a text channel: it records, and says it only logged. */
class LoggedOnlyChannel extends FakeChannel {
  override async send(message: OutboundMessage): Promise<SendResult> {
    return { ...(await super.send(message)), loggedOnly: true };
  }
}

/** The pending row, on the contact given (its own phone when none is). */
const pendingWith = (releaseAt: string, contact?: { email?: string; phone?: string }): Reservation => {
  const row = pendingRow({ balanceReleaseAt: releaseAt });
  if (!contact) return row;
  const { phone: _phone, ...rest } = row;
  return { ...rest, ...contact };
};

/**
 * A booked deposit booking, through the real deposit confirm: the pending row, the provider
 * customer, then `payment_intent.succeeded` for the $100 deposit with the card it saved.
 *
 * The customer notice (issue #1273) goes through the real `deliverBalanceNotice`, over fake channels.
 */
async function world(
  opts: {
    card?: boolean;
    releaseAt?: string;
    contact?: { email?: string; phone?: string };
    smsLogsOnly?: boolean;
  } = {},
) {
  const repo = new InMemoryRepository();
  const pay = new FakePaymentPort();
  let clock = BOOKED_AT;
  const alert = vi.fn(async (_message: string) => {});
  const stamp = () => new Date(clock);
  const email = new FakeChannel(stamp);
  const sms = opts.smsLogsOnly ? new LoggedOnlyChannel(stamp) : new FakeChannel(stamp);
  const tell = vi.fn<TellBalanceFailed>(async (reservation, failure) => {
    await deliverBalanceNotice(
      {
        repo,
        now: () => clock,
        tenantName: "BrewBoat",
        linkBase: LINK_BASE,
        email,
        sms,
        live: !opts.smsLogsOnly,
      },
      reservation,
      failure,
    );
  });
  const deps: WebhookDeps & { tellBalanceFailed: TellBalanceFailed } = {
    repo,
    payments: pay,
    now: () => clock,
    alertPaidButUnbooked: alert,
    sendConfirmation: vi.fn(async () => true),
    notifyCustomerSoldOut: vi.fn(async () => {}),
    tellBalanceFailed: tell,
  };
  // Real manning, or the confirm forms a shift with no seats and logs it (#582).
  await repo.saveVessel({
    id: V,
    name: "Brew",
    coiMaxPax: 12,
    manning: [{ roleTypeId: asId<"RoleTypeId">("role-captain"), count: 1 }],
  });
  await repo.saveReservation(pendingWith(opts.releaseAt ?? RELEASE, opts.contact));
  await repo.saveStripeCustomerId(RES, CUS);
  const deposit = JSON.stringify({
    type: "payment_succeeded",
    data: {
      paymentIntentId: PI_DEP,
      amountReceivedCents: 10000,
      currency: "usd",
      metadata: {},
      ...(opts.card === false ? {} : { paymentMethodId: PM }),
    },
  });
  expect(await processBookingWebhook(deps, deposit, FAKE_SIGNATURE)).toEqual({
    handled: true,
    outcome: "booked",
  });
  await repo.saveBookingCode({ code: CODE, reservationId: RES, createdAt: BOOKED_AT });
  const bookedRows = new Set((await repo.listTrailEvents()).map((e) => String(e.id)));
  return {
    repo,
    pay,
    alert,
    email,
    sms,
    tell,
    deps,
    /** The booking's trail rows, oldest first, less the ones its booking wrote. */
    async trail() {
      return (await repo.listTrailEventsFor(RES, [])).filter((e) => !bookedRows.has(String(e.id)));
    },
    at(iso: string) {
      clock = iso;
    },
    /** Run the job at `iso`. */
    async run(iso: string) {
      clock = iso;
      return chargeDueBalances(deps);
    },
    async row() {
      return (await repo.getReservation(RES))!;
    },
    async balanceRows() {
      return (await repo.listPaymentsForReservation(RES)).filter((p) => p.kind === "balance");
    },
    keys() {
      return pay.confirmOffSessionCalls.map((c) => c.idempotencyKey);
    },
    async manageView() {
      const reservation = (await repo.getReservation(RES))!;
      return buildManageView({
        reservation,
        event: (await repo.getEvent(EVENT))!,
        payments: await repo.listPaymentsForReservation(RES),
        gratuities: [],
        now: { date: "2026-08-01", time: "10:00" },
      });
    },
  };
}

const NONE = { charged: 0, declined: 0, needsApproval: 0, errors: 0 };

// ── The attempt times (the rule's one home) ────────────────────────────────────────────────

describe("balanceAttemptTimes", () => {
  it("AC4: attempt 0 is the due date, then one attempt per retry day after it", () => {
    expect(balanceAttemptTimes(DUE, RELEASE, [3, 6])).toEqual([DUE, DUE_3, DUE_6]);
  });

  it("AC4: the retry days are whatever list it is given", () => {
    expect(balanceAttemptTimes(DUE, RELEASE, [2])).toEqual([DUE, "2026-08-03T13:00:00.000Z"]);
  });

  it("AC4: a retry day is 24 hours, across a daylight-saving change too", () => {
    // US clocks fall back on Sun Nov 1, 2026. Three days later is 72 hours later, not the same
    // wall-clock hour.
    expect(balanceAttemptTimes("2026-10-30T16:00:00.000Z", "2026-11-20T16:00:00.000Z", [3])).toEqual([
      "2026-10-30T16:00:00.000Z",
      "2026-11-02T16:00:00.000Z",
    ]);
  });

  it("AC5: a retry on the release date is dropped", () => {
    expect(balanceAttemptTimes(DUE, DUE_6, [3, 6])).toEqual([DUE, DUE_3]);
  });

  it("AC5: a retry after the release date is dropped; one a minute before it is kept", () => {
    expect(balanceAttemptTimes(DUE, "2026-08-06T13:00:00.000Z", [3, 6])).toEqual([DUE, DUE_3]);
    expect(balanceAttemptTimes(DUE, later(DUE_6, 1), [3, 6])).toEqual([DUE, DUE_3, DUE_6]);
  });

  it("AC5: a due date on or after the release date leaves no attempt at all", () => {
    expect(balanceAttemptTimes(DUE, DUE, [3, 6])).toEqual([]);
    expect(balanceAttemptTimes(DUE_3, DUE, [3, 6])).toEqual([]);
  });
});

// ── Can this booking take a balance payment (the rule's one home) ──────────────────────────

describe("balancePayable", () => {
  const booked = (over: Partial<Reservation> = {}): Reservation => ({
    id: RES,
    eventId: EVENT,
    source: "muster",
    status: "booked",
    customerName: "Dana Whitcomb",
    partySize: 6,
    invoice: DANA,
    ...over,
  });
  const deposit = (over: Partial<Payment> = {}): Payment => ({
    id: asId<"PaymentId">("pay_pi_dep"),
    reservationId: RES,
    method: "stripe",
    kind: "deposit",
    amountCents: 10000,
    taxCents: 3618,
    gratuityCents: 9980,
    serviceFeeCents: 1796,
    currency: "usd",
    status: "succeeded",
    createdAt: BOOKED_AT,
    ...over,
  });
  const balance = (amountCents: number): Payment =>
    deposit({ id: asId<"PaymentId">("pay_pi_bal"), kind: "balance", amountCents, taxCents: 0, gratuityCents: 0, serviceFeeCents: 0 });

  it("AC11: a booked booking that owes reads payable, for what it owes", () => {
    expect(balancePayable(booked(), [deposit()])).toEqual({ ok: true, owedCents: OWED });
  });

  it.each(["pending", "cancelled"] as const)("AC9: a %s booking is not_active", (status) => {
    expect(balancePayable(booked({ status }), [deposit()])).toEqual({ ok: false, reason: "not_active" });
  });

  it("AC9: a booking paid in full, or over, is no_balance", () => {
    expect(balancePayable(booked(), [deposit(), balance(OWED)])).toEqual({ ok: false, reason: "no_balance" });
    expect(balancePayable(booked(), [deposit(), balance(OWED + 1)])).toEqual({ ok: false, reason: "no_balance" });
  });

  it.each(["disputed", "dispute_lost"] as const)("AC9: a booking with a %s payment is disputed", (status) => {
    expect(balancePayable(booked(), [deposit({ status })])).toEqual({ ok: false, reason: "disputed" });
  });

  it("AC9: a dispute the operator won does not block — the money came back", () => {
    // `markPaymentDisputed(..., "succeeded")` is how a won dispute lands: the row is succeeded again.
    expect(balancePayable(booked(), [deposit({ status: "succeeded" })])).toMatchObject({ ok: true });
  });

  it("AC9: the checks run in order — a cancelled booking with a dispute reads not_active", () => {
    expect(balancePayable(booked({ status: "cancelled" }), [deposit({ status: "disputed" })])).toEqual({
      ok: false,
      reason: "not_active",
    });
  });
});

// ── The balance intent (the rule's one home) ───────────────────────────────────────────────

describe("ensureBalanceIntent", () => {
  it("AC1: creates the booking's balance intent once, keyed per booking, and stores it on the row", async () => {
    const w = await world();
    const r = await ensureBalanceIntent(w.deps, await w.row(), OWED);

    expect(w.pay.intents).toHaveLength(1);
    const intent = w.pay.intents[0]!;
    expect(intent).toMatchObject({
      amountCents: OWED,
      currency: "usd",
      customerId: CUS,
      idempotencyKey: `balance_${RES}`,
    });
    expect(intent.metadata).toEqual({ reservation_id: String(RES), purpose: "balance" });
    expect(intent.setupFutureUsage).toBeUndefined();
    expect(r.paymentIntentId).not.toBe("");
    expect(r.clientSecret).not.toBe("");
    const row = await w.row();
    expect(row.balancePaymentIntentId).toBe(r.paymentIntentId);
    expect(row.paymentIntentIds).toContain(r.paymentIntentId);
  });

  it("AC11: a second use raises or lowers that same intent to the amount given, and creates none", async () => {
    const w = await world();
    const first = await ensureBalanceIntent(w.deps, await w.row(), OWED);
    const second = await ensureBalanceIntent(w.deps, await w.row(), 50000);

    expect(w.pay.intents).toHaveLength(1);
    expect(second.paymentIntentId).toBe(first.paymentIntentId);
    expect(w.pay.amountUpdates).toEqual([{ paymentIntentId: first.paymentIntentId, amountCents: 50000 }]);
    expect(w.pay.liveAmountCents.get(first.paymentIntentId)).toBe(50000);
  });
});

// ── The job ────────────────────────────────────────────────────────────────────────────────

describe("chargeDueBalances", () => {
  it("AC1: on the due date the saved card is charged off-session for exactly what is owed, on the booking's balance intent", async () => {
    const w = await world();
    const counts = await w.run(DUE);

    expect(counts).toEqual({ ...NONE, charged: 1 });
    const intentId = (await w.row()).balancePaymentIntentId!;
    expect(intentId).toBeDefined();
    expect(w.pay.confirmOffSessionCalls).toEqual([
      { paymentIntentId: intentId, customerId: CUS, paymentMethodId: PM, idempotencyKey: `balance_${RES}_0` },
    ]);
    // Charged at what is owed: the intent was minted at it, and no update moved it anywhere else.
    expect(w.pay.amountUpdates.every((u) => u.amountCents === OWED)).toBe(true);
    // The one intent: created for the booking with its customer, and nothing that saves a card.
    expect(w.pay.intents).toHaveLength(1);
    expect(w.pay.intents[0]).toMatchObject({ amountCents: OWED, customerId: CUS, idempotencyKey: `balance_${RES}` });
    expect(w.pay.intents[0]!.metadata).toEqual({ reservation_id: String(RES), purpose: "balance" });
    expect(w.pay.intents[0]!.setupFutureUsage).toBeUndefined();
  });

  it("AC1: a due booking with no saved card is skipped — no claim, no charge, no count", async () => {
    const w = await world({ card: false });
    expect(await w.run(DUE)).toEqual(NONE);
    expect(w.pay.confirmOffSessionCalls).toEqual([]);
    expect(await w.repo.listBalanceAttempts(RES)).toEqual([]);
  });

  it("AC2: a charge that succeeds writes one balance row, and the booking is paid in full", async () => {
    const w = await world();
    await w.run(DUE);
    const intentId = (await w.row()).balancePaymentIntentId!;

    const rows = await w.balanceRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: `pay_${intentId}`,
      reservationId: RES,
      kind: "balance",
      amountCents: OWED,
      taxCents: 0,
      status: "succeeded",
      stripePaymentIntentId: intentId,
    });
    expect(rows[0]).not.toHaveProperty("gratuityCents");
    expect(rows[0]).not.toHaveProperty("serviceFeeCents");
    expect(rows[0]).not.toHaveProperty("flexCents");
    expect(balanceOwedCents(DANA, await w.repo.listPaymentsForReservation(RES))).toBe(0);
    expect((await w.manageView()).paidInFull).toBe(true);
    expect(await w.repo.listBalanceAttempts(RES)).toMatchObject([{ attempt: 0, outcome: "succeeded" }]);
  });

  it("AC4: a declined due-date charge is charged again at due + 3 days and at due + 6 days", async () => {
    const w = await world();
    w.pay.confirmOffSessionOutcomes = [
      { declined: "insufficient_funds" },
      { declined: "insufficient_funds" },
      "succeeded",
    ];

    expect(await w.run(DUE)).toEqual({ ...NONE, declined: 1 });
    expect(await w.run(later(DUE_3, -1))).toEqual(NONE);
    expect(await w.run(DUE_3)).toEqual({ ...NONE, declined: 1 });
    expect(await w.run(later(DUE_6, -1))).toEqual(NONE);
    expect(await w.run(DUE_6)).toEqual({ ...NONE, charged: 1 });

    expect(w.keys()).toEqual([`balance_${RES}_0`, `balance_${RES}_1`, `balance_${RES}_2`]);
    expect(await w.balanceRows()).toHaveLength(1);
    expect(await w.repo.listBalanceAttempts(RES)).toMatchObject([
      { attempt: 0, outcome: "declined", declineCode: "insufficient_funds" },
      { attempt: 1, outcome: "declined", declineCode: "insufficient_funds" },
      { attempt: 2, outcome: "succeeded" },
    ]);
  });

  it("AC4: the retry days are read from the setting", async () => {
    const w = await world();
    await w.repo.setPaymentConfig({ balanceRetryDaysAfterDue: [2] }, BOOKED_AT);
    w.pay.confirmOffSessionOutcomes = [{ declined: "card_declined" }, { declined: "card_declined" }];

    await w.run(DUE);
    expect(await w.run("2026-08-03T13:00:00.000Z")).toEqual({ ...NONE, declined: 1 });
    await w.run(DUE_3);
    await w.run(DUE_6);

    expect(w.keys()).toEqual([`balance_${RES}_0`, `balance_${RES}_1`]);
  });

  it("AC5: a retry whose time is the release date is not made", async () => {
    const w = await world({ releaseAt: DUE_6 });
    w.pay.confirmOffSessionOutcomes = [{ declined: "card_declined" }, { declined: "card_declined" }];

    await w.run(DUE);
    await w.run(DUE_3);
    expect(await w.run(DUE_6)).toEqual(NONE);

    expect(w.keys()).toEqual([`balance_${RES}_0`, `balance_${RES}_1`]);
  });

  it("AC5: a retry a minute before the release date is made", async () => {
    const w = await world({ releaseAt: later(DUE_6, 1) });
    w.pay.confirmOffSessionOutcomes = [{ declined: "card_declined" }, { declined: "card_declined" }];

    await w.run(DUE);
    await w.run(DUE_3);
    expect(await w.run(DUE_6)).toEqual({ ...NONE, charged: 1 });

    expect(w.keys()).toEqual([`balance_${RES}_0`, `balance_${RES}_1`, `balance_${RES}_2`]);
  });

  it("AC6: once the bank asks the customer to approve, no later attempt is made", async () => {
    const w = await world();
    w.pay.confirmOffSessionOutcomes = ["needs_approval"];

    expect(await w.run(DUE)).toEqual({ ...NONE, needsApproval: 1 });
    expect(await w.run(DUE_3)).toEqual(NONE);
    expect(await w.run(DUE_6)).toEqual(NONE);

    expect(w.keys()).toEqual([`balance_${RES}_0`]);
    expect(await w.repo.listBalanceAttempts(RES)).toMatchObject([{ attempt: 0, outcome: "needs_approval" }]);
  });

  it("AC6: a needs-approval on a retry ends the attempts there too", async () => {
    const w = await world();
    w.pay.confirmOffSessionOutcomes = [{ declined: "card_declined" }, "needs_approval"];

    await w.run(DUE);
    expect(await w.run(DUE_3)).toEqual({ ...NONE, needsApproval: 1 });
    expect(await w.run(DUE_6)).toEqual(NONE);

    expect(w.keys()).toEqual([`balance_${RES}_0`, `balance_${RES}_1`]);
  });

  it("AC7: two job runs at the same moment make one attempt", async () => {
    const w = await world();
    w.at(DUE);
    const [a, b] = await Promise.all([chargeDueBalances(w.deps), chargeDueBalances(w.deps)]);

    expect(w.pay.confirmOffSessionCalls).toHaveLength(1);
    expect(a.charged + b.charged).toBe(1);
  });

  it("AC7: a later run never makes the same attempt again", async () => {
    const w = await world();
    w.pay.confirmOffSessionOutcomes = [{ declined: "card_declined" }];

    await w.run(DUE);
    expect(await w.run(later(DUE, 60))).toEqual(NONE);
    expect(await w.run(later(DUE, 60 * 24 * 2))).toEqual(NONE);

    expect(w.keys()).toEqual([`balance_${RES}_0`]);
  });

  it("AC7: a charge that throws gives its claim back, and the next run re-sends it with the same key", async () => {
    const w = await world();
    w.pay.confirmOffSessionOutcomes = ["throw", "succeeded"];

    expect(await w.run(DUE)).toEqual({ ...NONE, errors: 1 });
    expect(await w.balanceRows()).toHaveLength(0);
    expect(await w.run(later(DUE, 5))).toEqual({ ...NONE, charged: 1 });

    expect(w.keys()).toEqual([`balance_${RES}_0`, `balance_${RES}_0`]);
    expect(await w.balanceRows()).toHaveLength(1);
  });

  it("AC7: a charge that succeeded at Stripe but threw before its row was written is recorded by the next run, with no new charge and no error", async () => {
    const w = await world();
    // The confirm succeeds at Stripe; the row write after it fails once, so the claim is given back.
    vi.spyOn(w.repo, "savePayment").mockRejectedValueOnce(new Error("connection lost after the charge"));
    expect(await w.run(DUE)).toEqual({ ...NONE, errors: 1 });
    expect(await w.balanceRows()).toEqual([]);
    const intentId = (await w.row()).balancePaymentIntentId!;

    // Stripe refuses to change the amount of an intent that has succeeded (`stripe-payment.ts`'s
    // update does not catch it). The fake refuses only when told to; this is that.
    w.pay.updateAmountError = new Error(
      "This PaymentIntent's amount could not be updated because it has a status of succeeded.",
    );
    const counts = await w.run(later(DUE, 5));

    const rows = await w.balanceRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: `pay_${intentId}`, kind: "balance", amountCents: OWED });
    // Nothing new charged: no second intent, and no confirm under any key but attempt 0's.
    expect(w.pay.intents).toHaveLength(1);
    expect(new Set(w.keys())).toEqual(new Set([`balance_${RES}_0`]));
    expect(counts).toMatchObject({ errors: 0, declined: 0, needsApproval: 0 });
  });

  // DEC-202: a run that died between claiming and finishing — no throw, so no release — leaves an
  // unfinished claim. A later run takes it over once it is older than an hour, under its own key.
  /** A claim on attempt 0 at the due date, as a run that then died would leave it. */
  const deadRunClaim = (w: Awaited<ReturnType<typeof world>>) =>
    w.repo.claimBalanceAttempt({ reservationId: RES, attempt: 0, at: DUE, staleBefore: later(DUE, -60) });

  it("AC7: an unfinished claim is not re-sent by a run within the hour", async () => {
    const w = await world();
    expect(await deadRunClaim(w)).toBe(true);

    expect(await w.run(later(DUE, 59))).toEqual(NONE);
    // Exactly an hour on is not older than the hour.
    expect(await w.run(later(DUE, 60))).toEqual(NONE);

    expect(w.keys()).toEqual([]);
    expect(await w.balanceRows()).toEqual([]);
  });

  it("AC7: an unfinished claim older than an hour is re-sent under its own key, and the success is recorded", async () => {
    const w = await world();
    expect(await deadRunClaim(w)).toBe(true);

    expect(await w.run(later(DUE, 61))).toEqual({ ...NONE, charged: 1 });

    expect(w.keys()).toEqual([`balance_${RES}_0`]);
    const intentId = (await w.row()).balancePaymentIntentId!;
    const rows = await w.balanceRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: `pay_${intentId}`, kind: "balance", amountCents: OWED });
    expect(await w.repo.listBalanceAttempts(RES)).toMatchObject([{ attempt: 0, outcome: "succeeded" }]);
    // Taken over once: the next run makes nothing.
    expect(await w.run(later(DUE, 62))).toEqual(NONE);
    expect(w.keys()).toEqual([`balance_${RES}_0`]);
  });

  it("AC7: a reclaimed attempt whose intent already succeeded at Stripe is recorded, with no confirm sent", async () => {
    const w = await world();
    // The dead run got as far as the charge: the intent made and confirmed at Stripe, nothing written.
    expect(await deadRunClaim(w)).toBe(true);
    const { paymentIntentId } = await ensureBalanceIntent(w.deps, await w.row(), OWED);
    await w.pay.confirmOffSession({
      paymentIntentId,
      customerId: CUS,
      paymentMethodId: PM,
      idempotencyKey: `balance_${RES}_0`,
    });
    const sentBefore = w.pay.confirmOffSessionCalls.length;
    // Stripe refuses to change a succeeded intent's amount.
    w.pay.updateAmountError = new Error(
      "This PaymentIntent's amount could not be updated because it has a status of succeeded.",
    );

    const counts = await w.run(later(DUE, 61));

    const rows = await w.balanceRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: `pay_${paymentIntentId}`, kind: "balance", amountCents: OWED });
    expect(w.pay.confirmOffSessionCalls).toHaveLength(sentBefore);
    expect(w.pay.intents).toHaveLength(1);
    expect(counts).toMatchObject({ errors: 0, declined: 0, needsApproval: 0 });
    expect(await w.repo.listBalanceAttempts(RES)).toMatchObject([{ attempt: 0, outcome: "succeeded" }]);
  });

  it("AC8: after missing a retry, the job makes one charge for the latest attempt due, not the missed one", async () => {
    const w = await world();
    w.pay.confirmOffSessionOutcomes = [{ declined: "card_declined" }, { declined: "card_declined" }];

    await w.run(DUE);
    // Down from the due date until after the second retry's time.
    expect(await w.run(later(DUE_6, 60))).toEqual({ ...NONE, declined: 1 });

    expect(w.keys()).toEqual([`balance_${RES}_0`, `balance_${RES}_2`]);
    expect((await w.repo.listBalanceAttempts(RES)).map((a) => a.attempt)).toEqual([0, 2]);
  });

  it("AC8: a job that never ran until after the last retry's time makes one charge, for that attempt", async () => {
    const w = await world();

    expect(await w.run(later(DUE_6, 60))).toEqual({ ...NONE, charged: 1 });
    expect(w.keys()).toEqual([`balance_${RES}_2`]);
  });

  it("AC9: a cancelled booking is not charged", async () => {
    const w = await world();
    await w.repo.saveReservation({ ...(await w.row()), status: "cancelled" });

    expect(await w.run(DUE)).toEqual(NONE);
    expect(w.pay.confirmOffSessionCalls).toEqual([]);
    expect(w.pay.intents).toEqual([]);
  });

  it("AC9: a booking that already paid its balance is not charged", async () => {
    const w = await world();
    await w.repo.savePayment({
      id: asId<"PaymentId">("pay_early"),
      reservationId: RES,
      method: "stripe",
      kind: "balance",
      amountCents: OWED,
      taxCents: 0,
      currency: "usd",
      status: "succeeded",
      createdAt: "2026-07-20T12:00:00.000Z",
    });

    expect(await w.run(DUE)).toEqual(NONE);
    expect(w.pay.confirmOffSessionCalls).toEqual([]);
    expect(w.pay.intents).toEqual([]);
  });

  it.each(["disputed", "dispute_lost"] as const)("AC9: a booking with a %s payment is not charged", async (status) => {
    const w = await world();
    await w.repo.markPaymentDisputed(asId<"PaymentId">(`pay_${PI_DEP}`), status);

    expect(await w.run(DUE)).toEqual(NONE);
    expect(w.pay.confirmOffSessionCalls).toEqual([]);
    expect(w.pay.intents).toEqual([]);
  });

  it("AC9: a booking whose due date has not come is not charged", async () => {
    const w = await world();

    expect(await w.run(later(DUE, -1))).toEqual(NONE);
    expect(w.pay.confirmOffSessionCalls).toEqual([]);
    expect(w.pay.intents).toEqual([]);
  });

  it("AC10: a change to the retry days applies to every attempt not yet made", async () => {
    const w = await world();
    w.pay.confirmOffSessionOutcomes = [{ declined: "card_declined" }, { declined: "card_declined" }];
    await w.run(DUE);

    // Changed after the due-date attempt and before any retry.
    await w.repo.setPaymentConfig({ balanceRetryDaysAfterDue: [1, 2] }, later(DUE, 60));
    expect(await w.run("2026-08-02T13:00:00.000Z")).toEqual({ ...NONE, declined: 1 });
    expect(await w.run("2026-08-03T13:00:00.000Z")).toEqual({ ...NONE, charged: 1 });
    expect(await w.run(DUE_3)).toEqual(NONE);

    expect(w.keys()).toEqual([`balance_${RES}_0`, `balance_${RES}_1`, `balance_${RES}_2`]);
  });

  it("AC10: the due and release dates stay frozen on the booking when their settings change", async () => {
    const w = await world();
    // Read live, 45 and 40 days before the Aug 31 trip would make the balance due Jul 17 and
    // release it Jul 22 — before the frozen due date.
    await w.repo.setPaymentConfig({ balanceDueDaysBeforeEvent: 45, balanceReleaseDaysBeforeEvent: 40 }, BOOKED_AT);

    expect(await w.run("2026-07-20T13:00:00.000Z")).toEqual(NONE);
    expect(await w.run(DUE)).toEqual({ ...NONE, charged: 1 });
    expect(w.keys()).toEqual([`balance_${RES}_0`]);
  });
});

// ── Telling both sides of a failed charge (issue #1273) ────────────────────────────────────

describe("chargeDueBalances tells the customer and the admins of a failed charge (issue #1273)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const URL = bookingUrl(LINK_BASE, CODE);
  type World = Awaited<ReturnType<typeof world>>;

  const customerBody = async (w: World, outcome: BalanceFailure["outcome"], owedCents = OWED): Promise<string> =>
    balanceFailedBody({ reservation: await w.row(), owedCents, manageUrl: URL, tenantName: "BrewBoat", outcome });

  const declinedAt = (attempt: number, nextAttemptAt: string | null, declineCode = "insufficient_funds"): BalanceFailure => ({
    attempt,
    owedCents: OWED,
    nextAttemptAt,
    outcome: "declined",
    declineCode,
  });
  const NEEDS_APPROVAL: BalanceFailure = { attempt: 0, owedCents: OWED, nextAttemptAt: null, outcome: "needs_approval" };

  const sentTo = (w: World) => ({
    email: w.email.sent.map(({ to, body }) => ({ to, body })),
    sms: w.sms.sent.map(({ to, body }) => ({ to, body })),
  });
  const alerts = (w: World) => w.alert.mock.calls.map(([message]) => message);
  const quietLog = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

  it("AC1: a declined charge sends the customer one email and one text, with their booking's link and what is owed", async () => {
    const w = await world({ contact: BOTH });
    w.pay.confirmOffSessionOutcomes = [{ declined: "insufficient_funds" }];

    expect(await w.run(DUE)).toEqual({ ...NONE, declined: 1 });

    const body = await customerBody(w, "declined");
    expect(sentTo(w)).toEqual({
      email: [{ to: { email: BOTH.email }, body }],
      sms: [{ to: { phone: BOTH.phone }, body }],
    });
  });

  it("AC1: the amount is what is still owed, the figure the card was charged", async () => {
    const w = await world({ contact: BOTH });
    await w.repo.savePayment({
      id: asId<"PaymentId">("pay_part"),
      reservationId: RES,
      method: "stripe",
      kind: "balance",
      amountCents: OWED - 50000,
      taxCents: 0,
      currency: "usd",
      status: "succeeded",
      createdAt: "2026-07-20T12:00:00.000Z",
    });
    w.pay.confirmOffSessionOutcomes = [{ declined: "insufficient_funds" }];

    await w.run(DUE);

    expect(w.pay.intents.map((i) => i.amountCents)).toEqual([50000]);
    expect(w.sms.sent.map((m) => m.body)).toEqual([await customerBody(w, "declined", 50000)]);
    expect(alerts(w)).toEqual([
      balanceAdminAlertBody({ reservation: await w.row(), failure: { ...declinedAt(0, DUE_3), owedCents: 50000 } }),
    ]);
  });

  it("AC2: a bank that asks for approval is told to the customer the same way, on that attempt", async () => {
    const w = await world({ contact: BOTH });
    w.pay.confirmOffSessionOutcomes = ["needs_approval"];

    expect(await w.run(DUE)).toEqual({ ...NONE, needsApproval: 1 });

    const body = await customerBody(w, "needs_approval");
    expect(sentTo(w)).toEqual({
      email: [{ to: { email: BOTH.email }, body }],
      sms: [{ to: { phone: BOTH.phone }, body }],
    });
  });

  it("AC3: a charge that succeeds sends nothing to anyone, and writes no trail row", async () => {
    const w = await world({ contact: BOTH });

    expect(await w.run(DUE)).toEqual({ ...NONE, charged: 1 });

    expect(sentTo(w)).toEqual({ email: [], sms: [] });
    expect(w.alert).not.toHaveBeenCalled();
    expect(await w.trail()).toEqual([]);
  });

  it("AC4: a declined charge texts the admins once, with the next scheduled attempt", async () => {
    const w = await world({ contact: BOTH });
    w.pay.confirmOffSessionOutcomes = [{ declined: "insufficient_funds" }];

    await w.run(DUE);

    expect(w.tell.mock.calls.map(([, failure]) => failure)).toEqual([declinedAt(0, DUE_3)]);
    expect(alerts(w)).toEqual([balanceAdminAlertBody({ reservation: await w.row(), failure: declinedAt(0, DUE_3) })]);
  });

  it("AC4: the last scheduled attempt has no next one, a retry on the release date not counting", async () => {
    const w = await world({ contact: BOTH, releaseAt: DUE_6 });
    w.pay.confirmOffSessionOutcomes = [{ declined: "insufficient_funds" }, { declined: "insufficient_funds" }];

    await w.run(DUE);
    await w.run(DUE_3);

    expect(w.tell.mock.calls.map(([, failure]) => failure)).toEqual([declinedAt(0, DUE_3), declinedAt(1, null)]);
    expect(alerts(w)).toEqual(
      [
        balanceAdminAlertBody({ reservation: await w.row(), failure: declinedAt(0, DUE_3) }),
        balanceAdminAlertBody({ reservation: await w.row(), failure: declinedAt(1, null) }),
      ],
    );
  });

  it("AC4: a bank approval texts the admins once, and nothing is retried though retry days are left", async () => {
    const w = await world({ contact: BOTH });
    w.pay.confirmOffSessionOutcomes = ["needs_approval"];

    await w.run(DUE);

    expect(w.tell.mock.calls.map(([, failure]) => failure)).toEqual([NEEDS_APPROVAL]);
    expect(alerts(w)).toEqual([balanceAdminAlertBody({ reservation: await w.row(), failure: NEEDS_APPROVAL })]);
  });

  it("AC5: a declined charge writes one engine row with the attempt, the code and the outcome per channel", async () => {
    const w = await world({ contact: BOTH });
    w.pay.confirmOffSessionOutcomes = [{ declined: "insufficient_funds" }];

    await w.run(DUE);

    const rows = await w.trail();
    expect(rows).toMatchObject([
      {
        id: `balance_charge_failed:${RES}:0`,
        reservationId: RES,
        type: "balance_charge_failed",
        actorKind: "engine",
        timestamp: DUE,
      },
    ]);
    expect(rows.map((r) => r.metadata)).toEqual([
      { attempt: 0, reason: "insufficient_funds", outcome: "email=sent sms=sent" },
    ]);
  });

  it("AC5: a decline the bank sent no code for reads declined", async () => {
    const w = await world({ contact: BOTH });
    vi.spyOn(w.pay, "confirmOffSession").mockResolvedValueOnce({ outcome: "declined" });

    expect(await w.run(DUE)).toEqual({ ...NONE, declined: 1 });

    expect((await w.trail()).map((r) => r.metadata)).toEqual([
      { attempt: 0, reason: "declined", outcome: "email=sent sms=sent" },
    ]);
  });

  it("AC5: a bank approval's reason reads needs_approval", async () => {
    const w = await world({ contact: BOTH });
    w.pay.confirmOffSessionOutcomes = ["needs_approval"];

    await w.run(DUE);

    expect((await w.trail()).map((r) => r.metadata)).toEqual([
      { attempt: 0, reason: "needs_approval", outcome: "email=sent sms=sent" },
    ]);
  });

  it("AC5: a channel that is the console reads logged", async () => {
    const w = await world({ contact: BOTH, smsLogsOnly: true });
    w.pay.confirmOffSessionOutcomes = [{ declined: "insufficient_funds" }];

    await w.run(DUE);

    expect((await w.trail()).map((r) => r.metadata)).toEqual([
      { attempt: 0, reason: "insufficient_funds", outcome: "email=sent sms=logged" },
    ]);
  });

  it("AC6: a booking with neither email nor phone is sent nothing, reads absent on both, and the admins are still texted", async () => {
    const w = await world({ contact: {} });
    w.pay.confirmOffSessionOutcomes = [{ declined: "insufficient_funds" }];

    await w.run(DUE);

    expect(sentTo(w)).toEqual({ email: [], sms: [] });
    expect((await w.trail()).map((r) => r.metadata)).toEqual([
      { attempt: 0, reason: "insufficient_funds", outcome: "email=absent sms=absent" },
    ]);
    expect(w.alert).toHaveBeenCalledOnce();
  });

  /** The attempt stands: recorded declined, its claim kept, and the next tick charges nothing. */
  async function expectAttemptStands(w: World) {
    expect(await w.repo.listBalanceAttempts(RES)).toMatchObject([{ attempt: 0, outcome: "declined" }]);
    expect(await w.run(later(DUE, 15))).toEqual(NONE);
    expect(w.keys()).toEqual([`balance_${RES}_0`]);
  }

  it("AC7: a customer notice that throws leaves the attempt declined and no error counted, the admins texted, and the row reading error", async () => {
    quietLog();
    const w = await world({ contact: BOTH });
    w.pay.confirmOffSessionOutcomes = [{ declined: "insufficient_funds" }];
    vi.spyOn(w.repo, "listBookingCodesForReservation").mockRejectedValue(new Error("database unreachable"));

    expect(await w.run(DUE)).toEqual({ ...NONE, declined: 1 });

    expect(sentTo(w)).toEqual({ email: [], sms: [] });
    expect(alerts(w)).toHaveLength(1);
    expect((await w.trail()).map((r) => r.metadata)).toEqual([
      { attempt: 0, reason: "insufficient_funds", outcome: "error" },
    ]);
    await expectAttemptStands(w);
  });

  it("AC7: a tellBalanceFailed that rejects is swallowed and logged, writes no row of its own, and the admins are still texted", async () => {
    const logged = quietLog();
    const w = await world({ contact: BOTH });
    w.pay.confirmOffSessionOutcomes = [{ declined: "insufficient_funds" }];
    w.tell.mockRejectedValueOnce(new Error("sender blew up"));

    expect(await w.run(DUE)).toEqual({ ...NONE, declined: 1 });

    expect(alerts(w)).toHaveLength(1);
    expect(await w.trail()).toEqual([]);
    expect(
      logged.mock.calls.filter((args) => args.some((a) => a instanceof Error && a.message === "sender blew up")),
    ).toHaveLength(1);
    await expectAttemptStands(w);
  });

  it("AC7: a money alert that throws does not stop the customer notice, and leaves the attempt declined", async () => {
    quietLog();
    const w = await world({ contact: BOTH });
    w.pay.confirmOffSessionOutcomes = [{ declined: "insufficient_funds" }];
    w.alert.mockRejectedValueOnce(new Error("carrier down"));

    expect(await w.run(DUE)).toEqual({ ...NONE, declined: 1 });

    expect(w.alert).toHaveBeenCalledOnce();
    expect(w.email.sent).toHaveLength(1);
    expect(w.sms.sent).toHaveLength(1);
    expect((await w.trail()).map((r) => r.metadata)).toEqual([
      { attempt: 0, reason: "insufficient_funds", outcome: "email=sent sms=sent" },
    ]);
    await expectAttemptStands(w);
  });

  it("AC8: declines on the due date and both retries send three notices and three admin texts, one per attempt", async () => {
    const w = await world({ contact: BOTH });
    w.pay.confirmOffSessionOutcomes = [
      { declined: "insufficient_funds" },
      { declined: "insufficient_funds" },
      { declined: "insufficient_funds" },
    ];

    // Each attempt's tick, then the next tick fifteen minutes on, which tells nobody again.
    const told: number[][] = [];
    for (const at of [DUE, DUE_3, DUE_6]) {
      for (const minutes of [0, 15]) {
        await w.run(later(at, minutes));
        told.push([w.email.sent.length, w.sms.sent.length, w.alert.mock.calls.length]);
      }
    }

    expect(told).toEqual([
      [1, 1, 1],
      [1, 1, 1],
      [2, 2, 2],
      [2, 2, 2],
      [3, 3, 3],
      [3, 3, 3],
    ]);
    expect((await w.trail()).map((r) => [String(r.id), r.metadata])).toEqual(
      [0, 1, 2].map((attempt) => [
        `balance_charge_failed:${RES}:${attempt}`,
        { attempt, reason: "insufficient_funds", outcome: "email=sent sms=sent" },
      ]),
    );
  });

  it("AC9: a charge that throws before an outcome sends nothing, and the next tick's failure is told once", async () => {
    quietLog();
    const w = await world({ contact: BOTH });
    w.pay.confirmOffSessionOutcomes = ["throw", { declined: "insufficient_funds" }];

    expect(await w.run(DUE)).toEqual({ ...NONE, errors: 1 });
    expect(sentTo(w)).toEqual({ email: [], sms: [] });
    expect(w.alert).not.toHaveBeenCalled();
    expect(await w.trail()).toEqual([]);

    expect(await w.run(later(DUE, 15))).toEqual({ ...NONE, declined: 1 });
    expect(w.email.sent).toHaveLength(1);
    expect(w.sms.sent).toHaveLength(1);
    expect(w.alert).toHaveBeenCalledOnce();
    expect(await w.trail()).toHaveLength(1);
  });

  it("AC9: a decline whose outcome could not be written sends nothing until the next tick writes it, then tells once", async () => {
    quietLog();
    const w = await world({ contact: BOTH });
    w.pay.confirmOffSessionOutcomes = [{ declined: "insufficient_funds" }];
    vi.spyOn(w.repo, "finishBalanceAttempt").mockRejectedValueOnce(new Error("connection lost"));

    expect(await w.run(DUE)).toEqual({ ...NONE, errors: 1 });
    expect(sentTo(w)).toEqual({ email: [], sms: [] });
    expect(w.alert).not.toHaveBeenCalled();
    expect(await w.trail()).toEqual([]);

    expect(await w.run(later(DUE, 15))).toEqual({ ...NONE, declined: 1 });
    expect(w.email.sent).toHaveLength(1);
    expect(w.sms.sent).toHaveLength(1);
    expect(w.alert).toHaveBeenCalledOnce();
    expect(await w.trail()).toHaveLength(1);
  });
});

// ── The webhook and the success page meet the balance intent ───────────────────────────────

describe("the balance intent's payment_intent.succeeded", () => {
  const succeeded = (pi: string, amountReceivedCents = OWED): string =>
    JSON.stringify({
      type: "payment_succeeded",
      data: {
        paymentIntentId: pi,
        amountReceivedCents,
        currency: "usd",
        metadata: { reservation_id: String(RES), purpose: "balance" },
      },
    });

  it("AC3: the webhook writes AC2's row and never reaches the pending-row confirm", async () => {
    const w = await world();
    await w.repo.saveBalancePaymentIntentId(RES, "pi_bal");

    const r = await processBookingWebhook(w.deps, succeeded("pi_bal"), FAKE_SIGNATURE);

    expect(r).toEqual({ handled: true, outcome: "balance_paid" });
    const payments = await w.repo.listPaymentsForReservation(RES);
    expect(payments.map((p) => p.kind).sort()).toEqual(["balance", "deposit"]);
    const bal = payments.find((p) => p.kind === "balance")!;
    expect(bal).toMatchObject({
      id: "pay_pi_bal",
      amountCents: OWED,
      taxCents: 0,
      status: "succeeded",
      stripePaymentIntentId: "pi_bal",
    });
    expect(bal).not.toHaveProperty("gratuityCents");
    expect(bal).not.toHaveProperty("serviceFeeCents");
    expect(bal).not.toHaveProperty("flexCents");
    // The booking spine's "already" leg would retire the row's other intents; it never ran.
    expect(w.pay.cancelled).toEqual([]);
    expect(w.alert).not.toHaveBeenCalled();
  });

  it("AC3: one row whether the job, the webhook or both record it", async () => {
    const w = await world();
    await w.run(DUE);
    const intentId = (await w.row()).balancePaymentIntentId!;

    const r = await processBookingWebhook(w.deps, succeeded(intentId), FAKE_SIGNATURE);
    await processBookingWebhook(w.deps, succeeded(intentId), FAKE_SIGNATURE);

    expect(r).toEqual({ handled: true, outcome: "balance_paid" });
    expect(await w.balanceRows()).toHaveLength(1);
    expect(await w.repo.listPaymentsForReservation(RES)).toHaveLength(2);
  });

  it("AC3: /book/success with the balance intent's id writes no booking payment", async () => {
    const w = await world();
    await w.repo.saveBalancePaymentIntentId(RES, "pi_bal");
    // Sanity: the balance intent IS on the row, so the success page's confirm can find the booking.
    expect((await w.row()).paymentIntentIds).toContain("pi_bal");
    w.pay.succeededIntents.set("pi_bal", {
      paymentIntentId: "pi_bal",
      amountReceivedCents: OWED,
      currency: "usd",
      metadata: { reservation_id: String(RES), purpose: "balance" },
    });

    await confirmBookingByPaymentIntent(w.deps, "pi_bal");

    expect(await w.repo.getPayment(asId<"PaymentId">("pay_pi_bal"))).toBeNull();
    expect((await w.repo.listPaymentsForReservation(RES)).map((p) => p.kind)).toEqual(["deposit"]);
  });

  it("AC2: a charge on an intent that is not the booking's balance intent is refused — no row, an alert", async () => {
    const w = await world();
    await w.repo.saveBalancePaymentIntentId(RES, "pi_bal");
    w.at(DUE);

    await recordBalancePayment(
      w.deps,
      { paymentIntentId: "pi_stranger", amountReceivedCents: OWED, currency: "usd", metadata: {} },
      RES,
    );

    expect(await w.balanceRows()).toEqual([]);
    expect(w.alert).toHaveBeenCalledOnce();
  });
});

// ── The manage page ────────────────────────────────────────────────────────────────────────

describe("paying the balance on the manage page", () => {
  const paid = (w: Awaited<ReturnType<typeof world>>, pi: string, amountReceivedCents = OWED) =>
    w.pay.succeededIntents.set(pi, { paymentIntentId: pi, amountReceivedCents, currency: "usd", metadata: {} });

  it("AC11: the page offers `Pay balance · $552.94` while the balance is payable", async () => {
    const w = await world();
    expect((await w.manageView()).payBalance).toEqual({ label: "Pay balance · $552.94", amountCents: OWED });
  });

  it("AC11: the press starts the balance on the booking's balance intent, cards only, at what is owed", async () => {
    const w = await world();
    w.at("2026-07-15T12:00:00.000Z");

    const r = await startBalancePayment(w.deps, RES);

    expect(r).toMatchObject({ ok: true, amountCents: OWED });
    if (!r.ok) return;
    expect(r.clientSecret).not.toBe("");
    expect(w.pay.intents).toHaveLength(1);
    expect(w.pay.intents[0]).toMatchObject({
      amountCents: OWED,
      customerId: CUS,
      idempotencyKey: `balance_${RES}`,
      cardsOnly: true,
    });
    expect(w.pay.intents[0]!.setupFutureUsage).toBeUndefined();
    expect((await w.row()).balancePaymentIntentId).toBeDefined();
  });

  it("AC11: a press after a declined scheduled attempt uses the same intent, its amount set to what is owed", async () => {
    const w = await world();
    w.pay.confirmOffSessionOutcomes = [{ declined: "card_declined" }];
    await w.run(DUE);
    const intentId = (await w.row()).balancePaymentIntentId!;

    w.at(later(DUE, 120));
    const r = await startBalancePayment(w.deps, RES);

    expect(r).toMatchObject({ ok: true, amountCents: OWED });
    expect(w.pay.intents).toHaveLength(1);
    expect(w.pay.amountUpdates.at(-1)).toEqual({ paymentIntentId: intentId, amountCents: OWED });
  });

  it("AC11: the return from a paid card form writes AC2's row, and the page reads paid in full", async () => {
    const w = await world();
    w.at("2026-07-15T12:00:00.000Z");
    await startBalancePayment(w.deps, RES);
    const intentId = (await w.row()).balancePaymentIntentId!;
    paid(w, intentId);

    expect(await recordBalanceReturn(w.deps, CODE, intentId)).toBe("recorded");

    const rows = await w.balanceRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: `pay_${intentId}`, kind: "balance", amountCents: OWED, taxCents: 0 });
    expect((await w.manageView()).paidInFull).toBe(true);
  });

  it("AC11: a revisit of the return after the row exists says recorded and writes nothing new", async () => {
    const w = await world();
    w.at("2026-07-15T12:00:00.000Z");
    await startBalancePayment(w.deps, RES);
    const intentId = (await w.row()).balancePaymentIntentId!;
    paid(w, intentId);
    await recordBalanceReturn(w.deps, CODE, intentId);

    expect(await recordBalanceReturn(w.deps, CODE, intentId)).toBe("recorded");
    expect(await w.balanceRows()).toHaveLength(1);
  });

  it("AC11: a return with an intent that has not succeeded is ignored", async () => {
    const w = await world();
    w.at("2026-07-15T12:00:00.000Z");
    await startBalancePayment(w.deps, RES);
    const intentId = (await w.row()).balancePaymentIntentId!;

    expect(await recordBalanceReturn(w.deps, CODE, intentId)).toBe("ignored");
    expect(await w.balanceRows()).toEqual([]);
  });

  it("AC11: a return naming an intent that is not the booking's balance intent is ignored, even a paid one", async () => {
    const w = await world();
    w.at("2026-07-15T12:00:00.000Z");
    await startBalancePayment(w.deps, RES);
    paid(w, "pi_other");

    expect(await recordBalanceReturn(w.deps, CODE, "pi_other")).toBe("ignored");
    expect(await w.balanceRows()).toEqual([]);
  });

  it("AC11: a return through a revoked booking code is ignored", async () => {
    const w = await world();
    w.at("2026-07-15T12:00:00.000Z");
    await startBalancePayment(w.deps, RES);
    const intentId = (await w.row()).balancePaymentIntentId!;
    paid(w, intentId);
    await w.repo.revokeBookingCode(CODE, "2026-07-15T12:05:00.000Z");

    expect(await recordBalanceReturn(w.deps, CODE, intentId)).toBe("ignored");
    expect(await w.balanceRows()).toEqual([]);
  });

  it("AC11: a press on a cancelled booking is refused not_active, with nothing started", async () => {
    const w = await world();
    await w.repo.saveReservation({ ...(await w.row()), status: "cancelled" });

    expect(await startBalancePayment(w.deps, RES)).toEqual({ ok: false, reason: "not_active" });
    expect(w.pay.intents).toEqual([]);
  });

  it("AC11: a press that cannot take a payment reads the call-us line", () => {
    for (const reason of ["not_active", "disputed"] as const) {
      expect(balanceRefusalMessage(reason, "+12165550100")).toBe(
        "This booking can’t take a payment right now — call us at (216) 555-0100.",
      );
      expect(balanceRefusalMessage(reason, null)).toBe("This booking can’t take a payment right now — call us.");
    }
  });

  it("AC12: a balance paid on the manage page is not charged by the job", async () => {
    const w = await world();
    w.at("2026-07-15T12:00:00.000Z");
    await startBalancePayment(w.deps, RES);
    const intentId = (await w.row()).balancePaymentIntentId!;
    paid(w, intentId);
    expect(await recordBalanceReturn(w.deps, CODE, intentId)).toBe("recorded");

    expect(await w.run(DUE)).toEqual(NONE);
    expect(w.pay.confirmOffSessionCalls).toEqual([]);
    expect(await w.balanceRows()).toHaveLength(1);
  });

  it("AC12: once the job has collected the balance, the button is gone", async () => {
    const w = await world();
    await w.run(DUE);
    expect(await w.balanceRows()).toHaveLength(1);

    expect((await w.manageView()).payBalance).toBeNull();
  });

  it("AC12: a stale page's press after the job collected is refused — `Your balance is already paid.`", async () => {
    const w = await world();
    await w.run(DUE);
    const intents = w.pay.intents.length;
    const updates = w.pay.amountUpdates.length;

    w.at(later(DUE, 30));
    const r = await startBalancePayment(w.deps, RES);

    expect(r).toEqual({ ok: false, reason: "no_balance" });
    expect(balanceRefusalMessage("no_balance", "+12165550100")).toBe("Your balance is already paid.");
    expect(w.pay.intents).toHaveLength(intents);
    expect(w.pay.amountUpdates).toHaveLength(updates);
  });
});
