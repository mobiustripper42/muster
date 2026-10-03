/**
 * Crew check-in (Phase 18.5a, issue #1119) — the mate's screen for one departure, who may tick and
 * count, and the boat's limit on both. The page is `app/(crew)/crew/shift/[shiftId]/check-in/[eventId]`;
 * the spec is `docs/design/check-in-surfaces.md` §C and `docs/design/check-in-and-waivers.md` §3,
 * §4a, §7.
 *
 * **Three facts, independent** (spec §4): a guest SIGNED (their row exists), crew CHECKED THEM IN (a
 * tick), and the departure was COUNTED (the mate's number). None is derived from another. The count
 * covers people the list cannot, such as someone who never signed, so it is set, never summed.
 *
 * **The COI rule** (spec §4a): nothing recorded or shown passes the boat's passenger limit. A tick
 * at the limit is refused (`checkInGuestIfRoom` holds that under concurrency), the count stops at
 * it, and every number on the screen is capped at it. No message names the limit.
 *
 * **Nothing here blocks departure** (spec §8): a count can be set with guests unticked or unsigned.
 * Nor is anything read-only after the trip (operator, 2026-10-02: the captain's official log is
 * the record that locks; this screen stays a working list).
 */
import type { CrewMemberId, EventId, GuestId, ShiftId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { groupSignings, peopleSigned, type RowSigning } from "./duplicates.js";
import type { DepartureCount, Guest } from "./entities.js";
import { ageOn } from "./signing.js";

/** One person on the list — one row however many times they signed (18.6, `duplicates.ts`). */
export interface CheckInRow {
  /** The row's key: its earliest signing. */
  guestId: string;
  /** The name as typed, on the earliest signing. */
  name: string;
  /** A minor's age and who they came with — "(12) · w/ Robert". Absent on an adult. */
  detail?: string;
  /** Any of its signings is ticked. */
  checkedIn: boolean;
  /** Its signings, earliest first. Two or more is a likely duplicate, shown "×2"; a tap ticks one,
   *  and **Check in again** ticks the next when it was two people after all. */
  signings: RowSigning[];
}

/** What the mate's screen shows for one departure. */
export interface CheckInScreen {
  /** Everyone, alphabetical — the order both groups keep as a tap moves a row between them. */
  rows: CheckInRow[];
  /** Still to board, alphabetical. */
  toBoard: CheckInRow[];
  /** Checked in, alphabetical. */
  aboard: CheckInRow[];
  /** "6 CHECKED IN": signings ticked, so a ×2 ticked twice is two — capped at the limit. */
  checkedIn: number;
  /** "16 SIGNED": people on a signed waiver, a guarded minor included and a duplicate once
   *  (`peopleSigned`). Capped. */
  signed: number;
  /** The boat's passenger limit (COI max). */
  limit: number;
  /** The checked-in have reached the limit: the rows still to board take no more ticks. */
  full: boolean;
  /** Where the passenger stepper starts: the confirmed count once there is one, else the number
   *  signed (operator, 2026-10-02) — never above the limit. */
  startingCount: number;
}

export function buildCheckInScreen(
  guests: readonly Guest[],
  limit: number,
  count: DepartureCount | null,
  /** Boat-local `YYYY-MM-DD` — a minor's age is measured on it. */
  today: string,
): CheckInScreen {
  const byId = new Map(guests.map((g) => [String(g.id), g]));
  const rows = groupSignings(guests)
    .sort(
      (a, b) =>
        a[0]!.name.localeCompare(b[0]!.name, "en", { sensitivity: "base" }) || String(a[0]!.id).localeCompare(String(b[0]!.id)),
    )
    .map((group): CheckInRow => {
      const first = group[0]!;
      const detail = minorDetail(first, byId, today);
      const signings = group.map((g) => ({ guestId: String(g.id), checkedIn: Boolean(g.checkedIn) }));
      return {
        guestId: String(first.id),
        name: first.name,
        ...(detail ? { detail } : {}),
        checkedIn: signings.some((s) => s.checkedIn),
        signings,
      };
    });
  const checkedIn = guests.filter((g) => g.checkedIn).length;
  const people = peopleSigned(guests);
  return {
    rows,
    toBoard: rows.filter((r) => !r.checkedIn),
    aboard: rows.filter((r) => r.checkedIn),
    checkedIn: Math.min(checkedIn, limit),
    signed: Math.min(people, limit),
    limit,
    full: checkedIn >= limit,
    startingCount: Math.min(count ? count.pax : people, limit),
  };
}

/** "(12) · w/ Robert" for a minor; the age is dropped once retention has cleared the date of birth. */
function minorDetail(g: Guest, byId: ReadonlyMap<string, Guest>, today: string): string | undefined {
  if (!g.isMinor) return undefined;
  const parts: string[] = [];
  if (g.dob) parts.push(`(${ageOn(g.dob, today)})`);
  const guardian = g.guardianGuestId ? byId.get(String(g.guardianGuestId)) : undefined;
  const first = guardian?.name.trim().split(/\s+/)[0];
  if (first) parts.push(`w/ ${first}`);
  return parts.length ? parts.join(" · ") : undefined;
}

/** The departure a crew member may check in, with what the screen needs about it. */
export interface CheckInTrip {
  eventId: EventId;
  /** Boat-local `YYYY-MM-DD`. */
  date: string;
  /** Boat-local `HH:MM`. */
  time: string;
  vesselName: string;
  /** The boat's passenger limit (COI max); the departure's capacity if the boat's row is gone. */
  limit: number;
}

/**
 * Who may check a departure in: crew with a CONFIRMED seat on the shift, for a departure that
 * belongs to that shift — the shift card's own rule (`buildShiftCard`), so the button and the page
 * agree. Asked again on every write, not only when the page opens. Null for anyone else.
 */
export async function checkInTrip(
  repo: Repository,
  shiftId: ShiftId,
  eventId: EventId,
  crewId: CrewMemberId,
): Promise<CheckInTrip | null> {
  const shift = await repo.getShift(shiftId);
  if (!shift || !shift.eventIds.includes(eventId)) return null;
  const seats = await repo.listSeatsForShift(shiftId);
  if (!seats.some((s) => s.assignedCrewMemberId === crewId && s.state === "Confirmed")) return null;
  const event = await repo.getEvent(eventId);
  if (!event) return null;
  const vessel = await repo.getVessel(event.vesselId);
  return {
    eventId,
    date: event.date,
    time: event.time,
    vesselName: vessel?.name ?? String(event.vesselId),
    limit: vessel?.coiMaxPax ?? event.capacity,
  };
}

export type AboardResult = "ok" | "full" | "not_allowed" | "not_found";

/** Tick a guest aboard (`aboard: true`) or take the tick back. An untick is never refused for
 *  room; a tick at the limit is (`"full"`), and nothing is written. */
export async function setGuestAboard(
  repo: Repository,
  a: { shiftId: ShiftId; eventId: EventId; guestId: GuestId; crewId: CrewMemberId; aboard: boolean; now: string },
): Promise<AboardResult> {
  const trip = await checkInTrip(repo, a.shiftId, a.eventId, a.crewId);
  if (!trip) return "not_allowed";
  if (a.aboard) return repo.checkInGuestIfRoom(a.eventId, a.guestId, { at: a.now, by: a.crewId }, trip.limit);
  // The id came from a form: it must be a guest on THIS departure, or crew on one boat could
  // untick someone on another.
  const onTrip = (await repo.listGuestsForEvent(a.eventId)).some((g) => g.id === a.guestId);
  if (!onTrip) return "not_found";
  await repo.setGuestCheckIn(a.guestId, null);
  return "ok";
}

export type CountResult = "ok" | "bad_count" | "not_allowed";

/** Set the departure's passenger count: a whole number from 0 to the boat's limit. It replaces
 *  the last one — the number, the time and who counted (spec §6: the current value only). */
export async function setPassengerCount(
  repo: Repository,
  a: { shiftId: ShiftId; eventId: EventId; crewId: CrewMemberId; pax: number; now: string },
): Promise<CountResult> {
  const trip = await checkInTrip(repo, a.shiftId, a.eventId, a.crewId);
  if (!trip) return "not_allowed";
  if (!Number.isInteger(a.pax) || a.pax < 0 || a.pax > trip.limit) return "bad_count";
  await repo.setDepartureCount(a.eventId, { pax: a.pax, countedAt: a.now, countedBy: a.crewId });
  return "ok";
}
