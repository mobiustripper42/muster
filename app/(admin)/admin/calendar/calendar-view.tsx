import type {
  Block,
  Event,
  Offering,
  Reservation,
  Vessel,
} from "@core/domain/entities.js";
import { vesselDateOf } from "@core/config/tenant.js";
import {
  deriveVirtualAvailability,
  isActiveMusterClaim,
  type VirtualSlot,
} from "@core/reservations/availability.js";
import {
  DEFAULT_TRIP_MINUTES,
  gridPosition,
  offeringColorClass,
  offeringDotClass,
  offeringOpenClass,
} from "@core/reservations/calendar-grid.js";
import { Notice } from "../../../../components/ui/notice";
import { AppLink } from "../../../../components/ui/app-link";
import { vesselHueClass } from "../../../lib/vessel-hue";
import { getRepo } from "../../../lib/repo";

/**
 * The Day·Grid calendar surface (task 12.11, #464), shared by both calendar routes:
 * `/admin/calendar` (grid alone) and `/admin/calendar/[reservationId]` (grid + detail pane).
 *
 * Both routes render the SAME grid from the SAME loader — a booked block is a link into the
 * detail route, so there is exactly one href per reservation regardless of form factor. The
 * detail route hides the grid below `lg` and shows the pane full-screen instead (a routed
 * page on mobile, a side pane on desktop) — two native layouts off one server-rendered link,
 * which a media-query-dependent href could never do without client JS.
 *
 * Open and blackout blocks stay inert: sell-from-calendar shares the 12.1 claim and is
 * deferred, and this slice ships NO actions at all.
 */

export type Search = {
  date?: string;
  filter?: string;
};

export const FILTERS: { key: string; label: string; status: VirtualSlot["status"] | "all" }[] = [
  { key: "all", label: "All", status: "all" },
  { key: "booked", label: "Booked", status: "booked" },
  { key: "open", label: "Open", status: "available" },
  { key: "blackout", label: "Blackout", status: "blocked" },
];

