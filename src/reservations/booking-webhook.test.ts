/**
 * processBookingWebhook (11.2) — the charge→booking spine, driven via FakePaymentPort.
 */
import { describe, expect, it, vi } from "vitest";
import { FAKE_SIGNATURE, FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Event, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { CheckoutCompleted } from "../ports/payment.js";
import { eventIdForSlot } from "./availability.js";
import { processBookingWebhook, type WebhookDeps } from "./booking-webhook.js";
import { confirmPendingRow } from "./write-booking.js";
import { balanceOwedCents } from "./payment-config.js";
import { formAllVesselDaysForTest } from "../builder/form-all-test-support.js";

const EVENT = asId<"EventId">("m-evt-1");
const NOW = () => "2026-07-12T00:00:00.000Z";

// The booking flow since 14.5: checkout writes a PENDING row before Stripe, keyed by the
// PaymentIntent id; `payment_intent.succeeded` FLIPS that row to booked. So a booking test seeds
// the pending row, then delivers the PI event — no hosted `checkout.session.completed` insert.
const V = asId<"VesselId">("v");
const DATE = "2026-07-04";
const TIME = "17:00";
const PEND = asId<"ReservationId">("resv-pend");
const PI = "pi_1";
const SLOT = eventIdForSlot(V, DATE, TIME);

const musterEvent = (over: Partial<Event> = {}): Event => ({
  id: EVENT,
  vesselId: V,
  date: DATE,
  time: TIME,
  capacity: 12,
  status: "scheduled",
  source: "muster",
  price: 50000,
  ...over,
});

const pendingRow = (over: Partial<Reservation> = {}): Reservation => ({
  id: PEND,
  eventId: null,
  source: "muster",
  status: "pending",
  customerName: "Mary",
  partySize: 6,
  phone: "216-555-0148",
  email: "m@x.io",
  vesselId: V,
  date: DATE,
  time: TIME,
  offeringId: asId<"OfferingId">("off-1"),
  reservedAt: "2026-07-11T23:55:00.000Z", // inside the 15-min window before NOW
  holdMinutes: 120,
  tripMinutes: 100,
  paymentIntentIds: [PI],
  // The invoice the real checkout freezes (14.4, DEC-164, `amountDueNowCents` from 15.4). Absent
  // here until 15.6, which is why every test through this fixture was exercising a row shape the
  // checkout cannot produce — the money came from Stripe's metadata instead.
  invoice: {
    fareCents: 50000,
    extrasCents: 0,
    taxCents: 3625,
    taxRateBps: 725,
    serviceFeeCents: 0,
    serviceFeeBps: 0,
    gratuityCents: 0,
    gratuityBps: 0,
    totalCents: 53625,
    amountDueNowCents: 53625,
  },
  ...over,
});

/** Seed the pending row a checkout would have written, plus a vessel for the flip's capacity. */
async function seedPending(repo: InMemoryRepository, over: Partial<Reservation> = {}): Promise<Reservation> {
  await repo.saveVessel({ id: V, name: "Brew", coiMaxPax: 12, manning: [] });
  const row = pendingRow(over);
  await repo.saveReservation(row);
  return row;
}

/** A `payment_intent.succeeded` booking event — the live booking shape (12.5). Money in metadata
 *  (until 15.1); the slot comes from the pending row, not from here. */
const bookingPi = (
  pi = PI,
  amountReceivedCents = 53625,
  metaOver: Record<string, string> = {},
): string =>
  JSON.stringify({
    type: "payment_succeeded",
    data: {
      paymentIntentId: pi,
      amountReceivedCents,
      currency: "usd",
      metadata: {
        purpose: "booking",
        priceCents: "50000",
        kind: "full",
        taxCents: "3625",
        customerName: "Mary",
        email: "m@x.io",
        ...metaOver,
      },
    },
  });

function makeDeps(repo: InMemoryRepository, payments: FakePaymentPort = new FakePaymentPort()) {
  const alert = vi.fn(async (_message: string) => {});
  const confirm = vi.fn(async (_reservation: unknown) => true);
  const soldOut = vi.fn(async (_c: unknown) => {});
  const deps: WebhookDeps = {
    repo,
    reservationsEnabled: true,
    payments,
    now: NOW,
    alertPaidButUnbooked: alert,
    sendConfirmation: confirm,
    notifyCustomerSoldOut: soldOut,
  };
  return { deps, alert, confirm, soldOut, payments };
}

describe("processBookingWebhook — the RESERVATIONS gate (#588, DEC-111)", () => {
  it("acks a valid signed event without booking anything when the flag is off", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);
    const { deps, alert, confirm } = makeDeps(repo);

    const r = await processBookingWebhook(
      { ...deps, reservationsEnabled: false },
      bookingPi(),
      FAKE_SIGNATURE,
    );

    // Acked, not errored: a non-2xx would make Stripe retry an event we never want.
    expect(r).toEqual({ handled: false });
    // Nothing flipped, nobody emailed — the pending row stays pending.
    expect((await repo.getReservation(PEND))!.status).toBe("pending");
    expect(await repo.listPaymentsForReservation(PEND)).toHaveLength(0);
    expect(confirm).not.toHaveBeenCalled();
    // But loud — a verified charge succeeded and we deliberately did not book it.
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toMatch(/RESERVATIONS is off/);
  });

  it("still records a BALANCE payment when the flag is off — the gate is about new bookings only", async () => {
    // The regression this pins: the gate first sat right after signature verification, ahead of
    // purpose dispatch, so it swallowed balance collection too. Balance links are minted by an
    // admin-gated action that has no RESERVATIONS check, and the flag is off by default — so in a
    // default deployment Stripe charged the customer and Muster recorded nothing.
    const repo = new InMemoryRepository();
    await seedDepositBooking(repo);
    const { deps, alert } = makeDeps(repo);

    const r = await processBookingWebhook(
      { ...deps, reservationsEnabled: false },
      JSON.stringify(balanceCompleted()),
      FAKE_SIGNATURE,
    );

    expect(r).toEqual({ handled: true, outcome: "balance_paid" });
    const balances = (await repo.listPaymentsForReservation(RES)).filter((p) => p.kind === "balance");
    expect(balances).toHaveLength(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it("still rejects a bad signature when the flag is off, so the flag can't probe the endpoint", async () => {
    // The gate sits AFTER verification deliberately. If it ran first, a forged request would
    // get the same ack as a real one and an attacker could tell a live endpoint from a dark one.
    const repo = new InMemoryRepository();
    const { deps } = makeDeps(repo);

    await expect(
      processBookingWebhook({ ...deps, reservationsEnabled: false }, bookingPi(), "bad_signature"),
    ).rejects.toThrow();
  });
});

describe("processBookingWebhook", () => {
  it("booked: flips the pending row + records the payment", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);
    const { deps, alert, confirm } = makeDeps(repo);

    const r = await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "booked" });

    // Confirmation fires once, with the freshly-booked row — same id checkout minted (DEC-122).
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]![0]).toMatchObject({ id: PEND, status: "booked" });
    expect((await repo.getReservation(PEND))!.status).toBe("booked");
    const payments = await repo.listPaymentsForReservation(PEND);
    expect(payments).toHaveLength(1);
    // Payment keyed off the PI id; no session id on the Elements path.
    expect(payments[0]).toMatchObject({
      id: "pay_pi_1",
      amountCents: 53625,
      taxCents: 3625,
      kind: "full",
      status: "succeeded",
      stripePaymentIntentId: "pi_1",
    });
    expect(payments[0]!.stripeCheckoutSessionId).toBeUndefined();
    expect(alert).not.toHaveBeenCalled();
  });

  it("already: a re-delivered webhook is idempotent — no second flip or payment", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);
    const { deps, confirm } = makeDeps(repo);

    await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);
    const r = await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "already" });

    expect(await repo.listReservationsForEvent(SLOT)).toHaveLength(1);
    expect(await repo.listPaymentsForReservation(PEND)).toHaveLength(1);
    // The re-delivery resolves to `already` → NO second confirmation (DEC-122):
    // one send across both calls, or the customer is re-texted on every retry.
    expect(confirm).toHaveBeenCalledOnce();
  });

  /**
   * A booking charge that resolves to NO pending row is refused loudly (§2.8.6). Two shapes reach
   * this: a purposed PaymentIntent whose row was never written (or is not ours), and a hosted
   * `checkout.session.completed` booking session, which nothing mints since 14.5. Both mean money
   * moved with nothing behind it — the one thing that must never pass quietly.
   */
  it("a PI with no pending row: acked, books nothing, and does NOT alert (15.6)", async () => {
    // This asserted an alert until 15.6, back when a `purpose` key filtered foreign intents out
    // before the lookup. With no metadata on the booking charge the lookup IS the filter, and the
    // bare PaymentIntent under every hosted balance or gratuity session arrives here — so alerting
    // would page every admin on routine payments. A booking payment always has a row.
    const repo = new InMemoryRepository();
    const { deps, alert, confirm } = makeDeps(repo);

    const r = await processBookingWebhook(deps, bookingPi("pi_stranger"), FAKE_SIGNATURE);

    expect(r).toEqual({ handled: false });
    expect(alert).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect((await repo.listAllReservations())).toHaveLength(0);
  });

  it("a hosted booking session is refused — the hosted booking path was retired (14.5)", async () => {
    const repo = new InMemoryRepository();
    const { deps, alert, confirm } = makeDeps(repo);
    const hosted = {
      sessionId: "cs_hosted_1",
      paymentIntentId: "pi_hosted_1",
      amountTotalCents: 53625,
      currency: "usd",
      metadata: { purpose: "booking", priceCents: "50000", kind: "full", customerName: "Mary" },
    };

    const r = await processBookingWebhook(deps, JSON.stringify(hosted), FAKE_SIGNATURE);

    expect(r).toEqual({ handled: true, outcome: "unbookable" });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toContain("hosted Checkout booking session");
    expect(confirm).not.toHaveBeenCalled();
    expect(await repo.listAllReservations()).toHaveLength(0);
  });

  it("carries the party-fare extras from the ROW's invoice onto the flipped row (#474, 15.6)", async () => {
    // The extras used to travel in the charge's metadata. They are on the invoice now, which is
    // where the checkout froze them — the balance deriver bills base + extras, so this number
    // decides what a deposit-mode customer still owes.
    const repo = new InMemoryRepository();
    const seeded = pendingRow();
    await seedPending(repo, { invoice: { ...seeded.invoice!, extrasCents: 6000 } });
    const { deps } = makeDeps(repo);

    const r = await processBookingWebhook(deps, bookingPi(PI, 53625), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "booked" });
    expect((await repo.getReservation(PEND))!.extrasCents).toBe(6000);
  });

  it("the waiver consent frozen on the pending row survives the flip (11.5, DEC-110)", async () => {
    // Waiver is stamped at checkout-start onto the pending row (14.4), not read from the charge.
    const repo = new InMemoryRepository();
    await seedPending(repo, {
      waiverConsentAt: "2026-07-13T12:00:00.000Z",
      waiverVersion: "v1",
    });
    const { deps } = makeDeps(repo);

    await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);
    const res = (await repo.getReservation(PEND))!;
    expect(res.waiverConsentAt).toBe("2026-07-13T12:00:00.000Z");
    expect(res.waiverVersion).toBe("v1");
  });

  /**
   * The residual race (DEC-109): a rival won the boat between checkout and confirm, so the flip
   * loses. Auto-refund keyed on the PI + a sold-out notice, no operator in the loop, and NO
   * payment row — there is no booking to hang it on. The pending row stays pending (15.2 decides
   * what becomes of it).
   *
   * The empty-payments contract (#613) is enforced by a real FK only in Postgres; the in-memory
   * double is a `Map.set`, so `postgres-repository.test.ts` carries the load-bearing version.
   */
  it("loses the boat to a rival: auto-refunds, tells the customer, writes NO payment", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);
    // A rival already booked the slot — the flip's whole-boat mutex loses.
    await repo.saveEvent(musterEvent({ id: SLOT }));
    await repo.saveReservation({
      id: asId<"ReservationId">("r-rival"),
      eventId: SLOT,
      source: "muster",
      customerName: "Rival",
      partySize: 4,
      status: "booked",
    });
    const payments = new FakePaymentPort();
    const { deps, alert, confirm, soldOut } = makeDeps(repo, payments);

    const r = await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "lost" });
    // Refunded once, keyed on the PI so a redelivery cannot double-refund (DEC-107 amended).
    expect(payments.refunds).toHaveLength(1);
    expect(payments.refunds[0]!.idempotencyKey).toBe("refund_pi_1");
    expect(soldOut).toHaveBeenCalledOnce();
    // The operator IS told, as of 15.5 — the path resolves itself, but a customer was still
    // charged for a trip they did not get. Asserted properly in its own case below; here it is
    // pinned only as "informational, not an action request".
    expect(alert).toHaveBeenCalledOnce();
    expect(String(alert.mock.calls[0]![0])).not.toMatch(/REFUND MANUALLY/);
    expect(confirm).not.toHaveBeenCalled(); // no booking → no confirmation
    expect(await repo.listPaymentsForReservation(PEND)).toHaveLength(0);
    // The row is not booked — it stayed pending.
    expect((await repo.getReservation(PEND))!.status).toBe("pending");
  });

  it("retires the loser's OTHER intents — this row will never book (15.10)", async () => {
    // `@code-review` caught this: the first cut of 15.10 retired siblings only on the booked path.
    // A residual-race loser is the one row class where an un-retired intent stays payable FOREVER
    // rather than for a window — its flip is refused and no later delivery can succeed, nothing
    // reaps lapsed rows, and these are the only two places anything cancels an intent. So a stale
    // tab could pay a duplicate charge against a reservation that lost the boat, indefinitely.
    const repo = new InMemoryRepository();
    await seedPending(repo, { paymentIntentIds: ["pi_earlier", PI] });
    await repo.saveEvent(musterEvent({ id: SLOT }));
    await repo.saveReservation({
      id: asId<"ReservationId">("r-rival"),
      eventId: SLOT,
      source: "muster",
      customerName: "Rival",
      partySize: 4,
      status: "booked",
    });
    const payments = new FakePaymentPort();
    const { deps } = makeDeps(repo, payments);

    const r = await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);

    expect(r).toEqual({ handled: true, outcome: "lost" });
    // The earlier one is retired; the one that PAID is refunded, not cancelled — Stripe refuses a
    // cancel on a succeeded intent anyway, so asking would be both wrong and futile.
    expect(payments.cancelled).toEqual([{ paymentIntentId: "pi_earlier", reason: "duplicate" }]);
    expect(payments.refunds).toHaveLength(1);
    expect(payments.refunds[0]!.paymentIntentId).toBe(PI);
  });

  it("takes the money from the row's frozen invoice, not the succeeded intent's metadata", async () => {
    // DEC-164 and SPEC 2.8's negative list: "No booking assembled from data Stripe hands back."
    // The metadata below is deliberately wrong. After 15.6 there is no parameter it could travel
    // through, so the numbers can only come off the row.
    const repo = new InMemoryRepository();
    const seeded = pendingRow();
    await seedPending(repo, {
      invoice: { ...seeded.invoice!, fareCents: 50000, extrasCents: 3000 },
    });
    const { deps } = makeDeps(repo, new FakePaymentPort());

    await processBookingWebhook(
      deps,
      bookingPi(PI, 53625, { priceCents: "1", extrasCents: "2", taxCents: "0" }),
      FAKE_SIGNATURE,
    );

    const row = (await repo.getReservation(PEND))!;
    expect(row.status).toBe("booked");
    const event = (await repo.listEvents()).find((e) => e.id === row.eventId)!;
    expect(event.price).toBe(50000); // the invoice's fare, not metadata's "1"
    expect(row.extrasCents).toBe(3000); // the invoice's extras, not metadata's "2"
  });

  /** A losing charge carrying NO contact in its metadata at all — what 15.7 leaves behind once
   *  the metadata keys are deleted. The contact must come off the row or it comes from nowhere. */
  const strippedPi = (): string =>
    JSON.stringify({
      type: "payment_succeeded",
      data: {
        paymentIntentId: PI,
        amountReceivedCents: 53625,
        currency: "usd",
        metadata: { purpose: "booking", priceCents: "50000" },
      },
    });

  /** Seed a rival into the slot so the flip's whole-boat mutex loses. */
  async function seedRival(repo: InMemoryRepository): Promise<void> {
    await repo.saveEvent(musterEvent({ id: SLOT }));
    await repo.saveReservation({
      id: asId<"ReservationId">("r-rival"),
      eventId: SLOT,
      source: "muster",
      customerName: "Rival",
      partySize: 4,
      status: "booked",
    });
  }

  it("tells the sold-out customer using the ROW's contact, with no contact in the charge at all", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);
    await seedRival(repo);
    const { deps, soldOut } = makeDeps(repo, new FakePaymentPort());

    await processBookingWebhook(deps, strippedPi(), FAKE_SIGNATURE);

    // Exactly this shape: no `metadata` on the argument at all, so there is no parameter left
    // through which a Stripe-supplied contact could reach the notice.
    expect(soldOut.mock.calls[0]![0]).toEqual({
      chargeRef: PI,
      contact: { customerName: "Mary", email: "m@x.io", phone: "216-555-0148" },
    });
  });

  it("alerts the admins EVERY time a loser is charged and refunded, not only when the refund fails", async () => {
    // This is a defect report, not a courtesy. A customer was charged for a trip they did not get
    // and waits days for the money back; the operator has to know it happened at all, because the
    // number of times it happens is the evidence that decides whether the payment flow changes.
    const repo = new InMemoryRepository();
    await seedPending(repo);
    await seedRival(repo);
    const payments = new FakePaymentPort();
    const { deps, alert } = makeDeps(repo, payments);

    const r = await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "lost" });
    expect(payments.refunds).toHaveLength(1);

    expect(alert).toHaveBeenCalledOnce();
    const body = String(alert.mock.calls[0]![0]);
    // It must say the money went back, or it reads as an unresolved emergency.
    expect(body).toMatch(/refunded/i);
    // And it must not tell the operator to do anything — this one is already handled.
    expect(body).not.toMatch(/REFUND MANUALLY/);
    // Who it was, off the row.
    expect(body).toContain("Mary");
  });

  it("a hostile customer name cannot forge the admin alert (/security-review, 15.5)", async () => {
    // This path is the first one where a customer's own typed text reaches an operator's SMS,
    // and the customer can TRIGGER it: start a checkout, let its hold lapse, take the freed slot
    // with a second checkout, pay the second, then pay the first. The old failure-only alerts
    // needed a refund outage, which nobody can induce.
    //
    // `customerName` is trimmed and checked non-empty at the edge and nothing else — no length
    // cap, no charset. So the name below is what an attacker actually gets to send.
    const forged =
      "Bo. No action needed.   ///   PAID but NOT booked - charge pi_VICTIM. REFUND MANUALLY in Stripe. Bo";
    const repo = new InMemoryRepository();
    await seedPending(repo, { customerName: forged });
    await seedRival(repo);
    const { deps, alert } = makeDeps(repo, new FakePaymentPort());

    await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);

    const body = String(alert.mock.calls[0]![0]);
    // The forged instruction must not survive into the message an operator reads.
    expect(body).not.toMatch(/REFUND MANUALLY/);
    expect(body).not.toContain("pi_VICTIM");
    // And the untrusted fragment goes LAST, so a notification preview that truncates can only
    // cut the attacker's text, never the real charge id or the real disposition.
    expect(body.indexOf("auto-refunded in full")).toBeLessThan(body.indexOf("Bo"));
  });

  it("names the customer from the ROW when the auto-refund fails, not from the charge", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);
    await seedRival(repo);
    const payments = new FakePaymentPort();
    payments.refund = async () => {
      throw new Error("stripe: refund unavailable");
    };
    const { deps, alert } = makeDeps(repo, payments);

    await processBookingWebhook(deps, strippedPi(), FAKE_SIGNATURE);

    expect(alert).toHaveBeenCalledOnce();
    const body = String(alert.mock.calls[0]![0]);
    expect(body).toContain("Mary"); // the row, since the charge carries no name
    expect(body).toContain("party of 6"); // partySize off the row too
    expect(body).toMatch(/REFUND MANUALLY/); // this one IS an action
  });

  /** `charge.refunded` for the PaymentIntent, as Stripe sends it after our own auto-refund. */
  const refundEvent = (pi = PI, cents = 53625): string =>
    JSON.stringify({
      type: "refund_recorded",
      data: { paymentIntentId: pi, amountRefundedCents: cents },
    });

  it("our OWN residual-race refund does not ask the operator to reconcile it", async () => {
    // Found by staging the real race in the app. The loser is auto-refunded and deliberately gets
    // no payment row (#613 — there is no booking to hang it on), so Stripe's `charge.refunded`
    // arrived at a reconciler that reads "no payment" as "a charge Muster never recorded" and
    // texted RECONCILE MANUALLY. The operator got "No action needed" and "RECONCILE MANUALLY"
    // about the same PaymentIntent, seconds apart. It is neither Xola-era nor hand-taken; it is
    // ours, and the pending row carrying that intent id is the proof.
    const repo = new InMemoryRepository();
    await seedPending(repo);
    await seedRival(repo);
    const payments = new FakePaymentPort();
    const { deps, alert } = makeDeps(repo, payments);

    await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE); // loses, auto-refunds
    alert.mockClear();

    await processBookingWebhook(deps, refundEvent(), FAKE_SIGNATURE);
    expect(alert).not.toHaveBeenCalled();
  });

  it("a refund for a charge Muster never recorded STILL asks for reconciliation", async () => {
    // The regression guard on the case above: a Xola-era or hand-taken charge has no payment AND
    // no reservation, and must keep its alert. Silencing by "no payment" alone would have deleted
    // the one signal that money moved outside Muster entirely.
    const repo = new InMemoryRepository();
    const { deps, alert } = makeDeps(repo, new FakePaymentPort());

    await processBookingWebhook(deps, refundEvent("pi_never_seen"), FAKE_SIGNATURE);
    expect(alert).toHaveBeenCalledOnce();
    expect(String(alert.mock.calls[0]![0])).toMatch(/RECONCILE MANUALLY/);
  });

  it("a throwing sendConfirmation never breaks the committed booking (best-effort, DEC-122)", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);
    const { deps } = makeDeps(repo);
    deps.sendConfirmation = async () => {
      throw new Error("confirmation blew up");
    };

    // The booking is committed; a confirmation throw must not 500 the webhook.
    const r = await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "booked" });
    expect((await repo.getReservation(PEND))!.status).toBe("booked");
  });

  it("handled:false for a non-checkout event; throws on a bad signature", async () => {
    const repo = new InMemoryRepository();
    const { deps } = makeDeps(repo);
    expect(await processBookingWebhook(deps, "null", FAKE_SIGNATURE)).toEqual({ handled: false });
    await expect(
      processBookingWebhook(deps, bookingPi(), "wrong-sig"),
    ).rejects.toThrow();
  });
});

