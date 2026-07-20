/**
 * BrewBoat seed (SPEC §2.1 acceptance: "4–6 real crew seeded").
 *
 * Stands up the first tenant end-to-end through the admin surface: two RoleType
 * rows (captain/mate as DATA, not an enum — DEC-ROLE-1), the BrewBoat vessel
 * (COI max-pax 6, manning 1 captain + 1 mate), and five crew, each with an MMC
 * credential. Expiries are derived relative to an injected `now` so the roster's
 * valid / expiring-soon / expired flag is always exercised, whenever this runs.
 *
 * Names are invented — there is no real BrewBoat roster yet.
 */

import type {
  Credential,
  CrewMember,
  RoleType,
  Vessel,
} from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type {
  CrewMemberId,
  RoleTypeId,
  TenantId,
  VesselId,
} from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import {
  addCredential,
  createCrewMember,
  createVessel,
} from "./crew-admin.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const daysFrom = (now: Date, n: number): string =>
  isoDate(new Date(now.getTime() + n * MS_PER_DAY));

export interface BrewBoatSeed {
  tenantId: TenantId;
  vesselId: VesselId;
  captainRoleId: RoleTypeId;
  mateRoleId: RoleTypeId;
  crewIds: CrewMemberId[];
}

/** Seed BrewBoat and return the minted handles for callers to build on. */
export async function seedBrewBoat(
  repo: Repository,
  now: Date,
): Promise<BrewBoatSeed> {
  const tenantId = asId<"TenantId">("tenant-brewboat");
  const captainRoleId = asId<"RoleTypeId">("role-captain");
  const mateRoleId = asId<"RoleTypeId">("role-mate");

  const role = (id: RoleTypeId, name: string): RoleType => ({
    id,
    tenantId,
    name,
  });
  await repo.saveRoleType(role(captainRoleId, "captain"));
  await repo.saveRoleType(role(mateRoleId, "mate"));

  const vessel: Vessel = {
    id: asId<"VesselId">("vessel-brewboat"),
    name: "BrewBoat",
    coiMaxPax: 6,
    hue: 1, // operator-chosen identity hue (DEC-086, 12.9) — representative in dev
    manning: [
      { roleTypeId: captainRoleId, count: 1 },
      { roleTypeId: mateRoleId, count: 1 },
    ],
  };
  await createVessel(repo, vessel);

  // The five — a deliberate spread of credential health (valid / expiring /
  // expired) and ratings, all cold-start (no reliability history yet).
  const roster: Array<{
    id: string;
    name: string;
    phone: string;
    ratings: RoleTypeId[];
  }> = [
    { id: "crew-quint", name: "Margo Quint", phone: "+15035550111", ratings: [captainRoleId] },
    { id: "crew-pibb", name: "Dale Pibb", phone: "+15035550122", ratings: [captainRoleId, mateRoleId] },
    { id: "crew-voss", name: "Renata Voss", phone: "+15035550133", ratings: [mateRoleId] },
    { id: "crew-mott", name: "Cyrus Mott", phone: "+15035550144", ratings: [captainRoleId] },
    { id: "crew-okafor", name: "Junie Okafor", phone: "+15035550155", ratings: [mateRoleId] },
  ];

  const crewIds: CrewMemberId[] = [];
  for (const r of roster) {
    const member: CrewMember = {
      id: asId<"CrewMemberId">(r.id),
      name: r.name,
      phone: r.phone,
      ratings: r.ratings,
      status: "active",
      reliabilityScore: null, // cold start — no history yet
    };
    await createCrewMember(repo, member);
    crewIds.push(member.id);
  }

  // MMC expiries: spread so the roster flag shows all three states.
  const mmc = (
    crewId: string,
    expiry: string,
    identifier: string,
  ): Credential => ({
    id: asId<"CredentialId">(`cred-${crewId}-mmc`),
    crewMemberId: asId<"CrewMemberId">(crewId),
    type: "MMC",
    identifier,
    expiry,
  });

  await addCredential(repo, mmc("crew-quint", daysFrom(now, 365 * 3), "MMC-QUINT")); // valid
  await addCredential(repo, mmc("crew-pibb", daysFrom(now, 365 * 2), "MMC-PIBB")); // valid MMC…
  await addCredential(repo, mmc("crew-voss", daysFrom(now, -30), "MMC-VOSS")); // expired
  await addCredential(repo, mmc("crew-mott", daysFrom(now, 365 * 4), "MMC-MOTT")); // valid
  await addCredential(repo, mmc("crew-okafor", daysFrom(now, 30), "MMC-OKAFOR")); // expiring-soon

  // …but Pibb's medical is expiring-soon → worst-of flags the whole person.
  await addCredential(repo, {
    id: asId<"CredentialId">("cred-crew-pibb-medical"),
    crewMemberId: asId<"CrewMemberId">("crew-pibb"),
    type: "medical",
    identifier: "MED-PIBB",
    expiry: daysFrom(now, 45),
  });

  return { tenantId, vesselId: vessel.id, captainRoleId, mateRoleId, crewIds };
}
