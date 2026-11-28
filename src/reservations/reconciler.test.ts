/**
 * The reconciler (issue #1236): the tick's one pass over timed-out public checkouts with a payment
 * started. Each is asked about once; a paid one is booked through the one confirm, a sold-out one is
 * refunded through it, and one Muster cannot get an answer for at 2 hours past its window is texted
 * to every admin.
 *
 * The list's own rule — which rows are timed out, public, unpaid-for and unchecked — is tested once,
 * in `src/adapters/repository-contract.ts`. Here the job is checked to use it: one row the list
 * returns and one it does not (AC4's booked row).
 *
 * "No answer" is made by rejecting the port's lookup, as `balance-charge.test.ts` does; an id the
 * provider answered for is one the fake minted.
 */
import { describe, expect, it, vi } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Event, Reservation } from "../domain/entities.js";
import { asId, type ReservationId } from "../domain/ids.js";
import { safeForAlert } from "./alert-text.js";
import { eventIdForSlot } from "./availability.js";
import { paymentIdFor, secondPaymentAlertText, type WebhookDeps } from "./booking-webhook.js";
import { confirmBookingByPaymentIntent } from "./confirm-booking.js";
import { PAYMENT_WINDOW_MINUTES } from "./pending.js";
import { reconcileLapsedCheckouts, uncheckedAlertText } from "./reconciler.js";
import { bookingPanePath } from "./refund-payment.js";

const V = asId<"VesselId">("v");
const DATE = "2026-07-04";
const TIME = "17:00";
const SLOT = eventIdForSlot(V, DATE, TIME);
const AMOUNT = 53625;

const iso = (ms: number) => new Date(ms).toISOString();
/** When the checkout was written, and when its payment window ran out. */
const RESERVED = "2026-07-01T12:00:00.000Z";
const WINDOW_END = Date.parse(RESERVED) + PAYMENT_WINDOW_MINUTES * 60_000;
const TWO_HOURS = 2 * 60 * 60_000;
/** Five minutes past the window: timed out, well short of the 2-hour text. */
const TIMED_OUT = iso(WINDOW_END + 5 * 60_000);
/** Exactly 2 hours past the window. */
const LATE = iso(WINDOW_END + TWO_HOURS);
const ABANDONMENT = "/admin/abandonment";

const checkout = (id: string, paymentIntentIds: string[], over: Partial<Reservation> = {}): Reservation => ({
  id: asId<"ReservationId">(id),
  eventId: null,
  source: "muster",
  status: "pending",
  customerName: "Dana Reyes",
  partySize: 6,
  phone: "216-555-0148",
  email: "dana@x.io",
  vesselId: V,
  date: DATE,
  time: TIME,
  offeringId: asId<"OfferingId">("off-1"),
  reservedAt: RESERVED,
  holdMinutes: 120,
  tripMinutes: 100,
  paymentIntentIds,
  invoice: {
    fareCents: 50000,
    extrasCents: 0,
    taxCents: 3625,
    taxRateBps: 725,
    serviceFeeCents: 0,
    serviceFeeBps: 0,
    gratuityCents: 0,
    gratuityBps: 0,
    totalCents: AMOUNT,
    amountDueNowCents: AMOUNT,
  },
  ...over,
});

const musterEvent = (over: Partial<Event> = {}): Event => ({
  id: SLOT,
  vesselId: V,
  date: DATE,
  time: TIME,
  capacity: 12,
  status: "scheduled",
  source: "muster",
  price: 50000,
  ...over,
});