// ── 11.2b — balance payments (purpose="balance") ─────────────────────────────
const RES = asId<"ReservationId">("resv-bal");

const balanceCompleted = (over: Partial<CheckoutCompleted> = {}): CheckoutCompleted => ({
  sessionId: "cs_bal_1",
  paymentIntentId: "pi_bal",
  amountTotalCents: 37500, // the outstanding balance (500 + 36.25 tax − 161.25 deposit)
  currency: "usd",
  metadata: { purpose: "balance", reservationId: "resv-bal", taxCents: "0" },
  ...over,
});

async function seedDepositBooking(repo: InMemoryRepository): Promise<void> {
  await repo.saveEvent(musterEvent());
  await repo.saveReservation({
    id: RES,
    eventId: EVENT,
    source: "muster",
    customerName: "Mary",
    partySize: 6,
    status: "booked",
  });
  await repo.savePayment({
    id: asId<"PaymentId">("pay_dep"),
    reservationId: RES,
    method: "stripe",
    kind: "deposit",
    amountCents: 16125,
    taxCents: 3625,
    currency: "usd",
    status: "succeeded",
    createdAt: "2026-07-01T00:00:00.000Z",
  });
}

describe("processBookingWebhook — balance (11.2b)", () => {
  it("records a Payment{kind:'balance'} against the existing reservation — no second reservation, no alert", async () => {
    const repo = new InMemoryRepository();
    await seedDepositBooking(repo);
    const { deps, alert } = makeDeps(repo);

    const r = await processBookingWebhook(deps, JSON.stringify(balanceCompleted()), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "balance_paid" });

    const payments = await repo.listPaymentsForReservation(RES);
    expect(payments.map((p) => p.kind).sort()).toEqual(["balance", "deposit"]);
    const bal = payments.find((p) => p.kind === "balance")!;
    expect(bal).toMatchObject({ amountCents: 37500, taxCents: 0, status: "succeeded" });
    // did NOT run the booking path (no new reservation off the balance session id)
    expect(await repo.listReservationsForEvent(EVENT)).toHaveLength(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it("is idempotent — a re-delivered balance session writes one balance payment", async () => {
    const repo = new InMemoryRepository();
    await seedDepositBooking(repo);
    const { deps } = makeDeps(repo);
    await processBookingWebhook(deps, JSON.stringify(balanceCompleted()), FAKE_SIGNATURE);
    await processBookingWebhook(deps, JSON.stringify(balanceCompleted()), FAKE_SIGNATURE);
    const balances = (await repo.listPaymentsForReservation(RES)).filter((p) => p.kind === "balance");
    expect(balances).toHaveLength(1);
  });

  it("OVERPAY (two balance sessions raced): records the money + loudly flags a manual refund", async () => {
    const repo = new InMemoryRepository();
    await seedDepositBooking(repo);
    const { deps, alert } = makeDeps(repo);
    // First balance pays the real 37500 → paid in full.
    await processBookingWebhook(deps, JSON.stringify(balanceCompleted()), FAKE_SIGNATURE);
    // A second balance session (different id) also completes → overpay.
    const r = await processBookingWebhook(
      deps,
      JSON.stringify(balanceCompleted({ sessionId: "cs_bal_2" })),
      FAKE_SIGNATURE,
    );
    expect(r).toEqual({ handled: true, outcome: "balance_paid" });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toContain("OVERPAID");
  });

  /**
   * The MISSING and CANCELLED legs are different, and conflating them cost a ledger row.
   *
   * `payments.reservation_id`'s FK requires the reservation ROW to exist — nothing about its
   * status. `cancelled` is a legitimate `ReservationStatus`, so a cancelled-but-present
   * reservation has always satisfied it. #613's first cut reordered the whole three-way guard
   * (missing / cancelled / unpriced) and skipped the write for all three, which silently dropped
   * the ledger row for money that genuinely moved.
   *
   * It shipped green because the test below is titled for "missing/cancelled" and seeds only
   * MISSING. Caught by `@code-review`, which reproduced it against real Postgres. Hence a case
   * per leg now, rather than one test whose title covers a case it never builds.
   */
  it("a balance against a MISSING reservation is not recorded — there is no row to reference", async () => {
    const repo = new InMemoryRepository(); // no reservation seeded
    const { deps, alert } = makeDeps(repo);
    const r = await processBookingWebhook(deps, JSON.stringify(balanceCompleted()), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "balance_paid" });
    // No payment row — nothing to reference. Admins are paged instead, which is the only
    // outcome that was ever reachable in production.
    expect(await repo.listPaymentsForReservation(RES)).toHaveLength(0);
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toContain("RECONCILE");
  });

  it("a balance against a CANCELLED reservation IS recorded, then flagged", async () => {
    // The row exists, so the FK is satisfied and the money must be on the ledger. A payment
    // nobody can reconcile is still a payment; a ledger that quietly omits it is worse than one
    // that shows it flagged.
    const repo = new InMemoryRepository();
    await seedDepositBooking(repo);
    const res = await repo.getReservation(RES);
    await repo.saveReservation({ ...res!, status: "cancelled" });
    const { deps, alert } = makeDeps(repo);

    const r = await processBookingWebhook(deps, JSON.stringify(balanceCompleted()), FAKE_SIGNATURE);

    expect(r).toEqual({ handled: true, outcome: "balance_paid" });
    const balances = (await repo.listPaymentsForReservation(RES)).filter((p) => p.kind === "balance");
    expect(balances).toHaveLength(1);
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toContain("RECONCILE");
  });

  it("a balance against an UNPRICED reservation IS recorded, then flagged", async () => {
    // Same reasoning as cancelled: the row exists, so the money is recordable and must be
    // recorded. Only the price is missing, which makes it unreconcilable, not unrecordable.
    const repo = new InMemoryRepository();
    await seedDepositBooking(repo);
    const res = await repo.getReservation(RES);
    const ev = await repo.getEvent(res!.eventId!); // seeded booked, so its event is set
    const { price: _dropped, ...unpriced } = ev!;
    await repo.saveEvent(unpriced);
    const { deps, alert } = makeDeps(repo);

    const r = await processBookingWebhook(deps, JSON.stringify(balanceCompleted()), FAKE_SIGNATURE);

    expect(r).toEqual({ handled: true, outcome: "balance_paid" });
    const balances = (await repo.listPaymentsForReservation(RES)).filter((p) => p.kind === "balance");
    expect(balances).toHaveLength(1);
    expect(alert).toHaveBeenCalledOnce();
  });

  it("unknown purpose is loudly flagged and NOT booked (no orphan reservation)", async () => {
    const repo = new InMemoryRepository();
    const { deps, alert } = makeDeps(repo);
    const r = await processBookingWebhook(
      deps,
      JSON.stringify(balanceCompleted({ metadata: { purpose: "refund" } })),
      FAKE_SIGNATURE,
    );
    expect(r).toEqual({ handled: true, outcome: "ignored" });
    expect(alert).toHaveBeenCalledOnce();
    expect(await repo.listAllReservations()).toHaveLength(0);
  });
});

/**
 * A Muster-native booking must produce a CREWABLE shift, with no Xola pull involved (#614).
 *
 * `writeSlotBooking` writes the Event and the Reservation and stops. Nothing downstream formed a
 * Shift, so a native booking yielded an event with no seats, no asks and nobody to crew it.
 *
 * **It has only ever worked because the operator keeps pressing "Pull from Xola"**, which re-forms
 * shifts from ALL events including Muster-native ones (`form-shifts.ts` iterates `listEvents()`
 * with no source filter). That inverts the dependency the docs assume — Muster bookings are
 * crewable BECAUSE Xola is still being polled — and DEC-126 turns that pull off at cutover. The
 * first Muster-only Saturday would have produced boats that were sold and uncrewed.
 *
 * Nothing here imports `xola-pull`, and that absence is the assertion.
 */
describe("a native booking forms its own crewable shift (#614)", () => {
  const OFF = asId<"OfferingId">("off-614");
  const VES = asId<"VesselId">("vessel-614");
  const CAPTAIN = asId<"RoleTypeId">("role-captain");
  const MATE = asId<"RoleTypeId">("role-mate");

  async function slotWorld(): Promise<InMemoryRepository> {
    const repo = new InMemoryRepository();
    await repo.saveVessel({
      id: VES,
      name: "Brew 2",
      coiMaxPax: 12,
      // Real manning, or the shift forms with zero seats and "crewable" means nothing.
      manning: [
        { roleTypeId: CAPTAIN, count: 1 },
        { roleTypeId: MATE, count: 1 },
      ],
    });
    await repo.saveOffering({
      id: OFF,
      tenantId: asId<"TenantId">("t"),
      name: "Sunset Cruise",
      status: "live",
      vesselIds: [VES],
      locationId: asId<"LocationId">("loc-614"),
      schedule: {
        seasonStart: "2026-06-01",
        seasonEnd: "2026-08-31",
        weekdays: [5],
        departureTimes: ["17:00"],
      },
      basePriceCents: 49900,
      priceVariations: [],
      extraGuestPriceCents: 5000,
    });
    // The pending row checkout wrote for this slot, carrying the PI the charge confirms.
    await repo.saveReservation({
      id: asId<"ReservationId">("resv-614"),
      eventId: null,
      source: "muster",
      status: "pending",
      customerName: "Mary",
      email: "m@x.io",
      partySize: 6,
      vesselId: VES,
      date: "2026-07-04",
      time: "17:00",
      offeringId: OFF,
      reservedAt: "2026-07-11T23:55:00.000Z",
      holdMinutes: 120,
      tripMinutes: 100,
      paymentIntentIds: ["pi_614"],
      invoice: pendingRow().invoice!, // confirm reads the money off the row (15.6)
    });
    return repo;
  }

  // `bookingPi` already returns a JSON string; the call sites pass it straight to the webhook.
  const slotCharge = () =>
    bookingPi("pi_614", 49900, { offeringId: String(OFF), vesselId: String(VES), priceCents: "49900" });

  it("books a slot and lands a Shift with derived seats — no Xola pull anywhere", async () => {
    const repo = await slotWorld();
    const { deps } = makeDeps(repo);

    const r = await processBookingWebhook(deps, slotCharge(), FAKE_SIGNATURE);
    expect(r).toMatchObject({ handled: true, outcome: "booked" });

    // The event exists — that part always worked.
    const events = await repo.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe("muster");

    // …and now so does the shift it earned, on the right boat and day.
    const shifts = await repo.listShifts();
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({ vesselId: VES, date: "2026-07-04" });

    // Crewable means SEATS. A shift with none is an empty promise: nothing to ask for,
    // nobody to assign, and the board would read it as fine.
    const seats = await repo.listSeatsForShift(shifts[0]!.id);
    expect(seats.length).toBeGreaterThan(0);
    expect(seats.map((s) => String(s.role)).sort()).toEqual([String(CAPTAIN), String(MATE)].sort());
  });

  it("lands its shift even when another vessel in the fleet cannot form at all (#957)", async () => {
    // **This is the app's one job, and it was broken.** The #614 test above proves a booking
    // forms its shift in a clean fleet. It never had a broken vessel-day present, so it could
    // not see #957: `formShifts` wrapped its whole group loop in one `try`, and the unmanned
    // `vessel-xola-only` that `db:seed:xola` wrote aborted the run before most vessel-days were
    // reached. A trip was sold, paid for, confirmed to the customer — and never reached the
    // board, because an unrelated boat weeks away had no manning rule. Which bookings lost their
    // shift was decided by iteration order, not by anything about the booking.
    const repo = await slotWorld();

    // The unmanned boat, with a scheduled trip so it forms a group, seeded BEFORE the booking.
    // Groups follow `listEvents()` order, so this one is reached first and the booking's own
    // vessel-day is downstream of the abort — exactly the shape that lost real shifts.
    const BROKEN = asId<"VesselId">("vessel-unmanned-614");
    await repo.saveVessel({ id: BROKEN, name: "Xola Only", coiMaxPax: 10, manning: [] });
    await repo.saveEvent({
      id: asId<"EventId">("evt-unmanned-614"),
      vesselId: BROKEN,
      date: "2026-08-15",
      time: "09:00",
      capacity: 10,
      source: "xola",
      status: "scheduled",
    });

    const { deps } = makeDeps(repo);
    const r = await processBookingWebhook(deps, slotCharge(), FAKE_SIGNATURE);
    expect(r).toMatchObject({ handled: true, outcome: "booked" });

    // The whole point: the paid booking has a crewable shift on its own boat and day.
    const booked = (await repo.listShifts()).find((s) => s.vesselId === VES);
    expect(booked).toBeTruthy();
    expect(booked).toMatchObject({ vesselId: VES, date: "2026-07-04" });
    const seats = await repo.listSeatsForShift(booked!.id);
    expect(seats.map((s) => String(s.role)).sort()).toEqual([String(CAPTAIN), String(MATE)].sort());

    // The broken boat is still broken — isolated, not silently repaired.
    expect((await repo.listShifts()).some((s) => s.vesselId === BROKEN)).toBe(false);
  });

  it("relays and audits the re-form's crew transitions — they are NOT gated by notifyTripChanges", async () => {
    // The finding @code-review caught. The first cut discarded `formShifts`'s result, reasoning
    // that a newborn shift has nobody to notify. True of the shift being born, irrelevant to the
    // call: `formShifts` re-derives EVERY vessel-day, and `cancelledCrew`/`restoredCrew` fire
    // whenever this call is first to observe a collapse or resurrection anywhere. After DEC-126
    // turns off the Xola pull, this webhook and the cron tick are the only triggers left — an
    // unrelayed transition is a crew member who is never told.
    const repo = await slotWorld();
    const relayed: unknown[] = [];
    const { deps } = makeDeps(repo);
    deps.relayFormNotices = async (form) => void relayed.push(form);

    await processBookingWebhook(deps, slotCharge(), FAKE_SIGNATURE);

    // The result reached the relay at all — that is the regression this pins — and it is the
    // REAL `FormResult`, not an empty stand-in: it carries the shift this booking just created.
    //
    // No assertion on the audit rows here, deliberately. A newborn shift has no crew transitions,
    // so `formAuditChanges` legitimately yields nothing, and `expect(rows).toBeDefined()` would
    // be a check that cannot fail — the exact vacuous-probe pattern this session kept tripping on.
    // The audit call shares this code path with the relay, which IS asserted.
    expect(relayed).toHaveLength(1);
    const form = relayed[0] as { createdShiftIds: string[] };
    expect(form.createdShiftIds).toHaveLength(1);
  });

  it("a booking that GROWS an already-crewed day tells that crew (#765)", async () => {
    // The case the "nobody is on this shift yet — it is being born" comment does not reach.
    // A shift is born empty, but `formShifts` groups events by vessel + day, so a later booking
    // on the SAME day joins the existing shift's trip set. Somebody's committed day just grew a
    // trip. Xola-sourced changes relay this (`xola-pull.ts` opts in); a Muster booking did not —
    // and after the DEC-126 cutover this webhook and the cron tick are the only formation
    // triggers left, so "your shift changed" would stop firing altogether.
    const repo = await slotWorld();

    // A trip already on that boat that day, formed into a shift, with a captain confirmed on it.
    await repo.saveEvent({
      id: asId<"EventId">("evt-already-there"),
      vesselId: VES,
      date: "2026-07-04",
      time: "12:00",
      capacity: 12,
      status: "scheduled",
      source: "muster",
      price: 49900,
    });
    await formAllVesselDaysForTest(repo);
    const shift = (await repo.listShifts())[0]!;
    const seat = (await repo.listSeatsForShift(shift.id))[0]!;
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("cap-765"),
    });

    const relayed: unknown[] = [];
    const { deps } = makeDeps(repo);
    deps.relayFormNotices = async (form) => void relayed.push(form);

    // Now a customer buys the 17:00 on the same boat, same day.
    await processBookingWebhook(deps, slotCharge(), FAKE_SIGNATURE);

    // The trip set genuinely moved — one trip became two, on the shift the captain is on.
    expect((await repo.getShift(shift.id))?.eventIds).toHaveLength(2);

    // …so the captain must be in the relayed change list. Before #765 this was empty: the
    // webhook called `formShifts` without `notifyTripChanges`, so the diff was computed,
    // discarded, and nobody was told their day had grown a trip.
    expect(relayed).toHaveLength(1);
    const form = relayed[0] as {
      changedCrew: { shiftId: string; crewMemberId: string }[];
    };
    expect(form.changedCrew.map((c) => String(c.crewMemberId))).toEqual(["cap-765"]);
  });

  it("a booking that creates a BRAND-NEW shift still tells nobody (#765)", async () => {
    // The other half, and the reason the flag can't just be waved on everywhere: a shift being
    // born has no assigned crew, so there is no one to tell and the notice must stay silent.
    // Without this, "fires on a booking" and "fires on every booking" look identical.
    const repo = await slotWorld();
    const relayed: unknown[] = [];
    const { deps } = makeDeps(repo);
    deps.relayFormNotices = async (form) => void relayed.push(form);

    await processBookingWebhook(deps, slotCharge(), FAKE_SIGNATURE);

    expect(relayed).toHaveLength(1);
    const form = relayed[0] as {
      changedCrew: unknown[];
      createdShiftIds: string[];
    };
    expect(form.createdShiftIds).toHaveLength(1);
    expect(form.changedCrew).toEqual([]);
  });

  it("a relay failure does not cost the customer their paid booking", async () => {
    // Each leg independently best-effort: the booking is committed and PAID, so a channel hiccup
    // must not 500 the webhook (Stripe would redeliver, resolve `already`, and re-run nothing).
    const repo = await slotWorld();
    const { deps, confirm } = makeDeps(repo);
    deps.relayFormNotices = async () => {
      throw new Error("channel is down");
    };

    const r = await processBookingWebhook(deps, slotCharge(), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "booked" });
    expect(await repo.listShifts()).toHaveLength(1);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("a formation failure does not cost the customer their paid booking", async () => {
    // The booking is committed and PAID before this runs. If forming throws, the webhook must
    // still succeed — a 500 would have Stripe redeliver, resolve `already`, and still not form,
    // while the customer's confirmation never sends. The cron tick re-forms as the backstop.
    const repo = await slotWorld();
    repo.saveShift = async () => {
      throw new Error("shift store is down");
    };
    const { deps, confirm } = makeDeps(repo);

    const r = await processBookingWebhook(deps, slotCharge(), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "booked" });
    expect(await repo.listAllReservations()).toHaveLength(1);
    expect(confirm).toHaveBeenCalledOnce();
  });
});

