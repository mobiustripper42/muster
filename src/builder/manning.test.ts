/**
 * Seat/manning override (8.5). Covers: an added required hand gates Crewed and
 * SURVIVES a re-form (the prune exemption); a supernumerary adds + survives; remove
 * an Open override seat; and the guards (not-override / occupied).
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import { seedFleet } from "../import/resource-map.js";
import { refreshShiftState } from "../asks/ask-loop.js";
import { formShifts } from "./form-shifts.js";
import {
  addOverrideSeat,
  removeOverrideSeat,
  staffTraineeSeat,
  unstaffTraineeSeat,
} from "./manning.js";

const PARTY = asId<"VesselId">("vessel-brew-2"); // 2-crew (captain + mate), fleet-seeded
const DAY = "2026-07-18";
const CANON = asId<"ShiftId">(`shift-${PARTY}-${DAY}`);
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");

async function seedShift(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await seedFleet(repo);
  await repo.saveEvent({
    id: asId<"EventId">("am"),
    vesselId: PARTY,
    date: DAY,
    time: "11:00",
    capacity: 16,
    status: "scheduled",
  });
  await formShifts(repo);
  return repo;
}

describe("manning override (8.5)", () => {
  it("adds a required hand + it SURVIVES a re-form (prune-exempt)", async () => {
    const repo = await seedShift();
    const before = (await repo.listSeatsForShift(CANON)).length; // COI: captain + mate
    const seat = await addOverrideSeat(repo, CANON, "required", MATE);
    expect(seat.override).toBe(true);
    expect(seat.state).toBe("Open");
    expect((await repo.listSeatsForShift(CANON)).length).toBe(before + 1);

    // Re-form (Xola re-import) must NOT prune the override seat.
    await formShifts(repo);
    const seats = await repo.listSeatsForShift(CANON);
    expect(seats.find((s) => s.id === seat.id)).toBeTruthy();
    expect(seats.length).toBe(before + 1);
  });

  it("a required override drops a fully-crewed shift out of Crewed (gates)", async () => {
    const repo = await seedShift();
    for (const s of await repo.listSeatsForShift(CANON)) {
      await repo.saveSeat({
        ...s,
        state: "Confirmed",
        assignedCrewMemberId: asId<"CrewMemberId">("x"),
      });
    }
    await refreshShiftState(repo, CANON);
    expect((await repo.getShift(CANON))?.state).toBe("Crewed");

    await addOverrideSeat(repo, CANON, "required", MATE);
    expect((await repo.getShift(CANON))?.state).not.toBe("Crewed"); // new Open required un-crews it
  });

  it("adds a supernumerary seat (non-gating) that survives a re-form", async () => {
    const repo = await seedShift();
    const seat = await addOverrideSeat(repo, CANON, "supernumerary", CAPTAIN);
    expect(seat.kind).toBe("supernumerary");
    await formShifts(repo);
    expect(
      (await repo.listSeatsForShift(CANON)).find((s) => s.id === seat.id),
    ).toBeTruthy();
  });

  it("removes an Open override seat", async () => {
    const repo = await seedShift();
    const seat = await addOverrideSeat(repo, CANON, "required", MATE);
    await removeOverrideSeat(repo, seat.id);
    expect(await repo.getSeat(seat.id)).toBeNull();
  });

  it("refuses to remove a derived (non-override) seat", async () => {
    const repo = await seedShift();
    const derived = (await repo.listSeatsForShift(CANON))[0]!;
    await expect(removeOverrideSeat(repo, derived.id)).rejects.toThrow(/not an override/);
  });

  it("refuses to remove an occupied override seat — vacate first", async () => {
    const repo = await seedShift();
    const seat = await addOverrideSeat(repo, CANON, "required", MATE);
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("someone"),
    });
    await expect(removeOverrideSeat(repo, seat.id)).rejects.toThrow(/vacate/);
  });
});


/**
 * Trainee staffing (9.3/#224, DEC-087) — the person-placer for supernumerary
 * seats. Eligibility = evaluateCandidate minus the rating floor (a SCOPING of
 * DEC-064, not a bypass); unstaff is bespoke (never vacateSeat) so nothing
 * ever re-asks a trainee seat.
 */
