/**
 * Reservation detail view-model (task 12.11 continued, #464) — the read-only pane behind
 * `/admin/calendar/[reservationId]`. Pure: takes the rows the route already loaded and
 * returns everything the pane renders, so the money math and the "what do we actually
 * know" decisions are unit-testable without a page.
 *
 * Rows in the mockup (`docs/design/mockups/reservation-calendar.html`) that have no source in the
 * model, and this module encodes that rather than faking them:
 *
 * - **Add-ons.** `addOnIds` is an OFFERING-level attachment (#491); there is no per-reservation
 *   add-on selection yet, so the section is omitted entirely — a hard-coded "No" on every
 *   reservation would be a lie the operator can't tell from data.
 * - **"Waivers 7 of 7".** No waiver row at all (issue #1112). It read the checkout's consent
 *   stamp, and that box was never a waiver and is no longer stored. The real waiver is its own
 *   module, signed per guest.
 * - **"Booked Jun 14".** `Reservation` has no `createdAt` — only `updatedAt`, which is the
 *   last *material* change (DEC-029). Surfaced as `updatedAt` and labelled "Updated" by the
 *   view; calling it "Booked" would misreport a changed reservation's date.
 *
 * A booked reservation's money block is fare · tax · tip · paid · balance; the service fee is not
 * derived here. An unpaid phone booking (`buildUnpaidBookingDetail`) carries its frozen invoice
 * instead, which does itemise the fee.
 *
 * Money follows the existing authorities, never a local recompute: fare is
 * `Event.price + Reservation.extrasCents` (#474, DEC-107 amend), tax is `taxCentsFor`, and
 * the residual is `balanceOwedCents` (the ONE balance authority, DEC-107). Gratuity is read
 * from `Gratuity` rows (DEC-124) — crew money, tax- and fee-exempt, deliberately outside the
 * fare and outside the balance.
 */

import type {
  BookingInvoice,
  Event,
  Gratuity,
  Offering,
  Payment,
  Reservation,
  Seat,
  Shift,
  Vessel,
} from "../domain/entities.js";
import { hasFlex } from "./booking-invoice.js";
import {
  bookedFareCents,
  chargedFareCents,
  fareDiscountCents,
  flexCarveOutCents,
  flexChargedCents,
} from "./discount.js";
import { balanceDueCents, countsAsPaid, taxCentsFor } from "./payment-config.js";

export interface ReservationDetailInput {
  reservation: Reservation;
  /** The claimed event. Its `price` is the per-departure BASE only (DEC-125). */
  event: Event;
  offering?: Offering | undefined;
  vessel?: Vessel | undefined;
  payments: readonly Payment[];
  /** Gratuities for this reservation (both kinds) — filtered by the caller. */
  gratuities: readonly Gratuity[];
  taxRateBps: number;
  /** The crew shift covering this event, with its seats — for the cross-link. */
  shift?: { shift: Shift; seats: readonly Seat[] } | undefined;
}

export interface DetailMoney {
  /** `Event.price` base + frozen `extrasCents` − the discount — the taxable, tip-free party
   *  fare, i.e. what tax was actually charged on (DEC-194). */
  fareCents: number;
  /** The operator's dollars off the FARE (16.5, DEC-194), 0 when none. `fareCents + discountCents`
   *  is the fare before it — what the pane shows on the Fare line, with this beneath it. Any part
   *  that went on past the fare onto insurance is already out of `flexCents`, not counted here. */
  discountCents: number;
  /** Cancellation insurance bought (16.8) — the booking has the 72-hour window. A comp that took
   *  it to $0 still has it, which is why this is not `flexCents > 0`. */
  insured: boolean;
  /** What was charged for insurance, after any discount that reached it. 0 when none. */
  flexCents: number;
  taxCents: number;
  /** Σ gratuity rows — crew money, NOT part of fare+tax and NOT part of the balance. */
  gratuityCents: number;
  /** Σ succeeded payments, gross (tip included) — what the card actually took. */
  paidCents: number;
  /** `> 0` ⇒ still owed (deposit booking); `<= 0` ⇒ settled. */
  balanceCents: number;
  refundedCents: number;
  /**
   * A chargeback is live or lost on this booking (issue #723).
   *
   * Its own field rather than something the pane infers from the numbers, because a dispute is
   * arithmetically INVISIBLE here: it sets no `refundedCents`, and its only effect is that
   * `paidCents` drops and `balanceCents` rises — which is indistinguishable from a deposit
   * booking that simply hasn't paid its balance yet. That ambiguity is the bug: without this
   * flag the pane offers a balance link to a customer whose bank is clawing the money back.
   */
  disputed: boolean;
  /** `Event.price` absent ⇒ the fare is unknown and the money block can't be trusted. */
  priceKnown: boolean;
}