/**
 * `charge.refunded` (#616) — the ledger half.
 *
 * Before this, `parseEvent` handled exactly two event types, so the thing every doc tells the
 * operator to do — refund in the Stripe dashboard — was invisible to Muster. The reservation
 * kept reading paid, `/admin/purchases` kept counting the revenue, and `balanceOwedCents` kept
 * billing a balance against money that had gone back.
 *
 * Stripe's `amount_refunded` on a charge is CUMULATIVE, which is exactly the contract
 * `markPaymentRefunded(id, refundedTotalCents)` already had — so the two fit without arithmetic,
 * and a redelivered event is idempotent by `greatest()` rather than by a guard here.
 */
/**
 * One booked, fully paid reservation with a `succeeded` payment on `pi_1` — the starting state
 * for both of the after-the-money-moved paths below (`charge.refunded` and `charge.dispute.*`).
 * Shared rather than duplicated per describe: the two suites need the identical world, and a
 * drift between two copies would quietly make one of them test a different thing.
 */
async function paidWorld(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveEvent(musterEvent());
  await repo.saveReservation({
    id: asId<"ReservationId">("resv-1"),
    eventId: EVENT,
    source: "muster",
    customerName: "Mary",
    partySize: 6,
    status: "booked",
  });
  await repo.savePayment({
    id: asId<"PaymentId">("pay-1"),
    reservationId: asId<"ReservationId">("resv-1"),
    method: "stripe",
    kind: "full",
    amountCents: 53625,
    taxCents: 3625,
    currency: "usd",
    stripePaymentIntentId: "pi_1",
    status: "succeeded",
    createdAt: "2026-07-12T00:00:00.000Z",
  });
  return repo;
}

