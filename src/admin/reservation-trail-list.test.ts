/**
 * The reservation trail's cross-booking feed (issue #1049).
 *
 * Its counterpart is `reservation-trail-view.ts`, which assembles ONE booking's history from
 * five sources. This one answers a different question — "what happened today, across every
 * booking" — and can only answer it over the emitted half. Most of what is pinned here is that
 * boundary, because a feed that silently drops event classes is worse than one that says what
 * it covers.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { TrailEvent } from "../domain/reservation-trail.js";
import {
  buildReservationTrailList,
  TRAIL_ACTOR_LABEL,
  TRAIL_BEGINS_AT,
  TRAIL_TYPE_LABEL,
} from "./reservation-trail-list.js";
import { EMITTED_TRAIL_TYPES, DERIVED_TRAIL_TYPES, TRAIL_ACTOR_KINDS } from "../domain/reservation-trail.js";

const RES = asId<"ReservationId">("resv-1");

const trail = (over: Partial<TrailEvent> = {}): TrailEvent => ({
  id: asId<"TrailEventId">("t-1"),
  reservationId: RES,
  actorKind: "engine",
  type: "auto_refunded",
  timestamp: "2026-09-21T12:00:00.000Z",
  metadata: {},
  ...over,
});

async function seeded(events: TrailEvent[], withBooking = true): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  if (withBooking) {
    await repo.saveReservation({
      id: RES,
      eventId: null,
      source: "muster",
      status: "pending",
      customerName: "Mary Brody",
      partySize: 4,
    });
  }
  for (const e of events) await repo.appendTrailEvent(e);
  return repo;
}

describe("buildReservationTrailList — what it covers", () => {
  it("returns the emitted rows newest first", async () => {
    const repo = await seeded([
      trail({ id: asId<"TrailEventId">("old"), timestamp: "2026-09-20T09:00:00.000Z" }),
      trail({ id: asId<"TrailEventId">("new"), timestamp: "2026-09-21T17:00:00.000Z" }),
    ]);
    const rows = await buildReservationTrailList(repo, {});
    expect(rows.map((r) => String(r.id))).toEqual(["new", "old"]);
  });

  it("shows NOTHING derived, however much derivable history the booking has", async () => {
    // **The boundary this feed lives on.** One booking's page unions five sources; this one
    // cannot, because deriving across every booking means loading every reservation, payment,
    // gratuity and import row in the database. A payment exists here and produces no
    // `payment_succeeded` row — that fact is only visible on the booking's own page.
    const repo = await seeded([trail()]);
    await repo.savePayment({
      id: asId<"PaymentId">("pay-1"),
      reservationId: RES,
      method: "stripe",
      kind: "full",
      amountCents: 50000,
      taxCents: 0,
      currency: "usd",
      status: "succeeded",
      createdAt: "2026-09-21T11:00:00.000Z",
    });

    const rows = await buildReservationTrailList(repo, {});
    expect(rows.map((r) => r.type)).toEqual(["auto_refunded"]);
  });

  it("keeps a row whose booking has NO reservation at all", async () => {
    // The class the feed exists for: money with nothing to hang it on. A booking-scoped view
    // cannot show these, so if the feed dropped them they would be written and never seen.
    // Built literally rather than through `trail()`: `exactOptionalPropertyTypes` refuses
    // `reservationId: undefined` in a `Partial`, and that is the type doing its job — the key
    // being ABSENT is the whole point of this case, and "present but undefined" is a different
    // shape the adapters would round-trip differently.
    const repo = await seeded(
      [
        {
          id: asId<"TrailEventId">("unmatched"),
          paymentIntentId: asId<"PaymentIntentId">("pi_nobody"),
          actorKind: "stripe",
          type: "charge_unmatched",
          timestamp: "2026-09-21T12:00:00.000Z",
          metadata: {},
        },
      ],
      false,
    );
    const rows = await buildReservationTrailList(repo, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customerName).toBeUndefined();
    expect(String(rows[0]?.paymentIntentId)).toBe("pi_nobody");
  });

  it("keeps a row whose booking was REAPED, and does not pretend to name it", async () => {
    // A dangling reservation id is the designed steady state, not an orphan — the trail has no
    // FK precisely so a row survives §2.8.8 deleting the lapsed row it describes.
    const repo = await seeded([trail({ reservationId: asId<"ReservationId">("resv-gone") })], false);
    const rows = await buildReservationTrailList(repo, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customerName).toBeUndefined();
  });

  it("names the customer when the booking is still there", async () => {
    // Without this the feed is a wall of `resv-<32 hex>` and nobody can read it.
    const repo = await seeded([trail()]);
    const rows = await buildReservationTrailList(repo, {});
    expect(rows[0]?.customerName).toBe("Mary Brody");
  });
});

describe("buildReservationTrailList — filters", () => {
  const world = () =>
    seeded([
      trail({ id: asId<"TrailEventId">("a"), type: "auto_refunded", actorKind: "engine" }),
      trail({ id: asId<"TrailEventId">("b"), type: "booked", actorKind: "customer" }),
      trail({ id: asId<"TrailEventId">("c"), type: "booked", actorKind: "admin", actorId: "crew-9" }),
    ]);

  it("filters by type", async () => {
    const rows = await buildReservationTrailList(await world(), { type: "booked" });
    expect(rows.map((r) => String(r.id)).sort()).toEqual(["b", "c"]);
  });

  it("filters by actor kind", async () => {
    const rows = await buildReservationTrailList(await world(), { actorKind: "admin" });
    expect(rows.map((r) => String(r.id))).toEqual(["c"]);
  });

  it("composes both, and an impossible pair returns nothing rather than everything", async () => {
    // The failure worth pinning: a filter that silently falls back to unfiltered looks like a
    // working page right up until somebody trusts it.
    expect(
      await buildReservationTrailList(await world(), { type: "auto_refunded", actorKind: "admin" }),
    ).toEqual([]);
  });

  it("an empty filter is not a filter", async () => {
    expect(await buildReservationTrailList(await world(), {})).toHaveLength(3);
  });
});

describe("the vocabulary the surface renders", () => {
  it("every type a reader can see has a label", async () => {
    // Both halves: the feed shows emitted rows, the booking page shows derived ones too, and
    // one label map serves both. A type added without a label renders as a raw enum string on
    // an operator's screen, which is the defect this catches at build time.
    for (const t of [...EMITTED_TRAIL_TYPES, ...DERIVED_TRAIL_TYPES]) {
      expect(TRAIL_TYPE_LABEL[t], `no label for ${t}`).toBeTruthy();
    }
  });

  it("every actor kind has a label", () => {
    for (const a of TRAIL_ACTOR_KINDS) expect(TRAIL_ACTOR_LABEL[a], `no label for ${a}`).toBeTruthy();
  });

  it("no label is a raw identifier", () => {
    // **A weaker check than the one I first wrote, and the weaker one is the honest one.** The
    // first version flagged any label that reformatted its type — which called `booked` → "Booked"
    // lazy, when that IS the label. Whether "Sold-out notice failed" says more than
    // `sold_out_notice_failed` is a judgment no assertion can make. This catches the thing that
    // is unambiguously broken: an underscore reaching an operator's screen.
    const raw = Object.entries(TRAIL_TYPE_LABEL).filter(([, label]) => label.includes("_"));
    expect(raw).toEqual([]);
  });

  it("states when capture began, as a date the surface can show", () => {
    expect(TRAIL_BEGINS_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
