/**
 * createDepartureCheckout (12.1a) + the slot-first webhook path, end-to-end against the
 * in-memory repo + FakePaymentPort. Exercises the optimistic hold → Stripe metadata →
 * pessimistic write-claim spine, including the residual-race (two paid, one wins).
 */
import { describe, expect, it, vi } from "vitest";
import { FAKE_SIGNATURE, FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { CheckoutCompleted } from "../ports/payment.js";
import { processBookingWebhook, type WebhookDeps } from "./booking-webhook.js";
import { createDepartureCheckout } from "./create-departure-checkout.js";
import { eventIdForSlot, slotIdentity } from "./availability.js";

const SMALL = asId<"VesselId">("v-small");
const BIG = asId<"VesselId">("v-big");
const OFF = asId<"OfferingId">("off-1");
const LOC = asId<"LocationId">("loc-1");
const DATE = "2026-07-04";
const TIME = "13:30";
const NOW = "2026-07-04T12:00:00.000Z";
const now = () => NOW;
const URLS = { successUrl: "https://x/success", cancelUrl: "https://x/cancel" };

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
  await repo.setPaymentConfig({ depositMode: "full", taxRateBps: 0 }, NOW);
  return repo;
}

const req = {
  offeringId: OFF, date: DATE, time: TIME, guestCount: 4, gratuityBps: 2000,
  customerName: "Mary", email: "m@x.io",
  waiverConsentAt: "2026-07-13T12:00:00.000Z", waiverVersion: "v1",
};

/** Build a slot webhook payload for the vessel the checkout held. */
function slotCompleted(sessionId: string, vesselId: string, over: Partial<CheckoutCompleted> = {}): CheckoutCompleted {
  return {
    sessionId, paymentIntentId: `pi_${sessionId}`, amountTotalCents: 49900, currency: "usd",
    metadata: {
      purpose: "booking", offeringId: "off-1", vesselId, date: DATE, time: TIME,
      guestCount: "4", priceCents: "49900", kind: "full", taxCents: "0",
      customerName: "Mary", email: "m@x.io",
      waiverConsentAt: "2026-07-13T12:00:00.000Z", waiverVersion: "v1",
    },
    ...over,
  };
}

function makeDeps(repo: InMemoryRepository, payments: FakePaymentPort = new FakePaymentPort()) {
  const alert = vi.fn(async (_m: string) => {});
  const confirm = vi.fn(async (_r: unknown) => {});
  const soldOut = vi.fn(async (_c: unknown) => {});
  const deps: WebhookDeps = { repo, payments, now, reservationsEnabled: true, alertPaidButUnbooked: alert, sendConfirmation: confirm, notifyCustomerSoldOut: soldOut };
  return { deps, alert, confirm, soldOut, payments };
}

describe("createDepartureCheckout — hold + slot metadata (12.1a)", () => {
  it("acquires a hold on the smallest fitting boat and carries the SLOT (no eventId)", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    const r = await createDepartureCheckout(repo, pay, req, URLS, now);
    expect(r.ok).toBe(true);
    // hold placed on the small boat; deriver would show that slot held
    expect(await repo.listCheckoutHolds()).toHaveLength(1);
    expect(pay.created[0]!.metadata).toMatchObject({
      purpose: "booking", offeringId: "off-1", vesselId: "v-small", date: DATE, time: TIME,
      guestCount: "4", priceCents: "49900",
    });
    expect(pay.created[0]!.metadata.eventId).toBeUndefined(); // no Event yet
  });

  it("waiver consent is a hard gate — no hold parked without it", async () => {
    const repo = await seededRepo();
    const noWaiver = { offeringId: OFF, date: DATE, time: TIME, guestCount: 4, gratuityBps: 2000, customerName: "Mary", email: "m@x.io" };
    const r = await createDepartureCheckout(repo, new FakePaymentPort(), noWaiver, URLS, now);
    expect(r).toEqual({ ok: false, reason: "waiver_required" });
    expect(await repo.listCheckoutHolds()).toHaveLength(0);
  });

  it("a second buyer of the same departure falls back to the other boat", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDepartureCheckout(repo, pay, req, URLS, now); // buyer 1 → small
    await createDepartureCheckout(repo, pay, req, URLS, now); // buyer 2 → big
    const held = (await repo.listCheckoutHolds()).map((h) => String(h.vesselId)).sort();
    expect(held).toEqual(["v-big", "v-small"]);
  });

  it("sold out once both boats are held", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    await createDepartureCheckout(repo, pay, req, URLS, now);
    await createDepartureCheckout(repo, pay, req, URLS, now);
    const third = await createDepartureCheckout(repo, pay, req, URLS, now);
    expect(third).toEqual({ ok: false, reason: "sold_out" });
  });
});

