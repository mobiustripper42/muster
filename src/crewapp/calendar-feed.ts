/**
 * Crew iCal calendar feed (#355, DEC-098) — the data + RFC-5545 rendering behind a
 * crew member's subscribable `.ics` URL. Their confirmed shifts land in Google/Apple
 * Calendar automatically (push, not pull), re-synced on each client poll.
 *
 * Framework-free and data-only, like the rest of `crewapp`: the route resolves the
 * token → crew id and the app-side config (tenant name, base URL), then calls in.
 *
 * **PII boundary (DEC-098, load-bearing).** The feed lives on third-party calendar
 * servers behind a forwardable bearer URL, so it carries only the *skeleton* — vessel,
 * the viewer's own role, the committed call→end window, dock, and co-crew FIRST names.
 * The guest manifest (names, phones) and co-crew phone numbers NEVER enter the .ics;
 * they stay behind the authenticated app. The DESCRIPTION ends with a deep link back.
 *
 * **Times are UTC instants** (DEC-098, a documented DEC-032 render exception): a VEVENT
 * is an absolute instant each client renders in its own zone, and a hand-rolled
 * VTIMEZONE is the classic ICS footgun. Start/end come from the DEC-041 committed
 * window via the instant-returning `derive` helpers (midnight-safe).
 */