/** The fixed 8a→8p gutter ticks (label + the clock we position it at). */
const GUTTER_TICKS: { time: string; label: string }[] = [
  { time: "08:00", label: "8a" },
  { time: "10:00", label: "10a" },
  { time: "12:00", label: "12p" },
  { time: "14:00", label: "2p" },
  { time: "16:00", label: "4p" },
  { time: "18:00", label: "6p" },
  { time: "20:00", label: "8p" },
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Shift an ISO `yyyy-mm-dd` by whole days (UTC-safe). */
export function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** "HH:MM" → short clock without am/pm, e.g. "13:30" → "1:30" (matches the mockup). */
export function shortTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]}`;
}

/** "HH:MM" → "11:30 AM" for the detail header (the grid uses the terse `shortTime`). */
export function clockTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "2026-08-12" → "Wed, Aug 12 2026" for the header. */
export function formatFullDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-08-12" → "Sat Aug 15" — the detail header's terser form. */
export function formatShortDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export interface CalendarData {
  offerings: Offering[];
  vessels: Vessel[];
  events: Event[];
  reservations: Reservation[];
  slots: VirtualSlot[];
  offeringById: Map<string, Offering>;
  vesselById: Map<string, Vessel>;
  reservationByEventId: Map<string, Reservation>;
  day: string;
  today: string;
  filter: string;
}

/**
 * Load + derive everything both routes need for one day. Mirrors /admin/blocks' six reads;
 * `holds`/`asOf` are omitted so no slot is ever `held` (operator vessel-holds already surface
 * as `blocked`). Returns `null` on a repo failure so each route renders its own notice.
 */
export async function loadCalendarData(sp: Search): Promise<CalendarData | null> {
  let offerings: Offering[];
  let vessels: Vessel[];
  let blocks: Block[];
  let events: Event[];
  let reservations: Reservation[];
  try {
    const repo = getRepo();
    [offerings, vessels, blocks, events, reservations] = await Promise.all([
      repo.listOfferings(),
      repo.listVessels(),
      repo.listBlocks(),
      repo.listEvents(),
      repo.listAllReservations(),
    ]);
  } catch {
    return null;
  }

  vessels.sort((a, b) => a.name.localeCompare(b.name));

  const today = vesselDateOf(new Date());
  const day = sp.date && ISO_DAY.test(sp.date) ? sp.date : today;
  const filter = sp.filter && FILTERS.some((f) => f.key === sp.filter) ? sp.filter : "all";

  const reservationByEventId = new Map<string, Reservation>();
  for (const r of reservations) {
    if (isActiveMusterClaim(r)) reservationByEventId.set(String(r.eventId), r);
  }

  const slots = deriveVirtualAvailability({
    offerings,
    vessels,
    dateRange: { start: day, end: day },
    blocks,
    events,
    reservations,
  });

  return {
    offerings,
    vessels,
    events,
    reservations,
    slots,
    offeringById: new Map(offerings.map((o) => [String(o.id), o])),
    vesselById: new Map(vessels.map((v) => [String(v.id), v])),
    reservationByEventId,
    day,
    today,
    filter,
  };
}

/** Build the `/admin/calendar` href preserving the other axis (date ↔ filter). */
export function calendarHref(data: Pick<CalendarData, "day" | "today" | "filter">, o: {
  date?: string;
  filter?: string;
}): string {
  const d = o.date ?? data.day;
  const f = o.filter ?? data.filter;
  const params = new URLSearchParams();
  if (d !== data.today) params.set("date", d);
  if (f !== "all") params.set("filter", f);
  const q = params.toString();
  return q ? `/admin/calendar?${q}` : "/admin/calendar";
}

/** The same query string, hung off a reservation's detail route. */
export function detailHref(
  data: Pick<CalendarData, "day" | "today" | "filter">,
  reservationId: string,
): string {
  const params = new URLSearchParams();
  if (data.day !== data.today) params.set("date", data.day);
  if (data.filter !== "all") params.set("filter", data.filter);
  // Encode the id — reservation ids carry a colon (`resv-demo-2026-08-13-15:30`); the route
  // decodes it back. Leaving it raw works in a browser but breaks any literal-match consumer.
  const id = encodeURIComponent(reservationId);
  const q = params.toString();
  return q ? `/admin/calendar/${id}?${q}` : `/admin/calendar/${id}`;
}

/** Date nav + status filter — server nav (no JS); each link preserves the other axis. */
export function CalendarControls({ data }: { data: CalendarData }) {
  const counts = {
    all: data.slots.length,
    booked: data.slots.filter((s) => s.status === "booked").length,
    open: data.slots.filter((s) => s.status === "available").length,
    blackout: data.slots.filter((s) => s.status === "blocked").length,
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-lg border border-line bg-card">
        <AppLink
          href={calendarHref(data, { date: addDays(data.day, -1) })}
          aria-label="Previous day"
          className="border-r border-line px-3 py-1.5 text-sm text-muted"
        >
          ‹
        </AppLink>
        <AppLink
          href={calendarHref(data, { date: addDays(data.day, 1) })}
          aria-label="Next day"
          className="px-3 py-1.5 text-sm text-muted"
        >
          ›
        </AppLink>
      </div>
      <span className="min-w-[150px] text-sm font-medium text-ink">{formatFullDay(data.day)}</span>
      {data.day !== data.today && (
        <AppLink
          href={calendarHref(data, { date: data.today })}
          className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-muted"
        >
          Today
        </AppLink>
      )}

      <span className="flex-1" />

      <div className="inline-flex overflow-hidden rounded-lg border border-line bg-card">
        {FILTERS.map((f) => {
          const active = data.filter === f.key;
          return (
            <AppLink
              key={f.key}
              href={calendarHref(data, { filter: f.key })}
              aria-current={active ? "page" : undefined}
              data-testid={`filter-${f.key}`}
              className={`border-r border-line px-3 py-1.5 text-sm last:border-r-0 ${
                active ? "bg-ink font-medium text-white" : "text-muted"
              }`}
            >
              {f.label} {counts[f.key as keyof typeof counts]}
            </AppLink>
          );
        })}
      </div>
    </div>
  );
}

/** Legend — offerings present today (derived colour, #495) + Open + Blackout. */
export function CalendarLegend({ data }: { data: CalendarData }) {
  const presentOfferingIds = [...new Set(data.slots.map((s) => String(s.offeringId)))];
  const legendOfferings = presentOfferingIds
    .map((id) => data.offeringById.get(id))
    .filter((o): o is Offering => o !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      {legendOfferings.map((o) => (
        <span key={String(o.id)} className="inline-flex items-center gap-1.5">
          <span
            className={`inline-block h-3 w-3 rounded-sm ${offeringDotClass(String(o.id))}`}
            aria-hidden
          />
          {o.name}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-3 rounded-sm border border-dashed border-faint"
          aria-hidden
        />
        Open
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-3 rounded-sm border border-line"
          style={{
            background:
              "repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-faint) 24%, transparent) 0 3px, transparent 3px 6px)",
          }}
          aria-hidden
        />
        Blackout
      </span>
    </div>
  );
}

/**
 * The grid itself: 52px time gutter + one column per fleet vessel, blocks absolutely
 * positioned over a fixed 8:00–21:30 axis. `selectedReservationId` rings the open block on
 * the detail route.
 */
export function CalendarGrid({
  data,
  selectedReservationId,
}: {
  data: CalendarData;
  selectedReservationId?: string | undefined;
}) {
  const gridCols = `52px repeat(${data.vessels.length}, minmax(120px, 1fr))`;
  const matchesFilter = (s: VirtualSlot) =>
    data.filter === "all" || FILTERS.find((f) => f.key === data.filter)?.status === s.status;

  const slotsByVessel = new Map<string, VirtualSlot[]>();
  for (const s of data.slots) {
    const k = String(s.vesselId);
    (slotsByVessel.get(k) ?? slotsByVessel.set(k, []).get(k)!).push(s);
  }

  return (
    <div className="mt-2 overflow-hidden rounded-card border border-line bg-card shadow-sm">
      <div className="overflow-x-auto">
        {/* Header row: corner + vessel names with hue dots. */}
        <div className="grid border-b border-line" style={{ gridTemplateColumns: gridCols }}>
          <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-faint">
            Time
          </div>
          {data.vessels.map((v) => (
            <div
              key={String(v.id)}
              className="flex items-center gap-1.5 border-l border-line px-2 py-2 text-[11.5px] font-semibold text-ink"
            >
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${vesselHueClass(String(v.id), v.hue)}`}
                aria-hidden
              />
              <span className="truncate">{v.name}</span>
            </div>
          ))}
        </div>

        {/* Body: gutter labels + per-vessel absolutely-positioned blocks. */}
        <div className="grid" style={{ gridTemplateColumns: gridCols, height: 560 }}>
          <div className="relative">
            {GUTTER_TICKS.map((t) => (
              <span
                key={t.time}
                className="absolute right-1 -translate-y-[6px] text-right font-mono text-[10px] text-faint"
                style={{ top: `${gridPosition(t.time, 0).topPct}%` }}
              >
                {t.label}
              </span>
            ))}
          </div>

          {data.vessels.map((v) => {
            const colSlots = slotsByVessel.get(String(v.id)) ?? [];
            return (
              <div
                key={String(v.id)}
                className="relative border-l border-line"
                style={{
                  background:
                    "repeating-linear-gradient(180deg, transparent 0, transparent calc(100%/13.5 - 1px), var(--color-line) calc(100%/13.5 - 1px), var(--color-line) calc(100%/13.5))",
                }}
              >
                {colSlots.map((s) => {
                  const offering = data.offeringById.get(String(s.offeringId));
                  const durationMin = offering?.tripLengthMinutes ?? DEFAULT_TRIP_MINUTES;
                  const { topPct, heightPct } = gridPosition(s.time, durationMin);
                  const reservation = s.eventId
                    ? data.reservationByEventId.get(String(s.eventId))
                    : undefined;

                  if (!matchesFilter(s)) return null;

                  const key = `${s.time}-${String(s.offeringId)}`;
                  const pos = { top: `${topPct}%`, height: `${heightPct}%` } as const;

                  if (s.status === "booked") {
                    const selected =
                      reservation !== undefined && String(reservation.id) === selectedReservationId;
                    const body = (
                      <>
                        <span className="truncate text-[11px] font-semibold text-ink">
                          {reservation?.customerName ?? "Booked"}
                        </span>
                        <span className="font-mono text-[9.5px] text-muted">
                          {shortTime(s.time)}
                          {reservation ? ` · ${reservation.partySize}` : ""}
                        </span>
                      </>
                    );
                    const cls = `absolute left-[3px] right-[3px] flex flex-col justify-center overflow-hidden rounded-lg border px-2 py-1 ${offeringColorClass(
                      String(s.offeringId),
                    )} ${selected ? "ring-2 ring-ink ring-offset-1" : ""}`;

                    // A booked block links to its detail route; an unjoinable one stays inert.
                    return reservation ? (
                      <AppLink
                        key={key}
                        href={detailHref(data, String(reservation.id))}
                        // `overlay`, not the default `inline`: the inline spinner wraps children
                        // in a single label element, which collapses this block's two stacked
                        // lines onto one. The block is `absolute`, so it's already a positioned
                        // ancestor for the overlay scrim.
                        spinner="overlay"
                        data-testid="cal-block"
                        data-status="booked"
                        aria-current={selected ? "page" : undefined}
                        className={cls}
                        style={pos}
                      >
                        {body}
                      </AppLink>
                    ) : (
                      <div
                        key={key}
                        data-testid="cal-block"
                        data-status="booked"
                        className={cls}
                        style={pos}
                      >
                        {body}
                      </div>
                    );
                  }

                  if (s.status === "blocked") {
                    return (
                      <div
                        key={key}
                        data-testid="cal-block"
                        data-status="blocked"
                        className="absolute left-[3px] right-[3px] flex items-center justify-center overflow-hidden rounded-lg border border-line text-[10px] text-muted"
                        style={{
                          ...pos,
                          background:
                            "repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-faint) 24%, transparent) 0 4px, transparent 4px 8px)",
                        }}
                      >
                        Blackout
                      </div>
                    );
                  }

                  // available → an offering-tinted dashed "open" block (sell deferred to 12.1).
                  return (
                    <div
                      key={key}
                      data-testid="cal-block"
                      data-status="available"
                      className={`absolute left-[3px] right-[3px] flex items-center justify-center overflow-hidden rounded-lg border border-dashed text-[10px] text-faint ${offeringOpenClass(
                        String(s.offeringId),
                      )}`}
                      style={pos}
                    >
                      open · {shortTime(s.time)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The empty-day notice, shared by both routes. */
export function CalendarEmptyNotice({ day }: { day: string }) {
  return (
    <Notice>
      No departures scheduled for {formatFullDay(day)}. Days with a live offering show
      here — try another day.
    </Notice>
  );
}
