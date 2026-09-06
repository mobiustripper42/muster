/**
 * createDeparturePaymentIntent (12.5, DEC-134) + the `payment_intent.succeeded` webhook
 * path, end-to-end against the in-memory repo + FakePaymentPort. The inline-Elements twin
 * of create-departure-checkout.test.ts: hold → frozen PI metadata (incl. the service fee) →
 * booking keyed on the intent id, plus the DEC-134 double-write guard.
 */
import { describe, expect, it, vi } from "vitest";
import { FAKE_SIGNATURE, FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { isBooked, type Offering, type Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { PaymentEvent } from "../ports/payment.js";
import { processBookingWebhook, type WebhookDeps } from "./booking-webhook.js";
import { createDeparturePaymentIntent } from "./create-departure-payment-intent.js";
import { eventIdForSlot } from "./availability.js";

/** The reservation id is the pending row's (random) id since 14.5 — find it by the intent id
 *  the row carries, rather than deriving it from the charge key. */
const resIdBy = async (repo: InMemoryRepository, pi: string) =>
  (await repo.getReservationByPaymentIntentId(pi))!.id;

const SMALL = asId<"VesselId">("v-small");
const BIG = asId<"VesselId">("v-big");
const OFF = asId<"OfferingId">("off-1");
const LOC = asId<"LocationId">("loc-1");
const DATE = "2026-07-04";
const TIME = "13:30";
const NOW = "2026-07-04T12:00:00.000Z";
const now = () => NOW;

const vessel = (id: typeof SMALL, coiMaxPax: number): Vessel => ({ id, name: String(id), coiMaxPax, manning: [] });
const offering = (over: Partial<Offering> = {}): Offering => ({
  id: OFF, tenantId: asId<"TenantId">("t"), name: "Cruise", status: "live",
  vesselIds: [BIG, SMALL], locationId: LOC,
  schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: [TIME] },
  basePriceCents: 49900, priceVariations: [], extraGuestPriceCents: 5000, ...over,
});

async function seededRepo(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveOffering(offering());
  await repo.saveVessel(vessel(SMALL, 6));
  await repo.saveVessel(vessel(BIG, 12));
  // Deposit mode + real rates so the frozen metadata exercises every money field.
  await repo.setPaymentConfig({ depositMode: "deposit", depositPercent: 25, taxRateBps: 725 }, NOW);
  return repo;
}

const TOKEN_A = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";
const TOKEN_B = "b3RoZXJzZXNzaW9udG9rZW4wMTIzNDU2Nzg5YWJjZGU";
const TOKEN_C = "dGhpcmRzZXNzaW9udG9rZW4wMTIzNDU2Nzg5YWJjZGU";

const req = {
  offeringId: OFF, date: DATE, time: TIME, guestCount: 4, gratuityBps: 2000,
  customerName: "Mary", email: "m@x.io", phone: "+12165550148", holderToken: TOKEN_A,
  waiverConsentAt: "2026-07-13T12:00:00.000Z", waiverVersion: "v1",
};

/**
 * The residual race under the flip model (14.5): the losing buyer's LAPSED pending row still
 * exists on the small boat (its window expired, which is what let the winner take the slot), so
 * their late `payment_intent.succeeded` finds a row to confirm — and loses the whole-boat mutex
 * to the booked winner. Seeded directly, lapsed, so it never blocks the winner's own confirm.
 */
async function seedLosingPending(repo: InMemoryRepository, paymentIntentId: string): Promise<void> {
  await repo.saveReservation({
    id: asId<"ReservationId">(`resv-${paymentIntentId}`),
    eventId: null,
    source: "muster",
    status: "pending",
    customerName: "Mary",
    email: "m@x.io",
    partySize: 4,
    vesselId: SMALL,
    date: DATE,
    time: TIME,
    offeringId: OFF,
    reservedAt: "2026-07-04T11:00:00.000Z", // lapsed well before NOW (12:00) − 15-min window
    holdMinutes: 120,
    tripMinutes: 100,
    paymentIntentIds: [paymentIntentId],
  });
}

/** Wrap a synthesized `payment_intent.succeeded` for the fake port. */
function piEvent(paymentIntentId: string, amountReceivedCents: number, metadata: Record<string, string>): string {
  const ev: PaymentEvent = {
    type: "payment_succeeded",
    data: { paymentIntentId, amountReceivedCents, currency: "usd", metadata },
  };
  return JSON.stringify(ev);
}

function makeDeps(repo: InMemoryRepository, payments: FakePaymentPort = new FakePaymentPort()) {
  const alert = vi.fn(async (_m: string) => {});
  const confirm = vi.fn(async (_r: unknown) => {});
  const soldOut = vi.fn(async (_c: unknown) => {});
  const deps: WebhookDeps = { repo, payments, now, reservationsEnabled: true, alertPaidButUnbooked: alert, sendConfirmation: confirm, notifyCustomerSoldOut: soldOut };
  return { deps, alert, confirm, soldOut, payments };
}

describe("createDeparturePaymentIntent — hold + frozen money metadata (12.5, DEC-134)", () => {
  it("acquires a hold, charges deposit + full tax + full fee + full tip, freezes it all", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    const r = await createDeparturePaymentIntent(repo, pay, req, now);
    expect(r).toMatchObject({ ok: true, paymentIntentId: "pi_fake_1" });
    if (r.ok) expect(r.clientSecret).toBe("pi_fake_1_secret_test");
    expect(await repo.listCheckoutHolds()).toHaveLength(1);

    // fare 49900 (4 guests ≤ 6 included → no extras); tax 3618; fee 1497; tip 9980;
    // deposit share 12475 → amount = 12475 + 3618 + 1497 + 9980 = 27570.
    const intent = pay.intents[0]!;
    expect(intent.amountCents).toBe(27570);
    expect(intent.currency).toBe("usd");
    expect(intent.metadata).toMatchObject({
      purpose: "booking", offeringId: "off-1", vesselId: "v-small", date: DATE, time: TIME,
      guestCount: "4", priceCents: "49900", extrasCents: "0",
      gratuityCents: "9980", gratuityBps: "2000",
      serviceFeeCents: "1497", taxCents: "3618", kind: "deposit",
      customerName: "Mary", email: "m@x.io", phone: "+12165550148",
      waiverConsentAt: "2026-07-13T12:00:00.000Z", waiverVersion: "v1",
    });
    expect(intent.metadata.eventId).toBeUndefined(); // no Event yet — the slot is the payload
    // The holder token is a SESSION credential and must not travel to Stripe. Nothing needs it
    // there, and metadata is somebody else's log.
    expect(intent.metadata.holderToken).toBeUndefined();
  });

  it("waiver consent is a hard gate — no hold parked without it", async () => {
    const repo = await seededRepo();
    const { waiverConsentAt: _a, waiverVersion: _b, ...noWaiver } = req;
    const r = await createDeparturePaymentIntent(repo, new FakePaymentPort(), noWaiver, now);
    expect(r).toEqual({ ok: false, reason: "waiver_required" });
    expect(await repo.listCheckoutHolds()).toHaveLength(0);
  });

  it("gratuity tier must be one the offering offers (DEC-124, no decline)", async () => {
    const repo = await seededRepo();
    const r = await createDeparturePaymentIntent(repo, new FakePaymentPort(), { ...req, gratuityBps: 1234 }, now);
    expect(r).toEqual({ ok: false, reason: "gratuity_required" });
    expect(await repo.listCheckoutHolds()).toHaveLength(0);
  });

  it("an off-grid slot is refused before any hold or Stripe call (#799)", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    // 13:30 is a listed departure; 13:31 is not. A scripted caller could post it; nothing on the
    // real UI can. It must never reach `paymentIntents.create` — the whole invisible-lockout class
    // dies here.
    const r = await createDeparturePaymentIntent(repo, pay, { ...req, time: "13:31" }, now);
    expect(r).toEqual({ ok: false, reason: "off_schedule" });
    expect(await repo.listCheckoutHolds()).toHaveLength(0);
    expect(pay.intents).toHaveLength(0);
  });

  it("sold out once both boats are held — by DIFFERENT buyers", async () => {
    // Three submits of the same `req` used to stand here, and it passed for the wrong reason:
    // one buyer retrying took a second boat and then hit sold_out (#575). The sold-out path is
    // real and worth pinning, but it needs three distinct buyers to be about capacity rather
    // than about the retry defect below.
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    await createDeparturePaymentIntent(repo, pay, { ...req, email: "dana@x.io", phone: "+14405550102", holderToken: TOKEN_B }, now);
    const third = await createDeparturePaymentIntent(
      repo,
      pay,
      { ...req, email: "sam@x.io", phone: "+12165550199", holderToken: TOKEN_C },
      now,
    );
    expect(third).toEqual({ ok: false, reason: "sold_out" });
  });

  it("a buyer retrying a declined card reuses their hold, not a second boat (#575)", async () => {
    // The ordinary event: card declines, customer fixes it and resubmits. Every submit called
    // `acquireDepartureHold`, which knows nothing about who is asking — so attempt 2 landed on
    // the big boat and attempt 3 reported sold_out on a departure with ZERO paying customers,
    // for everyone, for fifteen minutes.
    const repo = await seededRepo();
    const pay = new FakePaymentPort();

    const first = await createDeparturePaymentIntent(repo, pay, req, now);
    const second = await createDeparturePaymentIntent(repo, pay, req, now);
    const third = await createDeparturePaymentIntent(repo, pay, req, now);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(true);
    // One buyer, one boat — the whole point.
    expect(await repo.listCheckoutHolds()).toHaveLength(1);
    // …and the fleet is still sellable to somebody else.
    const other = await createDeparturePaymentIntent(
      repo,
      pay,
      { ...req, email: "dana@x.io", phone: "+14405550102", holderToken: TOKEN_B },
      now,
    );
    expect(other.ok).toBe(true);
    expect(await repo.listCheckoutHolds()).toHaveLength(2);
  });

  it("extra guests bill on top and the fee is on the COMPOSED fare", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    // 8 guests → falls to the big boat (small caps at 6); big included = coiMaxPax 12 →
    // still no extras. Pin instead with an offering-included count of 2: 8 − 2 = 6 extras.
    await repo.saveOffering(offering({ includedGuestCount: 2 }));
    const r = await createDeparturePaymentIntent(repo, pay, { ...req, guestCount: 8 }, now);
    expect(r.ok).toBe(true);
    const m = pay.intents[0]!.metadata;
    // fare = 49900 + 6 × 5000 = 79900; fee = 3% = 2397; tax = 5793; tip 20% = 15980.
    expect(m.extrasCents).toBe("30000");
    expect(m.serviceFeeCents).toBe("2397");
    expect(m.taxCents).toBe("5793");
    expect(m.gratuityCents).toBe("15980");
    expect(pay.intents[0]!.amountCents).toBe(Math.round(79900 * 0.25) + 5793 + 2397 + 15980);
  });
});

