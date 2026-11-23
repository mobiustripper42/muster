/**
 * The operator's pane, rendered (issue #1212): the second notice under the cancel's outcome, and
 * the service-fee row on a paid booking's Money card.
 *
 * Through the exported `ReservationDetailPane` with `createElement`, because `vitest.config.ts`
 * includes no `.test.tsx` and `PaneActions` and `ServiceFeeRow` are not exported.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BookingInvoice, Event, Gratuity, Payment, Reservation } from "@core/domain/entities.js";
import { asId } from "@core/domain/ids.js";
import {
  buildReservationDetail,
  buildUnpaidBookingDetail,
  type ReservationDetailView,
} from "@core/reservations/calendar-detail.js";
import { cancelNoticeMessage } from "./payment-link-message";
import { ReservationDetailPane, type PaneActionState } from "./reservation-detail-pane";

const RESV = asId<"ReservationId">("resv-1");
const EVENT = asId<"EventId">("evt-1");
const CONTACT = { phone: "+12165550199", email: "rhea@example.com" };

/** $500 fare, 8% tax, 3% fee on fare + tip, 20% tip. */
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
  amountDueNowCents: 65800,
};

/** The same trip, $50 off and insured: tax on $480, fee on $580. */
const DISCOUNTED_INSURED: BookingInvoice = {
  ...INVOICE,
  discountCents: 5000,
  flexCents: 3000,
  taxCents: 3840,
  serviceFeeCents: 1740,
  totalCents: 63580,
  amountDueNowCents: 63580,
};

const event = (over: Partial<Event> = {}): Event => ({
  id: EVENT,
  vesselId: asId<"VesselId">("vessel-brew-2"),
  date: "2026-11-28",
  time: "15:30",
  capacity: 16,
  status: "scheduled",
  source: "muster",
  price: 50000,
  ...over,
});

const reservation = (over: Partial<Reservation> = {}): Reservation => ({
  id: RESV,
  eventId: EVENT,
  source: "muster",
  customerName: "Rhea Tallis",
  partySize: 6,
  status: "booked",
  invoice: INVOICE,
  ...CONTACT,
  ...over,
});

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: asId<"PaymentId">("pay-1"),
  reservationId: RESV,
  method: "stripe",
  kind: "full",
  amountCents: 65800,
  taxCents: 4000,
  gratuityCents: 10000,
  serviceFeeCents: 1800,
  currency: "usd",
  status: "succeeded",
  stripePaymentIntentId: "pi_1",
  createdAt: "2026-10-01T10:00:00.000Z",
  ...over,
});

const gratuity = (over: Partial<Gratuity> = {}): Gratuity => ({
  id: asId<"GratuityId">("grat-1"),
  eventId: EVENT,
  reservationId: RESV,
  kind: "pre",
  amountCents: 10000,
  bps: 2000,
  createdAt: "2026-10-01T10:00:00.000Z",
  ...over,
});

const paidView = (o: { reservation?: Partial<Reservation>; payments?: Payment[]; gratuities?: Gratuity[] } = {}) =>
  buildReservationDetail({
    reservation: reservation(o.reservation),
    event: event(),
    payments: o.payments ?? [payment()],
    gratuities: o.gratuities ?? [gratuity()],
  });

const actions = (over: Partial<PaneActionState> = {}): PaneActionState => ({
  date: "2026-11-28",
  filter: "",
  view: "",
  cancelHref: "/admin/calendar/resv-1?cancel=1#booking-actions",
  backHref: "/admin/calendar/resv-1#booking-actions",
  confirmingCancel: false,
  quoteCustomerCents: 60800,
  quoteOperatorCents: 65800,
  refundableCents: 65800,
  refundedTotalCents: 0,
  refundPrefill: "",
  cancelBy: "customer",
  refundBackHref: "/admin/calendar/resv-1#booking-actions",
  canResend: true,
  restoredFromRefusal: false,
  ...over,
});

const render = (v: ReservationDetailView, a: PaneActionState = actions()): string =>
  renderToStaticMarkup(createElement(ReservationDetailPane, { v, actions: a }));

/** The markup's text, each tag replaced by `sep`. */
function stripTags(markup: string, sep = ""): string {
  let out = "";
  let inTag = false;
  for (const c of markup) {
    if (c === "<") {
      inTag = true;
      out += sep;
    } else if (c === ">") {
      inTag = false;
    } else if (!inTag) {
      out += c;
    }
  }
  return out;
}

const text = (markup: string): string => stripTags(markup);

/** The element carrying `data-testid`, opening tag through to its own close. */
function byTestId(markup: string, testId: string): { open: string; text: string; at: number } | null {
  const at = markup.indexOf(`data-testid="${testId}"`);
  if (at < 0) return null;
  const start = markup.lastIndexOf("<", at);
  const end = markup.indexOf(">", at);
  const close = markup.indexOf("</", end);
  return { open: markup.slice(start, end + 1), text: text(markup.slice(end + 1, close)), at };
}

/** The Money card's rows above Paid, in order: `[label, value]`. Read from the card's text, so it
 *  holds whatever element a row is drawn with. */
