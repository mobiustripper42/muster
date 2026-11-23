/**
 * Customer manage view model (12.6, #459) — the pure "Your booking" shaping: trip-phase flip,
 * post-trip gratuity tiers, trip timing. Money is delegated to `buildReservationDetail` (tested
 * in calendar-detail.test.ts), so these tests focus on the customer-facing extras.
 */
import { describe, expect, it } from "vitest";
import type { BookingInvoice, Event, Offering, Payment, Reservation, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import {
  buildManageView,
  tripPhaseOf,
  type ManageViewInput,
} from "./manage-view.js";

/** What `priceBooking` froze on the $549 trip at 7.25%, no tip and no fee: tax 3980 (3980.25). */
const FROZEN: BookingInvoice = {
  fareCents: 54900,
  extrasCents: 0,
  taxCents: 3980,
  taxRateBps: 725,
  serviceFeeCents: 0,
  serviceFeeBps: 0,
  gratuityCents: 0,
  gratuityBps: 0,
  totalCents: 58880,
  amountDueNowCents: 58880,
};

const RES: Reservation = {
  id: asId<"ReservationId">("resv-1"),
  eventId: asId<"EventId">("evt-1"),
  source: "muster",
  customerName: "Jordan Ellis",
  partySize: 10,
  status: "booked",
  invoice: FROZEN,
} as Reservation;

const EVENT: Event = {
  id: asId<"EventId">("evt-1"),
  source: "muster",
  vesselId: asId<"VesselId">("v1"),
  date: "2026-07-18",
  time: "13:30",
  capacity: 12,
  price: 54900,
  status: "scheduled",
} as Event;

const OFFERING = {
  id: asId<"OfferingId">("off-1"),
  name: "Brew Boat Party",
  tripLengthMinutes: 100,
  arriveBeforeMinutes: 15,
} as Offering;

const VESSEL: Vessel = { id: asId<"VesselId">("v1"), name: "Brew 3", coiMaxPax: 12 } as Vessel;

function input(over: Partial<ManageViewInput> = {}): ManageViewInput {
  return {
    reservation: RES,
    event: EVENT,
    offering: OFFERING,
    vessel: VESSEL,
    payments: [],
    gratuities: [],
    now: { date: "2026-07-10", time: "09:00" },
    ...over,
  };
}

describe("tripPhaseOf", () => {
  it("is upcoming before the trip day and completed after", () => {
    expect(tripPhaseOf("2026-07-18", "13:30", { date: "2026-07-10", time: "09:00" })).toBe("upcoming");
    expect(tripPhaseOf("2026-07-18", "13:30", { date: "2026-07-20", time: "09:00" })).toBe("completed");
  });
  it("flips at the departure time on the trip day", () => {
    expect(tripPhaseOf("2026-07-18", "13:30", { date: "2026-07-18", time: "13:29" })).toBe("upcoming");
    expect(tripPhaseOf("2026-07-18", "13:30", { date: "2026-07-18", time: "13:30" })).toBe("completed");
    expect(tripPhaseOf("2026-07-18", "13:30", { date: "2026-07-18", time: "18:00" })).toBe("completed");
  });
  it("never prematurely closes a trip when a clock is malformed", () => {
    expect(tripPhaseOf("2026-07-18", "bogus", { date: "2026-07-18", time: "09:00" })).toBe("upcoming");
  });
});

describe("buildManageView", () => {
  it("flips phase, computes back-by / arrive-by, and carries the money through", () => {
    const v = buildManageView(input());
    expect(v.phase).toBe("upcoming");
    expect(v.timing.startLabel).toBe("1:30 PM");
    expect(v.timing.backByLabel).toBe("3:10 PM"); // 13:30 + 1h40m
    expect(v.timing.arriveByLabel).toBe("1:15 PM"); // 13:30 − 15m
    expect(v.detail.money.fareCents).toBe(54900);
  });
  it("omits back-by / arrive-by when the offering leaves the timings unset", () => {
    const bare = { id: asId<"OfferingId">("off-1"), name: "Bare" } as Offering;
    const v = buildManageView(input({ offering: bare }));
    expect(v.timing.backByLabel).toBeNull();
    expect(v.timing.arriveByLabel).toBeNull();
    expect(v.timing.durationMinutes).toBeNull();
  });
  it("reports paid-in-full only when the fare is known and the balance is settled", () => {
    const paid = buildManageView(
      input({
        payments: [
          { id: asId<"PaymentId">("p1"), status: "succeeded", amountCents: 588_80 + 54900 } as never,
        ],
      }),
    );
    expect(paid.paidInFull).toBe(true);
    expect(buildManageView(input()).paidInFull).toBe(false); // nothing paid ⇒ balance owed
  });

  it("a CANCELLED booking reads paid-in-full, because it owes nothing (issue #803)", () => {
    // The guest-visible consequence of zeroing a cancelled booking's balance, pinned because it
    // is derived rather than written: `paidInFull` is `balanceCents <= 0`, so `/b/<code>` swaps
    // "Paid so far" for "Paid in full" and drops the balance row entirely. Confirmed correct by
    // the operator (2026-08-21) on a cancelled + refunded booking — they did pay in full, and
    // the Refunded row directly beneath carries the rest of the story.
    //
    // The payment is a partial one — $200 against a larger fare — so without the fix the balance
    // is a real positive number and `paidInFull` is false. That is what makes this bite.
    //
    // Written AFTER the change: a regression guard on a knock-on effect, not a proof of it.
    const v = buildManageView(
      input({
        reservation: { ...RES, status: "cancelled" },
        payments: [
          { id: asId<"PaymentId">("p1"), status: "succeeded", amountCents: 20000 } as never,
        ],
      }),
    );
    expect(v.paidInFull).toBe(true);
  });

  it("a FULLY refunded cancelled booking is not 'paid in full' — nothing is paid (issue #803)", () => {
    // The trap zeroing the balance opened, caught by @code-review. A fully refunded payment row
    // is `refunded`, which `countsAsPaid` excludes, so `paidCents` is 0 — and with the balance
    // also 0 the guest page's headline money line said "Paid in full $0.00" above the refund.
    // This is the ordinary end state of an operator cancel (#797), not an edge case.
    //
    // Written AFTER the change, like the guard above it.
    const v = buildManageView(
      input({
        reservation: { ...RES, status: "cancelled" },
        payments: [
          {
            id: asId<"PaymentId">("p1"),
            status: "refunded",
            amountCents: 20000,
            refundedCents: 20000,
          } as never,
        ],
      }),
    );
    expect(v.detail.money.paidCents).toBe(0);
    expect(v.detail.money.balanceCents).toBe(0);
    expect(v.paidInFull).toBe(false);
  });
});

/**
 * Money F6 on the guest's own page (issue #1241): `/b/<code>` reads the tax and balance frozen on
 * the booking, so a rate change after booking moves neither. The view takes no rate any more; the
 * booking is frozen at 7.25% and read with nothing else to go on.
 */
describe("buildManageView — the frozen tax and balance (issue #1241)", () => {
  // $549 at 7.25%, 3% fee, no tip: 54900 + 3980 + 1647 = 60527.
  const F6: BookingInvoice = { ...FROZEN, serviceFeeCents: 1647, serviceFeeBps: 300, totalCents: 60527, amountDueNowCents: 60527 };
  const charge = (amountCents: number) =>
    ({ id: asId<"PaymentId">("p1"), status: "succeeded", kind: "full", amountCents, serviceFeeCents: 1647 }) as Payment;

  it("issue #1241 AC1: a booking paid in full shows the frozen tax and reads paid in full", () => {
    const v = buildManageView(input({ reservation: { ...RES, invoice: F6 }, payments: [charge(60527)] }));
    expect(v.detail.money.taxCents).toBe(3980);
    expect(v.detail.money.balanceCents).toBe(0);
    expect(v.paidInFull).toBe(true);
  });

  it("issue #1241 AC1: a deposit-only booking shows the frozen balance and is not paid in full", () => {
    // The $100 deposit carried the fee: 60527 − 10000 = 50527 owed.
    const v = buildManageView(
      input({ reservation: { ...RES, invoice: { ...F6, amountDueNowCents: 10000 } }, payments: [charge(10000)] }),
    );
    expect(v.detail.money.taxCents).toBe(3980);
    expect(v.detail.money.balanceCents).toBe(50527);
    expect(v.paidInFull).toBe(false);
  });
});

/**
 * The balance row's label (issue #1252): the day the saved card is charged, read from the due date
 * frozen on the booking — never recomputed from the balance-due setting. The vessel-timezone edge
 * of that day is `dueDayLabel`'s (`checkout-quote.test.ts`) and is not re-tested here.
 *
 * A deposit booking on Wed, Nov 11 at 15:30: $500 fare, 8% tax, a 20% tip and the 3% fee — $658.00
 * in all, $100 of it paid. The deposit row is shaped like the webhook's (`booking-webhook.ts`
 * `recordPayment`): the invoice's tip and fee ride on the $100 row, so the balance is the rest of
 * the quote, $558.00.
 */
describe("buildManageView — the balance row's label (issue #1252)", () => {
  const NOV_11: Event = { ...EVENT, date: "2026-11-11", time: "15:30", price: 50000 } as Event;
  const INVOICE: BookingInvoice = {
    fareCents: 50000,
    extrasCents: 0,
    taxCents: 4000,
    taxRateBps: 800,
    serviceFeeCents: 1800,
    serviceFeeBps: 300,
    gratuityCents: 10000,
    gratuityBps: 2000,
    totalCents: 65800,
    amountDueNowCents: 10000,
  };
  const DEPOSIT_PAID = {
    id: asId<"PaymentId">("pay-deposit"),
    reservationId: RES.id,
    method: "stripe",
    kind: "deposit",
    amountCents: 10000,
    taxCents: 4000,
    gratuityCents: 10000,
    serviceFeeCents: 1800,
    currency: "usd",
    status: "succeeded",
    stripePaymentIntentId: "pi_deposit",
    createdAt: "2026-09-20T14:00:00.000Z",
  } as Payment;
  const depositBooking = (over: Partial<Reservation> = {}): ManageViewInput =>
    input({
      reservation: { ...RES, invoice: INVOICE, ...over },
      event: NOV_11,
      payments: [DEPOSIT_PAID],
      now: { date: "2026-10-01", time: "09:00" },
    });

  it("issue #1252 AC1: a booking with a balance and a due date names the day its card is charged, with the balance as the amount", () => {
    // 15:30 EDT on Mon, Oct 12 — the 30 days before departure the booking froze.
    const v = buildManageView(depositBooking({ balanceDueAt: "2026-10-12T19:30:00.000Z" }));

    expect(v.detail.money.balanceCents).toBe(55800);
    expect(v.balanceLabel).toBe("Balance · charged to your card on Mon, Oct 12");
  });

  it("issue #1252 AC2: the day is the frozen due date, not one recomputed from the balance-due setting", () => {
    // Twelve days before departure: a date the default 30-day setting never produces, so a label
    // recomputed from the setting would read Mon, Oct 12.
    const v = buildManageView(depositBooking({ balanceDueAt: "2026-10-30T19:30:00.000Z" }));

    expect(v.balanceLabel).toBe("Balance · charged to your card on Fri, Oct 30");
  });

  it("issue #1252 AC3: a booking with a balance and no due date states an obligation", () => {
    // An unpaid phone booking, or one booked before deposits: nothing froze a due date.
    const v = buildManageView(depositBooking());

    expect(v.detail.money.balanceCents).toBeGreaterThan(0);
    expect(v.balanceLabel).toBe("Balance · due before your trip");
  });

  it("issue #1252 AC9: a booking whose due date has passed reads Balance due, with no day", () => {
    // The 10-days-out booking an admin stopped: its balance fell due on Mon, Oct 12 and was never
    // charged. Now is Sun, Nov 1, so naming a day the card "is charged" would be false.
    const v = buildManageView({
      ...depositBooking({ balanceDueAt: "2026-10-12T19:30:00.000Z" }),
      now: { date: "2026-11-01", time: "09:00" },
    });

    expect(v.detail.money.balanceCents).toBe(55800);
    expect(v.balanceLabel).toBe("Balance due");
  });

  it("issue #1252 AC9: the due date counts as passed at its own instant, and not a minute before", () => {
    // Due 15:30 EDT on Mon, Oct 12 (19:30Z), compared in the vessel's own date and clock.
    const due = { balanceDueAt: "2026-10-12T19:30:00.000Z" };
    const at = buildManageView({ ...depositBooking(due), now: { date: "2026-10-12", time: "15:30" } });
    const before = buildManageView({ ...depositBooking(due), now: { date: "2026-10-12", time: "15:29" } });

    expect(at.balanceLabel).toBe("Balance due");
    expect(before.balanceLabel).toBe("Balance · charged to your card on Mon, Oct 12");
  });
});
