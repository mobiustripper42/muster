import type {
  Block,
  Event,
  Offering,
  Reservation,
  Vessel,
} from "@core/domain/entities.js";
import { isBooked } from "@core/domain/entities.js";
import { vesselDateOf } from "@core/config/tenant.js";
import {
  deriveVirtualAvailability,
  type VirtualSlot,
} from "@core/reservations/availability.js";
import {
  DEFAULT_TRIP_MINUTES,
  assignLanes,
  gridPosition,
  offeringColorClass,
  offeringDotClass,
  offeringOpenClass,
  drawsOnCalendar,
  shortTime,
} from "@core/reservations/calendar-grid.js";
import { Notice } from "../../../../components/ui/notice";
import { AppLink } from "../../../../components/ui/app-link";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { vesselHueClass } from "../../../lib/vessel-hue";
import { errCopyFor } from "../../../lib/err-copy";
import { getRepo } from "../../../lib/repo";
import { logSwallowed } from "../../../lib/swallowed";
import { holdSlot, releaseHold, type CalendarErr } from "./actions";

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
 * Selling from the calendar stays deferred (it shares the 12.1 claim). The one write that lives
 * here is the SLOT BLOCK (#703): clicking an open departure takes it off the market as a
 * `Block{kind:"vesselHold"}`, and clicking a blocked one puts it back. Both go through a confirm
 * banner above the grid rather than a dialog in the card — no-JS (DEC-026) has no toast to
 * undo into, and a card is ~40px tall, which is not a place to ask a question at 375px.
 *
 * **The operator's word is "block", not "hold"** (operator, 2026-08-08). The identifiers here
 * still say `hold` — they track the data model's `kind: "vesselHold"`, which is unchanged, and
 * the divergence is deliberate rather than drift: "hold" is also DEC-109's transient customer
 * checkout-hold, so keeping it out of the UI leaves the word meaning one thing on screen.
 */

export type Search = {
  date?: string;
  filter?: string;
  /** `<vesselId>|<HH:MM>` — the open slot the confirm banner is asking about (#703). */
  hold?: string;
  /** A `vesselHold` block id — the held slot the banner is offering to release. */
  release?: string;
  err?: string;
};

/**
 * The chip keys, as a literal union rather than `string`.
 *
 * This exists because renaming the `blackout` chip to `blocked` (#703) silently dropped its
 * COUNT: the counts object still had a `blackout` key, and the lookup was
 * `counts[f.key as keyof typeof counts]` — a cast that turns exactly this typo into `undefined`
 * at runtime and nothing at all at compile time. Typing both ends off one union makes the next
 * rename a build error. Caught by looking at a screenshot, which is not a durable strategy.
 */
export type FilterKey = "all" | "booked" | "open" | "blocked";

export const FILTERS: { key: FilterKey; label: string; status: VirtualSlot["status"] | "all" }[] = [
  { key: "all", label: "All", status: "all" },
  { key: "booked", label: "Booked", status: "booked" },
  { key: "open", label: "Open", status: "available" },
  { key: "blocked", label: "Blocked", status: "blocked" },
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
  /** The trip occupying each physical `vessel|date|time`, either source — display only. */
  tripBySlot: Map<string, { event: Event; reservation?: Reservation }>;
  offeringById: Map<string, Offering>;
  vesselById: Map<string, Vessel>;
  reservationByEventId: Map<string, Reservation>;
  /** The `vesselHold` covering each physical `vessel|date|time`, if any (#703) — what makes a
   *  dark card releasable HERE. A slot darkened by a `vessel` or `location` block has no entry,
   *  stays inert, and is lifted on /admin/blocks where its real scope is visible. */
  holdBySlot: Map<string, Block>;
  day: string;
  today: string;
  filter: string;
  /** The confirm the operator is being shown, resolved from `?hold=`/`?release=` (#703). */
  pending: PendingHold | null;
  err?: string | undefined;
}

/**
 * A resolved confirm step. Both variants carry the physical slot, because the banner names the
 * boat and time and the form posts them — a param that no longer resolves to a real open slot
 * (someone booked it while the banner sat open) produces `null` and no banner at all.
 */
export type PendingHold =
  | {
      action: "hold";
      vesselId: string;
      vesselName: string;
      time: string;
      /** How many offerings propose this one boat-time — the scope sentence's number. */
      offeringCount: number;
    }
  | {
      action: "release";
      blockId: string;
      vesselId: string;
      vesselName: string;
      time: string;
    };

/** The physical slot key shared by `tripBySlot`, `holdBySlot` and the confirm params. */
export function slotKey(vesselId: string, date: string, time: string): string {
  return `${vesselId}|${date}|${time}`;
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
  } catch (e) {
    // Returning `null` hands each route a bare "couldn't load" with no cause, and
    // this loader serves several of them — so the log line is where the reason
    // survives for all of them.
    logSwallowed("admin/calendar", e, "the calendar data did not load");
    return null;
  }

  vessels.sort((a, b) => a.name.localeCompare(b.name));

  const today = vesselDateOf(new Date());
  const day = sp.date && ISO_DAY.test(sp.date) ? sp.date : today;
  const filter = sp.filter && FILTERS.some((f) => f.key === sp.filter) ? sp.filter : "all";

  // EVERY booked reservation, both sources. It was Muster-only, on the reasoning that a Xola
  // reservation's money lives in Xola (DEC-105) so the detail route is not ours to point at it.
  // That was wrong in practice: during coexistence most cards on this calendar are imported, so
  // most of the calendar was dead to the touch — and it is still a reservation on the operator's
  // own boat (operator, 2026-08-07). The detail route loads by id with no source filter; a Xola
  // row's payments and gratuities simply come back empty. A pane that says plainly this is Xola's
  // and cannot be edited here is #704.
  const reservationByEventId = new Map<string, Reservation>();
  for (const r of reservations) {
    if (isBooked(r)) reservationByEventId.set(String(r.eventId), r);
  }

  // Who is actually on each physical boat-slot. `reservationByEventId` above covers both sources
  // now, so this indexes through it rather than rebuilding a byte-identical copy — the copy came
  // from the Muster-only era and its comment outlived the reason for it by about an hour.
  const tripBySlot = new Map<string, { event: Event; reservation?: Reservation }>();
  // Sorted by event id, and FIRST wins — two trips CAN share a physical slot (the unique index
  // is partial on `source='muster'`, so nothing stops two Xola rows landing on one boat-time),
  // and an unsorted last-write-wins would pick a different occupant run to run. A stable choice
  // is not a correct one: when this happens the second occupant is a genuine double-booking and
  // is currently invisible here. Surfacing it is #700's job — the calendar has to draw events in
  // their own right before it can draw two of them.
  for (const e of [...events].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (e.status !== "scheduled") continue;
    const key = `${String(e.vesselId)}|${e.date}|${e.time}`;
    if (tripBySlot.has(key)) continue;
    const res = reservationByEventId.get(String(e.id));
    tripBySlot.set(key, { event: e, ...(res ? { reservation: res } : {}) });
  }

  // ONE list, deduped ONCE. The badge counts and the grid draw from the same array on purpose:
  // when the dedupe lived in the grid alone, "Booked 12" sat above eleven cards, and the very
  // scenario the dedupe exists for (one boat sold by two offerings) was the one that diverged.
  const slots = dedupeOccupied(
    deriveVirtualAvailability({
      offerings,
      vessels,
      dateRange: { start: day, end: day },
      blocks,
      events,
      reservations,
    }).filter((s) => drawsOnCalendar(s, events)),
  );

  // Only the single-slot kind, and only on the day being drawn — the map's whole job is
  // answering "is this dark card releasable from here?" (#703).
  const holdBySlot = new Map<string, Block>();
  for (const b of blocks) {
    if (b.kind !== "vesselHold" || b.date !== day) continue;
    holdBySlot.set(slotKey(String(b.vesselId), b.date, b.time), b);
  }

  const vesselById = new Map(vessels.map((v) => [String(v.id), v]));
  const nameOf = (id: string) => vesselById.get(id)?.name ?? id;

  // Resolve the confirm from the query. A param that names nothing real renders NO banner
  // rather than an error: the common way to get one is a slot that was booked or already
  // released while the confirm sat open, and the grid behind it already shows what happened.
  let pending: PendingHold | null = null;
  if (sp.release) {
    const block = [...holdBySlot.values()].find((b) => String(b.id) === sp.release);
    if (block && block.kind === "vesselHold") {
      pending = {
        action: "release",
        blockId: String(block.id),
        vesselId: String(block.vesselId),
        vesselName: nameOf(String(block.vesselId)),
        time: block.time,
      };
    }
  } else if (sp.hold) {
    const [vesselId = "", time = ""] = sp.hold.split("|");
    const open = slots.filter(
      (s) => String(s.vesselId) === vesselId && s.time === time && s.status === "available",
    );
    if (open.length > 0 && vesselById.has(vesselId)) {
      pending = {
        action: "hold",
        vesselId,
        vesselName: nameOf(vesselId),
        time,
        // Distinct offerings, not cards: the deriver emits one slot per offering, but counting
        // rows would say "2 offerings" for one offering that somehow produced two.
        offeringCount: new Set(open.map((s) => String(s.offeringId))).size,
      };
    }
  }

  return {
    offerings,
    vessels,
    events,
    reservations,
    slots,
    tripBySlot,
    offeringById: new Map(offerings.map((o) => [String(o.id), o])),
    vesselById,
    reservationByEventId,
    holdBySlot,
    day,
    today,
    filter,
    pending,
    err: sp.err,
  };
}

