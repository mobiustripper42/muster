/**
 * Dev seed for the operator outbox (DEC-030, #53). Three cards, eyeball-able
 * at /admin/outbox:
 *
 *   1. RELAY, tight (~20h) — Bo's ask on "Tideline", with a prior round (Lance
 *      declined) so the why-line reads "2nd ask · Lance declined". Top of the
 *      list (tightest trip), red countdown.
 *   2. RELAY, far (~4d) — Mira's ask on "Maibock", "1st ask". Sorts below Bo.
 *   3. SELF (~30h) — an ask addressed to OPERATOR_CREW_MEMBER_ID (crew-spink),
 *      so the card renders inline In/Out instead of an `sms:` Send link.
 *
 * The asks are fired through the REAL rails (`assignPerson`) and forwarded
 * through the REAL adapter (`WebLinkChannel` → `forwardAsks`), so every entry
 * carries a live 24h magic link minted against this database — tapping Send on
 * a phone produces a text whose link actually signs the crew member in.
 *
 * Trips are computed FROM SEED TIME (like seed-atrisk-dev) — re-run any time
 * to re-anchor. Idempotent-enough: entity writes are upserts; before re-firing,
 * any live ask on a scenario seat is closed (stamped respondedAt), which also
 * retires its old outbox card from the page (the view drops settled asks).
 * Dead entries/tokens linger as rows; harmless in dev.
 *
 * Run: npm run db:seed:outbox  (DB up + migrated first).
 * Then: /crew/dev-link?admin=spink → tap through → /admin/outbox.
 */
import { forwardAsks } from "../src/adapters/forward-asks.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { WebLinkChannel } from "../src/adapters/web-link-channel.js";
import { assignPerson } from "../src/asks/ask-loop.js";
import type { Ask } from "../src/domain/entities.js";
import { asId } from "../src/domain/ids.js";
import { TENANT_TIMEZONE } from "../src/config/tenant.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);
// Links must work from a PHONE, so default to the Tailscale dev host, not
// localhost (docs/RUNNING.md) — override with APP_BASE_URL.
const channel = new WebLinkChannel(repo, {
  linkBase: process.env.APP_BASE_URL ?? "http://mill-dev:3000",
});

const TENANT = asId<"TenantId">("brewboat");
const CAPTAIN = asId<"RoleTypeId">("role-captain");

const at = (hours: number) => new Date(Date.now() + hours * 3600_000);
// Vessel-local wall-clock (DEC-032) — see seed-atrisk-dev for the why.
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

async function captain(id: string, name: string, phone: string) {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name,
    phone,
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
  });
  return crewId;
}

/** One vessel+event+shift+seat, trip `tripAt`, seat reset to Open for re-asking. */
async function shipShift(key: string, vesselName: string, tripAt: Date) {
  const vesselId = asId<"VesselId">(`vessel-obx-${key}`);
  const shiftId = asId<"ShiftId">(`shift-obx-${key}`);
  const eventId = asId<"EventId">(`evt-obx-${key}`);
  const seatId = asId<"SeatId">(`seat-obx-${key}`);
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
    dock: "Pier 11, East River, New York",
  });
  await repo.saveShift({
    id: shiftId,
    vesselId,
    date: dateOf(tripAt),
    state: "Filling",
    eventIds: [eventId],
  });
  // Close any live ask a prior run left (retires its old outbox card too),
  // then reset the seat to Open so assignPerson can fire a fresh ask.
  for (const ask of await repo.listAsksForSeat(seatId)) {
    if (ask.respondedAt === undefined) {
      await repo.saveAsk({ ...ask, respondedAt: new Date().toISOString() });
    }
  }
  await repo.saveSeat({
    id: seatId,
    shiftId,
    role: CAPTAIN,
    kind: "required",
    state: "Open",
  });
  return seatId;
}

try {
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" });

  const bo = await captain("crew-obx-bo", "Bo", "+15555550101");
  const mira = await captain("crew-obx-mira", "Mira", "+15555550102");
  const lance = await captain("crew-obx-lance", "Lance", "+15555550103");
  // The operator's own crew identity — must match OPERATOR_CREW_MEMBER_ID
  // (app/lib/operator.ts; default "crew-spink").
  const spink = await captain("crew-spink", "Spink", "+15555550100");

  // 1 — relay, tight, with a prior declined round (the why-line).
  const tide = await shipShift("tide", "Tideline", at(20));
  await repo.saveAsk({
    id: asId<"AskId">("ask-obx-tide-declined"),
    seatId: tide,
    crewMemberId: lance,
    channel: "push",
    sentAt: at(-2).toISOString(),
    respondedAt: at(-1).toISOString(),
    response: "declined",
  });

  // 2 — relay, far out, first round.
  const maibock = await shipShift("maibock", "Maibock", at(96));

  // 3 — the operator's own ask → the inline In/Out card.
  const keelhaul = await shipShift("keelhaul", "Keelhaul", at(30));

  // Fire through the real rails, forward through the real adapter.
  const now = new Date();
  const asks = (
    await Promise.all([
      assignPerson(repo, tide, bo, now),
      assignPerson(repo, maibock, mira, now),
      assignPerson(repo, keelhaul, spink, now),
    ])
  ).filter((a): a is Ask => a !== null);
  const queued = await forwardAsks(repo, channel, asks);
  if (queued !== 3) {
    throw new Error(`expected 3 outbox entries, queued ${queued}`);
  }

  console.log("Seeded 3 outbox cards (trips anchored to now — re-run to re-anchor):");
  console.log("  1 Tideline  ~20h  RELAY — Bo · '2nd ask · Lance declined' · red countdown");
  console.log("  2 Keelhaul  ~30h  SELF  — Spink ('you' pill) · inline In/Out, no Send link");
  console.log("  3 Maibock   ~4d   RELAY — Mira · '1st ask'");
  console.log("Outbox: /crew/dev-link?admin=spink → tap through → /admin/outbox");
} finally {
  await repo.close();
}
