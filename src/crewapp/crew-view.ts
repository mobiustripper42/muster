/**
 * Crew-app view model (SPEC §2.6) — the read side of the crew member's world.
 *
 * "Insultingly small" (BRAND): a crew member sees their open ask(s), their
 * confirmed upcoming shifts, and their own standing. Nothing comparative, no
 * availability calendar, no dashboard. This module assembles that view from the
 * port; it is framework-free and data-only — formatting (dates, copy) is the
 * surface's job, so the same view drives web today and native later.
 *
 * The shift *card* (per-event manifest, call vs departure time — §2.6.3) is a
 * separate surface (#13); my-shifts here is the list that opens it.
 */

import type { CrewMemberId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

/** One open ask awaiting this crew member's In/Out. */
export interface OpenAskView {
  askId: string;
  seatId: string;
  /** Human context for the push line — vessel + role + date, formatted by the UI. */
  vesselName: string;
  roleName: string;
  /** ISO-8601 date of the shift (vessel-local day). */
  date: string;
  /** ISO-8601 UTC when the ask went out (for "answered fast" / ordering). */
  sentAt: string;
}

/** One confirmed upcoming shift this crew member is crewing. */
export interface MyShiftView {
  shiftId: string;
  seatId: string;
  vesselName: string;
  roleName: string;
  /** ISO-8601 date (vessel-local day). */
  date: string;
}

/**
 * The crew member's own reliability standing — individual, never comparative
 * (BRAND, DEC-008). MVP-thin: the score is null/flat, so this reads neutral and
 * says so plainly rather than inventing a grade.
 */
export interface CrewStandingView {
  hasHistory: boolean;
  /** Plain, neutral one-liner — "No history yet" or a neutral summary. */
  line: string;
}

export interface CrewAppView {
  me: { id: string; name: string };
  asks: OpenAskView[];
  shifts: MyShiftView[];
  standing: CrewStandingView;
}

/** Resolve a role type's display name, falling back to its id if it's gone. */
async function roleName(repo: Repository, roleId: string): Promise<string> {
  const rt = await repo.getRoleType(roleId as Parameters<Repository["getRoleType"]>[0]);
  return rt?.name ?? roleId;
}
async function vesselName(repo: Repository, vesselId: string): Promise<string> {
  const v = await repo.getVessel(vesselId as Parameters<Repository["getVessel"]>[0]);
  return v?.name ?? vesselId;
}

/**
 * Assemble the crew-app view for one crew member. Returns null if the crew member
 * doesn't exist (a stale/invalid session subject). `now` bounds "upcoming".
 */
export async function buildCrewAppView(
  repo: Repository,
  crewMemberId: CrewMemberId,
  now: Date,
): Promise<CrewAppView | null> {
  const me = await repo.getCrewMember(crewMemberId);
  if (!me) return null;

  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD, vessel-local-day grain

  // Open asks: addressed to me, not yet answered, on a seat still being asked.
  const allAsks = await repo.listAllAsks();
  const mine = allAsks
    .filter((a) => a.crewMemberId === crewMemberId && a.response === undefined)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const asks: OpenAskView[] = [];
  for (const ask of mine) {
    const seat = await repo.getSeat(ask.seatId);
    if (!seat || seat.state !== "Asked") continue; // resolved/contested — drop it
    const shift = await repo.getShift(seat.shiftId);
    if (!shift) continue;
    asks.push({
      askId: ask.id,
      seatId: seat.id,
      vesselName: await vesselName(repo, shift.vesselId),
      roleName: await roleName(repo, seat.role),
      date: shift.date,
      sentAt: ask.sentAt,
    });
  }

  // My shifts: seats confirmed to me, on an upcoming shift, soonest first.
  const allSeats = await repo.listAllSeats();
  const confirmed = allSeats.filter(
    (s) => s.state === "Confirmed" && s.assignedCrewMemberId === crewMemberId,
  );
  const shifts: MyShiftView[] = [];
  for (const seat of confirmed) {
    const shift = await repo.getShift(seat.shiftId);
    if (!shift || shift.date < today) continue; // past shifts drop off
    shifts.push({
      shiftId: shift.id,
      seatId: seat.id,
      vesselName: await vesselName(repo, shift.vesselId),
      roleName: await roleName(repo, seat.role),
      date: shift.date,
    });
  }
  shifts.sort((a, b) => a.date.localeCompare(b.date));

  // Standing: MVP-thin. null score = no history → neutral, stated plainly.
  const standing: CrewStandingView =
    me.reliabilityScore === null
      ? { hasHistory: false, line: "No history yet — you read neutral." }
      : { hasHistory: true, line: "In good standing." };

  return { me: { id: me.id, name: me.name }, asks, shifts, standing };
}
