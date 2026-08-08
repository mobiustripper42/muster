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

  /**
   * Customer identity on the import path (#701, DEC-132).
   *
   * The booking path resolves a customer and stamps `customer_id`; the importer never did, so
   * every imported reservation landed unlinked. That is invisible today and ruinous at the
   * DEC-126 cutover, when the entire back catalogue arrives through this function: a returning
   * guest who booked via Xola would read as brand new, and repeat-guest history — the reason
   * the table exists — would start at the cutover.
   *
   * Phone-first, exactly as `resolveCustomerId` and `db:backfill:customers` do it. Two
   * implementations of "the same person" would drift, and the second one would be this one.
   */
  describe("customer identity (#701)", () => {
    const rid = (r: string) => asId<"ReservationId">(`resv-${r}`);

    it("resolves one customer for two bookings whose phone is spelled differently", async () => {
      const repo = new InMemoryRepository();
      await importRecords(repo, [
        booked("r1", { customerName: "Nora Blake", phone: "(216) 555-0148" }),
        booked("r2", { customerName: "nora blake", phone: "+1 216-555-0148" }),
      ]);

      const a = await repo.getReservation(rid("r1"));
      const b = await repo.getReservation(rid("r2"));
      expect(a?.customerId).toBeDefined();
      // The canonicalizer's job, asserted through the importer: one person, one row.
      expect(b?.customerId).toBe(a?.customerId);
      expect(await repo.listCustomers()).toHaveLength(1);
    });

    it("leaves a record with no usable phone unlinked, and creates no customer", async () => {
      const repo = new InMemoryRepository();
      await importRecords(repo, [
        booked("r1"), // the base record carries no phone
        booked("r2", { customerName: "Sarah", phone: "not-a-phone" }),
      ]);

      expect((await repo.getReservation(rid("r1")))?.customerId).toBeUndefined();
      expect((await repo.getReservation(rid("r2")))?.customerId).toBeUndefined();
      // Matching on NAME would merge two different Sarahs. Unlinked is the honest answer, and
      // it is the same one `db:backfill:customers` gives for the same input.
      expect(await repo.listCustomers()).toHaveLength(0);
    });

    /**
     * A link may MOVE but must never be REMOVED. Xola dropping a phone on a later pull is an
     * upstream data wobble, not evidence the booking belongs to nobody — and an import that
     * silently unlinks history reports nothing while doing it.
     */
    it("keeps the existing link when a re-import arrives with the phone gone", async () => {
      const repo = new InMemoryRepository();
      await importRecords(repo, [booked("r1", { phone: "(216) 555-0148" })]);
      const linked = (await repo.getReservation(rid("r1")))?.customerId;
      expect(linked).toBeDefined();

      await importRecords(repo, [booked("r1")]); // same booking, no phone this time
      expect((await repo.getReservation(rid("r1")))?.customerId).toBe(linked);
    });

    it("follows the customer when the phone genuinely changes", async () => {
      const repo = new InMemoryRepository();
      await importRecords(repo, [booked("r1", { phone: "(216) 555-0148" })]);
      const first = (await repo.getReservation(rid("r1")))?.customerId;

      await importRecords(repo, [booked("r1", { phone: "(440) 555-0102" })]);
      const second = (await repo.getReservation(rid("r1")))?.customerId;
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      expect(await repo.listCustomers()).toHaveLength(2);
    });

    /**
     * `customerId` must stay OUT of the materiality set (`reservationMateriallyChanged`). It is
     * internal bookkeeping, not a change to the booking — if it counted, the first import after
     * this ships would bump `updatedAt` on every row in the back catalogue and fire a DEC-029
     * nudge for all of them.
     *
     * **The stored row must start UNLINKED**, which is the whole point and what this test got
     * wrong first time round: importing twice post-#701 links on pass one, so pass two compares
     * an identical `customerId` and the assertion holds whether or not the field is in the
     * materiality set. @code-review caught it by adding `customerId` to the set and watching all
     * five tests still pass. The scenario that matters is a PRE-#701 row — 39 of them, sitting
     * in the operator's database right now — meeting the first import after this ships.
     */
    it("linking a previously-unlinked row is not a material change — updatedAt survives", async () => {
      const repo = new InMemoryRepository();
      const t1 = new Date("2026-05-01T00:00:00.000Z");
      const t2 = new Date("2026-05-02T00:00:00.000Z");

      // A row as the importer wrote them before this change: every material field already
      // correct, `customerId` absent. Written directly, because no version of the importer
      // that produces one exists any more.
      await repo.saveReservation({
        id: rid("r1"),
        eventId: EVENT_ID,
        source: "xola",
        customerName: "Ada",
        partySize: 4,
        status: "booked",
        phone: "(216) 555-0148",
        updatedAt: t1.toISOString(),
      });

      await importRecords(repo, [booked("r1", { phone: "(216) 555-0148" })], t2);

      const after = await repo.getReservation(rid("r1"));
      expect(after?.customerId).toBeDefined(); // the link DID appear …
      expect(after?.updatedAt).toBe(t1.toISOString()); // … and it was not a material change
    });
  });
});
