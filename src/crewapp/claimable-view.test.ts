import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { CrewMemberId, ShiftId } from "../domain/ids.js";
import { asId } from "../domain/ids.js";
import { buildClaimableView } from "./claimable-view.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const TENANT = asId<"TenantId">("t1");
const VESSEL = asId<"VesselId">("vessel-x");
const NOW = new Date("2026-06-15T12:00:00.000Z"); // today (vessel-local) = 2026-06-15
const IN_WINDOW = "2026-07-01"; // ~16d out

let repo: InMemoryRepository;
beforeEach(async () => {
  repo = new InMemoryRepository();
  await repo.saveVessel({ id: VESSEL, name: "Brew 2", coiMaxPax: 40, manning: [] });
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "Captain" });
  await repo.saveRoleType({ id: MATE, tenantId: TENANT, name: "Mate" });
});

async function crew(
  id: string,
  ratings: typeof CAPTAIN[],
  opts: { status?: "active" | "inactive"; mmcExpiry?: string | null } = {},
): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name: id,
    phone: "555",
    ratings,
    status: opts.status ?? "active",
    reliabilityScore: null,
  });
  const mmc = opts.mmcExpiry === undefined ? "2026-12-31" : opts.mmcExpiry;
  if (mmc) {
    await repo.saveCredential({
      id: asId<"CredentialId">(`cred-${id}`),
      crewMemberId: crewId,
      type: "MMC",
      expiry: mmc,
    });
  }
  return crewId;
}

/** A Filling shift with N scheduled events at the given times + one Open seat. */
async function openShift(
  id: string,
  times: string[],
  opts: {
    date?: string;
    role?: typeof CAPTAIN;
    cancelledTimes?: string[];
  } = {},
): Promise<ShiftId> {
  const shiftId = asId<"ShiftId">(id);
  const date = opts.date ?? IN_WINDOW;
  const eventIds = [];
  let n = 0;
  for (const time of times) {
    const eid = asId<"EventId">(`${id}-ev-${n++}`);
    await repo.saveEvent({ id: eid, vesselId: VESSEL, date, time, capacity: 12, status: "scheduled" });
    eventIds.push(eid);
  }
  for (const time of opts.cancelledTimes ?? []) {
    const eid = asId<"EventId">(`${id}-cx-${n++}`);
    await repo.saveEvent({ id: eid, vesselId: VESSEL, date, time, capacity: 12, status: "cancelled" });
    eventIds.push(eid);
  }
  await repo.saveShift({ id: shiftId, vesselId: VESSEL, date, state: "Filling", eventIds });
  await repo.saveSeat({
    id: asId<"SeatId">(`${id}-seat`),
    shiftId,
    role: opts.role ?? MATE,
    kind: "required",
    state: "Open",
  });
  return shiftId;
}

describe("buildClaimableView (DEC-074/077)", () => {
  it("decorates a claimable seat with vessel/role names, trip times, and call→back window", async () => {
    const c = await crew("c", [MATE]);
    await openShift("sh", ["13:00", "16:00"]);

    const [row, ...rest] = await buildClaimableView(repo, c, NOW);

    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      vesselName: "Brew 2",
      roleName: "Mate",
      date: IN_WINDOW,
      tripTimes: ["13:00", "16:00"],
    });
    // call = earliest − lead; back = latest + trip + lead (DEC-041). Exact values
    // are the helper's contract; here we just assert the window is populated and
    // ordered call < back.
    expect(row?.callTime).toBeDefined();
    expect(row?.shiftEndTime).toBeDefined();
    expect(row!.callTime! < row!.shiftEndTime!).toBe(true);
  });

  it("trip times count scheduled departures only — a cancelled trip is excluded", async () => {
    const c = await crew("c", [MATE]);
    await openShift("sh", ["13:00"], { cancelledTimes: ["18:00"] });

    const [row] = await buildClaimableView(repo, c, NOW);
    expect(row?.tripTimes).toEqual(["13:00"]); // 18:00 cancelled → not counted
  });

  it("range narrows the list (the surface's today / weekend / from–to filter)", async () => {
    const c = await crew("c", [MATE]);
    await openShift("near", ["10:00"], { date: "2026-06-20" });
    await openShift("far", ["10:00"], { date: "2026-07-10" });

    const all = await buildClaimableView(repo, c, NOW);
    expect(all).toHaveLength(2);

    const narrowed = await buildClaimableView(repo, c, NOW, {
      from: "2026-06-18",
      to: "2026-06-25",
    });
    expect(narrowed.map((r) => r.shiftId)).toEqual(["near"]);
  });

  it("sorts by date then earliest departure", async () => {
    const c = await crew("c", [MATE]);
    await openShift("b", ["09:00"], { date: "2026-07-02" });
    await openShift("a-late", ["15:00"], { date: "2026-07-01" });
    await openShift("a-early", ["08:00"], { date: "2026-07-01" });

    const rows = await buildClaimableView(repo, c, NOW);
    expect(rows.map((r) => r.shiftId)).toEqual(["a-early", "a-late", "b"]);
  });

  it("an event-less shift has no window", async () => {
    const c = await crew("c", [MATE]);
    await openShift("sh", []); // no events

    const [row] = await buildClaimableView(repo, c, NOW);
    expect(row?.tripTimes).toEqual([]);
    expect(row?.callTime).toBeUndefined();
    expect(row?.shiftEndTime).toBeUndefined();
  });

  it("native-role-only door propagates: a captain does not see a mate seat (DEC-076)", async () => {
    const cap = await crew("cap", [CAPTAIN, MATE]);
    await openShift("mate-sh", ["10:00"], { role: MATE });
    expect(await buildClaimableView(repo, cap, NOW)).toHaveLength(0);
  });

  it("reads through suppression: a viewer on PTO that date sees nothing (DEC-074)", async () => {
    const c = await crew("c", [MATE]);
    await openShift("sh", ["10:00"], { date: IN_WINDOW });
    await repo.savePtoWindow({
      id: asId<"PtoWindowId">("pto-1"),
      crewMemberId: c,
      start: IN_WINDOW,
      end: IN_WINDOW,
    });
    expect(await buildClaimableView(repo, c, NOW)).toHaveLength(0);
  });
});
