/**
 * writeBooking (11.3) — the booking-write service, driven against the in-memory repo.
 * The adapter-level atomic claim is contract-tested in repository-contract.ts (incl. the
 * concurrent-claims race); this covers the service's outcome mapping + idempotency.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Event, Offering } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import {
  reservationIdFor,
  writeBooking,
  writeSlotBooking,
  type BookingRequest,
} from "./write-booking.js";

const NOW = () => "2026-07-01T00:00:00.000Z";
const V = asId<"VesselId">("vessel-brew-2");
const EVENT = asId<"EventId">("m-evt-1");

const musterEvent = (over: Partial<Event> = {}): Event => ({
  id: EVENT,
  vesselId: V,
  date: "2026-07-04",
  time: "17:00",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  ...over,
});

const req = (over: Partial<BookingRequest> = {}): BookingRequest => ({
  eventId: EVENT,
  customerName: "Mary",
  partySize: 6,
  idempotencyKey: "sess_1",
  ...over,
});

describe("writeBooking", () => {
  it("booked: writes the reservation with a deterministic id and claims the boat", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    const r = await writeBooking(repo, req(), NOW);
    expect(r.outcome).toBe("booked");
    if (r.outcome === "booked") {
      expect(r.reservation.source).toBe("muster");
      expect(r.reservation.status).toBe("booked");
      expect(String(r.reservation.id)).toBe(String(reservationIdFor("sess_1")));
      expect(r.reservation.updatedAt).toBe("2026-07-01T00:00:00.000Z");
    }
    expect(await repo.listReservationsForEvent(EVENT)).toHaveLength(1);
  });

  it("carries waiver consent onto the booked reservation (11.5, DEC-110)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    const r = await writeBooking(
      repo,
      req({ waiverConsentAt: "2026-07-01T00:00:00.000Z", waiverVersion: "v1" }),
      NOW,
    );
    expect(r.outcome).toBe("booked");
    if (r.outcome === "booked") {
      expect(r.reservation.waiverConsentAt).toBe("2026-07-01T00:00:00.000Z");
      expect(r.reservation.waiverVersion).toBe("v1");
    }
  });

  it("already: a retry with the same idempotency key is a no-op (no double-write)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    await writeBooking(repo, req(), NOW);
    const again = await writeBooking(repo, req(), NOW);
    expect(again.outcome).toBe("already");
    expect(await repo.listReservationsForEvent(EVENT)).toHaveLength(1);
  });

  it("already_claimed: the pre-check catches a boat a different party already holds", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    await writeBooking(repo, req({ idempotencyKey: "sess_rival" }), NOW); // rival wins the boat
    const r = await writeBooking(repo, req({ idempotencyKey: "sess_me" }), NOW);
    expect(r).toMatchObject({ outcome: "unbookable", reason: "already_claimed" });
    expect(await repo.listReservationsForEvent(EVENT)).toHaveLength(1);
  });

  it("lost: pre-check passes but the atomic claim loses the race (refund-and-notify seam)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    // Force the true race: the boat reads free at the pre-check, but a rival commits
    // before our CAS, which then loses and lands no row for our id.
    repo.saveReservationIfUnclaimed = async () => false;
    const r = await writeBooking(repo, req({ idempotencyKey: "sess_me" }), NOW);
    expect(r.outcome).toBe("lost");
  });

  it("unbookable: event_missing", async () => {
    const repo = new InMemoryRepository();
    expect(await writeBooking(repo, req(), NOW)).toEqual({
      outcome: "unbookable",
      reason: "event_missing",
    });
  });

  it("unbookable: not_sellable — Xola or cancelled event", async () => {
    const xola = new InMemoryRepository();
    await xola.saveEvent(musterEvent({ source: "xola" }));
    expect(await writeBooking(xola, req(), NOW)).toMatchObject({ reason: "not_sellable" });

    const cancelled = new InMemoryRepository();
    await cancelled.saveEvent(musterEvent({ status: "cancelled" }));
    expect(await writeBooking(cancelled, req(), NOW)).toMatchObject({ reason: "not_sellable" });
  });

  it("unbookable: invalid_party — over capacity, zero, or non-integer", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent({ capacity: 12 }));
    expect(await writeBooking(repo, req({ partySize: 13 }), NOW)).toMatchObject({ reason: "invalid_party" });
    expect(await writeBooking(repo, req({ partySize: 0 }), NOW)).toMatchObject({ reason: "invalid_party" });
    expect(await writeBooking(repo, req({ partySize: 2.5 }), NOW)).toMatchObject({ reason: "invalid_party" });
    expect(await repo.listReservationsForEvent(EVENT)).toHaveLength(0); // nothing written
  });
});

// ── writeSlotBooking: the LIVE path (12.5, DEC-125) ──────────────────────────

const OFF = asId<"OfferingId">("off-1");

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
  ...over,
});

async function slotRepo(over?: Partial<Offering>): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  if (over !== undefined) await repo.saveOffering(offering(over));
  await repo.saveVessel({ id: V, name: "Brew 2", coiMaxPax: 12, manning: [] });
  return repo;
}

const bookSlot = (repo: InMemoryRepository, key = "cs_slot_1") =>
  writeSlotBooking(
    repo,
    {
      offeringId: OFF,
      vesselId: V,
      date: "2026-07-04",
      time: "17:00",
      guestCount: 6,
      priceCents: 49900,
      customerName: "Mary",
      phone: "216-555-0148",
      idempotencyKey: key,
    },
    NOW,
  );

/**
 * The #570 duration freeze. This is a booking-path field with a CREW-path
 * consequence: it's what `shiftEndFromEvents` reads, so it decides when the tick's
 * completion sweep pays out reliability. Hence its own suite rather than riding the
 * price assertions.
 */
describe("writeSlotBooking — trip duration frozen onto the Event (#570)", () => {
  it("stamps the offering's tripLengthMinutes on the materialized event", async () => {
    const repo = await slotRepo({ tripLengthMinutes: 240 });

    const r = await bookSlot(repo);

    expect(r.outcome).toBe("booked");
    if (r.outcome !== "booked") return;
    expect((await repo.getEvent(r.eventId))?.durationMinutes).toBe(240);
  });

  it("leaves it absent when the offering sets no length — the flat fallback applies", async () => {
    const repo = await slotRepo({}); // offering saved, tripLengthMinutes unset

    const r = await bookSlot(repo);

    expect(r.outcome).toBe("booked");
    if (r.outcome !== "booked") return;
    expect((await repo.getEvent(r.eventId))?.durationMinutes).toBeUndefined();
  });

  it("still books when the offering row is missing — a config error must not cost a sale", async () => {
    const repo = await slotRepo(); // no offering at all

    const r = await bookSlot(repo);

    expect(r.outcome).toBe("booked");
    if (r.outcome !== "booked") return;
    expect((await repo.getEvent(r.eventId))?.durationMinutes).toBeUndefined();
  });

  it("FROZEN, not resolved on read: editing the offering later leaves the booked event alone", async () => {
    // The whole reason this is a column and not a join, and the same reason `price`
    // is frozen two lines above it in the materializer (DEC-125). Without the freeze,
    // re-configuring an offering next season would silently rewrite how long LAST
    // season's shifts were — and so who earned reliability on them.
    const repo = await slotRepo({ tripLengthMinutes: 240 });
    const r = await bookSlot(repo);
    expect(r.outcome).toBe("booked");
    if (r.outcome !== "booked") return;

    await repo.saveOffering(offering({ tripLengthMinutes: 90 }));

    expect((await repo.getEvent(r.eventId))?.durationMinutes).toBe(240);
  });
});