export interface CrewLink {
  shiftId: string;
  /** Seats holding a person (`Claimed`/`Confirmed`). */
  filled: number;
  /** Required seats — the denominator the shift view uses. */
  required: number;
}

export interface ReservationDetailView {
  reservationId: string;
  customerName: string;
  /** ISO `yyyy-mm-dd` + `HH:MM`, straight off the event (the vessel-day is the clock). */
  date: string;
  time: string;
  vesselName?: string | undefined;
  vesselId?: string | undefined;
  vesselHue?: number | undefined;
  offeringName?: string | undefined;
  offeringId?: string | undefined;
  status: Reservation["status"];
  source: Reservation["source"];
  /** A paid booking the operator sold by phone (issue #1082 part C). `source` turns `muster` at
   *  payment, so the pane reads this — set by the route from the history (`soldByPhone`). */
  soldByPhone?: boolean | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  /** Last MATERIAL change (DEC-029) — not a booking date; render it as "Updated". */
  updatedAt?: string | undefined;
  guestCount: number;
  /** Whole-boat capacity for the departure (COI cap) — the "of 12". */
  capacity: number;
  gratuityRows: { kind: Gratuity["kind"]; amountCents: number; bps?: number | undefined }[];
  money: DetailMoney;
  crew?: CrewLink | undefined;
  /**
   * The invoice frozen at booking — set ONLY on an operator's phone booking before it is paid
   * (issue #1104 part 2). Its presence is what tells the pane to show the itemised quote and
   * "Booked by phone"; a paid booking's money is the derivation above.
   */
  invoice?: BookingInvoice | undefined;
}

/**
 * An operator's phone booking that has not been paid (16.1, DEC-163) — the same view as a booked
 * one, so the pane renders both through one component (issue #1104 part 2).
 *
 * No Event exists before payment (§2.8.2), so the departure comes off the row itself and the money
 * is the invoice frozen at booking, never recomputed from live config: the operator read that
 * figure out on the phone, and a changed tax rate must not change it after the fact. Nothing is
 * paid, so what is owed is the amount due now — nothing once cancelled (#803). No crew link (no
 * shift covers a departure that does not exist yet).
 */
export function buildUnpaidBookingDetail(input: {
  reservation: Reservation;
  offering?: Offering | undefined;
  vessel?: Vessel | undefined;
}): ReservationDetailView {
  const { reservation: r, offering, vessel } = input;
  const inv = r.invoice;
  return {
    reservationId: String(r.id),
    customerName: r.customerName,
    date: r.date ?? "",
    time: r.time ?? "",
    vesselName: vessel?.name,
    vesselId: vessel ? String(vessel.id) : undefined,
    vesselHue: vessel?.hue,
    offeringName: offering?.name,
    offeringId: offering ? String(offering.id) : undefined,
    status: r.status,
    source: r.source,
    phone: r.phone,
    email: r.email,
    updatedAt: r.updatedAt,
    guestCount: r.partySize,
    capacity: vessel?.coiMaxPax ?? 0,
    gratuityRows: [],
    money: {
      fareCents: inv ? chargedFareCents(inv) : 0,
      discountCents: inv ? fareDiscountCents(inv) : 0,
      insured: hasFlex(inv),
      flexCents: inv ? flexChargedCents(inv) : 0,
      taxCents: inv?.taxCents ?? 0,
      gratuityCents: inv?.gratuityCents ?? 0,
      paidCents: 0,
      balanceCents: inv && r.status !== "cancelled" ? inv.amountDueNowCents : 0,
      refundedCents: 0,
      disputed: false,
      priceKnown: inv !== undefined,
    },
    invoice: inv,
  };
}

