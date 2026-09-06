/**
 * confirmPendingRow (14.5, SPEC §2.8.6) — the booking write, driven against the in-memory repo.
 * The adapter-level flip is contract-tested in repository-contract.ts (incl. the concurrent
 * race); this covers the service's outcome mapping: how the row is found, what the Event is
 * built from, and what each outcome leaves behind.
 *
 * The `writeSlotBooking` suite that stood here built a booking from Stripe metadata and
 * inserted it. That write is GONE (issue #916): a confirm that cannot find the row checkout
 * wrote has nothing to book, and a second way to write a booking is what §2.8.6 forbids.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Offering, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { eventIdForSlot } from "./availability.js";
import { confirmPendingRow } from "./write-booking.js";

const NOW = () => "2026-07-01T12:00:00.000Z";
const V = asId<"VesselId">("vessel-brew-2");
const OFF = asId<"OfferingId">("off-1");
const PEND = asId<"ReservationId">("resv-pend-1");
const SLOT = eventIdForSlot(V, "2026-07-04", "17:00");

const offering = (over: Partial<Offering> = {}): Offering => ({
  id: OFF,
  tenantId: asId<"TenantId">("t"),
  name: "Sunset Cruise",
  status: "live",
  vesselIds: [V],
  locationId: asId<"LocationId">("loc-1"),
  schedule: {
    seasonStart: "2026-06-01",
    seasonEnd: "2026-08-31",
    weekdays: [5],
    departureTimes: ["17:00"],
  },
  basePriceCents: 49900,
  priceVariations: [],
  extraGuestPriceCents: 5000,
  tripLengthMinutes: 240,
  ...over,
});

/** The row checkout wrote before Stripe (14.4): names the slot, both durations frozen. */
const pendingRow = (over: Partial<Reservation> = {}): Reservation => ({
  id: PEND,
  eventId: null,
  source: "muster",
  status: "pending",
  customerName: "Mary",
  partySize: 6,
  phone: "216-555-0148",
  vesselId: V,
  date: "2026-07-04",
  time: "17:00",
  offeringId: OFF,
  reservedAt: "2026-07-01T11:55:00.000Z",
  holdMinutes: 240,
  tripMinutes: 240,
  paymentIntentId: "pi_1",
  ...over,
});

async function world(row: Reservation | null = pendingRow()): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveOffering(offering());
  await repo.saveVessel({ id: V, name: "Brew 2", coiMaxPax: 12, manning: [] });
  if (row) await repo.saveReservation(row);
  return repo;
}

const confirm = (repo: InMemoryRepository, paymentIntentId = "pi_1") =>
  confirmPendingRow(repo, { paymentIntentId, priceCents: 49900, extrasCents: 5000 }, NOW);

describe("confirmPendingRow — the pending row becomes the booking (§2.8.6)", () => {
  it("flips the row: booked, eventId set, the Event materialized from the row and the charge", async () => {
    const repo = await world();

    const r = await confirm(repo);

    expect(r.outcome).toBe("booked");
    if (r.outcome !== "booked") return;
    // Same row, not a new one — the id checkout minted is the booking's id for life.
    expect(r.reservation).toMatchObject({ id: PEND, status: "booked", eventId: SLOT, extrasCents: 5000 });
    expect(await repo.listAllReservations()).toHaveLength(1);
    const ev = (await repo.getEvent(SLOT))!;
    // Slot from the row; price from the charge (until 15.1); capacity from the vessel; trip
    // time from the row's frozen value, never the offering's live one (DEC-161).
    expect(ev).toMatchObject({ vesselId: V, date: "2026-07-04", time: "17:00", price: 49900, capacity: 12, durationMinutes: 240 });
  });

  it("FROZEN, not resolved on read: the Event runs for the row's trip time after the offering is edited", async () => {
    // Criterion 20 at the service level. The row froze 240 at checkout-start; the operator
    // then shortens the offering while the customer is typing a card number.
    const repo = await world();
    await repo.saveOffering(offering({ tripLengthMinutes: 90 }));

    const r = await confirm(repo);

    expect(r.outcome).toBe("booked");
    expect((await repo.getEvent(SLOT))?.durationMinutes).toBe(240);
  });

  it("resolves the customer at confirm and writes customerId onto the flipped row (§2.8.6 step 4)", async () => {
    const repo = await world();

    const r = await confirm(repo);

    expect(r.outcome).toBe("booked");
    const stored = (await repo.getReservation(PEND))!;
    expect(stored.customerId).toBeDefined();
    expect(await repo.getCustomer(stored.customerId!)).not.toBeNull();
  });

  it("no row carries the payment intent → unconfirmable, nothing written", async () => {
    const repo = await world(null);

    const r = await confirm(repo, "pi_nobody_minted");

    expect(r).toEqual({ outcome: "unconfirmable", reason: "no_row" });
    expect(await repo.listAllReservations()).toHaveLength(0);
    expect(await repo.listEvents()).toHaveLength(0);
  });

  it("already: a row that is booked reports already, with the row — no second Event, no second row", async () => {
    const repo = await world();
    expect((await confirm(repo)).outcome).toBe("booked");

    const again = await confirm(repo);

    expect(again.outcome).toBe("already");
    if (again.outcome !== "already") return;
    expect(again.reservation).toMatchObject({ id: PEND, status: "booked" });
    expect(await repo.listAllReservations()).toHaveLength(1);
    expect(await repo.listEvents()).toHaveLength(1);
  });

  it("lost: a rival booked on the hull → lost, and the row stays pending", async () => {
    // What happens to the row after a loss is 15.2's (refund + tell, on the row's own phone).
    // Here it must simply not become a booking.
    const repo = await world();
    await repo.saveEvent({ id: asId<"EventId">("evt-rival"), vesselId: V, date: "2026-07-04", time: "17:00", capacity: 12, status: "scheduled", source: "xola" });

    const r = await confirm(repo);

    expect(r.outcome).toBe("lost");
    expect((await repo.getReservation(PEND))!.status).toBe("pending");
    expect(await repo.getEvent(SLOT)).toBeNull();
  });

  it("a cancelled row carrying the intent id is unconfirmable (not_pending) — never resurrected by a payment", async () => {
    const repo = await world(pendingRow({ status: "cancelled" }));

    const r = await confirm(repo);

    expect(r).toEqual({ outcome: "unconfirmable", reason: "not_pending" });
    expect((await repo.getReservation(PEND))!.status).toBe("cancelled");
  });
});
