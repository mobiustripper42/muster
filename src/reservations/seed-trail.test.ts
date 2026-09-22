/**
 * The booking-audit seed's builder (issue #1049).
 *
 * One case here carries the file: **every emitted type is covered, walked from the union
 * itself.** The seed exists so a surface can be reviewed against realistic material, and a seed
 * that silently stops covering a type is worse than none — the page looks complete and the one
 * row nobody checked is the one that renders badly in production.
 */

import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import { EMITTED_TRAIL_TYPES } from "../domain/reservation-trail.js";
import { buildSeededTrail } from "./seed-trail.js";

const RES = asId<"ReservationId">("resv-seed-1");
const ANCHOR = "2026-09-22T12:00:00.000Z";

const build = () =>
  buildSeededTrail({
    reservationId: RES,
    paymentIntentId: "pi_seed_1",
    anchorISO: ANCHOR,
    customerName: "Mary Brody",
    eventId: "evt-seed-1",
    slot: { vesselId: "vessel-brew-4", date: "2026-09-26", time: "17:00", offeringId: "off-seed" },
  });

describe("buildSeededTrail — coverage", () => {
  it("emits exactly one row per emitted type, walked from the union", () => {
    // **The case that makes the seed worth keeping.** Adding a type to `EMITTED_TRAIL_TYPES`
    // without adding it here turns this red, which is the only thing standing between "the seed
    // covers everything" and that sentence quietly becoming false.
    const types = build().events.map((e) => e.type);
    expect([...types].sort()).toEqual([...EMITTED_TRAIL_TYPES].sort());
  });

  it("gives every row a distinct id, deterministic across runs", () => {
    // Deterministic so re-running upserts rather than accumulating — the adapter's
    // `on conflict (id) do nothing` only helps if the id is stable.
    const first = build().events.map((e) => String(e.id));
    expect(new Set(first).size).toBe(first.length);
    expect(build().events.map((e) => String(e.id))).toEqual(first);
  });

  it("places every row before the anchor, spanning more than one day", () => {
    const times = build().events.map((e) => Date.parse(e.timestamp));
    expect(Math.max(...times)).toBeLessThan(Date.parse(ANCHOR));
    const spanDays = (Math.max(...times) - Math.min(...times)) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeGreaterThan(1);
  });
});

describe("buildSeededTrail — the rows a booking-scoped view cannot show", () => {
  it("includes a charge with no booking, keyed on the intent alone", () => {
    // The class the feed page exists for. If the seed omitted it, the one surface that needs
    // reviewing hardest would be reviewed against rows that all have a booking.
    const row = build().events.find((e) => e.type === "charge_unmatched");
    expect(row?.reservationId).toBeUndefined();
    expect(String(row?.paymentIntentId)).toBe("pi_seed_orphan");
  });

  it("includes the two slot rows, which carry NEITHER key", () => {
    const rows = build().events.filter((e) => e.type === "slot_held" || e.type === "slot_released");
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.reservationId).toBeUndefined();
      expect(r.paymentIntentId).toBeUndefined();
    }
  });

  it("keys every other row to the booking, so the History panel is not empty", () => {
    const keyless = new Set(["charge_unmatched", "slot_held", "slot_released"]);
    for (const e of build().events) {
      if (keyless.has(e.type)) continue;
      expect(String(e.reservationId), `${e.type} lost its booking`).toBe(String(RES));
    }
  });
});

describe("buildSeededTrail — the abandoned second booking", () => {
  it("is a lapsed muster PENDING row, so checkout_lapsed is reachable at all", () => {
    // The gap the script's verify step found on its first real run: `checkout_lapsed` only fires
    // for a pending row past its window, the demo world builds only booked rows, and so the seed
    // silently covered 32 of 33.
    const r = build().lapsedCheckout;
    expect(r.status).toBe("pending");
    // `source: "admin"` would reintroduce the gap — those have no window and never lapse
    // (DEC-163), which `isLivePending` knows and the deriver asks it about.
    expect(r.source).toBe("muster");
    expect(Date.parse(r.reservedAt!)).toBeLessThan(Date.parse(ANCHOR) - 60 * 60 * 1000);
  });

  it("is a different booking from the one the audit hangs off", () => {
    const s = build();
    expect(String(s.lapsedCheckout.id)).not.toBe(String(RES));
  });
});

describe("buildSeededTrail — the facts the DERIVED half is read from", () => {
  it("supplies a payment, a disputed payment, a tip and an import run", () => {
    // Seeding `payment_succeeded` as a trail row would produce a page that looks right and
    // exercises none of the union — these are the rows the deriver actually reads.
    const s = build();
    expect(s.payments.map((p) => p.status).sort()).toEqual(["disputed", "succeeded"]);
    expect(s.gratuity.amountCents).toBeGreaterThan(0);
    expect(s.importRun.items[0]?.refId).toBe(String(RES));
    expect(s.importRun.items[0]?.runId).toBe(s.importRun.run.id);
  });

  it("supplies the two reservation columns the deriver projects from", () => {
    const { reservationPatch } = build();
    expect(reservationPatch.reservedAt).toBeTruthy();
    expect(reservationPatch.confirmationSentAt).toBeTruthy();
    // `checkout_started` renders the attempt count, so a 1 would hide the retry story.
    expect(reservationPatch.checkoutAttempts).toBeGreaterThan(1);
  });

  it("dates the import run BEFORE the checkout it describes", () => {
    // Ordering is the union read's hardest job and this is the seed's one chance to exercise it
    // across sources: the import's clock comes from `import_runs`, the checkout's from
    // `reservations.reserved_at`, and they must not arrive in the wrong order on screen.
    const s = build();
    expect(Date.parse(s.importRun.run.ranAt)).toBeLessThan(Date.parse(s.reservationPatch.reservedAt!));
  });
});
