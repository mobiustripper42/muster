/**
 * Gratuity collect (12.3a, DEC-124) — checkout validation, the pre-gratuity webhook record,
 * the post-trip gratuity flow, and the balance net-out. Driven against the in-memory repo +
 * FakePaymentPort.
 */
import { describe, expect, it, vi } from "vitest";
import { FAKE_SIGNATURE, FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { CheckoutCompleted } from "../ports/payment.js";
import { processBookingWebhook, type WebhookDeps } from "./booking-webhook.js";
import { createDepartureCheckout } from "./create-departure-checkout.js";
import { createGratuityCheckout } from "./create-gratuity-checkout.js";
import { eventIdForSlot } from "./availability.js";
import { balanceOwedCents } from "./payment-config.js";
import { reservationIdFor } from "./write-booking.js";

const OFF = asId<"OfferingId">("off-1");
const BOAT = asId<"VesselId">("v-1");
const DATE = "2026-07-04"; // Saturday
const TIME = "13:30";
const NOW = "2026-07-04T12:00:00.000Z";
const now = () => NOW;
const URLS = { successUrl: "https://x/s", cancelUrl: "https://x/c" };

const vessel = (): Vessel => ({ id: BOAT, name: "Brew", coiMaxPax: 16, includedGuestCount: 12, manning: [] });
const offering = (over: Partial<Offering> = {}): Offering => ({
  id: OFF, tenantId: asId<"TenantId">("t"), name: "Cruise", status: "live",
  vesselIds: [BOAT], locationId: asId<"LocationId">("loc-1"),
  schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: [TIME] },
  basePriceCents: 49900, priceVariations: [], extraGuestPriceCents: 4000, ...over,
});

async function seededRepo(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveOffering(offering());
  await repo.saveVessel(vessel());
  await repo.markVesselDayMusterOwned(BOAT, DATE, NOW);
  await repo.setPaymentConfig({ depositMode: "full", taxRateBps: 0 }, NOW);
  return repo;
}

const req = (gratuityBps: number) => ({
  offeringId: OFF, date: DATE, time: TIME, guestCount: 12, gratuityBps,
  customerName: "Mary", email: "m@x.io",
  waiverConsentAt: "2026-07-13T12:00:00.000Z", waiverVersion: "v1",
});

function slotCompleted(sessionId: string, extraMeta: Record<string, string> = {}): CheckoutCompleted {
  return {
    sessionId, paymentIntentId: `pi_${sessionId}`, amountTotalCents: 59880, currency: "usd",
    metadata: {
      purpose: "booking", offeringId: "off-1", vesselId: "v-1", date: DATE, time: TIME,
      guestCount: "12", priceCents: "49900", extrasCents: "0", kind: "full", taxCents: "0",
      gratuityCents: "9980", gratuityBps: "2000",
      customerName: "Mary", email: "m@x.io",
      waiverConsentAt: "2026-07-13T12:00:00.000Z", waiverVersion: "v1",
      ...extraMeta,
    },
  };
}

function makeDeps(repo: InMemoryRepository) {
  const alert = vi.fn(async (_m: string) => {});
  const deps: WebhookDeps = {
    repo, payments: new FakePaymentPort(), now,
    alertPaidButUnbooked: alert,
    sendConfirmation: vi.fn(async () => {}),
    notifyCustomerSoldOut: vi.fn(async () => {}),
  };
  return { deps, alert };
}

describe("gratuity is required, no decline (DEC-124)", () => {
  it("rejects a tier the offering doesn't offer, before parking a hold", async () => {
    const repo = await seededRepo();
    const r = await createDepartureCheckout(repo, new FakePaymentPort(), req(1234), URLS, now);
    expect(r).toEqual({ ok: false, reason: "gratuity_required" });
    expect(await repo.listCheckoutHolds()).toHaveLength(0); // no hold parked
  });

  it("accepts a valid tier and carries the gratuity in metadata", async () => {
    const repo = await seededRepo();
    const pay = new FakePaymentPort();
    const r = await createDepartureCheckout(repo, pay, req(2500), URLS, now); // 25%
    expect(r.ok).toBe(true);
    // 25% of the 49900 fare = 12475
    expect(pay.created[0]!.metadata).toMatchObject({ gratuityCents: "12475", gratuityBps: "2500" });
  });

  it("deposit mode: the tip is charged in FULL; only the fare is deposit-split", async () => {
    const repo = await seededRepo();
    await repo.setPaymentConfig({ depositMode: "deposit", depositPercent: 25, taxRateBps: 0 }, NOW);
    const pay = new FakePaymentPort();
    await createDepartureCheckout(repo, pay, req(2000), URLS, now); // fare 49900, 20% tip
    // deposit 25% of 49900 = 12475 (fare only); gratuity 9980 charged in full, NOT split
    expect(pay.created[0]!.amountCents).toBe(22455); // 12475 + 9980
    expect(pay.created[0]!.metadata).toMatchObject({ gratuityCents: "9980", kind: "deposit" });
  });
});

