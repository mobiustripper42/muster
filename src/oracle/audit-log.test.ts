/**
 * Crew audit-log write helpers (#400, DEC-118). Covers the logic-bearing half of
 * the write path: correct event shape, the actor-id optionality that is the whole
 * point of the second table, and the deterministic id (same natural key → same
 * id; an override's two events key on different subjects → no collision).
 *
 * A spy repo captures `appendAuditEvent` so we assert both the returned event AND
 * that it reached the port. The all-crew read (`listAuditEvents`) is Slice B.
 */

import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { AuditEvent } from "../domain/audit.js";
import type { Repository } from "../ports/repository.js";
import { logCrewAdded, logCrewRemoved, logFormAudit, logShiftChanged } from "./audit-log.js";
import type { FormResult } from "../builder/form-shifts.js";

/** Minimal repo that records every appended audit event. */
function spyRepo(): { repo: Repository; appended: AuditEvent[] } {
  const appended: AuditEvent[] = [];
  const repo = {
    appendAuditEvent: async (e: AuditEvent) => {
      appended.push(e);
    },
  } as unknown as Repository;
  return { repo, appended };
}

const CREW = asId<"CrewMemberId">("crew-quint");
const OTHER = asId<"CrewMemberId">("crew-brody");
const SEAT = asId<"SeatId">("seat-1");
const SHIFT = asId<"ShiftId">("shift-1");
const NOW = new Date("2026-07-13T12:00:00.000Z");

describe("logCrewAdded — self-claim vs operator actor", () => {
  it("a crew self-claim carries actor kind crew and NO actor id (the subject is the actor)", async () => {
    const { repo, appended } = spyRepo();
    const ev = await logCrewAdded(repo, CREW, { kind: "crew" }, NOW, {
      seatId: SEAT,
      shiftId: SHIFT,
      via: "self_claim",
    });
    expect(ev).toMatchObject({
      crewMemberId: CREW,
      actorKind: "crew",
      type: "crew_added",
      timestamp: "2026-07-13T12:00:00.000Z",
      metadata: { seatId: SEAT, shiftId: SHIFT, via: "self_claim" },
    });
    expect("actorId" in ev).toBe(false); // omitted, not undefined — the distinguishing field
    expect(appended).toEqual([ev]); // reached the port
  });

  it("an operator override carries actor kind admin with the admin's crew id", async () => {
    const { repo } = spyRepo();
    const ev = await logCrewAdded(repo, CREW, { kind: "admin", id: "admin-hooper" }, NOW, {
      seatId: SEAT,
      shiftId: SHIFT,
      via: "operator",
    });
    expect(ev.actorKind).toBe("admin");
    expect(ev.actorId).toBe("admin-hooper");
  });
});

describe("logCrewRemoved / logShiftChanged shape", () => {
  it("a vacate removal is a crew_removed with the misassignment reason", async () => {
    const { repo } = spyRepo();
    const ev = await logCrewRemoved(repo, CREW, { kind: "admin", id: "admin-hooper" }, NOW, {
      seatId: SEAT,
      shiftId: SHIFT,
      reason: "misassignment",
    });
    expect(ev.type).toBe("crew_removed");
    expect(ev.metadata.reason).toBe("misassignment");
  });

  it("an import change is a shift_changed with importer actor + run id", async () => {
    const { repo } = spyRepo();
    const ev = await logShiftChanged(repo, CREW, { kind: "importer", id: "xola" }, NOW, {
      shiftId: SHIFT,
      runId: "run-42",
    });
    expect(ev).toMatchObject({
      type: "shift_changed",
      actorKind: "importer",
      actorId: "xola",
      metadata: { shiftId: SHIFT, runId: "run-42" },
    });
  });
});