import type { CrewMemberId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import type { Event } from "../domain/entities.js";
import { TENANT_TIMEZONE, addDays, vesselDateOf } from "../config/tenant.js";
import {
  CALL_LEAD_MINUTES,
  earliestScheduledStart,
  shiftEndFromEvents,
} from "../builder/derive.js";

const MINUTE_MS = 60_000;
/** Past-shift retention: a just-finished shift lingers this many days so it doesn't
 *  vanish from the calendar the instant it ends (architect #355). */
const RETENTION_DAYS = 7;

/** One VEVENT's facts — instants plus the PII-safe skeleton (DEC-098). */
export interface FeedEvent {
  /** Stable per shift id → re-polls UPDATE the event rather than duplicating it. */
  uid: string;
  /** Call/report time instant (DEC-041 committed-window start). */
  start: Date;
  /** Shift-end instant (DEC-041 committed-window end). */
  end: Date;
  vesselName: string;
  roleName: string;
  /** A supernumerary/trainee ride — still a real "be there", labelled "(training)". */
  training: boolean;
  /** Dock, when the shift's earliest event carries one. */
  dock?: string;
  /** Co-crew FIRST names only (PII boundary) — who you're running the day with. */
  coCrewFirstNames: string[];
}

export interface CalendarFeedData {
  crewName: string;
  events: FeedEvent[];
}

/**
 * Assemble a crew member's confirmed-shift feed. Returns null if the crew member
 * doesn't exist (a revoked/rotated token whose crew row is gone). Confirmed seats
 * only (a tentative Claimed isn't a calendar commitment); window = today−7d forward,
 * self-bounding on the far end (confirmed seats don't run out to infinity).
 */
export async function buildCalendarFeed(
  repo: Repository,
  crewMemberId: CrewMemberId,
  now: Date,
  tz: string = TENANT_TIMEZONE,
): Promise<CalendarFeedData | null> {
  const me = await repo.getCrewMember(crewMemberId);
  if (!me) return null;

  const floor = addDays(vesselDateOf(now, tz), -RETENTION_DAYS);

  const allSeats = await repo.listAllSeats();
  const mine = allSeats.filter(
    (s) => s.state === "Confirmed" && s.assignedCrewMemberId === crewMemberId,
  );

  const events: FeedEvent[] = [];
  for (const seat of mine) {
    const shift = await repo.getShift(seat.shiftId);
    if (!shift || shift.date < floor) continue;
    // A live regen shouldn't emit a killed/done shift even if a stale seat lingers.
    if (shift.state === "Cancelled" || shift.state === "Completed") continue;

    const evs: Event[] = [];
    for (const id of shift.eventIds) {
      const e = await repo.getEvent(id);
      if (e && e.status === "scheduled") evs.push(e);
    }
    const depart = earliestScheduledStart(evs, tz);
    const end = shiftEndFromEvents(evs, tz);
    if (!depart || !end) continue; // no scheduled event anchors the shift
    const start = new Date(depart.getTime() - CALL_LEAD_MINUTES * MINUTE_MS);

    // Co-crew: others holding a Confirmed/Claimed seat here. FIRST names only —
    // no phones, no manifest (DEC-098 PII boundary). Dedupe (someone could hold two).
    const coCrewFirstNames: string[] = [];
    const seen = new Set<string>();
    for (const other of allSeats) {
      const oc = other.assignedCrewMemberId;
      if (
        other.shiftId !== shift.id ||
        !oc ||
        oc === crewMemberId ||
        seen.has(oc) ||
        (other.state !== "Confirmed" && other.state !== "Claimed")
      )
        continue;
      seen.add(oc);
      const cm = await repo.getCrewMember(oc);
      if (cm) coCrewFirstNames.push(cm.name.split(/\s+/)[0] ?? cm.name);
    }
    coCrewFirstNames.sort((a, b) => a.localeCompare(b));

    const vessel = await repo.getVessel(shift.vesselId);
    const role = await repo.getRoleType(seat.role);
    const dock = [...evs].sort((a, b) => a.time.localeCompare(b.time))[0]?.dock;

    events.push({
      uid: String(shift.id),
      start,
      end,
      vesselName: vessel?.name ?? String(shift.vesselId),
      roleName: role?.name ?? String(seat.role),
      training: seat.kind === "supernumerary",
      ...(dock ? { dock } : {}),
      coCrewFirstNames,
    });
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { crewName: me.name, events };
}

// ── RFC-5545 rendering ───────────────────────────────────────────────────────

export interface RenderOpts {
  /** X-WR-CALNAME — what the calendar app titles the subscription. */
  calendarName: string;
  /** App origin for the DESCRIPTION deep link (no trailing slash). */
  appBaseUrl: string;
  /** DTSTAMP / LAST-MODIFIED — when this render happened. */
  now: Date;
  /** UID domain suffix (stable — do not vary per render). */
  uidDomain?: string;
}

/** A Date as an ICS UTC instant: `YYYYMMDDTHHMMSSZ`. */
function icsInstant(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC-5545 §3.3.11 TEXT escaping — backslash FIRST, then `;` `,` and newlines. */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC-5545 §3.1 line folding — max 75 OCTETS per line, continuations start with a
 *  space. Byte-aware so a multi-byte UTF-8 char is never split. */
function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    // First physical line: 75 octets. Continuations carry a leading space, so their
    // content is capped at 74 to keep the whole folded line ≤ 75.
    const limit = parts.length === 0 ? 75 : 74;
    if (curBytes + b > limit) {
      parts.push(cur);
      cur = "";
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

/**
 * Render a `text/calendar` document. Pure — no I/O, no clock read beyond `opts.now`.
 * CRLF line endings and 75-octet folding per RFC-5545 (the two ICS footguns).
 */
export function renderCalendar(data: CalendarFeedData, opts: RenderOpts): string {
  const domain = opts.uidDomain ?? "muster";
  const stamp = icsInstant(opts.now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Muster//Crew calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const ev of data.events) {
    const summary = `${ev.vesselName} — ${ev.roleName}${
      ev.training ? " (training)" : ""
    }`;
    const desc: string[] = [];
    if (ev.coCrewFirstNames.length) {
      desc.push(`With: ${ev.coCrewFirstNames.join(", ")}`);
    }
    desc.push(`Manifest & contacts in Muster: ${opts.appBaseUrl}/crew`);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}@${domain}`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${stamp}`,
      `DTSTART:${icsInstant(ev.start)}`,
      `DTEND:${icsInstant(ev.end)}`,
      `SUMMARY:${escapeText(summary)}`,
      ...(ev.dock ? [`LOCATION:${escapeText(ev.dock)}`] : []),
      `DESCRIPTION:${escapeText(desc.join("\n"))}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