function chargeRows(markup: string): [string, string][] {
  const card = markup.slice(markup.indexOf('aria-label="Money"'));
  const tokens = stripTags(card, "|").split("|").filter((t) => t.trim() !== "");
  const rows: [string, string][] = [];
  for (let i = tokens.indexOf("Money") + 1; tokens[i] !== "Paid"; i += 2) {
    rows.push([tokens[i]!, tokens[i + 1]!]);
  }
  return rows;
}

/** "$1,234.56" or "−$50.00" to integer cents. */
function cents(value: string): number {
  const negative = value.startsWith("−");
  const digits = value.replace(/[^0-9]/g, "");
  return (negative ? -1 : 1) * Number(digits);
}

describe("ReservationDetailPane — the customer's notice under a cancel", () => {
  const cancelled = () => paidView({ reservation: { status: "cancelled", cancelledBy: "operator" } });
  const DONE = "Cancelled. The boat is free again and the crew have been told.";

  it("AC11: every channel sent — an ok notice directly under the action-done outcome", () => {
    const told = cancelNoticeMessage("sent-sent", CONTACT);
    const html = render(cancelled(), actions({ done: DONE, told }));

    const notice = byTestId(html, "customer-told");
    expect(notice?.text).toBe("Customer told: texted to (216) 555-0199 and emailed to rhea@example.com.");
    expect(notice?.open).toContain("text-ok");
    expect(byTestId(html, "action-done")!.at).toBeLessThan(notice!.at);
    expect(notice!.at).toBeLessThan(byTestId(html, "refund-form")!.at);
  });

  it("AC11: nobody reached — a bad notice directly under the action-error outcome", () => {
    const told = cancelNoticeMessage("failed-failed", CONTACT);
    const html = render(cancelled(), actions({ error: "Stripe failed and NOTHING was refunded.", told }));

    const notice = byTestId(html, "customer-told");
    expect(notice?.text).toBe(
      "The customer was NOT told: the text to (216) 555-0199 failed; the email to rhea@example.com failed. Call them.",
    );
    expect(notice?.open).toContain("text-bad");
    expect(byTestId(html, "action-error")!.at).toBeLessThan(notice!.at);
  });

  it("AC11: one of the two sent stays ok, and shows the operator which one failed", () => {
    const html = render(cancelled(), actions({ done: DONE, told: cancelNoticeMessage("failed-sent", CONTACT) }));

    const notice = byTestId(html, "customer-told");
    expect(notice?.text).toBe("Customer told: texted to (216) 555-0199. The email to rhea@example.com failed.");
    expect(notice?.open).toContain("text-ok");
  });

  it("AC11: no told, no notice — the outcome stands alone", () => {
    const html = render(cancelled(), actions({ done: DONE }));

    expect(byTestId(html, "action-done")?.text).toBe(DONE);
    expect(byTestId(html, "customer-told")).toBeNull();
  });
});

describe("ReservationDetailPane — no repair (issue #1228)", () => {
  it("AC13: no Release the boat button on any booking, whatever a stale caller passes", () => {
    // The cast is how a stale caller gets past the type the field has left.
    const stale = { ...actions(), needsRelease: true } as PaneActionState;

    for (const v of [paidView({ reservation: { status: "cancelled", cancelledBy: "operator" } }), paidView()]) {
      const html = render(v, stale);

      expect(byTestId(html, "release-repair")).toBeNull();
      expect(text(html)).not.toContain("Release the boat");
    }
  });
});

describe("ReservationDetailPane — the paid booking's Money card", () => {
  it("AC18: a service-fee row sits after the tips and before the insurance, with the rate from the invoice", () => {
    const html = render(
      paidView({
        reservation: { invoice: DISCOUNTED_INSURED },
        payments: [payment({ amountCents: 63580, taxCents: 3840, serviceFeeCents: 1740 })],
      }),
    );

    expect(chargeRows(html).map(([label]) => label)).toEqual([
      "Fare",
      "Discount",
      "Tax",
      "Tip at checkout · 20%",
      "Service fee · 3%",
      "Cancellation insurance",
    ]);
  });

  it("AC18: the charge rows add up to Paid", () => {
    const plain = render(paidView());
    expect(chargeRows(plain).reduce((sum, [, value]) => sum + cents(value), 0)).toBe(65800);

    const insured = render(
      paidView({
        reservation: { invoice: DISCOUNTED_INSURED },
        payments: [payment({ amountCents: 63580, taxCents: 3840, serviceFeeCents: 1740 })],
      }),
    );
    expect(chargeRows(insured).reduce((sum, [, value]) => sum + cents(value), 0)).toBe(63580);
  });

  it("AC18: no fee charged, no row", () => {
    const html = render(paidView({ payments: [payment({ amountCents: 64000, serviceFeeCents: 0 })] }));

    expect(chargeRows(html).map(([label]) => label)).toEqual(["Fare", "Tax", "Tip at checkout · 20%"]);
    expect(text(html)).not.toContain("Service fee");
  });

  it("AC18: the unpaid branch keeps its row, labelled the same way", () => {
    const html = render(
      buildUnpaidBookingDetail({ reservation: reservation({ source: "admin", status: "pending", eventId: null }) }),
    );

    expect(chargeRows(html)).toContainEqual(["Service fee · 3%", "$18.00"]);
  });
});
