/**
 * "All shifts" derivation (#100, DEC-042). Tests the read-model's own logic —
 * window filtering, cancelled exclusion + completed INCLUSION (#570), trip
 * aggregation + sort, pax,
 * seat-fill counts, and row ordering. The live-state resolution it delegates to
 * `resolveShiftStateOnRead` is exercised in tick's suite; here we assert one
 * clean Crewed case to prove the wiring, not the whole state machine.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId } from "../domain/ids.js";
import type { Seat, Shift } from "../domain/entities.js";
import type { SeatState } from "../domain/states.js";
import { deriveAllShifts } from "./all-shifts.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const T0 = new Date("2026-07-01T12:00:00.000Z");
// Lead 7d (default) → a trip a couple days out is past its horizon at T0.
const OPTS = { leadDays: 7, tz: "UTC" };

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

interface TripSpec {
  time: string;
  pax: number[]; // one booked reservation per party size
}
interface SeatSpec {
  role?: typeof CAPTAIN | typeof MATE;
  state?: SeatState;
  kind?: Seat["kind"];
  /** Assign a crew member to this seat (#310) — seeds the member + pins the seat. */
  crew?: { id: string; name: string };
}

async function addShift(
  id: string,
  date: string,
  vesselName: string,
  trips: TripSpec[],
  seats: SeatSpec[],
  state: Shift["state"] = "Filling",
  splitCutTime?: string,
): Promise<void> {
  const vesselId = asId<"VesselId">(`vessel-${id}`);
  await repo.saveVessel({
    id: vesselId,
    name: vesselName,
    coiMaxPax: 12,
    manning: [{ roleTypeId: CAPTAIN, count: 1 }],
  });
  // Role display names for the seat pips (idempotent upserts).
  const TENANT = asId<"TenantId">("tenant-test");
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" });
  await repo.saveRoleType({ id: MATE, tenantId: TENANT, name: "mate" });
  const eventIds = [];
  for (const [i, t] of trips.entries()) {
    const eventId = asId<"EventId">(`evt-${id}-${i}`);
    await repo.saveEvent({
      id: eventId,
      vesselId,
      date,
      time: t.time,
      capacity: 12,
      source: "xola", status: "scheduled",
    });
    for (const [j, party] of t.pax.entries()) {
      await repo.saveReservation({
        id: asId<"ReservationId">(`r-${id}-${i}-${j}`),
        eventId,
        source: "xola",
        customerName: `party ${j}`,
        partySize: party,
        status: "booked",
      });
    }
    eventIds.push(eventId);
  }
  await repo.saveShift({
    id: asId<"ShiftId">(id),
    vesselId,
    date,
    state,
    eventIds,
    ...(splitCutTime ? { splitCutTime } : {}),
  });
  for (const [i, s] of seats.entries()) {
    if (s.crew) {
      await repo.saveCrewMember({
        id: asId<"CrewMemberId">(s.crew.id),
        name: s.crew.name,
        phone: "555",
        ratings: [],
        status: "active",
        reliabilityScore: null,
      });
    }
    const seat: Seat = {
      id: asId<"SeatId">(`seat-${id}-${i}`),
      shiftId: asId<"ShiftId">(id),
      role: s.role ?? CAPTAIN,
      kind: s.kind ?? "required",
      state: s.state ?? "Open",
      ...(s.crew ? { assignedCrewMemberId: asId<"CrewMemberId">(s.crew.id) } : {}),
    };
    await repo.saveSeat(seat);
  }
}

