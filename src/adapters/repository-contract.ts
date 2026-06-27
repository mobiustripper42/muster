/**
 * The Repository contract (DEC-020). One behavioral suite, run against BOTH the
 * in-memory double and the Postgres adapter — if both pass identically, the
 * in-memory adapter is provably contract-equivalent, so the fast domain tests
 * that lean on it are trustworthy. This is the parity guard that makes "test on
 * in-memory, run on Postgres" honest rather than hand-wavy.
 *
 * Not a test file itself (no `.test`): it exports a function that registers the
 * describe/it blocks; each adapter's test file calls it with a fresh-repo factory.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { checkIntegrity } from "../admin/integrity.js";
import { asId } from "../domain/ids.js";
import type {
  Ask,
  Credential,
  CrewMember,
  Event,
  MagicToken,
  OutboxEntry,
  PtoWindow,
  Reservation,
  RoleType,
  Seat,
  Shift,
  Vessel,
} from "../domain/entities.js";
import type { ReliabilityEvent } from "../domain/reliability.js";
import type { ImportRun, ImportRunItem } from "../import/import-audit.js";
import type { Message, Participant, Thread } from "../messaging/entities.js";
import type { Subject } from "../domain/entities.js";
import { subjectKey } from "../domain/subject.js";
import type { Repository } from "../ports/repository.js";

const TENANT = asId<"TenantId">("tenant-x");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const VESSEL = asId<"VesselId">("vessel-x");
const CREW = asId<"CrewMemberId">("crew-a");
const EVENT = asId<"EventId">("evt-1");
const SHIFT = asId<"ShiftId">("shift-1");
const SEAT = asId<"SeatId">("seat-1");
const CREW_B = asId<"CrewMemberId">("crew-b");
const THREAD = asId<"ThreadId">("thread-1");

const roleType = (): RoleType => ({ id: CAPTAIN, tenantId: TENANT, name: "captain" });
const vessel = (): Vessel => ({
  id: VESSEL,
  name: "Hops",
  coiMaxPax: 12,
  manning: [{ roleTypeId: CAPTAIN, count: 2 }],
});
const crew = (over: Partial<CrewMember> = {}): CrewMember => ({
  id: CREW,
  name: "Quint",
  phone: "555",
  ratings: [CAPTAIN],
  status: "active",
  reliabilityScore: null,
  ...over,
});
const credential = (): Credential => ({
  id: asId<"CredentialId">("cred-1"),
  crewMemberId: CREW,
  type: "MMC",
  expiry: "2026-12-31",
});
const pto = (): PtoWindow => ({
  id: asId<"PtoWindowId">("pto-1"),
  crewMemberId: CREW,
  start: "2026-07-01",
  end: "2026-07-05",
});
const event = (over: Partial<Event> = {}): Event => ({
  id: EVENT,
  vesselId: VESSEL,
  date: "2026-07-01",
  time: "14:00",
  capacity: 12,
  status: "scheduled",
  ...over,
});
const reservation = (over: Partial<Reservation> = {}): Reservation => ({
  id: asId<"ReservationId">("resv-1"),
  eventId: EVENT,
  customerName: "Brody",
  partySize: 4,
  status: "booked",
  ...over,
});
const shift = (over: Partial<Shift> = {}): Shift => ({
  id: SHIFT,
  vesselId: VESSEL,
  date: "2026-07-01",
  state: "Pending",
  eventIds: [EVENT],
  ...over,
});
const seat = (over: Partial<Seat> = {}): Seat => ({
  id: SEAT,
  shiftId: SHIFT,
  role: CAPTAIN,
  kind: "required",
  state: "Open",
  ...over,
});
const ask = (over: Partial<Ask> = {}): Ask => ({
  id: asId<"AskId">("ask-1"),
  seatId: SEAT,
  crewMemberId: CREW,
  channel: "push",
  sentAt: "2026-07-01T12:00:00.000Z",
  ...over,
});
const magicToken = (over: Partial<MagicToken> = {}): MagicToken => ({
  id: asId<"MagicTokenId">("mtk-1"),
  tokenHash: "hash-1",
  subjectKind: "crew",
  subjectId: CREW,
  createdAt: "2026-07-01T12:00:00.000Z",
  expiresAt: "2026-07-01T12:15:00.000Z",
  ...over,
});
const outboxEntry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: asId<"OutboxEntryId">("obx-ask-1"),
  askId: asId<"AskId">("ask-1"),
  seatId: SEAT,
  crewMemberId: CREW,
  body: "Muster: Wed, Jul 1 · Hops · captain — in or out?",
  link: "https://app.example/crew/auth?t=secret",
  status: "pending",
  createdAt: "2026-07-01T12:00:00.000Z",
  ...over,
});
const importRun = (over: Partial<ImportRun> = {}): ImportRun => ({
  id: asId<"ImportRunId">("run-1"),
  source: "manual-pull",
  ranAt: "2026-07-01T12:00:00.000Z",
  window: { start: "2026-06-30", end: "2026-07-07" },
  summary: {
    ordersFetched: 5,
    eventsFetched: 4,
    boatedEvents: 4,
    excludedResources: 0,
    recordsMapped: 5,
    mapSkipped: 0,
    eventsCreated: 2,
    reservationsAdded: 2,
    reservationsUpdated: 1,
    reservationsNewlyCancelled: 0,
    shiftsCreated: 2,
    shiftsCancelled: 0,
    seatsCreated: 4,
    seatsPruned: 0,
    seatsStranded: 0,
    unmappedResources: [{ reason: "unknown resource xyz" }],
    skipped: [],
    warnings: ["heads up"],
    assignments: [{ date: "2026-07-01", boats: [] }],
  },
  ...over,
});
const importRunItems = (): ImportRunItem[] => [
  {
    id: asId<"ImportRunItemId">("run-1-item-0000"),
    runId: asId<"ImportRunId">("run-1"),
    kind: "reservation_added",
    refId: "resv-a",
    label: "Brody",
  },
  {
    id: asId<"ImportRunItemId">("run-1-item-0001"),
    runId: asId<"ImportRunId">("run-1"),
    kind: "shift_created",
    refId: "shift-x-2026-07-01",
    label: null,
  },
];
const thread = (over: Partial<Thread> = {}): Thread => ({
  id: THREAD,
  tenantId: TENANT,
  kind: "dm",
  scopeRef: null,
  createdAt: "2026-07-01T12:00:00.000Z",
  ...over,
});
const participant = (over: Partial<Participant> = {}): Participant => ({
  id: asId<"ParticipantId">("part-1"),
  threadId: THREAD,
  crewMemberId: CREW,
  ...over,
});
const message = (over: Partial<Message> = {}): Message => ({
  id: asId<"MessageId">("msg-1"),
  threadId: THREAD,
  senderId: String(CREW),
  senderKind: "crew",
  body: "hello",
  createdAt: "2026-07-01T12:00:00.000Z",
  priority: false,
  ...over,
});
const relEvent = (id: string, type: ReliabilityEvent["type"]): ReliabilityEvent => ({
  id: asId<"ReliabilityEventId">(id),
  crewMemberId: CREW,
  type,
  timestamp: "2026-07-01T12:00:00.000Z",
  metadata: { seatId: SEAT, shiftId: SHIFT },
});

/**
 * Register the contract against one adapter. `makeFreshRepo` must return a repo
 * with clean state every call (in-memory: a new instance; Postgres: truncate +
 * the shared pool).
 */