describe("slot webhook path (12.1a) — materialize + claim under the backstop", () => {
  it("booked: materializes the Event at its slot identity, claims, releases the hold, confirms once", async () => {
    const repo = await seededRepo();
    await createDepartureCheckout(repo, new FakePaymentPort(), req, URLS, now); // hold on small
    const { deps, confirm, alert } = makeDeps(repo);

    const r = await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_1", "v-small")), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "booked" });

    const evId = eventIdForSlot(SMALL, DATE, TIME);
    expect(await repo.getEvent(evId)).not.toBeNull(); // materialized
    expect((await repo.listReservationsForEvent(evId)).filter((x) => x.status === "booked")).toHaveLength(1);
    expect(await repo.listCheckoutHolds()).toHaveLength(0); // hold released
    expect(confirm).toHaveBeenCalledOnce();
    expect(alert).not.toHaveBeenCalled();
  });

  it("redelivered webhook is idempotent — already, no second confirmation", async () => {
    const repo = await seededRepo();
    const { deps, confirm } = makeDeps(repo);
    await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_1", "v-small")), FAKE_SIGNATURE);
    const again = await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_1", "v-small")), FAKE_SIGNATURE);
    expect(again).toEqual({ handled: true, outcome: "already" });
    expect(confirm).toHaveBeenCalledOnce(); // not re-notified
  });

  it("residual race: two paid sessions on the SAME boat-slot — one booked, one auto-refunded + notified (12.1b)", async () => {
    const repo = await seededRepo();
    const { deps, alert, soldOut, payments } = makeDeps(repo);
    // Two customers both paid on the small boat (the hold expired for one mid-payment).
    const first = await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_1", "v-small")), FAKE_SIGNATURE);
    const second = await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_2", "v-small")), FAKE_SIGNATURE);
    expect(first).toEqual({ handled: true, outcome: "booked" });
    expect(second).toEqual({ handled: true, outcome: "lost" });
    // exactly one booking on that boat — no oversell
    const evId = eventIdForSlot(SMALL, DATE, TIME);
    expect((await repo.listReservationsForEvent(evId)).filter((x) => x.status === "booked")).toHaveLength(1);
    // the loser (cs_2) is AUTO-refunded + told sold-out; the manual alert does NOT fire (12.1b)
    expect(payments.refunds).toHaveLength(1);
    expect(payments.refunds[0]!.idempotencyKey).toBe("refund_cs_2");
    expect(soldOut).toHaveBeenCalledOnce();
    expect(alert).not.toHaveBeenCalled();
    // both payments recorded (money moved on both)
    expect(await repo.listCheckoutHolds()).toHaveLength(0);
  });

  it("redelivered losing webhook does NOT double-refund (keyed idempotency)", async () => {
    const repo = await seededRepo();
    const { deps, soldOut, payments } = makeDeps(repo);
    await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_1", "v-small")), FAKE_SIGNATURE); // booked
    await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_2", "v-small")), FAKE_SIGNATURE); // lost → refund
    await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_2", "v-small")), FAKE_SIGNATURE); // redelivery
    expect(payments.refunds).toHaveLength(1); // keyed on refund_cs_2 — no second refund
    expect(soldOut).toHaveBeenCalledTimes(2); // notify re-fires (best-effort), refund does not
  });

  it("residual-race loss with NO payment_intent → manual alert, no auto-refund/notify", async () => {
    const repo = await seededRepo();
    const { deps, alert, soldOut, payments } = makeDeps(repo);
    await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_1", "v-small")), FAKE_SIGNATURE); // booked
    // cs_2 loses but carries no PaymentIntent → nothing to auto-refund against.
    const noPi = { sessionId: "cs_2", amountTotalCents: 49900, currency: "usd", metadata: slotCompleted("cs_2", "v-small").metadata };
    const lost = await processBookingWebhook(deps, JSON.stringify(noPi), FAKE_SIGNATURE);
    expect(lost).toEqual({ handled: true, outcome: "lost" });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toContain("REFUND MANUALLY");
    expect(payments.refunds).toHaveLength(0);
    expect(soldOut).not.toHaveBeenCalled();
  });

  it("residual race + auto-refund THROWS → falls back to the manual-refund alert", async () => {
    const repo = await seededRepo();
    const payments = new FakePaymentPort();
    payments.refundError = new Error("stripe down");
    const { deps, alert, soldOut } = makeDeps(repo, payments);
    await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_1", "v-small")), FAKE_SIGNATURE); // booked
    const lost = await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_2", "v-small")), FAKE_SIGNATURE);
    expect(lost).toEqual({ handled: true, outcome: "lost" });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toContain("REFUND MANUALLY");
    expect(soldOut).not.toHaveBeenCalled(); // refund failed → no "you've been refunded" claim
  });

  it("both boats sell independently — no cross-slot interference", async () => {
    const repo = await seededRepo();
    const { deps } = makeDeps(repo);
    await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_1", "v-small")), FAKE_SIGNATURE);
    await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_2", "v-big")), FAKE_SIGNATURE);
    expect(await repo.getEvent(eventIdForSlot(SMALL, DATE, TIME))).not.toBeNull();
    expect(await repo.getEvent(eventIdForSlot(BIG, DATE, TIME))).not.toBeNull();
    expect(String(slotIdentity(SMALL, DATE, TIME))).not.toBe(String(slotIdentity(BIG, DATE, TIME)));
  });
});