/**
 * What Stripe is told about the payment (#679).
 *
 * Before this, a booking reached Stripe as an amount plus a metadata bag Stripe does not read.
 * The payments list showed a bare dollar figure, no receipt was ever sent, and the guest's phone
 * arrived blank because the Payment Element was mounted with no defaults and collected its own.
 *
 * Metadata is NOT the fix and must not be touched: the webhook materializes the Event from it
 * (`processBookingCharge`), so it is load-bearing, not descriptive.
 */
describe("createDeparturePaymentIntent — what Stripe is told (#679)", () => {
  it("describes the departure in a line a human can read", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);

    // A raw PaymentIntent has no line item — without this the dashboard row is an amount and
    // nothing else, and triaging a guest's phone call means opening metadata.
    expect(pay.intents[0]!.description).toBe("Cruise — 2026-07-04 13:30 · 4 guests · Mary");
  });

  it("sets receipt_email when the guest gave one, so Stripe sends them a receipt", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    expect(pay.intents[0]!.receiptEmail).toBe("m@x.io");
  });

  it("omits receipt_email when there is no email — email is optional at /book", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    const { email: _e, ...noEmail } = req;
    const r = await createDeparturePaymentIntent(repo, pay, noEmail, now);

    expect(r.ok).toBe(true);
    expect(pay.intents[0]!.receiptEmail).toBeUndefined();
    // Phone is the required field (DEC-132), so a booking without email is ordinary, not an
    // error — it just gets no Stripe receipt. The description still identifies the departure.
    expect(pay.intents[0]!.description).toContain("2026-07-04");
  });

  it("leaves the money metadata untouched — the webhook still books from it", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    expect(pay.intents[0]!.metadata).toMatchObject({
      purpose: "booking", vesselId: "v-small", date: DATE, time: TIME,
      priceCents: "49900", taxCents: "3618", serviceFeeCents: "1497", gratuityCents: "9980",
    });
  });
});