describe("deriveAllShifts", () => {
  it("returns current shifts in the window with trips, pax, and seat fill", async () => {
    await addShift(
      "s-crewed",
      "2026-07-03",
      "Hops",
      [{ time: "17:00", pax: [2] }, { time: "15:00", pax: [4, 6] }],
      [{ state: "Confirmed" }, { role: MATE, state: "Confirmed" }],
      "Crewed",
    );

    const rows = await deriveAllShifts(
      repo,
      { from: "2026-07-01", to: "2026-07-31" },
      T0,
      OPTS,
    );

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.vesselId).toBe("vessel-s-crewed"); // the DEC-086 hue key
    expect(row.vesselName).toBe("Hops");
    expect(row.state).toBe("Crewed"); // resolved on read, not the persisted badge
    expect(row.trips.map((t) => t.time)).toEqual(["15:00", "17:00"]); // earliest first
    expect(row.trips[0]!.pax).toBe(10); // 4 + 6
    expect(row.paxTotal).toBe(12);
    expect(row.requiredSeats).toBe(2);
    expect(row.confirmedSeats).toBe(2);
  });

  it("ships per-seat pip facts — every seat incl. supernumerary, sorted role → kind — without changing the required-only fill counts", async () => {
    await addShift(
      "s-pips",
      "2026-07-03",
      "Hops",
      [{ time: "15:00", pax: [2] }],
      [
        // Deliberately out of display order: trainee mate, open mate, confirmed captain.
        { role: MATE, state: "Open", kind: "supernumerary" },
        { role: MATE, state: "Open" },
        { state: "Confirmed" },
      ],
    );

    const rows = await deriveAllShifts(
      repo,
      { from: "2026-07-01", to: "2026-07-31" },
      T0,
      OPTS,
    );

    const row = rows[0]!;
    // Sorted roleName, then kind (required before supernumerary).
    expect(row.seats).toEqual([
      { roleName: "captain", filled: true, supernumerary: false },
      { roleName: "mate", filled: false, supernumerary: false },
      { roleName: "mate", filled: false, supernumerary: true },
    ]);
    // The fill counts keep their required-only meaning — the trainee isn't in them.
    expect(row.requiredSeats).toBe(2);
    expect(row.confirmedSeats).toBe(1);
  });

  it("carries the assigned crew name on a filled seat, undefined on an open one (#310)", async () => {
    await addShift("s-crew", "2026-07-03", "Hops", [{ time: "15:00", pax: [2] }], [
      { role: CAPTAIN, state: "Confirmed", crew: { id: "crew-eric", name: "Eric Stoffer" } },
      { role: MATE, state: "Open" },
    ]);
    const rows = await deriveAllShifts(repo, { from: "2026-07-01", to: "2026-07-31" }, T0, OPTS);
    const seats = rows[0]!.seats;
    expect(seats.find((s) => s.roleName === "captain")!.crewName).toBe("Eric Stoffer");
    expect(seats.find((s) => s.roleName === "mate")!.crewName).toBeUndefined();
  });

  it("excludes cancelled shifts but KEEPS completed ones (#570)", async () => {
    await addShift("alive", "2026-07-03", "Hops", [{ time: "15:00", pax: [2] }], [{ state: "Confirmed" }], "Crewed");
    await addShift("dead", "2026-07-03", "Kettle", [{ time: "15:00", pax: [2] }], [{ state: "Open" }], "Cancelled");
    await addShift("done", "2026-07-03", "Firkin", [{ time: "15:00", pax: [2] }], [{ state: "Confirmed" }], "Completed");

    const rows = await deriveAllShifts(repo, { from: "2026-07-01", to: "2026-07-31" }, T0, OPTS);
    // Completed stays on the board (operator's call, #570) — a trip that ran is still
    // part of the day. Cancelled remains opt-in behind `includeCancelled` (#416).
    expect(rows.map((r) => r.vesselName).sort()).toEqual(["Firkin", "Hops"]);
    expect(rows.find((r) => r.vesselName === "Hops")!.cancelled).toBe(false);
  });

  it("a completed shift reads Completed, NOT relabelled Crewed by the resolver (#570)", async () => {
    // The seat-folding resolver can only yield Pending/Filling/Crewed/AtRisk
    // (`derive.ts:652`), so without the verbatim branch a finished trip whose seats
    // are still Confirmed would present as a live Crewed shift — with the live
    // affordances that implies. Same hazard #416 fixed for Cancelled.
    await addShift("done", "2026-07-03", "Firkin", [{ time: "15:00", pax: [2] }], [{ state: "Confirmed" }], "Completed");

    const rows = await deriveAllShifts(repo, { from: "2026-07-01", to: "2026-07-31" }, T0, OPTS);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("Completed");
    expect(rows[0]!.cancelled).toBe(false);
  });

  it("includeCancelled folds Cancelled in (flagged); Completed is present either way (#416, #570)", async () => {
    await addShift("alive", "2026-07-03", "Hops", [{ time: "15:00", pax: [2] }], [{ state: "Confirmed" }], "Crewed");
    await addShift("dead", "2026-07-03", "Kettle", [{ time: "15:00", pax: [2] }], [{ state: "Open" }], "Cancelled");
    await addShift("done", "2026-07-03", "Firkin", [{ time: "15:00", pax: [2] }], [{ state: "Confirmed" }], "Completed");

    const rows = await deriveAllShifts(
      repo,
      { from: "2026-07-01", to: "2026-07-31" },
      T0,
      { ...OPTS, includeCancelled: true },
    );
    // Cancelled now present + flagged; Completed is present regardless of the flag —
    // the flag only ever governed Cancelled (#570 keeps Completed unconditionally).
    expect(rows.map((r) => r.vesselName).sort()).toEqual(["Firkin", "Hops", "Kettle"]);
    const dead = rows.find((r) => r.vesselName === "Kettle")!;
    expect(dead.cancelled).toBe(true);
    // State stays "Cancelled" — NOT relabelled by the seat-folding resolver, which
    // would sprout a live At-Risk link on a dead shift (code review).
    expect(dead.state).toBe("Cancelled");
    expect(rows.find((r) => r.vesselName === "Hops")!.cancelled).toBe(false);
  });

  it("filters to the date window (inclusive)", async () => {
    await addShift("before", "2026-07-02", "Before", [{ time: "15:00", pax: [2] }], [{ state: "Confirmed" }], "Crewed");
    await addShift("inside", "2026-07-05", "Inside", [{ time: "15:00", pax: [2] }], [{ state: "Confirmed" }], "Crewed");
    await addShift("after", "2026-07-09", "After", [{ time: "15:00", pax: [2] }], [{ state: "Confirmed" }], "Crewed");

    const rows = await deriveAllShifts(repo, { from: "2026-07-05", to: "2026-07-05" }, T0, OPTS);
    expect(rows.map((r) => r.vesselName)).toEqual(["Inside"]);
  });

  it("sorts by date then earliest departure", async () => {
    await addShift("d2-late", "2026-07-05", "D2Late", [{ time: "16:00", pax: [1] }], [{ state: "Confirmed" }], "Crewed");
    await addShift("d1", "2026-07-04", "D1", [{ time: "18:00", pax: [1] }], [{ state: "Confirmed" }], "Crewed");
    await addShift("d2-early", "2026-07-05", "D2Early", [{ time: "09:00", pax: [1] }], [{ state: "Confirmed" }], "Crewed");

    const rows = await deriveAllShifts(repo, { from: "2026-07-01", to: "2026-07-31" }, T0, OPTS);
    expect(rows.map((r) => r.vesselName)).toEqual(["D1", "D2Early", "D2Late"]);
  });

  it("counts only scheduled trips and booked reservations toward pax", async () => {
    await addShift("mixed", "2026-07-05", "Mixed", [{ time: "15:00", pax: [3] }], [{ state: "Confirmed" }], "Crewed");
    // A cancelled reservation must not count toward pax.
    await repo.saveReservation({
      id: asId<"ReservationId">("r-cancelled"),
      eventId: asId<"EventId">("evt-mixed-0"),
      source: "xola",
      customerName: "no-show party",
      partySize: 5,
      status: "cancelled",
    });
    const rows = await deriveAllShifts(repo, { from: "2026-07-01", to: "2026-07-31" }, T0, OPTS);
    expect(rows[0]!.paxTotal).toBe(3);
  });

  it("surfaces a split suggestion for a large mid-day gap, null for contiguous trips", async () => {
    await addShift(
      "gappy",
      "2026-07-05",
      "Gappy",
      [{ time: "11:30", pax: [2] }, { time: "17:30", pax: [2] }, { time: "19:30", pax: [2] }],
      [{ state: "Open" }],
    );
    await addShift(
      "tight",
      "2026-07-05",
      "Tight",
      [{ time: "15:00", pax: [2] }, { time: "17:00", pax: [2] }],
      [{ state: "Open" }],
    );

    const rows = await deriveAllShifts(repo, { from: "2026-07-01", to: "2026-07-31" }, T0, OPTS);
    const gappy = rows.find((r) => r.vesselName === "Gappy")!;
    const tight = rows.find((r) => r.vesselName === "Tight")!;
    expect(gappy.splitSuggestion).toEqual({
      reason: "large-gap",
      minutes: 190, // 360 gap − (100 trip + 25 teardown + 45 lead) = 190 (#275)
      boundary: { before: "11:30", after: "17:30" },
    });
    expect(tight.splitSuggestion).toBeNull();
  });

  it("marks the two halves of a split vessel-day (A carries the cut, B borrows it)", async () => {
    // Side A is the canonical row carrying `splitCutTime`; side B is the `-b`
    // sibling, which borrows the boundary from its canonical (DEC-083).
    await addShift("pair", "2026-07-05", "Brew 3", [{ time: "11:00", pax: [2] }], [{ state: "Confirmed" }], "Crewed", "17:30");
    await addShift("pair-b", "2026-07-05", "Brew 3", [{ time: "17:30", pax: [2] }], [{ state: "Open" }], "Filling");
    await addShift("solo", "2026-07-05", "Kettle", [{ time: "15:00", pax: [2] }], [{ state: "Open" }]);

    const rows = await deriveAllShifts(repo, { from: "2026-07-01", to: "2026-07-31" }, T0, OPTS);
    const byId = new Map(rows.map((r) => [r.shiftId, r]));
    expect(byId.get("pair")!.split).toEqual({ side: "A", cutTime: "17:30" });
    expect(byId.get("pair-b")!.split).toEqual({ side: "B", cutTime: "17:30" });
    expect(byId.get("solo")!.split).toBeNull();
  });

  it("resolves side B's cut even when the canonical side-A husk is cancelled (collapse)", async () => {
    // Collapse (DEC-083): side A's trips all left → canonical derives to Cancelled
    // but KEEPS its splitCutTime, so it's filtered from the rows yet still sources
    // side B's boundary from the pre-scan map.
    await addShift("coll", "2026-07-05", "Brew 3", [{ time: "11:00", pax: [2] }], [{ state: "Open" }], "Cancelled", "17:30");
    await addShift("coll-b", "2026-07-05", "Brew 3", [{ time: "17:30", pax: [2] }], [{ state: "Open" }], "Filling");

    const rows = await deriveAllShifts(repo, { from: "2026-07-01", to: "2026-07-31" }, T0, OPTS);
    const ids = rows.map((r) => r.shiftId);
    expect(ids).toContain("coll-b");
    expect(ids).not.toContain("coll"); // the cancelled husk is excluded from the surface
    expect(rows.find((r) => r.shiftId === "coll-b")!.split).toEqual({ side: "B", cutTime: "17:30" });
  });
});

