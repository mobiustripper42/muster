/**
 * The operator books (16.1, SPEC §2.10.6) — the phone booking's write. A `pending` row with
 * `source: "admin"`, no Event and no payment window, on the boat the operator clicked, priced by
 * the same model as public checkout.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { priceBooking } from "./booking-invoice.js";
import { bookForCustomer, type OperatorBookingRequest } from "./operator-booking.js";

const SMALL = asId<"VesselId">("v-small"); // coiMaxPax 6
const BIG = asId<"VesselId">("v-big"); //   coiMaxPax 12
const OFF = asId<"OfferingId">("off-1");
const DATE = "2026-07-04";
const TIME = "13:30";
const NOW = "2026-07-01T12:00:00.000Z";
const now = () => NOW;

const vessel = (id: typeof SMALL, coiMaxPax: number): Vessel => ({ id, name: String(id), coiMaxPax, manning: [] });

const offering = (over: Partial<Offering> = {}): Offering => ({
  id: OFF,
  tenantId: asId<"TenantId">("t"),
  name: "Cruise",
  status: "live",
  vesselIds: [BIG, SMALL],
  locationId: asId<"LocationId">("loc-1"),
  schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: [TIME] },
  basePriceCents: 49900,
  priceVariations: [],
  extraGuestPriceCents: 5000,
  tripLengthMinutes: 100,
  holdMinutes: 120,
  ...over,
});

async function seededRepo(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveOffering(offering());
  await repo.saveVessel(vessel(SMALL, 6));
  await repo.saveVessel(vessel(BIG, 12));
  return repo;
}

const ask = (over: Partial<OperatorBookingRequest> = {}): OperatorBookingRequest => ({
  offeringId: OFF,
  vesselId: SMALL,
  date: DATE,
  time: TIME,
  guestCount: 4,
  gratuityBps: 2000,
  customerName: "Martin Brody",
  phone: "(216) 555-0142",
  ...over,
});

describe("bookForCustomer — the operator's phone booking (16.1)", () => {
  it("writes an unpaid `admin` row on the boat the operator clicked — no Event, no window, no token", async () => {
    const repo = await seededRepo();
    const res = await bookForCustomer(repo, ask({ email: "brody@amity.gov" }), now);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const stored = (await repo.getReservation(res.reservation.id))!;
    expect(stored).toMatchObject({
      source: "admin",
      status: "pending",
      eventId: null,
      vesselId: SMALL,
      date: DATE,
      time: TIME,
      offeringId: OFF,
      partySize: 4,
      customerName: "Martin Brody",
      email: "brody@amity.gov",
      holdMinutes: 120,
      tripMinutes: 100,
      updatedAt: NOW,
    });
    // DEC-163: no window. `reservedAt` is what a lapse is computed from, so an admin row has none.
    expect(stored.reservedAt).toBeUndefined();
    // Checkout's cookie token and the customer's own waiver consent are not the operator's to give.
    expect(stored.holderToken).toBeUndefined();
    expect(stored.waiverConsentAt).toBeUndefined();
    expect(await repo.listEvents()).toHaveLength(0);
  });

  it("stores the phone in canonical form — it is the customer's identity key (DEC-132)", async () => {
    const repo = await seededRepo();
    const res = await bookForCustomer(repo, ask(), now);
    expect(res.ok && res.reservation.phone).toBe("+12165550142");
  });

  it("prices through the SAME model as public checkout — one trip never quotes two totals (§2.10.6)", async () => {
    const repo = await seededRepo();
    const res = await bookForCustomer(repo, ask({ guestCount: 6, gratuityBps: 2500 }), now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.reservation.invoice).toEqual(
      priceBooking({
        offering: offering(),
        vessel: vessel(SMALL, 6),
        vesselId: SMALL,
        events: [],
        config: await repo.getPaymentConfig(),
        date: DATE,
        time: TIME,
        guestCount: 6,
        gratuityBps: 2500,
      }),
    );
  });

  it("the tip is asked the same way as checkout — one of the offering's tiers, no decline", async () => {
    const repo = await seededRepo();
    expect(await bookForCustomer(repo, ask({ gratuityBps: 0 }), now)).toEqual({
      ok: false,
      reason: "gratuity_required",
    });
    expect(await repo.listAllReservations()).toHaveLength(0);
  });

  it("refuses without a name, and without a usable phone — nothing written", async () => {
    const repo = await seededRepo();
    expect(await bookForCustomer(repo, ask({ customerName: "   " }), now)).toEqual({
      ok: false,
      reason: "name_required",
    });
    expect(await bookForCustomer(repo, ask({ phone: "555" }), now)).toEqual({ ok: false, reason: "phone_invalid" });
    expect(await repo.listAllReservations()).toHaveLength(0);
  });

  it("a party bigger than the boat refuses (issue #767)", async () => {
    const repo = await seededRepo();
    expect(await bookForCustomer(repo, ask({ guestCount: 7 }), now)).toEqual({ ok: false, reason: "over_capacity" });
  });

  it("a blocked slot refuses — unblock it first", async () => {
    const repo = await seededRepo();
    await repo.saveBlock({ id: asId<"BlockId">("b-1"), kind: "vesselHold", vesselId: SMALL, date: DATE, time: TIME });
    expect(await bookForCustomer(repo, ask(), now)).toEqual({ ok: false, reason: "blocked" });
    expect(await repo.listAllReservations()).toHaveLength(0);
  });

  it("a busy hull refuses — the boat is out then", async () => {
    const repo = await seededRepo();
    expect((await bookForCustomer(repo, ask(), now)).ok).toBe(true);
    expect(await bookForCustomer(repo, ask({ customerName: "Matt Hooper" }), now)).toEqual({
      ok: false,
      reason: "busy",
    });
  });
});
