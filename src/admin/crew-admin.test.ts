/**
 * Admin surface — create/edit round-trips and the BrewBoat seed (Task 1.1 / M0).
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, Vessel } from "../domain/entities.js";
import {
  addCredential,
  createCrewMember,
  createVessel,
  removeCredential,
  updateCredential,
  updateCrewMember,
  updateVessel,
} from "./crew-admin.js";
import { seedBrewBoat } from "./seed-brewboat.js";

const captainRole = asId<"RoleTypeId">("role-captain");

const aVessel = (): Vessel => ({
  id: asId<"VesselId">("vessel-x"),
  name: "Test Boat",
  coiMaxPax: 6,
  manning: [{ roleTypeId: captainRole, count: 1 }],
});

const aCrewMember = (): CrewMember => ({
  id: asId<"CrewMemberId">("crew-x"),
  name: "Pat Helm",
  phone: "+15035559000",
  ratings: [captainRole],
  status: "active",
  reliabilityScore: null,
});

describe("vessel admin", () => {
  it("creates and reads back a vessel", async () => {
    const repo = new InMemoryRepository();
    await createVessel(repo, aVessel());
    const loaded = await repo.getVessel(asId<"VesselId">("vessel-x"));
    expect(loaded?.coiMaxPax).toBe(6);
  });

  it("rejects a vessel with non-positive COI max-pax", async () => {
    const repo = new InMemoryRepository();
    await expect(
      createVessel(repo, { ...aVessel(), coiMaxPax: 0 }),
    ).rejects.toThrow(/coiMaxPax/);
  });

  it("rejects a manning line demanding zero crew", async () => {
    const repo = new InMemoryRepository();
    await expect(
      createVessel(repo, {
        ...aVessel(),
        manning: [{ roleTypeId: captainRole, count: 0 }],
      }),
    ).rejects.toThrow(/at least 1/);
  });

  it("edits a vessel by patch without touching its id", async () => {
    const repo = new InMemoryRepository();
    await createVessel(repo, aVessel());
    const updated = await updateVessel(repo, asId<"VesselId">("vessel-x"), {
      name: "Renamed Boat",
    });
    expect(updated.id).toBe(asId<"VesselId">("vessel-x"));
    expect(updated.name).toBe("Renamed Boat");
    expect(updated.coiMaxPax).toBe(6);
  });
});

describe("crew admin", () => {
  it("creates and reads back a crew member at cold-start standing", async () => {
    const repo = new InMemoryRepository();
    await createCrewMember(repo, aCrewMember());
    const loaded = await repo.getCrewMember(asId<"CrewMemberId">("crew-x"));
    expect(loaded?.ratings).toContain(captainRole);
    expect(loaded?.reliabilityScore).toBeNull();
  });

  it("rejects a nameless or phoneless crew member", async () => {
    const repo = new InMemoryRepository();
    await expect(
      createCrewMember(repo, { ...aCrewMember(), name: "  " }),
    ).rejects.toThrow(/name/);
    await expect(
      createCrewMember(repo, { ...aCrewMember(), phone: "" }),
    ).rejects.toThrow(/phone/);
  });

  it("edits ratings and the manual thumb by patch", async () => {
    const repo = new InMemoryRepository();
    await createCrewMember(repo, aCrewMember());
    const mateRole = asId<"RoleTypeId">("role-mate");
    const updated = await updateCrewMember(repo, asId<"CrewMemberId">("crew-x"), {
      ratings: [captainRole, mateRole],
      manualBoost: 2,
    });
    expect(updated.ratings).toEqual([captainRole, mateRole]);
    expect(updated.manualBoost).toBe(2);
  });

  it("refuses to edit a crew member that does not exist", async () => {
    const repo = new InMemoryRepository();
    await expect(
      updateCrewMember(repo, asId<"CrewMemberId">("ghost"), { status: "inactive" }),
    ).rejects.toThrow(/No crew member/);
  });
});

describe("credential admin", () => {
  it("adds, updates, and removes a credential row for a crew member", async () => {
    const repo = new InMemoryRepository();
    await createCrewMember(repo, aCrewMember());
    const crewId = asId<"CrewMemberId">("crew-x");

    await addCredential(repo, {
      id: asId<"CredentialId">("cred-1"),
      crewMemberId: crewId,
      type: "MMC",
      expiry: "2030-01-01",
    });
    expect(await repo.listCredentialsForCrew(crewId)).toHaveLength(1);

    const updated = await updateCredential(repo, asId<"CredentialId">("cred-1"), {
      expiry: "2031-06-30",
    });
    expect(updated.expiry).toBe("2031-06-30");

    await removeCredential(repo, asId<"CredentialId">("cred-1"));
    expect(await repo.listCredentialsForCrew(crewId)).toHaveLength(0);
  });

  it("refuses to attach a credential to a missing crew member", async () => {
    const repo = new InMemoryRepository();
    await expect(
      addCredential(repo, {
        id: asId<"CredentialId">("cred-orphan"),
        crewMemberId: asId<"CrewMemberId">("nobody"),
        type: "MMC",
        expiry: "2030-01-01",
      }),
    ).rejects.toThrow(/No crew member/);
  });
});

describe("BrewBoat seed", () => {
  it("seeds five crew, each with an MMC, plus two role rows and the vessel", async () => {
    const repo = new InMemoryRepository();
    const now = new Date("2026-06-04T00:00:00Z");
    const seed = await seedBrewBoat(repo, now);

    expect(seed.crewIds).toHaveLength(5);
    expect(await repo.listRoleTypes(seed.tenantId)).toHaveLength(2);
    expect(await repo.getVessel(seed.vesselId)).not.toBeNull();

    for (const id of seed.crewIds) {
      const creds = await repo.listCredentialsForCrew(id);
      expect(creds.some((c) => c.type === "MMC")).toBe(true);
    }
  });
});
