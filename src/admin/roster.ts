/**
 * Roster list view (SPEC §2.1 "States to render → Roster list").
 *
 * Builds the per-person rows Spink scans for pool health: name, what they're
 * rated for (role names, resolved from RoleType data — DEC-ROLE-1), their
 * reliability standing, and a credential-health flag. Expired/expiring
 * credentials are visible at the list level by design (SPEC §2.1).
 *
 * Rendering is split in two: `buildRoster` returns structured rows (what the M4
 * web surface will consume), `renderRoster` is a thin text table so the view is
 * demonstrable before the stack exists. `now` is injected — the core never reads
 * the clock.
 */

import type { CrewMember } from "../domain/entities.js";
import type { CrewMemberId, RoleTypeId, TenantId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import {
  type CredentialHealth,
  credentialHealth,
  EXPIRING_SOON_DAYS,
} from "./credential-health.js";

/**
 * Reliability standing as shown on the roster (SPEC §2.1, §1.4). Cold-start crew
 * read **neutral** with an explicit "no history yet" — not a misleading low. The
 * real scorer (bands from a computed number) lands in Phase 2; until then every
 * crew member is cold-start neutral.
 */
export type StandingBand = "neutral" | "high" | "medium" | "low";

export interface Standing {
  band: StandingBand;
  /** Human-readable note shown beside the band (SPEC §1.4 reasons). */
  note: string;
}

/** Map a (possibly absent) reliability score to a display standing. */
export function standingOf(score: number | null): Standing {
  if (score === null) return { band: "neutral", note: "no history yet" };
  // Provisional bands — the real ranking is Phase 2 (Pass A). Ordering here is
  // arbitrary-but-stable so the roster has something to show for seeded scores.
  if (score >= 0.75) return { band: "high", note: `score ${score}` };
  if (score >= 0.4) return { band: "medium", note: `score ${score}` };
  return { band: "low", note: `score ${score}` };
}

export interface RosterRow {
  crewMemberId: CrewMemberId;
  name: string;
  /** Role names this person is rated for, resolved from RoleType data. */
  ratings: string[];
  standing: Standing;
  credentialHealth: CredentialHealth;
}

export async function buildRoster(
  repo: Repository,
  tenantId: TenantId,
  now: Date,
  windowDays: number = EXPIRING_SOON_DAYS,
): Promise<RosterRow[]> {
  const roleTypes = await repo.listRoleTypes(tenantId);
  const roleName = new Map<RoleTypeId, string>(
    roleTypes.map((r) => [r.id, r.name]),
  );
  const resolveRatings = (crew: CrewMember): string[] =>
    crew.ratings.map((id) => roleName.get(id) ?? "unknown");

  const crew = await repo.listCrewMembers();
  const rows = await Promise.all(
    crew.map(async (member): Promise<RosterRow> => {
      const creds = await repo.listCredentialsForCrew(member.id);
      return {
        crewMemberId: member.id,
        name: member.name,
        ratings: resolveRatings(member),
        standing: standingOf(member.reliabilityScore),
        credentialHealth: credentialHealth(creds, now, windowDays),
      };
    }),
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

const HEALTH_LABEL: Record<CredentialHealth, string> = {
  valid: "valid",
  expiring_soon: "expiring-soon",
  expired: "EXPIRED",
};

/** Thin text rendering of the roster — one line per crew member. */
export function renderRoster(rows: RosterRow[]): string {
  if (rows.length === 0) return "(no crew)";
  return rows
    .map((r) => {
      const ratings = r.ratings.join("/") || "unrated";
      return `${r.name}  [${ratings}]  standing:${r.standing.band} (${r.standing.note})  credentials:${HEALTH_LABEL[r.credentialHealth]}`;
    })
    .join("\n");
}