describe("trainee staffing (9.3, DEC-087)", () => {
  const NOW = new Date("2026-07-10T12:00:00.000Z");
  const RIDER = asId<"CrewMemberId">("crew-rider");

  /** An UNRATED (that's the point), active crew member with a valid MMC. */
  async function seedRider(repo: InMemoryRepository, over: object = {}) {
    await repo.saveCrewMember({
      id: RIDER,
      name: "Robin Rider",
      phone: "+15035550199",
      ratings: [],
      status: "active",
      reliabilityScore: null,
      ...over,
    });
    await repo.saveCredential({
      id: asId<"CredentialId">("cred-rider-mmc"),
      crewMemberId: RIDER,
      type: "MMC",
      expiry: "2030-01-01",
    });
  }

  async function seedTraineeSeat(repo: InMemoryRepository) {
    return addOverrideSeat(repo, CANON, "supernumerary", MATE);
  }

  it("staffs an eligible UNRATED person: Confirmed, operator provenance, no asks fired", async () => {
    const repo = await seedShift();
    await seedRider(repo);
    const seat = await seedTraineeSeat(repo);

    const out = await staffTraineeSeat(repo, seat.id, RIDER, NOW);
    expect(out.code).toBeNull();
    expect(out.seat?.state).toBe("Confirmed");
    expect(out.seat?.assignedCrewMemberId).toBe(RIDER);
    expect(out.seat?.acquiredVia).toBe("operator"); // my-shifts "Added for you" (#196)
    // The ask engine must stay silent — no ask ever fires for a trainee seat.
    expect(await repo.listAsksForSeat(seat.id)).toHaveLength(0);
    // Non-gating: the shift's Crewed math is untouched by the rider.
    expect((await repo.getShift(CANON))?.state).not.toBe("Crewed");
  });

  it("refuses a required seat — that path is the DEC-064-guarded overrideSeat", async () => {
    const repo = await seedShift();
    await seedRider(repo);
    const required = await addOverrideSeat(repo, CANON, "required", MATE);
    expect((await staffTraineeSeat(repo, required.id, RIDER, NOW)).code).toBe(
      "not_trainee_seat",
    );
  });

  it("refuses an occupied trainee seat", async () => {
    const repo = await seedShift();
    await seedRider(repo);
    const seat = await seedTraineeSeat(repo);
    await staffTraineeSeat(repo, seat.id, RIDER, NOW);
    expect((await staffTraineeSeat(repo, seat.id, RIDER, NOW)).code).toBe(
      "occupied",
    );
  });

  it("rejects PTO, expired MMC, and inactive riders (trainee rule set) — one rider per rule", async () => {
    const repo = await seedShift();
    const seat = await seedTraineeSeat(repo);

    // PTO covers the shift day.
    const onPto = asId<"CrewMemberId">("crew-pto");
    await repo.saveCrewMember({
      id: onPto, name: "Pat Pto", phone: "+15035550301",
      ratings: [], status: "active", reliabilityScore: null,
    });
    await repo.saveCredential({
      id: asId<"CredentialId">("cred-pto-mmc"),
      crewMemberId: onPto, type: "MMC", expiry: "2030-01-01",
    });
    await repo.savePtoWindow({
      id: asId<"PtoWindowId">("pto-1"),
      crewMemberId: onPto, start: DAY, end: DAY,
    });
    expect((await staffTraineeSeat(repo, seat.id, onPto, NOW)).code).toBe("ineligible");

    // MMC aged out before the shift day.
    const lapsed = asId<"CrewMemberId">("crew-lapsed");
    await repo.saveCrewMember({
      id: lapsed, name: "Lee Lapsed", phone: "+15035550302",
      ratings: [], status: "active", reliabilityScore: null,
    });
    await repo.saveCredential({
      id: asId<"CredentialId">("cred-lapsed-mmc"),
      crewMemberId: lapsed, type: "MMC", expiry: "2026-01-01",
    });
    expect((await staffTraineeSeat(repo, seat.id, lapsed, NOW)).code).toBe("ineligible");

    // Inactive.
    const inactive = asId<"CrewMemberId">("crew-inactive");
    await repo.saveCrewMember({
      id: inactive, name: "Ida Inactive", phone: "+15035550303",
      ratings: [], status: "inactive", reliabilityScore: null,
    });
    await repo.saveCredential({
      id: asId<"CredentialId">("cred-inactive-mmc"),
      crewMemberId: inactive, type: "MMC", expiry: "2030-01-01",
    });
    expect((await staffTraineeSeat(repo, seat.id, inactive, NOW)).code).toBe("ineligible");
  });

  it("rejects crew already confirmed on this shift's own required seats (double-book, no bespoke check)", async () => {
    const repo = await seedShift();
    await seedRider(repo);
    // Put the rider on a REQUIRED seat of the same shift first.
    const required = (await repo.listSeatsForShift(CANON)).find(
      (s) => s.kind === "required",
    )!;
    await repo.saveSeat({
      ...required,
      state: "Confirmed",
      assignedCrewMemberId: RIDER,
    });
    const seat = await seedTraineeSeat(repo);
    expect((await staffTraineeSeat(repo, seat.id, RIDER, NOW)).code).toBe(
      "ineligible",
    );
  });

  it("unstaffs back to Open — occupant + provenance cleared, no re-asks, Remove works again", async () => {
    const repo = await seedShift();
    await seedRider(repo);
    const seat = await seedTraineeSeat(repo);
    await staffTraineeSeat(repo, seat.id, RIDER, NOW);

    const out = await unstaffTraineeSeat(repo, seat.id, RIDER);
    expect(out.code).toBeNull();
    const reopened = await repo.getSeat(seat.id);
    expect(reopened?.state).toBe("Open");
    expect(reopened?.assignedCrewMemberId).toBeUndefined();
    expect(reopened?.acquiredVia).toBeUndefined();
    // The load-bearing difference from vacateSeat: NOTHING was re-asked.
    expect(await repo.listAsksForSeat(seat.id)).toHaveLength(0);
    // Seat is Open again, so 8.5's remove path works.
    await removeOverrideSeat(repo, seat.id);
    expect(await repo.getSeat(seat.id)).toBeNull();
  });

  it("unstaff pins the expected occupant — a swapped rider maps to raced", async () => {
    const repo = await seedShift();
    await seedRider(repo);
    const seat = await seedTraineeSeat(repo);
    await staffTraineeSeat(repo, seat.id, RIDER, NOW);
    expect(
      (await unstaffTraineeSeat(repo, seat.id, asId<"CrewMemberId">("crew-else")))
        .code,
    ).toBe("raced");
  });
});