describe("payment_intent.succeeded webhook path (12.5, DEC-134)", () => {
  it("books exactly one reservation off a purposed PI, keyed on the intent id, fee on the Payment", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    const start = await createDeparturePaymentIntent(repo, pay, req, now);
    expect(start.ok).toBe(true);
    const { deps, confirm, alert } = makeDeps(repo, pay);

    const m = pay.intents[0]!.metadata;
    const r = await processBookingWebhook(deps, piEvent("pi_fake_1", 27570, m), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "booked" });

    const evId = eventIdForSlot(SMALL, DATE, TIME);
    expect(await repo.getEvent(evId)).not.toBeNull(); // materialized
    const resId = await resIdBy(repo, "pi_fake_1");
    const res = await repo.getReservation(resId);
    expect(res).toMatchObject({ status: "booked", partySize: 4 });
    expect(await repo.listCheckoutHolds()).toHaveLength(0); // hold released
    expect(confirm).toHaveBeenCalledOnce();
    expect(alert).not.toHaveBeenCalled();

    // Payment: id seeded off the PI, fee + tip carved out, NO session id.
    const payments = await repo.listPaymentsForReservation(resId);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      id: "pay_pi_fake_1",
      kind: "deposit",
      amountCents: 27570,
      taxCents: 3618,
      gratuityCents: 9980,
      serviceFeeCents: 1497,
      stripePaymentIntentId: "pi_fake_1",
      status: "succeeded",
    });
    expect(payments[0]!.stripeCheckoutSessionId).toBeUndefined();

    // Pre-gratuity recorded off the same key (crew money, DEC-124).
    const grats = await repo.listGratuitiesForEvent(evId);
    expect(grats).toHaveLength(1);
    expect(grats[0]).toMatchObject({ id: "grat_pre_pi_fake_1", kind: "pre", amountCents: 9980, bps: 2000 });
  });

  it("stores Stripe's hosted receipt URL on the payment (#679)", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    const { deps } = makeDeps(repo, pay);

    await processBookingWebhook(deps, piEvent("pi_fake_1", 27570, pay.intents[0]!.metadata), FAKE_SIGNATURE);

    // Stored rather than fetched at render: `/b/<code>` is a page a guest loads, and a live
    // Stripe call there would break it whenever Stripe is slow. The URL is guest-safe — it is
    // Stripe's own hosted receipt, not a dashboard link.
    const payments = await repo.listPaymentsForReservation(await resIdBy(repo, "pi_fake_1"));
    expect(payments[0]!.receiptUrl).toBe("https://pay.stripe.test/receipts/pi_fake_1");
  });

  it("a receipt lookup that fails does NOT cost the booking", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    pay.receiptUrlError = new Error("stripe is down");
    const { deps, alert } = makeDeps(repo, pay);

    const r = await processBookingWebhook(deps, piEvent("pi_fake_1", 27570, pay.intents[0]!.metadata), FAKE_SIGNATURE);

    // The receipt link is a convenience. The booking and the payment row are not.
    expect(r).toEqual({ handled: true, outcome: "booked" });
    const payments = await repo.listPaymentsForReservation(await resIdBy(repo, "pi_fake_1"));
    expect(payments).toHaveLength(1);
    expect(payments[0]!.receiptUrl).toBeUndefined();
    expect(alert).not.toHaveBeenCalled(); // not a money problem — nothing for a human to do
  });

  it("a redelivered payment_intent.succeeded is idempotent — one booking, one payment, one confirm", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    const { deps, confirm } = makeDeps(repo, pay);
    const m = pay.intents[0]!.metadata;

    await processBookingWebhook(deps, piEvent("pi_fake_1", 27570, m), FAKE_SIGNATURE);
    const again = await processBookingWebhook(deps, piEvent("pi_fake_1", 27570, m), FAKE_SIGNATURE);
    expect(again).toEqual({ handled: true, outcome: "already" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(await repo.listPaymentsForReservation(await resIdBy(repo, "pi_fake_1"))).toHaveLength(1);
  });

  it("DOUBLE-WRITE GUARD: a metadata-less payment_intent.succeeded (a hosted session's PI) is acked-and-ignored", async () => {
    const repo = await seededRepo();
    const { deps, alert } = makeDeps(repo);
    const r = await processBookingWebhook(deps, piEvent("pi_hosted_1", 49900, {}), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: false }); // ack + ignore — no write, no alert
    expect(await repo.listAllReservations()).toHaveLength(0);
    expect(await repo.listAllPayments()).toHaveLength(0);
    expect(alert).not.toHaveBeenCalled();
  });

  it("a purposed-but-unknown PI is loudly flagged, never booked", async () => {
    const repo = await seededRepo();
    const { deps, alert } = makeDeps(repo);
    const r = await processBookingWebhook(deps, piEvent("pi_x", 100, { purpose: "mystery" }), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "ignored" });
    expect(alert).toHaveBeenCalledOnce();
    expect(await repo.listAllReservations()).toHaveLength(0);
  });

  it("residual race on the PI path: loser auto-refunded keyed on the PI id", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    // Both buyers minted intents for the SAME small boat (second hold expired → same slot).
    await createDeparturePaymentIntent(repo, pay, req, now);
    await seedLosingPending(repo, "pi_fake_2"); // the lapsed loser (14.5 residual race)
    const { deps, alert, soldOut, payments } = makeDeps(repo, pay);
    const m = pay.intents[0]!.metadata;

    const first = await processBookingWebhook(deps, piEvent("pi_fake_1", 27570, m), FAKE_SIGNATURE);
    const second = await processBookingWebhook(deps, piEvent("pi_fake_2", 27570, m), FAKE_SIGNATURE);
    expect(first).toEqual({ handled: true, outcome: "booked" });
    expect(second).toEqual({ handled: true, outcome: "lost" });
    expect(payments.refunds).toHaveLength(1);
    expect(payments.refunds[0]).toMatchObject({
      paymentIntentId: "pi_fake_2",
      idempotencyKey: "refund_pi_fake_2",
    });
    expect(soldOut).toHaveBeenCalledOnce();
    expect(alert).not.toHaveBeenCalled();

    // NO ledger row for the loser (#613). #522 sweep 1 wrote one and marked it `refunded`, to
    // stop refunded money reading as collected revenue — the right goal via a row Postgres
    // refuses, since its reservation never existed (that comment said so itself: "it never
    // reaches the purchases list"). Not writing it achieves the same thing and leaves nothing
    // to inflate a `listAllPayments` rollup. Stripe holds the record.
    expect(await repo.getPayment(asId<"PaymentId">("pay_pi_fake_2"))).toBeNull();
  });

  // Retitled at #613 — there is no ledger row to "re-record" any more. The property that still
  // matters, and the one that protects the customer, is that a Stripe redelivery refunds under
  // the SAME idempotency key, so Stripe returns the original refund instead of issuing a second.
  it("a redelivered losing charge refunds under the same idempotency key — never twice", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    await seedLosingPending(repo, "pi_fake_2"); // the lapsed loser (14.5 residual race)
    const { deps } = makeDeps(repo, pay);
    const m = pay.intents[0]!.metadata;

    await processBookingWebhook(deps, piEvent("pi_fake_1", 27570, m), FAKE_SIGNATURE);
    await processBookingWebhook(deps, piEvent("pi_fake_2", 27570, m), FAKE_SIGNATURE);
    const again = await processBookingWebhook(deps, piEvent("pi_fake_2", 27570, m), FAKE_SIGNATURE);

    expect(again).toEqual({ handled: true, outcome: "lost" });
    // Same key both times ⇒ Stripe returns the first refund rather than making a second.
    const keys = pay.refunds.map((r) => r.idempotencyKey);
    expect(keys).toEqual(keys.map(() => "refund_pi_fake_2"));
    expect(new Set(keys).size).toBe(1);
    // And still no orphan payment row.
    expect(await repo.getPayment(asId<"PaymentId">("pay_pi_fake_2"))).toBeNull();
  });

  it("the crew tip survives a failure between the booking commit and the gratuity write", async () => {
    // THE defect this sweep existed to find (#522). The gratuity write used to sit inside
    // `if (outcome === "booked")`. If anything after the booking commit threw, the webhook
    // 500s, Stripe redelivers, `writeSlotBooking` short-circuits to `already` — and the
    // `booked` branch is false forever, so the tip is never recorded. Silent, because
    // `Payment.gratuityCents` still nets out of the customer's balance so nothing looks
    // wrong; but `splitGratuity` builds the crew pool from `Gratuity` rows alone, so the
    // money stays in the operator's Stripe account and the crew is never paid it.
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    const { deps } = makeDeps(repo, pay);
    const m = pay.intents[0]!.metadata;

    // Fail once, AFTER the booking has committed.
    const realSaveGratuity = repo.saveGratuity.bind(repo);
    let failed = false;
    repo.saveGratuity = async (g) => {
      if (!failed) {
        failed = true;
        throw new Error("transient: pool exhausted");
      }
      return realSaveGratuity(g);
    };

    await expect(
      processBookingWebhook(deps, piEvent("pi_fake_1", 27570, m), FAKE_SIGNATURE),
    ).rejects.toThrow(/pool exhausted/);

    // The booking committed before the throw, so redelivery resolves `already`.
    const retry = await processBookingWebhook(deps, piEvent("pi_fake_1", 27570, m), FAKE_SIGNATURE);
    expect(retry).toEqual({ handled: true, outcome: "already" });

    const grats = await repo.listGratuitiesForEvent(eventIdForSlot(SMALL, DATE, TIME));
    expect(grats).toHaveLength(1);
    expect(grats[0]).toMatchObject({ id: "grat_pre_pi_fake_1", kind: "pre", amountCents: 9980 });
  });

  it("a redelivery still records the tip exactly once", async () => {
    // The other half: idempotency here is the deterministic id plus `on conflict do nothing`,
    // NOT the outcome gate — so running on `already` cannot double-record.
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    const { deps } = makeDeps(repo, pay);
    const m = pay.intents[0]!.metadata;

    await processBookingWebhook(deps, piEvent("pi_fake_1", 27570, m), FAKE_SIGNATURE);
    await processBookingWebhook(deps, piEvent("pi_fake_1", 27570, m), FAKE_SIGNATURE);
    await processBookingWebhook(deps, piEvent("pi_fake_1", 27570, m), FAKE_SIGNATURE);

    expect(await repo.listGratuitiesForEvent(eventIdForSlot(SMALL, DATE, TIME))).toHaveLength(1);
  });

  it("refuses to book at a defaulted price when priceCents is missing from metadata", async () => {
    // `Number(m.priceCents ?? 0)` materialized the event at price 0, after which
    // `balanceOwedCents` derives "nothing owed" and the purchases view reports
    // `priceKnown: true` — a free boat that reads as a normal paid booking. Only our own
    // builders mint this metadata, so an absent value is our bug: it should be a loud 500
    // Stripe retries, not a silent zero.
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    const { deps } = makeDeps(repo, pay);
    const { priceCents: _dropped, ...without } = pay.intents[0]!.metadata;

    await expect(
      processBookingWebhook(deps, piEvent("pi_fake_1", 27570, without), FAKE_SIGNATURE),
    ).rejects.toThrow(/missing a usable priceCents/);
    // A PENDING row exists from checkout (14.4); what must not exist is a BOOKED one.
    expect((await repo.listAllReservations()).filter(isBooked)).toHaveLength(0);
  });

  it("rejects a priceCents that COERCES to a number but isn't one", async () => {
    // The guard originally validated `Number(raw)`, and `Number("  ")` is 0 — finite and
    // not negative — so whitespace walked through and booked at price zero, which is the
    // exact defect it exists to prevent. `"0x10"` (→ 16) and `"1e3"` are the same class.
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    const { deps } = makeDeps(repo, pay);
    const m = pay.intents[0]!.metadata;

    for (const bad of ["  ", "", "0x10", "1e3", "-1", "12.5", "abc"]) {
      await expect(
        processBookingWebhook(deps, piEvent("pi_fake_1", 27570, { ...m, priceCents: bad }), FAKE_SIGNATURE),
      ).rejects.toThrow(/missing a usable priceCents/);
    }
    // A PENDING row exists from checkout (14.4); what must not exist is a BOOKED one.
    expect((await repo.listAllReservations()).filter(isBooked)).toHaveLength(0);
  });

  it("applies the same guard to extrasCents, which under-bills the balance when silently zeroed", async () => {
    // `extrasCents` sat one line below `priceCents` still using the coercion this hardened
    // against — a whitespace value books extras at 0 and under-collects the deposit-mode
    // balance by `extras + tax(extras)`, which is the #474 bug arriving silently.
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    const { deps } = makeDeps(repo, pay);
    const m = pay.intents[0]!.metadata;

    await expect(
      processBookingWebhook(deps, piEvent("pi_fake_1", 27570, { ...m, extrasCents: " " }), FAKE_SIGNATURE),
    ).rejects.toThrow(/missing a usable extrasCents/);

    // Absent is still legitimate — a pre-#474 charge reads 0 and books fine.
    const { extrasCents: _gone, ...noExtras } = m;
    const r = await processBookingWebhook(deps, piEvent("pi_fake_1", 27570, noExtras), FAKE_SIGNATURE);
    expect(r).toMatchObject({ handled: true, outcome: "booked" });
  });

  it("ALERTS on unusable metadata — money moved, so it must not fail silently", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    const { deps, alert } = makeDeps(repo, pay);
    const m = pay.intents[0]!.metadata;

    await expect(
      processBookingWebhook(deps, piEvent("pi_fake_1", 27570, { ...m, priceCents: "  " }), FAKE_SIGNATURE),
    ).rejects.toThrow();
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toMatch(/PAID but NOT booked/);
  });

  it("does NOT alert 'unusable metadata' when the WRITE fails — that's infra, and Stripe retries", async () => {
    // The alert names a metadata defect and tells the operator to refund manually. Firing
    // it for a pg blip means telling them to refund a booking that lands on the next retry
    // — and the route already treats a post-signature throw as expected and retryable.
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    const { deps, alert } = makeDeps(repo, pay);
    const m = pay.intents[0]!.metadata;

    repo.bookPendingIfHullFree = async () => {
      throw new Error("transient: connection terminated");
    };

    await expect(
      processBookingWebhook(deps, piEvent("pi_fake_1", 27570, m), FAKE_SIGNATURE),
    ).rejects.toThrow(/connection terminated/);
    expect(alert).not.toHaveBeenCalled();
  });

  it("a hosted booking session is REFUSED — the hosted booking path was retired (14.5)", async () => {
    // The inverse of the old test: `payment_intent.succeeded` is the live booking path now, and a
    // hosted `checkout.session.completed` booking session — nothing mints one — is refused loudly.
    const repo = await seededRepo();
    const { deps, confirm, alert } = makeDeps(repo);
    const sessionEvent = {
      sessionId: "cs_1", paymentIntentId: "pi_cs_1", amountTotalCents: 27570, currency: "usd",
      metadata: {
        purpose: "booking", offeringId: "off-1", vesselId: "v-small", date: DATE, time: TIME,
        guestCount: "4", priceCents: "49900", kind: "deposit", taxCents: "3618",
        gratuityCents: "9980", customerName: "Mary",
        waiverConsentAt: "2026-07-13T12:00:00.000Z", waiverVersion: "v1",
      },
    };
    const r = await processBookingWebhook(deps, JSON.stringify(sessionEvent), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "unbookable" });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toContain("hosted Checkout booking session");
    expect(confirm).not.toHaveBeenCalled();
    expect(await repo.listAllReservations()).toHaveLength(0);
  });
});