describe("deriveAllShifts — crew filter (#330)", () => {
  const WIN = { from: "2026-07-01", to: "2026-07-31" };
  const QUINT = { id: "crew-quint", name: "Quint" };
  const HOOPER = { id: "crew-hooper", name: "Hooper" };

  it("narrows to shifts the crew member is seated on (by id), dropping the rest", async () => {
    await addShift("q1", "2026-07-05", "Orca", [{ time: "09:00", pax: [2] }], [
      { role: CAPTAIN, state: "Confirmed", crew: QUINT },
    ]);
    await addShift("h1", "2026-07-06", "Orca2", [{ time: "09:00", pax: [2] }], [
      { role: CAPTAIN, state: "Confirmed", crew: HOOPER },
    ]);

    const rows = await deriveAllShifts(repo, WIN, T0, {
      ...OPTS,
      crewMemberId: QUINT.id,
    });
    expect(rows.map((r) => r.shiftId)).toEqual(["q1"]);
  });

  it("counts a tentative (Claimed) seat, not just Confirmed", async () => {
    await addShift("claimed", "2026-07-05", "Orca", [{ time: "09:00", pax: [2] }], [
      { role: CAPTAIN, state: "Claimed", crew: QUINT },
    ]);

    const rows = await deriveAllShifts(repo, WIN, T0, {
      ...OPTS,
      crewMemberId: QUINT.id,
    });
    expect(rows.map((r) => r.shiftId)).toEqual(["claimed"]);
  });

  it("counts a crew member on a supernumerary (trainee) seat", async () => {
    await addShift("super", "2026-07-05", "Orca", [{ time: "09:00", pax: [2] }], [
      { role: CAPTAIN, state: "Confirmed", crew: HOOPER },
      { role: MATE, kind: "supernumerary", state: "Confirmed", crew: QUINT },
    ]);

    const rows = await deriveAllShifts(repo, WIN, T0, {
      ...OPTS,
      crewMemberId: QUINT.id,
    });
    expect(rows.map((r) => r.shiftId)).toEqual(["super"]);
  });

  it("does NOT count an Asked/Open/Bailed seat — those don't bind a person to the shift", async () => {
    // Quint has an outstanding ask (not a commitment) on one shift, and is
    // Confirmed on another. Only the confirmed one should surface.
    await addShift("asked", "2026-07-05", "Orca", [{ time: "09:00", pax: [2] }], [
      { role: CAPTAIN, state: "Asked", crew: QUINT },
    ]);
    await addShift("real", "2026-07-06", "Orca2", [{ time: "09:00", pax: [2] }], [
      { role: CAPTAIN, state: "Confirmed", crew: QUINT },
    ]);

    const rows = await deriveAllShifts(repo, WIN, T0, {
      ...OPTS,
      crewMemberId: QUINT.id,
    });
    expect(rows.map((r) => r.shiftId)).toEqual(["real"]);
  });

  it("returns everything when no crew filter is set (unchanged behavior)", async () => {
    await addShift("q1", "2026-07-05", "Orca", [{ time: "09:00", pax: [2] }], [
      { role: CAPTAIN, state: "Confirmed", crew: QUINT },
    ]);
    await addShift("h1", "2026-07-06", "Orca2", [{ time: "09:00", pax: [2] }], [
      { role: CAPTAIN, state: "Confirmed", crew: HOOPER },
    ]);

    const rows = await deriveAllShifts(repo, WIN, T0, OPTS);
    expect(rows.map((r) => r.shiftId).sort()).toEqual(["h1", "q1"]);
  });
});
