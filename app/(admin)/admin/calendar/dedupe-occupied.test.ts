/**
 * `dedupeOccupied` — one card per PHYSICAL trip on the operator's calendar.
 *
 * Two live offerings can schedule the same boat at the same time (the demo cruise and the river
 * cruise both sell Brew 3 at 13:30), and the deriver emits one `VirtualSlot` per offering because
 * slots carry `offeringId`. When those slots describe the same OCCUPIED trip, drawing both stacks
 * two identical cards with the same customer's name on top of each other.
 *
 * **This had no test until 14.9, which is why 14.9 broke it.** Adding `held` and `departed` to the
 * status union left them out of the dedup condition, so a shared boat-time drew two "Checking out"
 * cards for one customer's checkout. `@code-review` caught it; nothing else could have.
 *
 * The rule is about what the status DESCRIBES, not about it being unsellable: `blocked` is also
 * unsellable and is deliberately NOT collapsed, because a block is per-offering and two of them
 * are two real operator acts.
 */
import { describe, expect, it } from "vitest";
import { asId } from "@core/domain/ids.js";
import type { VirtualSlot } from "@core/reservations/availability.js";
import { dedupeOccupied } from "./calendar-view";

const V = asId<"VesselId">("vessel-brew-3");

/** Two offerings, one boat, one time — the collision this function is about. */
const pair = (status: VirtualSlot["status"]): VirtualSlot[] =>
  ["off-river", "off-demo"].map((o) => ({
    offeringId: asId<"OfferingId">(o),
    vesselId: V,
    date: "2026-07-04",
    time: "13:30",
    capacity: 12,
    priceCents: 49900,
    status,
  }));

describe("dedupeOccupied — one card per physical trip", () => {
  it.each(["booked", "unavailable", "held", "departed"] as const)(
    "collapses two offerings sharing a boat-time when the slot is `%s`",
    (status) => {
      expect(dedupeOccupied(pair(status))).toHaveLength(1);
    },
  );

  it("keeps BOTH when the slot is `available` — two offerings on sale is a real choice", () => {
    // Hiding one would hide a departure the operator could actually sell.
    expect(dedupeOccupied(pair("available"))).toHaveLength(2);
  });

  it("keeps BOTH when the slot is `blocked` — a block is per-offering, not per-hull", () => {
    expect(dedupeOccupied(pair("blocked"))).toHaveLength(2);
  });

  it("keeps the survivor deterministic rather than deriver-order dependent", () => {
    // Sorted by offeringId, so the same input in either order yields the same card.
    const [a, b] = pair("held");
    expect(dedupeOccupied([a!, b!])[0]!.offeringId).toBe(
      dedupeOccupied([b!, a!])[0]!.offeringId,
    );
  });

  it("does not collapse across DIFFERENT boat-times", () => {
    // The key is the physical slot; two occupied trips on one boat at two times are two trips.
    const slots = [pair("held")[0]!, { ...pair("held")[1]!, time: "16:00" }];
    expect(dedupeOccupied(slots)).toHaveLength(2);
  });
});
