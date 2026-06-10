/**
 * Dev seed for the At-Risk board (SPEC §2.5, #42/#43). Seeds one row per
 * membership reason so every board state is eyeball-able:
 *
 *   A. willingness-exhausted — captain seat, whole pool answered (1 declined,
 *      1 silent), trip ~24h out → core row with a real SYSTEM-TRIED trail,
 *      decliner + ghost still leanable.
 *   B. eligibility-exhausted — an ENGINEER seat and no engineer exists
 *      anywhere (a third role, so other seeds can't accidentally fill it),
 *      trip ~5d out → AtRisk row, "not yet worked", empty pool → the
 *      honesty line.
 *   C. regression — rested-Bailed captain seat + the bail logged, trip ~30h
 *      out → pinned to the top; the bailer is excluded from Lean.
 *   D. credential lapse — fully-Crewed shift ~4d out whose confirmed
 *      captain's MMC expires tomorrow.
 *
 * Unlike seed-crewapp-dev's fixed dates, trips here are computed FROM SEED
 * TIME — the board is staffing-horizon-sensitive (DEC-022), so fixed dates
 * would rot off the board within days. Re-run any time to reset the clock.
 *
 * Idempotent: entity writes are upserts; the one append-only log write (the
 * bail) is guarded. Run: npm run db:seed:atrisk  (DB up + migrated first).
 * Then: /crew/dev-link?admin=spink → tap the link → /admin/at-risk.
 *
 * Heads-up: `npm run db:tick` afterward makes the engine WORK this state —
 * scenario A is a stalled Filling shift, so Tier-2 nudges the ghost and the
 * row leaves the board while that ask is in flight. That's the engine doing
 * its job, not the seed breaking.
 */
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { asId } from "../src/domain/ids.js";
import { logShiftBailed } from "../src/oracle/reliability-log.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

const TENANT = asId<"TenantId">("brewboat");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const ENGINEER = asId<"RoleTypeId">("role-engineer");

// Trips relative to seed time — re-run to re-anchor.
const at = (hours: number) => new Date(Date.now() + hours * 3600_000);
const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const timeOf = (d: Date) => d.toISOString().slice(11, 16);

const MMC_GOOD = "2027-12-31";

async function captain(id: string, name: string, mmcExpiry = MMC_GOOD) {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name,
    phone: "+15555550100",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
  });
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: mmcExpiry,
  });
  return crewId;
}

async function shipShift(
  key: string,
  vesselName: string,
  role: typeof CAPTAIN | typeof ENGINEER,
  tripAt: Date,
  seatState: "Open" | "Bailed" | "Confirmed",
  persisted: "Pending" | "Filling" | "AtRisk" | "Crewed",
  assigned?: ReturnType<typeof asId<"CrewMemberId">>,
) {
  const vesselId = asId<"VesselId">(`vessel-ar-${key}`);
  const shiftId = asId<"ShiftId">(`shift-ar-${key}`);
  const eventId = asId<"EventId">(`evt-ar-${key}`);
  await repo.saveVessel({
    id: vesselId,
    name: vesselName,
    coiMaxPax: 12,
    manning: [{ roleTypeId: role, count: 1 }],
  });
  await repo.saveEvent({
    id: eventId,
    vesselId,
    date: dateOf(tripAt),
    time: timeOf(tripAt),
    capacity: 12,
    status: "scheduled",
    dock: "Pier 9, Lake Union, Seattle",
  });
  await repo.saveShift({
    id: shiftId,
    vesselId,
    date: dateOf(tripAt),
    state: persisted,
    eventIds: [eventId],
  });
  const seatId = asId<"SeatId">(`seat-ar-${key}`);
  await repo.saveSeat({
    id: seatId,
    shiftId,
    role,
    kind: "required",
    state: seatState,
    ...(assigned ? { assignedCrewMemberId: assigned } : {}),
  });
  return { shiftId, seatId };
}

/**
 * Close any LIVE asks on a scenario seat — a prior `db:tick` may have escalated
 * scenario A (a Tier-2 nudge ask), and an in-flight ask would keep the row off
 * the board after a re-seed. Stamping respondedAt with no response marks them
 * timed-out (more silents in the trail — harmless), restoring the scenario.
 */
async function closeLiveAsks(seatId: ReturnType<typeof asId<"SeatId">>) {
  for (const ask of await repo.listAsksForSeat(seatId)) {
    if (ask.respondedAt === undefined) {
      await repo.saveAsk({ ...ask, respondedAt: new Date().toISOString() });
    }
  }
}

try {
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" });
  await repo.saveRoleType({ id: ENGINEER, tenantId: TENANT, name: "engineer" });

  const lance = await captain("crew-ar-declined", "Lance");
  const gardner = await captain("crew-ar-silent", "Gardner");
  const bailer = await captain("crew-ar-bailer", "Cody");
  await captain("crew-ar-sub", "Marisol");
  const lapsing = await captain("crew-ar-lapsing", "Gus", dateOf(at(24)));

  // A — willingness-exhausted: broadcast went out 2h ago; Lance said no, Gardner
  // ghosted (timed out: respondedAt stamped, no response). Seat reopened.
  const a = await shipShift("willing", "Tidewater", CAPTAIN, at(24), "Open", "Filling");
  await closeLiveAsks(a.seatId);
  await repo.saveAsk({
    id: asId<"AskId">("ask-ar-declined"),
    seatId: a.seatId,
    crewMemberId: lance,
    channel: "push",
    sentAt: at(-2).toISOString(),
    respondedAt: at(-1).toISOString(),
    response: "declined",
  });
  await repo.saveAsk({
    id: asId<"AskId">("ask-ar-silent"),
    seatId: a.seatId,
    crewMemberId: gardner,
    channel: "push",
    sentAt: at(-2).toISOString(),
    respondedAt: at(-1).toISOString(),
  });

  // B — eligibility-exhausted: nobody anywhere holds an engineer rating.
  await shipShift("exhausted", "Mash Tun", ENGINEER, at(122), "Open", "Pending");

  // C — regression: Cody bailed and the pool was dry at the time, so the seat
  // rests Bailed (DEC-019). Append-only log → guard against re-runs.
  const c = await shipShift("regress", "Firkin", CAPTAIN, at(30), "Bailed", "AtRisk");
  const priorBail = (await repo.reliabilityEventsFor(bailer)).some(
    (e) => e.type === "shift_bailed" && e.metadata.shiftId === c.shiftId,
  );
  if (!priorBail) {
    await logShiftBailed(repo, bailer, c.shiftId, at(-8), 6 * 3600_000, c.seatId);
  }

  // D — credential lapse: Gus is confirmed, his MMC dies tomorrow, trip's in 4d.
  await shipShift("lapse", "Growler", CAPTAIN, at(96), "Confirmed", "Crewed", lapsing);

  console.log("Seeded 4 At-Risk scenarios (trips anchored to now — re-run to re-anchor):");
  console.log("  A shift-ar-willing   Tidewater  ~24h  core: asked 2 · 1 declined · 1 silent");
  console.log("  B shift-ar-exhausted Mash Tun   ~5d   core: engineer seat, empty pool");
  console.log("  C shift-ar-regress   Firkin     ~30h  regression: Cody bailed, seat rests Bailed");
  console.log("  D shift-ar-lapse     Growler    ~4d   credential lapse: Gus's MMC expires tomorrow");
  console.log("View: /crew/dev-link?admin=spink → tap link → /admin/at-risk");
} finally {
  await repo.close();
}
