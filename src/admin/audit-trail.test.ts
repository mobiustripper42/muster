/**
 * Audit trail (#400 Slice B, DEC-118) — the one-list projection. Covers the union
 * of audit facts + reliability add/drop projection, the exclusion of ask-context
 * types, actor labelling, newest-first ordering, crew/kind filters, and shift
 * label resolution (incl. the no-FK orphan).
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, Shift, Vessel, RoleType } from "../domain/entities.js";
import type { AuditEvent, AuditEventType, AuditActorKind, AuditEventMetadata } from "../domain/audit.js";
import type { ReliabilityEvent, ReliabilityEventType, ReliabilityEventMetadata } from "../domain/reliability.js";
import { buildAuditTrail } from "./audit-trail.js";

const TENANT = asId<"TenantId">("t-1");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const V1 = asId<"VesselId">("vessel-1");

const crew = (id: string, name: string): CrewMember => ({
  id: asId<"CrewMemberId">(id),
  name,
  phone: "+15035550100",
  ratings: [CAPTAIN],
  status: "active",
  reliabilityScore: null,
});

const shift = (id: string, date: string): Shift => ({
  id: asId<"ShiftId">(id),
  vesselId: V1,
  date,
  state: "Filling",
  eventIds: [],
});

async function seedBase(repo: InMemoryRepository): Promise<void> {
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" } as RoleType);
  await repo.saveVessel({ id: V1, name: "Hops", coiMaxPax: 6, manning: [] } as Vessel);
  await repo.saveCrewMember(crew("crew-quint", "Quint"));
  await repo.saveCrewMember(crew("crew-hooper", "Hooper")); // an admin actor
  await repo.saveShift(shift("shift-1", "2026-07-11"));
}

let seq = 0;
function aud(
  crewId: string,
  actorKind: AuditActorKind,
  type: AuditEventType,
  timestamp: string,
  metadata: AuditEventMetadata = {},
  actorId?: string,
): AuditEvent {
  return {
    id: asId<"AuditEventId">(`aud-${seq++}`),
    crewMemberId: asId<"CrewMemberId">(crewId),
    actorKind,
    ...(actorId !== undefined ? { actorId } : {}),
    type,
    timestamp,
    metadata,
  };
}
function rel(
  crewId: string,
  type: ReliabilityEventType,
  timestamp: string,
  metadata: ReliabilityEventMetadata = {},
): ReliabilityEvent {
  return {
    id: asId<"ReliabilityEventId">(`rel-${seq++}`),
    crewMemberId: asId<"CrewMemberId">(crewId),
    type,
    timestamp,
    metadata,
  };
}

describe("buildAuditTrail — union + projection", () => {
  it("projects audit facts to added/removed/changed with resolved crew + shift context", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.appendAuditEvent(
      aud("crew-quint", "admin", "crew_removed", "2026-07-13T16:00:00.000Z", {
        shiftId: asId<"ShiftId">("shift-1"),
        reason: "misassignment",
      }, "crew-hooper"),
    );

    const [row] = await buildAuditTrail(repo);
    expect(row).toMatchObject({
      source: "audit",
      action: "removed",
      crewName: "Quint",
      actorLabel: "Hooper", // admin actorId → crew name
      detail: "misassignment",
      date: "2026-07-11",
      vesselName: "Hops",
    });
  });

  it("labels each actor kind: self-claim, Xola import, engine", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.appendAuditEvent(aud("crew-quint", "crew", "crew_added", "2026-07-13T10:00:00.000Z", { via: "self_claim" }));
    await repo.appendAuditEvent(aud("crew-quint", "importer", "shift_changed", "2026-07-13T11:00:00.000Z", {}, "xola"));
    await repo.appendAuditEvent(aud("crew-quint", "engine", "crew_removed", "2026-07-13T12:00:00.000Z"));

    const labels = new Map((await buildAuditTrail(repo)).map((r) => [r.action + ":" + r.timestamp, r.actorLabel]));
    expect(labels.get("added:2026-07-13T10:00:00.000Z")).toBe("self-claim");
    expect(labels.get("changed:2026-07-13T11:00:00.000Z")).toBe("Xola import");
    expect(labels.get("removed:2026-07-13T12:00:00.000Z")).toBe("Automatic");
  });

  it("projects reliability add/drop and EXCLUDES ask-context types", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.logReliabilityEvent(rel("crew-quint", "ask_accepted", "2026-07-13T09:00:00.000Z", { shiftId: asId<"ShiftId">("shift-1") }));
    await repo.logReliabilityEvent(rel("crew-quint", "shift_bailed", "2026-07-13T09:30:00.000Z"));
    await repo.logReliabilityEvent(rel("crew-hooper", "no_show", "2026-07-13T09:45:00.000Z"));
    // These must NOT appear — they aren't add/drop/change:
    await repo.logReliabilityEvent(rel("crew-quint", "ask_declined", "2026-07-13T09:10:00.000Z"));
    await repo.logReliabilityEvent(rel("crew-quint", "ask_ignored", "2026-07-13T09:20:00.000Z"));
    await repo.logReliabilityEvent(rel("crew-quint", "nudged", "2026-07-13T09:25:00.000Z"));
    await repo.logReliabilityEvent(rel("crew-quint", "shift_completed", "2026-07-13T09:26:00.000Z"));

    const rows = await buildAuditTrail(repo);
    expect(rows.map((r) => r.action).sort()).toEqual(["added", "removed", "removed"]);
    expect(rows.every((r) => r.source === "reliability")).toBe(true);
  });

  it("labels a self-bail vs an operator-reported bail", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.logReliabilityEvent(rel("crew-quint", "shift_bailed", "2026-07-13T09:00:00.000Z"));
    await repo.logReliabilityEvent(rel("crew-hooper", "shift_bailed", "2026-07-13T09:30:00.000Z", { manual: true }));
    const byCrew = new Map((await buildAuditTrail(repo)).map((r) => [r.crewName, r.actorLabel]));
    expect(byCrew.get("Quint")).toBe("bailed");
    expect(byCrew.get("Hooper")).toBe("reported bail");
  });

  it("unions both sources newest-first", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.appendAuditEvent(aud("crew-quint", "crew", "crew_added", "2026-07-13T08:00:00.000Z", { via: "self_claim" }));
    await repo.logReliabilityEvent(rel("crew-quint", "shift_bailed", "2026-07-13T10:00:00.000Z"));
    await repo.appendAuditEvent(aud("crew-quint", "admin", "crew_removed", "2026-07-13T09:00:00.000Z", {}, "crew-hooper"));
    expect((await buildAuditTrail(repo)).map((r) => r.timestamp)).toEqual([
      "2026-07-13T10:00:00.000Z",
      "2026-07-13T09:00:00.000Z",
      "2026-07-13T08:00:00.000Z",
    ]);
  });

  it("filters by crew and by kind", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.appendAuditEvent(aud("crew-quint", "crew", "crew_added", "2026-07-13T08:00:00.000Z", { via: "self_claim" }));
    await repo.appendAuditEvent(aud("crew-quint", "admin", "crew_removed", "2026-07-13T09:00:00.000Z", {}, "crew-hooper"));
    await repo.appendAuditEvent(aud("crew-hooper", "crew", "crew_added", "2026-07-13T10:00:00.000Z", { via: "self_claim" }));

    expect((await buildAuditTrail(repo, { crewMemberId: asId<"CrewMemberId">("crew-quint") })).length).toBe(2);
    const added = await buildAuditTrail(repo, { action: "added" });
    expect(added.length).toBe(2);
    expect(added.every((r) => r.action === "added")).toBe(true);
  });

  it("orphan shift → null date/vessel, still listed (no-FK)", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.appendAuditEvent(
      aud("crew-quint", "admin", "crew_removed", "2026-07-13T09:00:00.000Z", { shiftId: asId<"ShiftId">("ghost") }, "crew-hooper"),
    );
    const [row] = await buildAuditTrail(repo);
    expect(row).toMatchObject({ crewName: "Quint", date: null, vesselName: null });
  });
});
