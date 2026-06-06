/**
 * Crew Roster / People — the thin admin surface (SPEC §2.1).
 *
 * Operator-facing use-cases over the repository port: create/edit the Vessel and
 * its crew, and maintain credential rows. It is reference data the rest of Muster
 * reads, "not a workflow" (SPEC §2.1) — so these stay deliberately thin: light
 * create-time validation, edit-by-patch (load / merge / save), nothing more. The
 * web form that drives this lands at M4 (task 1.5b); until then the seed and the
 * tests are the callers.
 *
 * Callers supply branded IDs (consistent with the Phase-0 spine and the seed);
 * the core mints nothing it can't make deterministic.
 */

import type { Credential, CrewMember, Vessel } from "../domain/entities.js";
import type {
  CredentialId,
  CrewMemberId,
  VesselId,
} from "../domain/ids.js";
import { assertIsoDate } from "../domain/iso-date.js";
import type { Repository } from "../ports/repository.js";

/** A patch never rewrites the identity of a record. */
type Patch<T extends { id: unknown }> = Partial<Omit<T, "id">>;

// ── Vessel ────────────────────────────────────────────────────────────────

export async function createVessel(
  repo: Repository,
  vessel: Vessel,
): Promise<Vessel> {
  if (vessel.coiMaxPax < 1) {
    throw new Error("Vessel coiMaxPax must be at least 1");
  }
  if (vessel.manning.some((m) => m.count < 1)) {
    throw new Error("Each manning requirement must demand at least 1 crew");
  }
  await repo.saveVessel(vessel);
  return vessel;
}

export async function updateVessel(
  repo: Repository,
  id: VesselId,
  patch: Patch<Vessel>,
): Promise<Vessel> {
  const current = await repo.getVessel(id);
  if (!current) throw new Error(`No vessel ${id}`);
  const next: Vessel = { ...current, ...patch, id };
  return createVessel(repo, next);
}

// ── Crew member ─────────────────────────────────────────────────────────────

export async function createCrewMember(
  repo: Repository,
  crew: CrewMember,
): Promise<CrewMember> {
  if (crew.name.trim() === "") throw new Error("Crew member needs a name");
  if (crew.phone.trim() === "") throw new Error("Crew member needs a phone");
  await repo.saveCrewMember(crew);
  return crew;
}

export async function updateCrewMember(
  repo: Repository,
  id: CrewMemberId,
  patch: Patch<CrewMember>,
): Promise<CrewMember> {
  const current = await repo.getCrewMember(id);
  if (!current) throw new Error(`No crew member ${id}`);
  const next: CrewMember = { ...current, ...patch, id };
  return createCrewMember(repo, next);
}

// ── Credentials ──────────────────────────────────────────────────────────────

export async function addCredential(
  repo: Repository,
  credential: Credential,
): Promise<Credential> {
  const crew = await repo.getCrewMember(credential.crewMemberId);
  if (!crew) throw new Error(`No crew member ${credential.crewMemberId}`);
  // The door (DEC-DATA-1): expiry is operator-entered text the oracle date-checks
  // — a malformed "2026-13-99" must be rejected here, not silently persisted.
  assertIsoDate(credential.expiry, "credential.expiry");
  await repo.saveCredential(credential);
  return credential;
}

export async function updateCredential(
  repo: Repository,
  id: CredentialId,
  // A credential can't be re-pointed to another crew member by patch — that
  // would orphan it (invisible to listCredentialsForCrew). Move = remove + add.
  patch: Partial<Omit<Credential, "id" | "crewMemberId">>,
): Promise<Credential> {
  const current = await repo.getCredential(id);
  if (!current) throw new Error(`No credential ${id}`);
  const next: Credential = { ...current, ...patch, id };
  assertIsoDate(next.expiry, "credential.expiry");
  await repo.saveCredential(next);
  return next;
}

export async function removeCredential(
  repo: Repository,
  id: CredentialId,
): Promise<void> {
  await repo.removeCredential(id);
}
