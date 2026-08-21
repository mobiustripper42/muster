/**
 * Reservation detail view-model (#464, 12.11 detail) — money composition, the three
 * rows the mockup asks for that the model can't source, and the crew cross-link.
 */
import { describe, expect, it } from "vitest";
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
import { asId } from "../domain/ids.js";
import {
  buildReservationDetail,
  formatCents,
  shiftForEvent,
  type ReservationDetailInput,
} from "./calendar-detail.js";

const EVENT_ID = asId<"EventId">("m-evt-1");
const RESV_ID = asId<"ReservationId">("resv-1");
const SHIFT_ID = asId<"ShiftId">("shift-1");
const VESSEL_ID = asId<"VesselId">("vessel-brew-4");
const ROLE = asId<"RoleTypeId">("captain");

const TAX_BPS = 725;

const event = (over: Partial<Event> = {}): Event => ({
  id: EVENT_ID,
  vesselId: VESSEL_ID,
  date: "2026-08-15",
  time: "11:30",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  price: 49900,
  ...over,
});

const reservation = (over: Partial<Reservation> = {}): Reservation => ({
  id: RESV_ID,
  eventId: EVENT_ID,
  source: "muster",
  customerName: "Munish Bangia",
  partySize: 7,
  status: "booked",
  ...over,
});

const vessel = (over: Partial<Vessel> = {}): Vessel => ({
  id: VESSEL_ID,
  name: "Brew 4",
  coiMaxPax: 12,
  hue: 4,
  manning: [],
  ...over,
});

const offering = (over: Partial<Offering> = {}): Offering => ({
  id: asId<"OfferingId">("off-1"),
  tenantId: asId<"TenantId">("brewboat"),
  name: "Public Cruise",
  status: "live",
  locationId: asId<"LocationId">("loc-dock"),
  vesselIds: [VESSEL_ID],
  schedule: {
    seasonStart: "2026-01-01",
    seasonEnd: "2026-12-31",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    departureTimes: ["11:30"],
  },
  basePriceCents: 49900,
  priceVariations: [],
  extraGuestPriceCents: 2500,
  ...over,
});

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: asId<"PaymentId">("pay-1"),
  reservationId: RESV_ID,
  method: "stripe",
  kind: "deposit",
  amountCents: 10000,
  taxCents: 0,
  currency: "usd",
  status: "succeeded",
  createdAt: "2026-07-01T12:00:00Z",
  ...over,
});

const gratuity = (over: Partial<Gratuity> = {}): Gratuity => ({
  id: asId<"GratuityId">("grat-1"),
  eventId: EVENT_ID,
  reservationId: RESV_ID,
  kind: "pre",
  amountCents: 7485,
  bps: 1500,
  createdAt: "2026-07-01T12:00:00Z",
  ...over,
});

const build = (over: Partial<ReservationDetailInput> = {}) =>
  buildReservationDetail({
    reservation: reservation(),
    event: event(),
    offering: offering(),
    vessel: vessel(),
    payments: [],
    gratuities: [],
    taxRateBps: TAX_BPS,
    ...over,
  });

describe("money", () => {
  it("composes the fare as event base + FROZEN extras, not the bare base (#474)", () => {
    const v = build({ reservation: reservation({ extrasCents: 5000 }) });
    expect(v.money.fareCents).toBe(54900);
  });

  it("taxes the composed fare, tip-free", () => {
    const v = build({ gratuities: [gratuity()] });
    // 49900 * 725bps = 3617.75 → 3618
    expect(v.money.taxCents).toBe(3618);
    expect(v.money.gratuityCents).toBe(7485);
  });

  it("derives the balance through balanceOwedCents, netting the tip out of what was paid", () => {
    // Deposit charge bundled the tip: 12485 gross, of which 7485 is crew money.
    const v = build({
      payments: [payment({ amountCents: 12485, gratuityCents: 7485 })],
      gratuities: [gratuity()],
    });
    expect(v.money.paidCents).toBe(12485); // gross — what the card took
    expect(v.money.balanceCents).toBe(49900 + 3618 - 5000); // tip netted out of "paid"
  });

  it("a CANCELLED booking owes nothing — the trip is off, so there is no balance to be due", () => {
    // issue #803. `balanceOwedCents` is fare+tax minus what was paid, which is a live number for
    // a live trip and meaningless once the trip is cancelled. Worse after a refund: the refund
    // reduces `paid`, so the balance goes back UP, and the guest's own page told them they owed
    // $575.32 before a cruise that had been cancelled and refunded.
    const v = build({
      reservation: reservation({ status: "cancelled" }),
      payments: [payment({ amountCents: 12485, refundedCents: 12485, status: "refunded" })],
    });
    expect(v.money.balanceCents).toBe(0);
  });

  it("a CANCELLED booking with money still on it owes nothing either", () => {
    // Not only the refunded case: a deposit booking cancelled before any refund is issued has a
    // real arithmetic shortfall and still owes nothing, because nobody is going on a trip.
    const v = build({
      reservation: reservation({ status: "cancelled" }),
      payments: [payment({ amountCents: 12485 })],
    });
    expect(v.money.balanceCents).toBe(0);
  });

  it("counts only succeeded payments as paid — a refunded one drops out", () => {
    const v = build({
      payments: [payment(), payment({ id: asId<"PaymentId">("pay-2"), status: "refunded" })],
    });
    expect(v.money.paidCents).toBe(10000);
  });

  it("sums refunds across every payment", () => {
    const v = build({
      payments: [
        payment({ refundedCents: 2500 }),
        payment({ id: asId<"PaymentId">("pay-2"), refundedCents: 1000 }),
      ],
    });
    expect(v.money.refundedCents).toBe(3500);
  });

  it("flags an unpriced event so the pane can withhold the money block", () => {
    const priced = build();
    const { price: _dropped, ...unpricedEvent } = event();
    const unpriced = build({ event: unpricedEvent });
    expect(priced.money.priceKnown).toBe(true);
    expect(unpriced.money.priceKnown).toBe(false);
    expect(unpriced.money.fareCents).toBe(0);
  });

  it("keeps gratuity out of fare and out of the balance (DEC-124)", () => {
    const without = build();
    const withTip = build({ gratuities: [gratuity()] });
    expect(withTip.money.fareCents).toBe(without.money.fareCents);
    expect(withTip.money.balanceCents).toBe(without.money.balanceCents);
  });
});

