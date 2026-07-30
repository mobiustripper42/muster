/**
 * Dev seed for shift completion + self-claim scoring (#570, DEC-144).
 *
 * The tick's completion sweep only ever fires on a shift whose trips are already
 * OVER — which is exactly the state no other seed produces, because every other
 * scenario is horizon-sensitive and therefore in the future. Without this you cannot
 * reach the feature by hand at all.
 *
 * Six scenarios. A–D are set up PRE-completion on purpose: the seed stages the
 * state, then `npm run db:tick` is what completes them, so you watch the sweep do it
 * rather than reading a row the seed wrote.
 *
 *   A. completes — 2-crew boat, both Confirmed, trip ran and its end is ~2h past.
 *      After the tick: shift `Completed`, +5 `shift_completed` to BOTH occupants.
 *   B. mid-water — departed ~30min ago, still inside trip length + teardown. After
 *      the tick: untouched. This is the one that proves the sweep waits for the END,
 *      not the departure.
 *   C. never crewed — departed, its end long past, seat never filled. After the
 *      tick: NOT completed, left for a human. No +5 for an empty boat.
 *   D. long charter — same departure as A but `durationMinutes: 480` frozen on the
 *      event (an 8h charter). Its end is still ~5h AWAY, so after the tick A is
 *      Completed and D is not. That contrast is the whole point of per-event
 *      duration: under the old flat 100min assumption both would have completed.
 *   E. self-claim — an Open captain seat on a shift 3 days out, claimable. Tap it in
 *      /crew/open as Wanda: +4 `self_claim` and a **Claimed** row in /admin/audit.
 *      Note: 3 days out is INSIDE the 7-day staffing horizon, so `db:tick` births it
 *      to `Filling` and fires a Tier-1 ask at the seat. That's the engine working, not
 *      the seed breaking — an `Asked` seat is still claimable (#440), so the demo holds
 *      either way. Claim it before or after the tick.
 *   F. already completed — written `Completed` by the seed, seat still Confirmed.
 *      The visibility + refusal checks live here: it must still appear on
 *      /admin/shifts (labelled Completed, NOT Crewed), in Wanda's My Shifts, in her
 *      thread list and calendar feed — and "can't make it" on it must be REFUSED
 *      (`shift_over`), because you can't back out of work you already did.
 *
 * Trips are computed FROM SEED TIME (the `seed-atrisk-dev` convention): completion
 * is clock-relative, so fixed dates would rot within a day. Re-run any time to
 * re-anchor — and note that re-running after a tick RESETS A–D to pre-completion,
 * which is how you replay the sweep.
 *
 * Idempotency, precisely — the distinction matters because one half of it costs you
 * score drift:
 *  - **A second `db:tick` is a genuine no-op.** Verified: `shiftsCompleted: 0`, no new
 *    events. `Completed` is terminal, so the sweep skips it.
 *  - **Re-seeding is NOT.** It deliberately resets A back to `Crewed` so you can
 *    replay the sweep — so the next tick completes it AGAIN and appends a second +5.
 *    `reliability_events` is append-only (DEC-008), so that cannot be tidied away;
 *    `npm run db:reset:dev` is the only clean slate. Fine for a dev fixture, but don't
 *    read a crew score after five re-seeds and believe it.
 *
 * This seed never fabricates a `shift_completed` itself — every one you see was
 * written by the tick, which is the point.
 *
 * Run: npm run db:seed:completion   (DB up + migrated first), then npm run db:tick.
 * Crew link: /crew/dev-link?crew=crew-cmp-wanda
 */
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { asId } from "../src/domain/ids.js";
import { TENANT_TIMEZONE } from "../src/config/tenant.js";
import {
  TEARDOWN_MINUTES,
  TRIP_DURATION_MINUTES,
} from "../src/builder/derive.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

const TENANT = asId<"TenantId">("tenant-brewboat");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");

// Vessel-local wall-clock (DEC-032) — storing UTC would shift every trip by the
// Eastern offset and quietly move the shift end the sweep keys on.
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