async function world() {
  const repo = new InMemoryRepository();
  // Manned: a boat with no required crew is an error, and a booking forms its shift.
  await repo.saveVessel({
    id: V,
    name: "Brew",
    coiMaxPax: 12,
    manning: [{ roleTypeId: asId<"RoleTypeId">("role-captain"), count: 1 }],
  });
  const payments = new FakePaymentPort();
  let clock = TIMED_OUT;
  const alert = vi.fn(async (_message: string, _href?: string) => {});
  const confirm = vi.fn(async (_reservation: Reservation) => true);
  const soldOut = vi.fn(async (_charge: unknown) => {});
  const deps: WebhookDeps = {
    repo,
    payments,
    now: () => clock,
    alertPaidButUnbooked: alert,
    sendConfirmation: confirm,
    notifyCustomerSoldOut: soldOut,
  };
  const answer = payments.readPaymentIntentSucceeded.bind(payments);
  const lookups = vi.spyOn(payments, "readPaymentIntentSucceeded");

  /** An intent the provider knows about — unpaid until `paid` says otherwise. */
  const mint = async (key: string): Promise<string> =>
    (await payments.createPaymentIntent({ amountCents: AMOUNT, currency: "usd", idempotencyKey: key, metadata: {} })).paymentIntentId;
  const paid = (id: string) =>
    payments.succeededIntents.set(id, { paymentIntentId: id, amountReceivedCents: AMOUNT, currency: "usd", metadata: {} });
  /** The provider gives no answer for these ids; every other id is answered as usual. */
  const noAnswerFor = (...ids: string[]) =>
    lookups.mockImplementation(async (id) => {
      if (ids.includes(id)) throw new Error(`Stripe did not answer for ${id}`);
      return answer(id);
    });
  /** The confirm throws for these ids: the row's read by payment id fails inside it. */
  const confirmThrowsFor = (...ids: string[]) => {
    const read = repo.getReservationByPaymentIntentId.bind(repo);
    vi.spyOn(repo, "getReservationByPaymentIntentId").mockImplementation(async (id) => {
      if (ids.includes(id)) throw new Error(`database unreachable reading ${id}`);
      return read(id);
    });
  };
  const row = async (id: string) => (await repo.getReservation(asId<"ReservationId">(id)))!;
  const run = () => reconcileLapsedCheckouts(deps);
  return {
    repo,
    payments,
    deps,
    alert,
    confirm,
    soldOut,
    lookups,
    mint,
    paid,
    noAnswerFor,
    confirmThrowsFor,
    row,
    run,
    setNow: (t: string) => {
      clock = t;
    },
  };
}

const bookedTrail = async (repo: InMemoryRepository, id: ReservationId) =>
  (await repo.listTrailEvents()).filter((e) => e.type === "booked" && String(e.reservationId) === String(id));

const lookedUp = (lookups: { mock: { calls: unknown[][] } }) => lookups.mock.calls.map((c) => c[0]);

describe("reconcileLapsedCheckouts — nothing paid, or no answer (issue #1236, AC1)", () => {
  it("AC1: a checkout nothing was paid on is asked about once per id, marked checked, and not asked about again", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    const b = await w.mint("k-b");
    await w.repo.saveReservation(checkout("r1", [a, b]));

    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 1, alerted: 0, errors: 0 });
    expect(lookedUp(w.lookups)).toHaveLength(2);
    expect(new Set(lookedUp(w.lookups))).toEqual(new Set([a, b]));
    expect((await w.row("r1")).paymentCheckedAt).toBe(TIMED_OUT);
    expect((await w.row("r1")).status).toBe("pending");

    w.lookups.mockClear();
    w.setNow(LATE);
    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 0, alerted: 0, errors: 0 });
    expect(w.lookups).not.toHaveBeenCalled();
    expect(w.alert).not.toHaveBeenCalled();
  });

  it("AC1: one id with no answer leaves the row unmarked and nothing on it confirmed, and the next run asks again", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    const b = await w.mint("k-b");
    // The first id paid; the second gets no answer. Every id is looked up before anything is confirmed.
    w.paid(a);
    w.noAnswerFor(b);
    await w.repo.saveReservation(checkout("r1", [a, b]));

    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 0, alerted: 0, errors: 1 });
    const after = await w.row("r1");
    expect(after.status).toBe("pending");
    expect(after.paymentCheckedAt).toBeUndefined();
    expect(await bookedTrail(w.repo, after.id)).toHaveLength(0);
    expect(await w.repo.listPaymentsForReservation(after.id)).toHaveLength(0);
    expect(w.confirm).not.toHaveBeenCalled();

    w.lookups.mockClear();
    w.setNow(iso(WINDOW_END + 20 * 60_000));
    await w.run();
    expect(lookedUp(w.lookups)).toContain(b);
  });

  it("AC1: a row whose lookup gets no answer is counted, and the rows after it are still handled", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    const b = await w.mint("k-b");
    w.noAnswerFor(a);
    // Reserved first, so it is reached first.
    await w.repo.saveReservation(checkout("r-first", [a], { reservedAt: iso(Date.parse(RESERVED) - 10 * 60_000) }));
    await w.repo.saveReservation(checkout("r-second", [b]));

    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 1, alerted: 0, errors: 1 });
    expect((await w.row("r-first")).paymentCheckedAt).toBeUndefined();
    expect((await w.row("r-second")).paymentCheckedAt).toBe(TIMED_OUT);
  });

  it("AC1: a row whose confirm throws is counted, stays unmarked, and the rows after it are still handled", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    const b = await w.mint("k-b");
    w.paid(a);
    w.confirmThrowsFor(a);
    await w.repo.saveReservation(checkout("r-first", [a], { reservedAt: iso(Date.parse(RESERVED) - 10 * 60_000) }));
    await w.repo.saveReservation(checkout("r-second", [b]));

    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 1, alerted: 0, errors: 1 });
    expect((await w.row("r-first")).paymentCheckedAt).toBeUndefined();
    expect((await w.row("r-first")).status).toBe("pending");
    expect((await w.row("r-second")).paymentCheckedAt).toBe(TIMED_OUT);
  });

  it("AC1: a row whose mark throws is counted in errors, not in nothingPaid", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    await w.repo.saveReservation(checkout("r1", [a]));
    vi.spyOn(w.repo, "markPaymentChecked").mockRejectedValue(new Error("database unreachable"));

    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 0, alerted: 0, errors: 1 });
  });
});

