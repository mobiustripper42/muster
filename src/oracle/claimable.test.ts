import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import { asId } from "../domain/ids.js";
import { isRatedFor, nativeRole } from "./eligibility.js";
import { claimableSeatsFor } from "./claimable.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VESSEL = asId<"VesselId">("vessel-x");
const NOW = new Date("2026-06-15T12:00:00.000Z"); // today = 2026-06-15
const IN_WINDOW = "2026-07-01"; // ~16d out (≤ today+45d)
const FAR = "2026-09-01"; // ~78d out (> today+45d)

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
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

async function shift(
  id: string,
  opts: { date?: string; state?: "Pending" | "Filling" | "Crewed" | "AtRisk" } = {},
): Promise<ShiftId> {
  const shiftId = asId<"ShiftId">(id);
  await repo.saveShift({
    id: shiftId,
    vesselId: VESSEL,
    date: opts.date ?? IN_WINDOW,
    state: opts.state ?? "Pending",
    eventIds: [],
  });
  return shiftId;
}

async function seat(
  shiftId: ShiftId,
  id: string,
  opts: {
    role?: typeof CAPTAIN;
    kind?: "required" | "supernumerary";
    state?: "Open" | "Asked" | "Confirmed";
    assigned?: CrewMemberId;
  } = {},
): Promise<SeatId> {
  const seatId = asId<"SeatId">(id);
  await repo.saveSeat({
    id: seatId,
    shiftId,
    role: opts.role ?? CAPTAIN,
    kind: opts.kind ?? "required",
    state: opts.state ?? "Open",
    ...(opts.assigned ? { assignedCrewMemberId: opts.assigned } : {}),
  });
  return seatId;
}

const claimedIds = async (crewId: CrewMemberId): Promise<string[]> =>
  (await claimableSeatsFor(repo, crewId, NOW)).map((s) => s.seatId);

describe("nativeRole (DEC-076)", () => {
  it("captain for a dual-rated [captain, mate] member", () => {
    expect(nativeRole({ ratings: [CAPTAIN, MATE] } as never)).toBe(CAPTAIN);
    expect(nativeRole({ ratings: [MATE, CAPTAIN] } as never)).toBe(CAPTAIN); // order-independent
  });
  it("the sole role otherwise", () => {
    expect(nativeRole({ ratings: [MATE] } as never)).toBe(MATE);
    expect(nativeRole({ ratings: [CAPTAIN] } as never)).toBe(CAPTAIN);
  });
  it("null when there is no determinable role", () => {
    expect(nativeRole({ ratings: [] } as never)).toBeNull();
  });
});

describe("claimableSeatsFor (DEC-076)", () => {
  it("returns an Open+required native-role seat on a Pending shift in-window", async () => {
    const c = await crew("c", [MATE]);
    const s = await shift("sh");
    const seatId = await seat(s, "seat-mate", { role: MATE });
    expect(await claimedIds(c)).toEqual([seatId]);
  });

  it("native-role-only: a dual-rated captain sees captain seats, NOT mate seats", async () => {
    const c = await crew("cap", [CAPTAIN, MATE]);
    const s = await shift("sh");
    const capSeat = await seat(s, "seat-cap", { role: CAPTAIN });
    await seat(s, "seat-mate", { role: MATE });
    expect(await claimedIds(c)).toEqual([capSeat]); // mate seat excluded
  });

  it("clamps to [today, today+45d]", async () => {
    const c = await crew("c", [CAPTAIN]);
    const near = await shift("near", { date: IN_WINDOW });
    const far = await shift("far", { date: FAR });
    const nearSeat = await seat(near, "seat-near");
    await seat(far, "seat-far");
    expect(await claimedIds(c)).toEqual([nearSeat]);
  });

  it("only Pending/Filling shifts — not Crewed/AtRisk", async () => {
    const c = await crew("c", [CAPTAIN]);
    const filling = await shift("fill", { state: "Filling" });
    const crewed = await shift("done", { state: "Crewed" });
    const fillSeat = await seat(filling, "seat-fill");
    await seat(crewed, "seat-done");
    expect(await claimedIds(c)).toEqual([fillSeat]);
  });

  it("only Open + required seats — not Asked/Confirmed/supernumerary", async () => {
    const c = await crew("c", [CAPTAIN]);
    const s = await shift("sh");
    const open = await seat(s, "seat-open");
    await seat(s, "seat-asked", { state: "Asked" });
    await seat(s, "seat-sup", { kind: "supernumerary" });
    expect(await claimedIds(c)).toEqual([open]);
  });

  it("applies the §1.3 eligible-pool gate: lapsed MMC, PTO, double-booked all drop", async () => {
    // Lapsed MMC before the trip date.
    const lapsed = await crew("lapsed", [CAPTAIN], { mmcExpiry: "2026-06-20" });
    const s = await shift("sh");
    await seat(s, "seat-1");
    expect(await claimedIds(lapsed)).toEqual([]);

    // On PTO over the trip date.
    const onPto = await crew("pto", [CAPTAIN]);
    await repo.savePtoWindow({
      id: asId<"PtoWindowId">("pto-1"),
      crewMemberId: onPto,
      start: "2026-06-28",
      end: "2026-07-05",
    });
    expect(await claimedIds(onPto)).toEqual([]);

    // Already committed to another shift the same day.
    const booked = await crew("booked", [CAPTAIN]);
    const other = await shift("other");
    await seat(other, "seat-other", { state: "Confirmed", assigned: booked });
    expect(await claimedIds(booked)).toEqual([]);
  });

  it("inactive crew claim nothing", async () => {
    const c = await crew("c", [CAPTAIN], { status: "inactive" });
    const s = await shift("sh");
    await seat(s, "seat-1");
    expect(await claimedIds(c)).toEqual([]);
  });

  it("both doors, dual-rated: self-claim hides the mate seat the operator can still assign", async () => {
    const cap = await crew("cap", [CAPTAIN, MATE]);
    const s = await shift("sh");
    await seat(s, "seat-mate", { role: MATE });

    // Self-claim door (native-role-only): the captain cannot self-claim a mate seat.
    expect(await claimedIds(cap)).toEqual([]);
    // Operator-assign door (full ratings): the captain IS rated for mate, so the
    // operator can place them there (the dual-rating fill hack, DEC-064/066).
    expect(isRatedFor([CAPTAIN, MATE], MATE)).toBe(true);
  });
});
