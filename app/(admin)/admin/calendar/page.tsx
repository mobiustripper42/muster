import type {
  Block,
  Event,
  MusterOwnedVesselDay,
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
import { BackLink } from "../../../../components/ui/back-link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { VersionTag } from "../../../../components/ui/version-tag";
import { vesselHueClass } from "../../../lib/vessel-hue";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * /admin/calendar (task 12.11, #464) — the Day·Grid reservation calendar. A read-only slice:
 * one day rendered as a grid of fleet vessels (columns) × a fixed 8:00–21:30 time axis, with
 * each computed departure drawn as an absolutely-positioned block spanning its true duration
 * (`docs/design/mockups/reservation-calendar-scale.html`, "Day · Grid (A revised)").
 *
 * The blocks registry links single-slot holds here ("On calendar →"). This is the read surface
 * only — NO click actions, detail pane, sell-from-calendar, or week/month views (all deferred).
 *
 * Data mirrors /admin/blocks: the same six repo lists feed `deriveVirtualAvailability` (DEC-125),
 * which returns one VirtualSlot per departure (available | booked | blocked). `holds`/`asOf` are
 * omitted, so no slot is ever `held` — operator vessel-holds already surface as `blocked`. The
 * deriver joins neither the offering (block height + colour) nor the reservation (customer name +
 * party size), so the page joins both from the master data it already loaded.
 */

export const dynamic = "force-dynamic";

type Search = {
  date?: string;
  filter?: string;
};

const FILTERS: { key: string; label: string; status: VirtualSlot["status"] | "all" }[] = [
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
function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** "HH:MM" → short clock without am/pm, e.g. "13:30" → "1:30" (matches the mockup). */
function shortTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]}`;
}

/** "2026-08-12" → "Wed, Aug 12 2026" for the header. */
function formatFullDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function AdminCalendar({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  let offerings: Offering[];
  let vessels: Vessel[];
  let blocks: Block[];
  let ownedDaysRaw: MusterOwnedVesselDay[];
  let events: Event[];
  let reservations: Reservation[];
  try {
    const repo = getRepo();
    [offerings, vessels, blocks, ownedDaysRaw, events, reservations] = await Promise.all([
      repo.listOfferings(),
      repo.listVessels(),
      repo.listBlocks(),
      repo.listMusterOwnedVesselDays(),
      repo.listEvents(),
      repo.listAllReservations(),
    ]);
  } catch {
    return (
      <Shell width="6xl">
        <Notice>Couldn’t reach the calendar right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  vessels.sort((a, b) => a.name.localeCompare(b.name));
  const offeringById = new Map(offerings.map((o) => [String(o.id), o]));

  // Reservation (customer name + party size) keyed by the event it claims — active Muster claims
  // only, exactly what the deriver marks `booked`.
  const reservationByEventId = new Map<string, Reservation>();
  for (const r of reservations) {
    if (isActiveMusterClaim(r)) reservationByEventId.set(String(r.eventId), r);
  }

  const today = vesselDateOf(new Date());
  const day = sp.date && ISO_DAY.test(sp.date) ? sp.date : today;
  const filter = sp.filter && FILTERS.some((f) => f.key === sp.filter) ? sp.filter : "all";

  const ownedDays = ownedDaysRaw.map((o) => ({ vesselId: o.vesselId, date: o.date }));
  // One-day window; omit holds/asOf so nothing is ever `held` (v1 has no bucket for it).
  const slots = deriveVirtualAvailability({
    offerings,
    vessels,
    dateRange: { start: day, end: day },
    ownedDays,
    blocks,
    events,
    reservations,
  });

  // Preserve the OTHER axis on every nav link (date ↔ filter), like /admin/blocks' hrefWith.
  const hrefWith = (o: { date?: string; filter?: string }) => {
    const d = o.date ?? day;
    const f = o.filter ?? filter;
    const params = new URLSearchParams();
    if (d !== today) params.set("date", d);
    if (f !== "all") params.set("filter", f);
    const q = params.toString();
    return q ? `/admin/calendar?${q}` : "/admin/calendar";
  };

  const counts = {
    all: slots.length,
    booked: slots.filter((s) => s.status === "booked").length,
    open: slots.filter((s) => s.status === "available").length,
    blackout: slots.filter((s) => s.status === "blocked").length,
  };

  // Slots grouped by vessel (columns); a fleet vessel with no slots shows an empty column.
  const slotsByVessel = new Map<string, VirtualSlot[]>();
  for (const s of slots) {
    const k = String(s.vesselId);
    (slotsByVessel.get(k) ?? slotsByVessel.set(k, []).get(k)!).push(s);
  }

  // Legend = the distinct offerings that actually have a slot today, with their derived colour.
  const presentOfferingIds = [...new Set(slots.map((s) => String(s.offeringId)))];
  const legendOfferings = presentOfferingIds
    .map((id) => offeringById.get(id))
    .filter((o): o is Offering => o !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));

  const gridCols = `52px repeat(${vessels.length}, minmax(120px, 1fr))`;
  const matchesFilter = (s: VirtualSlot) =>
    filter === "all" || FILTERS.find((f) => f.key === filter)?.status === s.status;

  return (
    <Shell width="6xl">
      <BackLink href="/admin">Back</BackLink>

      <header className="flex flex-col gap-1">
        <p className="text-xs text-faint">Reservations / Calendar</p>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">Calendar</h1>
      </header>

      {/* Date nav + filter — server nav (no JS), each link preserves the other axis. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-line bg-card">
          <AppLink
            href={hrefWith({ date: addDays(day, -1) })}
            aria-label="Previous day"
            className="border-r border-line px-3 py-1.5 text-sm text-muted"
          >
            ‹
          </AppLink>
          <AppLink
            href={hrefWith({ date: addDays(day, 1) })}
            aria-label="Next day"
            className="px-3 py-1.5 text-sm text-muted"
          >
            ›
          </AppLink>
        </div>
        <span className="min-w-[150px] text-sm font-medium text-ink">{formatFullDay(day)}</span>
        {day !== today && (
          <AppLink
            href={hrefWith({ date: today })}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-muted"
          >
            Today
          </AppLink>
        )}

        <span className="flex-1" />

        <div className="inline-flex overflow-hidden rounded-lg border border-line bg-card">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <AppLink
                key={f.key}
                href={hrefWith({ filter: f.key })}
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

      {/* Legend — offerings present today (derived colour, #495) + Open + Blackout. */}
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
          <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-faint" aria-hidden />
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

      {slots.length === 0 && (
        <Notice>
          No departures scheduled for {formatFullDay(day)}. Muster-owned days with a live offering
          show here — try another day.
        </Notice>
      )}

      {/* The grid: 52px time gutter + one column per fleet vessel; scrolls horizontally. */}
      <div className="mt-2 overflow-hidden rounded-card border border-line bg-card shadow-sm">
        <div className="overflow-x-auto">
          {/* Header row: corner + vessel names with hue dots. */}
          <div className="grid border-b border-line" style={{ gridTemplateColumns: gridCols }}>
            <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-faint">
              Time
            </div>
            {vessels.map((v) => (
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

            {vessels.map((v) => {
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
                    const offering = offeringById.get(String(s.offeringId));
                    const durationMin = offering?.tripLengthMinutes ?? DEFAULT_TRIP_MINUTES;
                    const { topPct, heightPct } = gridPosition(s.time, durationMin);
                    const reservation = s.eventId
                      ? reservationByEventId.get(String(s.eventId))
                      : undefined;
                    const dim = !matchesFilter(s);

                    const pos = {
                      top: `${topPct}%`,
                      height: `${heightPct}%`,
                    } as const;

                    if (dim) return null;

                    if (s.status === "booked") {
                      return (
                        <div
                          key={`${s.time}-${String(s.offeringId)}`}
                          data-testid="cal-block"
                          data-status="booked"
                          className={`absolute left-[3px] right-[3px] flex flex-col justify-center overflow-hidden rounded-lg border px-2 py-1 ${offeringColorClass(
                            String(s.offeringId),
                          )}`}
                          style={pos}
                        >
                          <span className="truncate text-[11px] font-semibold text-ink">
                            {reservation?.customerName ?? "Booked"}
                          </span>
                          <span className="font-mono text-[9.5px] text-muted">
                            {shortTime(s.time)}
                            {reservation ? ` · ${reservation.partySize}` : ""}
                          </span>
                        </div>
                      );
                    }

                    if (s.status === "blocked") {
                      return (
                        <div
                          key={`${s.time}-${String(s.offeringId)}`}
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

                    // available → an offering-tinted dashed "open" block.
                    return (
                      <div
                        key={`${s.time}-${String(s.offeringId)}`}
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

      <VersionTag />
    </Shell>
  );
}
