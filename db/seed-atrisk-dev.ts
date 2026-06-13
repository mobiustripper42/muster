/**
 * Dev seed for the At-Risk board + assignment cockpit (SPEC §2.4–2.5,
 * #42/#43/#54/#55). One row per board membership reason, plus the two
 * off-board cockpit states (#54/#55):
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
 *   E. claimed (cockpit, off-board) — Petra accepted, awaits Spink's confirm.
 *   F. warming (cockpit, off-board) — ~4d out, 1 declined + 1 ghost.
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
import { TENANT_TIMEZONE } from "../src/config/tenant.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

const TENANT = asId<"TenantId">("brewboat");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const ENGINEER = asId<"RoleTypeId">("role-engineer");

// Trips relative to seed time — re-run to re-anchor. Stored as **vessel-local**
// wall-clock (DEC-032) so the board reads back the right hour and the trip is
// exactly `hours` out (storing UTC would shift it by the Eastern offset).
const at = (hours: number) => new Date(Date.now() + hours * 3600_000);
const dateOf = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TENANT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const timeOf = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TENANT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);

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
  seatState: "Open" | "Bailed" | "Claimed" | "Confirmed",
  persisted: "Pending" | "Filling" | "AtRisk" | "Crewed",
  assigned?: ReturnType<typeof asId<"CrewMemberId">>,
  extraTrips: Date[] = [],
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
    dock: "Pier 11, East River, New York",
  });
  // A multi-trip day (#59): more scheduled departures on the SAME shift (one
  // boat, one day, one crew requirement — the manning is per-vessel). The board
  // shows every time; the fill deadline still anchors to the earliest.
  const extraIds = extraTrips.map((_, i) => asId<"EventId">(`evt-ar-${key}-${i + 2}`));
  for (const [i, t] of extraTrips.entries()) {
    await repo.saveEvent({
      id: extraIds[i]!,
      vesselId,
      date: dateOf(t),
      time: timeOf(t),
      capacity: 12,
      status: "scheduled",
      dock: "Pier 11, East River, New York",
    });
  }
  await repo.saveShift({
    id: shiftId,
    vesselId,
    date: dateOf(tripAt),
    state: persisted,
    eventIds: [eventId, ...extraIds],
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
  // ghosted (timed out: respondedAt stamped, no response). Seat reopened. Also a
  // TWO-TRIP day (#59): a second departure ~3h after the first, so the board row
  // shows both times and the fill deadline anchors to the earlier one.
  const a = await shipShift(
    "willing", "Tidewater", CAPTAIN, at(24), "Open", "Filling", undefined, [at(27)],
  );
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

  // E — cockpit: Petra accepted and awaits Spink's confirm (#54). Off the board
  // (a Claimed seat is a yes, not a gap) — reached by URL, the Confirm demo.
  const petra = await captain("crew-ar-claimant", "Petra");
  const e = await shipShift("claimed", "Tidewater II", CAPTAIN, at(72), "Claimed", "Filling", petra);
  await closeLiveAsks(e.seatId);
  await repo.saveAsk({
    id: asId<"AskId">("ask-ar-claimed"),
    seatId: e.seatId,
    crewMemberId: petra,
    channel: "push",
    sentAt: at(-3).toISOString(),
    respondedAt: at(-2).toISOString(),
    response: "accepted",
  });

  // F — warming (#55): trip ~4d out (off the board's 48h willingness window),
  // one declined + one ghost, seat reopened → ghosted signal, warming row.
  // Dale/Tessa also widen every captain pool — more lean targets, harmless.
  const dale = await captain("crew-ar-warm-no", "Dale");
  const tessa = await captain("crew-ar-warm-ghost", "Tessa");
  const f = await shipShift("warming", "Kettle", CAPTAIN, at(100), "Open", "Filling");
  await closeLiveAsks(f.seatId);
  await repo.saveAsk({
    id: asId<"AskId">("ask-ar-warm-no"),
    seatId: f.seatId,
    crewMemberId: dale,
    channel: "push",
    sentAt: at(-4).toISOString(),
    respondedAt: at(-3).toISOString(),
    response: "declined",
  });
  await repo.saveAsk({
    id: asId<"AskId">("ask-ar-warm-ghost"),
    seatId: f.seatId,
    crewMemberId: tessa,
    channel: "push",
    sentAt: at(-4).toISOString(),
    respondedAt: at(-3).toISOString(),
  });

  // G — changed since reviewed (#58, DEC-029): fully-Crewed shift, LOCKED 2d ago,
  // then a booking landed an hour ago → cockpit header shows the review nudge.
  // Off-board (it's crewed — no gap); reached by URL. An original booking stamped
  // before the lock proves the derivation picks the *late* one, not just any.
  const orin = await captain("crew-ar-changed", "Orin");
  const g = await shipShift("changed", "Stout", CAPTAIN, at(120), "Confirmed", "Crewed", orin);
  const gShift = await repo.getShift(g.shiftId);
  await repo.saveShift({ ...gShift!, lockedAt: at(-48).toISOString() });
  await repo.saveReservation({
    id: asId<"ReservationId">("resv-ar-changed-orig"),
    eventId: asId<"EventId">("evt-ar-changed"),
    customerName: "Brody party",
    partySize: 4,
    status: "booked",
    updatedAt: at(-72).toISOString(), // before the lock — does NOT nudge
  });
  await repo.saveReservation({
    id: asId<"ReservationId">("resv-ar-changed-late"),
    eventId: asId<"EventId">("evt-ar-changed"),
    customerName: "Vaughn party",
    partySize: 6,
    status: "booked",
    updatedAt: at(-1).toISOString(), // after the lock — fires the nudge
  });

  console.log("Seeded 7 scenarios (trips anchored to now — re-run to re-anchor):");
  console.log("  A shift-ar-willing   Tidewater    ~24h  board: asked 2 · 1 declined · 1 silent (two-trip day)");
  console.log("  B shift-ar-exhausted Mash Tun     ~5d   board: engineer seat, empty pool");
  console.log("  C shift-ar-regress   Firkin       ~30h  board: Cody bailed, seat rests Bailed");
  console.log("  D shift-ar-lapse     Growler      ~4d   board: Gus's MMC expires tomorrow");
  console.log("  E shift-ar-claimed   Tidewater II ~3d   cockpit: Petra awaits confirm (off-board)");
  console.log("  F shift-ar-warming   Kettle       ~4d   warming: 1 declined · 1 ghost (off-board)");
  console.log("  G shift-ar-changed   Stout        ~5d   cockpit: locked, late booking → review nudge");
  console.log("Board:   /crew/dev-link?admin=spink → tap link → /admin/at-risk");
  console.log("Cockpit: /admin/shift/shift-ar-claimed  (Confirm demo)");
  console.log("         /admin/shift/shift-ar-changed  (changed-since-reviewed nudge)");
  console.log("Warming: any cockpit → 'Warming signals →'  (shows Kettle)");
} finally {
  await repo.close();
}
