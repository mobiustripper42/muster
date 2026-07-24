/**
 * "Add to calendar" iCalendar builder (Phase 12.6, #459) — a pure VEVENT for the customer's
 * trip, served by the manage page's `calendar` route. No library: iCalendar is a tiny, stable
 * line format and the SDK-free `EmailChannel` set the precedent (hand-build, keep deps lean).
 *
 * The event date/time is vessel-LOCAL (the vessel-day is the clock, DEC-125), so DTSTART carries
 * the tenant `TZID` — Google/Apple/Outlook resolve a named IANA zone without a bundled VTIMEZONE.
 * Pure + deterministic (the caller passes `dtstamp`; no `Date.now()` in the domain).
 */

export interface IcsInput {
  /** Stable UID — the reservation id makes re-downloads update the same calendar entry. */
  uid: string;
  title: string;
  /** Vessel-local start, ISO `yyyy-mm-dd` + `HH:MM`. */
  date: string;
  time: string;
  /** Minutes on the water; when absent the event is a 1-hour default block. */
  durationMinutes?: number | undefined;
  /** IANA zone, e.g. "America/New_York". */
  tzid: string;
  location?: string | undefined;
  description?: string | undefined;
  /** ISO-8601 UTC stamp for DTSTAMP (caller-supplied — the domain never reads the clock). */
  dtstamp: string;
}

/** "yyyy-mm-dd"+"HH:MM" → "20260718T133000" (local, no Z — paired with a TZID). */
function toIcsLocal(date: string, time: string): string {
  const d = date.replace(/-/g, "");
  const t = `${time.replace(":", "")}00`;
  return `${d}T${t}`;
}

/** "2026-07-18T15:10:00Z" → "20260718T151000Z" (UTC, for DTSTAMP). */
function toIcsUtc(iso: string): string {
  return `${iso.replace(/[-:]/g, "").replace(/\.\d+/, "").replace(/Z?$/, "Z")}`;
}

/** Fold + escape a text value per RFC 5545 (commas, semicolons, newlines). Line-folding is
 *  omitted (values here are short); escaping is not — an unescaped comma breaks the property. */
function esc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Minutes → an iCalendar DURATION ("PT1H40M"). */
function toIcsDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `PT${h > 0 ? `${h}H` : ""}${m > 0 || h === 0 ? `${m}M` : ""}`;
}

/** Build the single-VEVENT calendar document (CRLF line endings, as the spec requires). */
export function buildBookingIcs(input: IcsInput): string {
  const dur = input.durationMinutes && input.durationMinutes > 0 ? input.durationMinutes : 60;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Muster//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${esc(input.uid)}@muster`,
    `DTSTAMP:${toIcsUtc(input.dtstamp)}`,
    `DTSTART;TZID=${input.tzid}:${toIcsLocal(input.date, input.time)}`,
    `DURATION:${toIcsDuration(dur)}`,
    `SUMMARY:${esc(input.title)}`,
    ...(input.location ? [`LOCATION:${esc(input.location)}`] : []),
    ...(input.description ? [`DESCRIPTION:${esc(input.description)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}