describe("processBookingWebhook — charge.refunded reconciles the ledger (#616)", () => {
  const refunded = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: "refund_recorded",
      data: { paymentIntentId: "pi_1", amountRefundedCents: 53625, currency: "usd", ...over },
    });

  it("a DASHBOARD refund lands on the payment row", async () => {
    const repo = await paidWorld();
    const { deps } = makeDeps(repo);

    const r = await processBookingWebhook(deps, refunded(), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "refund_recorded" });
    expect(await repo.getPayment(asId<"PaymentId">("pay-1"))).toMatchObject({
      refundedCents: 53625,
      status: "refunded",
    });
  });

  it("a PARTIAL dashboard refund marks the row partially refunded", async () => {
    const repo = await paidWorld();
    const { deps } = makeDeps(repo);

    await processBookingWebhook(deps, refunded({ amountRefundedCents: 20000 }), FAKE_SIGNATURE);

    expect(await repo.getPayment(asId<"PaymentId">("pay-1"))).toMatchObject({
      refundedCents: 20000,
      status: "partially_refunded",
    });
  });

  it("redelivery is idempotent, and a LATER refund accumulates", async () => {
    // Stripe fires `charge.refunded` again for each additional refund on the same charge, and
    // may redeliver any of them. Because the field is cumulative, both cases are the same write.
    const repo = await paidWorld();
    const { deps } = makeDeps(repo);

    await processBookingWebhook(deps, refunded({ amountRefundedCents: 20000 }), FAKE_SIGNATURE);
    await processBookingWebhook(deps, refunded({ amountRefundedCents: 20000 }), FAKE_SIGNATURE);
    await processBookingWebhook(deps, refunded({ amountRefundedCents: 35000 }), FAKE_SIGNATURE);

    expect(await repo.getPayment(asId<"PaymentId">("pay-1"))).toMatchObject({
      refundedCents: 35000,
      status: "partially_refunded",
    });
  });

  it("an UNKNOWN PaymentIntent alerts instead of throwing", async () => {
    // A refund on a charge Muster never recorded — a Xola-era charge, a manual one taken in the
    // dashboard, or a payment whose booking write was lost. There is nothing to reconcile, and
    // a throw would 500 the webhook into a retry loop that can never succeed.
    const repo = await paidWorld();
    const { deps, alert } = makeDeps(repo);

    const r = await processBookingWebhook(deps, refunded({ paymentIntentId: "pi_unknown" }), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "refund_recorded" });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toMatch(/pi_unknown/);
  });

  it("is NOT gated by the RESERVATIONS flag — a refund must reconcile in any deployment", async () => {
    // Same reasoning that moved the flag off the whole handler and onto the new-booking path:
    // money that has already moved must be recorded regardless of whether new sales are on.
    const repo = await paidWorld();
    const { deps } = makeDeps(repo);

    await processBookingWebhook({ ...deps, reservationsEnabled: false }, refunded(), FAKE_SIGNATURE);

    expect(await repo.getPayment(asId<"PaymentId">("pay-1"))).toMatchObject({ status: "refunded" });
  });
});