describe("reconcileLapsedCheckouts — paid, so booked (issue #1236, AC2)", () => {
  it("AC2: a paid checkout is booked via the reconciler, with one payment, one confirmation, and the row marked", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    w.paid(a);
    await w.repo.saveReservation(checkout("r1", [a]));

    expect(await w.run()).toEqual({ confirmed: 1, nothingPaid: 0, alerted: 0, errors: 0 });
    const after = await w.row("r1");
    expect(after.status).toBe("booked");
    expect(after.paymentCheckedAt).toBe(TIMED_OUT);
    const trail = await bookedTrail(w.repo, after.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.metadata.via).toBe("reconciler");
    expect(await w.repo.listPaymentsForReservation(after.id)).toHaveLength(1);
    expect(w.confirm).toHaveBeenCalledOnce();
    expect(String(w.confirm.mock.calls[0]![0].id)).toBe("r1");
  });

  it("AC2: a second run after the booking changes no row and sends nothing", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    w.paid(a);
    await w.repo.saveReservation(checkout("r1", [a]));
    await w.run();
    const rows = await w.repo.listAllReservations();
    const trail = await w.repo.listTrailEvents();
    const ledger = await w.repo.listPaymentsForReservation(asId<"ReservationId">("r1"));
    w.lookups.mockClear();

    w.setNow(iso(WINDOW_END + 20 * 60_000));
    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 0, alerted: 0, errors: 0 });

    expect(w.lookups).not.toHaveBeenCalled();
    expect(await w.repo.listAllReservations()).toEqual(rows);
    expect(await w.repo.listTrailEvents()).toEqual(trail);
    expect(await w.repo.listPaymentsForReservation(asId<"ReservationId">("r1"))).toEqual(ledger);
    expect(w.confirm).toHaveBeenCalledOnce();
    expect(w.alert).not.toHaveBeenCalled();
    expect(w.soldOut).not.toHaveBeenCalled();
  });

  it("AC2: every id the provider says succeeded goes through the confirm, oldest first, and the row counts once", async () => {
    const w = await world();
    const unpaid = await w.mint("k-a");
    const first = await w.mint("k-b");
    const second = await w.mint("k-c");
    w.paid(first);
    w.paid(second);
    await w.repo.saveReservation(checkout("r1", [unpaid, first, second]));

    expect(await w.run()).toEqual({ confirmed: 1, nothingPaid: 0, alerted: 1, errors: 0 });
    const after = await w.row("r1");
    // The second paid id is a second payment on the booking the first one made (issue #1279 AC8):
    // every admin is texted once, with the booking's link.
    expect(w.alert).toHaveBeenCalledExactlyOnceWith(secondPaymentAlertText(after, AMOUNT), bookingPanePath(after.id));
    // The oldest succeeded id is the one that flipped the row.
    const trail = await bookedTrail(w.repo, after.id);
    expect(trail).toHaveLength(1);
    expect(String(trail[0]!.paymentIntentId)).toBe(first);
    // Both succeeded ids reached the confirm: each left its payment on the ledger.
    const ledger = (await w.repo.listPaymentsForReservation(after.id)).map((p) => String(p.id)).sort();
    expect(ledger).toEqual([String(paymentIdFor(first)), String(paymentIdFor(second))].sort());
    expect(after.paymentCheckedAt).toBe(TIMED_OUT);
  });

  it("AC2: a row whose later confirm throws is counted in errors only and stays unmarked, though its first confirm booked", async () => {
    const w = await world();
    const first = await w.mint("k-a");
    const second = await w.mint("k-b");
    w.paid(first);
    w.paid(second);
    w.confirmThrowsFor(second);
    await w.repo.saveReservation(checkout("r1", [first, second]));

    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 0, alerted: 0, errors: 1 });
    const after = await w.row("r1");
    expect(after.status).toBe("booked");
    expect(after.paymentCheckedAt).toBeUndefined();
  });
});

