/**
 * Auto-form (Task 1.3 / M2, SPEC §2.3, DEC-005).
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Event, Seat } from "../domain/entities.js";
import { BREWBOAT_TENANT, seedFleet } from "../import/resource-map.js";
import { formShifts, PartialFormError } from "./form-shifts.js";

const PARTY = asId<"VesselId">("vessel-brew-2"); // 2-crew (captain+mate), seeded by the fleet
// Seeded manually — Duffys aren't in the crewed fleet's `RESOURCE_MAP`. It used to
// carry `manning: []` as a "0-crew vessel"; per the operator's 2026-08-29 ruling
// (#582/#861) there is no such boat — a self-captained Duffy still has somebody
// checking it out, so it gets a dock-hand.
const DUFFY = asId<"VesselId">("vessel-duffy-rental");
const DOCKHAND = asId<"RoleTypeId">("role-dockhand");

const event = (id: string, vesselId: typeof PARTY, date: string, time: string): Event => ({
  id: asId<"EventId">(id),
  vesselId,
  date,
  time,
  capacity: 16,
  source: "xola", status: "scheduled",
});

async function seedEvents(repo: InMemoryRepository): Promise<void> {
  await seedFleet(repo);
  // A rental vessel seeded directly — outside the crewed fleet, but still manned.
  await repo.saveRoleType({ id: DOCKHAND, tenantId: BREWBOAT_TENANT, name: "dock-hand" });
  await repo.saveVessel({
    id: DUFFY,
    name: "Duffy Rental",
    coiMaxPax: 12,
    manning: [{ roleTypeId: DOCKHAND, count: 1 }],
  });
  // Two party-boat trips same day → one shift; a third on another day → separate.
  await repo.saveEvent(event("e1", PARTY, "2026-05-16", "15:30"));
  await repo.saveEvent(event("e2", PARTY, "2026-05-16", "19:30"));
  await repo.saveEvent(event("e3", PARTY, "2026-05-17", "13:30"));
  // A zero-crew rental on its own day.
  await repo.saveEvent(event("e4", DUFFY, "2026-06-27", "18:30"));
}

describe("formShifts", () => {
  it("groups same-vessel-same-day events into one shift and derives seats", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    const result = await formShifts(repo);

    expect(result.shiftsCreated).toBe(3); // party 05-16, party 05-17, duffy 06-27
    const partyDay1 = await repo.getShift(asId(`shift-${PARTY}-2026-05-16`));
    expect(partyDay1?.eventIds.sort()).toEqual([asId("e1"), asId("e2")]);
    expect((await repo.listSeatsForShift(partyDay1!.id)).length).toBe(2); // captain + mate
    expect(partyDay1?.state).toBe("Pending"); // born all-Open
  });

  it("forms a rental vessel's shift with its dock-hand seat, born Pending", async () => {
    // Replaces "forms a zero-crew rental into a vacuously-Crewed shift with no seats"
    // (#582). That test asserted the defect: an empty manning rule produced no seats,
    // and `deriveShiftState` read the empty required set as fully crewed — so a boat
    // with a booking and nobody on it showed green on every surface. A vessel with no
    // required crew is now an error rather than a state.
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    const duffy = await repo.getShift(asId(`shift-${DUFFY}-2026-06-27`));
    const seats = await repo.listSeatsForShift(duffy!.id);
    expect(seats).toHaveLength(1);
    expect(seats[0]?.role).toBe(DOCKHAND);
    expect(duffy?.state).toBe("Pending");
  });

  it("is idempotent — re-form preserves a Confirmed seat and does not duplicate", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);

    const shiftId = asId<"ShiftId">(`shift-${PARTY}-2026-05-16`);
    const seats = await repo.listSeatsForShift(shiftId);
    const confirmed: Seat = { ...seats[0]!, state: "Confirmed" };
    await repo.saveSeat(confirmed);

    const second = await formShifts(repo);
    expect(second.shiftsCreated).toBe(0);
    expect(second.shiftsUpdated).toBe(3);
    expect(second.seatsCreated).toBe(0); // no duplicate seats

    const after = await repo.listSeatsForShift(shiftId);
    expect(after).toHaveLength(2);
    expect(after.find((s) => s.id === confirmed.id)?.state).toBe("Confirmed");
    // One Confirmed + one Open → Filling.
    expect((await repo.getShift(shiftId))?.state).toBe("Filling");
  });
});

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");

/** Re-seed the party vessel with captain-only manning (a manning shrink). */
async function shrinkPartyToCaptainOnly(repo: InMemoryRepository): Promise<void> {
  const v = await repo.getVessel(PARTY);
  await repo.saveVessel({ ...v!, manning: [{ roleTypeId: CAPTAIN, count: 1 }] });
}

