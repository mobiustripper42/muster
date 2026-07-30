/**
 * Crew thread-list assembly (#117, DEC-071). The standing-vs-DM membership shape,
 * the unread rule (mirrors the decider: not mine, not yet read), cancel-on-read,
 * and empty-DM hiding — over the in-memory repo.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, Seat, Shift, Vessel } from "../domain/entities.js";
import {
  dmThreadId,
  participantId,
  standingThreadId,
  type Message,
} from "../messaging/entities.js";
import { buildThreadList, operatorStandingTarget } from "./thread-list.js";

const NOW = new Date("2026-07-01T08:00:00.000Z");
const TZ = "UTC"; // deterministic: today = the UTC date of NOW
const TODAY = "2026-07-01";
const TOMORROW = "2026-07-02";
const YESTERDAY = "2026-06-30";
const TENANT = asId<"TenantId">("t");
const ME = asId<"CrewMemberId">("crew-me");
const CO = asId<"CrewMemberId">("crew-co");
const DEE = asId<"CrewMemberId">("crew-dee");
const VESSEL = asId<"VesselId">("vessel-1");
const CAPTAIN = asId<"RoleTypeId">("role-captain");

const SHIFT_TODAY = asId<"ShiftId">("shift-today");
const SHIFT_LATER = asId<"ShiftId">("shift-later");
const SHIFT_PAST = asId<"ShiftId">("shift-past");

const crew = (id: typeof ME, name: string): CrewMember => ({
  id,
  name,
  phone: "555",
  ratings: [CAPTAIN],
  status: "active",
  reliabilityScore: null,
});

const shift = (id: typeof SHIFT_TODAY, date: string): Shift => ({
  id,
  vesselId: VESSEL,
  date,
  state: "Crewed",
  eventIds: [],
});

const seatFor = (id: string, shiftId: typeof SHIFT_TODAY, who: typeof ME): Seat => ({
  id: asId<"SeatId">(id),
  shiftId,
  role: CAPTAIN,
  kind: "required",
  state: "Confirmed",
  assignedCrewMemberId: who,
});

const msg = (over: Partial<Message> & Pick<Message, "id" | "threadId">): Message => ({
  senderId: String(CO),
  senderKind: "crew",
  body: "hi",
  createdAt: "2026-07-01T07:00:00.000Z",
  priority: false,
  ...over,
});

async function seed(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  const vessel: Vessel = {
    id: VESSEL,
    name: "Hops",
    coiMaxPax: 12,
    manning: [{ roleTypeId: CAPTAIN, count: 1 }],
  };
  await repo.saveVessel(vessel);
  await repo.saveCrewMember(crew(ME, "Quint"));
  await repo.saveCrewMember(crew(CO, "Hooper"));
  await repo.saveCrewMember(crew(DEE, "Dee"));
  // ME holds a shift today, one tomorrow, and one in the past (must drop off).
  await repo.saveShift(shift(SHIFT_TODAY, TODAY));
  await repo.saveShift(shift(SHIFT_LATER, TOMORROW));
  await repo.saveShift(shift(SHIFT_PAST, YESTERDAY));
  await repo.saveSeat(seatFor("s-today", SHIFT_TODAY, ME));
  await repo.saveSeat(seatFor("s-later", SHIFT_LATER, ME));
  await repo.saveSeat(seatFor("s-past", SHIFT_PAST, ME));
  return repo;
}

const shiftThread = (id: typeof SHIFT_TODAY) => standingThreadId("shift", TENANT, String(id));

describe("buildThreadList — assembly (#117, DEC-071)", () => {
  it("lists all-staff + today's cohort + each upcoming shift + DMs, in structured order", async () => {
    const repo = await seed();
    // A DM ME↔CO with a message → lists, titled by the other person.
    const dm = dmThreadId(TENANT, ME, CO);
    await repo.saveThread({ id: dm, tenantId: TENANT, kind: "dm", scopeRef: null, createdAt: NOW.toISOString() });
    await repo.saveParticipant({ id: participantId(dm, ME), threadId: dm, crewMemberId: ME });
    await repo.saveParticipant({ id: participantId(dm, CO), threadId: dm, crewMemberId: CO });
    await repo.saveMessage(msg({ id: asId<"MessageId">("dm-1"), threadId: dm, body: "yo" }));
    // An unread message in today's shift thread (from CO, not me).
    await repo.saveMessage(msg({ id: asId<"MessageId">("sh-1"), threadId: shiftThread(SHIFT_TODAY), body: "dock B" }));

    const view = await buildThreadList(repo, ME, TENANT, NOW, TZ);

    expect(view.threads.map((t) => t.title)).toEqual([
      "All staff",
      `Today’s crew · Wed, Jul 1`,
      "Hops · Wed, Jul 1",
      "Hops · Thu, Jul 2",
      "Hooper",
    ]);
    expect(view.threads.map((t) => t.kind)).toEqual([
      "all_staff",
      "cohort",
      "shift",
      "shift",
      "dm",
    ]);
    // Past shift's thread never appears.
    expect(view.threads.map((t) => t.threadId)).not.toContain(String(shiftThread(SHIFT_PAST)));
  });

  it("counts unread (not mine, not read) and sums totalUnread; cancel-on-read clears it", async () => {
    const repo = await seed();
    const tToday = shiftThread(SHIFT_TODAY);
    await repo.saveMessage(
      msg({ id: asId<"MessageId">("u1"), threadId: tToday, body: "one", createdAt: "2026-07-01T07:00:00.000Z" }),
    );
    await repo.saveMessage(
      msg({ id: asId<"MessageId">("u2"), threadId: tToday, body: "two", createdAt: "2026-07-01T07:00:01.000Z" }),
    );
    // My own message in the same thread doesn't count as unread-for-me — and it's
    // last, so it's the preview.
    await repo.saveMessage(
      msg({ id: asId<"MessageId">("mine"), threadId: tToday, senderId: String(ME), body: "ack", createdAt: "2026-07-01T07:00:02.000Z" }),
    );

    let view = await buildThreadList(repo, ME, TENANT, NOW, TZ);
    const todayRow = view.threads.find((t) => t.threadId === String(tToday))!;
    expect(todayRow.unread).toBe(2);
    expect(view.totalUnread).toBe(2);
    // Preview is the last message (my "ack").
    expect(todayRow.preview).toEqual({
      body: "ack",
      senderLabel: "Quint",
      createdAt: "2026-07-01T07:00:02.000Z",
    });

    // Reading at/after the messages cancels the unread (the doorbell's §7.2/7.3 mark).
    await repo.recordRead(tToday, { kind: "crew", id: String(ME) }, "2026-07-01T07:30:00.000Z");
    view = await buildThreadList(repo, ME, TENANT, NOW, TZ);
    expect(view.threads.find((t) => t.threadId === String(tToday))!.unread).toBe(0);
    expect(view.totalUnread).toBe(0);
  });

  it("hides a Cancelled shift's thread even though the kept seat lingers (#415 family)", async () => {
    const repo = await seed();
    // A future shift ME is Confirmed on, then Cancelled (a Xola re-import cancels
    // the shift but DEC-084 KEEPS the seat). The kept seat must not resurrect the
    // thread — the crew member was cancelled off it.
    const killed = asId<"ShiftId">("shift-killed");
    await repo.saveShift({ ...shift(SHIFT_TODAY, TOMORROW), id: killed, state: "Cancelled" });
    await repo.saveSeat(seatFor("s-killed", killed, ME));

    const view = await buildThreadList(repo, ME, TENANT, NOW, TZ);
    expect(view.threads.map((t) => t.threadId)).not.toContain(String(shiftThread(killed)));
  });

  it("KEEPS a Completed shift's thread — the crew who just ran the trip are still talking (#570)", async () => {
    const repo = await seed();
    // The inverse of the Cancelled case above. A cancelled trip has nothing to
    // discuss; a completed one just happened, and losing the thread the evening the
    // tick sweeps is exactly when it's most wanted.
    const done = asId<"ShiftId">("shift-done");
    await repo.saveShift({ ...shift(SHIFT_TODAY, TOMORROW), id: done, state: "Completed" });
    await repo.saveSeat(seatFor("s-done", done, ME));

    const view = await buildThreadList(repo, ME, TENANT, NOW, TZ);
    expect(view.threads.map((t) => t.threadId)).toContain(String(shiftThread(done)));
  });

  it("hides an empty DM (no message) but lists one that carries a message", async () => {
    const repo = await seed();
    // Empty DM ME↔DEE — participants exist, no message.
    const empty = dmThreadId(TENANT, ME, DEE);
    await repo.saveThread({ id: empty, tenantId: TENANT, kind: "dm", scopeRef: null, createdAt: NOW.toISOString() });
    await repo.saveParticipant({ id: participantId(empty, ME), threadId: empty, crewMemberId: ME });
    await repo.saveParticipant({ id: participantId(empty, DEE), threadId: empty, crewMemberId: DEE });

    const view = await buildThreadList(repo, ME, TENANT, NOW, TZ);
    expect(view.threads.map((t) => t.threadId)).not.toContain(String(empty));
    expect(view.threads.some((t) => t.kind === "dm")).toBe(false);
  });
});

describe("operatorStandingTarget — the operator's post authorization (#317)", () => {
  const NOW = new Date("2026-07-10T12:00:00Z");
  // A tenant id WITH dashes — the slice-and-reconstruct must still parse the date.
  const T = asId<"TenantId">("tenant-brewboat");

  it("accepts all-staff", () => {
    const t = operatorStandingTarget(standingThreadId("all_staff", T, null), T, NOW);
    expect(t?.kind).toBe("all_staff");
  });

  it("accepts today's + any FUTURE day's cohort (the ungated Cohort button), tz UTC", () => {
    for (const day of ["2026-07-10", "2026-07-25", "2027-01-01"]) {
      const t = operatorStandingTarget(standingThreadId("cohort", T, day), T, NOW, "UTC");
      expect(t).toMatchObject({ kind: "cohort", scopeRef: day });
    }
  });

  it("REFUSES a past-day cohort — no ringing crew about a day that already ran", () => {
    expect(operatorStandingTarget(standingThreadId("cohort", T, "2026-07-09"), T, NOW, "UTC")).toBeNull();
    expect(operatorStandingTarget(standingThreadId("cohort", T, "2026-01-01"), T, NOW, "UTC")).toBeNull();
  });

  it("rejects a shift thread, a DM, and a malformed id", () => {
    expect(operatorStandingTarget(standingThreadId("shift", T, "shift-x"), T, NOW)).toBeNull();
    expect(operatorStandingTarget(asId<"ThreadId">("thread-cohort-tenant-brewboat-nope"), T, NOW)).toBeNull();
    expect(operatorStandingTarget(asId<"ThreadId">("garbage"), T, NOW)).toBeNull();
  });
});