describe("reconcileLapsedCheckouts — paid, but the boat was sold meanwhile (issue #1236, AC3)", () => {
  async function soldOutWorld() {
    const w = await world();
    const a = await w.mint("k-a");
    w.paid(a);
    await w.repo.saveReservation(checkout("r1", [a]));
    // Another booking holds the slot.
    await w.repo.saveEvent(musterEvent());
    await w.repo.saveReservation({
      id: asId<"ReservationId">("r-rival"),
      eventId: SLOT,
      source: "muster",
      customerName: "Rival",
      partySize: 4,
      status: "booked",
    });
    return { ...w, a };
  }

  it("AC3: the customer is refunded in full through one sold-out record and told once, and the row is marked", async () => {
    const w = await soldOutWorld();

    const counts = await w.run();

    const records = await w.repo.listRefundRecordsFor(asId<"ReservationId">("r1"));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ reason: "sold_out", state: "whole", askedCents: AMOUNT });
    expect(w.payments.refunds).toHaveLength(1);
    expect(w.payments.refunds[0]).toMatchObject({ paymentIntentId: w.a, amountCents: AMOUNT });
    expect(w.soldOut).toHaveBeenCalledOnce();
    const after = await w.row("r1");
    expect(after.status).not.toBe("booked");
    expect(after.paymentCheckedAt).toBe(TIMED_OUT);
    // In neither `confirmed` nor `nothingPaid`; the confirm's own admin text shows in `alerted`.
    expect(w.alert.mock.calls.length).toBeGreaterThan(0);
    expect(counts).toEqual({ confirmed: 0, nothingPaid: 0, alerted: w.alert.mock.calls.length, errors: 0 });
  });

  it("AC3: a second run makes no provider call, creates no record and sends no notice", async () => {
    const w = await soldOutWorld();
    await w.run();
    const alerts = w.alert.mock.calls.length;
    w.lookups.mockClear();

    w.setNow(iso(WINDOW_END + 20 * 60_000));
    await w.run();

    expect(w.lookups).not.toHaveBeenCalled();
    expect(await w.repo.listRefundRecordsFor(asId<"ReservationId">("r1"))).toHaveLength(1);
    expect(w.payments.refunds).toHaveLength(1);
    expect(w.soldOut).toHaveBeenCalledOnce();
    expect(w.alert.mock.calls.length).toBe(alerts);
  });
});

describe("reconcileLapsedCheckouts — already booked (issue #1236, AC4)", () => {
  it("AC4: a checkout the success page already booked is never asked about and nothing on it is written", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    w.paid(a);
    await w.repo.saveReservation(checkout("r-booked", [a]));
    // Booked by the page after paying, inside its window.
    w.setNow(iso(Date.parse(RESERVED) + 60_000));
    await confirmBookingByPaymentIntent(w.deps, a);
    // And one timed-out checkout the list does return.
    const b = await w.mint("k-b");
    await w.repo.saveReservation(checkout("r-open", [b]));

    const booked = await w.row("r-booked");
    expect(booked.status).toBe("booked");
    const trail = await w.repo.listTrailEvents();
    const ledger = await w.repo.listPaymentsForReservation(booked.id);
    w.confirm.mockClear();

    w.setNow(TIMED_OUT);
    await w.run();

    expect(lookedUp(w.lookups)).toEqual([b]);
    expect(await w.row("r-booked")).toEqual(booked);
    expect((await w.repo.listTrailEvents()).filter((e) => String(e.reservationId) === "r-booked")).toEqual(
      trail.filter((e) => String(e.reservationId) === "r-booked"),
    );
    expect(await w.repo.listPaymentsForReservation(booked.id)).toEqual(ledger);
    expect(w.confirm).not.toHaveBeenCalled();
  });
});

