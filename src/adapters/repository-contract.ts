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
  Admin,
  Ask,
  Block,
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

    // ── saveReservationIfUnclaimed — the whole-boat claim (DEC-109) ────────────
    const rid = (s: string) => asId<"ReservationId">(s);

    it("saveReservationIfUnclaimed: writes when the boat is unclaimed", async () => {
      await repo.saveEvent(event({ source: "muster" }));
      expect(await repo.saveReservationIfUnclaimed(reservation({ source: "muster" }))).toBe(true);
      expect(await repo.listReservationsForEvent(EVENT)).toHaveLength(1);
    });

    it("saveReservationIfUnclaimed: idempotent on id — same reservation twice, no duplicate", async () => {
      await repo.saveEvent(event({ source: "muster" }));
      const r = reservation({ source: "muster" });
      expect(await repo.saveReservationIfUnclaimed(r)).toBe(true);
      expect(await repo.saveReservationIfUnclaimed(r)).toBe(true); // idempotent re-put
      expect(await repo.listReservationsForEvent(EVENT)).toHaveLength(1);
    });

    it("saveReservationIfUnclaimed: blocked by a DIFFERENT active Muster reservation", async () => {
      await repo.saveEvent(event({ source: "muster" }));
      expect(await repo.saveReservationIfUnclaimed(reservation({ id: rid("resv-a"), source: "muster" }))).toBe(true);
      expect(await repo.saveReservationIfUnclaimed(reservation({ id: rid("resv-b"), source: "muster" }))).toBe(false);
      expect(await repo.listReservationsForEvent(EVENT)).toHaveLength(1);
    });

    it("saveReservationIfUnclaimed: an active Xola reservation does NOT block (source-scoped)", async () => {
      await repo.saveEvent(event({ source: "muster" }));
      await repo.saveReservation(reservation({ id: rid("resv-x"), source: "xola" }));
      expect(await repo.saveReservationIfUnclaimed(reservation({ id: rid("resv-m"), source: "muster" }))).toBe(true);
    });

    it("saveReservationIfUnclaimed: a cancelled Muster reservation does NOT block", async () => {
      await repo.saveEvent(event({ source: "muster" }));
      await repo.saveReservation(reservation({ id: rid("resv-c"), source: "muster", status: "cancelled" }));
      expect(await repo.saveReservationIfUnclaimed(reservation({ id: rid("resv-m"), source: "muster" }))).toBe(true);
    });

    it("saveReservationIfUnclaimed: false for a nonexistent event", async () => {
      expect(await repo.saveReservationIfUnclaimed(reservation({ source: "muster" }))).toBe(false);
    });

    it("saveReservationIfUnclaimed: exactly one of two concurrent claims wins (DEC-109)", async () => {
      await repo.saveEvent(event({ source: "muster" }));
      const [a, b] = await Promise.all([
        repo.saveReservationIfUnclaimed(reservation({ id: rid("resv-a"), source: "muster", customerName: "A" })),
        repo.saveReservationIfUnclaimed(reservation({ id: rid("resv-b"), source: "muster", customerName: "B" })),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one winner
      const active = (await repo.listReservationsForEvent(EVENT)).filter(
        (r) => r.source === "muster" && r.status === "booked",
      );
      expect(active).toHaveLength(1);
    });

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

    it("acquireCheckoutHold: fresh acquire succeeds and is listable", async () => {
      expect((await repo.acquireCheckoutHold(hold())).acquired).toBe(true);
      expect(await repo.listCheckoutHolds()).toHaveLength(1);
    });

    it("acquireCheckoutHold: two live acquires on one slot — exactly one wins", async () => {
      const a = await repo.acquireCheckoutHold(hold({ id: asId<"CheckoutHoldId">("h-a") }));
      const b = await repo.acquireCheckoutHold(hold({ id: asId<"CheckoutHoldId">("h-b") }));
      expect([a.acquired, b.acquired].filter(Boolean)).toHaveLength(1);
      expect(await repo.listCheckoutHolds()).toHaveLength(1);
    });

    it("acquireCheckoutHold: idempotent re-acquire of one's OWN live hold", async () => {
      expect((await repo.acquireCheckoutHold(hold())).acquired).toBe(true);
      expect((await repo.acquireCheckoutHold(hold())).acquired).toBe(true);
      expect(await repo.listCheckoutHolds()).toHaveLength(1);
    });

    it("acquireCheckoutHold: an EXPIRED hold is inert — re-acquire succeeds (delete-expired-first)", async () => {
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

    it("checkout holds: remove is idempotent", async () => {
      await repo.acquireCheckoutHold(hold());
      await repo.removeCheckoutHold(asId<"CheckoutHoldId">("hold-1"));
      expect(await repo.listCheckoutHolds()).toHaveLength(0);
      await repo.removeCheckoutHold(asId<"CheckoutHoldId">("hold-1")); // no-op, no throw
      expect(await repo.listCheckoutHolds()).toHaveLength(0);
    });

    // ── Reservation catalog — write + read round-trip (12.1a) ──────────────────
    it("catalog: offering / location / block write + read round-trip", async () => {
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
      const base: Offering = {
        id: asId<"OfferingId">("off-cfg"), tenantId: TENANT, name: "Configured", status: "draft",
        vesselIds: [VESSEL], locationId: asId<"LocationId">("loc-1"),
        schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: ["14:00"] },
        basePriceCents: 49900, priceVariations: [], extraGuestPriceCents: 5000,
      };
      await repo.saveOffering(base); // none of the optionals set
      const bare = (await repo.getOffering(base.id))!;
      for (const k of ["description", "tripLengthMinutes", "holdMinutes", "arriveBeforeMinutes", "addOns"]) {
        expect(k in bare).toBe(false); // omitted, not null
      }
      const full: Offering = {
        ...base,
        description: "**NO Pedaling Required** — party pontoons.",
        tripLengthMinutes: 100,
        holdMinutes: 100,
        arriveBeforeMinutes: 15,
        addOns: [
          { label: "Flex insurance", type: "flat", amountCents: 2900, required: false },
          { label: "Extra hour", type: "flat", amountCents: 15000, required: false },
        ],
      };
      await repo.saveOffering(full);
      expect(await repo.getOffering(base.id)).toEqual(full);
      // clearing back to unset round-trips as absent again (upsert writes null)
      await repo.saveOffering(base);
      expect("addOns" in (await repo.getOffering(base.id))!).toBe(false);
    });

    it("catalog: Offering includedGuestCount round-trips present and absent (12.8)", async () => {
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
      // a gratuity on a different event isn't returned
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
      expect(await repo.getPaymentConfig()).toEqual({
        depositMode: "deposit",
        depositPercent: 25,
        taxRateBps: 725,
        balanceDueDaysBeforeEvent: 14,
      });
      await repo.setPaymentConfig({ depositMode: "full", taxRateBps: 800 }, "2026-07-12T00:00:00.000Z");
      const cfg = await repo.getPaymentConfig();
      expect(cfg.depositMode).toBe("full");
      expect(cfg.taxRateBps).toBe(800);
      expect(cfg.depositPercent).toBe(25); // untouched field keeps its default
    });

    it("payments: save/get/listForReservation; idempotent upsert on id; optional stripe ids", async () => {
      await repo.savePayment(payment());
      const got = await repo.getPayment(asId<"PaymentId">("pay-1"));
      expect(got).toEqual(payment());
      // idempotent: same id again doesn't duplicate
      await repo.savePayment(payment({ amountCents: 53521 }));
      expect(await repo.listPaymentsForReservation(asId<"ReservationId">("resv-1"))).toHaveLength(1);
      // a balance payment for the same reservation is a second row
      await repo.savePayment(payment({ id: asId<"PaymentId">("pay-2"), kind: "balance", stripeCheckoutSessionId: "cs_test_2" }));
      expect(await repo.listPaymentsForReservation(asId<"ReservationId">("resv-1"))).toHaveLength(2);
      // optional stripePaymentIntentId omitted stays omitted (not undefined)
      expect("stripePaymentIntentId" in got!).toBe(false);
      // gratuityCents (DEC-124, 12.3): absent stays omitted; present round-trips
      expect("gratuityCents" in got!).toBe(false);
      await repo.savePayment(payment({ id: asId<"PaymentId">("pay-3"), gratuityCents: 9980, stripeCheckoutSessionId: "cs_test_3" }));
      expect((await repo.getPayment(asId<"PaymentId">("pay-3")))!.gratuityCents).toBe(9980);
    });

    it("muster-owned vessel-days: mark + list; upsert on (vessel,date) (DEC-106)", async () => {
      expect(await repo.listMusterOwnedVesselDays()).toEqual([]);
      await repo.markVesselDayMusterOwned(
        VESSEL,
        "2026-07-04",
        "2026-07-01T00:00:00.000Z",
      );
      expect(await repo.listMusterOwnedVesselDays()).toEqual([
        { vesselId: VESSEL, date: "2026-07-04", markedAt: "2026-07-01T00:00:00.000Z" },
      ]);
      // upsert on (vessel, date): re-mark updates markedAt, no duplicate row
      await repo.markVesselDayMusterOwned(
        VESSEL,
        "2026-07-04",
        "2026-07-02T00:00:00.000Z",
      );
      const one = await repo.listMusterOwnedVesselDays();
      expect(one).toHaveLength(1);
      expect(one[0]!.markedAt).toBe("2026-07-02T00:00:00.000Z");
      // a different date is a distinct row
      await repo.markVesselDayMusterOwned(
        VESSEL,
        "2026-07-05",
        "2026-07-02T00:00:00.000Z",
      );
      expect(await repo.listMusterOwnedVesselDays()).toHaveLength(2);
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
      const c1 = await repo.claimLoginAttempt("crew", CREW, 5);
      expect(c1).toMatchObject({ codeHash: "code-hash-1", attempts: 1 });
      expect(c1!.expiresAt).toBe("2026-07-01T12:10:00.000Z");
      expect((await repo.claimLoginAttempt("crew", CREW, 5))!.attempts).toBe(2);
      expect((await repo.getLoginCode("crew", CREW))!.attempts).toBe(2);
      // Absent → null; consumed → null (can't guess a spent code).
      expect(await repo.claimLoginAttempt("crew", "ghost", 5)).toBeNull();
      await repo.consumeLoginCodeIfUnused("crew", CREW, "2026-07-01T12:05:00.000Z");
      expect(await repo.claimLoginAttempt("crew", CREW, 5)).toBeNull();
    });

    it("claimLoginAttempt: the cap is atomic — concurrent claims can't exceed maxAttempts (#297)", async () => {
      await repo.saveLoginCode(loginCode());
      // 10 concurrent guesses against a max of 3 → exactly 3 non-null claims.
      const results = await Promise.all(
        Array.from({ length: 10 }, () => repo.claimLoginAttempt("crew", CREW, 3)),
      );
      expect(results.filter((r) => r !== null)).toHaveLength(3);
      expect((await repo.getLoginCode("crew", CREW))!.attempts).toBe(3);
      // Once at the cap, further claims stay null.
      expect(await repo.claimLoginAttempt("crew", CREW, 3)).toBeNull();
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