/**
 * `charge.dispute.*` (issue #723) — the other way money leaves without anyone pressing anything.
 *
 * A refund is something Muster or the operator DID. A chargeback is something done TO them: the
 * cardholder went to their bank, Stripe pulls the funds, and before this the reservation kept
 * reading paid, the boat stayed held, and `/admin/purchases` kept counting the money.
 *
 * The three lifecycle events (`created` / `updated` / `closed`) all arrive here as one
 * `dispute_updated`, carrying the dispute's own status normalized to four states. That is what
 * makes the handler idempotent without a guard: the same event recomputes the same write.
 */
describe("processBookingWebhook — charge.dispute.* records the chargeback (issue #723)", () => {
  const dispute = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: "dispute_updated",
      data: {
        paymentIntentId: "pi_1",
        state: "live",
        amountCents: 53625,
        currency: "usd",
        reason: "fraudulent",
        ...over,
      },
    });

  it("a LIVE dispute marks the payment disputed and alerts a human", async () => {
    const repo = await paidWorld();
    const { deps, alert } = makeDeps(repo);

    const r = await processBookingWebhook(deps, dispute(), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "dispute_recorded" });
    expect(await repo.getPayment(asId<"PaymentId">("pay-1"))).toMatchObject({ status: "disputed" });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toMatch(/DISPUTE OPENED/);
  });

  it("a disputed payment stops counting as paid — the whole point", async () => {
    // The ledger consequence, asserted through the deriver rather than the row, because the row
    // reading "disputed" is worth nothing if `balanceOwedCents` still counts the money. This is
    // the assertion that would have failed on the old deny-list `countsAsPaid`.
    const repo = await paidWorld();
    const { deps } = makeDeps(repo);

    await processBookingWebhook(deps, dispute(), FAKE_SIGNATURE);

    const payments = await repo.listPaymentsForReservation(asId<"ReservationId">("resv-1"));
    expect(balanceOwedCents(50000, 725, payments)).toBe(53625);
  });

  it("an INQUIRY alerts but writes nothing — no money has moved yet", async () => {
    // The `warning_*` family is a retrieval request, not a chargeback. Marking it disputed would
    // zero out revenue on a booking that was never charged back, and a false alarm is how an
    // operator learns to ignore the real ones.
    const repo = await paidWorld();
    const { deps, alert } = makeDeps(repo);

    await processBookingWebhook(deps, dispute({ state: "inquiry" }), FAKE_SIGNATURE);

    expect(await repo.getPayment(asId<"PaymentId">("pay-1"))).toMatchObject({ status: "succeeded" });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toMatch(/INQUIRY/);
  });

  it("winning puts the money back and the row reads paid again", async () => {
    const repo = await paidWorld();
    const { deps, alert } = makeDeps(repo);

    await processBookingWebhook(deps, dispute(), FAKE_SIGNATURE);
    await processBookingWebhook(deps, dispute({ state: "won" }), FAKE_SIGNATURE);

    expect(await repo.getPayment(asId<"PaymentId">("pay-1"))).toMatchObject({ status: "succeeded" });
    expect(alert.mock.calls[1]![0]).toMatch(/WON/);
  });

  it("losing is terminal and still not paid", async () => {
    const repo = await paidWorld();
    const { deps, alert } = makeDeps(repo);

    await processBookingWebhook(deps, dispute(), FAKE_SIGNATURE);
    await processBookingWebhook(deps, dispute({ state: "lost" }), FAKE_SIGNATURE);

    expect(await repo.getPayment(asId<"PaymentId">("pay-1"))).toMatchObject({
      status: "dispute_lost",
    });
    expect(alert.mock.calls[1]![0]).toMatch(/LOST/);
  });

  it("a status this deploy does not recognise writes NOTHING and says so", async () => {
    // Reachable only at runtime: Stripe adds a ninth dispute status and this deploy's pinned SDK
    // has not been bumped, so `disputeState`'s exhaustive switch matches nothing. It used to
    // return `undefined`, which wrote nothing (right) and then alerted "DISPUTE OPENED" (wrong —
    // it announces an interpretation we did not have). The honest answer is that we cannot tell
    // whether the money moved, so the row is left alone and the alert names the gap.
    const repo = await paidWorld();
    const { deps, alert } = makeDeps(repo);

    const r = await processBookingWebhook(deps, dispute({ state: "unknown" }), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "dispute_recorded" });
    expect(await repo.getPayment(asId<"PaymentId">("pay-1"))).toMatchObject({
      status: "succeeded",
    });
    expect(alert.mock.calls[0]![0]).toMatch(/does not recognise/);
    expect(alert.mock.calls[0]![0]).not.toMatch(/DISPUTE OPENED/);
  });

  it("redelivery is idempotent — the same event is the same write", async () => {
    const repo = await paidWorld();
    const { deps, alert } = makeDeps(repo);

    await processBookingWebhook(deps, dispute(), FAKE_SIGNATURE);
    await processBookingWebhook(deps, dispute(), FAKE_SIGNATURE);

    expect(await repo.getPayment(asId<"PaymentId">("pay-1"))).toMatchObject({ status: "disputed" });
    // The alert fires per delivery, deliberately: a duplicated warning is a cost the operator
    // can absorb, a suppressed one is the failure this feature exists to prevent.
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it("an UNKNOWN PaymentIntent alerts instead of throwing", async () => {
    // A dispute against a Xola-era or hand-taken charge is real. A throw would 500 the webhook
    // into a Stripe retry loop that can never succeed.
    const repo = await paidWorld();
    const { deps, alert } = makeDeps(repo);

    const r = await processBookingWebhook(
      deps,
      dispute({ paymentIntentId: "pi_unknown" }),
      FAKE_SIGNATURE,
    );

    expect(r).toMatchObject({ handled: true, outcome: "dispute_recorded" });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toMatch(/pi_unknown/);
  });

  it("is NOT gated by the RESERVATIONS flag — money that left must be recorded anywhere", async () => {
    const repo = await paidWorld();
    const { deps } = makeDeps(repo);

    await processBookingWebhook({ ...deps, reservationsEnabled: false }, dispute(), FAKE_SIGNATURE);

    expect(await repo.getPayment(asId<"PaymentId">("pay-1"))).toMatchObject({ status: "disputed" });
  });
});