/**
 * Build the `/admin/calendar` href preserving the other axis (date ↔ filter).
 *
 * `hold`/`release` are deliberately NOT preserved: every other link on this surface (date nav,
 * filter chips, the banner's own Cancel) should DROP an open confirm, because moving off the
 * slot you were asked about is an answer. They are set explicitly, one link each.
 */
export function calendarHref(data: Pick<CalendarData, "day" | "today" | "filter">, o: {
  date?: string;
  filter?: string;
  hold?: string;
  release?: string;
}): string {
  const d = o.date ?? data.day;
  const f = o.filter ?? data.filter;
  const params = new URLSearchParams();
  if (d !== data.today) params.set("date", d);
  if (f !== "all") params.set("filter", f);
  if (o.hold) params.set("hold", o.hold);
  if (o.release) params.set("release", o.release);
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

/**
 * ONE CARD PER PHYSICAL TRIP. A boat-slot can be proposed by several offerings — Brew 3 is sold
 * by both the demo cruise and the river cruise, so 1:30 produces two slots. When that slot is
 * OCCUPIED they describe the same trip, and drawing both stacked two identical cards with the
 * same customer's name on top of each other.
 *
 * OPEN slots are deliberately NOT collapsed: two offerings genuinely on sale at one time are two
 * different things the operator could sell, and hiding one would hide a real choice. They still
 * overlap visually — that is the collision-layout work, not this.
 *
 * Sorted by offeringId first so the survivor is deterministic rather than dependent on the
 * deriver's iteration order.
 */
export function dedupeOccupied(slots: readonly VirtualSlot[]): VirtualSlot[] {
  const seen = new Set<string>();
  const out: VirtualSlot[] = [];
  for (const s of [...slots].sort((a, b) => String(a.offeringId).localeCompare(String(b.offeringId)))) {
    if (s.status === "booked" || s.status === "unavailable") {
      const physical = `${String(s.vesselId)}|${s.date}|${s.time}`;
      if (seen.has(physical)) continue;
      seen.add(physical);
    }
    out.push(s);
  }
  return out;
}

/** Date nav + status filter — server nav (no JS); each link preserves the other axis. */
export function CalendarControls({ data }: { data: CalendarData }) {
  // Annotated, not inferred: this is the half of the pair that must stay in step with FILTERS.
  const counts: Record<FilterKey, number> = {
    all: data.slots.length,
    booked: data.slots.filter((s) => s.status === "booked" || s.status === "unavailable").length,
    open: data.slots.filter((s) => s.status === "available").length,
    blocked: data.slots.filter((s) => s.status === "blocked").length,
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
              {f.label} {counts[f.key]}
            </AppLink>
          );
        })}
      </div>
    </div>
  );
}