describe("reconcileLapsedCheckouts — no answer for 2 hours (issue #1236, AC5)", () => {
  it("AC5: at 2 hours past the window, with every provider call failing, every admin gets one text naming the customer, linked to the abandoned checkouts, and the row is marked", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    const b = await w.mint("k-b");
    w.noAnswerFor(a, b);
    await w.repo.saveReservation(checkout("r1", [a, b]));
    const before = await w.row("r1");
    w.setNow(LATE);

    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 0, alerted: 1, errors: 0 });
    expect(w.alert).toHaveBeenCalledExactlyOnceWith(uncheckedAlertText(before), ABANDONMENT);
    expect((await w.row("r1")).paymentCheckedAt).toBe(LATE);
  });

  it("AC5: after the text and the mark, a later run sends no text and makes no provider call", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    w.noAnswerFor(a);
    await w.repo.saveReservation(checkout("r1", [a]));
    w.setNow(LATE);
    await w.run();
    expect(w.alert).toHaveBeenCalledOnce();
    w.alert.mockClear();
    w.lookups.mockClear();

    w.setNow(iso(Date.parse(LATE) + 15 * 60_000));
    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 0, alerted: 0, errors: 0 });
    expect(w.alert).not.toHaveBeenCalled();
    expect(w.lookups).not.toHaveBeenCalled();
  });

  it("AC5: a millisecond short of 2 hours, no answer sends no text and leaves the row unmarked", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    w.noAnswerFor(a);
    await w.repo.saveReservation(checkout("r1", [a]));
    w.setNow(iso(Date.parse(LATE) - 1));

    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 0, alerted: 0, errors: 1 });
    expect(w.alert).not.toHaveBeenCalled();
    expect((await w.row("r1")).paymentCheckedAt).toBeUndefined();
  });

  it("AC5: at 2 hours past, a confirm that throws is no answer too — the text goes and the row is marked", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    w.paid(a);
    w.confirmThrowsFor(a);
    await w.repo.saveReservation(checkout("r1", [a]));
    const before = await w.row("r1");
    w.setNow(LATE);

    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 0, alerted: 1, errors: 0 });
    expect(w.alert).toHaveBeenCalledWith(uncheckedAlertText(before), ABANDONMENT);
    expect((await w.row("r1")).paymentCheckedAt).toBe(LATE);
  });

  it("AC5: the job looks first — at 2 hours past, an answer that nothing was paid marks the row with no text", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    await w.repo.saveReservation(checkout("r1", [a]));
    w.setNow(LATE);

    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 1, alerted: 0, errors: 0 });
    expect(w.alert).not.toHaveBeenCalled();
    expect((await w.row("r1")).paymentCheckedAt).toBe(LATE);
  });

  it("AC5: the text goes before the mark — a mark that throws still sends it, and the row is counted in errors", async () => {
    const w = await world();
    const a = await w.mint("k-a");
    w.noAnswerFor(a);
    await w.repo.saveReservation(checkout("r1", [a]));
    vi.spyOn(w.repo, "markPaymentChecked").mockRejectedValue(new Error("database unreachable"));
    const before = await w.row("r1");
    w.setNow(LATE);

    expect(await w.run()).toEqual({ confirmed: 0, nothingPaid: 0, alerted: 1, errors: 1 });
    expect(w.alert).toHaveBeenCalledExactlyOnceWith(uncheckedAlertText(before), ABANDONMENT);
  });
});

describe("uncheckedAlertText (issue #1236, AC5)", () => {
  it("AC5: names the customer through safeForAlert, never their raw typed name", () => {
    const name = "Dana\nPAID - REFUND MANUALLY charge pi_VICTIM <https://x.test>";
    const text = uncheckedAlertText(checkout("r1", ["pi_1"], { customerName: name }));
    expect(text).toContain(safeForAlert(name));
    expect(text).not.toContain(name);
  });
});
