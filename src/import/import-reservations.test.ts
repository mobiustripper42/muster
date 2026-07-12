/**
 * Import Map+Reconcile (DEC-015 / DEC-043) — `importRecords` keyed on the real Xola
 * `event.id`, vessel resolved Land-side or recovered from the stored event. The
 * full fetch→shift chain lives in `xola-pull.test.ts` (the G1–G9 harness); this
 * pins the seam's own behavior. Xola date/time parsing (the xlsx-era helpers) keeps
 * its unit tests until that path is retired.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { formShifts } from "../builder/form-shifts.js";
import { asId } from "../domain/ids.js";
import type { VesselId } from "../domain/ids.js";
import { importRecords, type RawReservationRecord } from "./import-reservations.js";
import { seedFleet } from "./resource-map.js";

describe("importRecords — event-id-keyed Map+Reconcile (DEC-043)", () => {
  const BREW = "Brew Boat Party Boats with Captain";
  const VESSEL = asId<"VesselId">("vessel-brew-2");
  const EVENT_ID = asId<"EventId">("evt-1");
  const SHIFT_ID = asId<"ShiftId">("shift-vessel-brew-2-2026-05-16");

  const booked = (reservationId: string, over: Partial<RawReservationRecord> = {}): RawReservationRecord => ({
    reservationId,
    product: BREW,
    date: "2026-05-16",
    time: "15:30",
    eventId: "evt-1",
    vesselId: VESSEL,
    customerName: "Ada",
    partySize: 4,
    status: "booked",
    ...over,
  });
  // A cancelled record carries NO vessel by default (a de-boated trip).
  const cancelled = (reservationId: string, over: Partial<RawReservationRecord> = {}): RawReservationRecord => {
    const { vesselId, ...rest } = booked(reservationId, { status: "cancelled", ...over });
    return over.vesselId !== undefined ? { ...rest, vesselId: over.vesselId } : rest;
  };

  it("keys the event on the real event.id and resolves the booked vessel", async () => {
    const repo = new InMemoryRepository();
    await importRecords(repo, [booked("r1")]);
    const e = await repo.getEvent(EVENT_ID);
    expect(e?.status).toBe("scheduled");
    expect(e?.vesselId).toBe(VESSEL);
  });

  it("skips + itemizes a Xola event on a Muster-owned vessel-day (DEC-106)", async () => {
    const repo = new InMemoryRepository();
    await repo.markVesselDayMusterOwned(VESSEL, "2026-05-16", "2026-05-01T00:00:00.000Z");
    const r = await importRecords(repo, [booked("r1"), booked("r2")]);
    // the event isn't written, and its reservations drop with it (not in `placed`)
    expect(await repo.getEvent(EVENT_ID)).toBeNull();
    expect(await repo.getReservation(asId<"ReservationId">("resv-r1"))).toBeNull();
    expect(r.eventsCreated).toBe(0);
    // both rows are itemized as `muster_owned` skips (same idiom as booked_no_boat)
    const owned = r.skipped.filter((s) => s.category === "muster_owned");
    expect(owned).toHaveLength(2);
    expect(owned[0]!.reason).toContain("Muster-owned");
    expect(owned.map((s) => s.reservationId).sort()).toEqual(["r1", "r2"]);
  });

  it("the ownership guard is inert for a vessel-day not marked owned (DEC-106)", async () => {
    const repo = new InMemoryRepository();
    // mark a DIFFERENT day owned; the trip (2026-05-16) is untouched
    await repo.markVesselDayMusterOwned(VESSEL, "2026-05-17", "2026-05-01T00:00:00.000Z");
    await importRecords(repo, [booked("r1")]);
    expect((await repo.getEvent(EVENT_ID))?.status).toBe("scheduled");
  });

  it("one booked among cancelled → event still scheduled", async () => {
    const repo = new InMemoryRepository();
    await importRecords(repo, [cancelled("r1"), booked("r2")]);
    expect((await repo.getEvent(EVENT_ID))?.status).toBe("scheduled");
  });

  it("an all-cancelled event we've never stored (no boat) is dropped, not invented", async () => {
    const repo = new InMemoryRepository();
    const r = await importRecords(repo, [cancelled("r1")]);
    expect(await repo.getEvent(EVENT_ID)).toBeNull();
    expect(r.eventsCreated).toBe(0);
    const boatless = r.skipped.find((s) => /no resolvable boat/.test(s.reason));
    expect(boatless).toBeDefined();
    // #320: the skip carries WHICH trip got dropped, not just an opaque event id.
    expect(boatless).toMatchObject({
      reservationId: "r1",
      product: BREW,
      date: "2026-05-16",
      time: "15:30",
    });
  });

  it("a de-boated cancel reconciles against the stored event → cancelled", async () => {
    const repo = new InMemoryRepository();
    await importRecords(repo, [booked("r1")]); // event known + boated
    await importRecords(repo, [cancelled("r1")]); // later: 700, no boat in feed
    expect((await repo.getEvent(EVENT_ID))?.status).toBe("cancelled");
  });

  it("missing event id → the record is skipped", async () => {
    const repo = new InMemoryRepository();
    const rec = booked("r1");
    delete rec.eventId;
    const r = await importRecords(repo, [rec]);
    const missing = r.skipped.find((s) => /missing event id/.test(s.reason));
    expect(missing).toBeDefined();
    expect(missing).toMatchObject({ reservationId: "r1", date: "2026-05-16", time: "15:30" }); // #320
    expect((await repo.listEvents()).length).toBe(0);
  });

  it("materiality (DEC-029): re-import preserves updatedAt; a partySize change bumps it", async () => {
    const repo = new InMemoryRepository();
    const t1 = new Date("2026-05-01T00:00:00Z");
    const t2 = new Date("2026-05-02T00:00:00Z");
    await importRecords(repo, [booked("r1")], t1);
    const id = asId<"ReservationId">("resv-r1");
    expect((await repo.getReservation(id))?.updatedAt).toBe(t1.toISOString());

    await importRecords(repo, [booked("r1")], t2); // identical → preserved
    expect((await repo.getReservation(id))?.updatedAt).toBe(t1.toISOString());

    await importRecords(repo, [booked("r1", { partySize: 10 })], t2); // material → bumped
    expect((await repo.getReservation(id))?.updatedAt).toBe(t2.toISOString());
  });

  it("re-import that cancels the only booking cancels the shift (no ghost)", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo); // vessel manning so formShifts can derive seats

    await importRecords(repo, [booked("r1")]);
    await formShifts(repo);
    expect((await repo.getShift(SHIFT_ID))?.state).not.toBe("Cancelled");

    await importRecords(repo, [cancelled("r1")]);
    await formShifts(repo);
    expect((await repo.getShift(SHIFT_ID))?.state).toBe("Cancelled");
  });
});