/**
 * A declined card is an ordinary event, and the correct response to it is nothing — criterion 11,
 * *"A `payment_intent.payment_failed` does **not** expire the reservation."*
 *
 * Stripe sends `payment_intent.payment_failed` on every decline, and this endpoint must ack it so
 * Stripe stops retrying. It must NOT do anything else. The pending row stays exactly as it is: the
 * customer is still inside their payment window, still holding the boat, and 14.6 means their
 * retry lands on that same row. Cancelling it here — the instinct a failed payment invites — would
 * take the boat away from a customer who is still standing at the till with a second card out.
 *
 * Before 14.8 this fell into the same unparsed-event bucket as every unknown Stripe type. That
 * acked, which is right, but by accident rather than by decision — and nothing named the event, so
 * nothing would have noticed a future handler being wired to it.
 */
describe("processBookingWebhook — payment_intent.payment_failed is acked and ignored (criterion 11)", () => {
  const failed = (pi = PI): string =>
    JSON.stringify({
      type: "payment_failed",
      data: { paymentIntentId: pi, declineCode: "card_declined" },
    });

  it("acks the event and reports it ignored", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);
    const { deps } = makeDeps(repo);

    const r = await processBookingWebhook(deps, failed(), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "ignored" });
  });

  it("leaves the pending row untouched — the customer is still paying", async () => {
    // The whole point. Their window is still open and their retry reuses this row (14.6, §2.8.7).
    const repo = new InMemoryRepository();
    const row = await seedPending(repo);
    const { deps } = makeDeps(repo);
    const before = await repo.getReservation(row.id);

    await processBookingWebhook(deps, failed(), FAKE_SIGNATURE);

    expect(await repo.getReservation(row.id)).toEqual(before);
  });

  it("books nothing, charges nothing, refunds nothing and alerts nobody", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);
    const { deps, alert, confirm } = makeDeps(repo);

    await processBookingWebhook(deps, failed(), FAKE_SIGNATURE);

    expect(confirm).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(await repo.listEvents()).toHaveLength(0);
  });

  it("is ignored with the RESERVATIONS flag off too — no money moved, so there is nothing to say", async () => {
    // Contrast with a SUCCEEDED charge under the same flag, which alerts loudly because money HAS
    // moved and somebody has to look. A decline moved none.
    const repo = new InMemoryRepository();
    await seedPending(repo);
    const { deps, alert } = makeDeps(repo);

    const r = await processBookingWebhook(
      { ...deps, reservationsEnabled: false },
      failed(),
      FAKE_SIGNATURE,
    );

    expect(r).toMatchObject({ handled: true, outcome: "ignored" });
    expect(alert).not.toHaveBeenCalled();
  });
});

