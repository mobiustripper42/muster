/**
 * The ask trail — an operator-facing read-model of every ask the engine fired
 * (#331, promoted from FUTURE_IDEAS; the browse half). "Who · which seat/shift ·
 * when · via what channel · what they answered and when," filterable per shift /
 * per crew / per day.
 *
 * Derived, not stored (the escalation-trail idiom): there is no ask-history
 * aggregate. Every fact already persists on the `Ask` rows (DEC-008 "log day
 * one") — `seatId` / `crewMemberId` / `channel` / `sentAt` / `respondedAt` /
 * `response` — and re-asks (including a Tier-2 nudge, which IS an ask) accumulate
 * as separate rows. So the timeline that took a raw prod query to reconstruct on
 * 2026-07-09 (broadcast → timed out → nudge → declined; and the same person
 * nudged twice) is just this projection, sorted newest-first. Pure over the port:
 * only existing reads, no DDL, identical on both adapters.
 *
 * v1 is Ask rows alone — enough to answer "what got sent to me, and when." The
 * `reliability_events` cross-ref (pool_widened, etc.) and the per-delivery record
 * (Twilio SID / deliveredAt — #336) are follow-ons, not folded in here.
 */

import type { Ask, AskChannel, AskResponse } from "../domain/entities.js";
import type { AskId, CrewMemberId, ShiftId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

/**
 * What became of one ask — the derived status the surface colors. `timed_out` = a
 * stamped `respondedAt` with no `response` (the ghost/silent case).
 *
 * `withdrawn` (#600) = the seat was filled while this ask was still out, so it was
 * retired unanswered. **Distinct from `timed_out`**, which means we waited and they
 * said nothing and carries an `ask_ignored` penalty. Before #600 a withdrawn ask
 * had no representation and read as `timed_out` — the trail accused people of
 * ghosting an ask that had stopped being answerable.
 */
export type AskOutcome =
  | "accepted"
  | "declined"
  | "timed_out"
  | "withdrawn"
  | "waiting";

export interface AskTrailRow {
  askId: AskId;
  crewMemberId: CrewMemberId;
  crewName: string;
  /** Resolved from the seat → its shift. Null if the seat/shift is gone (no-FK). */
  shiftId: ShiftId | null;
  date: string | null;
  vesselName: string | null;
  roleName: string | null;
  channel: AskChannel;
  sentAt: string;
  respondedAt?: string;
  response?: AskResponse;
  outcome: AskOutcome;
}

export interface AskTrailFilter {
  crewMemberId?: CrewMemberId;
  /** The shift being staffed (via the ask's seat), not where the ask was sent. */
  shiftId?: ShiftId;
  /** Trip date (`YYYY-MM-DD`) — the shift's date, not the ask's send date. */
  day?: string;
}

const outcomeOf = (ask: Ask): AskOutcome =>
  ask.response === "accepted"
    ? "accepted"
    : ask.response === "declined"
      ? "declined"
      : ask.response === "withdrawn"
        ? "withdrawn"
        : ask.respondedAt
          ? "timed_out"
          : "waiting";

/**
 * Build the ask trail, newest ask first. Resolves each ask's seat → shift for the
 * date/vessel/role labels, then applies the filter (crew / shift / day). Name and
 * seat maps are built once up front (the deriveAllShifts idiom) so the projection
 * doesn't re-join per ask.
 */
export async function buildAskTrail(
  repo: Repository,
  filter: AskTrailFilter = {},
): Promise<AskTrailRow[]> {
  const [asks, crew, vessels, roles, shifts] = await Promise.all([
    repo.listAllAsks(),
    repo.listCrewMembers(),
    repo.listVessels(),
    repo.listAllRoleTypes(),
    repo.listShifts(),
  ]);

  const crewName = new Map(crew.map((c) => [String(c.id), c.name]));
  const vesselName = new Map(vessels.map((v) => [String(v.id), v.name]));
  const roleName = new Map(roles.map((r) => [String(r.id), r.name]));
  const shiftById = new Map(shifts.map((s) => [String(s.id), s]));

  // seatId → { shiftId, roleTypeId } — one listSeatsForShift per shift (pilot
  // scale; revisit with a listAllSeats read if the trail ever sorts at DB scale).
  const seatIndex = new Map<string, { shiftId: ShiftId; role: string }>();
  await Promise.all(
    shifts.map(async (s) => {
      for (const seat of await repo.listSeatsForShift(s.id)) {
        seatIndex.set(String(seat.id), { shiftId: s.id, role: String(seat.role) });
      }
    }),
  );

  const rows: AskTrailRow[] = [];
  for (const ask of asks) {
    if (filter.crewMemberId && ask.crewMemberId !== filter.crewMemberId) continue;

    const seat = seatIndex.get(String(ask.seatId));
    const shift = seat ? shiftById.get(String(seat.shiftId)) : undefined;

    if (filter.shiftId && seat?.shiftId !== filter.shiftId) continue;
    if (filter.day && shift?.date !== filter.day) continue;

    rows.push({
      askId: ask.id,
      crewMemberId: ask.crewMemberId,
      crewName: crewName.get(String(ask.crewMemberId)) ?? "(unknown crew)",
      shiftId: seat?.shiftId ?? null,
      date: shift?.date ?? null,
      vesselName: shift ? vesselName.get(String(shift.vesselId)) ?? null : null,
      roleName: seat ? roleName.get(seat.role) ?? null : null,
      channel: ask.channel,
      sentAt: ask.sentAt,
      ...(ask.respondedAt !== undefined ? { respondedAt: ask.respondedAt } : {}),
      ...(ask.response !== undefined ? { response: ask.response } : {}),
      outcome: outcomeOf(ask),
    });
  }

  // Newest ask first — the operator scans "what just went out" from the top.
  return rows.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}