/**
 * The pending row (14.4, SPEC §2.8.2–2.8.4, DEC-161, DEC-164).
 *
 * Checkout writes a `pending` reservation BEFORE calling Stripe. The row names the slot (not an
 * Event), freezes the money as one invoice with every component and its rate, freezes both
 * durations, and records the payment-intent id once Stripe answers. Everything the customer
 * was quoted lives on the row from that moment; an operator edit after checkout starts changes
 * nothing about this booking (criterion 20).
 */
describe("createDeparturePaymentIntent — the pending row before Stripe (14.4)", () => {
  const tripOffering = (over: Partial<Offering> = {}) =>
    offering({ tripLengthMinutes: 100, holdMinutes: 120, ...over });

  async function pendingRows(repo: InMemoryRepository) {
    return (await repo.listAllReservations()).filter((r) => r.status === "pending");
  }

  it("writes ONE pending row naming the slot, with no Event, before the intent exists", async () => {
    const repo = await seededRepo();
    await repo.saveOffering(tripOffering());
    const pay = new FakePaymentPort();
    const r = await createDeparturePaymentIntent(repo, pay, req, now);
    expect(r.ok).toBe(true);

    const rows = await pendingRows(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "pending",
      source: "muster",
      eventId: null,
      vesselId: "v-small",
      date: DATE,
      time: TIME,
      offeringId: "off-1",
      reservedAt: NOW,
      customerName: "Mary",
      partySize: 4,
      email: "m@x.io",
      phone: "+12165550148",
      waiverConsentAt: "2026-07-13T12:00:00.000Z",
      waiverVersion: "v1",
      paymentIntentIds: ["pi_fake_1"],
    });
    expect(await repo.listEvents()).toHaveLength(0);
  });

  it("freezes both durations on the row — hold minutes and trip time (DEC-161)", async () => {
    const repo = await seededRepo();
    await repo.saveOffering(tripOffering());
    await createDeparturePaymentIntent(repo, new FakePaymentPort(), req, now);
    const [row] = await pendingRows(repo);
    expect(row).toMatchObject({ holdMinutes: 120, tripMinutes: 100 });
  });

  it("freezes the money as one invoice — every component in cents AND its rate (DEC-164)", async () => {
    const repo = await seededRepo();
    await repo.saveOffering(tripOffering({ includedGuestCount: 2 }));
    await createDeparturePaymentIntent(repo, new FakePaymentPort(), { ...req, guestCount: 8 }, now);
    const [row] = await pendingRows(repo);
    // fare 49900 + 6 extras × 5000 = 79900 → tax 7.25% = 5793, fee 3% = 2397, tip 20% = 15980.
    expect(row!.invoice).toEqual({
      fareCents: 49900,
      extrasCents: 30000,
      taxCents: 5793,
      taxRateBps: 725,
      serviceFeeCents: 2397,
      serviceFeeBps: 300,
      gratuityCents: 15980,
      gratuityBps: 2000,
      totalCents: 49900 + 30000 + 5793 + 2397 + 15980,
    });
  });

  it("the row exists even when Stripe throws — written BEFORE the provider call (criterion 2)", async () => {
    const repo = await seededRepo();
    await repo.saveOffering(tripOffering());
    const pay = new FakePaymentPort();
    pay.createPaymentIntent = async () => {
      throw new Error("stripe: 502");
    };
    await expect(createDeparturePaymentIntent(repo, pay, req, now)).rejects.toThrow(/stripe: 502/);
    const rows = await pendingRows(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paymentIntentIds).toBeUndefined(); // Stripe never answered
  });

  it("a rival's live pending row pushes the next buyer to the next boat (§2.8.3 on the write side)", async () => {
    const repo = await seededRepo();
    await repo.saveOffering(tripOffering());
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    // Strip the first buyer's HOLD so only their pending row stands between the rival and v-small.
    for (const h of await repo.listCheckoutHolds()) await repo.removeCheckoutHold(h.id);
    const rival = await createDeparturePaymentIntent(
      repo,
      pay,
      { ...req, email: "dana@x.io", phone: "+14405550102", holderToken: TOKEN_B },
      now,
    );
    expect(rival.ok).toBe(true);
    expect(pay.intents[1]!.metadata.vesselId).toBe("v-big");
  });

  it("a retry from the same session REUSES the row — same id, reserved time untouched, both ids recorded (14.6)", async () => {
    const repo = await seededRepo();
    await repo.saveOffering(tripOffering());
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    const before = await pendingRows(repo);
    expect(before).toHaveLength(1);
    const firstId = before[0]!.id;

    // Card declined; the customer resubmits five minutes later with the same cookie token.
    const later = () => "2026-07-04T12:05:00.000Z";
    const again = await createDeparturePaymentIntent(repo, pay, req, later);
    expect(again.ok).toBe(true);

    const after = await pendingRows(repo);
    expect(after).toHaveLength(1); // reused, not a second row
    expect(after[0]!.id).toBe(firstId); // the SAME row
    expect(after[0]!.reservedAt).toBe(NOW); // reserved time untouched — the window keeps counting from the first submit
    expect(after[0]!.paymentIntentIds).toEqual(["pi_fake_1", "pi_fake_2"]); // both ids recorded (§2.8.5)
    expect(pay.intents[1]!.metadata.vesselId).toBe("v-small"); // same boat
  });

  it("a second checkout with a DIFFERENT cookie is NOT merged onto the first — possession, not identity (criterion 10)", async () => {
    const repo = await seededRepo();
    await repo.saveOffering(tripOffering());
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now); // token A
    // Same customer name, email and phone — only the cookie differs. It must not reuse token A's row.
    const other = await createDeparturePaymentIntent(
      repo,
      pay,
      { ...req, holderToken: TOKEN_B },
      now,
    );
    expect(other.ok).toBe(true);
    expect(await pendingRows(repo)).toHaveLength(2); // two rows — a stranger cannot claim your row by typing your email
  });

  it("a changed tip on retry re-freezes the money on the same row (§2.8.7)", async () => {
    const repo = await seededRepo();
    await repo.saveOffering(tripOffering());
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now); // 20% tip
    const [before] = await pendingRows(repo);
    const firstGratuity = before!.invoice!.gratuityCents;

    const again = await createDeparturePaymentIntent(repo, pay, { ...req, gratuityBps: 2500 }, now); // 25%
    expect(again.ok).toBe(true);

    const [row] = await pendingRows(repo);
    expect((await pendingRows(repo))).toHaveLength(1); // same row
    expect(row!.invoice!.gratuityBps).toBe(2500); // re-frozen at the new tip
    expect(row!.invoice!.gratuityCents).not.toBe(firstGratuity);
    expect(row!.reservedAt).toBe(NOW); // reserved time still untouched
  });

  describe("criterion 20 — an operator edit after checkout starts changes nothing about this booking", () => {
    async function startThenEdit(edit: Partial<Offering>) {
      const repo = await seededRepo();
      await repo.saveOffering(tripOffering());
      const pay = new FakePaymentPort();
      await createDeparturePaymentIntent(repo, pay, req, now);
      await repo.saveOffering(tripOffering(edit)); // the edit lands while the customer is paying
      const { deps } = makeDeps(repo, pay);
      const r = await processBookingWebhook(deps, piEvent("pi_fake_1", 27570, pay.intents[0]!.metadata), FAKE_SIGNATURE);
      expect(r).toEqual({ handled: true, outcome: "booked" });
      return repo;
    }

    it("price edited → the charge and the frozen invoice are unchanged", async () => {
      const repo = await startThenEdit({ basePriceCents: 99900 });
      const [payment] = await repo.listPaymentsForReservation(await resIdBy(repo, "pi_fake_1"));
      expect(payment!.amountCents).toBe(27570);
      const pending = await repo.getReservationByPaymentIntentId("pi_fake_1");
      expect(pending!.invoice!.fareCents).toBe(49900);
    });

    it("hold minutes edited → the row still occupies for its frozen value", async () => {
      const repo = await startThenEdit({ holdMinutes: 30 });
      const pending = await repo.getReservationByPaymentIntentId("pi_fake_1");
      expect(pending!.holdMinutes).toBe(120);
    });

    it("trip time edited → the confirmed Event runs for the frozen trip time, not the new one", async () => {
      const repo = await startThenEdit({ tripLengthMinutes: 240 });
      const ev = await repo.getEvent(eventIdForSlot(SMALL, DATE, TIME));
      expect(ev!.durationMinutes).toBe(100);
    });
  });
});