/**
 * **Once the sale is made, the row's other intents are retired (15.10, issue #978).**
 *
 * A checkout can leave more than one id on its row — §2.8.5 keeps them all so a superseded intent
 * that succeeds late still resolves here. Keeping them FINDABLE is not the same as leaving them
 * PAYABLE, and until now they stayed payable at whatever amount they were minted with. `SPEC.md`
 * defines today's outcome for one that gets paid after the booking: *"this is a second charge for
 * one sale: refund it and tell the customer"* — a charge, a refund, and an apology for a thing
 * that should not have been possible.
 *
 * Cancelling the losers once the flip has committed removes all three. It cannot remove the case
 * where the sibling ALREADY succeeded — that is the residual race, the money is taken, and the
 * refund path still owns it. This makes that path rarer, not unreachable.
 */
describe("processBookingWebhook — superseded intents are retired once the row is booked (15.10)", () => {
  const OTHER = "pi_superseded";

  it("cancels the row's other intents, and never the one that paid", async () => {
    const repo = new InMemoryRepository();
    // The declined-then-retried shape §2.8.5 exists for: two ids, the LAST one paid.
    await seedPending(repo, { paymentIntentIds: [OTHER, PI] });
    const { deps, payments } = makeDeps(repo);

    const r = await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "booked" });
    expect(payments.cancelled).toEqual([{ paymentIntentId: OTHER, reason: "duplicate" }]);
  });

  it("does not fail the webhook when the provider refuses the cancel", async () => {
    // **The case that would cause real damage.** Stripe refuses a cancel from most terminal
    // states, and a redelivery re-cancels an already-cancelled sibling every time. A throw here
    // would 500 a booking that has already committed, and Stripe would retry a completed sale for
    // three days.
    const repo = new InMemoryRepository();
    await seedPending(repo, { paymentIntentIds: [OTHER, PI] });
    const { deps, payments, alert } = makeDeps(repo);
    payments.cancelError = new Error("stripe: 400 — payment intent is already canceled");

    const r = await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "booked" });
    expect((await repo.getReservation(PEND))!.status).toBe("booked");
    // Not an operator's problem: no money moved and the booking is fine. `alertPaidButUnbooked` is
    // for a charge with no booking, which is the opposite of what happened here.
    expect(alert).not.toHaveBeenCalled();
  });

  it("cancels nothing when the row only ever minted the intent that paid", async () => {
    // The ordinary booking, and the guard against a fix that cancels indiscriminately.
    const repo = new InMemoryRepository();
    await seedPending(repo);
    const { deps, payments } = makeDeps(repo);

    await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);

    expect(payments.cancelled).toEqual([]);
  });
});

/**
 * **`payment_intent.processing` is acked and ALERTS (15.12).**
 *
 * The contrast with its two neighbours is the whole point. A decline is ignored in silence because
 * the customer is still standing at the till. A cancel is ignored in silence because we made it.
 * A `processing` intent is neither: a payment is in flight that will settle in days, no screen in
 * Muster shows it, and — since `/book` delegates method selection to the Dashboard via
 * `automatic_payment_methods` — its arrival means a delayed payment method has been turned on.
 * That is a fact about the account, not about this booking, and nobody would otherwise learn it.
 */
describe("processBookingWebhook — payment_intent.processing is acked and alerts (15.12)", () => {
  const processing = (pi = PI): string =>
    JSON.stringify({ type: "payment_processing", data: { paymentIntentId: pi } });

  it("acks the event and reports it ignored", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);
    const { deps } = makeDeps(repo);

    const r = await processBookingWebhook(deps, processing(), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "ignored" });
  });

  it("tells the operator, because nothing else will", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);
    const { deps, alert } = makeDeps(repo);

    await processBookingWebhook(deps, processing(), FAKE_SIGNATURE);

    expect(alert).toHaveBeenCalledOnce();
    const message = String(alert.mock.calls[0]![0]);
    expect(message).toContain(PI);
    // **Not an emergency, and the words matter.** No money is at risk and there is nothing to undo,
    // so this must not read like the paid-but-unbooked alerts that share the channel — 15.5 made
    // the same call for the residual-race notice. An alert that cries wolf is how the real ones
    // stop being read.
    expect(message).not.toMatch(/REFUND MANUALLY/);
  });

  it("books nothing and leaves the pending row alone — the money has not arrived", async () => {
    const repo = new InMemoryRepository();
    const row = await seedPending(repo);
    const { deps, confirm } = makeDeps(repo);
    const before = await repo.getReservation(row.id);

    await processBookingWebhook(deps, processing(), FAKE_SIGNATURE);

    expect(await repo.getReservation(row.id)).toEqual(before);
    expect(confirm).not.toHaveBeenCalled();
    expect(await repo.listEvents()).toHaveLength(0);
  });
});

