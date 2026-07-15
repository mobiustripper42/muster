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
import { logCrewAdded, logCrewRemoved, logShiftChanged } from "./audit-log.js";

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
