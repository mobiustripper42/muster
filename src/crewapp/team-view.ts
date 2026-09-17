/**
 * The team-schedule view (#968) — the read behind `/crew/open`'s display-only
 * lower section: which shifts are scheduled, when they leave, and who is on them.
 *
 * It exists because a fully-crewed fleet is the best possible state and the claim
 * list renders it as absence — the same "nothing here" a dead season or a failed
 * import would produce. The operator's words: *"I checked the available shifts and
 * it's always blank."* The answer is to show the schedule, not only the holes in it.
 *
 * Reuses `deriveAllShifts` (same shift model, Cancelled excluded, sorted date →
 * earliest departure → vessel) and narrows it to a CREW-appropriate DTO. The
 * narrowing is the point, so it is enumerated rather than left to a spread:
 *
 *   - **No guest anything.** `AllShiftsRow` carries `trips[].pax` and `paxTotal`;
 *     neither crosses. Same boundary `other-shifts.ts` already holds — a crew
 *     member sees who is working, never another shift's guests.
 *   - **No shift state.** `Pending/Filling/Crewed/AtRisk` stays on the operator's
 *     board. DEC-042 reserves warm/bad ink for At-Risk, and a crew surface that
 *     labels a boat "At Risk" has become a monitoring dashboard.
 *   - **Nothing that ranks a person** (DEC-008). An `Asked` seat is indistinguishable
 *     from an untouched one here, so the drip order — and who declined, and who
 *     ghosted — is unreadable from this screen. That is corrosive in a small crew
 *     and cannot be walked back once seen.
 *   - No split suggestions, fill deadlines, or the supernumerary distinction.
 *
 * Framework-free and data-only; the surface formats. `now` is injected.
 */

import { memoizingRepo } from "../adapters/memoizing-repo.js";
import type { Repository } from "../ports/repository.js";
import { deriveAllShifts } from "../admin/all-shifts.js";

/** One crew member aboard — name + role, the whole of what a peer may see. */
export interface TeamViewCrew {
  name: string;
  role: string;
}

/** One boat's day, as the crew section renders it. */
export interface TeamViewRow {
  shiftId: string;
  /** Vessel id — the edge keys the DEC-086 identity hue dot off this. */
  vesselId: string;
  vesselName: string;
  /** Operator-chosen vessel hue (DEC-086 palette index) — absent ⇒ the id-derived
   *  hue stands. */
  vesselHue?: number;
  /** ISO-8601 vessel-local date. */
  date: string;
  /** First scheduled departure, vessel-local "HH:mm"; null when none scheduled. */
  firstDeparture: string | null;
  /** How many scheduled trips this boat runs — "N trips" under the departure. */
  tripCount: number;
  /** Who is aboard, in the board's deterministic seat order; empty when nothing
   *  is crewed yet. Confirmed seats only — see `openRoles`. */
  crew: TeamViewCrew[];
  /**
   * Role names still unfilled, same order. A short-handed boat says so rather than
   * reading as fully crewed — but neutrally: no ink, no count-down, no claim
   * affordance. This section is display; claiming happens above it.
   *
   * "Unfilled" is `state !== "Confirmed"`, which deliberately folds `Open`, `Asked`,
   * `Bailed` and `Claimed` into one indistinguishable bucket. `Asked` and `Bailed`
   * are the DEC-008 privacy reason. `Claimed` is the DEC-075 confirm-gate seam: it
   * is unreachable today (a self-claim auto-locks straight to `Confirmed`), and if
   * that flag is ever set, a seat awaiting operator confirmation must not put
   * somebody's name on a boat they may yet be taken off.
   */
  openRoles: string[];
}

/**
 * Every non-cancelled boat-day in `[from, to]`, projected for crew. Sorted by the
 * inherited date → earliest departure → vessel name.
 *
 * **`memoizingRepo` is not an optimization here, it is the price of admission.**
 * `deriveAllShifts` is the ~480-round-trip fan-out named in the DoS review §4.4
 * and issue #960: it re-reads events and reservations per shift. The operator's
 * board absorbs that because one person opens it deliberately; this screen is meant
 * to be opened habitually by every crew member, which is a different load entirely.
 */
export async function buildTeamView(
  baseRepo: Repository,
  window: { from: string; to: string },
  now: Date,
): Promise<TeamViewRow[]> {
  const repo = memoizingRepo(baseRepo);
  const rows = await deriveAllShifts(repo, window, now);
  return rows.map((r) => ({
    shiftId: r.shiftId,
    vesselId: r.vesselId,
    vesselName: r.vesselName,
    ...(r.vesselHue !== undefined ? { vesselHue: r.vesselHue } : {}),
    date: r.date,
    firstDeparture: r.trips[0]?.time ?? null,
    tripCount: r.trips.length,
    crew: r.seats
      .filter((s) => s.crewName)
      .map((s) => ({ name: s.crewName as string, role: s.roleName })),
    openRoles: r.seats.filter((s) => !s.filled).map((s) => s.roleName),
  }));
}
