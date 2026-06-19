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
import { TENANT_TIMEZONE, vesselDateOf } from "../config/tenant.js";
import { worstCredential } from "../admin/credential-health.js";
import type { CredentialConcern } from "../admin/credential-health.js";
import { summarizeStanding } from "./standing.js";
import type { CrewStandingView } from "./standing.js";

export type { CrewStandingView } from "./standing.js";
export type { CredentialConcern } from "../admin/credential-health.js";

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

/** One upcoming shift this crew member is on — confirmed, or claimed-and-pending. */
export interface MyShiftView {
  shiftId: string;
  seatId: string;
  vesselName: string;
  roleName: string;
  /** ISO-8601 date (vessel-local day). */
  date: string;
  /**
   * True when the seat is `Claimed` (the crew said "In" but the operator hasn't
   * confirmed yet) vs `Confirmed` (locked). Shown so a fresh "In" lands visibly
   * in My shifts instead of vanishing into nothing (#4); the surface labels it
   * "awaiting confirmation".
   */
  pending: boolean;
}

export interface CrewAppView {
  me: { id: string; name: string };
  asks: OpenAskView[];
  shifts: MyShiftView[];
  standing: CrewStandingView;
  /**
   * The crew member's own expiring/expired credential (§2.6, #57) — same
   * 60-day window and date boundary as the roster flag and the oracle's gate.
   * Null = nothing to say (the common case; no line renders).
   */
  credentialNudge: CredentialConcern | null;
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
  tz: string = TENANT_TIMEZONE,
): Promise<CrewAppView | null> {
  const me = await repo.getCrewMember(crewMemberId);
  if (!me) return null;

  // Vessel-local calendar date (DEC-032) — not the UTC date, which runs a day
  // ahead in the evening Eastern hours and would hide a still-upcoming shift.
  const today = vesselDateOf(now, tz);

  // Open asks: addressed to me, not yet RESPONDED, on a seat still being asked.
  // `respondedAt === undefined` (not `response === undefined`) is the live-ask
  // test used everywhere else — a timed-out/closed ask stamps respondedAt with
  // no response, and must NOT resurface as answerable (would double a re-asked
  // card alongside the fresh ask).
  const allAsks = await repo.listAllAsks();
  const mine = allAsks
    .filter((a) => a.crewMemberId === crewMemberId && a.respondedAt === undefined)
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

  // My shifts: seats I hold on an upcoming shift, soonest first. Includes both
  // Confirmed (locked) and Claimed (I said "In", operator hasn't confirmed yet —
  // #4: a fresh claim must show here, marked pending, not silently disappear).
  const allSeats = await repo.listAllSeats();
  const held = allSeats.filter(
    (s) =>
      (s.state === "Confirmed" || s.state === "Claimed") &&
      s.assignedCrewMemberId === crewMemberId,
  );
  const shifts: MyShiftView[] = [];
  for (const seat of held) {
    const shift = await repo.getShift(seat.shiftId);
    if (!shift || shift.date < today) continue; // past shifts drop off
    shifts.push({
      shiftId: shift.id,
      seatId: seat.id,
      vesselName: await vesselName(repo, shift.vesselId),
      roleName: await roleName(repo, seat.role),
      date: shift.date,
      pending: seat.state === "Claimed",
    });
  }
  shifts.sort((a, b) => a.date.localeCompare(b.date));

  // Standing: real, derived live from the reliability log (NOT the stored
  // reliabilityScore field — DEC-008/§1.4). Individual + non-comparative.
  const standing: CrewStandingView = summarizeStanding(
    await repo.reliabilityEventsFor(crewMemberId),
    now,
  );

  // Credential nudge (#57): their own renewals, same window/boundary as the
  // roster flag — individual and non-comparative, like everything else here.
  const credentialNudge = worstCredential(
    await repo.listCredentialsForCrew(crewMemberId),
    now,
  );

  return { me: { id: me.id, name: me.name }, asks, shifts, standing, credentialNudge };
}
