/**
 * processBookingWebhook (11.2) — the charge→booking spine, driven via FakePaymentPort.
 */
import { describe, expect, it, vi } from "vitest";
import { FAKE_SIGNATURE, FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Event } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { CheckoutCompleted } from "../ports/payment.js";
import { processBookingWebhook, type WebhookDeps } from "./booking-webhook.js";
import { reservationIdFor } from "./write-booking.js";

const EVENT = asId<"EventId">("m-evt-1");
const NOW = () => "2026-07-12T00:00:00.000Z";

const musterEvent = (over: Partial<Event> = {}): Event => ({
  id: EVENT,
  vesselId: asId<"VesselId">("v"),
  date: "2026-07-04",
  time: "17:00",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  price: 50000,
  ...over,
});

const completed = (over: Partial<CheckoutCompleted> = {}): CheckoutCompleted => ({
  sessionId: "cs_test_1",
  paymentIntentId: "pi_1",
  amountTotalCents: 53625,
  currency: "usd",
  metadata: {
    eventId: "m-evt-1",
    partySize: "6",
    kind: "full",
    taxCents: "3625",
    customerName: "Mary",
    email: "m@x.io",
  },
  ...over,
});

function makeDeps(repo: InMemoryRepository) {
  const alert = vi.fn(async (_message: string) => {});
  const deps: WebhookDeps = {
    repo,
    payments: new FakePaymentPort(),
    now: NOW,
    alertPaidButUnbooked: alert,
  };
  return { deps, alert };
}

describe("processBookingWebhook", () => {
  it("booked: writes the reservation + records the payment", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    const { deps, alert } = makeDeps(repo);

    const r = await processBookingWebhook(deps, JSON.stringify(completed()), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "booked" });

    const resId = reservationIdFor("cs_test_1");
    expect(await repo.getReservation(resId)).not.toBeNull();
    const payments = await repo.listPaymentsForReservation(resId);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      amountCents: 53625,
      taxCents: 3625,
      kind: "full",
      status: "succeeded",
      stripeCheckoutSessionId: "cs_test_1",
      stripePaymentIntentId: "pi_1",
    });
    expect(alert).not.toHaveBeenCalled();
  });

  it("already: a re-delivered webhook (same session) is idempotent — no duplicate booking or payment", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    const { deps } = makeDeps(repo);

    await processBookingWebhook(deps, JSON.stringify(completed()), FAKE_SIGNATURE);
    const r = await processBookingWebhook(deps, JSON.stringify(completed()), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "already" });

    expect(await repo.listReservationsForEvent(EVENT)).toHaveLength(1);
    expect(
      await repo.listPaymentsForReservation(reservationIdFor("cs_test_1")),
    ).toHaveLength(1);
  });

  it("paid-but-unbooked (rival holds the boat): records the payment + alerts admins to refund manually", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    await repo.saveReservation({
      id: asId<"ReservationId">("r-rival"),
      eventId: EVENT,
      source: "muster",
      customerName: "Rival",
      partySize: 4,
      status: "booked",
    });
    const { deps, alert } = makeDeps(repo);

    const r = await processBookingWebhook(deps, JSON.stringify(completed()), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "unbookable" });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toContain("REFUND MANUALLY");
    // the money moved, so the payment is still recorded (for the audit trail)
    expect(
      await repo.listPaymentsForReservation(reservationIdFor("cs_test_1")),
    ).toHaveLength(1);
  });

  it("paid-but-unbooked (event missing): records payment + alerts admins", async () => {
    const repo = new InMemoryRepository(); // no event
    const { deps, alert } = makeDeps(repo);
    const r = await processBookingWebhook(deps, JSON.stringify(completed()), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "unbookable" });
    expect(alert).toHaveBeenCalledOnce();
  });

  it("handled:false for a non-checkout event; throws on a bad signature", async () => {
    const repo = new InMemoryRepository();
    const { deps } = makeDeps(repo);
    expect(await processBookingWebhook(deps, "null", FAKE_SIGNATURE)).toEqual({ handled: false });
    await expect(
      processBookingWebhook(deps, JSON.stringify(completed()), "wrong-sig"),
    ).rejects.toThrow();
  });
});
