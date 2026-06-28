/**
 * Operator cross-visibility thread list (#118, DEC-072): post-targets pinned
 * (all-staff + today's cohort, real row preferred over synth), the rest by recency,
 * operator DM titles naming both sides.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, Shift, Vessel } from "../domain/entities.js";
import {
  dmThreadId,
  participantId,
  standingThreadId,
  type Message,
  type Thread,
} from "../messaging/entities.js";
import { buildOperatorThreads } from "./operator-threads.js";

const NOW = new Date("2026-07-01T08:00:00.000Z");
const TZ = "UTC";
const TODAY = "2026-07-01";
const TENANT = asId<"TenantId">("t");
const QUINT = asId<"CrewMemberId">("crew-quint");
const HOOPER = asId<"CrewMemberId">("crew-hooper");
const VESSEL = asId<"VesselId">("vessel-1");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const SHIFT = asId<"ShiftId">("shift-1");

const crew = (id: typeof QUINT, name: string): CrewMember => ({
  id,
  name,
  phone: "555",
  ratings: [CAPTAIN],
  status: "active",
  reliabilityScore: null,
});

const msg = (over: Partial<Message> & Pick<Message, "id" | "threadId" | "createdAt">): Message => ({
  senderId: String(QUINT),
  senderKind: "crew",
  body: "hi",
  priority: false,
  ...over,
});

const allStaffId = standingThreadId("all_staff", TENANT, null);
const cohortId = standingThreadId("cohort", TENANT, TODAY);
const shiftThreadId = standingThreadId("shift", TENANT, String(SHIFT));
const dmId = dmThreadId(TENANT, QUINT, HOOPER);

async function seed(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  const vessel: Vessel = { id: VESSEL, name: "Hops", coiMaxPax: 12, manning: [{ roleTypeId: CAPTAIN, count: 1 }] };
  const shift: Shift = { id: SHIFT, vesselId: VESSEL, date: TODAY, state: "Crewed", eventIds: [] };
  await repo.saveVessel(vessel);
  await repo.saveShift(shift);
  await repo.saveCrewMember(crew(QUINT, "Quint"));
  await repo.saveCrewMember(crew(HOOPER, "Hooper"));

  const thread = (id: typeof allStaffId, kind: Thread["kind"], scopeRef: string | null): Thread => ({
    id,
    tenantId: TENANT,
    kind,
    scopeRef,
    createdAt: NOW.toISOString(),
  });
  // All-staff: a REAL row + an operator message (proves real-preferred-over-synth).
  await repo.saveThread(thread(allStaffId, "all_staff", null));
  await repo.saveMessage(
    msg({ id: asId<"MessageId">("a1"), threadId: allStaffId, senderId: "crew-spink", senderKind: "admin", body: "roster note", createdAt: "2026-07-01T07:00:00.000Z" }),
  );
  // A shift thread (older) and a DM (newer) — the recency-ordered "rest".
  await repo.saveThread(thread(shiftThreadId, "shift", String(SHIFT)));
  await repo.saveMessage(msg({ id: asId<"MessageId">("s1"), threadId: shiftThreadId, body: "shift note", createdAt: "2026-07-01T07:10:00.000Z" }));
  await repo.saveThread(thread(dmId, "dm", null));
  await repo.saveParticipant({ id: participantId(dmId, QUINT), threadId: dmId, crewMemberId: QUINT });
  await repo.saveParticipant({ id: participantId(dmId, HOOPER), threadId: dmId, crewMemberId: HOOPER });
  await repo.saveMessage(msg({ id: asId<"MessageId">("d1"), threadId: dmId, body: "dm hey", createdAt: "2026-07-01T07:30:00.000Z" }));
  return repo;
}

describe("buildOperatorThreads (#118, DEC-072)", () => {
  it("pins all-staff + today's cohort, then the rest by recency; operator DM names both sides", async () => {
    const repo = await seed();
    const view = await buildOperatorThreads(repo, TENANT, NOW, TZ);

    // Post-targets first, in order.
    expect(view.threads[0]).toMatchObject({ threadId: String(allStaffId), kind: "all_staff", title: "All staff" });
    expect(view.threads[1]).toMatchObject({ threadId: String(cohortId), kind: "cohort", title: "Today’s crew · Wed, Jul 1" });
    // All-staff shows the real row's message (real preferred over the empty synth).
    expect(view.threads[0]!.preview).toEqual({ body: "roster note", senderLabel: "Operator", createdAt: "2026-07-01T07:00:00.000Z" });
    // Today's cohort has no row yet → no preview, still a post target.
    expect(view.threads[1]!.preview).toBeUndefined();

    // The rest, recency desc: DM (07:30) before the shift thread (07:10).
    const rest = view.threads.slice(2);
    expect(rest.map((t) => t.threadId)).toEqual([String(dmId), String(shiftThreadId)]);
    expect(rest[0]).toMatchObject({ title: "Hooper ↔ Quint", preview: { body: "dm hey", senderLabel: "Quint" } });
    expect(rest[1]!.title).toBe("Hops · Wed, Jul 1");
  });
});