describe("gratuity rows", () => {
  it("lists both kinds oldest-first with their tier", () => {
    // A post-trip tip is a free amount, so it carries no tier.
    const { bps: _noTier, ...post } = gratuity({
      id: asId<"GratuityId">("grat-2"),
      kind: "post",
      amountCents: 2000,
      createdAt: "2026-08-15T20:00:00Z",
    });
    const v = build({ gratuities: [post, gratuity()] });
    expect(v.gratuityRows.map((g) => g.kind)).toEqual(["pre", "post"]);
    expect(v.gratuityRows[0]?.bps).toBe(1500);
    expect(v.gratuityRows[1]?.bps).toBeUndefined();
  });
});

describe("the rows the model can't source the way the mockup drew them", () => {
  it("reports ONE waiver consent state, not a per-attendee tally (DEC-012)", () => {
    expect(build().waiver).toEqual({ kind: "none" });
    expect(
      build({
        reservation: reservation({ waiverConsentAt: "2026-07-01T12:00:00Z", waiverVersion: "v2" }),
      }).waiver,
    ).toEqual({ kind: "consented", at: "2026-07-01T12:00:00Z", version: "v2" });
  });

  it("treats a Xola reservation's missing consent as Xola-owned, not a gap (DEC-110)", () => {
    expect(build({ reservation: reservation({ source: "xola" }) }).waiver).toEqual({ kind: "xola" });
  });

  it("carries updatedAt (last material change), never a booking date (DEC-029)", () => {
    const v = build({ reservation: reservation({ updatedAt: "2026-07-14T09:00:00Z" }) });
    expect(v.updatedAt).toBe("2026-07-14T09:00:00Z");
    expect(build().updatedAt).toBeUndefined();
  });

  it("exposes no add-on field at all — per-reservation add-ons aren't modelled (#491)", () => {
    expect("addOns" in build()).toBe(false);
  });
});

describe("guests", () => {
  it("counts guests against the vessel's COI cap", () => {
    const v = build();
    expect(v.guestCount).toBe(7);
    expect(v.capacity).toBe(12);
  });

  it("falls back to the event's capacity when the vessel is missing", () => {
    const v = build({ vessel: undefined, event: event({ capacity: 6 }) });
    expect(v.capacity).toBe(6);
  });
});

describe("crew cross-link", () => {
  const seat = (over: Partial<Seat> = {}): Seat => ({
    id: asId<"SeatId">("seat-1"),
    shiftId: SHIFT_ID,
    role: ROLE,
    kind: "required",
    state: "Confirmed",
    ...over,
  });
  const shift = (over: Partial<Shift> = {}): Shift => ({
    id: SHIFT_ID,
    vesselId: VESSEL_ID,
    date: "2026-08-15",
    state: "Crewed",
    eventIds: [EVENT_ID],
    ...over,
  });

  it("counts filled required seats over required seats", () => {
    const v = build({
      shift: {
        shift: shift(),
        seats: [
          seat(),
          seat({ id: asId<"SeatId">("seat-2"), state: "Claimed" }),
          seat({ id: asId<"SeatId">("seat-3"), state: "Open" }),
        ],
      },
    });
    expect(v.crew).toEqual({ shiftId: "shift-1", filled: 2, required: 3 });
  });

  it("ignores supernumerary seats in both halves of the ratio", () => {
    const v = build({
      shift: {
        shift: shift(),
        seats: [seat(), seat({ id: asId<"SeatId">("seat-2"), kind: "supernumerary" })],
      },
    });
    expect(v.crew).toEqual({ shiftId: "shift-1", filled: 1, required: 1 });
  });

  it("is absent when no shift covers the event", () => {
    expect(build().crew).toBeUndefined();
  });

  it("matches a shift by eventIds, so a split vessel-day resolves to the right half", () => {
    const morning = shift({ eventIds: [EVENT_ID] });
    const afternoon = shift({
      id: asId<"ShiftId">("shift-1-b"),
      eventIds: [asId<"EventId">("m-evt-2")],
    });
    expect(shiftForEvent([afternoon, morning], String(EVENT_ID))?.id).toBe(SHIFT_ID);
    expect(shiftForEvent([afternoon, morning], "m-evt-2")?.id).toBe("shift-1-b");
    expect(shiftForEvent([afternoon, morning], "nope")).toBeUndefined();
  });
});

describe("formatCents", () => {
  it("formats integer cents as dollars", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(49900)).toBe("$499.00");
    expect(formatCents(7485)).toBe("$74.85");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
  });
  it("signs a negative (over-paid) balance", () => {
    expect(formatCents(-500)).toBe("-$5.00");
  });
});
