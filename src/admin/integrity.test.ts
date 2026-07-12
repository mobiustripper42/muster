import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
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
import { checkIntegrity } from "./integrity.js";

const TENANT = asId<"TenantId">("t");
const ROLE = asId<"RoleTypeId">("role-captain");
const VESSEL = asId<"VesselId">("vessel-1");
const CREW = asId<"CrewMemberId">("crew-a");
const EVENT = asId<"EventId">("evt-1");
const SHIFT = asId<"ShiftId">("shift-1");
const SEAT = asId<"SeatId">("seat-1");

/** A repo wired with one valid, fully-connected spine. */
async function seedSpine(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  const role: RoleType = { id: ROLE, tenantId: TENANT, name: "captain" };
  const vessel: Vessel = {
    id: VESSEL,
    name: "Hops",
    coiMaxPax: 12,
    manning: [{ roleTypeId: ROLE, count: 2 }],
  };
  const crew: CrewMember = {
    id: CREW,
    name: "Quint",
    phone: "555",
    ratings: [ROLE],
    status: "active",
    reliabilityScore: null,
  };
  const event: Event = {
    id: EVENT,
    vesselId: VESSEL,
    date: "2026-07-01",
    time: "14:00",
    capacity: 12,
    source: "xola", status: "scheduled",
  };
  const reservation: Reservation = {
    id: asId<"ReservationId">("resv-1"),
    eventId: EVENT,
    source: "xola",
    customerName: "Brody",
    partySize: 4,
    status: "booked",
  };
  const shift: Shift = {
    id: SHIFT,
    vesselId: VESSEL,
    date: "2026-07-01",
    state: "Pending",
    eventIds: [EVENT],
  };
  const seat: Seat = {
    id: SEAT,
    shiftId: SHIFT,
    role: ROLE,
    kind: "required",
    state: "Confirmed",
    assignedCrewMemberId: CREW,
  };
  const ask: Ask = {
    id: asId<"AskId">("ask-1"),
    seatId: SEAT,
    crewMemberId: CREW,
    channel: "push",
    sentAt: "2026-07-01T12:00:00.000Z",
  };
  const credential: Credential = {
    id: asId<"CredentialId">("cred-1"),
    crewMemberId: CREW,
    type: "MMC",
    expiry: "2026-12-31",
  };
  const pto: PtoWindow = {
    id: asId<"PtoWindowId">("pto-1"),
    crewMemberId: CREW,
    start: "2026-08-01",
    end: "2026-08-05",
  };
  const token: MagicToken = {
    id: asId<"MagicTokenId">("mtk-1"),
    tokenHash: "abc",
    subjectKind: "crew",
    subjectId: CREW,
    createdAt: "2026-07-01T12:00:00.000Z",
    expiresAt: "2026-07-01T12:15:00.000Z",
  };
  await repo.saveRoleType(role);
  await repo.saveVessel(vessel);
  await repo.saveCrewMember(crew);
  await repo.saveEvent(event);
  await repo.saveReservation(reservation);
  await repo.saveShift(shift);
  await repo.saveSeat(seat);
  await repo.saveAsk(ask);
  await repo.saveCredential(credential);
  await repo.savePtoWindow(pto);
  await repo.saveMagicToken(token);
  return repo;
}

describe("checkIntegrity", () => {
  it("a fully-connected spine has no violations", async () => {
    const repo = await seedSpine();
    const report = await checkIntegrity(repo);
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.scanned.seats).toBe(1);
    expect(report.scanned.magicTokens).toBe(1);
  });

  it("an empty store is trivially intact", async () => {
    const report = await checkIntegrity(new InMemoryRepository());
    expect(report.ok).toBe(true);
  });

  it("catches an orphan seat whose shift is gone (no FK would have)", async () => {
    const repo = await seedSpine();
    await repo.saveSeat({
      id: asId<"SeatId">("seat-orphan"),
      shiftId: asId<"ShiftId">("shift-ghost"),
      role: ROLE,
      kind: "required",
      state: "Open",
    });
    const report = await checkIntegrity(repo);
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual({
      entity: "seat",
      id: "seat-orphan",
      ref: "shiftId",
      missingId: "shift-ghost",
    });
  });

  it("catches a dangling crew assignment, ask, credential, and token subject", async () => {
    const repo = await seedSpine();
    const ghostCrew = asId<"CrewMemberId">("crew-ghost");
    await repo.saveSeat({
      id: SEAT,
      shiftId: SHIFT,
      role: ROLE,
      kind: "required",
      state: "Confirmed",
      assignedCrewMemberId: ghostCrew,
    });
    await repo.saveCredential({
      id: asId<"CredentialId">("cred-ghost"),
      crewMemberId: ghostCrew,
      type: "MMC",
      expiry: "2026-12-31",
    });
    await repo.saveMagicToken({
      id: asId<"MagicTokenId">("mtk-ghost"),
      tokenHash: "zzz",
      subjectKind: "crew",
      subjectId: ghostCrew,
      createdAt: "2026-07-01T12:00:00.000Z",
      expiresAt: "2026-07-01T12:15:00.000Z",
    });
    const report = await checkIntegrity(repo);
    const refs = report.violations.map((v) => `${v.entity}.${v.ref}`);
    expect(refs).toContain("seat.assignedCrewMemberId");
    expect(refs).toContain("credential.crewMemberId");
    expect(refs).toContain("magicToken.subjectId");
  });

  it("ignores admin-subject tokens (no entity to point at)", async () => {
    const repo = await seedSpine();
    await repo.saveMagicToken({
      id: asId<"MagicTokenId">("mtk-admin"),
      tokenHash: "adm",
      subjectKind: "admin",
      subjectId: "spink@brewboat.co",
      createdAt: "2026-07-01T12:00:00.000Z",
      expiresAt: "2026-07-01T12:15:00.000Z",
    });
    const report = await checkIntegrity(repo);
    expect(report.ok).toBe(true);
  });
});
