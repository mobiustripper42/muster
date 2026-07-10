/**
 * Ask trail (#331) — the operator's ask-history projection. Covers seat→shift
 * label resolution, the four derived outcomes, newest-first ordering, the three
 * filters (crew / shift / day), and the no-FK orphan (seat/shift gone → null
 * labels, still listed).
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Ask, CrewMember, Seat, Shift, Vessel, RoleType } from "../domain/entities.js";
import { buildAskTrail } from "./ask-trail.js";

const TENANT = asId<"TenantId">("t-1");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const V1 = asId<"VesselId">("vessel-1");
const S1 = asId<"ShiftId">("shift-1");
const S2 = asId<"ShiftId">("shift-2");
const QUINT = asId<"CrewMemberId">("crew-quint");
const HOOPER = asId<"CrewMemberId">("crew-hooper");

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

const seat = (id: string, shiftId: string): Seat => ({
  id: asId<"SeatId">(id),
  shiftId: asId<"ShiftId">(shiftId),
  role: CAPTAIN,
  kind: "required",
  state: "Asked",
});

const ask = (id: string, seatId: string, crewId: string, sentAt: string, extra: Partial<Ask> = {}): Ask => ({
  id: asId<"AskId">(id),
  seatId: asId<"SeatId">(seatId),
  crewMemberId: asId<"CrewMemberId">(crewId),
  channel: "sms",
  sentAt,
  ...extra,
});

async function seedBase(repo: InMemoryRepository): Promise<void> {
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" } as RoleType);
  await repo.saveVessel({ id: V1, name: "Hops", coiMaxPax: 6, manning: [] } as Vessel);
  await repo.saveCrewMember(crew("crew-quint", "Quint"));
  await repo.saveCrewMember(crew("crew-hooper", "Hooper"));
  await repo.saveShift(shift("shift-1", "2026-07-11"));
  await repo.saveShift(shift("shift-2", "2026-07-12"));
  await repo.saveSeat(seat("seat-1", "shift-1"));
  await repo.saveSeat(seat("seat-2", "shift-2"));
}

describe("buildAskTrail", () => {
  it("resolves crew/vessel/role/date via seat→shift and derives outcomes", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.saveAsk(
      ask("ask-1", "seat-1", "crew-quint", "2026-07-10T14:00:00.000Z", {
        respondedAt: "2026-07-10T14:00:22.000Z",
        response: "declined",
      }),
    );

    const [row] = await buildAskTrail(repo);
    expect(row).toMatchObject({
      crewName: "Quint",
      vesselName: "Hops",
      roleName: "captain",
      date: "2026-07-11",
      shiftId: "shift-1",
      channel: "sms",
      outcome: "declined",
    });
  });

  it("derives all four outcomes", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.saveAsk(ask("a-acc", "seat-1", "crew-quint", "2026-07-10T10:00:00.000Z", { respondedAt: "2026-07-10T10:01:00.000Z", response: "accepted" }));
    await repo.saveAsk(ask("a-dec", "seat-1", "crew-quint", "2026-07-10T11:00:00.000Z", { respondedAt: "2026-07-10T11:01:00.000Z", response: "declined" }));
    await repo.saveAsk(ask("a-out", "seat-1", "crew-quint", "2026-07-10T12:00:00.000Z", { respondedAt: "2026-07-10T12:30:00.000Z" }));
    await repo.saveAsk(ask("a-wait", "seat-1", "crew-quint", "2026-07-10T13:00:00.000Z"));

    const byId = new Map((await buildAskTrail(repo)).map((r) => [String(r.askId), r.outcome]));
    expect(byId.get("a-acc")).toBe("accepted");
    expect(byId.get("a-dec")).toBe("declined");
    expect(byId.get("a-out")).toBe("timed_out");
    expect(byId.get("a-wait")).toBe("waiting");
  });

  it("sorts newest ask first", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.saveAsk(ask("old", "seat-1", "crew-quint", "2026-07-10T08:00:00.000Z"));
    await repo.saveAsk(ask("new", "seat-1", "crew-quint", "2026-07-10T09:00:00.000Z"));
    expect((await buildAskTrail(repo)).map((r) => String(r.askId))).toEqual(["new", "old"]);
  });

  it("filters by crew, by shift, and by day", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.saveAsk(ask("q1", "seat-1", "crew-quint", "2026-07-10T10:00:00.000Z")); // shift-1, Jul 11
    await repo.saveAsk(ask("h2", "seat-2", "crew-hooper", "2026-07-10T11:00:00.000Z")); // shift-2, Jul 12

    expect((await buildAskTrail(repo, { crewMemberId: QUINT })).map((r) => String(r.askId))).toEqual(["q1"]);
    expect((await buildAskTrail(repo, { shiftId: S2 })).map((r) => String(r.askId))).toEqual(["h2"]);
    expect((await buildAskTrail(repo, { day: "2026-07-11" })).map((r) => String(r.askId))).toEqual(["q1"]);
  });

  it("lists an ask whose seat is gone (no-FK) with null labels", async () => {
    const repo = new InMemoryRepository();
    await seedBase(repo);
    await repo.saveAsk(ask("orphan", "seat-gone", "crew-quint", "2026-07-10T10:00:00.000Z"));
    const [row] = await buildAskTrail(repo);
    expect(row).toMatchObject({ crewName: "Quint", shiftId: null, date: null, vesselName: null, roleName: null });
  });
});
