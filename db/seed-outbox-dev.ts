/**
 * Dev seed for the operator outbox (DEC-030, #53). Three cards, eyeball-able
 * at /admin/outbox:
 *
 *   1. RELAY, tight (~20h) — Bo's ask on "Tideline", with a prior round (Fred
 *      declined) so the why-line reads "2nd ask · Fred declined". Top of the
 *      list (tightest trip), red countdown.
 *   2. RELAY, far (~4d) — Mira's ask on "Maibock", "1st ask". Sorts below Bo.
 *   3. SELF (~30h) — an ask addressed to OPERATOR_CREW_MEMBER_ID (crew-eric-stoffer),
 *      so the card renders inline Yes/No instead of an `sms:` Send link.
 *
 * The asks are fired through the REAL rails (`assignPerson`) and forwarded
 * through the REAL adapter (`WebLinkChannel` → `forwardAsks`), so every entry
 * carries a live 24h magic link minted against this database — tapping Send on
 * a phone produces a text whose link actually signs the crew member in.
 *
 * Trips are computed FROM SEED TIME (like seed-atrisk-dev) — re-run any time
 * to re-anchor. Idempotent (#94): entity writes are upserts, and each scenario
 * seat's prior asks + outbox entries are DELETED before re-firing — so a re-run
 * reproduces round-1-Lance-declined / round-2-Bo-live exactly, no wipe needed.
 * (Magic tokens linger as harmless dev rows; the reaper handles those.)
 *
 * Run: npm run db:seed:outbox  (DB up + migrated first).
 * Then: /crew/dev-link?admin=eric → tap through → /admin/outbox.
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

const TENANT = asId<"TenantId">("tenant-brewboat"); // match app TENANT_ID + canonical seeds
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
    email: `${name.split(/\s+/)[0]!.toLowerCase().replace(/[^a-z0-9]/g, "")}@bb.test`,
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
    source: "xola", status: "scheduled",
    dock: "East Bank of the Flats at Canal Basin Park",
  });
  await repo.saveShift({
    id: shiftId,
    vesselId,
    date: dateOf(tripAt),
    state: "Filling",
    eventIds: [eventId],
  });
  // Clean-reset this scenario's fixtures so a re-run reproduces the same rounds
  // exactly — no wipe needed (#94). DELETE the prior asks + their outbox entries
  // rather than closing them: a closed-with-no-response ask is a real "silent"
  // round, so the old close-don't-delete path stacked a fake "Bo went silent"
  // every re-run and bumped the why-line ordinal. Drop the entries first (they
  // reference the asks), then the asks; then reset the seat to Open for a fresh
  // fire. (removeSeat can't help — it would orphan the asks, tripping integrity.)
  for (const entry of await repo.listOutboxEntries()) {
    if (entry.seatId === seatId) await repo.removeOutboxEntry(entry.id);
  }
  for (const ask of await repo.listAsksForSeat(seatId)) {
    await repo.removeAsk(ask.id);
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

  // Bo's number is env-overridable so you can point the 4.2 Send + 4.6
  // magic-link loop at a real phone you control, without committing it:
  //   OUTBOX_TEST_PHONE=+14155550123 npm run db:seed:outbox
  const bo = await captain("crew-obx-bo", "Bo", process.env.OUTBOX_TEST_PHONE ?? "+15555550101");
  const mira = await captain("crew-obx-mira", "Mira", "+15555550102");
  const lance = await captain("crew-obx-lance", "Fred", "+15555550103");
  // The operator's own crew identity — must match OPERATOR_CREW_MEMBER_ID
  // (app/lib/operator.ts; default "crew-eric-stoffer").
  const eric = await captain("crew-eric-stoffer", "Eric", "+15555550100");
  // A no-phone crew member (#186) — exercises the ring relay's "no number, but
  // shareable via Web Share" path: the ring card offers Send on a Web-Share device
  // instead of dead-ending at "No phone on file".
  const nora = await captain("crew-obx-nophone", "Nora No-Phone", "");

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

  // 3 — the operator's own ask → the inline Yes/No card.
  const keelhaul = await shipShift("keelhaul", "Keelhaul", at(30));

  // Fire through the real rails, forward through the real adapter.
  const now = new Date();
  const asks = (
    await Promise.all([
      assignPerson(repo, tide, bo, now),
      assignPerson(repo, maibock, mira, now),
      assignPerson(repo, keelhaul, eric, now),
    ])
  ).filter((a): a is Ask => a !== null);
  const queued = await forwardAsks(repo, channel, asks);
  if (queued !== 3) {
    throw new Error(`expected 3 outbox entries, queued ${queued}`);
  }

  // A pending doorbell ring for the no-phone crew → the "New messages" section
  // (#186). Seeded directly (no doorbell-tick pipeline needed — the ring CARD is
  // what #186 fixes). Upsert by id; e2e runs start from a truncated DB anyway.
  await repo.saveRingOutboxEntry({
    // Canonical id shape the real channel mints (ring-${threadId}-${crewId}), so a
    // genuine ring for this pair would upsert this slot, not insert a second row.
    id: asId<"RingOutboxEntryId">("ring-thread-obx-nophone-crew-obx-nophone"),
    crewMemberId: nora,
    threadId: asId<"ThreadId">("thread-obx-nophone"),
    body: "2 new messages",
    link: `${process.env.APP_BASE_URL ?? "http://mill-dev:3000"}/crew/threads/thread-obx-nophone`,
    status: "pending",
    createdAt: new Date().toISOString(),
  });

  console.log("Seeded 3 outbox cards (trips anchored to now — re-run to re-anchor):");
  console.log("  1 Tideline  ~20h  RELAY — Bo · '2nd ask · Fred declined' · red countdown");
  console.log("  2 Keelhaul  ~30h  SELF  — Eric ('you' pill) · inline Yes/No, no Send link");
  console.log("  3 Maibock   ~4d   RELAY — Mira · '1st ask'");
  console.log("  + New messages: Nora No-Phone — a no-phone ring (Web Share relay, #186)");
  console.log("Outbox: /crew/dev-link?admin=eric → tap through → /admin/outbox");
} finally {
  await repo.close();
}
