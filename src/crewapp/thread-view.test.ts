/**
 * Crew thread view (#117, DEC-071). The DEC-052 authorization predicate (member →
 * read; non-member / non-crew → null), the empty-standing-thread case (no row yet,
 * still viewable), and message shaping (mine flag, sender labels, priority).
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, Seat, Shift, Vessel } from "../domain/entities.js";
import type { Subject } from "../domain/entities.js";
import { standingThreadId, type Message } from "../messaging/entities.js";
import { buildThreadView } from "./thread-view.js";

const NOW = new Date("2026-07-01T08:00:00.000Z");
const TZ = "UTC";
const TODAY = "2026-07-01";
const YESTERDAY = "2026-06-30";
const TENANT = asId<"TenantId">("t");
const ME = asId<"CrewMemberId">("crew-me");
const CO = asId<"CrewMemberId">("crew-co");
const VESSEL = asId<"VesselId">("vessel-1");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MINE: Subject = { kind: "crew", id: String(ME) };

const SHIFT_MINE = asId<"ShiftId">("shift-mine");
const SHIFT_OTHERS = asId<"ShiftId">("shift-others"); // ME not seated here
const SHIFT_PAST = asId<"ShiftId">("shift-past"); // ME seated, but departed (yesterday)

const crew = (id: typeof ME, name: string): CrewMember => ({
  id,
  name,
  phone: "555",
  ratings: [CAPTAIN],
  status: "active",
  reliabilityScore: null,
});
const shift = (id: typeof SHIFT_MINE, date: string = TODAY): Shift => ({
  id,
  vesselId: VESSEL,
  date,
  state: "Crewed",
  eventIds: [],
});
const seat = (id: string, shiftId: typeof SHIFT_MINE, who: typeof ME): Seat => ({
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
  await repo.saveShift(shift(SHIFT_MINE));
  await repo.saveShift(shift(SHIFT_OTHERS));
  await repo.saveShift(shift(SHIFT_PAST, YESTERDAY));
  await repo.saveSeat(seat("s-mine", SHIFT_MINE, ME));
  await repo.saveSeat(seat("s-others", SHIFT_OTHERS, CO)); // ME absent here
  await repo.saveSeat(seat("s-past", SHIFT_PAST, ME)); // ME was on it
  return repo;
}

const shiftThread = (id: typeof SHIFT_MINE) => standingThreadId("shift", TENANT, String(id));

describe("buildThreadView — authorization + shaping (#117, DEC-071)", () => {
  it("a member reads their thread; messages carry mine / sender label / priority", async () => {
    const repo = await seed();
    const t = shiftThread(SHIFT_MINE);
    await repo.saveMessage(msg({ id: asId<"MessageId">("m1"), threadId: t, body: "dock B" }));
    await repo.saveMessage(
      msg({ id: asId<"MessageId">("m2"), threadId: t, senderId: String(ME), body: "ack", createdAt: "2026-07-01T07:01:00.000Z" }),
    );
    await repo.saveMessage(
      msg({
        id: asId<"MessageId">("m3"),
        threadId: t,
        senderId: "crew-spink",
        senderKind: "admin",
        body: "all set",
        priority: true,
        createdAt: "2026-07-01T07:02:00.000Z",
      }),
    );

    const view = await buildThreadView(repo, t, MINE, TENANT, NOW, TZ);
    expect(view).not.toBeNull();
    expect(view!.title).toBe("Hops · Wed, Jul 1");
    expect(view!.kind).toBe("shift");
    expect(view!.messages.map((m) => [m.senderLabel, m.body, m.mine, m.priority])).toEqual([
      ["Hooper", "dock B", false, false],
      ["Quint", "ack", true, false],
      ["Operator", "all set", false, true],
    ]);
  });

  it("an unposted standing thread (no row, no messages) is still viewable + empty", async () => {
    const repo = await seed();
    const view = await buildThreadView(repo, shiftThread(SHIFT_MINE), MINE, TENANT, NOW, TZ);
    expect(view).not.toBeNull();
    expect(view!.messages).toEqual([]);
  });

  it("a non-member thread returns null even when it exists (attention ≠ authorization, DEC-052)", async () => {
    const repo = await seed();
    const t = shiftThread(SHIFT_OTHERS);
    await repo.saveThread({ id: t, tenantId: TENANT, kind: "shift", scopeRef: String(SHIFT_OTHERS), createdAt: NOW.toISOString() });
    await repo.saveMessage(msg({ id: asId<"MessageId">("o1"), threadId: t, body: "their thread" }));
    const view = await buildThreadView(repo, t, MINE, TENANT, NOW, TZ);
    expect(view).toBeNull();
  });

  it("a PAST shift thread still opens for its member — rung-but-can't-read is the wrong direction (DEC-071)", async () => {
    const repo = await seed();
    // The thread exists (it was posted to + would ring), but its shift is yesterday.
    // The date-agnostic membership (the doorbell's own deriveMembers) must still let
    // a member in — otherwise a midnight-rollover ring lands on a dead-end view.
    const t = shiftThread(SHIFT_PAST);
    await repo.saveThread({ id: t, tenantId: TENANT, kind: "shift", scopeRef: String(SHIFT_PAST), createdAt: NOW.toISOString() });
    await repo.saveMessage(msg({ id: asId<"MessageId">("p1"), threadId: t, body: "left a cooler aboard" }));

    const view = await buildThreadView(repo, t, MINE, TENANT, NOW, TZ);
    expect(view).not.toBeNull();
    expect(view!.messages.map((m) => m.body)).toEqual(["left a cooler aboard"]);
    expect(view!.title).toBe("Hops · Tue, Jun 30"); // not "Today's", and not refused
  });

  it("a non-crew (operator) viewer returns null — the 6.8 seam", async () => {
    const repo = await seed();
    const view = await buildThreadView(
      repo,
      shiftThread(SHIFT_MINE),
      { kind: "admin", id: "crew-spink" },
      TENANT,
      NOW,
      TZ,
    );
    expect(view).toBeNull();
  });
});
