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
  AddOn,
  Customer,
  Admin,
  Ask,
  Block,
  BookingCode,
  CheckoutHold,
  Credential,
  CrewMember,
  Event,
  Gratuity,
  Location,
  LoginCode,
  MagicToken,
  Offering,
  OutboxEntry,
  RingOutboxEntry,
  NoticeOutboxEntry,
  SmsConsent,
  GuestContact,
  PtoWindow,
  TimePunch,
  TimePunchEdit,
  Payment,
  Reservation,
  RoleType,
  Seat,
  Shift,
  Vessel,
} from "../domain/entities.js";
import { eventIdForSlot } from "../reservations/availability.js";
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
const punch = (over: Partial<TimePunch> = {}): TimePunch => ({
  id: asId<"TimePunchId">("punch-1"),
  crewMemberId: CREW,
  inAt: "2026-07-15T13:00:00.000Z",
  outAt: null,
  shiftId: null,
  origin: "crew",
  adminEditedAt: null,
  ...over,
});
const event = (over: Partial<Event> = {}): Event => ({
  id: EVENT,
  vesselId: VESSEL,
  date: "2026-07-01",
  time: "14:00",
  capacity: 12,
  status: "scheduled",
  source: "xola",
  ...over,
});
const reservation = (over: Partial<Reservation> = {}): Reservation => ({
  id: asId<"ReservationId">("resv-1"),
  eventId: EVENT,
  customerName: "Brody",
  partySize: 4,
  status: "booked",
  source: "xola",
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
const admin = (over: Partial<Admin> = {}): Admin => ({
  id: CREW,
  handle: "cap",
  name: "Cap Ahab",
  active: true,
  createdAt: "2026-07-01T12:00:00.000Z",
  deactivatedAt: null,
  ...over,
});
const loginCode = (over: Partial<LoginCode> = {}): LoginCode => ({
  subjectKind: "crew",
  subjectId: CREW,
  codeHash: "code-hash-1",
  createdAt: "2026-07-01T12:00:00.000Z",
  expiresAt: "2026-07-01T12:10:00.000Z",
  attempts: 0,
  ...over,
});
/** A failure window wide enough to never be the thing under test (DEC-142). */
const WIDE_WINDOW = {
  startsAt: "2026-01-01T00:00:00.000Z",
  now: "2026-07-01T12:00:00.000Z",
  max: 1_000,
};
/** A presented hash that never matches the stored `code-hash-1` — i.e. a WRONG guess. The
 *  window/attempt bounds apply to these; a correct-code claim is exercised separately (#801). */
const WRONG_HASH = "not-the-stored-code";
const outboxEntry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: asId<"OutboxEntryId">("obx-ask-1"),
  askId: asId<"AskId">("ask-1"),
  seatId: SEAT,
  crewMemberId: CREW,
  body: "Muster: Wed, Jul 1 · Hops · captain — yes or no?",
  link: "https://app.example/crew/auth?t=secret",
  status: "pending",
  createdAt: "2026-07-01T12:00:00.000Z",
  ...over,
});
const ringOutboxEntry = (over: Partial<RingOutboxEntry> = {}): RingOutboxEntry => ({
  id: asId<"RingOutboxEntryId">("ring-thread-1-crew-a"),
  crewMemberId: CREW,
  threadId: asId<"ThreadId">("thread-1"),
  body: "2 new messages",
  link: "https://app.example/crew/auth?t=secret&thread=thread-1",
  status: "pending",
  createdAt: "2026-07-01T12:00:00.000Z",
  ...over,
});
const noticeOutboxEntry = (
  over: Partial<NoticeOutboxEntry> = {},
): NoticeOutboxEntry => ({
  id: asId<"NoticeOutboxEntryId">("notice-shift-1-crew-a-removed"),
  crewMemberId: CREW,
  action: "removed",
  body: "Muster: you're off the Sat, Jul 4 · Barrel shift.",
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
    bookedNoBoat: [],
    warnings: ["heads up"],
    assignments: [{ date: "2026-07-01", boats: [] }],
    splitDaysChanged: [],
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
      expect("weekdaysOff" in got!).toBe(false); // #411: absent = never off, omitted not []
      // Now with the optionals set (incl. a recurring weekday-off set, #411).
      await repo.saveCrewMember(
        crew({
          email: "q@x.io",
          manualBoost: 3,
          protocolOverride: "assign_then_confirm",
          reliabilityScore: 7,
          weekdaysOff: [5, 6],
        }),
      );
      expect(await repo.getCrewMember(CREW)).toEqual(
        crew({
          email: "q@x.io",
          manualBoost: 3,
          protocolOverride: "assign_then_confirm",
          reliabilityScore: 7,
          weekdaysOff: [5, 6],
        }),
      );
    });

    it("crew: Gusto identity round-trips + updateCrewGusto is targeted (DEC-124, 12.3b)", async () => {
      await repo.saveCrewMember(crew({ reliabilityScore: 7 })); // no gusto
      expect("gusto" in (await repo.getCrewMember(CREW))!).toBe(false); // omitted, not null
      const gusto = { firstName: "Ann", lastName: "Alpha", title: "Captain", employeeId: "E1" };
      await repo.saveCrewMember(crew({ gusto, reliabilityScore: 7 }));
      expect((await repo.getCrewMember(CREW))!.gusto).toEqual(gusto);
      // targeted update: sets gusto only, leaves reliabilityScore untouched (DEC-094)
      const g2 = { firstName: "Ann", lastName: "Beta", title: "Mate", employeeId: "E2" };
      const updated = await repo.updateCrewGusto(CREW, g2);
      expect(updated).toMatchObject({ gusto: g2, reliabilityScore: 7 });
      expect(await repo.updateCrewGusto(CREW_B, g2)).toBeNull(); // unknown id
    });

    it("updateCrewWeekdaysOff: replaces the set, clears to omitted, leaves score/status (DEC-094/119)", async () => {
      await repo.saveCrewMember(crew({ reliabilityScore: 7, status: "inactive" }));
      const set = await repo.updateCrewWeekdaysOff(CREW, [6]);
      expect(set).toMatchObject({ weekdaysOff: [6], reliabilityScore: 7, status: "inactive" });
      // Clearing to [] round-trips as omitted (never off), engine fields untouched.
      await repo.updateCrewWeekdaysOff(CREW, []);
      const got = await repo.getCrewMember(CREW);
      expect("weekdaysOff" in got!).toBe(false);
      expect(got).toMatchObject({ reliabilityScore: 7, status: "inactive" });
      expect(await repo.updateCrewWeekdaysOff(CREW_B, [1])).toBeNull();
    });

    it("updateCrewContact: touches only passed columns; leaves score/status/ratings (DEC-094)", async () => {
      await repo.saveCrewMember(
        crew({ email: "old@x.io", reliabilityScore: 7, manualBoost: 3, status: "active" }),
      );
      // Fix only the phone — the engine-owned fields must survive (the lost-update
      // the whole-row read-modify-write would have caused).
      const updated = await repo.updateCrewContact(CREW, { phone: "+15035550199" });
      expect(updated).toMatchObject({ phone: "+15035550199", reliabilityScore: 7, manualBoost: 3 });
      const got = await repo.getCrewMember(CREW);
      expect(got).toEqual(
        crew({ email: "old@x.io", phone: "+15035550199", reliabilityScore: 7, manualBoost: 3 }),
      );
      // email: null clears; an unknown id returns null.
      await repo.updateCrewContact(CREW, { email: null });
      expect("email" in (await repo.getCrewMember(CREW))!).toBe(false);
      expect(await repo.updateCrewContact(CREW_B, { name: "x" })).toBeNull();
    });

    it("setCrewStatus: flips active↔inactive↔archived; unknown id → null", async () => {
      await repo.saveCrewMember(crew({ status: "active", reliabilityScore: 5 }));
      const disabled = await repo.setCrewStatus(CREW, "inactive");
      expect(disabled).toMatchObject({ status: "inactive", reliabilityScore: 5 });
      expect((await repo.getCrewMember(CREW))!.status).toBe("inactive");
      expect((await repo.setCrewStatus(CREW, "active"))!.status).toBe("active");
      // archived round-trips too (#323, DEC-096) — a plain text column, no enum.
      expect((await repo.setCrewStatus(CREW, "archived"))!.status).toBe("archived");
      expect((await repo.getCrewMember(CREW))!.status).toBe("archived");
      expect((await repo.setCrewStatus(CREW, "active"))!.status).toBe("active");
      expect(await repo.setCrewStatus(CREW_B, "inactive")).toBeNull();
    });

    it("addCrewMemberWithCredential: member + credential land together", async () => {
      const cred = {
        id: asId<"CredentialId">("cred-crew-b-mmc"),
        crewMemberId: CREW_B,
        type: "MMC" as const,
        expiry: "2099-12-31",
      };
      await repo.addCrewMemberWithCredential(crew({ id: CREW_B, name: "New Hire" }), cred);
      expect((await repo.getCrewMember(CREW_B))!.name).toBe("New Hire");
      expect(await repo.listCredentialsForCrew(CREW_B)).toEqual([cred]);
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

    it("pto windows: remove drops it from both lists; second remove is a no-op", async () => {
      await repo.savePtoWindow(pto());
      await repo.removePtoWindow(asId<"PtoWindowId">("pto-1"));
      expect(await repo.listPtoWindowsForCrew(CREW)).toEqual([]);
      expect(await repo.listAllPtoWindows()).toEqual([]);
      // Idempotent — removing an absent id must not throw (surfaces double-submit).
      await repo.removePtoWindow(asId<"PtoWindowId">("pto-1"));
    });

    it("time punches: round-trip with every optional both null and set (§2.9)", async () => {
      await repo.saveCrewMember(crew()); // FK: a punch without a person is meaningless
      await repo.saveTimePunch(punch());
      expect(await repo.getTimePunch(asId<"TimePunchId">("punch-1"))).toEqual(punch());

      const full = punch({
        id: asId<"TimePunchId">("punch-2"),
        inAt: "2026-07-16T13:00:00.000Z",
        outAt: "2026-07-16T21:30:00.000Z",
        shiftId: SHIFT,
        origin: "admin",
        adminEditedAt: "2026-07-17T09:00:00.000Z",
      });
      await repo.saveTimePunch(full);
      expect(await repo.getTimePunch(asId<"TimePunchId">("punch-2"))).toEqual(full);
    });

    it("time punches: getOpenPunchForCrew finds the open one and nothing once closed", async () => {
      await repo.saveCrewMember(crew());
      await repo.saveTimePunch(punch());
      expect(await repo.getOpenPunchForCrew(CREW)).toEqual(punch());

      await repo.saveTimePunch(punch({ outAt: "2026-07-15T21:00:00.000Z" }));
      expect(await repo.getOpenPunchForCrew(CREW)).toBeNull();
    });

    it("time punches: getOpenPunchForCrew is scoped per crew member", async () => {
      await repo.saveCrewMember(crew());
      await repo.saveCrewMember(crew({ id: CREW_B, name: "Hooper" }));
      await repo.saveTimePunch(punch({ crewMemberId: CREW_B }));
      expect(await repo.getOpenPunchForCrew(CREW)).toBeNull();
      expect(await repo.getOpenPunchForCrew(CREW_B)).toMatchObject({ crewMemberId: CREW_B });
    });

    it("time punches: listForCrew is newest-first and excludes other people", async () => {
      await repo.saveCrewMember(crew());
      await repo.saveCrewMember(crew({ id: CREW_B, name: "Hooper" }));
      await repo.saveTimePunch(
        punch({ id: asId<"TimePunchId">("p-old"), inAt: "2026-07-10T13:00:00.000Z", outAt: "2026-07-10T20:00:00.000Z" }),
      );
      await repo.saveTimePunch(
        punch({ id: asId<"TimePunchId">("p-new"), inAt: "2026-07-20T13:00:00.000Z", outAt: "2026-07-20T20:00:00.000Z" }),
      );
      await repo.saveTimePunch(punch({ id: asId<"TimePunchId">("p-theirs"), crewMemberId: CREW_B }));

      expect((await repo.listTimePunchesForCrew(CREW)).map((p) => String(p.id))).toEqual([
        "p-new",
        "p-old",
      ]);
    });

    it("time punches: listBetween is half-open [from, to) so midnight isn't double-counted", async () => {
      await repo.saveCrewMember(crew());
      // All saved CLOSED so the one-open-punch index doesn't refuse the batch.
      await repo.saveTimePunch(
        punch({ id: asId<"TimePunchId">("p-before"), inAt: "2026-07-14T23:59:59.999Z", outAt: "2026-07-15T01:00:00.000Z" }),
      );
      await repo.saveTimePunch(
        punch({ id: asId<"TimePunchId">("p-lower"), inAt: "2026-07-15T00:00:00.000Z", outAt: "2026-07-15T08:00:00.000Z" }),
      );
      await repo.saveTimePunch(
        punch({ id: asId<"TimePunchId">("p-upper"), inAt: "2026-07-16T00:00:00.000Z", outAt: "2026-07-16T08:00:00.000Z" }),
      );

      const rows = await repo.listTimePunchesBetween(
        "2026-07-15T00:00:00.000Z",
        "2026-07-16T00:00:00.000Z",
      );
      // Lower bound included, upper bound excluded.
      expect(rows.map((p) => String(p.id))).toEqual(["p-lower"]);
    });

    it("time punches: listAll spans every crew member — the diagnostic's scan (#584)", async () => {
      await repo.saveCrewMember(crew());
      await repo.saveCrewMember(crew({ id: CREW_B, name: "Hooper" }));
      await repo.saveTimePunch(punch());
      await repo.saveTimePunch(punch({ id: asId<"TimePunchId">("punch-2"), crewMemberId: CREW_B }));

      expect((await repo.listAllTimePunches()).map((p) => String(p.id)).sort()).toEqual([
        "punch-1",
        "punch-2",
      ]);
    });

    it("time punch edits: append-only round-trip, oldest first, per punch", async () => {
      await repo.saveCrewMember(crew());
      const edit = (id: string, at: string, over: Partial<TimePunchEdit> = {}): TimePunchEdit => ({
        id: asId<"TimePunchEditId">(id),
        timePunchId: asId<"TimePunchId">("punch-1"),
        actorKind: "crew",
        actorId: CREW,
        at,
        action: "changed",
        fromInAt: "2026-07-15T13:00:00.000Z",
        fromOutAt: null,
        toInAt: "2026-07-15T13:00:00.000Z",
        toOutAt: "2026-07-15T21:00:00.000Z",
        reason: "forgot to clock out",
        ...over,
      });

      await repo.appendTimePunchEdit(edit("e2", "2026-07-16T15:00:00.000Z"));
      await repo.appendTimePunchEdit(edit("e1", "2026-07-16T14:00:00.000Z"));
      await repo.appendTimePunchEdit(
        edit("e-other", "2026-07-16T16:00:00.000Z", {
          timePunchId: asId<"TimePunchId">("punch-2"),
        }),
      );

      // Oldest first — the order it happened in — and scoped to the one punch.
      const trail = await repo.listTimePunchEdits(asId<"TimePunchId">("punch-1"));
      expect(trail.map((e) => String(e.id))).toEqual(["e1", "e2"]);
      expect(trail[0]).toEqual(edit("e1", "2026-07-16T14:00:00.000Z"));
    });

    it("time punch edits: a created row has no before, a deleted row no after", async () => {
      await repo.saveCrewMember(crew());
      const base = {
        timePunchId: asId<"TimePunchId">("punch-1"),
        actorKind: "admin" as const,
        actorId: CREW,
        reason: "",
      };
      const created: TimePunchEdit = {
        ...base,
        id: asId<"TimePunchEditId">("e-new"),
        at: "2026-07-16T14:00:00.000Z",
        action: "created",
        fromInAt: null,
        fromOutAt: null,
        toInAt: "2026-07-15T13:00:00.000Z",
        toOutAt: null,
      };
      const deleted: TimePunchEdit = {
        ...base,
        id: asId<"TimePunchEditId">("e-del"),
        at: "2026-07-16T15:00:00.000Z",
        action: "deleted",
        fromInAt: "2026-07-15T13:00:00.000Z",
        fromOutAt: "2026-07-15T21:00:00.000Z",
        toInAt: null,
        toOutAt: null,
      };
      await repo.appendTimePunchEdit(created);
      await repo.appendTimePunchEdit(deleted);

      expect(await repo.listTimePunchEdits(asId<"TimePunchId">("punch-1"))).toEqual([
        created,
        deleted,
      ]);
    });

    it("time punch edits: the trail OUTLIVES the punch it describes (#635)", async () => {
      // The reason this table carries no FK to time_punches: after a delete, the
      // `deleted` row is the only evidence those hours ever existed.
      await repo.saveCrewMember(crew());
      await repo.saveTimePunch(punch());
      await repo.appendTimePunchEdit({
        id: asId<"TimePunchEditId">("e-del"),
        timePunchId: asId<"TimePunchId">("punch-1"),
        actorKind: "crew",
        actorId: CREW,
        at: "2026-07-16T15:00:00.000Z",
        action: "deleted",
        fromInAt: "2026-07-15T13:00:00.000Z",
        fromOutAt: null,
        toInAt: null,
        toOutAt: null,
        reason: "double punch",
      });

      await repo.removeTimePunch(asId<"TimePunchId">("punch-1"));

      expect(await repo.getTimePunch(asId<"TimePunchId">("punch-1"))).toBeNull();
      expect(await repo.listTimePunchEdits(asId<"TimePunchId">("punch-1"))).toHaveLength(1);
    });

    it("time punches: remove drops it; second remove is a no-op", async () => {
      await repo.saveCrewMember(crew());
      await repo.saveTimePunch(punch());
      await repo.removeTimePunch(asId<"TimePunchId">("punch-1"));
      expect(await repo.getTimePunch(asId<"TimePunchId">("punch-1"))).toBeNull();
      expect(await repo.listTimePunchesForCrew(CREW)).toEqual([]);
      // Idempotent — surfaces double-submit.
      await repo.removeTimePunch(asId<"TimePunchId">("punch-1"));
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

    it("events: source + price round-trip; price optional (DEC-106/112)", async () => {
      await repo.saveEvent(event()); // 'xola' default, no price
      const got = await repo.getEvent(EVENT);
      expect(got!.source).toBe("xola");
      expect("price" in got!).toBe(false); // omitted, not undefined
      const priced = event({ source: "muster", price: 49900 }); // $499.00 in cents
      await repo.saveEvent(priced);
      expect(await repo.getEvent(EVENT)).toEqual(priced);
    });

    it("events: durationMinutes round-trips and stays omitted when absent (#570)", async () => {
      await repo.saveEvent(event()); // Xola-sourced: no length, permanently
      const bare = await repo.getEvent(EVENT);
      expect("durationMinutes" in bare!).toBe(false); // omitted, not undefined
      // A null column must not surface as `durationMinutes: undefined` — the
      // fallback in `eventDurationMinutes` keys on absence, and the shift end (and
      // so the completion sweep) is downstream of it.
      const charter = event({ source: "muster", durationMinutes: 240 });
      await repo.saveEvent(charter);
      expect(await repo.getEvent(EVENT)).toEqual(charter);
      expect((await repo.listEvents())[0]!.durationMinutes).toBe(240);
    });

    it("reservations: source round-trips (DEC-106)", async () => {
      await repo.saveReservation(reservation({ source: "muster" }));
      expect(
        (await repo.getReservation(asId<"ReservationId">("resv-1")))!.source,
      ).toBe("muster");
    });

    it("reservations: waiver consent round-trips (11.5, DEC-110)", async () => {
      await repo.saveReservation(
        reservation({ source: "muster", waiverConsentAt: "2026-07-13T12:00:00.000Z", waiverVersion: "v1" }),
      );
      const got = (await repo.getReservation(asId<"ReservationId">("resv-1")))!;
      expect(got.waiverConsentAt).toBe("2026-07-13T12:00:00.000Z");
      expect(got.waiverVersion).toBe("v1");
    });

    // The `saveReservationIfUnclaimed` contract block that stood here is GONE (#693). It was
    // the DEC-109 whole-boat claim keyed on one `event_id` — seven cases across both adapters —
    // and its only caller was the legacy `writeBooking`, retired in the same change. The
    // guarantee is not lost: `saveBookingIfSlotFree` below claims the same whole-boat mutex and
    // adds what the old one lacked, the hull-day advisory lock and the overlap predicate that
    // #691 needed. Keeping a second write path alive purely because it had tests is how an
    // unguarded fallback survives a decade.
    //
    // `rid` stayed — it was declared inside that block and the `saveBookingIfSlotFree` cases
    // below use it.
    const rid = (s: string) => asId<"ReservationId">(s);

    // ── saveBookingIfSlotFree — materialize + claim a virtual slot (12.1, DEC-109/125) ──
    const SLOT_ID = eventIdForSlot(VESSEL, "2026-07-01", "14:00");
    const slotEvent = (over: Partial<Event> = {}): Event =>
      event({ id: SLOT_ID, source: "muster", ...over });

    it("saveBookingIfSlotFree: materializes the Event and claims on an empty slot", async () => {
      const ev = slotEvent();
      const res = await repo.saveBookingIfSlotFree(
        ev,
        reservation({ id: rid("resv-a"), source: "muster", eventId: SLOT_ID }),
      );
      expect(res.result).toBe("won");
      expect(await repo.getEvent(SLOT_ID)).not.toBeNull(); // materialized
      expect(await repo.listReservationsForEvent(SLOT_ID)).toHaveLength(1);
    });

    it("saveBookingIfSlotFree: LOSES when a Xola trip already holds the hull (#615)", async () => {
      // The imported Xola booking is a different source and a different event id, so every
      // guard the CAS had — the partial unique index, the `not exists` reservation check —
      // sailed straight past it. Muster would sell a boat Xola had already sold.
      await repo.saveEvent(
        event({ id: asId<"EventId">("evt-xola-hull"), source: "xola", time: "14:00" }),
      );
      const res = await repo.saveBookingIfSlotFree(
        slotEvent(),
        reservation({ id: rid("resv-x"), source: "muster", eventId: SLOT_ID }),
      );
      expect(res.result).toBe("lost");
      expect(await repo.listReservationsForEvent(SLOT_ID)).toHaveLength(0);
    });

    it("saveBookingIfSlotFree: LOSES on an OVERLAPPING time, not just the same one (#691)", async () => {
      // 13:00 + 100min runs to 14:40, over a 14:00 departure. A different slot identity, which
      // is exactly why the exact-triple guard called itself defeat-proof and wasn't.
      await repo.saveEvent(
        event({ id: asId<"EventId">("evt-overlap"), source: "muster", time: "13:00", durationMinutes: 100 }),
      );
      const res = await repo.saveBookingIfSlotFree(
        slotEvent(),
        reservation({ id: rid("resv-o"), source: "muster", eventId: SLOT_ID }),
      );
      expect(res.result).toBe("lost");
    });

    it("saveBookingIfSlotFree: an untimed existing trip is measured at the STANDING length, not the new booking's", async () => {
      // The SQL coalesced a null `duration_minutes` against the NEW booking's duration. Book a
      // short charter and the untimed Xola trip beside it shrinks to match — opening a gap that
      // is not there. `busyIntervalsFor` always measures an existing untimed row at
      // XOLA_TRIP_MINUTES, and the backstop has to agree or the read path and the write path
      // disagree about the same boat.
      await repo.saveEvent(
        // 13:00, no duration ⇒ 100 minutes ⇒ busy to 14:40, over the 14:00 slot.
        event({ id: asId<"EventId">("evt-untimed"), source: "xola", time: "13:00" }),
      );
      const res = await repo.saveBookingIfSlotFree(
        slotEvent({ durationMinutes: 30 }), // a SHORT new booking at 14:00
        reservation({ id: rid("resv-short"), source: "muster", eventId: SLOT_ID }),
      );
      expect(res.result).toBe("lost");
    });

    it("saveBookingIfSlotFree: WINS when the other trip ends exactly as this one starts", async () => {
      // Half-open intervals. Back-to-back departures are the operator's actual schedule, so
      // a closed interval here would refuse every second sailing of the day.
      await repo.saveEvent(
        event({ id: asId<"EventId">("evt-abuts"), source: "muster", time: "12:20", durationMinutes: 100 }),
      );
      const res = await repo.saveBookingIfSlotFree(
        slotEvent(),
        reservation({ id: rid("resv-ab"), source: "muster", eventId: SLOT_ID }),
      );
      expect(res.result).toBe("won");
    });

    it("saveBookingIfSlotFree: a CANCELLED trip on the hull does not block", async () => {
      await repo.saveEvent(
        event({ id: asId<"EventId">("evt-cancelled"), source: "xola", time: "14:00", status: "cancelled" }),
      );
      const res = await repo.saveBookingIfSlotFree(
        slotEvent(),
        reservation({ id: rid("resv-c"), source: "muster", eventId: SLOT_ID }),
      );
      expect(res.result).toBe("won");
    });

    /**
     * A cancelled RESERVATION on the claimed slot does not block a re-claim.
     *
     * Distinct from the cancelled-TRIP case above, which cancels the event. This cancels the
     * booking while the slot stays live — the customer-cancels-then-someone-else-books path. Both
     * adapters enforce it (`and status='booked'` in the SQL, `r.status === "booked"` in memory),
     * and the retired `saveReservationIfUnclaimed` block had a case for it; when that block went
     * with #693 this guarantee was left enforced by code and asserted by nothing. Caught by
     * @code-review reading what the deletion actually removed rather than counting the cases.
     */
    it("saveBookingIfSlotFree: a CANCELLED reservation on the slot does not block a re-claim", async () => {
      const ev = slotEvent();
      const first = reservation({ id: rid("resv-gone"), source: "muster", eventId: SLOT_ID });
      expect((await repo.saveBookingIfSlotFree(ev, first)).result).toBe("won");
      await repo.saveReservation({ ...first, status: "cancelled" });

      const res = await repo.saveBookingIfSlotFree(
        ev,
        reservation({ id: rid("resv-next"), source: "muster", eventId: SLOT_ID }),
      );
      expect(res.result).toBe("won");
    });

    it("saveBookingIfSlotFree: idempotent on reservation id (redelivered webhook)", async () => {
      const ev = slotEvent();
      const r = reservation({ id: rid("resv-a"), source: "muster", eventId: SLOT_ID });
      expect((await repo.saveBookingIfSlotFree(ev, r)).result).toBe("won");
      expect((await repo.saveBookingIfSlotFree(ev, r)).result).toBe("won"); // idempotent
      expect(await repo.listReservationsForEvent(SLOT_ID)).toHaveLength(1);
    });

    it("saveBookingIfSlotFree: a DIFFERENT reservation loses on an already-claimed slot", async () => {
      const ev = slotEvent();
      expect(
        (await repo.saveBookingIfSlotFree(ev, reservation({ id: rid("resv-a"), source: "muster", eventId: SLOT_ID }))).result,
      ).toBe("won");
      expect(
        (await repo.saveBookingIfSlotFree(ev, reservation({ id: rid("resv-b"), source: "muster", eventId: SLOT_ID }))).result,
      ).toBe("lost");
      const active = (await repo.listReservationsForEvent(SLOT_ID)).filter((r) => r.status === "booked");
      expect(active).toHaveLength(1);
    });

    it("saveBookingIfSlotFree: exactly one of two concurrent first-bookings wins (one Event, one claim)", async () => {
      const ev = slotEvent();
      const [a, b] = await Promise.all([
        repo.saveBookingIfSlotFree(ev, reservation({ id: rid("resv-a"), source: "muster", eventId: SLOT_ID, customerName: "A" })),
        repo.saveBookingIfSlotFree(ev, reservation({ id: rid("resv-b"), source: "muster", eventId: SLOT_ID, customerName: "B" })),
      ]);
      expect([a.result, b.result].filter((x) => x === "won")).toHaveLength(1);
      expect(await repo.getEvent(SLOT_ID)).not.toBeNull();
      const active = (await repo.listReservationsForEvent(SLOT_ID)).filter((r) => r.status === "booked");
      expect(active).toHaveLength(1); // the guardrail held — no double-sold boat
    });

    it("saveBookingIfSlotFree: claims a PRE-EXISTING override event at the slot, reconciling eventId", async () => {
      // an override event with a NON-deterministic id already occupies the physical slot
      await repo.saveEvent(
        event({ id: asId<"EventId">("override-1"), source: "muster", vesselId: VESSEL, date: "2026-07-01", time: "14:00", price: 55500 }),
      );
      const res = await repo.saveBookingIfSlotFree(
        slotEvent(), // deterministic-id candidate
        reservation({ id: rid("resv-a"), source: "muster", eventId: SLOT_ID }),
      );
      expect(res.result).toBe("won");
      if (res.result === "won") expect(String(res.eventId)).toBe("override-1"); // claimed the existing row
      expect(await repo.getEvent(SLOT_ID)).toBeNull(); // no duplicate materialized (slot guardrail)
      expect(await repo.listReservationsForEvent(asId<"EventId">("override-1"))).toHaveLength(1);
    });

    // ── Checkout holds — acquire / lifecycle (12.1, DEC-109) ───────────────────
    const hold = (over: Partial<CheckoutHold> = {}): CheckoutHold => ({
      id: asId<"CheckoutHoldId">("hold-1"),
      vesselId: VESSEL,
      date: "2026-07-01",
      time: "14:00",
      source: "muster",
      offeringId: asId<"OfferingId">("off-1"),
      guestCount: 4,
      expiresAt: "2026-07-01T12:15:00.000Z",
      createdAt: "2026-07-01T12:00:00.000Z",
      ...over,
    });

    /**
     * Save the parent rows the reservations-era foreign keys require (DEC-131). Postgres now
     * enforces `checkout_holds.{vessel_id,offering_id}` and `offerings.location_id`; the
     * in-memory double enforces nothing, so these saves are inert there. Pure fixture setup —
     * no test's assertions change, they just stop writing children into thin air.
     */
    const saveCatalogParents = async (): Promise<void> => {
      await repo.saveVessel(vessel());
      await repo.saveLocation({
        id: asId<"LocationId">("loc-1"),
        name: "Dock",
        pickupDescription: "Meet at the dock",
        routeDescription: "Up the river",
      });
      await repo.saveOffering({
        id: asId<"OfferingId">("off-1"),
        tenantId: TENANT,
        name: "Sunset Cruise",
        status: "live",
        vesselIds: [VESSEL],
        locationId: asId<"LocationId">("loc-1"),
        schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: ["14:00"] },
        basePriceCents: 49900,
        priceVariations: [],
        extraGuestPriceCents: 5000,
      });
    };

    // ── Refund lease (#726) ───────────────────────────────────────────────────
    // The FK means the reservation must exist first — in Postgres an orphan lease insert fails,
    // and testing this against the double alone would hide that.
    const LEASE_RESV = asId<"ReservationId">("resv-leased");
    const T0 = "2026-08-14T12:00:00.000Z";
    const T_LATER = "2026-08-14T12:00:30.000Z";
    const T_AFTER_EXPIRY = "2026-08-14T12:02:00.000Z";
    const EXPIRES = "2026-08-14T12:01:00.000Z";

    it("refund lease: a fresh acquire wins", async () => {
      await repo.saveReservation(reservation({ id: LEASE_RESV }));
      expect(await repo.acquireRefundLease(LEASE_RESV, "tok-a", T0, EXPIRES)).toEqual({ acquired: true });
    });

    it("refund lease: a second live acquire LOSES — this is the money guard", async () => {
      // The whole reason the table exists: two concurrent refunds of different amounts must not
      // both reach Stripe. Both adapters must agree on which side of this the second call lands.
      await repo.saveReservation(reservation({ id: LEASE_RESV }));
      expect(await repo.acquireRefundLease(LEASE_RESV, "tok-a", T0, EXPIRES)).toEqual({ acquired: true });
      expect(await repo.acquireRefundLease(LEASE_RESV, "tok-b", T_LATER, EXPIRES)).toEqual({
        acquired: false,
      });
    });

    it("refund lease: releasing lets the next one in, and is idempotent", async () => {
      await repo.saveReservation(reservation({ id: LEASE_RESV }));
      await repo.acquireRefundLease(LEASE_RESV, "tok-a", T0, EXPIRES);
      await repo.releaseRefundLease(LEASE_RESV, "tok-a");
      expect(await repo.acquireRefundLease(LEASE_RESV, "tok-b", T_LATER, EXPIRES)).toEqual({
        acquired: true,
      });
      // Called from a `finally`, so a double release (or one on a lease that already expired)
      // must be a no-op rather than a throw.
      await repo.releaseRefundLease(LEASE_RESV, "tok-a");
      await expect(repo.releaseRefundLease(LEASE_RESV, "tok-a")).resolves.toBeUndefined();
    });

    it("refund lease: an EXPIRED lease is inert — a crashed refund can't strand the booking", async () => {
      // Without lazy expiry, a process dying mid-refund blocks every future refund on this
      // booking forever: silent, permanent, and worse than the bug the lease fixes.
      await repo.saveReservation(reservation({ id: LEASE_RESV }));
      await repo.acquireRefundLease(LEASE_RESV, "tok-a", T0, EXPIRES);
      expect(await repo.acquireRefundLease(LEASE_RESV, "tok-b", T_AFTER_EXPIRY, EXPIRES)).toEqual({
        acquired: true,
      });
    });

    it("refund lease: `now` EXACTLY equal to expires_at counts as expired, on both adapters", async () => {
      // The boundary, pinned rather than assumed. Postgres deletes on `expires_at <= now` and
      // the double blocks only while `expiresAt > nowIso` — two different spellings of the same
      // rule, which is exactly how adapters drift apart without either one looking wrong. An
      // off-by-one here is a lease that outlives itself by a tick (a refund refused for no
      // visible reason) or dies a tick early (the double-refund window reopening).
      await repo.saveReservation(reservation({ id: LEASE_RESV }));
      await repo.acquireRefundLease(LEASE_RESV, "tok-a", T0, EXPIRES);
      expect(await repo.acquireRefundLease(LEASE_RESV, "tok-b", EXPIRES, EXPIRES)).toEqual({
        acquired: true,
      });
    });

    it("refund lease: one tick BEFORE expiry still blocks", async () => {
      // The other side of the same boundary — without this, an adapter that treated every lease
      // as expired would pass the case above and reopen the exact race #726 closed.
      await repo.saveReservation(reservation({ id: LEASE_RESV }));
      await repo.acquireRefundLease(LEASE_RESV, "tok-a", T0, EXPIRES);
      expect(await repo.acquireRefundLease(LEASE_RESV, "tok-b", "2026-08-14T12:00:59.999Z", EXPIRES)).toEqual({
        acquired: false,
      });
    });

    it("refund lease: a stale holder's release does NOT kill its successor's live lease", async () => {
      // The scenario: refund A's lease expires while its Stripe call is still in flight, refund B
      // legitimately acquires, then A's `finally` fires. Releasing by reservation alone would
      // delete B's LIVE lease, letting a third refund run alongside B — reopening the race, in
      // exactly the slow-call case the expiry exists to handle. Release is own-lease-only.
      await repo.saveReservation(reservation({ id: LEASE_RESV }));
      await repo.acquireRefundLease(LEASE_RESV, "tok-a", T0, EXPIRES);
      // B acquires after A's lease expired.
      expect(await repo.acquireRefundLease(LEASE_RESV, "tok-b", T_AFTER_EXPIRY, "2026-08-14T12:03:00.000Z")).toEqual({
        acquired: true,
      });
      // A finally returns and releases with ITS token.
      await repo.releaseRefundLease(LEASE_RESV, "tok-a");
      // B still holds it — a third attempt is still refused.
      expect(await repo.acquireRefundLease(LEASE_RESV, "tok-c", T_AFTER_EXPIRY, EXPIRES)).toEqual({
        acquired: false,
      });
    });

    it("refund lease: leases are per-reservation, not global", async () => {
      // A refund on one booking must never block a refund on another.
      await repo.saveReservation(reservation({ id: LEASE_RESV }));
      await repo.saveReservation(reservation({ id: asId<"ReservationId">("resv-other-lease") }));
      await repo.acquireRefundLease(LEASE_RESV, "tok-a", T0, EXPIRES);
      expect(
        await repo.acquireRefundLease(asId<"ReservationId">("resv-other-lease"), "tok-c", T0, EXPIRES),
      ).toEqual({ acquired: true });
    });

    // ── Recovery throttle (issue #460) ────────────────────────────────────────
    const THROTTLE_T0 = "2026-08-15T12:00:00.000Z";
    const COOLDOWN = "2026-08-15T12:15:00.000Z";

    it("recovery throttle: the first claim wins, a second inside the window loses", async () => {
      // The bound on the one unauthenticated endpoint that spends money per request.
      expect(await repo.claimRecoverySend("+12165550148", THROTTLE_T0, COOLDOWN)).toEqual({ claimed: true });
      expect(
        await repo.claimRecoverySend("+12165550148", "2026-08-15T12:05:00.000Z", COOLDOWN),
      ).toEqual({ claimed: false });
    });

    it("recovery throttle: the window expires, at the exact boundary", async () => {
      // Pinned at equality on both adapters — Postgres deletes on `cooldown_until <= now` and the
      // double blocks while `cooldownUntil > nowIso`, two spellings of one rule. A customer who
      // is permanently locked out of recovery is a worse failure than an extra text.
      await repo.claimRecoverySend("+12165550148", THROTTLE_T0, COOLDOWN);
      expect(await repo.claimRecoverySend("+12165550148", COOLDOWN, COOLDOWN)).toEqual({
        claimed: true,
      });
    });

    it("recovery throttle: one tick before expiry still blocks", async () => {
      await repo.claimRecoverySend("+12165550148", THROTTLE_T0, COOLDOWN);
      expect(
        await repo.claimRecoverySend("+12165550148", "2026-08-15T12:14:59.999Z", COOLDOWN),
      ).toEqual({ claimed: false });
    });

    it("recovery throttle: buckets are per contact", async () => {
      // One person's request must not throttle another's. The key is the canonicalized contact,
      // so this is also what stops "216-555-0148" and "+12165550148" being two free attempts —
      // the CALLER canonicalizes, and the contract is that distinct keys are independent.
      await repo.claimRecoverySend("+12165550148", THROTTLE_T0, COOLDOWN);
      expect(await repo.claimRecoverySend("dana@example.com", THROTTLE_T0, COOLDOWN)).toEqual({
        claimed: true,
      });
    });

    /** A real-shaped holder token: 32 CSPRNG bytes as base64url is 43 chars (#575). */
    const TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";

    it("checkout hold: holderToken round-trips, present and absent (#575)", async () => {
      // The column the retry-reuse rule reads. Absent must stay ABSENT rather than null — the
      // reuse lookup requires a key on both sides, and a null that round-trips as `null` rather
      // than `undefined` is the kind of thing that makes two keyless holds compare equal.
      await saveCatalogParents();
      expect((await repo.acquireCheckoutHold(hold())).acquired).toBe(true);
      const bare = (await repo.listCheckoutHolds())[0]!;
      expect("holderToken" in bare).toBe(false);

      await repo.removeCheckoutHold(bare.id);
      expect(
        (await repo.acquireCheckoutHold(hold({ id: asId<"CheckoutHoldId">("h-keyed"), holderToken: TOKEN })))
          .acquired,
      ).toBe(true);
      expect((await repo.listCheckoutHolds())[0]!.holderToken).toBe(TOKEN);
    });

    it("acquireCheckoutHold: fresh acquire succeeds and is listable", async () => {
      await saveCatalogParents();
      expect((await repo.acquireCheckoutHold(hold())).acquired).toBe(true);
      expect(await repo.listCheckoutHolds()).toHaveLength(1);
    });

    it("acquireCheckoutHold: two live acquires on one slot — exactly one wins", async () => {
      await saveCatalogParents();
      const a = await repo.acquireCheckoutHold(hold({ id: asId<"CheckoutHoldId">("h-a") }));
      const b = await repo.acquireCheckoutHold(hold({ id: asId<"CheckoutHoldId">("h-b") }));
      expect([a.acquired, b.acquired].filter(Boolean)).toHaveLength(1);
      expect(await repo.listCheckoutHolds()).toHaveLength(1);
    });

    it("acquireCheckoutHold: idempotent re-acquire of one's OWN live hold", async () => {
      await saveCatalogParents();
      expect((await repo.acquireCheckoutHold(hold())).acquired).toBe(true);
      expect((await repo.acquireCheckoutHold(hold())).acquired).toBe(true);
      expect(await repo.listCheckoutHolds()).toHaveLength(1);
    });

    it("acquireCheckoutHold: an EXPIRED hold is inert — re-acquire succeeds (delete-expired-first)", async () => {
      await saveCatalogParents();
      // seed a hold that is live at its own createdAt but expired by the new acquire's clock
      await repo.acquireCheckoutHold(
        hold({ id: asId<"CheckoutHoldId">("h-old"), createdAt: "2026-07-01T10:45:00.000Z", expiresAt: "2026-07-01T11:00:00.000Z" }),
      );
      const res = await repo.acquireCheckoutHold(hold({ id: asId<"CheckoutHoldId">("h-new") }));
      expect(res.acquired).toBe(true);
      const holds = await repo.listCheckoutHolds();
      expect(holds).toHaveLength(1);
      expect(String(holds[0]!.id)).toBe("h-new"); // the stale row was deleted, not left to block
    });

    it("listLiveCheckoutHolds: returns only holds live at the given instant (issue #713)", async () => {
      await saveCatalogParents();
      // Two holds on DIFFERENT slots so neither displaces the other: one live at T, one expired.
      await repo.acquireCheckoutHold(hold({ id: asId<"CheckoutHoldId">("h-live"), time: "14:00" }));
      await repo.acquireCheckoutHold(
        hold({
          id: asId<"CheckoutHoldId">("h-dead"),
          time: "16:00",
          createdAt: "2026-07-01T10:45:00.000Z",
          expiresAt: "2026-07-01T11:00:00.000Z",
        }),
      );
      // The raw read still sees both — pruning lags by design, and the deriver stays responsible
      // for treating a present-but-expired row as inert.
      expect(await repo.listCheckoutHolds()).toHaveLength(2);

      const live = await repo.listLiveCheckoutHolds("2026-07-01T12:05:00.000Z");
      expect(live.map((h) => String(h.id))).toEqual(["h-live"]);

      // Boundary: expiry is exclusive, matching the `expiresAt > asOf` rule the deriver uses.
      expect(await repo.listLiveCheckoutHolds("2026-07-01T12:15:00.000Z")).toHaveLength(0);
      expect(await repo.listLiveCheckoutHolds("2026-07-01T12:14:59.999Z")).toHaveLength(1);
    });

    it("acquireCheckoutHold sweeps EVERY expired hold, not just its own slot (issue #713)", async () => {
      await saveCatalogParents();
      // An abandoned checkout on a slot nobody ever re-attempts. Before issue #713 the delete in
      // `acquireCheckoutHold` was scoped to the acquiring slot identity, so this row was
      // unreachable by any cleanup path and sat in the table forever.
      await repo.acquireCheckoutHold(
        hold({
          id: asId<"CheckoutHoldId">("h-abandoned"),
          time: "16:00",
          createdAt: "2026-07-01T10:45:00.000Z",
          expiresAt: "2026-07-01T11:00:00.000Z",
        }),
      );
      expect(await repo.listCheckoutHolds()).toHaveLength(1);

      // A completely unrelated acquire, on a different slot, at a later instant.
      expect((await repo.acquireCheckoutHold(hold({ id: asId<"CheckoutHoldId">("h-new") }))).acquired).toBe(true);

      const remaining = await repo.listCheckoutHolds();
      expect(remaining.map((h) => String(h.id))).toEqual(["h-new"]);
    });

    it("acquireCheckoutHold's sweep never touches a LIVE hold on another slot (issue #713)", async () => {
      await saveCatalogParents();
      // The sweep widens a DELETE that runs on the money path. Getting its predicate wrong would
      // drop a hold somebody is actively paying against and hand their boat to another buyer —
      // strictly worse than the unbounded growth it exists to fix.
      await repo.acquireCheckoutHold(
        hold({ id: asId<"CheckoutHoldId">("h-other-live"), time: "16:00", expiresAt: "2026-07-01T12:15:00.000Z" }),
      );
      expect((await repo.acquireCheckoutHold(hold({ id: asId<"CheckoutHoldId">("h-new") }))).acquired).toBe(true);

      const ids = (await repo.listCheckoutHolds()).map((h) => String(h.id)).sort();
      expect(ids).toEqual(["h-new", "h-other-live"]);
    });

    it("checkout holds: remove is idempotent", async () => {
      await saveCatalogParents();
      await repo.acquireCheckoutHold(hold());
      await repo.removeCheckoutHold(asId<"CheckoutHoldId">("hold-1"));
      expect(await repo.listCheckoutHolds()).toHaveLength(0);
      await repo.removeCheckoutHold(asId<"CheckoutHoldId">("hold-1")); // no-op, no throw
      expect(await repo.listCheckoutHolds()).toHaveLength(0);
    });

    // ── Reservation catalog — write + read round-trip (12.1a) ──────────────────
    it("catalog: offering / location / block write + read round-trip", async () => {
      await repo.saveVessel(vessel()); // parent for blocks.vessel_id (DEC-131)
      const loc: Location = {
        id: asId<"LocationId">("loc-1"),
        name: "Dock",
        pickupDescription: "Meet at the dock",
        routeDescription: "Up the river",
      };
      await repo.saveLocation(loc);
      expect(await repo.getLocation(loc.id)).toEqual(loc);

      const off: Offering = {
        id: asId<"OfferingId">("off-1"),
        tenantId: TENANT,
        name: "Sunset Cruise",
        status: "live",
        vesselIds: [VESSEL],
        locationId: loc.id,
        schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: ["14:00"] },
        basePriceCents: 49900,
        priceVariations: [{ label: "Sat", applies: { kind: "weekdays", weekdays: [5] }, adjustment: { kind: "percent", percent: 10 } }],
        extraGuestPriceCents: 5000,
      };
      await repo.saveOffering(off);
      expect(await repo.getOffering(off.id)).toEqual(off);
      expect(await repo.listOfferings()).toHaveLength(1);

      const blk: Block = { id: asId<"BlockId">("blk-1"), kind: "vessel", vesselId: VESSEL, startDate: "2026-07-04", endDate: "2026-07-05" };
      await repo.saveBlock(blk);
      expect(await repo.listBlocks()).toEqual([blk]);
      await repo.removeBlock(blk.id);
      expect(await repo.listBlocks()).toEqual([]);
    });

    it("catalog: Offering gratuityKinds round-trip present and absent (DEC-124, 12.8)", async () => {
      await saveCatalogParents();
      const base: Offering = {
        id: asId<"OfferingId">("off-g"), tenantId: TENANT, name: "Tipped", status: "live",
        vesselIds: [VESSEL], locationId: asId<"LocationId">("loc-1"),
        schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: ["14:00"] },
        basePriceCents: 49900, priceVariations: [], extraGuestPriceCents: 5000,
      };
      await repo.saveOffering(base); // no per-kind config → code defaults apply
      const got = (await repo.getOffering(base.id))!;
      expect("gratuityKinds" in got).toBe(false); // omitted, not null
      const kinds = [
        { kind: "pre" as const, tiersBps: [1500, 2000, 2500], defaultBps: 2000, required: true },
        { kind: "post" as const, tiersBps: [1500, 2000, 2500], defaultBps: 2000, required: false },
      ];
      await repo.saveOffering({ ...base, gratuityKinds: kinds });
      expect((await repo.getOffering(base.id))!.gratuityKinds).toEqual(kinds);
    });

    it("catalog: Offering 12.8 display/config fields round-trip present and absent", async () => {
      await saveCatalogParents();
      const base: Offering = {
        id: asId<"OfferingId">("off-cfg"), tenantId: TENANT, name: "Configured", status: "draft",
        vesselIds: [VESSEL], locationId: asId<"LocationId">("loc-1"),
        schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: ["14:00"] },
        basePriceCents: 49900, priceVariations: [], extraGuestPriceCents: 5000,
      };
      await repo.saveOffering(base); // none of the optionals set
      const bare = (await repo.getOffering(base.id))!;
      for (const k of ["description", "tripLengthMinutes", "holdMinutes", "arriveBeforeMinutes", "addOnIds"]) {
        expect(k in bare).toBe(false); // omitted, not null
      }
      const full: Offering = {
        ...base,
        description: "**NO Pedaling Required** — party pontoons.",
        tripLengthMinutes: 100,
        holdMinutes: 100,
        arriveBeforeMinutes: 15,
        addOnIds: [asId<"AddOnId">("addon-flex"), asId<"AddOnId">("addon-hour")],
      };
      await repo.saveOffering(full);
      expect(await repo.getOffering(base.id)).toEqual(full);
      // clearing back to unset round-trips as absent again (upsert writes null)
      await repo.saveOffering(base);
      expect("addOnIds" in (await repo.getOffering(base.id))!).toBe(false);
    });

    it("add-on: round-trip incl. global required/active; upsert updates (#491)", async () => {
      const addOn: AddOn = {
        id: asId<"AddOnId">("addon-1"),
        tenantId: TENANT,
        label: "Extra hour",
        type: "flat",
        amountCents: 15000,
        required: false,
        active: true,
      };
      await repo.saveAddOn(addOn);
      expect(await repo.getAddOn(addOn.id)).toEqual(addOn);
      // Soft-retire + relabel is an upsert, not an insert.
      await repo.saveAddOn({ ...addOn, label: "Bonus hour", active: false });
      const updated = await repo.getAddOn(addOn.id);
      expect(updated).toMatchObject({ label: "Bonus hour", active: false });
      expect(await repo.listAddOns()).toHaveLength(1);
      expect(await repo.getAddOn(asId<"AddOnId">("addon-none"))).toBeNull();
    });

    // ── Customers (12.12b, DEC-132 / DEC-131) ─────────────────────────────────
    const customer = (over: Partial<Customer> = {}): Customer => ({
      id: asId<"CustomerId">("cust-1"),
      displayCode: "C-K7X3P9",
      name: "Jordan Ellis",
      phoneE164: "+12165550148",
      createdAt: "2026-07-22T12:00:00.000Z",
      active: true,
      ...over,
    });

    it("customer: round-trips incl. optional email/notes present and absent", async () => {
      const bare = customer();
      await repo.saveCustomer(bare);
      expect(await repo.getCustomer(bare.id)).toEqual(bare);
      // Optionals absent stay ABSENT, not null (exactOptionalPropertyTypes contract).
      const got = (await repo.getCustomer(bare.id))!;
      expect("email" in got).toBe(false);
      expect("notes" in got).toBe(false);

      const full = customer({ email: "jordan@example.com", notes: "Repeat guest" });
      await repo.saveCustomer(full);
      expect(await repo.getCustomer(full.id)).toEqual(full);
      expect(await repo.getCustomer(asId<"CustomerId">("cust-none"))).toBeNull();
    });

    it("customer: soft-retire is an upsert, never a delete", async () => {
      await repo.saveCustomer(customer());
      await repo.saveCustomer(customer({ active: false, name: "Jordan E." }));
      expect(await repo.getCustomer(asId<"CustomerId">("cust-1"))).toMatchObject({
        active: false,
        name: "Jordan E.",
      });
      expect(await repo.listCustomers()).toHaveLength(1);
    });

    it("customer: looked up by canonical phone and by display code", async () => {
      await repo.saveCustomer(customer());
      expect((await repo.getCustomerByPhone("+12165550148"))?.id).toBe("cust-1");
      expect((await repo.getCustomerByCode("C-K7X3P9"))?.id).toBe("cust-1");
      // Lookups are exact — canonicalization is the caller's job, not the adapter's.
      expect(await repo.getCustomerByPhone("2165550148")).toBeNull();
      expect(await repo.getCustomerByCode("c-k7x3p9")).toBeNull();
      expect(await repo.getCustomerByPhone("+12165550000")).toBeNull();
    });

    it("getOrCreateCustomerByPhone: creates once, then returns the SAME customer", async () => {
      const first = await repo.getOrCreateCustomerByPhone(customer());
      expect(first.created).toBe(true);

      // Same phone, different id/name/code — the phone wins; nothing is inserted or updated.
      const second = await repo.getOrCreateCustomerByPhone(
        customer({ id: asId<"CustomerId">("cust-2"), displayCode: "C-ZZZZZZ", name: "J. Ellis" }),
      );
      expect(second.created).toBe(false);
      expect(second.customer.id).toBe("cust-1");
      expect(second.customer.name).toBe("Jordan Ellis"); // NOT overwritten by the candidate
      expect(await repo.listCustomers()).toHaveLength(1);
    });

    it("getOrCreateCustomerByPhone: a different phone creates a second customer", async () => {
      await repo.getOrCreateCustomerByPhone(customer());
      const other = await repo.getOrCreateCustomerByPhone(
        customer({
          id: asId<"CustomerId">("cust-2"),
          displayCode: "C-AAAAAA",
          phoneE164: "+14405550102",
          name: "Dana Whit",
        }),
      );
      expect(other.created).toBe(true);
      expect(await repo.listCustomers()).toHaveLength(2);
    });

    it("reservation: cancelledBy round-trips present and absent (#724)", async () => {
      // Parity with `customerId` below: both adapters must agree that an unset optional is
      // ABSENT rather than null. The Postgres suite proves the column/bind/mapping separately;
      // this is the shared-behaviour half, so the in-memory double cannot drift.
      const cancelled = reservation({
        id: asId<"ReservationId">("resv-cancelled-by"),
        status: "cancelled",
        cancelledBy: "operator",
      });
      const live = reservation({ id: asId<"ReservationId">("resv-still-live") });
      await repo.saveReservation(cancelled);
      await repo.saveReservation(live);

      expect((await repo.getReservation(cancelled.id))!.cancelledBy).toBe("operator");
      // A live booking has no answer — absent, not null, and not a default.
      expect("cancelledBy" in (await repo.getReservation(live.id))!).toBe(false);
    });

    it("reservation: customerId round-trips present and absent, and lists per customer", async () => {
      await repo.saveCustomer(customer());
      const linked = reservation({
        id: asId<"ReservationId">("resv-linked"),
        customerId: asId<"CustomerId">("cust-1"),
      });
      const unlinked = reservation({ id: asId<"ReservationId">("resv-unlinked") });
      await repo.saveReservation(linked);
      await repo.saveReservation(unlinked);

      expect((await repo.getReservation(linked.id))!.customerId).toBe("cust-1");
      // Unlinked is ABSENT, not null — historical rows stay unlinked forever (DEC-132).
      expect("customerId" in (await repo.getReservation(unlinked.id))!).toBe(false);

      const history = await repo.listReservationsForCustomer(asId<"CustomerId">("cust-1"));
      expect(history.map((r) => String(r.id))).toEqual(["resv-linked"]);
      expect(await repo.listReservationsForCustomer(asId<"CustomerId">("cust-none"))).toEqual([]);
    });

    // ── Booking codes (#741, DEC-154) ─────────────────────────────────────────
    // The FK means every code here needs its reservation saved first — in Postgres an orphan
    // insert fails, and writing these tests against the double alone would hide that.
    const bookingCode = (over: Partial<BookingCode> = {}): BookingCode => ({
      code: "K3F9QZ2MX7RN4P",
      reservationId: asId<"ReservationId">("resv-coded"),
      createdAt: "2026-08-14T12:00:00.000Z",
      ...over,
    });

    it("booking code: round-trips, optionals absent stay absent", async () => {
      await repo.saveReservation(reservation({ id: asId<"ReservationId">("resv-coded") }));
      const row = bookingCode();
      await repo.saveBookingCode(row);

      const got = (await repo.getBookingCode(row.code))!;
      expect(got).toEqual(row);
      expect("expiresAt" in got).toBe(false);
      expect("revokedAt" in got).toBe(false);
      expect(await repo.getBookingCode("NOTAREALCODE00")).toBeNull();
    });

    it("booking code: a duplicate code THROWS — the mint retries, it never overwrites", async () => {
      // The behaviour `ensureBookingCode`'s retry loop is built on, and the reason the in-memory
      // double enforces this one constraint: an upsert would repoint a live customer link at a
      // different booking.
      await repo.saveReservation(reservation({ id: asId<"ReservationId">("resv-coded") }));
      await repo.saveReservation(reservation({ id: asId<"ReservationId">("resv-other") }));
      await repo.saveBookingCode(bookingCode());
      await expect(
        repo.saveBookingCode(bookingCode({ reservationId: asId<"ReservationId">("resv-other") })),
      ).rejects.toThrow();
      // The original still points where it did.
      expect((await repo.getBookingCode("K3F9QZ2MX7RN4P"))!.reservationId).toBe("resv-coded");
    });

    it("booking code: lists every code for a reservation, newest first", async () => {
      await repo.saveReservation(reservation({ id: asId<"ReservationId">("resv-coded") }));
      await repo.saveReservation(reservation({ id: asId<"ReservationId">("resv-other") }));
      await repo.saveBookingCode(bookingCode({ code: "AAAAAAAAAAAAAA", createdAt: "2026-08-01T00:00:00.000Z" }));
      await repo.saveBookingCode(bookingCode({ code: "BBBBBBBBBBBBBB", createdAt: "2026-08-09T00:00:00.000Z" }));
      await repo.saveBookingCode(
        bookingCode({ code: "CCCCCCCCCCCCCC", reservationId: asId<"ReservationId">("resv-other") }),
      );

      const mine = await repo.listBookingCodesForReservation(asId<"ReservationId">("resv-coded"));
      expect(mine.map((c) => c.code)).toEqual(["BBBBBBBBBBBBBB", "AAAAAAAAAAAAAA"]);
      expect(await repo.listBookingCodesForReservation(asId<"ReservationId">("resv-none"))).toEqual([]);
    });

    it("booking code: revoke stamps once and is idempotent, and revoked rows still RESOLVE", async () => {
      await repo.saveReservation(reservation({ id: asId<"ReservationId">("resv-coded") }));
      await repo.saveBookingCode(bookingCode());

      await repo.revokeBookingCode("K3F9QZ2MX7RN4P", "2026-08-14T13:00:00.000Z");
      // Still readable — the caller needs the row to tell the customer "this link was replaced"
      // instead of the generic "never existed". Filtering it out here would erase that difference.
      const revoked = (await repo.getBookingCode("K3F9QZ2MX7RN4P"))!;
      expect(revoked.revokedAt).toBe("2026-08-14T13:00:00.000Z");

      // A second revoke keeps the FIRST timestamp — when the link died is the fact support needs.
      await repo.revokeBookingCode("K3F9QZ2MX7RN4P", "2026-08-20T00:00:00.000Z");
      expect((await repo.getBookingCode("K3F9QZ2MX7RN4P"))!.revokedAt).toBe("2026-08-14T13:00:00.000Z");

      // An unknown code is a no-op, not an error.
      await expect(repo.revokeBookingCode("NOTAREALCODE00", "2026-08-14T13:00:00.000Z")).resolves.toBeUndefined();
    });

    it("booking code: expiresAt round-trips when set", async () => {
      await repo.saveReservation(reservation({ id: asId<"ReservationId">("resv-coded") }));
      await repo.saveBookingCode(bookingCode({ expiresAt: "2026-09-01T00:00:00.000Z" }));
      expect((await repo.getBookingCode("K3F9QZ2MX7RN4P"))!.expiresAt).toBe("2026-09-01T00:00:00.000Z");
    });

    it("catalog: Offering includedGuestCount round-trips present and absent (12.8)", async () => {
      await saveCatalogParents();
      const base: Offering = {
        id: asId<"OfferingId">("off-inc"), tenantId: TENANT, name: "Counted", status: "live",
        vesselIds: [VESSEL], locationId: asId<"LocationId">("loc-1"),
        schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: ["14:00"] },
        basePriceCents: 49900, priceVariations: [], extraGuestPriceCents: 5000,
      };
      await repo.saveOffering(base); // no includedGuestCount
      expect("includedGuestCount" in (await repo.getOffering(base.id))!).toBe(false); // omitted, not null
      await repo.saveOffering({ ...base, includedGuestCount: 8 });
      expect((await repo.getOffering(base.id))!.includedGuestCount).toBe(8);
      // clearing it back to unset round-trips as absent again
      await repo.saveOffering(base);
      expect("includedGuestCount" in (await repo.getOffering(base.id))!).toBe(false);
    });

    // ── Gratuity (DEC-124, 12.3) ──────────────────────────────────────────────
    const gratuity = (over: Partial<Gratuity> = {}): Gratuity => ({
      id: asId<"GratuityId">("grat_pre_cs1"),
      eventId: EVENT,
      reservationId: asId<"ReservationId">("resv-1"),
      kind: "pre",
      amountCents: 9980,
      bps: 2000,
      stripeCheckoutSessionId: "cs1",
      createdAt: "2026-07-04T12:00:00.000Z",
      ...over,
    });

    it("gratuity: save + list by event + list all; deterministic id is idempotent", async () => {
      // Parents for gratuity's FKs on event_id + reservation_id (DEC-131).
      await repo.saveEvent(event());
      await repo.saveReservation(reservation());
      expect(await repo.listAllGratuities()).toEqual([]);
      await repo.saveGratuity(gratuity());
      await repo.saveGratuity(gratuity()); // same id ⇒ no duplicate
      expect(await repo.listGratuitiesForEvent(EVENT)).toEqual([gratuity()]);
      expect(await repo.listAllGratuities()).toHaveLength(1);
      // a post gratuity on the same event is a distinct row (no bps — free amount)
      const postGrat: Gratuity = {
        id: asId<"GratuityId">("grat_post_cs2"), eventId: EVENT,
        reservationId: asId<"ReservationId">("resv-1"), kind: "post",
        amountCents: 5000, stripeCheckoutSessionId: "cs2", createdAt: "2026-07-04T13:00:00.000Z",
      };
      await repo.saveGratuity(postGrat);
      expect(await repo.listGratuitiesForEvent(EVENT)).toHaveLength(2);
      // bps omitted (post) stays omitted, not null
      const post = (await repo.listGratuitiesForEvent(EVENT)).find((g) => g.kind === "post")!;
      expect("bps" in post).toBe(false);
      // a gratuity on a different event isn't returned (the other event must exist — DEC-131)
      await repo.saveEvent(event({ id: asId<"EventId">("evt-other"), time: "16:00" }));
      await repo.saveGratuity(gratuity({ id: asId<"GratuityId">("grat_pre_cs3"), eventId: asId<"EventId">("evt-other") }));
      expect(await repo.listGratuitiesForEvent(EVENT)).toHaveLength(2);
      expect(await repo.listAllGratuities()).toHaveLength(3);
    });

    // ── Payments (DEC-107) ────────────────────────────────────────────────────
    const payment = (over: Partial<Payment> = {}): Payment => ({
      id: asId<"PaymentId">("pay-1"),
      reservationId: asId<"ReservationId">("resv-1"),
      method: "stripe",
      kind: "full",
      amountCents: 53521,
      taxCents: 3621,
      currency: "usd",
      status: "succeeded",
      createdAt: "2026-07-12T00:00:00.000Z",
      stripeCheckoutSessionId: "cs_test_1",
      ...over,
    });

    it("payment config: defaults when unset; per-field override round-trips (DEC-107)", async () => {
      // `full` is the default since issue #617: an unset environment must charge the whole fare,
      // not 25% with the remaining 75% owed to a collection mechanism that does not exist.
      expect(await repo.getPaymentConfig()).toEqual({
        depositMode: "full",
        depositPercent: 25,
        taxRateBps: 725,
        serviceFeeBps: 300,
        balanceDueDaysBeforeEvent: 14,
      });
      await repo.setPaymentConfig({ depositMode: "deposit", taxRateBps: 800 }, "2026-07-12T00:00:00.000Z");
      const cfg = await repo.getPaymentConfig();
      // Deposit mode is still fully supported — it is opt-IN now rather than inherited.
      expect(cfg.depositMode).toBe("deposit");
      expect(cfg.taxRateBps).toBe(800);
      expect(cfg.depositPercent).toBe(25); // untouched field keeps its default
    });

    it("payments: save/get/listForReservation; idempotent upsert on id; optional stripe ids", async () => {
      // Parent for payments' FK on reservation_id (DEC-131).
      await repo.saveReservation(reservation());
      await repo.savePayment(payment());
      const got = await repo.getPayment(asId<"PaymentId">("pay-1"));
      expect(got).toEqual(payment());
      // idempotent: same id again doesn't duplicate
      await repo.savePayment(payment({ amountCents: 53521 }));
      expect(await repo.listPaymentsForReservation(asId<"ReservationId">("resv-1"))).toHaveLength(1);
      // a balance payment for the same reservation is a second row
      await repo.savePayment(payment({ id: asId<"PaymentId">("pay-2"), kind: "balance", stripeCheckoutSessionId: "cs_test_2" }));
      expect(await repo.listPaymentsForReservation(asId<"ReservationId">("resv-1"))).toHaveLength(2);
      // listAllPayments spans reservations — the purchases list's rollup read (12.12a).
      expect(await repo.listAllPayments()).toHaveLength(2);
      // optional stripePaymentIntentId omitted stays omitted (not undefined)
      expect("stripePaymentIntentId" in got!).toBe(false);
      // gratuityCents (DEC-124, 12.3): absent stays omitted; present round-trips
      expect("gratuityCents" in got!).toBe(false);
      await repo.savePayment(payment({ id: asId<"PaymentId">("pay-3"), gratuityCents: 9980, stripeCheckoutSessionId: "cs_test_3" }));
      expect((await repo.getPayment(asId<"PaymentId">("pay-3")))!.gratuityCents).toBe(9980);
      // serviceFeeCents (DEC-134, 12.5): absent stays omitted; present round-trips
      expect("serviceFeeCents" in got!).toBe(false);
      await repo.savePayment(payment({ id: asId<"PaymentId">("pay-4"), serviceFeeCents: 1497, stripeCheckoutSessionId: "cs_test_4" }));
      expect((await repo.getPayment(asId<"PaymentId">("pay-4")))!.serviceFeeCents).toBe(1497);
      // receiptUrl (#679): absent stays omitted; present round-trips. Absent is the normal
      // state for every payment written before #679 and for any whose lookup failed, so the
      // omitted case is the one the guest page actually branches on.
      expect("receiptUrl" in got!).toBe(false);
      await repo.savePayment(
        payment({
          id: asId<"PaymentId">("pay-5"),
          stripeCheckoutSessionId: "cs_test_5",
          receiptUrl: "https://pay.stripe.com/receipts/abc123",
        }),
      );
      expect((await repo.getPayment(asId<"PaymentId">("pay-5")))!.receiptUrl).toBe(
        "https://pay.stripe.com/receipts/abc123",
      );
    });

    it("cancelEventIfUnclaimed: releases an unclaimed Muster slot, refuses a claimed one (#616)", async () => {
      // Both adapters must agree, because the two express it differently — Postgres under a row
      // lock plus the hull-day advisory lock, in-memory as a straight-line check — and a
      // divergence means a cancel releases a paying customer's boat on exactly one of them.
      const evt = {
        id: asId<"EventId">("evt-cancel-1"),
        vesselId: asId<"VesselId">("v-1"),
        date: "2026-08-20",
        time: "17:00",
        capacity: 12,
        status: "scheduled" as const,
        source: "muster" as const,
      };
      await repo.saveEvent(evt);
      await repo.saveReservation({
        id: asId<"ReservationId">("resv-holds-it"),
        eventId: evt.id,
        source: "muster",
        customerName: "Ann",
        partySize: 4,
        status: "booked",
      });

      // Claimed ⇒ refused, and the event is untouched.
      expect(await repo.cancelEventIfUnclaimed(evt.id)).toBe(false);
      expect((await repo.getEvent(evt.id))?.status).toBe("scheduled");

      // Released once the claim goes away.
      await repo.saveReservation({
        id: asId<"ReservationId">("resv-holds-it"),
        eventId: evt.id,
        source: "muster",
        customerName: "Ann",
        partySize: 4,
        status: "cancelled",
      });
      expect(await repo.cancelEventIfUnclaimed(evt.id)).toBe(true);
      expect((await repo.getEvent(evt.id))?.status).toBe("cancelled");

      // Idempotent: a second call reports it did nothing rather than re-cancelling.
      expect(await repo.cancelEventIfUnclaimed(evt.id)).toBe(false);
      // Unknown id is `false`, never a throw — the cancel path must not 500 on a stale link.
      expect(await repo.cancelEventIfUnclaimed(asId<"EventId">("evt-nope"))).toBe(false);
    });

    it("resurrecting a cancelled slot re-freezes price and duration IDENTICALLY on both adapters (#616)", async () => {
      // The divergence code review caught: postgres writes `price`/`duration_minutes` from
      // `?? null` unconditionally, so a candidate carrying neither NULLS them. An in-memory
      // version that only overwrote when defined kept the DEAD booking's numbers — a resurrected
      // slot priced at the previous customer's fare, on one adapter only.
      const slot = { vesselId: asId<"VesselId">("v-res"), date: "2026-08-21", time: "13:30" };
      const first = {
        id: eventIdForSlot(slot.vesselId, slot.date, slot.time),
        ...slot,
        capacity: 12,
        status: "scheduled" as const,
        source: "muster" as const,
        price: 50000,
        durationMinutes: 100,
      };
      const won = await repo.saveBookingIfSlotFree(first, {
        id: asId<"ReservationId">("resv-res-1"),
        eventId: first.id,
        source: "muster",
        customerName: "Ann",
        partySize: 4,
        status: "booked",
      });
      expect(won.result).toBe("won");

      await repo.saveReservation({
        id: asId<"ReservationId">("resv-res-1"),
        eventId: first.id,
        source: "muster",
        customerName: "Ann",
        partySize: 4,
        status: "cancelled",
      });
      expect(await repo.cancelEventIfUnclaimed(first.id)).toBe(true);

      // Re-book with NO price and NO duration — both must come back absent, not inherited.
      const again = await repo.saveBookingIfSlotFree(
        { id: first.id, ...slot, capacity: 8, status: "scheduled", source: "muster" },
        {
          id: asId<"ReservationId">("resv-res-2"),
          eventId: first.id,
          source: "muster",
          customerName: "Ben",
          partySize: 2,
          status: "booked",
        },
      );
      expect(again.result).toBe("won");
      const revived = await repo.getEvent(first.id);
      expect(revived?.status).toBe("scheduled");
      expect(revived?.capacity).toBe(8);
      expect(revived?.price).toBeUndefined();
      expect(revived?.durationMinutes).toBeUndefined();
    });

    it("getPaymentByIntentId: finds the row a refund event names, or null (#616)", async () => {
      // The `charge.refunded` handler's only handle on the ledger — a Stripe refund event
      // carries the PaymentIntent, never Muster's payment id. Contract-tested because the two
      // implementations diverge in shape (indexed SQL lookup vs a linear find over a Map) and
      // a mismatch means a dashboard refund reconciles on one adapter and silently doesn't on
      // the other, which is the exact failure #616 exists to remove.
      await repo.saveReservation(reservation());
      await repo.savePayment(payment({ stripePaymentIntentId: "pi_live_1" }));
      // A second row with NO intent id — it must never be returned as a false match for a
      // lookup, and it must not throw the linear scan off.
      await repo.savePayment(payment({ id: asId<"PaymentId">("pay-2"), stripeCheckoutSessionId: "cs_test_2" }));

      expect(await repo.getPaymentByIntentId("pi_live_1")).toMatchObject({ id: "pay-1" });
      expect(await repo.getPaymentByIntentId("pi_never_seen")).toBeNull();
    });

    it("markPaymentRefunded: derives status from the row's own amount, accumulates, never rewinds (#522)", async () => {
      // The one sanctioned mutation of an otherwise insert-only row. Contract-tested because
      // the two implementations express the same rule differently — postgres does it in SQL
      // with `greatest(coalesce(...))`, in-memory with `Math.max` — and a divergence here
      // means refunded money is misreported on exactly one of the two.
      await repo.saveReservation(reservation());
      await repo.savePayment(payment()); // amountCents 53520 per the fixture
      const id = asId<"PaymentId">("pay-1");
      const amount = (await repo.getPayment(id))!.amountCents;

      // Partial: status reflects that money is still held.
      await repo.markPaymentRefunded(id, 1000);
      expect(await repo.getPayment(id)).toMatchObject({
        status: "partially_refunded",
        refundedCents: 1000,
      });

      // A second partial accumulates to the larger total, not a replacement of the smaller.
      await repo.markPaymentRefunded(id, 2500);
      expect((await repo.getPayment(id))!.refundedCents).toBe(2500);

      // A redelivered SMALLER refund can't rewind the total or downgrade the status.
      await repo.markPaymentRefunded(id, amount);
      await repo.markPaymentRefunded(id, 1);
      expect(await repo.getPayment(id)).toMatchObject({ status: "refunded", refundedCents: amount });

      // Nothing else on the row moved.
      expect((await repo.getPayment(id))!.amountCents).toBe(amount);
      // Unknown id is a silent no-op, not a throw — the webhook must not 500 over it.
      await repo.markPaymentRefunded(asId<"PaymentId">("pay-nope"), 100);
    });

    it("markPaymentDisputed: moves both ways, never over a refund, no-ops on an unknown id (issue #723)", async () => {
      // The second sanctioned mutation, contract-tested for the same reason as the first: the
      // two implementations express one rule in different languages — postgres with a
      // `status not in (...)` predicate, in-memory with an early return — and a divergence
      // means a chargeback is visible on exactly one of the two.
      await repo.saveReservation(reservation());
      await repo.savePayment(payment());
      const id = asId<"PaymentId">("pay-1");

      await repo.markPaymentDisputed(id, "disputed");
      expect(await repo.getPayment(id)).toMatchObject({ status: "disputed" });

      // Redelivery of the same event is the same write, not an error or an accumulation.
      await repo.markPaymentDisputed(id, "disputed");
      expect(await repo.getPayment(id)).toMatchObject({ status: "disputed" });

      // A dispute legitimately moves BACKWARDS when we win — unlike a refund total, which is
      // monotonic. The row becomes ordinary revenue again.
      await repo.markPaymentDisputed(id, "succeeded");
      expect(await repo.getPayment(id)).toMatchObject({ status: "succeeded" });

      await repo.markPaymentDisputed(id, "dispute_lost");
      expect(await repo.getPayment(id)).toMatchObject({ status: "dispute_lost" });

      // ...but a LOST dispute is terminal. Stripe does not guarantee delivery order, so a stale
      // `charge.dispute.updated` can land after the `closed` that resolved it — and the dispute
      // being closed, nothing further will ever arrive to correct the row.
      await repo.markPaymentDisputed(id, "disputed");
      expect(await repo.getPayment(id)).toMatchObject({ status: "dispute_lost" });

      // A REFUNDED row is not overwritten: the refund status carries `refundedCents`, which a
      // dispute status would erase, and both already count as not-paid. Refund detail wins.
      await repo.savePayment(
        payment({ id: asId<"PaymentId">("pay-refunded"), stripePaymentIntentId: "pi_refunded" }),
      );
      const refunded = asId<"PaymentId">("pay-refunded");
      await repo.markPaymentRefunded(refunded, 1000);
      await repo.markPaymentDisputed(refunded, "disputed");
      expect(await repo.getPayment(refunded)).toMatchObject({
        status: "partially_refunded",
        refundedCents: 1000,
      });

      // Unknown id is a silent no-op, not a throw — the webhook must not 500 over it.
      await repo.markPaymentDisputed(asId<"PaymentId">("pay-nope"), "disputed");
    });

    it("reservation catalog: a fresh repo reads empty (DEC-125)", async () => {
      // Empty on both adapters before anything is written (write round-trip is covered by
      // "catalog: offering / location / block write + read round-trip" above, added in 12.1a).
      expect(await repo.listOfferings()).toEqual([]);
      expect(await repo.getOffering(asId<"OfferingId">("off-none"))).toBeNull();
      expect(await repo.listLocations()).toEqual([]);
      expect(await repo.getLocation(asId<"LocationId">("loc-none"))).toBeNull();
      expect(await repo.listBlocks()).toEqual([]);
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

    it("shifts: eventIds round-trip; splitCutTime optional", async () => {
      await repo.saveShift(shift());
      const got = await repo.getShift(SHIFT);
      expect(got).toEqual(shift());
      expect("splitCutTime" in got!).toBe(false);
      // splitCutTime round-trips (DEC-083) and clears back to absent (merge/collapse).
      await repo.saveShift(shift({ splitCutTime: "14:00" }));
      expect(await repo.getShift(SHIFT)).toMatchObject({ splitCutTime: "14:00" });
      await repo.saveShift(shift());
      expect("splitCutTime" in (await repo.getShift(SHIFT))!).toBe(false);
    });

    it("shifts: earliestStart round-trips, and ABSENT stays absent (#740)", async () => {
      // The change-detection watermark. Two properties, both load-bearing:
      //
      //  - A stored instant must come back byte-identical, or every form after a restart
      //    compares a good value against a mangled one and announces a retime that never
      //    happened — to every crew member on the boat, at whatever hour the tick runs.
      //  - ABSENT must stay ABSENT. `form-shifts.ts` reads absent as "unknown" and refuses
      //    to call it a change; if a round trip turned it into any present value, the first
      //    form after deploy would compare that against a real instant and fire a
      //    fleet-wide false retime.
      //
      // The field is `string | undefined` with NO null case, so there is exactly one
      // "unknown" and one representation of it. An earlier version of this comment claimed
      // to prove that absent and `null` stay distinct across both adapters — it did not
      // test that, and postgres cannot represent it (`opt()` maps SQL NULL to an absent
      // key). Narrowing the type removed the distinction rather than leaving a claim the
      // test didn't back (@code-review).
      await repo.saveShift(shift());
      expect("earliestStart" in (await repo.getShift(SHIFT))!).toBe(false);

      await repo.saveShift(shift({ earliestStart: "2026-05-16T19:30:00.000Z" }));
      expect(await repo.getShift(SHIFT)).toMatchObject({
        earliestStart: "2026-05-16T19:30:00.000Z",
      });

      // And it clears back to absent when a later form has nothing to record.
      await repo.saveShift(shift());
      expect("earliestStart" in (await repo.getShift(SHIFT))!).toBe(false);
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

    it("seats: acquiredVia provenance round-trips and is optional (#196)", async () => {
      await repo.saveShift(shift());
      // Absent → stays absent (exactOptionalPropertyTypes; toEqual(seat()) asserts it).
      await repo.saveSeat(seat());
      expect((await repo.getSeat(SEAT))?.acquiredVia).toBeUndefined();
      // Set on saveSeat → round-trips.
      const placed = seat({ state: "Confirmed", assignedCrewMemberId: CREW, acquiredVia: "operator" });
      await repo.saveSeat(placed);
      expect(await repo.getSeat(SEAT)).toEqual(placed);
      // Preserved through the CAS write (claimSeat sets it this way).
      await repo.saveSeat(seat()); // reset to Open
      const claimed = seat({ state: "Confirmed", assignedCrewMemberId: CREW, acquiredVia: "self_claim" });
      expect(await repo.saveSeatIfState(claimed, "Open")).toBe(true);
      expect((await repo.getSeat(SEAT))?.acquiredVia).toBe("self_claim");
    });

    it("seats: override flag round-trips and is optional (8.5)", async () => {
      await repo.saveShift(shift());
      // Absent on a derived seat → stays absent (exactOptionalPropertyTypes).
      await repo.saveSeat(seat());
      expect((await repo.getSeat(SEAT))?.override).toBeUndefined();
      // An operator-added override seat round-trips true.
      const added = seat({ kind: "supernumerary", override: true });
      await repo.saveSeat(added);
      expect(await repo.getSeat(SEAT)).toEqual(added);
      // The CAS write preserves the override flag (both adapters — the parity
      // invariant every claim relies on, since callers spread the repo-read seat).
      await repo.saveSeat(seat({ override: true })); // required, Open, override
      const claimed = seat({ state: "Claimed", assignedCrewMemberId: CREW, override: true });
      expect(await repo.saveSeatIfState(claimed, "Open")).toBe(true);
      expect((await repo.getSeat(SEAT))?.override).toBe(true);
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

    it("removeShift: deletes the row; absent-id is a no-op (DEC-083 merge teardown)", async () => {
      await repo.saveShift(shift());
      await repo.removeShift(SHIFT);
      expect(await repo.getShift(SHIFT)).toBeNull();
      expect(await repo.listShifts()).toHaveLength(0);
      await repo.removeShift(SHIFT); // idempotent — already gone
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

    it("sms consent: append-only, insertion order, filtered by crew; null phone round-trips", async () => {
      const consent = (id: string, over: Partial<SmsConsent> = {}): SmsConsent => ({
        id: asId<"SmsConsentId">(id),
        crewMemberId: CREW,
        email: "a@x.io",
        phone: "+15551234567",
        disclosureVersion: "v1",
        disclosureText: "I agree to receive SMS …",
        consentedAt: "2026-07-03T04:00:00.000Z",
        ...over,
      });
      await repo.recordSmsConsent(consent("con-1"));
      await repo.recordSmsConsent(consent("con-2", { phone: null }));
      await repo.recordSmsConsent(consent("con-3", { crewMemberId: CREW_B }));
      const mine = await repo.listSmsConsentsForCrew(CREW);
      expect(mine.map((c) => c.id)).toEqual(["con-1", "con-2"]); // order preserved, crew-b excluded
      expect(mine[1]!.phone).toBeNull(); // null phone round-trips
      expect(mine[0]!.disclosureVersion).toBe("v1");
    });

    it("guest contacts: upsert-latest by reservation, filtered by shift", async () => {
      const contact = (over: Partial<GuestContact> = {}): GuestContact => ({
        reservationId: asId<"ReservationId">("resv-1"),
        shiftId: SHIFT,
        contactedBy: "crew-a",
        contactedByName: "Quint",
        contactedAt: "2026-07-10T14:00:00.000Z",
        ...over,
      });
      await repo.recordGuestContact(contact());
      // Re-texting the same booking overwrites (latest wins) — not a second row.
      await repo.recordGuestContact(
        contact({ contactedBy: "crew-b", contactedByName: "Hooper", contactedAt: "2026-07-10T15:00:00.000Z" }),
      );
      // A different booking on the same shift, and one on another shift.
      await repo.recordGuestContact(contact({ reservationId: asId<"ReservationId">("resv-2") }));
      await repo.recordGuestContact(
        contact({ reservationId: asId<"ReservationId">("resv-3"), shiftId: asId<"ShiftId">("shift-2") }),
      );

      const onShift = await repo.listGuestContactsForShift(SHIFT);
      expect(onShift.map((c) => String(c.reservationId)).sort()).toEqual(["resv-1", "resv-2"]);
      const r1 = onShift.find((c) => String(c.reservationId) === "resv-1")!;
      expect(r1.contactedByName).toBe("Hooper"); // the later text won
      expect(r1.contactedAt).toBe("2026-07-10T15:00:00.000Z");
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

    it("admins: round-trip; lookup by id and by handle; upsert (DEC-092)", async () => {
      await repo.saveAdmin(admin());
      expect(await repo.getAdmin(CREW)).toEqual(admin());
      expect(await repo.getAdminByHandle("cap")).toEqual(admin());
      expect(await repo.getAdmin("no-such-id")).toBeNull();
      expect(await repo.getAdminByHandle("no-such-handle")).toBeNull();
      // Upsert by id, not a second row.
      await repo.saveAdmin(admin({ name: "Captain Ahab" }));
      expect((await repo.getAdmin(CREW))!.name).toBe("Captain Ahab");
      expect(await repo.listAdmins()).toHaveLength(1);
    });

    it("admins: deactivation round-trips the flag + timestamp (the revoke lever)", async () => {
      await repo.saveAdmin(admin());
      expect((await repo.getAdmin(CREW))!.active).toBe(true);
      await repo.saveAdmin(
        admin({ active: false, deactivatedAt: "2026-07-02T09:00:00.000Z" }),
      );
      const got = (await repo.getAdmin(CREW))!;
      expect(got.active).toBe(false);
      expect(got.deactivatedAt).toBe("2026-07-02T09:00:00.000Z");
      // A revoked admin still resolves by handle (mint refuses on the active check).
      expect((await repo.getAdminByHandle("cap"))!.active).toBe(false);
    });

    it("login codes: round-trip incl. consumedAt optional; keyed by subject (DEC-081)", async () => {
      await repo.saveLoginCode(loginCode()); // not yet consumed
      const got = await repo.getLoginCode("crew", CREW);
      expect(got).toEqual(loginCode());
      expect("consumedAt" in got!).toBe(false); // omitted, not undefined
      expect(await repo.getLoginCode("crew", "no-such-crew")).toBeNull();
      // Re-request upserts the single per-subject row, not a second one.
      await repo.saveLoginCode(loginCode({ codeHash: "code-hash-2" }));
      expect((await repo.getLoginCode("crew", CREW))!.codeHash).toBe("code-hash-2");
    });

    it("consumeLoginCodeIfUnused: consumes once, no-op when already spent", async () => {
      await repo.saveLoginCode(loginCode());
      const first = await repo.consumeLoginCodeIfUnused("crew", CREW, "2026-07-01T12:05:00.000Z");
      expect(first).toBe(true);
      expect((await repo.getLoginCode("crew", CREW))!.consumedAt).toBe(
        "2026-07-01T12:05:00.000Z",
      );
      const second = await repo.consumeLoginCodeIfUnused("crew", CREW, "2026-07-01T12:09:00.000Z");
      expect(second).toBe(false);
      expect((await repo.getLoginCode("crew", CREW))!.consumedAt).toBe(
        "2026-07-01T12:05:00.000Z",
      );
    });

    it("consumeLoginCodeIfUnused: false for an absent code; exactly one of two submits wins", async () => {
      expect(
        await repo.consumeLoginCodeIfUnused("crew", "ghost", "2026-07-01T12:05:00.000Z"),
      ).toBe(false);
      await repo.saveLoginCode(loginCode());
      const [a, b] = await Promise.all([
        repo.consumeLoginCodeIfUnused("crew", CREW, "2026-07-01T12:05:00.000Z"),
        repo.consumeLoginCodeIfUnused("crew", CREW, "2026-07-01T12:05:00.000Z"),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
    });

    it("claimLoginAttempt: increments + returns codeHash/expiresAt; null when absent/consumed", async () => {
      await repo.saveLoginCode(loginCode());
      const c1 = await repo.claimLoginAttempt("crew", CREW, 5, WIDE_WINDOW, WRONG_HASH);
      expect(c1).toMatchObject({ codeHash: "code-hash-1", attempts: 1 });
      expect(c1!.expiresAt).toBe("2026-07-01T12:10:00.000Z");
      expect((await repo.claimLoginAttempt("crew", CREW, 5, WIDE_WINDOW, WRONG_HASH))!.attempts).toBe(2);
      expect((await repo.getLoginCode("crew", CREW))!.attempts).toBe(2);
      // Absent → null; consumed → null (can't guess a spent code).
      expect(await repo.claimLoginAttempt("crew", "ghost", 5, WIDE_WINDOW, WRONG_HASH)).toBeNull();
      await repo.consumeLoginCodeIfUnused("crew", CREW, "2026-07-01T12:05:00.000Z");
      expect(await repo.claimLoginAttempt("crew", CREW, 5, WIDE_WINDOW, WRONG_HASH)).toBeNull();
    });

    it("claimLoginAttempt: the cap is atomic — concurrent claims can't exceed maxAttempts (#297)", async () => {
      await repo.saveLoginCode(loginCode());
      // 10 concurrent guesses against a max of 3 → exactly 3 non-null claims.
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          repo.claimLoginAttempt("crew", CREW, 3, WIDE_WINDOW, WRONG_HASH),
        ),
      );
      expect(results.filter((r) => r !== null)).toHaveLength(3);
      const after = (await repo.getLoginCode("crew", CREW))!;
      expect(after.attempts).toBe(3);
      // The WINDOW counter must survive the same race (DEC-142). The row starts with no
      // `failedSince`, so every concurrent claim sees a stale window — and an
      // implementation that decides staleness once, outside the row lock, leaves this at
      // 1 while `attempts` correctly reads 3. That asymmetry is the whole bug, and
      // asserting only `attempts` cannot see it.
      expect(after.failedInWindow).toBe(3);
      // Once at the cap, further claims stay null.
      expect(await repo.claimLoginAttempt("crew", CREW, 3, WIDE_WINDOW, WRONG_HASH)).toBeNull();
    });

    it("claimLoginAttempt: the failure window survives the re-mint that resets attempts (DEC-142, #522)", async () => {
      // The hole this closes: `attempts` caps guesses per CODE, and a re-mint upserts the
      // row with attempts=0 — so mint/guess/mint/guess ran forever. The window counter is
      // the per-SUBJECT bound, and the only reason it works is that saveLoginCode carries
      // it forward. Both adapters must agree, since one expresses it in SQL and one in JS.
      const window = { startsAt: "2026-07-01T00:00:00.000Z", now: "2026-07-01T12:00:00.000Z", max: 3 };
      await repo.saveLoginCode(loginCode());

      expect(await repo.claimLoginAttempt("crew", CREW, 5, window, WRONG_HASH)).not.toBeNull();
      expect((await repo.getLoginCode("crew", CREW))!.failedInWindow).toBe(1);

      // Re-mint: a fresh code, attempts back to 0 — the window must NOT follow it.
      await repo.saveLoginCode(loginCode({ codeHash: "code-hash-2", attempts: 0 }));
      expect((await repo.getLoginCode("crew", CREW))!.attempts).toBe(0);
      expect((await repo.getLoginCode("crew", CREW))!.failedInWindow).toBe(1);

      // Two more failures reach max=3, and the next claim is refused despite attempts=2.
      await repo.claimLoginAttempt("crew", CREW, 5, window, WRONG_HASH);
      await repo.claimLoginAttempt("crew", CREW, 5, window, WRONG_HASH);
      expect((await repo.getLoginCode("crew", CREW))!.failedInWindow).toBe(3);
      expect(await repo.claimLoginAttempt("crew", CREW, 5, window, WRONG_HASH)).toBeNull();
      // Re-minting does not buy a way out — that WAS the exploit.
      await repo.saveLoginCode(loginCode({ codeHash: "code-hash-3", attempts: 0 }));
      expect(await repo.claimLoginAttempt("crew", CREW, 5, window, WRONG_HASH)).toBeNull();

      // A window that has aged out restarts at 1 rather than staying locked.
      const later = { startsAt: "2026-07-02T12:00:00.000Z", now: "2026-07-03T12:00:00.000Z", max: 3 };
      expect(await repo.claimLoginAttempt("crew", CREW, 5, later, WRONG_HASH)).not.toBeNull();
      const rolled = (await repo.getLoginCode("crew", CREW))!;
      expect(rolled.failedInWindow).toBe(1);
      expect(rolled.failedSince).toBe(later.now);
    });

    it("claimLoginAttempt: a CORRECT code claims past the window cap and never advances it (#801)", async () => {
      // Both adapters must agree: the window gate applies to GUESSES, not to the code itself.
      await repo.saveLoginCode(loginCode()); // codeHash "code-hash-1"
      const window = { startsAt: "2026-07-01T00:00:00.000Z", now: "2026-07-01T12:00:00.000Z", max: 2 };

      // Burn the window to the cap with wrong guesses.
      await repo.claimLoginAttempt("crew", CREW, 5, window, WRONG_HASH);
      await repo.claimLoginAttempt("crew", CREW, 5, window, WRONG_HASH);
      expect((await repo.getLoginCode("crew", CREW))!.failedInWindow).toBe(2);

      // A WRONG guess at the cap is refused — brute force stays bounded.
      expect(await repo.claimLoginAttempt("crew", CREW, 5, window, WRONG_HASH)).toBeNull();

      // The CORRECT code claims anyway, and the window counter is UNTOUCHED (a success is not a
      // failure). Before #801 this returned null and the legitimate holder got locked out.
      expect(await repo.claimLoginAttempt("crew", CREW, 5, window, "code-hash-1"))
        .toMatchObject({ codeHash: "code-hash-1" });
      expect((await repo.getLoginCode("crew", CREW))!.failedInWindow).toBe(2);
    });

    it("claimLoginAttempt: a correct code is STILL refused once attempts hit the per-code cap (#801/DEC-081)", async () => {
      await repo.saveLoginCode(loginCode()); // codeHash "code-hash-1"
      // Spend the per-code ceiling with wrong guesses (window wide open, so only attempts binds).
      for (let i = 0; i < 3; i++) await repo.claimLoginAttempt("crew", CREW, 3, WIDE_WINDOW, WRONG_HASH);
      expect((await repo.getLoginCode("crew", CREW))!.attempts).toBe(3);
      // The correct code cannot revive a code already spent on `maxAttempts` guesses.
      expect(await repo.claimLoginAttempt("crew", CREW, 3, WIDE_WINDOW, "code-hash-1")).toBeNull();
    });

    it("calendar feeds: hash-lookup round-trip; one per crew (rotate replaces); revoke + touch (DEC-098)", async () => {
      await repo.saveCalendarFeed({
        crewMemberId: CREW,
        tokenHash: "hash-1",
        createdAt: "2026-07-01T12:00:00.000Z",
      });
      // Looked up BY hash (the route's path) and by crew (the UI's existence check).
      const byHash = await repo.getCalendarFeedByTokenHash("hash-1");
      expect(byHash).toEqual({
        crewMemberId: CREW,
        tokenHash: "hash-1",
        createdAt: "2026-07-01T12:00:00.000Z",
      });
      expect("lastPolledAt" in byHash!).toBe(false); // omitted, not undefined
      expect(await repo.getCalendarFeedForCrew(CREW)).toEqual(byHash);
      expect(await repo.getCalendarFeedByTokenHash("nope")).toBeNull();

      // Rotate: a fresh mint REPLACES the single per-crew row — old hash is dead.
      await repo.saveCalendarFeed({
        crewMemberId: CREW,
        tokenHash: "hash-2",
        createdAt: "2026-07-02T12:00:00.000Z",
      });
      expect(await repo.getCalendarFeedByTokenHash("hash-1")).toBeNull();
      expect((await repo.getCalendarFeedForCrew(CREW))!.tokenHash).toBe("hash-2");

      // Touch stamps lastPolledAt (best-effort "last synced"); no-op on a dead hash.
      await repo.touchCalendarFeedPoll("hash-2", "2026-07-03T09:00:00.000Z");
      expect((await repo.getCalendarFeedForCrew(CREW))!.lastPolledAt).toBe(
        "2026-07-03T09:00:00.000Z",
      );
      await repo.touchCalendarFeedPoll("dead-hash", "2026-07-03T09:00:00.000Z"); // no throw

      // Revoke hard-deletes; a second revoke is a no-op.
      await repo.deleteCalendarFeed(CREW);
      expect(await repo.getCalendarFeedForCrew(CREW)).toBeNull();
      expect(await repo.getCalendarFeedByTokenHash("hash-2")).toBeNull();
      await repo.deleteCalendarFeed(CREW); // no throw
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

    it("ring outbox entries: round-trip incl. sentAt optional; status flip via upsert (#118, DEC-073)", async () => {
      await repo.saveRingOutboxEntry(ringOutboxEntry()); // pending, never sent
      const got = await repo.getRingOutboxEntry(asId<"RingOutboxEntryId">("ring-thread-1-crew-a"));
      expect(got).toEqual(ringOutboxEntry());
      expect("sentAt" in got!).toBe(false); // omitted, not undefined
      expect(await repo.getRingOutboxEntry(asId<"RingOutboxEntryId">("ghost"))).toBeNull();
      // Mark sent → upsert flips status + stamps sentAt; body/link come back VERBATIM.
      await repo.saveRingOutboxEntry(
        ringOutboxEntry({ status: "sent", sentAt: "2026-07-01T12:30:00.000Z" }),
      );
      expect(await repo.listRingOutboxEntries()).toEqual([
        ringOutboxEntry({ status: "sent", sentAt: "2026-07-01T12:30:00.000Z" }),
      ]);
      // Remove: gone, and an absent id is a no-op.
      await repo.removeRingOutboxEntry(asId<"RingOutboxEntryId">("ring-thread-1-crew-a"));
      expect(await repo.listRingOutboxEntries()).toHaveLength(0);
      await expect(
        repo.removeRingOutboxEntry(asId<"RingOutboxEntryId">("ghost")),
      ).resolves.toBeUndefined();
    });

    it("notice outbox entries: round-trip incl. sentAt optional; status flip via upsert (DEC-084)", async () => {
      await repo.saveNoticeOutboxEntry(noticeOutboxEntry()); // pending, never sent
      const got = await repo.getNoticeOutboxEntry(
        asId<"NoticeOutboxEntryId">("notice-shift-1-crew-a-removed"),
      );
      expect(got).toEqual(noticeOutboxEntry());
      expect("sentAt" in got!).toBe(false); // omitted, not undefined
      expect(
        await repo.getNoticeOutboxEntry(asId<"NoticeOutboxEntryId">("ghost")),
      ).toBeNull();
      // Mark sent → upsert flips status + stamps sentAt; body/link come back VERBATIM.
      await repo.saveNoticeOutboxEntry(
        noticeOutboxEntry({ status: "sent", sentAt: "2026-07-01T12:30:00.000Z" }),
      );
      expect(await repo.listNoticeOutboxEntries()).toEqual([
        noticeOutboxEntry({ status: "sent", sentAt: "2026-07-01T12:30:00.000Z" }),
      ]);
      // Remove: gone, and an absent id is a no-op.
      await repo.removeNoticeOutboxEntry(
        asId<"NoticeOutboxEntryId">("notice-shift-1-crew-a-removed"),
      );
      expect(await repo.listNoticeOutboxEntries()).toHaveLength(0);
      await expect(
        repo.removeNoticeOutboxEntry(asId<"NoticeOutboxEntryId">("ghost")),
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

    it("self-claim confirm-gate flag: absent ⇒ false; set/clear round-trips (DEC-075)", async () => {
      // Absent row ⇒ false ⇒ auto-lock (the MVP default, mirroring engine_paused):
      // a missing row must never imply the unbuilt confirm tier is engaged.
      expect(await repo.selfClaimRequiresConfirmation()).toBe(false);
      await repo.setSelfClaimRequiresConfirmation(true, "2026-07-01T12:00:00.000Z");
      expect(await repo.selfClaimRequiresConfirmation()).toBe(true);
      await repo.setSelfClaimRequiresConfirmation(false, "2026-07-01T12:05:00.000Z");
      expect(await repo.selfClaimRequiresConfirmation()).toBe(false);
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

    it("listDmThreadsForCrew: my DMs only, id-sorted; derived kinds + others' DMs excluded (#117, DEC-071)", async () => {
      // Two DMs I'm in (id order deliberately reversed on save).
      const dmY = asId<"ThreadId">("thread-dm-y");
      const dmX = asId<"ThreadId">("thread-dm-x");
      await repo.saveThread(thread({ id: dmY, kind: "dm" }));
      await repo.saveThread(thread({ id: dmX, kind: "dm" }));
      await repo.saveParticipant(participant({ id: asId<"ParticipantId">("p-y"), threadId: dmY }));
      await repo.saveParticipant(participant({ id: asId<"ParticipantId">("p-x"), threadId: dmX }));
      // A DM between two OTHER people — I'm not a participant.
      const dmOther = asId<"ThreadId">("thread-dm-other");
      await repo.saveThread(thread({ id: dmOther, kind: "dm" }));
      await repo.saveParticipant(
        participant({ id: asId<"ParticipantId">("p-o1"), threadId: dmOther, crewMemberId: CREW_B }),
      );
      // A derived-kind thread is never a DM even if a stray row pointed at it.
      await repo.saveThread(thread({ id: asId<"ThreadId">("thread-cohort"), kind: "cohort", scopeRef: "2026-07-04" }));

      const mine = (await repo.listDmThreadsForCrew(CREW)).map((t) => String(t.id));
      expect(mine).toEqual(["thread-dm-x", "thread-dm-y"]); // id-sorted; others' DM + cohort excluded
      expect((await repo.listDmThreadsForCrew(CREW)).every((t) => t.kind === "dm")).toBe(true);
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