/** Legend — offerings present today (derived colour, #495) + Open + Blocked. */
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
        Blocked
      </span>
      {/* Only when one is on screen — a legend key for a state the day doesn't contain is noise
          on every other day. Both dark cards read "Blocked"; the accent border is what says
          which one you can undo without leaving, and that is worth a key (#703). */}
      {data.holdBySlot.size > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm border border-accent/60"
            style={{
              background:
                "repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-faint) 24%, transparent) 0 3px, transparent 3px 6px)",
            }}
            aria-hidden
          />
          Blocked here · click to unblock
        </span>
      )}
    </div>
  );
}

const ERR_COPY: Record<CalendarErr, string> = {
  bad_vessel: "That boat isn’t in the fleet any more.",
  bad_date: "Couldn’t read that date — try the slot again from the grid.",
  bad_time: "Couldn’t read that departure time — try the slot again from the grid.",
  already_held: "That departure was already blocked.",
  slot_taken: "Someone booked that departure — it’s a trip now, so it can’t be blocked.",
  not_found: "That block was already lifted.",
  not_a_hold: "That’s a location or vessel block — lift it on Blocks, where its full scope shows.",
  error: "Couldn’t do that just now — try again in a moment.",
};

/** The `?err=` banner for a refused hold/release (#703, #654 typed copy). */
export function CalendarError({ err }: { err?: string | undefined }) {
  const copy = errCopyFor(ERR_COPY, err, "error");
  return copy ? <Notice tone="bad">{copy}</Notice> : null;
}