export function runRepositoryContract(
  label: string,
  makeFreshRepo: () => Promise<Repository>,
): void {
  describe(`Repository contract — ${label}`, () => {
    let repo: Repository;
    beforeEach(async () => {
      repo = await makeFreshRepo();
    });

    it("role types: round-trip + list filtered by tenant", async () => {
      await repo.saveRoleType(roleType());
      await repo.saveRoleType({
        id: asId<"RoleTypeId">("role-other"),
        tenantId: asId<"TenantId">("tenant-y"),
        name: "mate",
      });
      expect(await repo.getRoleType(CAPTAIN)).toEqual(roleType());
      const list = await repo.listRoleTypes(TENANT);
      expect(list).toEqual([roleType()]); // tenant-y row excluded
    });

    it("vessel: round-trip incl. manning jsonb; upsert updates", async () => {
      await repo.saveVessel(vessel());
      expect(await repo.getVessel(VESSEL)).toEqual(vessel());
      await repo.saveVessel({ ...vessel(), name: "Lager", coiMaxPax: 14 });
      const updated = await repo.getVessel(VESSEL);
      expect(updated).toMatchObject({ name: "Lager", coiMaxPax: 14 });
      expect((await repo.listVessels())).toHaveLength(1); // upsert, not insert
    });

    it("crew: optional fields present and absent round-trip; null score preserved", async () => {
      await repo.saveCrewMember(crew()); // minimal — no email/boost/override
      const got = await repo.getCrewMember(CREW);
      expect(got).toEqual(crew());
      expect(got!.reliabilityScore).toBeNull();
      expect("email" in got!).toBe(false); // omitted, not undefined
      // Now with the optionals set.
      await repo.saveCrewMember(
        crew({ email: "q@x.io", manualBoost: 3, protocolOverride: "assign_then_confirm", reliabilityScore: 7 }),
      );
      expect(await repo.getCrewMember(CREW)).toEqual(
        crew({ email: "q@x.io", manualBoost: 3, protocolOverride: "assign_then_confirm", reliabilityScore: 7 }),
      );
    });

    it("credentials: save/get/listForCrew/remove", async () => {
      await repo.saveCredential(credential());
      expect(await repo.getCredential(asId<"CredentialId">("cred-1"))).toEqual(credential());
      expect(await repo.listCredentialsForCrew(CREW)).toEqual([credential()]);
      await repo.removeCredential(asId<"CredentialId">("cred-1"));
      expect(await repo.listCredentialsForCrew(CREW)).toEqual([]);
    });

    it("pto windows: save + listForCrew", async () => {
      await repo.savePtoWindow(pto());
      expect(await repo.listPtoWindowsForCrew(CREW)).toEqual([pto()]);
    });

    it("events: round-trip + list; dock optional present and absent", async () => {
      await repo.saveEvent(event()); // no dock
      const got = await repo.getEvent(EVENT);
      expect(got).toEqual(event());
      expect("dock" in got!).toBe(false); // omitted, not undefined
      expect(await repo.listEvents()).toEqual([event()]);
      await repo.saveEvent(event({ dock: "Pier 9, Lake Union" }));
      expect(await repo.getEvent(EVENT)).toEqual(event({ dock: "Pier 9, Lake Union" }));
    });

    it("reservations: nullable phone present and absent; listForEvent", async () => {
      await repo.saveReservation(reservation()); // no phone/email
      const got = await repo.getReservation(asId<"ReservationId">("resv-1"));
      expect(got).toEqual(reservation());
      expect("phone" in got!).toBe(false);
      await repo.saveReservation(reservation({ phone: "555", email: "b@x.io" }));
      expect(await repo.listReservationsForEvent(EVENT)).toEqual([
        reservation({ phone: "555", email: "b@x.io" }),
      ]);
      // updatedAt round-trips (DEC-029); absent stays absent
      expect("updatedAt" in got!).toBe(false);
      const stamped = reservation({ updatedAt: "2026-06-10T12:00:00.000Z" });
      await repo.saveReservation(stamped);
      expect(await repo.getReservation(asId<"ReservationId">("resv-1"))).toEqual(
        stamped,
      );
    });

    it("shifts: eventIds round-trip; lockedAt optional", async () => {
      await repo.saveShift(shift());
      const got = await repo.getShift(SHIFT);
      expect(got).toEqual(shift());
      expect("lockedAt" in got!).toBe(false);
      await repo.saveShift(shift({ lockedAt: "2026-06-30T00:00:00.000Z", state: "Crewed" }));
      expect(await repo.getShift(SHIFT)).toMatchObject({
        lockedAt: "2026-06-30T00:00:00.000Z",
        state: "Crewed",
      });
    });

    it("seats: round-trip + listForShift; assignedCrewMemberId optional", async () => {
      await repo.saveShift(shift());
      await repo.saveSeat(seat());
      expect(await repo.getSeat(SEAT)).toEqual(seat());
      await repo.saveSeat(seat({ state: "Confirmed", assignedCrewMemberId: CREW }));
      expect(await repo.getSeat(SEAT)).toEqual(
        seat({ state: "Confirmed", assignedCrewMemberId: CREW }),
      );
      expect(await repo.listSeatsForShift(SHIFT)).toHaveLength(1);
    });

    it("saveSeatIfState: applies on match, no-op on mismatch", async () => {
      await repo.saveShift(shift());
      await repo.saveSeat(seat()); // Open
      const ok = await repo.saveSeatIfState(
        seat({ state: "Claimed", assignedCrewMemberId: CREW }),
        "Open",
      );
      expect(ok).toBe(true);
      expect((await repo.getSeat(SEAT))!.state).toBe("Claimed");
      // Now the stored state is Claimed; a guard expecting Open must fail + not write.
      const no = await repo.saveSeatIfState(
        seat({ state: "Confirmed", assignedCrewMemberId: asId<"CrewMemberId">("crew-b") }),
        "Open",
      );
      expect(no).toBe(false);
      expect((await repo.getSeat(SEAT))!.state).toBe("Claimed"); // unchanged
      expect((await repo.getSeat(SEAT))!.assignedCrewMemberId).toBe(CREW);
    });

    it("saveSeatIfState: returns false for a seat that doesn't exist", async () => {
      // Both adapters agree: a CAS on an absent row applies nothing → false.
      const ok = await repo.saveSeatIfState(seat({ state: "Claimed" }), "Open");
      expect(ok).toBe(false);
      expect(await repo.getSeat(SEAT)).toBeNull();
    });

    it("saveSeatIfState: exactly one of two concurrent claims wins (REQ-CLAIM-1)", async () => {
      await repo.saveShift(shift());
      await repo.saveSeat(seat()); // Open
      const [a, b] = await Promise.all([
        repo.saveSeatIfState(seat({ state: "Claimed", assignedCrewMemberId: asId<"CrewMemberId">("crew-a") }), "Open"),
        repo.saveSeatIfState(seat({ state: "Claimed", assignedCrewMemberId: asId<"CrewMemberId">("crew-b") }), "Open"),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one winner
      expect((await repo.getSeat(SEAT))!.state).toBe("Claimed");
    });

    it("removeSeat: deletes the row; absent-id is a no-op", async () => {
      await repo.saveShift(shift());
      await repo.saveSeat(seat());
      await repo.removeSeat(SEAT);
      expect(await repo.getSeat(SEAT)).toBeNull();
      expect(await repo.listSeatsForShift(SHIFT)).toHaveLength(0);
      await repo.removeSeat(SEAT); // idempotent — already gone
    });

    it("asks: optional response fields present and absent; listForSeat", async () => {
      await repo.saveAsk(ask());
      const got = await repo.getAsk(asId<"AskId">("ask-1"));
      expect(got).toEqual(ask());
      expect("respondedAt" in got!).toBe(false);
      await repo.saveAsk(ask({ respondedAt: "2026-07-01T12:01:00.000Z", response: "accepted" }));
      expect(await repo.listAsksForSeat(SEAT)).toEqual([
        ask({ respondedAt: "2026-07-01T12:01:00.000Z", response: "accepted" }),
      ]);
    });

    it("removeAsk: deletes the row; absent id is a no-op (#94 seed reset)", async () => {
      await repo.saveAsk(ask());
      await repo.removeAsk(asId<"AskId">("ask-1"));
      expect(await repo.getAsk(asId<"AskId">("ask-1"))).toBeNull();
      expect(await repo.listAsksForSeat(SEAT)).toHaveLength(0);
      // Removing something already gone must not throw.
      await expect(repo.removeAsk(asId<"AskId">("ghost"))).resolves.toBeUndefined();
    });

    it("reliability log: append-only, insertion order, filtered by crew", async () => {
      await repo.logReliabilityEvent(relEvent("rel-1", "ask_sent"));
      await repo.logReliabilityEvent(relEvent("rel-2", "ask_accepted"));
      await repo.logReliabilityEvent({
        ...relEvent("rel-3", "ask_sent"),
        crewMemberId: asId<"CrewMemberId">("crew-b"),
      });
      const mine = await repo.reliabilityEventsFor(CREW);
      expect(mine.map((e) => e.type)).toEqual(["ask_sent", "ask_accepted"]); // order preserved, crew-b excluded
      expect(mine[0]!.metadata).toEqual({ seatId: SEAT, shiftId: SHIFT });
    });

    it("magic tokens: round-trip incl. consumedAt optional; lookup by hash", async () => {
      await repo.saveMagicToken(magicToken()); // not yet consumed
      const got = await repo.getMagicTokenByHash("hash-1");
      expect(got).toEqual(magicToken());
      expect("consumedAt" in got!).toBe(false); // omitted, not undefined
      expect(await repo.getMagicTokenByHash("no-such-hash")).toBeNull();
    });

    it("consumeMagicTokenIfUnused: consumes once, no-op when already spent", async () => {
      await repo.saveMagicToken(magicToken());
      const first = await repo.consumeMagicTokenIfUnused("hash-1", "2026-07-01T12:05:00.000Z");
      expect(first).toBe(true);
      expect((await repo.getMagicTokenByHash("hash-1"))!.consumedAt).toBe(
        "2026-07-01T12:05:00.000Z",
      );
      // Already consumed → the guard fails and the stamp is untouched.
      const second = await repo.consumeMagicTokenIfUnused("hash-1", "2026-07-01T12:09:00.000Z");
      expect(second).toBe(false);
      expect((await repo.getMagicTokenByHash("hash-1"))!.consumedAt).toBe(
        "2026-07-01T12:05:00.000Z",
      );
    });

    it("consumeMagicTokenIfUnused: false for an absent token", async () => {
      expect(
        await repo.consumeMagicTokenIfUnused("ghost", "2026-07-01T12:05:00.000Z"),
      ).toBe(false);
    });

    it("consumeMagicTokenIfUnused: exactly one of two concurrent taps wins", async () => {
      await repo.saveMagicToken(magicToken());
      const [a, b] = await Promise.all([
        repo.consumeMagicTokenIfUnused("hash-1", "2026-07-01T12:05:00.000Z"),
        repo.consumeMagicTokenIfUnused("hash-1", "2026-07-01T12:05:00.000Z"),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
    });

    it("removeMagicToken: deletes the row; absent id is a no-op (the reaper's remove)", async () => {
      await repo.saveMagicToken(magicToken());
      await repo.saveMagicToken(magicToken({ id: asId<"MagicTokenId">("mtk-2"), tokenHash: "hash-2" }));
      await repo.removeMagicToken(asId<"MagicTokenId">("mtk-1"));
      expect(await repo.getMagicTokenByHash("hash-1")).toBeNull();
      expect((await repo.listAllMagicTokens()).map((t) => t.id)).toEqual([
        asId<"MagicTokenId">("mtk-2"),
      ]);
      // Removing something already gone must not throw.
      await expect(repo.removeMagicToken(asId<"MagicTokenId">("ghost"))).resolves.toBeUndefined();
    });

    it("outbox entries: round-trip incl. sentAt optional; status flip via upsert (DEC-030)", async () => {
      await repo.saveOutboxEntry(outboxEntry()); // pending, never sent
      const got = await repo.getOutboxEntry(asId<"OutboxEntryId">("obx-ask-1"));
      expect(got).toEqual(outboxEntry());
      expect("sentAt" in got!).toBe(false); // omitted, not undefined
      expect(await repo.getOutboxEntry(asId<"OutboxEntryId">("ghost"))).toBeNull();
      // Operator marks it sent → the upsert flips status + stamps sentAt; body
      // and link must come back VERBATIM (frozen at enqueue — DEC-030).
      await repo.saveOutboxEntry(
        outboxEntry({ status: "sent", sentAt: "2026-07-01T12:30:00.000Z" }),
      );
      expect(await repo.listOutboxEntries()).toEqual([
        outboxEntry({ status: "sent", sentAt: "2026-07-01T12:30:00.000Z" }),
      ]);
    });

    it("removeOutboxEntry: deletes the row; absent id is a no-op (#94 seed reset)", async () => {
      await repo.saveOutboxEntry(outboxEntry());
      await repo.removeOutboxEntry(asId<"OutboxEntryId">("obx-ask-1"));
      expect(await repo.getOutboxEntry(asId<"OutboxEntryId">("obx-ask-1"))).toBeNull();
      expect(await repo.listOutboxEntries()).toHaveLength(0);
      // Removing something already gone must not throw.
      await expect(
        repo.removeOutboxEntry(asId<"OutboxEntryId">("ghost")),
      ).resolves.toBeUndefined();
    });

    it("listAll enumerators feed the integrity diagnostic identically", async () => {
      // A small connected spine — both adapters must enumerate it the same way,
      // so checkIntegrity (which leans on every listAll*) returns the same verdict.
      await repo.saveRoleType(roleType());
      await repo.saveVessel(vessel());
      await repo.saveCrewMember(crew());
      await repo.saveCredential(credential());
      await repo.savePtoWindow(pto());
      await repo.saveEvent(event());
      await repo.saveReservation(reservation());
      await repo.saveShift(shift());
      await repo.saveSeat(seat({ state: "Confirmed", assignedCrewMemberId: CREW }));
      await repo.saveAsk(ask());
      await repo.saveMagicToken(magicToken());
      await repo.saveOutboxEntry(outboxEntry());

      const clean = await checkIntegrity(repo);
      expect(clean.ok).toBe(true);
      expect(clean.scanned.seats).toBe(1);
      expect(clean.scanned.magicTokens).toBe(1);
      expect(clean.scanned.outboxEntries).toBe(1);

      // Now break a reference the DB's missing FK would never have caught.
      await repo.saveSeat(
        seat({ id: asId<"SeatId">("seat-x"), shiftId: asId<"ShiftId">("ghost") }),
      );
      const broken = await checkIntegrity(repo);
      expect(broken.ok).toBe(false);
      expect(broken.violations).toContainEqual({
        entity: "seat",
        id: "seat-x",
        ref: "shiftId",
        missingId: "ghost",
      });
    });

    it("engine pause flag: absent ⇒ running; set/clear round-trips (DEC-054)", async () => {
      // The load-bearing default: a fresh store (no row) reads as RUNNING. An
      // autonomous engine must never infer pause from an absent/cleared row.
      expect(await repo.isEnginePaused()).toBe(false);
      await repo.setEnginePaused(true, "2026-07-01T12:00:00.000Z");
      expect(await repo.isEnginePaused()).toBe(true);
      // Resuming is an explicit write back to false — both adapters agree.
      await repo.setEnginePaused(false, "2026-07-01T12:05:00.000Z");
      expect(await repo.isEnginePaused()).toBe(false);
    });

    it("import runs: save + get round-trips run + items; absent → null (#128)", async () => {
      expect(await repo.getImportRun(asId<"ImportRunId">("run-1"))).toBeNull();
      await repo.saveImportRun(importRun(), importRunItems());
      const got = await repo.getImportRun(asId<"ImportRunId">("run-1"));
      expect(got).toEqual({ run: importRun(), items: importRunItems() });
      // jsonb summary survives the round-trip identically on both adapters.
      expect(got!.run.summary.unmappedResources).toEqual([
        { reason: "unknown resource xyz" },
      ]);
      // The null label (a shift item) stays null, not absent.
      expect(got!.items[1]!.label).toBeNull();
    });

    it("listImportRuns: most recent first, capped at limit (#128 Part B)", async () => {
      await repo.saveImportRun(
        importRun({ id: asId<"ImportRunId">("run-a"), ranAt: "2026-07-01T10:00:00.000Z" }),
        [],
      );
      await repo.saveImportRun(
        importRun({ id: asId<"ImportRunId">("run-c"), ranAt: "2026-07-01T12:00:00.000Z" }),
        [],
      );
      await repo.saveImportRun(
        importRun({ id: asId<"ImportRunId">("run-b"), ranAt: "2026-07-01T11:00:00.000Z" }),
        [],
      );
      const recent = await repo.listImportRuns(2);
      expect(recent.map((r) => String(r.id))).toEqual(["run-c", "run-b"]); // newest 2, desc
      expect(await repo.listImportRuns(10)).toHaveLength(3);

      // Equal ranAt → deterministic tie-break (id desc), identical on both
      // adapters — the parity this list claims to guarantee.
      await repo.saveImportRun(
        importRun({ id: asId<"ImportRunId">("run-d"), ranAt: "2026-07-01T12:00:00.000Z" }),
        [],
      );
      const tied = await repo.listImportRuns(2);
      expect(tied.map((r) => String(r.id))).toEqual(["run-d", "run-c"]); // same ts → id desc
    });

    it("reliability metadata: an absent optional stays absent across adapters", async () => {
      // structuredClone (in-memory) vs JSON round-trip (Postgres) must agree that
      // a key never set is never present on read — the parity the contract exists
      // to prove. (exactOptionalPropertyTypes makes an explicit `undefined` value
      // a type error, so absence is the only divergence worth guarding.)
      await repo.logReliabilityEvent({
        ...relEvent("rel-sparse", "ask_ignored"),
        metadata: { shiftId: SHIFT }, // no seatId, no latencyMs
      });
      const [got] = await repo.reliabilityEventsFor(CREW);
      expect(got!.metadata).toEqual({ shiftId: SHIFT });
      expect("seatId" in got!.metadata).toBe(false);
      expect("latencyMs" in got!.metadata).toBe(false);
    });

    it("threads: round-trip incl. null scopeRef; upsert updates (#111)", async () => {
      expect(await repo.getThread(THREAD)).toBeNull();
      await repo.saveThread(thread());
      const got = await repo.getThread(THREAD);
      expect(got).toEqual(thread());
      expect(got!.scopeRef).toBeNull(); // null, not absent — matches the `label` posture
      // A cohort thread carries its day in scopeRef; upsert by id, not a second row.
      await repo.saveThread(thread({ kind: "cohort", scopeRef: "2026-07-04" }));
      expect(await repo.getThread(THREAD)).toMatchObject({
        kind: "cohort",
        scopeRef: "2026-07-04",
      });
    });

    it("participants: DM membership persists + listForThread is scoped (#111, DEC-051)", async () => {
      await repo.saveParticipant(participant());
      await repo.saveParticipant(
        participant({ id: asId<"ParticipantId">("part-2"), crewMemberId: CREW_B }),
      );
      const members = await repo.listParticipantsForThread(THREAD);
      expect(members.map((p) => String(p.crewMemberId)).sort()).toEqual([
        "crew-a",
        "crew-b",
      ]);
      // A thread with no persisted participants → empty (the derived kinds' shape).
      expect(
        await repo.listParticipantsForThread(asId<"ThreadId">("thread-none")),
      ).toEqual([]);
    });

    it("messages: listForThread is chronological, id-broken on ties, thread-scoped (#111)", async () => {
      await repo.saveMessage(
        message({ id: asId<"MessageId">("m-b"), createdAt: "2026-07-01T12:00:02.000Z", body: "second" }),
      );
      await repo.saveMessage(
        message({ id: asId<"MessageId">("m-a"), createdAt: "2026-07-01T12:00:01.000Z", body: "first" }),
      );
      // equal timestamp → deterministic id tie-break, identical on both adapters.
      await repo.saveMessage(
        message({ id: asId<"MessageId">("m-c"), createdAt: "2026-07-01T12:00:02.000Z", body: "third" }),
      );
      // operator/office sender round-trips alongside crew — posts as crew-spink
      // with the canonical "admin" kind (DEC-058 / DEC-030 §7; DEC-052: operators
      // post too).
      await repo.saveMessage(
        message({
          id: asId<"MessageId">("m-op"),
          senderId: "crew-spink",
          senderKind: "admin",
          createdAt: "2026-07-01T12:00:03.000Z",
          body: "op note",
        }),
      );
      // a message in another thread must not leak in.
      await repo.saveMessage(
        message({ id: asId<"MessageId">("m-other"), threadId: asId<"ThreadId">("thread-2"), body: "elsewhere" }),
      );
      const msgs = await repo.listMessagesForThread(THREAD);
      expect(msgs.map((m) => m.body)).toEqual(["first", "second", "third", "op note"]);
      expect(msgs.at(-1)!.senderKind).toBe("admin");
    });

    it("messages: priority round-trips — false and true both persist (#116, 0010)", async () => {
      await repo.saveMessage(message({ id: asId<"MessageId">("m-normal"), body: "chatter" }));
      await repo.saveMessage(
        message({
          id: asId<"MessageId">("m-urgent"),
          body: "dock moved",
          priority: true,
          createdAt: "2026-07-01T12:00:05.000Z",
        }),
      );
      const byId = new Map(
        (await repo.listMessagesForThread(THREAD)).map((m) => [String(m.id), m]),
      );
      expect(byId.get("m-normal")!.priority).toBe(false);
      expect(byId.get("m-urgent")!.priority).toBe(true);
    });

    it("listThreadsWithMessages: only threads that have messages, id-sorted (#167)", async () => {
      await repo.saveThread(thread({ id: asId<"ThreadId">("thread-b") }));
      await repo.saveThread(thread({ id: asId<"ThreadId">("thread-a") }));
      await repo.saveThread(thread({ id: asId<"ThreadId">("thread-quiet") })); // no messages
      await repo.saveMessage(message({ id: asId<"MessageId">("mm-b"), threadId: asId<"ThreadId">("thread-b") }));
      await repo.saveMessage(message({ id: asId<"MessageId">("mm-a"), threadId: asId<"ThreadId">("thread-a") }));
      const ids = (await repo.listThreadsWithMessages()).map((t) => String(t.id));
      expect(ids).toEqual(["thread-a", "thread-b"]); // quiet excluded, id-sorted
    });

    describe("doorbell read/notify state (#116, DEC-069)", () => {
      const A: Subject = { kind: "crew", id: "crew-a" };
      const B: Subject = { kind: "crew", id: "crew-b" };
      const RA = "2026-07-01T12:00:00.000Z";
      const NA = "2026-07-01T12:05:00.000Z";

      it("records then reads last-read / last-rang, keyed by subjectKey", async () => {
        await repo.recordRead(THREAD, A, RA);
        await repo.recordNotification(THREAD, A, NA);
        expect((await repo.readStateForThread(THREAD)).get(subjectKey(A))).toBe(RA);
        expect((await repo.notifyStateForThread(THREAD)).get(subjectKey(A))).toBe(NA);
      });

      it("upsert is latest-wins (one mark per (subject,thread))", async () => {
        await repo.recordNotification(THREAD, A, RA);
        await repo.recordNotification(THREAD, A, NA);
        const m = await repo.notifyStateForThread(THREAD);
        expect(m.get(subjectKey(A))).toBe(NA);
        expect(m.size).toBe(1);
      });

      it("a never-recorded subject is omitted (decider reads absent → null → rings)", async () => {
        await repo.recordRead(THREAD, A, RA);
        const m = await repo.readStateForThread(THREAD);
        expect(m.has(subjectKey(A))).toBe(true);
        expect(m.has(subjectKey(B))).toBe(false);
        expect(m.size).toBe(1);
      });

      it("state is thread-scoped — a mark in one thread never leaks to another", async () => {
        const OTHER = asId<"ThreadId">("thread-2");
        await repo.recordRead(THREAD, A, RA);
        await repo.recordRead(OTHER, A, NA);
        expect((await repo.readStateForThread(THREAD)).get(subjectKey(A))).toBe(RA);
        expect((await repo.readStateForThread(OTHER)).get(subjectKey(A))).toBe(NA);
      });

      it("read and notify are independent stores for the same (subject,thread)", async () => {
        await repo.recordRead(THREAD, A, RA);
        expect((await repo.notifyStateForThread(THREAD)).has(subjectKey(A))).toBe(false);
      });

      it("the composite key separates the same id across kinds (DEC-058)", async () => {
        const crewShared: Subject = { kind: "crew", id: "shared" };
        const adminShared: Subject = { kind: "admin", id: "shared" };
        await repo.recordNotification(THREAD, crewShared, RA);
        await repo.recordNotification(THREAD, adminShared, NA);
        const m = await repo.notifyStateForThread(THREAD);
        expect(m.get(subjectKey(crewShared))).toBe(RA);
        expect(m.get(subjectKey(adminShared))).toBe(NA);
        expect(m.size).toBe(2);
      });

      it("an unwritten thread → empty maps", async () => {
        const empty = asId<"ThreadId">("thread-empty");
        expect((await repo.readStateForThread(empty)).size).toBe(0);
        expect((await repo.notifyStateForThread(empty)).size).toBe(0);
      });
    });
  });
}