describe("deterministic id", () => {
  it("same natural key → same id (append-only, idempotent-keyed)", async () => {
    const { repo } = spyRepo();
    const a = await logCrewRemoved(repo, CREW, { kind: "admin", id: "x" }, NOW, {
      seatId: SEAT,
      reason: "misassignment",
    });
    const b = await logCrewRemoved(repo, CREW, { kind: "admin", id: "x" }, NOW, {
      seatId: SEAT,
      reason: "misassignment",
    });
    expect(a.id).toBe(b.id);
  });

  it("one import run touching TWO shifts for the same crew mints distinct ids (no PK collision)", async () => {
    const { repo } = spyRepo();
    // The dropped-row bug: shift_changed carries no seatId, so shiftId MUST split
    // the key — else same crew + same instant + same runId → identical id.
    const satur = await logShiftChanged(repo, CREW, { kind: "importer", id: "xola" }, NOW, {
      shiftId: asId<"ShiftId">("shift-sat"),
      runId: "run-1",
    });
    const sunday = await logShiftChanged(repo, CREW, { kind: "importer", id: "xola" }, NOW, {
      shiftId: asId<"ShiftId">("shift-sun"),
      runId: "run-1",
    });
    expect(satur.id).not.toBe(sunday.id);
  });

  it("an override's two events (placed vs displaced) never collide despite sharing now/seat", async () => {
    const { repo } = spyRepo();
    // The exact pair the override edge fires: crew_added for the placed crew, a
    // crew_removed for the bumped one — same instant, same seat, different subject.
    const added = await logCrewAdded(repo, CREW, { kind: "admin", id: "x" }, NOW, {
      seatId: SEAT,
      shiftId: SHIFT,
      via: "operator",
    });
    const removed = await logCrewRemoved(repo, OTHER, { kind: "admin", id: "x" }, NOW, {
      seatId: SEAT,
      shiftId: SHIFT,
      reason: "displaced",
    });
    expect(added.id).not.toBe(removed.id);
  });
});

describe("logFormAudit — every form transition reaches the audit (DEC-118)", () => {
  const S = (n: string) => asId<"ShiftId">(n);
  const C = (n: string) => asId<"CrewMemberId">(n);
/** #740 added a diff to `changedCrew`; these fixtures are about WHO is reported, not what moved. */
const NO_DIFF = { added: [], removed: [], startBefore: null, startAfter: null };

  /** A zeroed FormResult with only the transition lists filled in. */
  function form(over: Partial<FormResult>): FormResult {
    return {
      shiftsCreated: 0,
      shiftsUpdated: 0,
      seatsCreated: 0,
      seatsPruned: 0,
      seatsStranded: 0,
      shiftsCancelled: 0,
      createdShiftIds: [],
      cancelledShiftIds: [],
      splitDaysChanged: [],
      cancelledCrew: [],
      restoredCrew: [],
      changedCrew: [],
      ...over,
    };
  }

  it("maps each transition to its audit type, carries the actor + extra metadata", async () => {
    const { repo, appended } = spyRepo();
    await logFormAudit(
      repo,
      form({
        cancelledCrew: [{ shiftId: S("s1"), crewMemberId: C("crew-a") }],
        restoredCrew: [{ shiftId: S("s2"), crewMemberId: C("crew-b") }],
        changedCrew: [{ shiftId: S("s3"), crewMemberId: C("crew-c"), ...NO_DIFF }],
      }),
      { kind: "importer", id: "xola" },
      NOW,
      { runId: "run-9" },
    );
    expect(appended).toHaveLength(3);
    expect(appended.map((e) => [e.crewMemberId, e.type])).toEqual(
      expect.arrayContaining([
        ["crew-a", "crew_removed"],
        ["crew-b", "crew_added"],
        ["crew-c", "shift_changed"],
      ]),
    );
    for (const e of appended) {
      expect(e.actorKind).toBe("importer");
      expect(e.metadata).toMatchObject({ runId: "run-9" });
    }
  });

  it("one failed append doesn't drop the others (best-effort per row)", async () => {
    const appended: AuditEvent[] = [];
    let calls = 0;
    const repo = {
      appendAuditEvent: async (e: AuditEvent) => {
        if (++calls === 1) throw new Error("boom"); // first row fails
        appended.push(e);
      },
    } as unknown as Repository;
    await logFormAudit(
      repo,
      form({
        cancelledCrew: [{ shiftId: S("s1"), crewMemberId: C("crew-a") }],
        restoredCrew: [{ shiftId: S("s2"), crewMemberId: C("crew-b") }],
      }),
      { kind: "admin", id: "eric" },
      NOW,
    );
    expect(appended).toHaveLength(1); // the second still landed
  });

  it("no transitions → no audit rows", async () => {
    const { repo, appended } = spyRepo();
    await logFormAudit(repo, form({}), { kind: "importer", id: "xola" }, NOW);
    expect(appended).toEqual([]);
  });
});
