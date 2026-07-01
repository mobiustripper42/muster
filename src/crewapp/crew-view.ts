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
import type { Shift } from "../domain/entities.js";
import { TENANT_TIMEZONE, vesselDateOf } from "../config/tenant.js";
import { worstCredential } from "../admin/credential-health.js";
import type { CredentialConcern } from "../admin/credential-health.js";
import { committedWindow } from "./shift-card.js";
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
  /** Earliest scheduled departure, "HH:mm" vessel-local — so the card shows WHEN
   * the shift is (can't answer In/Out without it). Undefined when no event
   * anchors the ask. */
  departureTime?: string;
  /** Shift end, "HH:mm" vessel-local (DEC-041) — latest departure + trip length
   * + call lead, the "how long am I committed" half of the In/Out decision (#92).
   * Undefined when no event anchors the ask, same as `departureTime`. */
  shiftEndTime?: string;
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
  /** The shift's working window — earliest departure / shift end, vessel-local
   * "HH:mm" (#216, DEC-041), so the card shows WHEN without opening it. Omitted
   * when no scheduled event anchors the shift. */
  departureTime?: string;
  shiftEndTime?: string;
  /**
   * True when the seat is `Claimed` (the crew said "In" but the operator hasn't
   * confirmed yet) vs `Confirmed` (locked). Shown so a fresh "In" lands visibly
   * in My shifts instead of vanishing into nothing (#4); the surface labels it
   * "awaiting confirmation".
   */
  pending: boolean;
  /**
   * True when the crew member holds this (`Confirmed`) seat but never accepted an
   * ask for it — the operator force-placed them (override / force-assign), so they
   * got no In/Out (#161). The surface flags it so a shift they didn't sign up for
   * isn't a silent surprise. A `Claimed` seat is self-accepted by definition, so
   * this only ever marks `Confirmed`.
   */
  addedByOperator: boolean;
  /** Others on this shift (#216) — who you're crewing with. Confirmed/Claimed
   * seats, excluding you. Empty on a solo / 0-crew shift. */
  coCrew: { name: string; roleName: string }[];
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
 * The committed working window for a shift — earliest scheduled departure and the
 * DEC-041 shift end. Shared by the ask card (§2.6.1) and My shifts (§2.6.2, #216)
 * so both show WHEN. Vessel-local "HH:mm"; a field is omitted when no scheduled
 * event anchors the shift.
 */
async function departureWindow(
  repo: Repository,
  shift: Shift,
): Promise<{ departureTime?: string; shiftEndTime?: string }> {
  const evs = [];
  for (const id of shift.eventIds) {
    const e = await repo.getEvent(id);
    if (e && e.status === "scheduled") evs.push(e);
  }
  evs.sort((a, b) => a.time.localeCompare(b.time));
  const departureTime = evs[0]?.time;
  const { shiftEndTime } = committedWindow(evs.map((e) => e.time));
  return {
    ...(departureTime ? { departureTime } : {}),
    ...(shiftEndTime ? { shiftEndTime } : {}),
  };
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
    // Earliest departure + shift end (vessel-local "HH:mm") so the card shows when.
    const window = await departureWindow(repo, shift);
    asks.push({
      askId: ask.id,
      seatId: seat.id,
      vesselName: await vesselName(repo, shift.vesselId),
      roleName: await roleName(repo, seat.role),
      date: shift.date,
      ...window,
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
    // #196: seat provenance decides the "Added for you" badge. An operator
    // override is a force-place → badge; a self-claim or an accepted ask is an
    // opt-in → no badge (the bug #196 fixes: a self-claim has no accepted ask, so
    // the old `!iAccepted` inference wrongly flagged it). For LEGACY seats with no
    // provenance recorded (pre-#196), fall back to that inference — a Confirmed
    // seat the holder never accepted an ask for was operator-placed (#161).
    const seatAsks = await repo.listAsksForSeat(seat.id);
    const iAccepted = seatAsks.some(
      (a) => a.crewMemberId === crewMemberId && a.response === "accepted",
    );
    const addedByOperator =
      seat.state === "Confirmed" &&
      (seat.acquiredVia === "operator" ||
        (seat.acquiredVia === undefined && !iAccepted));
    const window = await departureWindow(repo, shift);
    // Co-crew (#216): others holding a Confirmed/Claimed seat on this shift — who
    // you're running the day with. BrewBoat is 2 crew, so usually one name; dedupe
    // in case anyone holds two seats.
    const coCrew: { name: string; roleName: string }[] = [];
    const seen = new Set<string>();
    for (const other of allSeats) {
      const otherCrew = other.assignedCrewMemberId;
      if (
        other.shiftId !== shift.id ||
        (other.state !== "Confirmed" && other.state !== "Claimed") ||
        !otherCrew ||
        otherCrew === crewMemberId ||
        seen.has(otherCrew)
      )
        continue;
      seen.add(otherCrew);
      const cm = await repo.getCrewMember(otherCrew);
      if (cm) coCrew.push({ name: cm.name, roleName: await roleName(repo, other.role) });
    }
    // Stable order (code review): `listAllSeats` has no ORDER BY, so sort by name
    // — otherwise the truncated "+N" / "& " display could flicker across loads
    // once a shift carries 3+ crew (a no-op at BrewBoat's 2-crew scale).
    coCrew.sort((a, b) => a.name.localeCompare(b.name));
    shifts.push({
      shiftId: shift.id,
      seatId: seat.id,
      vesselName: await vesselName(repo, shift.vesselId),
      roleName: await roleName(repo, seat.role),
      date: shift.date,
      ...window,
      pending: seat.state === "Claimed",
      addedByOperator,
      coCrew,
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