/**
 * **`payment_intent.canceled` is acked and deliberately does nothing (15.10).**
 *
 * Named for the reason `payment_failed` is: ignored-on-purpose and unrecognised must not be the
 * same signal. Every cancel Muster performs is one it already knows about — the port call returned
 * before this event was written — so there is nothing to do when it arrives.
 */
describe("processBookingWebhook — payment_intent.canceled is acked and ignored (15.10)", () => {
  const canceled = (pi = PI): string =>
    JSON.stringify({ type: "payment_canceled", data: { paymentIntentId: pi, reason: "abandoned" } });

  it("acks the event and reports it ignored", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);
    const { deps } = makeDeps(repo);

    const r = await processBookingWebhook(deps, canceled(), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "ignored" });
  });

  it("leaves the pending row untouched and alerts nobody", async () => {
    // A cancel we made ourselves on a row whose checkout has moved on, or one an operator made in
    // the dashboard. Neither is money moving, and neither is this handler's business.
    const repo = new InMemoryRepository();
    const row = await seedPending(repo);
    const { deps, alert } = makeDeps(repo);
    const before = await repo.getReservation(row.id);

    await processBookingWebhook(deps, canceled(), FAKE_SIGNATURE);

    expect(await repo.getReservation(row.id)).toEqual(before);
    expect(alert).not.toHaveBeenCalled();
  });
});

/**
 * **A post-commit failure must not lose the confirmation forever (15.3, issue #971).**
 *
 * The chain this pins: the flip commits, then something after it throws, so the route 500s and
 * Stripe redelivers. `confirmPendingRow` correctly resolves `already` on the second delivery —
 * and the send was gated on `outcome === "booked"`, so it never ran. Not late. Never. The
 * customer has paid, has a boat, and has no confirmation and no manage link, with nothing
 * alerting.
 *
 * The ledger row is NOT part of this defect and that is worth stating, because it is what made
 * the fix look bigger than it is: `recordPayment` runs on `already` as well as `booked`
 * (`booking-webhook.ts:402`) and `savePayment` is `on conflict (id) do nothing` on a
 * deterministic id, so the payment self-heals on redelivery. Only the send was unrecoverable,
 * because only the send had no memory.
 *
 * `confirmation_sent_at` on the row is that memory. Three different paths reach confirm — this
 * webhook, `/book/success` (a public repeatable GET), and §2.8.9's future reconciler — and none
 * of them can know from its own control flow whether a customer has been told. The row can
 * answer it for all three.
 */
describe("processBookingWebhook — a post-commit failure does not lose the confirmation (15.3)", () => {
  /**
   * Throws from the PAYMENT write — `recordPayment` at `booking-webhook.ts:404`, which sits after
   * the flip commits, before the send, and is not caught.
   *
   * **The title says what this proves, and it is narrower than it looks** (`@code-review`). After
   * 15.3's reorder the ledger write runs LAST, so nothing uncaught sits ahead of the send any
   * more — the confirmation goes out on delivery 1 and the throw comes after it. So this is not
   * "the redelivery recovers a lost send"; it is "a bookkeeping failure cannot cost the customer
   * their confirmation, and the retry it causes does not produce a second one."
   *
   * It still bites against the pre-fix code, which is the point: there, `recordPayment` ran first
   * and threw before the send was attempted, so the count across both deliveries was zero.
   *
   * The case where a send genuinely never happens is the next test — process death after the
   * flip, which no ordering can reach.
   *
   * A `Proxy` rather than `Object.create(repo)`: the double keeps its state in `#private` fields,
   * which are not reachable through a prototype chain on a different object — the first cut of
   * this failed with "Cannot read private member #reservations from an object whose class did not
   * declare it" instead of the error it was trying to inject. Methods are bound to the real
   * instance so those fields resolve.
   */
  const brokenAfterCommit = (repo: InMemoryRepository): InMemoryRepository =>
    new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop === "savePayment") {
          return async () => {
            throw new Error("neon asleep");
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  it("still tells the customer when the bookkeeping fails, exactly once across both deliveries", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);

    // Delivery 1: the booking commits, then a write after it throws, so the route 500s.
    const first = makeDeps(brokenAfterCommit(repo));
    await expect(
      processBookingWebhook(first.deps, bookingPi(), FAKE_SIGNATURE),
    ).rejects.toThrow("neon asleep");
    const toldOnFirst = first.confirm.mock.calls.length;

    // Delivery 2: Stripe retries into a healthy world. The row is already `booked`.
    const second = makeDeps(repo);
    const r = await processBookingWebhook(second.deps, bookingPi(), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "already" });
    // **Exactly once across BOTH deliveries** — not "on the second one". Which delivery does the
    // telling is an implementation detail that the reorder changes, and asserting it would bake
    // today's step order into the test. What must hold is that the customer is told, and not twice.
    expect(toldOnFirst + second.confirm.mock.calls.length).toBe(1);
  });

  it("tells the customer when the process died after the flip and before anything else (the residual)", async () => {
    // The case a reorder cannot reach, and the reason the row needs a memory at all: the flip
    // commits and the invocation stops — a Vercel timeout, an OOM — so no send was attempted and
    // no error was thrown either. Stripe redelivers into a row that is already `booked`.
    //
    // Simulated by flipping the row directly and then delivering the webhook, which is exactly
    // the state a dead invocation leaves behind. Nothing about `recordPayment`'s position changes
    // this one; only `confirmation_sent_at` can distinguish "already told" from "never got there".
    const repo = new InMemoryRepository();
    await seedPending(repo);
    const flip = await confirmPendingRow(repo, PI, NOW);
    expect(flip.outcome).toBe("booked");

    const { deps, confirm } = makeDeps(repo);
    const r = await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "already" });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("gives the claim back when the send reports it did not happen, so a retry sends", async () => {
    // **This is the case `/security-review` found unreachable in the first cut.** The wired dep
    // (`app/lib/booking-confirmation.ts`) wraps its whole body and never throws, so a `catch`-only
    // release could never fire — a carrier outage would claim the row, send nothing, and leave the
    // booking marked as told forever. Which is 15.3's own defect, re-entered by another door.
    //
    // So the dep reports delivery instead, `false` covering both "tried and failed" and
    // "deliberately not sent" (messaging off, no channel configured). This drives that path.
    const repo = new InMemoryRepository();
    await seedPending(repo);

    const down = makeDeps(repo);
    down.confirm.mockResolvedValue(false); // the carrier is down
    await processBookingWebhook(down.deps, bookingPi(), FAKE_SIGNATURE);
    expect(down.confirm).toHaveBeenCalledTimes(1);
    // The claim was released, so the row does NOT claim the customer was told.
    expect((await repo.getReservation(PEND))!.confirmationSentAt).toBeUndefined();

    // The carrier comes back and the provider redelivers.
    const up = makeDeps(repo);
    await processBookingWebhook(up.deps, bookingPi(), FAKE_SIGNATURE);
    expect(up.confirm).toHaveBeenCalledTimes(1);
    expect((await repo.getReservation(PEND))!.confirmationSentAt).toBeDefined();
  });

  it("a send that THROWS is treated as not-sent, even though the dep promises not to", async () => {
    // Belt for a dep that breaks its own contract. Without it a throw would skip the release and
    // the row would keep a claim over a send that never happened.
    const repo = new InMemoryRepository();
    await seedPending(repo);

    const { deps, confirm } = makeDeps(repo);
    confirm.mockRejectedValue(new Error("channel exploded"));
    const r = await processBookingWebhook(deps, bookingPi(), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "booked" });
    expect((await repo.getReservation(PEND))!.confirmationSentAt).toBeUndefined();
  });

  it("does NOT re-send on an ordinary redelivery of an already-confirmed booking", async () => {
    // The twin that must stay green, and the reason the gate existed at all: without the row's
    // memory, "send whenever we see `already`" would text the customer on every Stripe retry.
    const repo = new InMemoryRepository();
    await seedPending(repo);

    const first = makeDeps(repo);
    await processBookingWebhook(first.deps, bookingPi(), FAKE_SIGNATURE);
    expect(first.confirm).toHaveBeenCalledTimes(1);

    const second = makeDeps(repo);
    const r = await processBookingWebhook(second.deps, bookingPi(), FAKE_SIGNATURE);

    expect(r).toMatchObject({ handled: true, outcome: "already" });
    expect(second.confirm).not.toHaveBeenCalled();
  });
});
