/**
 * createDeparturePaymentIntent (12.5, DEC-134) + the `payment_intent.succeeded` webhook
 * path, end-to-end against the in-memory repo + FakePaymentPort. The inline-Elements twin
 * of create-departure-checkout.test.ts: hold → frozen PI metadata (incl. the service fee) →
 * booking keyed on the intent id, plus the DEC-134 double-write guard.
 */
import { describe, expect, it, vi } from "vitest";
import { FAKE_SIGNATURE, FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { PaymentEvent } from "../ports/payment.js";
import { processBookingWebhook, type WebhookDeps } from "./booking-webhook.js";
import { createDeparturePaymentIntent } from "./create-departure-payment-intent.js";
import { eventIdForSlot } from "./availability.js";
import { reservationIdFor } from "./write-booking.js";

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
  await repo.markVesselDayMusterOwned(SMALL, DATE, NOW);
  await repo.markVesselDayMusterOwned(BIG, DATE, NOW);
  // Deposit mode + real rates so the frozen metadata exercises every money field.
  await repo.setPaymentConfig({ depositMode: "deposit", depositPercent: 25, taxRateBps: 725 }, NOW);
  return repo;
}

const req = {
  offeringId: OFF, date: DATE, time: TIME, guestCount: 4, gratuityBps: 2000,
  customerName: "Mary", email: "m@x.io", phone: "+12165550148",
  waiverConsentAt: "2026-07-13T12:00:00.000Z", waiverVersion: "v1",
};

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
  const deps: WebhookDeps = { repo, payments, now, alertPaidButUnbooked: alert, sendConfirmation: confirm, notifyCustomerSoldOut: soldOut };
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

  it("sold out once both boats are held", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDeparturePaymentIntent(repo, pay, req, now);
    await createDeparturePaymentIntent(repo, pay, req, now);
    const third = await createDeparturePaymentIntent(repo, pay, req, now);
    expect(third).toEqual({ ok: false, reason: "sold_out" });
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
    const resId = reservationIdFor("pi_fake_1");
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
    expect(await repo.listPaymentsForReservation(reservationIdFor("pi_fake_1"))).toHaveLength(1);
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
  });

  it("the hosted session-completed path still books (both event types coexist)", async () => {
    const repo = await seededRepo();
    const { deps, confirm } = makeDeps(repo);
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
    expect(r).toEqual({ handled: true, outcome: "booked" });
    expect(confirm).toHaveBeenCalledOnce();
    const p = (await repo.listPaymentsForReservation(reservationIdFor("cs_1")))[0]!;
    expect(p).toMatchObject({ id: "pay_cs_1", stripeCheckoutSessionId: "cs_1" });
  });
});
