/**
 * writeSlotBooking (12.5, DEC-125) — the booking-write service, driven against the in-memory
 * repo. Its `writeBooking` (11.3) sibling was retired at #693; see the note below.
 * The adapter-level atomic claim is contract-tested in repository-contract.ts (incl. the
 * concurrent-claims race); this covers the service's outcome mapping + idempotency.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Offering } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { writeSlotBooking } from "./write-booking.js";

// `musterEvent`, `EVENT` and the `req()` BookingRequest builder went with the
// `describe("writeBooking")` block (#693) — they had no other consumer.
const NOW = () => "2026-07-01T00:00:00.000Z";
const V = asId<"VesselId">("vessel-brew-2");

// The `describe("writeBooking")` block that stood here is GONE (#693). It covered the legacy
// 11.3 write — booked / already / already_claimed / lost / unbookable×3 — for a function that
// claimed a boat by row-locking one `event_id`, which is exactly the pre-#691 behaviour where
// two overlapping trips on one hull both succeed. Nothing minted sessions for it, so it was an
// unguarded fallback rather than a removed path, and the tests were the last thing keeping it
// compiling. `writeSlotBooking` below is the live path and carries the hull guard.

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
