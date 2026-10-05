/**
 * The departure page (Phase 18.8, issue #1122) — for one departure: who signed which waiver and
 * when, who was checked in, and the count. Also the Waivers card on the calendar's booking pane,
 * and the integrity page's list of departures counted above their checked-in guests. The page is
 * `app/(admin)/admin/departure/[eventId]`; the spec is on issue #1122 and
 * `docs/design/check-in-and-waivers.md` §8, §10.
 *
 * Two ways in (operator, 2026-10-04): a periodic look at `/admin/integrity` that leads to a trip
 * that doesn't add up, and "a guest from the Oct 14 cruise wants to sue — what did they sign?" The
 * second is why every signing's details and the exact waiver words it accepted are here.
 *
 * **One set of numbers.** Signed and checked in come from the mate's own screen builder
 * (`buildCheckInScreen`), so a duplicate counts once, a guarded minor counts, and nothing passes
 * the boat's limit (spec §4a) — the same as at the gangway. Every name is still listed.
 *
 * **Read only, and nothing blocks** (spec §8). The warning says what the record shows: people
 * aboard who were never ticked. It cannot say they were unsigned, because someone may have signed
 * and simply not been ticked.
 */
import { formatClock, formatShortDay } from "../reservations/availability-screen.js";
import { vesselClockOf, vesselDateOf } from "../config/tenant.js";
import type { CrewMember, Event, Reservation, Vessel } from "../domain/entities.js";
import type { EventId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { buildCheckInScreen } from "./check-in.js";
import type { DepartureCount, Guest, WaiverTemplate } from "./entities.js";
import { effectiveDateOf } from "./waiver-admin.js";

/** The departure page's path. Muster's departure ids carry `|` and `:`, so the id is encoded. */
export const departureHref = (eventId: EventId | string): string =>
  `/admin/departure/${encodeURIComponent(String(eventId))}`;

// ── Formatting, on the boat's clock (DEC-032) ────────────────────────────────

/** "Oct 10" from a boat-local `YYYY-MM-DD` — {@link formatShortDay} without the weekday. */
function monthDay(date: string): string {
  return new Date(`${date}T12:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Apr 2, 1980" from a `YYYY-MM-DD`. */
function longDate(date: string): string {
  return new Date(`${date}T12:00:00.000Z`).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
}

/** "2:58 PM" on the trip's own day, else "Oct 11, 9:10 AM". */
function whenOn(iso: string, tripDate: string): string {
  const at = new Date(iso);
  const clock = formatClock(vesselClockOf(at));
  const day = vesselDateOf(at);
  return day === tripDate ? clock : `${monthDay(day)}, ${clock}`;
}

/** "Oct 2, 7:14 PM" — always with the date. */
function stamp(iso: string): string {
  const at = new Date(iso);
  return `${monthDay(vesselDateOf(at))}, ${formatClock(vesselClockOf(at))}`;
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;
const DASH = "—";

/** The trip, as every check-in screen states it: "Hops · Sat, Oct 10 · 3:00 PM". */
function tripLabel(event: Event, vesselName: string): string {
  return `${vesselName} · ${formatShortDay(event.date)} · ${formatClock(event.time)}`;
}

/**
 * The exception, in words — the departure page and the integrity page say it the same way. Absent
 * unless the count is above the checked-in number.
 */
export function aboveCheckedInWarning(counted: number, checkedIn: number): string | undefined {
  if (counted <= checkedIn) return undefined;
  return `${counted - checkedIn} more aboard than were checked in. They may be unsigned, or signed and not ticked.`;
}

// ── The departure page ───────────────────────────────────────────────────────

export interface DepartureInput {
  event: Event;
  /** Absent if the boat's row is gone: the departure's capacity stands in for the limit. */
  vessel: Vessel | undefined;
  reservations: readonly Reservation[];
  guests: readonly Guest[];
  count: DepartureCount | null;
  /** Crew member id → full name, for who counted and who ticked. */
  crewNames: ReadonlyMap<string, string>;
  /** At least every version a guest on this trip signed. */
  templates: readonly WaiverTemplate[];
  /** The cruise's name, when a booking says which it is. A departure carries no offering of its own. */
  cruise?: string | undefined;
}

export interface DepartureBooking {
  name: string;
  href: string;
  cancelled: boolean;
}

/** One signing's evidence, for **Details**. */
export interface SigningDetail {
  guestId: string;
  /** "Signed Oct 2, 7:14 PM", or "Signed for by Robert Smith" on a minor. */
  heading: string;
  rows: { label: string; value: string }[];
}

export interface DeparturePerson {
  /** The row's key: its earliest signing. */
  key: string;
  name: string;
  /** Signings grouped as one person — "×2" when more than one. */
  times: number;
  /** A minor's "(12) · w/ Robert". */
  detail?: string;
  signedLine: string;
  checkedInLine: string;
  checkedIn: boolean;
  signings: SigningDetail[];
}

export interface DepartureVersion {
  id: string;
  /** "Version of Sep 1, 2026 · 14 signed". */
  label: string;
  /** The version's own name, as posted on `/admin/waivers`. */
  version: string;
  body: string;
}

export interface DepartureView {
  heading: string;
  cruise?: string;
  bookings: DepartureBooking[];
  countLine: string;
  numbersLine: string;
  warning?: string;
  people: DeparturePerson[];
  versions: DepartureVersion[];
}

export function buildDepartureView(input: DepartureInput): DepartureView {
  const { event, guests, count, crewNames } = input;
  const limit = input.vessel?.coiMaxPax ?? event.capacity;
  // A minor's age is measured on the trip's day: this is the record of that departure.
  const screen = buildCheckInScreen(guests, limit, count, event.date);
  const byId = new Map(guests.map((g) => [String(g.id), g]));
  const templates = new Map(input.templates.map((t) => [String(t.id), t]));
  const versionDay = (id: string | undefined): string => {
    const t = id ? templates.get(id) : undefined;
    return t ? longDate(effectiveDateOf(t)) : DASH;
  };
  const nameOf = (crewId: string): string => crewNames.get(crewId) ?? "crew";

  const people = screen.rows.map((row): DeparturePerson => {
    const signings = row.signings.map((s) => byId.get(s.guestId)).filter((g): g is Guest => g !== undefined);
    const guardian = (g: Guest) => (g.guardianGuestId ? byId.get(String(g.guardianGuestId)) : undefined);
    const headingOf = (g: Guest): string => {
      if (g.signedAt) return `Signed ${stamp(g.signedAt)}`;
      const by = guardian(g);
      return by ? `Signed for by ${by.name}` : "Signed for by an adult";
    };
    const ticked = signings.find((g) => g.checkedIn)?.checkedIn;
    return {
      key: row.guestId,
      name: row.name,
      times: signings.length,
      ...(row.detail ? { detail: row.detail } : {}),
      signedLine: signings[0] ? headingOf(signings[0]) : "",
      checkedInLine: ticked
        ? `✓ Checked in ${whenOn(ticked.at, event.date)} by ${firstName(nameOf(String(ticked.by)))}`
        : "Not checked in",
      checkedIn: Boolean(ticked),
      signings: signings.map((g) => ({
        guestId: String(g.id),
        heading: headingOf(g),
        rows: [
          { label: "Email", value: g.email ?? DASH },
          { label: "Mobile", value: g.phone ?? DASH },
          { label: "Date of birth", value: g.dob ? longDate(g.dob) : DASH },
          {
            label: "Waiver version",
            // A minor signs nothing: the words they are covered by are the adult's.
            value: versionDay(String((g.signedAt ? g : guardian(g))?.waiverTemplateId ?? "") || undefined),
          },
          { label: "Device", value: g.signedUserAgent ?? DASH },
          { label: "Network address", value: g.signedIp ?? DASH },
        ],
      })),
    };
  });

  // Each version someone on this trip signed, oldest first, with how many signatures it carries.
  const signedPer = new Map<string, number>();
  for (const g of guests) {
    if (g.signedAt && g.waiverTemplateId) {
      const id = String(g.waiverTemplateId);
      signedPer.set(id, (signedPer.get(id) ?? 0) + 1);
    }
  }
  const versions = input.templates
    .filter((t) => signedPer.has(String(t.id)))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    .map((t) => ({
      id: String(t.id),
      label: `Version of ${longDate(effectiveDateOf(t))} · ${signedPer.get(String(t.id))} signed`,
      version: t.version,
      body: t.body,
    }));

  const counted = count ? Math.min(count.pax, limit) : null;
  const warning = counted === null ? undefined : aboveCheckedInWarning(counted, screen.checkedIn);
  return {
    heading: tripLabel(event, input.vessel?.name ?? String(event.vesselId)),
    ...(input.cruise ? { cruise: input.cruise } : {}),
    bookings: input.reservations.map((r) => ({
      name: r.customerName,
      href: `/admin/calendar/${encodeURIComponent(String(r.id))}?date=${event.date}`,
      cancelled: r.status === "cancelled",
    })),
    countLine: count
      ? `${counted} aboard · counted ${whenOn(count.countedAt, event.date)} by ${nameOf(String(count.countedBy))}`
      : "Not counted yet.",
    numbersLine: `${screen.signed} signed · ${screen.checkedIn} checked in`,
    ...(warning ? { warning } : {}),
    people,
    versions,
  };
}

/** Everything the departure page reads, for one departure. Null when the departure doesn't exist. */
export async function loadDepartureView(repo: Repository, eventId: EventId): Promise<DepartureView | null> {
  const event = await repo.getEvent(eventId);
  if (!event) return null;
  const [vessel, reservations, guests, count] = await Promise.all([
    repo.getVessel(event.vesselId),
    repo.listReservationsForEvent(eventId),
    repo.listGuestsForEvent(eventId),
    repo.getDepartureCount(eventId),
  ]);
  const crewIds = new Set<string>();
  if (count) crewIds.add(String(count.countedBy));
  for (const g of guests) if (g.checkedIn) crewIds.add(String(g.checkedIn.by));
  const templateIds = new Set(guests.flatMap((g) => (g.waiverTemplateId ? [String(g.waiverTemplateId)] : [])));
  const offeringId = reservations.find((r) => r.status !== "cancelled" && r.offeringId)?.offeringId;
  const [crew, templates, offering] = await Promise.all([
    Promise.all([...crewIds].map((id) => repo.getCrewMember(id as CrewMember["id"]))),
    Promise.all([...templateIds].map((id) => repo.getWaiverTemplate(id as WaiverTemplate["id"]))),
    offeringId ? repo.getOffering(offeringId) : Promise.resolve(null),
  ]);
  return buildDepartureView({
    cruise: offering?.name,
    event,
    vessel: vessel ?? undefined,
    reservations,
    guests,
    count,
    crewNames: new Map(crew.flatMap((c) => (c ? [[String(c.id), c.name] as const] : []))),
    templates: templates.filter((t): t is WaiverTemplate => t !== null),
  });
}

// ── The Waivers card on the calendar's booking pane ──────────────────────────

export interface WaiverCardLines {
  signed: string;
  counted: string;
}

export function waiverCardLines(a: {
  signed: number;
  checkedIn: number;
  count: DepartureCount | null;
  counterName: string | undefined;
  /** The departure's boat-local day: a count set on another day shows its date. */
  tripDate: string;
}): WaiverCardLines {
  return {
    signed: a.signed === 0 ? "Nobody has signed yet." : `${a.signed} · ${a.checkedIn} checked in`,
    counted: a.count
      ? `${a.count.pax} aboard · ${whenOn(a.count.countedAt, a.tripDate)} by ${firstName(a.counterName ?? "crew")}`
      : "Not yet.",
  };
}

/** The card's lines for one departure, and where "See waivers ›" goes. */
export async function loadWaiverCard(repo: Repository, event: Event): Promise<WaiverCardLines & { href: string }> {
  const [vessel, guests, count] = await Promise.all([
    repo.getVessel(event.vesselId),
    repo.listGuestsForEvent(event.id),
    repo.getDepartureCount(event.id),
  ]);
  const limit = vessel?.coiMaxPax ?? event.capacity;
  const screen = buildCheckInScreen(guests, limit, count, event.date);
  const counter = count ? await repo.getCrewMember(count.countedBy) : null;
  return {
    ...waiverCardLines({
      signed: screen.signed,
      checkedIn: screen.checkedIn,
      count: count ? { ...count, pax: Math.min(count.pax, limit) } : null,
      counterName: counter?.name,
      tripDate: event.date,
    }),
    href: departureHref(event.id),
  };
}

// ── The integrity page's list ────────────────────────────────────────────────

export interface CountedAboveRow {
  /** "Hops · Sat, Oct 10 · 3:00 PM — counted 16, checked in 12". */
  label: string;
  href: string;
}

export function countedAboveHeadline(n: number): string {
  return n === 1
    ? "One departure counted more people than were checked in."
    : `${n} departures counted more people than were checked in.`;
}

/** Every departure counted above its checked-in guests, latest first, named and linked. */
export async function loadCountedAboveCheckedIn(repo: Repository): Promise<CountedAboveRow[]> {
  const rows = await repo.listDeparturesCountedAboveCheckedIn();
  return Promise.all(
    rows.map(async (r) => {
      const event = await repo.getEvent(r.eventId);
      const vessel = event ? await repo.getVessel(event.vesselId) : null;
      const trip = event ? tripLabel(event, vessel?.name ?? String(event.vesselId)) : String(r.eventId);
      return {
        label: `${trip} — counted ${r.count.pax}, checked in ${r.checkedIn}`,
        href: departureHref(r.eventId),
      };
    }),
  );
}