/**
 * The confirm step for blocking or unblocking one departure (#703).
 *
 * A banner above the grid, not a dialog in the card: no-JS (DEC-026) rules out a toast to undo
 * into, and an open block is ~40px tall — there is no room to ask a question in it, least of all
 * at 375px. It also gives the SCOPE sentence somewhere to live, and that sentence is the point.
 * A slot block is physical (one boat, one clock time), so it removes every offering proposing
 * that boat-time — a fact the registry row cannot show, because the row has no offering on it.
 */
export function HoldConfirm({ data }: { data: CalendarData }) {
  const p = data.pending;
  if (!p) return null;

  const cancelHref = calendarHref(data, {});
  const when = `${shortTime(p.time)} on ${p.vesselName}`;

  return (
    <div
      data-testid="hold-confirm"
      className="mt-3 flex flex-col gap-2 rounded-card border border-line bg-card px-4 py-3 shadow-sm min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          {p.action === "hold" ? `Block ${when}?` : `Unblock ${when}?`}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {p.action === "hold" ? (
            // The scope clause appears only when there IS scope to explain. On the usual slot
            // it would be a sentence about a number that is always 1 — noise the operator
            // learns to skip, which is how they miss it on the day it says 2.
            p.offeringCount > 1 ? (
              <>
                Takes the departure off the market for all {p.offeringCount}
                {" offerings that sell this boat-time — it’s one boat."} It stays off until you
                unblock it.
              </>
            ) : (
              <>Takes the departure off the market until you unblock it.</>
            )
          ) : (
            <>The departure goes back on sale.</>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <AppLink href={cancelHref} className="text-sm text-muted">
          Cancel
        </AppLink>
        <form action={p.action === "hold" ? holdSlot : releaseHold}>
          {/* The write's inputs come from the RESOLVED slot, never from the raw query — the
              param only selects what to ask about. */}
          <input type="hidden" name="date" value={data.day} />
          <input type="hidden" name="filter" value={data.filter} />
          {p.action === "hold" ? (
            <>
              <input type="hidden" name="vesselId" value={p.vesselId} />
              <input type="hidden" name="time" value={p.time} />
            </>
          ) : (
            <input type="hidden" name="id" value={p.blockId} />
          )}
          <SubmitButton className="rounded-card bg-accent px-4 py-2 text-sm font-semibold text-white">
            {p.action === "hold" ? "Block it" : "Unblock it"}
          </SubmitButton>
        </form>
      </div>
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
  const matchesFilter = (s: VirtualSlot) => {
    if (data.filter === "all") return true;
    const want = FILTERS.find((f) => f.key === data.filter)?.status;
    // "Booked" means "this boat is committed", which includes a hull occupied by an imported
    // Xola charter. Matching only the literal `booked` status would filter those away and
    // disagree with the count beside the tab.
    if (want === "booked") return s.status === "booked" || s.status === "unavailable";
    return want === s.status;
  };

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
            // Lanes are computed over the cards this filter actually DRAWS (#702). Computing them
            // over every slot would leave a gap where a hidden card's lane used to be — the "Open"
            // tab would show a half-width card with nothing beside it.
            const drawn = colSlots.filter(matchesFilter);
            const lanes = assignLanes(
              drawn.map((s) => ({
                time: s.time,
                durationMin:
                  data.offeringById.get(String(s.offeringId))?.tripLengthMinutes ??
                  DEFAULT_TRIP_MINUTES,
              })),
            );
            return (
              <div
                key={String(v.id)}
                className="relative border-l border-line"
                style={{
                  background:
                    "repeating-linear-gradient(180deg, transparent 0, transparent calc(100%/13.5 - 1px), var(--color-line) calc(100%/13.5 - 1px), var(--color-line) calc(100%/13.5))",
                }}
              >
                {drawn.map((s, drawnIndex) => {
                  const offering = data.offeringById.get(String(s.offeringId));
                  const durationMin = offering?.tripLengthMinutes ?? DEFAULT_TRIP_MINUTES;
                  const { topPct, heightPct } = gridPosition(s.time, durationMin);
                  const reservation = s.eventId
                    ? data.reservationByEventId.get(String(s.eventId))
                    : undefined;
                  // A hull-busy slot carries no eventId of its own — the trip occupying it is
                  // someone else's (usually an imported Xola charter). Resolve it for display.
                  const occupying = data.tripBySlot.get(
                    `${String(s.vesselId)}|${s.date}|${s.time}`,
                  );
                  const onBoard = reservation ?? occupying?.reservation;

                  const key = `${s.time}-${String(s.offeringId)}`;
                  // Concurrent cards share the column instead of stacking (#702). One lane is the
                  // ordinary day and keeps the original full-width inset exactly — this is
                  // invisible until a boat-time is genuinely sold two ways.
                  const { lane, laneCount } = lanes[drawnIndex] ?? { lane: 0, laneCount: 1 };
                  const laneInset =
                    laneCount > 1
                      ? {
                          left: `calc(${((lane / laneCount) * 100).toFixed(4)}% + 3px)`,
                          width: `calc(${(100 / laneCount).toFixed(4)}% - 6px)`,
                        }
                      : { left: "3px", right: "3px" };
                  const pos = {
                    top: `${topPct}%`,
                    height: `${heightPct}%`,
                    ...laneInset,
                  } as const;

                  if (s.status === "booked" || s.status === "unavailable") {
                    // `onBoard`, not `reservation`: a hull-busy slot carries no eventId of its
                    // own, so the eventId lookup never fires for an imported trip. Resolving
                    // through the physical slot is what makes those cards openable at all.
                    const selected =
                      onBoard !== undefined && String(onBoard.id) === selectedReservationId;
                    const body = (
                      <>
                        <span className="truncate text-[11px] font-semibold text-ink">
                          {onBoard?.customerName ?? "Booked"}
                        </span>
                        <span className="font-mono text-[9.5px] text-muted">
                          {shortTime(s.time)}
                          {onBoard ? ` · ${onBoard.partySize}` : ""}
                          {occupying?.event.source === "xola" && !reservation ? " · Xola" : ""}
                        </span>
                      </>
                    );
                    const cls = `absolute flex flex-col justify-center overflow-hidden rounded-lg border px-2 py-1 ${offeringColorClass(
                      String(s.offeringId),
                    )} ${selected ? "ring-2 ring-ink ring-offset-1" : ""}`;

                    // A booked block links to its detail route; an unjoinable one stays inert.
                    return onBoard ? (
                      <AppLink
                        key={key}
                        href={detailHref(data, String(onBoard.id))}
                        // `overlay`, not the default `inline`: the inline spinner wraps children
                        // in a single label element, which collapses this block's two stacked
                        // lines onto one. The block is `absolute`, so it's already a positioned
                        // ancestor for the overlay scrim.
                        spinner="overlay"
                        data-testid="cal-block"
                        data-vessel={String(s.vesselId)}
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
                        data-vessel={String(s.vesselId)}
                        data-status="booked"
                        className={cls}
                        style={pos}
                      >
                        {body}
                      </div>
                    );
                  }

                  const physical = slotKey(String(s.vesselId), s.date, s.time);
                  // Ring what the banner is asking about. With several cards on one boat-time
                  // it rings ALL of them, which is the scope sentence shown rather than stated.
                  const asked =
                    data.pending?.action === "hold" &&
                    data.pending.vesselId === String(s.vesselId) &&
                    data.pending.time === s.time;
                  const ring = asked ? " ring-2 ring-ink ring-offset-1" : "";

                  if (s.status === "blocked") {
                    // A dark card is releasable HERE only when a single-slot hold is what made
                    // it dark. A `vessel` or `location` block covers far more than this card
                    // shows, so it stays inert and is lifted on /admin/blocks, where its scope
                    // is visible — the same reason `releaseVesselHoldAdmin` refuses one by id.
                    const hold = data.holdBySlot.get(physical);
                    const askedRelease =
                      data.pending?.action === "release" &&
                      hold !== undefined &&
                      data.pending.blockId === String(hold.id);
                    // A slot block wears an accent border, a scoped one the plain line. Both dark
                    // and unsellable, but only one is the operator's own and undoable from
                    // here — if they looked identical the legend would be the only thing
                    // saying which dark cards click, and a legend is not where you look.
                    const cls = `absolute flex items-center justify-center overflow-hidden rounded-lg border text-[10px] ${
                      hold ? "border-accent/60 font-medium text-accent" : "border-line text-muted"
                    }${askedRelease ? " ring-2 ring-ink ring-offset-1" : ""}`;
                    const style = {
                      ...pos,
                      background:
                        "repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-faint) 24%, transparent) 0 4px, transparent 4px 8px)",
                    } as const;

                    return hold ? (
                      <AppLink
                        key={key}
                        href={calendarHref(data, { release: String(hold.id) })}
                        spinner="overlay"
                        aria-label={`Unblock ${shortTime(s.time)}, ${
                          data.vesselById.get(String(s.vesselId))?.name ?? String(s.vesselId)
                        }`}
                        data-testid="cal-block"
                        data-vessel={String(s.vesselId)}
                        data-status="blocked"
                        // Both dark cards read "Blocked", so the SCOPE that made them dark is
                        // the thing a test has to address. Keying a spec on the label would
                        // have it matching the wrong card the moment the copy converged, which
                        // is exactly what just happened to "Held" vs "Blackout".
                        data-blocked-by="slot"
                        className={cls}
                        style={style}
                      >
                        Blocked
                      </AppLink>
                    ) : (
                      <div
                        key={key}
                        data-testid="cal-block"
                        data-vessel={String(s.vesselId)}
                        data-status="blocked"
                        data-blocked-by="scoped"
                        className={cls}
                        style={style}
                      >
                        Blocked
                      </div>
                    );
                  }

                  // available → an offering-tinted dashed "open" block. Selling from here is
                  // still deferred (12.1); the link takes the slot OFF the market (#703). The
                  // href is keyed on the PHYSICAL slot, not the offering, so every card sharing
                  // a boat-time leads to the same confirm — which is what the block really does.
                  return (
                    <AppLink
                      key={key}
                      href={calendarHref(data, {
                        hold: `${String(s.vesselId)}|${s.time}`,
                      })}
                      spinner="overlay"
                      // The card says "open" and the link BLOCKS it — without a name of its own
                      // a screen reader announces the state and hides the action.
                      aria-label={`Block ${shortTime(s.time)}, ${
                        data.vesselById.get(String(s.vesselId))?.name ?? String(s.vesselId)
                      }`}
                      data-testid="cal-block"
                      data-vessel={String(s.vesselId)}
                      data-status="available"
                      data-lane={laneCount > 1 ? `${lane + 1}/${laneCount}` : undefined}
                      // Which offering a sliver belongs to is the thing 1/n width takes away. The
                      // tint still says it against the legend; this says it in words on hover, and
                      // it costs nothing when the card is full width.
                      title={`open · ${shortTime(s.time)}${offering ? ` · ${offering.name}` : ""}`}
                      className={`absolute flex items-center justify-center overflow-hidden rounded-lg border-2 border-dashed text-[10px] text-faint ${offeringOpenClass(
                        String(s.offeringId),
                      )}${ring}`}
                      style={pos}
                    >
                      open · {shortTime(s.time)}
                    </AppLink>
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