async function cancelEvent(repo: InMemoryRepository, id: string): Promise<void> {
  const e = await repo.getEvent(asId<"EventId">(id));
  await repo.saveEvent({ ...e!, status: "cancelled" });
}

/** Un-cancel an event — the trip returns (Xola resurrection, #244). */
async function reviveEvent(repo: InMemoryRepository, id: string): Promise<void> {
  const e = await repo.getEvent(asId<"EventId">(id));
  await repo.saveEvent({ ...e!, status: "scheduled" });
}

describe("formShifts — reconciliation (#20)", () => {
  const day1 = asId<"ShiftId">(`shift-${PARTY}-2026-05-16`);

  it("prunes a surplus Open seat when manning shrinks", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);

    await shrinkPartyToCaptainOnly(repo);
    const r = await formShifts(repo);

    // Both party-day shifts (05-16, 05-17) lose their now-surplus mate seat.
    expect(r.seatsPruned).toBe(2);
    expect(r.seatsStranded).toBe(0);
    const seats = await repo.listSeatsForShift(day1);
    expect(seats).toHaveLength(1);
    expect(seats[0]!.role).toBe(CAPTAIN);
    expect((await repo.getShift(day1))?.state).toBe("Pending"); // lone Open seat
  });

  it("does not strand an occupied surplus seat — surfaces it instead", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);

    // Confirm the mate on 05-16; leave 05-17's mate Open.
    const mate = (await repo.listSeatsForShift(day1)).find((s) => s.role === MATE)!;
    await repo.saveSeat({
      ...mate,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("crew-1"),
    });

    await shrinkPartyToCaptainOnly(repo);
    const r = await formShifts(repo);

    // 05-16 mate is Confirmed → stranded (kept); 05-17 mate is Open → pruned.
    expect(r.seatsStranded).toBe(1);
    expect(r.seatsPruned).toBe(1);
    const after = await repo.listSeatsForShift(day1);
    expect(after.map((s) => s.role).sort()).toEqual([CAPTAIN, MATE]);
    expect(after.find((s) => s.role === MATE)?.state).toBe("Confirmed");
  });

  it("cancels a shift whose every event has been cancelled", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);

    await cancelEvent(repo, "e1");
    await cancelEvent(repo, "e2"); // both 05-16 events gone
    const r = await formShifts(repo);

    expect(r.shiftsCancelled).toBe(1);
    expect((await repo.getShift(day1))?.state).toBe("Cancelled");
  });

  it("reports the cancelled shift's assigned crew (DEC-084), transition-only", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    // Confirm a crew member onto one of the shift's seats.
    const seat = (await repo.listSeatsForShift(day1))[0]!;
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("cap"),
    });

    await cancelEvent(repo, "e1");
    await cancelEvent(repo, "e2");
    const r1 = await formShifts(repo);
    expect(r1.shiftsCancelled).toBe(1);
    expect(r1.cancelledCrew).toEqual([
      { shiftId: day1, crewMemberId: asId<"CrewMemberId">("cap") },
    ]);

    // A re-pull of the ALREADY-cancelled shift must NOT re-report (transition-only).
    const r2 = await formShifts(repo);
    expect(r2.cancelledCrew).toEqual([]);
  });

  it("reports resurrected crew (#244) when a cancelled shift comes back — transition-only", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    // Confirm a crew member onto a seat, then cancel the whole shift out from
    // under them — the seat assignment survives on the Cancelled husk.
    const seat = (await repo.listSeatsForShift(day1))[0]!;
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("cap"),
    });
    await cancelEvent(repo, "e1");
    await cancelEvent(repo, "e2");
    const rCancel = await formShifts(repo);
    expect((await repo.getShift(day1))?.state).toBe("Cancelled");
    expect(rCancel.restoredCrew).toEqual([]); // cancel is not a resurrection

    // The trips return → the shift re-forms live and the still-assigned crew are
    // reported for the matching "you're on" notice (the silent re-confirm, closed).
    await reviveEvent(repo, "e1");
    await reviveEvent(repo, "e2");
    const r = await formShifts(repo);
    expect((await repo.getShift(day1))?.state).not.toBe("Cancelled");
    expect(r.restoredCrew).toEqual([
      { shiftId: day1, crewMemberId: asId<"CrewMemberId">("cap") },
    ]);

    // A steady live re-pull must NOT re-report (transition-only).
    const r2 = await formShifts(repo);
    expect(r2.restoredCrew).toEqual([]);
  });

  it("carries the notices it already computed when a later group throws (#766)", async () => {
    // **The failure this pins is silent and permanent.** `formShifts` saves each vessel-day as it
    // goes, then returns `changedCrew` at the end. A throw on a later group discards the whole
    // in-memory result — including notices already computed for groups that succeeded — while
    // their shift rows are durable. The backstop does not save it: the next tick re-forms, reads
    // the trip set it already wrote, sees no diff, and stays silent. The crew member is never
    // told their day changed.
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    const seat = (await repo.listSeatsForShift(day1))[0]!;
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("cap"),
    });
    // A new trip on day1 — the same change the #350 test above asserts is reported.
    await repo.saveEvent(event("e1b", PARTY, "2026-05-16", "17:00"));

    // Fail on the Duffy vessel-day, which is seeded LAST, so day1's notice is computed and
    // pushed before the throw. Failing on the first group would prove nothing.
    const boom = new Error("db hiccup partway through the loop");
    const realSaveShift = repo.saveShift.bind(repo);
    repo.saveShift = async (shift) => {
      if (String(shift.id).includes("duffy")) throw boom;
      return realSaveShift(shift);
    };

    const err = await formShifts(repo, { notifyTripChanges: true }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(PartialFormError);
    const partial = (err as PartialFormError).partial;
    // The point of the whole change: the notice survives the throw.
    expect(partial.changedCrew).toHaveLength(1);
    expect(partial.changedCrew[0]).toMatchObject({
      shiftId: day1,
      crewMemberId: asId<"CrewMemberId">("cap"),
    });
    // The original failure is not swallowed — a caller still learns the run broke, and why.
    expect((err as PartialFormError).cause).toBe(boom);
  });

  it("reports changed crew when a trip is added to a surviving shift (#350), transition-only", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    // Confirm a crew member onto day1 (the 05-16 shift, trips e1 + e2).
    const seat = (await repo.listSeatsForShift(day1))[0]!;
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("cap"),
    });

    // A new booking adds a third trip to the same vessel-day — the import case.
    // The import opts into the notice (`notifyTripChanges`).
    await repo.saveEvent(event("e1b", PARTY, "2026-05-16", "17:00"));
    const r1 = await formShifts(repo, { notifyTripChanges: true });
    // `toMatchObject`, not `toEqual`: the entry carries the diff too (#740), asserted in
    // its own tests below. Here the subject is WHO is reported, which #350 owns.
    expect(r1.changedCrew).toHaveLength(1);
    expect(r1.changedCrew[0]).toMatchObject({
      shiftId: day1,
      crewMemberId: asId<"CrewMemberId">("cap"),
    });
    // Not also reported as a cancel/resurrection — it stayed live.
    expect(r1.cancelledCrew).toEqual([]);
    expect(r1.restoredCrew).toEqual([]);

    // A re-pull with no trip-set change must NOT re-report (diff-gated).
    const r2 = await formShifts(repo, { notifyTripChanges: true });
    expect(r2.changedCrew).toEqual([]);

    // A partial cancellation that leaves the shift LIVE also reports "changed".
    await cancelEvent(repo, "e1b");
    const r3 = await formShifts(repo, { notifyTripChanges: true });
    expect((await repo.getShift(day1))?.state).not.toBe("Cancelled");
    expect(r3.changedCrew).toHaveLength(1);
    expect(r3.changedCrew[0]).toMatchObject({
      shiftId: day1,
      crewMemberId: asId<"CrewMemberId">("cap"),
    });
  });

  it("does NOT report changed crew without the opt-in — the notice is command-driven (#350)", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    const seat = (await repo.listSeatsForShift(day1))[0]!;
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("cap"),
    });
    // Same trip-set change, but a caller that doesn't opt in (a silent re-form) fires
    // no notice — only the explicit commands (import/split/merge) pass the flag.
    await repo.saveEvent(event("e1b", PARTY, "2026-05-16", "17:00"));
    const r = await formShifts(repo); // no notifyTripChanges
    expect(r.changedCrew).toEqual([]);
  });

  /**
   * The gap this used to CHARACTERIZE, now closed (#740).
   *
   * DEC-029 said time changes were caught for free, and under its scheme they were:
   * event identity was `evt-${vesselId}-${date}-${time}`, so moving a trip minted a
   * new id and the shift's `eventIds` set changed. **DEC-043 replaced that identity
   * with Xola's real `event.id`** and nobody re-checked the consequence: a retime
   * that keeps its id left the set identical, so the `#350` diff-gate saw no change
   * and no crew member was told — while their call time (earliest departure − lead)
   * had moved underneath them. This test pinned that silence.
   *
   * It stopped being an open question the moment Muster began selling its own
   * reservations: whatever Xola does with ids, Muster controls its own, and an
   * operator retiming a departure in place is an ordinary act. Operator's call
   * (2026-08-17): *"if the time changes and the crew isn't notified, then that's a
   * bug."* So the gate compares the earliest scheduled start as well as the id set.
   */
  it("a retime that keeps the event id now tells the crew, with the times (#740)", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    const seat = (await repo.listSeatsForShift(day1))[0]!;
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("cap"),
    });

    // Same event, same day, moved 15:30 → 08:00. The crew member's call time moves
    // by seven and a half hours; the event-id set does not move at all.
    await repo.saveEvent(event("e1", PARTY, "2026-05-16", "08:00"));
    const r = await formShifts(repo, { notifyTripChanges: true });

    expect((await repo.getEvent(asId<"EventId">("e1")))?.time).toBe("08:00");
    expect((await repo.getShift(day1))?.eventIds).toEqual(["e1", "e2"]);

    expect(r.changedCrew).toHaveLength(1);
    const c = r.changedCrew[0]!;
    expect(String(c.crewMemberId)).toBe("cap");
    // Nothing was added or removed — the trip set is identical. Only the clock moved,
    // which is the whole point: a diff reported as "+0 trips" would say nothing.
    expect(c.added).toEqual([]);
    expect(c.removed).toEqual([]);
    expect(c.startBefore).not.toBe(c.startAfter);
    expect(c.startBefore).not.toBeNull();
    expect(c.startAfter).not.toBeNull();
  });

  it("a steady re-form after a retime does not re-report it (#740)", async () => {
    // The diff gate has to hold for the new time comparison exactly as it does for the
    // id set, or the cron tick re-announces the same retime every 15 minutes forever.
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    const seat = (await repo.listSeatsForShift(day1))[0]!;
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("cap"),
    });

    await repo.saveEvent(event("e1", PARTY, "2026-05-16", "08:00"));
    expect((await formShifts(repo, { notifyTripChanges: true })).changedCrew).toHaveLength(1);
    expect((await formShifts(repo, { notifyTripChanges: true })).changedCrew).toEqual([]);
    expect((await formShifts(repo, { notifyTripChanges: true })).changedCrew).toEqual([]);
  });

  it("a trip added carries WHICH trip was added (#740)", async () => {
    // #350 reported the fact of a change; the notice built on it could only say
    // "something moved". The diff was computed and dropped on the floor.
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    const seat = (await repo.listSeatsForShift(day1))[0]!;
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("cap"),
    });

    // Added EARLIER than the existing 15:30, so the call time moves too — both halves
    // of the diff in one change, which is the case the SMS has to fit into one segment.
    await repo.saveEvent(event("e1b", PARTY, "2026-05-16", "09:00"));
    const r = await formShifts(repo, { notifyTripChanges: true });

    expect(r.changedCrew).toHaveLength(1);
    const c = r.changedCrew[0]!;
    expect(c.added.map(String)).toEqual(["e1b"]);
    expect(c.removed).toEqual([]);
    expect(c.startBefore).not.toBe(c.startAfter);
  });

  it("a trip cancelled off a surviving shift carries WHICH trip was removed (#740)", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    const seat = (await repo.listSeatsForShift(day1))[0]!;
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("cap"),
    });

    await cancelEvent(repo, "e2"); // 19:30 goes; 15:30 survives, so the shift lives
    const r = await formShifts(repo, { notifyTripChanges: true });

    expect((await repo.getShift(day1))?.state).not.toBe("Cancelled");
    expect(r.changedCrew).toHaveLength(1);
    const c = r.changedCrew[0]!;
    expect(c.removed.map(String)).toEqual(["e2"]);
    expect(c.added).toEqual([]);
    // The earliest trip did not move, so the call time is unchanged — the notice must
    // be able to say "-1 trip" WITHOUT claiming a call-time change that did not happen.
    expect(c.startBefore).toBe(c.startAfter);
  });

  it("never forms a shift from cancelled-only events (no prior shift)", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    // Cancel 05-17's lone event before it was ever formed.
    await cancelEvent(repo, "e3");
    const r = await formShifts(repo);

    expect(r.shiftsCancelled).toBe(0);
    expect(await repo.getShift(asId(`shift-${PARTY}-2026-05-17`))).toBeNull();
  });

  it("never re-cancels a Completed shift (the trip ran)", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    const shift = await repo.getShift(day1);
    await repo.saveShift({ ...shift!, state: "Completed" });

    await cancelEvent(repo, "e1");
    await cancelEvent(repo, "e2");
    const r = await formShifts(repo);

    expect(r.shiftsCancelled).toBe(0);
    expect((await repo.getShift(day1))?.state).toBe("Completed");
  });

  it("never un-completes a Completed shift whose trips are still scheduled (#570)", async () => {
    // The sibling of the test above, on the OTHER branch. That one covers
    // all-events-cancelled; this covers the ordinary reconcile path, which
    // recomputes state from the seat fold — and neither `deriveShiftState` nor
    // `resolveShiftState` can produce `Completed`. Unguarded, the next Xola pull
    // after any shift completes folds it back to `Crewed` off its still-Confirmed
    // seats, and the following tick re-completes it and double-logs
    // `shift_completed` for everyone who worked it.
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    const shift = await repo.getShift(day1);
    await repo.saveShift({ ...shift!, state: "Completed" });

    // Same events, still scheduled — a plain re-pull, nothing changed.
    await formShifts(repo);

    expect((await repo.getShift(day1))?.state).toBe("Completed");
  });

  it("births a past-horizon shift into Filling when a clock is supplied (DEC-022)", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    // 05-16 events; horizon = earliest (15:30) − 7d = 2026-05-09T15:30Z.
    const past = new Date("2026-05-10T00:00:00.000Z");
    await formShifts(repo, { now: past });
    expect((await repo.getShift(day1))?.state).toBe("Filling"); // born working

    // Without a clock, birth stays Pending (backward-compatible).
    const repo2 = new InMemoryRepository();
    await seedEvents(repo2);
    await formShifts(repo2);
    expect((await repo2.getShift(day1))?.state).toBe("Pending");
  });

  it("keeps a partially-cancelled shift live, dropping only the cancelled event", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);

    await cancelEvent(repo, "e1"); // e2 still scheduled
    const r = await formShifts(repo);

    expect(r.shiftsCancelled).toBe(0);
    const shift = await repo.getShift(day1);
    expect(shift?.state).not.toBe("Cancelled");
    expect(shift?.eventIds).toEqual([asId("e2")]);
  });
});
