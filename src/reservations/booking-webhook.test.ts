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

function makeDeps(repo: InMemoryRepository, payments: FakePaymentPort = new FakePaymentPort()) {
  const alert = vi.fn(async (_message: string) => {});
  const confirm = vi.fn(async (_reservation: unknown) => {});
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
    await repo.saveEvent(musterEvent());
    const { deps, alert, confirm } = makeDeps(repo);

    const r = await processBookingWebhook(
      { ...deps, reservationsEnabled: false },
      JSON.stringify(completed()),
      FAKE_SIGNATURE,
    );

    // Acked, not errored: a non-2xx would make Stripe retry an event we never want.
    expect(r).toEqual({ handled: false });
    // Nothing written, nobody emailed.
    expect(await repo.getReservation(reservationIdFor("cs_test_1"))).toBeNull();
    expect(await repo.listPaymentsForReservation(reservationIdFor("cs_test_1"))).toHaveLength(0);
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
      processBookingWebhook({ ...deps, reservationsEnabled: false }, JSON.stringify(completed()), "bad_signature"),
    ).rejects.toThrow();
  });
});

describe("processBookingWebhook", () => {
  it("booked: writes the reservation + records the payment", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    const { deps, alert, confirm } = makeDeps(repo);

    const r = await processBookingWebhook(deps, JSON.stringify(completed()), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "booked" });

    const resId = reservationIdFor("cs_test_1");
    // Confirmation fires once, with the freshly-booked reservation (11.4, DEC-122).
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]![0]).toMatchObject({ id: resId, status: "booked" });
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
    const { deps, confirm } = makeDeps(repo);

    await processBookingWebhook(deps, JSON.stringify(completed()), FAKE_SIGNATURE);
    const r = await processBookingWebhook(deps, JSON.stringify(completed()), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "already" });

    expect(await repo.listReservationsForEvent(EVENT)).toHaveLength(1);
    expect(
      await repo.listPaymentsForReservation(reservationIdFor("cs_test_1")),
    ).toHaveLength(1);
    // The re-delivery resolves to `already` → NO second confirmation (DEC-122):
    // one send across both calls, or the customer is re-texted on every retry.
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("freezes the party-fare extras from slot metadata onto the reservation (#474)", async () => {
    const repo = new InMemoryRepository();
    const { deps } = makeDeps(repo);
    // A slot-first booking (vesselId+date+time+offeringId, no eventId → the webhook
    // materializes the Event) carrying extrasCents in metadata — must land on the reservation
    // so the deposit-mode balance deriver bills base + extras (DEC-107 amend).
    const slot = completed({
      metadata: {
        offeringId: "off-1",
        vesselId: "v",
        date: "2026-07-04",
        time: "17:00",
        guestCount: "6",
        priceCents: "50000",
        extrasCents: "6000",
        kind: "deposit",
        taxCents: "4060",
        customerName: "Mary",
      },
    });

    const r = await processBookingWebhook(deps, JSON.stringify(slot), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "booked" });
    const res = (await repo.getReservation(reservationIdFor("cs_test_1")))!;
    expect(res.extrasCents).toBe(6000);
  });

  it("carries waiver consent from checkout metadata onto the reservation (11.5, DEC-110)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    const { deps } = makeDeps(repo);
    const withWaiver = completed({
      metadata: { ...completed().metadata, waiverConsentAt: "2026-07-13T12:00:00.000Z", waiverVersion: "v1" },
    });

    await processBookingWebhook(deps, JSON.stringify(withWaiver), FAKE_SIGNATURE);
    const res = (await repo.getReservation(reservationIdFor("cs_test_1")))!;
    expect(res.waiverConsentAt).toBe("2026-07-13T12:00:00.000Z");
    expect(res.waiverVersion).toBe("v1");
  });

  // Retitled at #613. It used to claim "records the payment", and asserted a row that PRODUCTION
  // could never write: `payments.reservation_id` is `not null` with an immediate FK, and no
  // reservation exists on an unbookable outcome. It passed only because `InMemoryRepository` is a
  // `Map.set` with no referential integrity (DEC-131). The alert is the real contract here — and
  // it was unreachable, because the FK violation threw before it.
  it("paid-but-unbooked (rival holds the boat): alerts admins to refund manually, and writes NO payment", async () => {
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
    const { deps, alert, confirm } = makeDeps(repo);

    const r = await processBookingWebhook(deps, JSON.stringify(completed()), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "unbookable" });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toContain("REFUND MANUALLY");
    expect(confirm).not.toHaveBeenCalled(); // no booking → no confirmation
    // No payment row — there is no reservation to hang it on. Postgres enforces this; the
    // in-memory double does not, which is why the Postgres suite carries the real guard
    // (`postgres-repository.test.ts` → "paid-but-unbooked — the payments→reservations FK").
    expect(
      await repo.listPaymentsForReservation(reservationIdFor("cs_test_1")),
    ).toHaveLength(0);
  });

  it("a throwing sendConfirmation never breaks the committed booking (best-effort, DEC-122)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    const { deps } = makeDeps(repo);
    deps.sendConfirmation = async () => {
      throw new Error("confirmation blew up");
    };

    // The booking is committed; a confirmation throw must not 500 the webhook.
    const r = await processBookingWebhook(deps, JSON.stringify(completed()), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "booked" });
    expect(await repo.getReservation(reservationIdFor("cs_test_1"))).not.toBeNull();
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

  // Retitled at #613, same reason as the unbookable case above: "is recorded" described a row
  // Postgres refuses. The alert is the contract, and it sat behind the FK throw.
  it("a balance against a missing/cancelled reservation is NOT recorded, and is loudly flagged", async () => {
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
