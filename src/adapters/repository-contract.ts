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
  PtoWindow,
  Reservation,
  RoleType,
  Seat,
  Shift,
  Vessel,
} from "../domain/entities.js";
import type { ReliabilityEvent } from "../domain/reliability.js";
import type { Repository } from "../ports/repository.js";

const TENANT = asId<"TenantId">("tenant-x");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const VESSEL = asId<"VesselId">("vessel-x");
const CREW = asId<"CrewMemberId">("crew-a");
const EVENT = asId<"EventId">("evt-1");
const SHIFT = asId<"ShiftId">("shift-1");
const SEAT = asId<"SeatId">("seat-1");

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

      const clean = await checkIntegrity(repo);
      expect(clean.ok).toBe(true);
      expect(clean.scanned.seats).toBe(1);
      expect(clean.scanned.magicTokens).toBe(1);

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
  });
}
