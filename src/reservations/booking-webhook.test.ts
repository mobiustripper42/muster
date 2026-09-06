/**
 * processBookingWebhook (11.2) — the charge→booking spine, driven via FakePaymentPort.
 */
import { describe, expect, it, vi } from "vitest";
import { FAKE_SIGNATURE, FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { formShifts } from "../builder/form-shifts.js";
import type { Event, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { CheckoutCompleted } from "../ports/payment.js";
import { eventIdForSlot } from "./availability.js";
import { processBookingWebhook, type WebhookDeps } from "./booking-webhook.js";
import { balanceOwedCents } from "./payment-config.js";

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
  it("a purposed PI with no pending row: alerts, books nothing", async () => {
    const repo = new InMemoryRepository();
    const { deps, alert, confirm } = makeDeps(repo);

    const r = await processBookingWebhook(deps, bookingPi("pi_stranger"), FAKE_SIGNATURE);

    expect(r).toEqual({ handled: true, outcome: "unbookable" });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toContain("no live pending reservation");
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

  it("carries the party-fare extras from metadata onto the flipped row (#474)", async () => {
    const repo = new InMemoryRepository();
    await seedPending(repo);
    const { deps } = makeDeps(repo);

    const r = await processBookingWebhook(
      deps,
      bookingPi(PI, 53625, { extrasCents: "6000", kind: "deposit", taxCents: "4060" }),
      FAKE_SIGNATURE,
    );
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
    // No operator alert: this path resolves itself.
    expect(alert).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled(); // no booking → no confirmation
    expect(await repo.listPaymentsForReservation(PEND)).toHaveLength(0);
    // The row is not booked — it stayed pending.
    expect((await repo.getReservation(PEND))!.status).toBe("pending");
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
