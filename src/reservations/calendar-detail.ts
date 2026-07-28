/**
 * Reservation detail view-model (task 12.11 continued, #464) — the read-only pane behind
 * `/admin/calendar/[reservationId]`. Pure: takes the rows the route already loaded and
 * returns everything the pane renders, so the money math and the "what do we actually
 * know" decisions are unit-testable without a page.
 *
 * Three rows in the mockup (`docs/design/mockups/reservation-calendar.html`) have no source
 * in the model, and this module encodes that rather than faking them:
 *
 * - **Add-ons.** `addOnIds` is an OFFERING-level attachment (#491); there is no per-reservation
 *   add-on selection yet, so the section is omitted entirely — a hard-coded "No" on every
 *   reservation would be a lie the operator can't tell from data.
 * - **"Waivers 7 of 7".** No per-attendee roster exists (DEC-012); the model carries ONE
 *   consent record per reservation (`waiverConsentAt`/`waiverVersion`), Muster-sold only. So
 *   the pane shows one waiver row with a three-way state (`consented` | `none` | `xola`).
 * - **"Booked Jun 14".** `Reservation` has no `createdAt` — only `updatedAt`, which is the
 *   last *material* change (DEC-029). Surfaced as `updatedAt` and labelled "Updated" by the
 *   view; calling it "Booked" would misreport a changed reservation's date.
 *
 * The mockup's **3% service fee** is Xola's and is not modelled here (`PaymentConfig` has
 * tax + deposit only, DEC-107) — the money block is fare · tax · tip · paid · balance.
 *
 * Money follows the existing authorities, never a local recompute: fare is
 * `Event.price + Reservation.extrasCents` (#474, DEC-107 amend), tax is `taxCentsFor`, and
 * the residual is `balanceOwedCents` (the ONE balance authority, DEC-107). Gratuity is read
 * from `Gratuity` rows (DEC-124) — crew money, tax- and fee-exempt, deliberately outside the
 * fare and outside the balance.
 */

import type {
  Event,
  Gratuity,
  Offering,
  Payment,
  Reservation,
  Seat,
  Shift,
  Vessel,
} from "../domain/entities.js";
import { balanceOwedCents, countsAsPaid, taxCentsFor } from "./payment-config.js";

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

/** One waiver state. `xola` = Xola owns the waiver for imported reservations (DEC-110). */
export type WaiverState =
  | { kind: "consented"; at: string; version?: string }
  | { kind: "none" }
  | { kind: "xola" };

export interface DetailMoney {
  /** `Event.price` base + frozen `extrasCents` — the taxable, tip-free party fare. */
  fareCents: number;
  taxCents: number;
  /** Σ gratuity rows — crew money, NOT part of fare+tax and NOT part of the balance. */
  gratuityCents: number;
  /** Σ succeeded payments, gross (tip included) — what the card actually took. */
  paidCents: number;
  /** `> 0` ⇒ still owed (deposit booking); `<= 0` ⇒ settled. */
  balanceCents: number;
  refundedCents: number;
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
  phone?: string | undefined;
  email?: string | undefined;
  /** Last MATERIAL change (DEC-029) — not a booking date; render it as "Updated". */
  updatedAt?: string | undefined;
  guestCount: number;
  /** Whole-boat capacity for the departure (COI cap) — the "of 12". */
  capacity: number;
  waiver: WaiverState;
  gratuityRows: { kind: Gratuity["kind"]; amountCents: number; bps?: number | undefined }[];
  money: DetailMoney;
  crew?: CrewLink | undefined;
}

/** Seat states that mean a person is actually on the seat. */
const HELD_BY_PERSON = new Set(["Claimed", "Confirmed"]);

/** Build the pane's view model. Pure — every input is already-loaded data. */
export function buildReservationDetail(input: ReservationDetailInput): ReservationDetailView {
  const { reservation: r, event, offering, vessel, payments, gratuities, taxRateBps } = input;

  const priceKnown = typeof event.price === "number";
  const fareCents = (event.price ?? 0) + (r.extrasCents ?? 0);
  const taxCents = taxCentsFor(fareCents, taxRateBps);
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
    waiver: waiverStateOf(r),
    gratuityRows: gratuities
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((g) => ({ kind: g.kind, amountCents: g.amountCents, bps: g.bps })),
    money: {
      fareCents,
      taxCents,
      gratuityCents,
      paidCents,
      balanceCents: balanceOwedCents(fareCents, taxRateBps, payments),
      refundedCents,
      priceKnown,
    },
    crew: crewLinkOf(input.shift),
  };
}

/** Three-way waiver state — see the module note on why this isn't "7 of 7". */
function waiverStateOf(r: Reservation): WaiverState {
  if (r.waiverConsentAt) {
    return r.waiverVersion
      ? { kind: "consented", at: r.waiverConsentAt, version: r.waiverVersion }
      : { kind: "consented", at: r.waiverConsentAt };
  }
  // Xola owns its own waiver; an imported reservation without consent isn't a gap.
  return r.source === "xola" ? { kind: "xola" } : { kind: "none" };
}

function crewLinkOf(s: ReservationDetailInput["shift"]): CrewLink | undefined {
  if (!s) return undefined;
  const required = s.seats.filter((seat) => seat.kind === "required");
  return {
    shiftId: String(s.shift.id),
    filled: required.filter((seat) => HELD_BY_PERSON.has(seat.state)).length,
    required: required.length,
  };
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
