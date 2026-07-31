/**
 * Dev seed for #600 / DEC-146 — losing asks retired when a seat fills.
 *
 * Two jobs, and the first is the one worth having:
 *
 * **A. A rehearsal rig for `db/ops/600-close-losing-asks.sql`.** Scenario A seeds the
 * LEGACY state production is actually in — live asks stranded on a filled seat, written
 * directly rather than through the fixed code path, because the fixed code can no longer
 * produce them. So you can run the ops SQL against a local database, watch the counts,
 * and confirm the verify queries come back zero, before pointing it at prod.
 *
 * **B. Proof the fix holds going forward.** Scenario B is a live seat you fill yourself;
 * the losers should come out `withdrawn` with no reliability event, and stay re-askable.
 *
 *   A. armed (legacy) — `seat-la-armed`, Confirmed to Michael, with four losing
 *      recipients from 9 days ago (Liam, Francine, William, Paul). The Brew 4 · Jul 29
 *      shape: taken 51s in, the losers never closed. THREE are still armed
 *      (`responded_at` null); Paul's was already swept, which is scenario C.
 *      → ops SQL step 1 reports **3** armed. After step 2: 0 armed, all three
 *        `withdrawn`, no new reliability events.
 *   B. fresh — `seat-la-fresh`, Open, three eligible captains, no asks yet. Broadcast
 *      from the cockpit (or run `db:tick`), accept as one of them, and the other two
 *      must land `withdrawn` — not `silent` — and remain re-askable.
 *   C. false-event (legacy) — Paul additionally carries a real `ask_ignored` logged 9
 *      days late against scenario A's seat, matching the ~6 bad rows in prod. Step 3 of
 *      the ops SQL should find exactly this one; step 4 deletes it.
 *
 * Anchored to seed time. Idempotent for entities; the one append-only write (C's
 * `ask_ignored`) is guarded, so re-running does not stack duplicates.
 *
 * Run: npm run db:seed:losing-asks   (DB up + migrated first)
 * Then: psql "$DATABASE_URL" -f db/ops/600-close-losing-asks.sql   (step by step)
 */
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { asId } from "../src/domain/ids.js";
import { TENANT_TIMEZONE } from "../src/config/tenant.js";
import { logAskIgnored, logAskSent } from "../src/oracle/reliability-log.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

const TENANT = asId<"TenantId">("tenant-brewboat");
const CAPTAIN = asId<"RoleTypeId">("role-captain");

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

async function captain(id: string, name: string) {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name,
    email: `${name.toLowerCase().replace(/[^a-z]/g, "")}@bb.test`,
    phone: "+15555550100",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
  });
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: "2027-12-31",
  });
  return crewId;
}

async function shipSeat(
  key: string,
  vesselName: string,
  tripAt: Date,
  seatState: "Open" | "Confirmed",
  assigned?: ReturnType<typeof asId<"CrewMemberId">>,
) {
  const vesselId = asId<"VesselId">(`vessel-la-${key}`);
  const shiftId = asId<"ShiftId">(`shift-la-${key}`);
  const eventId = asId<"EventId">(`evt-la-${key}`);
  await repo.saveVessel({
    id: vesselId,
    name: vesselName,
    coiMaxPax: 12,
    manning: [{ roleTypeId: CAPTAIN, count: 1 }],
  });
  await repo.saveEvent({
    id: eventId,
    vesselId,
    date: dateOf(tripAt),
    time: timeOf(tripAt),
    capacity: 12,
    status: "scheduled",
    source: "xola",
  });
  await repo.saveShift({
    id: shiftId,
    vesselId,
    date: dateOf(tripAt),
    state: seatState === "Confirmed" ? "Crewed" : "Filling",
    eventIds: [eventId],
  });
  const seatId = asId<"SeatId">(`seat-la-${key}`);
  await repo.saveSeat({
    id: seatId,
    shiftId,
    role: CAPTAIN,
    kind: "required",
    state: seatState,
    ...(assigned ? { assignedCrewMemberId: assigned } : {}),
  });
  return { shiftId, seatId };
}

