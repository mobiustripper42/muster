/**
 * Everything that reads a fare back off a booking must see the discount (16.5, DEC-194).
 *
 * A booked row's balance is DERIVED — `Event.price` + frozen extras, taxed, minus what was paid —
 * and `Event.price` is the undiscounted fare. Left alone, a discounted booking paid in full reads
 * as owing the discount plus its tax, and the pane offers a balance link to collect it.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { BookingInvoice, Event, Payment, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { buildReservationDetail, buildUnpaidBookingDetail } from "./calendar-detail.js";
import { createBalanceCheckout } from "./create-balance-checkout.js";
import { chargedFareCents } from "./discount.js";
import { payLinkMoney } from "./pay-by-link.js";
import { buildPurchaseRows } from "./purchases-view.js";

const EVENT_ID = asId<"EventId">("m-evt-1");
const RESV_ID = asId<"ReservationId">("resv-1");
const VESSEL_ID = asId<"VesselId">("v-1");
const TAX_BPS = 725;

// $499 trip, $100 off → $399 base: tax 2893, fee 1197, 20% tip 7980 → 51970 charged.
const invoice: BookingInvoice = {
  fareCents: 49900,
  extrasCents: 0,
  discountCents: 10000,
  taxCents: 2893,
  taxRateBps: TAX_BPS,
  serviceFeeCents: 1197,
  serviceFeeBps: 300,
  gratuityCents: 7980,
  gratuityBps: 2000,
  totalCents: 51970,
  amountDueNowCents: 51970,
};

const event: Event = {
  id: EVENT_ID,
  vesselId: VESSEL_ID,
  date: "2026-08-15",
  time: "11:30",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  price: 49900,
};

const booked: Reservation = {
  id: RESV_ID,
  eventId: EVENT_ID,
  source: "muster",
  customerName: "Martin Brody",
  partySize: 4,
  status: "booked",
  extrasCents: 0,
  invoice,
};

const paidInFull: Payment = {
  id: asId<"PaymentId">("pay-1"),
  reservationId: RESV_ID,
  method: "stripe",
  kind: "full",
  amountCents: 51970,
  taxCents: 2893,
  gratuityCents: 7980,
  serviceFeeCents: 1197,
  currency: "usd",
  status: "succeeded",
  createdAt: "2026-07-01T12:00:00Z",
};

describe("chargedFareCents", () => {
  it("is fare plus extras minus the discount", () => {
    expect(chargedFareCents({ fareCents: 49900, extrasCents: 5000, discountCents: 10000 })).toBe(44900);
    expect(chargedFareCents({ fareCents: 49900, extrasCents: 5000 })).toBe(54900);
  });
});

describe("a discounted booking paid in full owes nothing", () => {
  it("on the booking pane, which shows the discount as its own line", () => {
    const v = buildReservationDetail({
      reservation: booked,
      event,
      payments: [paidInFull],
      gratuities: [],
      taxRateBps: TAX_BPS,
    });
    expect(v.money.balanceCents).toBe(0);
    expect(v.money.fareCents).toBe(39900);
    expect(v.money.discountCents).toBe(10000);
  });

  it("on the purchases list", () => {
    const [row] = buildPurchaseRows({
      reservations: [booked],
      eventsById: new Map([[String(EVENT_ID), event]]),
      paymentsByReservation: new Map([[String(RESV_ID), [paidInFull]]]),
      taxRateBps: TAX_BPS,
    });
    expect(row?.balanceCents).toBe(0);
  });

  it("and no balance link can be minted for it", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(event);
    await repo.saveReservation(booked);
    await repo.savePayment(paidInFull);
    await repo.setPaymentConfig({ taxRateBps: TAX_BPS }, "2026-07-01T12:00:00Z");
    const res = await createBalanceCheckout(repo, {} as never, RESV_ID, { successUrl: "", cancelUrl: "" });
    expect(res).toEqual({ ok: false, reason: "no_balance" });
  });
});

describe("an unpaid discounted booking", () => {
  const pending: Reservation = { ...booked, eventId: null, status: "pending", source: "admin" };

  it("the pane's fare is what tax was charged on, with the discount beside it", () => {
    const v = buildUnpaidBookingDetail({ reservation: pending });
    expect(v.money.fareCents).toBe(39900);
    expect(v.money.discountCents).toBe(10000);
  });

  it("the payment link's summary carries the discount, and its total is what is charged", () => {
    const { money } = payLinkMoney(invoice);
    expect(money.discountCents).toBe(10000);
    // Fare stays the undiscounted figure, the discount is its own row, and the sum is the charge.
    expect(money.fareCents).toBe(49900);
    expect(money.fareCents - money.discountCents + money.taxCents + money.serviceFeeCents).toBe(
      invoice.totalCents - invoice.gratuityCents,
    );
  });
});