/** Seat states that mean a person is actually on the seat. */
const HELD_BY_PERSON = new Set(["Claimed", "Confirmed"]);

/** Build the pane's view model. Pure — every input is already-loaded data. */
export function buildReservationDetail(input: ReservationDetailInput): ReservationDetailView {
  const { reservation: r, event, offering, vessel, payments, gratuities, taxRateBps } = input;

  const priceKnown = typeof event.price === "number";
  // Less the discount (DEC-194): `Event.price` is the undiscounted fare.
  const fareCents = bookedFareCents(event.price ?? 0, r);
  // The fare's tax, derived like the balance — plus the insurance's, which is taxed too (DEC-196)
  // and sits outside fare + tax in the carve-out, frozen on the invoice.
  const flexTaxCents = r.invoice ? flexCarveOutCents(r.invoice) - flexChargedCents(r.invoice) : 0;
  const taxCents = taxCentsFor(fareCents, taxRateBps) + Math.max(0, flexTaxCents);
  const gratuityCents = gratuities.reduce((sum, g) => sum + g.amountCents, 0);
  // `countsAsPaid`, shared with `balanceOwedCents` — a partially refunded row is still
  // money the customer paid, shown gross here with `refundedCents` on its own line (#522).
  const succeeded = payments.filter(countsAsPaid);
  const paidCents = succeeded.reduce((sum, p) => sum + p.amountCents, 0);
  const refundedCents = payments.reduce((sum, p) => sum + (p.refundedCents ?? 0), 0);

  return {
    reservationId: String(r.id),
    customerName: r.customerName,
    date: event.date,
    time: event.time,
    vesselName: vessel?.name,
    vesselId: vessel ? String(vessel.id) : undefined,
    vesselHue: vessel?.hue,
    offeringName: offering?.name,
    offeringId: offering ? String(offering.id) : undefined,
    status: r.status,
    source: r.source,
    phone: r.phone,
    email: r.email,
    updatedAt: r.updatedAt,
    guestCount: r.partySize,
    capacity: vessel?.coiMaxPax ?? event.capacity,
    gratuityRows: gratuities
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((g) => ({ kind: g.kind, amountCents: g.amountCents, bps: g.bps })),
    money: {
      fareCents,
      discountCents: r.invoice ? fareDiscountCents(r.invoice) : 0,
      insured: hasFlex(r.invoice),
      flexCents: r.invoice ? flexChargedCents(r.invoice) : 0,
      taxCents,
      gratuityCents,
      paidCents,
      // `balanceDueCents`, not `balanceOwedCents` — a cancelled booking owes nothing (issue
      // #803). This composer is shared: the admin pane reads it, and so does the guest's
      // `/b/<code>` page via `buildManageView`, whose `paidInFull` is derived from it.
      balanceCents: balanceDueCents(r.status, fareCents, taxRateBps, payments),
      refundedCents,
      disputed: payments.some((p) => p.status === "disputed" || p.status === "dispute_lost"),
      priceKnown,
    },
    crew: crewLinkOf(input.shift),
  };
}

function crewLinkOf(s: ReservationDetailInput["shift"]): CrewLink | undefined {
  if (!s) return undefined;
  return { shiftId: String(s.shift.id), ...crewCount(s.seats) };
}

/**
 * Required seats holding a person, out of required seats — the shift view's denominator. Shared
 * with the calendar's List view (issue #1079) so the two never count crew differently.
 */
export function crewCount(seats: readonly Pick<Seat, "kind" | "state">[]): { filled: number; required: number } {
  const required = seats.filter((seat) => seat.kind === "required");
  return { filled: required.filter((seat) => HELD_BY_PERSON.has(seat.state)).length, required: required.length };
}

/** The shift covering an event — matched by `Shift.eventIds`, never by vessel+date guessing
 *  (a split day has two shifts on the same vessel-date; only `eventIds` disambiguates). */
export function shiftForEvent(shifts: readonly Shift[], eventId: string): Shift | undefined {
  return shifts.find((s) => s.eventIds.some((id) => String(id) === eventId));
}

/** Integer cents → "$1,234.56". The pane's only formatter. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