/** The flat shift end the sweep compares against: trip + teardown, in hours. */
const FLAT_END_H = (TRIP_DURATION_MINUTES + TEARDOWN_MINUTES) / 60; // 2.083

const MMC_GOOD = "2027-12-31";

async function crew(id: string, name: string, ratings: typeof CAPTAIN[]) {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name,
    email: `${name.toLowerCase()}@bb.test`,
    phone: "+15555550100",
    ratings,
    status: "active",
    reliabilityScore: null,
  });
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: MMC_GOOD,
  });
  return crewId;
}

interface SeatSpec {
  role: typeof CAPTAIN;
  state: "Open" | "Confirmed";
  crew?: ReturnType<typeof asId<"CrewMemberId">>;
}

async function shipShift(
  key: string,
  vesselName: string,
  tripAt: Date,
  seats: SeatSpec[],
  persisted: "Pending" | "Filling" | "Crewed" | "Completed",
  durationMinutes?: number,
) {
  const vesselId = asId<"VesselId">(`vessel-cmp-${key}`);
  const shiftId = asId<"ShiftId">(`shift-cmp-${key}`);
  const eventId = asId<"EventId">(`evt-cmp-${key}`);
  const manning = new Map<string, number>();
  for (const s of seats) {
    manning.set(String(s.role), (manning.get(String(s.role)) ?? 0) + 1);
  }
  await repo.saveVessel({
    id: vesselId,
    name: vesselName,
    coiMaxPax: 12,
    manning: [...manning].map(([roleTypeId, count]) => ({
      roleTypeId: asId<"RoleTypeId">(roleTypeId),
      count,
    })),
  });
  await repo.saveEvent({
    id: eventId,
    vesselId,
    date: dateOf(tripAt),
    time: timeOf(tripAt),
    capacity: 12,
    status: "scheduled",
    source: "xola",
    dock: "East Bank of the Flats at Canal Basin Park",
    // #570: frozen per-event trip length. Absent ⇒ the flat TRIP_DURATION_MINUTES,
    // which is what every Xola-sourced event gets, permanently.
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
  });
  await repo.saveShift({
    id: shiftId,
    vesselId,
    date: dateOf(tripAt),
    state: persisted,
    eventIds: [eventId],
  });
  const seatIds = [];
  for (const [i, s] of seats.entries()) {
    const seatId = asId<"SeatId">(`seat-cmp-${key}-${i + 1}`);
    await repo.saveSeat({
      id: seatId,
      shiftId,
      role: s.role,
      kind: "required",
      state: s.state,
      ...(s.crew ? { assignedCrewMemberId: s.crew, acquiredVia: "self_claim" } : {}),
    });
    seatIds.push(seatId);
  }
  return { shiftId, seatIds };
}

