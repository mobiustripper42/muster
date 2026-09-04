/**
 * processBookingWebhook (11.2) — the charge→booking spine, driven via FakePaymentPort.
 */
import { describe, expect, it, vi } from "vitest";
import { FAKE_SIGNATURE, FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { formShifts } from "../builder/form-shifts.js";
import type { Event } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { CheckoutCompleted } from "../ports/payment.js";
import { processBookingWebhook, type WebhookDeps } from "./booking-webhook.js";
import { balanceOwedCents } from "./payment-config.js";
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
  // Slot-shaped, because that is the only booking shape the webhook accepts since #693 retired
  // the legacy `eventId` path. The one test that still needs the old shape overrides it and
  // asserts the refusal.
  metadata: {
    offeringId: "off-1",
    vesselId: "v",
    date: "2026-07-04",
    time: "17:00",
    guestCount: "6",
    priceCents: "50000",
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

  /**
   * The legacy 11.2 booking path is RETIRED (issue #693). A session whose metadata carries an
   * `eventId` instead of a slot must alert and book nothing.
   *
   * Why retire rather than guard it: #615/#691 put the hull-overlap guard and the hull-day
   * advisory lock on `saveBookingIfSlotFree`; `saveReservationIfUnclaimed` never got them, so
   * this branch still claimed by row-locking one `event_id` — exactly the pre-#691 behaviour
   * where two overlapping trips on one boat both succeed. Nothing mints legacy metadata
   * (`createBookingCheckout` had no caller under `app/`), so it was an UNGUARDED FALLBACK rather
   * than a removed one, sitting on the money path.
   *
   * Money has already moved by the time this runs, so the refusal is loud — same posture as the
   * flag-off branch above it, and as every other paid-but-unbooked outcome (#613).
   */
  it("refuses a legacy eventId-shaped session: alerts, books nothing (#693)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    const { deps, alert, confirm } = makeDeps(repo);

    const legacy = completed({
      metadata: { eventId: "m-evt-1", partySize: "6", kind: "full", taxCents: "3625", customerName: "Mary" },
    });
    const r = await processBookingWebhook(deps, JSON.stringify(legacy), FAKE_SIGNATURE);

    expect(r).toEqual({ handled: true, outcome: "unbookable" });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toContain("REFUND MANUALLY");
    expect(confirm).not.toHaveBeenCalled();
    // The point of the ticket: no reservation, on a path that used to write one without the
    // hull guard. An assertion on the alert alone would pass if it booked AND alerted.
    expect(await repo.getReservation(reservationIdFor("cs_test_1"))).toBeNull();
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
  /**
   * Retitled and re-asserted at #693, and the outcome is BETTER than what this test used to pin.
   *
   * It was written against the retired legacy path, where losing the boat produced `unbookable`
   * and a "REFUND MANUALLY" alert — a human chasing a refund for a customer who had already
   * paid. The slot path reports the same situation as `lost` and handles it: keyed auto-refund
   * plus a sold-out notice to the customer, with no operator in the loop. Asserting the old
   * shape here would have pinned the worse behaviour of a path that no longer exists.
   *
   * What is unchanged, and is the part #613 cares about: no reservation was written, so no
   * payment row may exist to hang off one.
   */
  it("loses the boat to a rival: auto-refunds, tells the customer, writes NO payment", async () => {
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
    const payments = new FakePaymentPort();
    const { deps, alert, confirm, soldOut } = makeDeps(repo, payments);

    const r = await processBookingWebhook(deps, JSON.stringify(completed()), FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "lost" });
    // Refunded once, keyed on the charge so a redelivery cannot double-refund (DEC-107 amended).
    expect(payments.refunds).toHaveLength(1);
    expect(payments.refunds[0]!.idempotencyKey).toBe("refund_cs_test_1");
    expect(soldOut).toHaveBeenCalledOnce();
    // No operator alert: this path resolves itself. An alert here would be the old behaviour.
    expect(alert).not.toHaveBeenCalled();
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

  // DELETED at #693: "paid-but-unbooked (event missing)".
  //
  // Its scenario is unreachable on the surviving path — a slot booking MATERIALIZES its event
  // (`writeSlotBooking`), so "no event exists" is not a failure any more; it is Tuesday. The
  // test only had a missing-event case because the retired legacy path took an `eventId` and
  // required the row to already be there.
  //
  // Its stated value was being the SECOND independent check that `recordPayment` never runs on a
  // non-booked outcome (#613) — so that hoisting it back above the outcome branch could not pass
  // unnoticed, the in-memory repo having no FK to catch it (DEC-131). That check is not lost:
  // the rival-holds-the-boat test above asserts the same empty-payments contract on a `lost`
  // outcome, and the #693 refusal test asserts no reservation on an `unbookable` one. Two
  // independent non-booked outcomes still cover it, which is what the comment actually wanted.

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
    return repo;
  }

  const slotCharge = () =>
    completed({
      sessionId: "cs_slot_614",
      metadata: {
        offeringId: String(OFF),
        vesselId: String(VES),
        date: "2026-07-04",
        time: "17:00",
        guestCount: "6",
        priceCents: "49900",
        kind: "full",
        customerName: "Mary",
        email: "m@x.io",
      },
    });

  it("books a slot and lands a Shift with derived seats — no Xola pull anywhere", async () => {
    const repo = await slotWorld();
    const { deps } = makeDeps(repo);

    const r = await processBookingWebhook(deps, JSON.stringify(slotCharge()), FAKE_SIGNATURE);
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

    await processBookingWebhook(deps, JSON.stringify(slotCharge()), FAKE_SIGNATURE);

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
    await formShifts(repo);
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
    await processBookingWebhook(deps, JSON.stringify(slotCharge()), FAKE_SIGNATURE);

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

    await processBookingWebhook(deps, JSON.stringify(slotCharge()), FAKE_SIGNATURE);

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

    const r = await processBookingWebhook(deps, JSON.stringify(slotCharge()), FAKE_SIGNATURE);

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

    const r = await processBookingWebhook(deps, JSON.stringify(slotCharge()), FAKE_SIGNATURE);

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