try {
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" });

  const michael = await captain("crew-la-michael", "Michael");
  const losers = [
    await captain("crew-la-liam", "Liam"),
    await captain("crew-la-francine", "Francine"),
    await captain("crew-la-william", "William"),
    await captain("crew-la-paul", "Paul"),
  ];

  // ── A: the legacy armed state (what prod looks like) ──────────────────────
  // Trip ~30h out so the shift stays live and workable. Michael won the seat 51s
  // after the broadcast; the four losers were never closed.
  const a = await shipSeat("armed", "Brew 4", at(30), "Confirmed", michael);
  const sentAt = at(-9 * 24); // nine days ago, the prod interval
  await repo.saveAsk({
    id: asId<"AskId">("ask-la-winner"),
    seatId: a.seatId,
    crewMemberId: michael,
    channel: "sms",
    sentAt: sentAt.toISOString(),
    respondedAt: new Date(sentAt.getTime() + 51_000).toISOString(),
    response: "accepted",
  });
  for (const [i, loser] of losers.entries()) {
    await repo.saveAsk({
      id: asId<"AskId">(`ask-la-armed-${i + 1}`),
      seatId: a.seatId,
      crewMemberId: loser,
      channel: "sms",
      sentAt: sentAt.toISOString(),
      // responded_at deliberately ABSENT — this is the armed state.
    });
    // The `ask_sent` that really would have accompanied each broadcast, so the
    // reliability log looks like prod rather than suspiciously empty.
    const already = (await repo.reliabilityEventsFor(loser)).some(
      (e) => e.type === "ask_sent" && e.metadata.seatId === a.seatId,
    );
    if (!already) await logAskSent(repo, loser, a.seatId, a.shiftId, sentAt);
  }

  // ── C: one already-logged false ask_ignored (guarded — append-only) ───────
  const paul = losers[3]!;
  const hasFalse = (await repo.reliabilityEventsFor(paul)).some(
    (e) => e.type === "ask_ignored" && e.metadata.seatId === a.seatId,
  );
  // Logged at sweep time (now-ish), 9 days after the ask went out — the exact
  // signature the ops SQL's 3h threshold looks for. GUARDED, because
  // `reliability_events` is append-only (DEC-008) and a re-run must not stack.
  if (!hasFalse) {
    await logAskIgnored(repo, paul, a.seatId, a.shiftId, at(-0.25));
  }
  // The timeout stamp on Paul's ask is an UPSERT and must run every time, OUTSIDE
  // the guard above. The loop that seeds the armed asks rewrites his row with
  // `responded_at` absent on every run; leaving the stamp behind the append-only
  // guard meant a second run left him armed with an orphaned false event — which
  // then hid from step 3 of the ops SQL (it requires `responded_at is not null`)
  // and quietly broke the rehearsal this seed exists to provide.
  const paulsAsk = await repo.getAsk(asId<"AskId">("ask-la-armed-4"));
  if (paulsAsk) {
    await repo.saveAsk({
      ...paulsAsk,
      respondedAt: at(-0.25).toISOString(),
      // response deliberately ABSENT = the timeout marker, pre-#600 behaviour.
    });
  }

  // ── B: a fresh seat to prove the fix forward ──────────────────────────────
  await shipSeat("fresh", "Brew 1", at(36), "Open");

  const armed = (await repo.listAsksForSeat(a.seatId)).filter(
    (x) => x.respondedAt === undefined,
  ).length;

  console.log("Seeded the #600 fallout (anchored to now — re-run to re-anchor).\n");
  console.log("A  shift-la-armed / seat-la-armed   Brew 4, Confirmed to Michael");
  console.log(`     ${armed} STRANDED live asks from 9 days ago (the legacy prod state)`);
  console.log("     Liam · Francine · William — taken 51s in, never closed");
  console.log("C  Paul's ask was already SWEPT, so he carries ONE false ask_ignored");
  console.log("     logged 9 days late — the ~6 bad rows in prod, in miniature");
  console.log("B  shift-la-fresh / seat-la-fresh   Brew 1, Open — fill it yourself\n");
  console.log("Rehearse the production cleanup against THIS database first:");
  console.log("  psql \"$DATABASE_URL\" -f db/ops/600-close-losing-asks.sql");
  console.log(`  step 1 → expect ${armed} armed        step 2 → disarms them`);
  console.log("  step 3 → expect 1 false event  step 4 → deletes it");
  console.log("  step 5 → both counts 0\n");
  console.log("Prove the fix forward on B: broadcast to seat-la-fresh, accept as one");
  console.log("captain, then check the other two — response should read 'withdrawn',");
  console.log("their audit should show NO 'No reply' row, and the cockpit should list");
  console.log("them as available (not 👻 silent).");
} finally {
  await repo.close();
}