/**
 * Close any LIVE asks on a seat. A prior `db:tick` may have fired one at a
 * scenario seat; a live ask changes what the sweep and the cockpit show, so a
 * re-seed restores the intended state. Stamping `respondedAt` with no response
 * marks it timed out — the `expireAsks` shape.
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
  await repo.saveRoleType({ id: MATE, tenantId: TENANT, name: "mate" });

  const wanda = await crew("crew-cmp-wanda", "Wanda", [CAPTAIN]);
  const otto = await crew("crew-cmp-otto", "Otto", [CAPTAIN]);

  // A — completes on the next tick. Trip departed FLAT_END_H + 2h ago, so its end
  // (departure + trip + teardown) is ~2h past. Two Confirmed required seats, so the
  // fan-out is visible: BOTH Wanda and Otto should get +5, not just one.
  const a = await shipShift(
    "done",
    "Tidewater",
    at(-(FLAT_END_H + 2)),
    [
      { role: CAPTAIN, state: "Confirmed", crew: wanda },
      { role: CAPTAIN, state: "Confirmed", crew: otto },
    ],
    "Crewed",
  );
  for (const s of a.seatIds) await closeLiveAsks(s);

  // B — mid-water: departed 30min ago, end still ~1.5h out. Proves the sweep keys
  // on the trip's END, not its departure — the past-trip guard alone would have
  // walked away from this shift, which is why nothing ever completed before #570.
  const b = await shipShift(
    "midwater",
    "Kettle",
    at(-0.5),
    [{ role: CAPTAIN, state: "Confirmed", crew: wanda }],
    "Crewed",
  );
  for (const s of b.seatIds) await closeLiveAsks(s);

  // C — never crewed: end long past, seat never filled. Must NOT complete. The
  // operator decides what happened; a +5 here would be for an empty boat.
  const c = await shipShift(
    "empty",
    "Mash Tun",
    at(-(FLAT_END_H + 6)),
    [{ role: CAPTAIN, state: "Open" }],
    "Filling",
  );
  for (const s of c.seatIds) await closeLiveAsks(s);

  // D — long charter: SAME departure as A, but 480min frozen on the event, so its
  // end is ~5h AWAY. After the tick, A is Completed and D is not. Under the old flat
  // assumption both would have completed — and D's crew would have been scored while
  // still on the water.
  const d = await shipShift(
    "charter",
    "Firkin",
    at(-(FLAT_END_H + 2)),
    [{ role: CAPTAIN, state: "Confirmed", crew: otto }],
    "Crewed",
    480,
  );
  for (const s of d.seatIds) await closeLiveAsks(s);

  // E — self-claim: an Open captain seat 3 days out, inside the claimable window and
  // Wanda's native role. Claiming it should log +4 `self_claim` and nothing else.
  const e = await shipShift(
    "claimable",
    "Growler",
    at(72),
    [{ role: CAPTAIN, state: "Open" }],
    "Pending",
  );
  for (const s of e.seatIds) await closeLiveAsks(s);

  // F — ALREADY Completed (written by the seed, not the tick), Wanda still Confirmed
  // and the trip dated today so the day-scoped crew surfaces still include it. This
  // is the visibility + refusal fixture: it must show up everywhere a live shift
  // would, labelled Completed rather than Crewed, and refuse a bail.
  const f = await shipShift(
    "visible",
    "Barrel",
    at(-(FLAT_END_H + 1)),
    [{ role: CAPTAIN, state: "Confirmed", crew: wanda }],
    "Completed",
  );
  for (const s of f.seatIds) await closeLiveAsks(s);

  console.log("Seeded 6 completion scenarios (anchored to now — re-run to re-anchor).");
  console.log("Wanda = crew-cmp-wanda, Otto = crew-cmp-otto.\n");
  console.log("PRE-tick state — A–D are staged, the TICK completes them:");
  console.log(`  A shift-cmp-done      Tidewater  ended ~2h ago    Crewed,  2 Confirmed  → should COMPLETE, +5 x2`);
  console.log(`  B shift-cmp-midwater  Kettle     departed 30m ago Crewed,  1 Confirmed  → should NOT (still out)`);
  console.log(`  C shift-cmp-empty     Mash Tun   ended ~6h ago    Filling, seat Open    → should NOT (nobody crewed)`);
  console.log(`  D shift-cmp-charter   Firkin     8h charter, ~5h left        → should NOT (frozen duration)`);
  console.log(`  E shift-cmp-claimable Growler    3d out,   seat Open         → self-claim demo, +4`);
  console.log(`  F shift-cmp-visible   Barrel     ALREADY Completed           → visibility + bail refusal\n`);
  console.log("Then run:  npm run db:tick");
  console.log("Expect the tick to report shiftsCompleted: 1  (A only — B, C and D must not move).\n");
  console.log("Check:");
  console.log("  +5 fan-out    /admin/audit  → two 'Completed' rows (Wanda AND Otto) for Tidewater");
  console.log("  visibility    /admin/shifts → Barrel present, badge reads Completed (NOT Crewed)");
  console.log("  self-claim    /crew/dev-link?crew=crew-cmp-wanda → /crew/open → claim Growler");
  console.log("                then /admin/audit → a 'Claimed' row, actor 'self'");
  console.log("  bail refused  /crew (as Wanda) → Barrel in My shifts → 'can't make it' → refused");
  console.log("  calendar      /crew/calendar → Barrel still listed");
} finally {
  await repo.close();
}