describe("pre-gratuity is recorded on booking (DEC-124)", () => {
  it("writes a Gratuity{pre} keyed to the event + sets Payment.gratuityCents", async () => {
    const repo = await seededRepo();
    const { deps } = makeDeps(repo);
    const r = await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_1")), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "booked" });

    const evId = eventIdForSlot(BOAT, DATE, TIME);
    const grats = await repo.listGratuitiesForEvent(evId);
    expect(grats).toHaveLength(1);
    expect(grats[0]).toMatchObject({ kind: "pre", amountCents: 9980, bps: 2000, eventId: evId });
    // the payment carves out the gratuity so balance math can net it
    const pay = await repo.getPayment(asId<"PaymentId">("pay_cs_1"));
    expect(pay!.gratuityCents).toBe(9980);
  });

  it("a redelivered webhook does not double-record the gratuity (idempotent)", async () => {
    const repo = await seededRepo();
    const { deps } = makeDeps(repo);
    await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_1")), FAKE_SIGNATURE);
    await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_1")), FAKE_SIGNATURE); // redelivery → already
    expect(await repo.listAllGratuities()).toHaveLength(1);
  });
});

describe("post-trip gratuity (DEC-124)", () => {
  async function bookedRepo(): Promise<InMemoryRepository> {
    const repo = await seededRepo();
    const { deps } = makeDeps(repo);
    await processBookingWebhook(deps, JSON.stringify(slotCompleted("cs_1")), FAKE_SIGNATURE);
    return repo;
  }
  const resId = reservationIdFor("cs_1");

  it("createGratuityCheckout opens a tax-free gratuity session for a booked reservation", async () => {
    const repo = await bookedRepo();
    const pay = new FakePaymentPort();
    const r = await createGratuityCheckout(repo, pay, resId, 5000, URLS);
    expect(r.ok).toBe(true);
    expect(pay.created[0]).toMatchObject({ amountCents: 5000, taxCents: 0, metadata: { purpose: "gratuity" } });
  });

  it("rejects a non-positive amount and a missing/cancelled reservation", async () => {
    const repo = await bookedRepo();
    expect(await createGratuityCheckout(repo, new FakePaymentPort(), resId, 0, URLS)).toEqual({ ok: false, reason: "invalid_amount" });
    expect(await createGratuityCheckout(repo, new FakePaymentPort(), asId<"ReservationId">("nope"), 5000, URLS))
      .toEqual({ ok: false, reason: "reservation_missing" });
  });

  it("the webhook records Gratuity{post} and NO Payment (would trip the overpay alert)", async () => {
    const repo = await bookedRepo();
    const { deps } = makeDeps(repo);
    const evId = eventIdForSlot(BOAT, DATE, TIME);
    const before = (await repo.listPaymentsForReservation(resId)).length;

    const completed: CheckoutCompleted = {
      sessionId: "cs_grat", paymentIntentId: "pi_grat", amountTotalCents: 5000, currency: "usd",
      metadata: { purpose: "gratuity", reservationId: String(resId), taxCents: "0" },
    };
    const r = await processBookingWebhook(deps, JSON.stringify(completed), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "gratuity_paid" });

    const posts = (await repo.listGratuitiesForEvent(evId)).filter((g) => g.kind === "post");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.amountCents).toBe(5000);
    // NO new Payment row — gratuity-only
    expect(await repo.listPaymentsForReservation(resId)).toHaveLength(before);
  });

  it("post gratuity for a missing reservation is flagged for manual reconcile", async () => {
    const repo = await seededRepo();
    const { deps, alert } = makeDeps(repo);
    const completed: CheckoutCompleted = {
      sessionId: "cs_x", amountTotalCents: 5000, currency: "usd",
      metadata: { purpose: "gratuity", reservationId: "does-not-exist", taxCents: "0" },
    };
    const r = await processBookingWebhook(deps, JSON.stringify(completed), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "gratuity_paid" });
    expect(alert).toHaveBeenCalledOnce();
    expect(await repo.listAllGratuities()).toHaveLength(0);
  });
});

describe("balanceOwedCents nets gratuity out (DEC-124, 12.3)", () => {
  it("subtracts the gratuity portion from the paid sum", () => {
    // price 50000, tax 0; a $200 deposit that included $50 gratuity → net paid 15000 → owed 35000
    expect(balanceOwedCents(50000, 0, [{ status: "succeeded", amountCents: 20000, gratuityCents: 5000 }])).toBe(35000);
  });
  it("a payment with no gratuity field behaves as before", () => {
    expect(balanceOwedCents(50000, 0, [{ status: "succeeded", amountCents: 20000 }])).toBe(30000);
  });
});
