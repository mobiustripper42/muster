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
import { CLAIMABLE_WINDOW_DAYS } from "../oracle/claimable.js";
import { addDays, vesselDateOf } from "../config/tenant.js";

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
   * Required seats only — an unfilled supernumerary (trainee) seat is an optional
   * extra rather than a gap, the same required-only definition `all-shifts.ts` keeps
   * for its fill counts.
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
 * **The caller's window only ever narrows.** It is intersected with
 * `[today, today+CLAIMABLE_WINDOW_DAYS]` here, not trusted — `range` arrives from
 * `searchParams`, whose only guard is an HTML `min`/`max` on a date input, which is
 * a hint to a browser and nothing to a URL. `claimableSeatsFor` has enforced this
 * same clamp internally since DEC-074; without it the section *below* the claim list
 * is the way around the guardrail the claim list has.
 *
 * That matters more here than it looks: `deriveAllShifts` carries the read fan-out
 * of issue #960, and `?from=2000-01-01&to=2099-12-31` would run it over every shift
 * the fleet has ever had — on a screen meant to be opened habitually by everyone.
 *
 * `memoizingRepo` collapses part of that fan-out, not all of it. It caches the
 * table-wide reads (`listShifts`, `listEvents`, `listCrewMembers`, `listAllSeats`)
 * and the per-shift `listSeatsForShift`/`getShift`; `getEvent` and
 * `listReservationsForEvent` are not cached and still run per event. The clamp above
 * is what bounds the cost — the wrapper only flattens it.
 */
export async function buildTeamView(
  baseRepo: Repository,
  window: { from: string; to: string },
  now: Date,
): Promise<TeamViewRow[]> {
  const repo = memoizingRepo(baseRepo);
  // Vessel-local "today" (DEC-032), matching `claimableSeatsFor` — a UTC slice would
  // slide the window a day in the evening Eastern hours.
  const today = vesselDateOf(now);
  const clamped = {
    from: window.from > today ? window.from : today,
    to: window.to < addDays(today, CLAIMABLE_WINDOW_DAYS)
      ? window.to
      : addDays(today, CLAIMABLE_WINDOW_DAYS),
  };
  const rows = await deriveAllShifts(repo, clamped, now);
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
    // Required only, mirroring `all-shifts.ts`'s fill counts: a trainee seat is an
    // optional extra, not a boat that needs a body. Folding both in would make a
    // fully-crewed boat read as short-handed.
    openRoles: r.seats
      .filter((s) => !s.filled && !s.supernumerary)
      .map((s) => s.roleName),
  }));
}
