/**
 * Audit trail (#400, DEC-118) — the one-list, every-crew-event projection. Covers
 * that all 14 crew event types map to their own row, that the two shift-level
 * types are excluded, actor labelling, ordering, and the crew/kind filters.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, Shift, Vessel, RoleType } from "../domain/entities.js";
import type { AuditEvent, AuditEventType, AuditActorKind, AuditEventMetadata } from "../domain/audit.js";
import type { ReliabilityEvent, ReliabilityEventType, ReliabilityEventMetadata } from "../domain/reliability.js";
import { AUDIT_KIND_LABEL, buildAuditTrail } from "./audit-trail.js";

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
  await repo.saveCrewMember(crew("crew-hooper", "Hooper"));
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

describe("buildAuditTrail — every crew event, its own row", () => {
  it("maps all 12 crew reliability types to their kinds and EXCLUDES the 2 shift-level ones", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    const types: ReliabilityEventType[] = [
      "ask_sent", "nudged", "ask_accepted", "escalation_accepted", "ask_declined",
      "ask_ignored", "shift_acknowledged", "self_claim", "shift_completed", "shift_bailed",
      "no_show", "at_risk_rescue",
      "pool_widened", "board_landed", // excluded
    ];
    let t = 0;
    for (const ty of types) {
      await repo.logReliabilityEvent(rel("crew-quint", ty, `2026-07-13T10:${String(t++).padStart(2, "0")}:00.000Z`));
    }
    const rows = await buildAuditTrail(repo);
    // 12 crew types → 12 rows; pool_widened / board_landed produced none.
    expect(rows.length).toBe(12);
    expect(rows.map((r) => r.kind).sort()).toEqual(
      ["acknowledged", "asked", "bailed", "claimed", "completed", "escalation_in", "in", "no_reply", "no_show", "nudged", "out", "rescue"],
    );
  });

  it("a self-claim reads as the crew's own action, not the engine's (#570)", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.logReliabilityEvent(
      rel("crew-quint", "self_claim", "2026-07-13T10:00:00.000Z"),
    );
    const [row] = await buildAuditTrail(repo);
    expect(row!.kind).toBe("claimed");
    expect(row!.actorLabel).toBe("self");
  });

  it("maps the 3 audit types to added/removed/changed with resolved context", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.appendAuditEvent(aud("crew-quint", "crew", "crew_added", "2026-07-13T09:00:00.000Z", { via: "self_claim" }));
    await repo.appendAuditEvent(
      aud("crew-quint", "admin", "crew_removed", "2026-07-13T09:30:00.000Z", { shiftId: asId<"ShiftId">("shift-1"), reason: "misassignment" }, "crew-hooper"),
    );
    await repo.appendAuditEvent(aud("crew-quint", "importer", "shift_changed", "2026-07-13T10:00:00.000Z", {}, "xola"));

    const byKind = new Map((await buildAuditTrail(repo)).map((r) => [r.kind, r]));
    expect(byKind.get("added")!.actorLabel).toBe("self-claim");
    expect(byKind.get("removed")).toMatchObject({ actorLabel: "Hooper", detail: "misassignment", date: "2026-07-11" });
    expect(byKind.get("changed")!.actorLabel).toBe("Xola import");
  });

  it("labels a self-bail vs an operator-reported bail", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.logReliabilityEvent(rel("crew-quint", "shift_bailed", "2026-07-13T09:00:00.000Z"));
    await repo.logReliabilityEvent(rel("crew-hooper", "shift_bailed", "2026-07-13T09:30:00.000Z", { manual: true }));
    const byCrew = new Map((await buildAuditTrail(repo)).map((r) => [r.crewName, r.actorLabel]));
    expect(byCrew.get("Quint")).toBe("self");
    expect(byCrew.get("Hooper")).toBe("admin (reported)");
  });

  it("unions both logs newest-first", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.logReliabilityEvent(rel("crew-quint", "ask_sent", "2026-07-13T08:00:00.000Z"));
    await repo.appendAuditEvent(aud("crew-quint", "crew", "crew_added", "2026-07-13T10:00:00.000Z", { via: "self_claim" }));
    await repo.logReliabilityEvent(rel("crew-quint", "ask_accepted", "2026-07-13T09:00:00.000Z"));
    expect((await buildAuditTrail(repo)).map((r) => r.kind)).toEqual(["added", "in", "asked"]);
  });

  it("filters by crew and by kind", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.logReliabilityEvent(rel("crew-quint", "ask_declined", "2026-07-13T08:00:00.000Z"));
    await repo.logReliabilityEvent(rel("crew-quint", "ask_accepted", "2026-07-13T09:00:00.000Z"));
    await repo.logReliabilityEvent(rel("crew-hooper", "ask_declined", "2026-07-13T10:00:00.000Z"));

    expect((await buildAuditTrail(repo, { crewMemberId: asId<"CrewMemberId">("crew-quint") })).length).toBe(2);
    const outs = await buildAuditTrail(repo, { kind: "out" });
    expect(outs.length).toBe(2);
    expect(outs.every((r) => r.kind === "out")).toBe(true);
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

describe("AUDIT_KIND_LABEL (#630 ask vocabulary)", () => {
  it("the ask-answer pills read Yes/No — the kind keys stay in/out", () => {
    // The pill text on /admin/asks is the only place these labels surface. The
    // kinds themselves are derived display keys (ask_accepted → "in"), never
    // stored, so the vocabulary swap is label-only.
    expect(AUDIT_KIND_LABEL.in).toBe("Yes");
    expect(AUDIT_KIND_LABEL.out).toBe("No");
    expect(AUDIT_KIND_LABEL.escalation_in).toBe("Escalation Yes");
  });

  it("no label anywhere still reads In or Out", () => {
    expect(Object.values(AUDIT_KIND_LABEL)).not.toContain("In");
    expect(Object.values(AUDIT_KIND_LABEL)).not.toContain("Out");
  });
});
