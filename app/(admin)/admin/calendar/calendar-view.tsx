import type { ReactNode } from "react";
import type {
  Block,
  Event,
  Location,
  Offering,
  Reservation,
  Vessel,
} from "@core/domain/entities.js";
import { isBooked } from "@core/domain/entities.js";
import { formatDuration } from "@core/reservations/availability-screen.js";
import { vesselDateOf } from "@core/config/tenant.js";
import {
  deriveVirtualAvailability,
  isSlotBlocked,
  type VirtualSlot,
} from "@core/reservations/availability.js";
import { candidateTripMinutes } from "@core/reservations/hull-busy.js";
import { crewCount } from "@core/reservations/calendar-detail.js";
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
import { Badge } from "../../../../components/ui/badge";
import { AppLink } from "../../../../components/ui/app-link";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { RevealSelectedCard } from "../../../../components/admin/reveal-selected-card";
import { vesselHueClass } from "../../../lib/vessel-hue";
import { errCopyFor } from "../../../lib/err-copy";
import { getRepo } from "../../../lib/repo";
import { logSwallowed } from "../../../lib/swallowed";
import { holdSlot, releaseHold, type CalendarErr } from "./actions";
import { Card } from "../../../../components/ui/card";

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
 * Clicking an open departure opens its slot pane beside the grid (#1104, `SlotPane`), which offers
 * two things: **Book** it by phone (16.1, §2.10.6 — the phone booking's two steps in the same pane,
 * `BookPane`, writing through the shared claim), or take it off the market as a SLOT BLOCK (#703, a
 * `Block{kind:"vesselHold"}`); a blocked one's pane puts it back. A pane rather than a question in
 * the card — no-JS (DEC-026) has no toast to undo into, and a card is ~40px tall.
 *
 * **The operator's word is "block", not "hold"** (operator, 2026-08-08). The identifiers here
 * still say `hold` — they track the data model's `kind: "vesselHold"`, which is unchanged, and
 * the divergence is deliberate rather than drift: "hold" is also DEC-109's transient customer
 * checkout-hold, so keeping it out of the UI leaves the word meaning one thing on screen.
 */

export type Search = {
  date?: string;
  filter?: string;
  /** `<vesselId>|<HH:MM>` — the open slot whose pane is open (#703, #1104). */
  hold?: string;
  /** A `vesselHold` block id — the blocked slot whose pane is open, offering to release it. */
  release?: string;
  /** `<vesselId>|<HH:MM>` — a slot darkened by a boat-out or closure, whose pane names it (#1091). */
  scoped?: string;
  /** `list` — the day drawn as one row per departure, to sell from (16.1b, issue #1079). */
  view?: string;
  err?: string;
};

/** Grid (the default) or List (16.1b). Every calendar link keeps it, like the filter. */
export type CalendarView = "grid" | "list";

/**
 * The chip keys, as a literal union rather than `string`.
 *
 * This exists because renaming the `blackout` chip to `blocked` (#703) silently dropped its
 * COUNT: the counts object still had a `blackout` key, and the lookup was
 * `counts[f.key as keyof typeof counts]` — a cast that turns exactly this typo into `undefined`
 * at runtime and nothing at all at compile time. Typing both ends off one union makes the next
 * rename a build error. Caught by looking at a screenshot, which is not a durable strategy.
 */
export type FilterKey = "all" | "booked" | "unpaid" | "open" | "blocked";

/**
 * `unpaid` is not a slot status: it is a `held` slot that is the operator's own unpaid phone booking
 * (16.1), told apart from a customer at the checkout by `phoneBookingBySlot`. Its own chip, apart from
 * Booked, so Booked keeps meaning sold (operator, 2026-10-02).
 */
export const FILTERS: { key: FilterKey; label: string; status: VirtualSlot["status"] | "all" | "unpaid" }[] = [
  { key: "all", label: "All", status: "all" },
  { key: "booked", label: "Booked", status: "booked" },
  { key: "unpaid", label: "Unpaid", status: "unpaid" },
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

// A legend key is a mark, not a box (issue #484, part 5): a 12px square keeps its small corner,
// where the box radius would round it into a dot unlike the cards it labels.
// eslint-disable-next-line muster/radius -- mark (issue #484)
const LEGEND_KEY = "inline-block h-3 w-3 rounded-sm";

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

/** A boat-out's days, short: "Oct 5", "Oct 5–7", "Oct 30 – Nov 2". */
export function dayRange(start: string, end: string): string {
  const md = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (start === end) return md(start);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${md(start)}–${Number(end.slice(8, 10))}`;
  return `${md(start)} – ${md(end)}`;
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
   *  dark card releasable HERE. A slot darkened by a `vessel` or `location` block has no entry
   *  here (see `scopedBySlot`) and is changed on /admin/blocks where its real scope is visible. */
  holdBySlot: Map<string, Block>;
  /** The boat-out or closure darkening each physical `vessel|date|time` that no `vesselHold` does
   *  (issue #1091) — what lets that card's pane name its block and open it on /admin/blocks. */
  scopedBySlot: Map<string, Block>;
  /** The operator's unpaid phone booking on each physical `vessel|date|time` (16.1) — what makes
   *  a `held` card a link to its pane rather than an inert "Checking out". */
  phoneBookingBySlot: Map<string, Reservation>;
  day: string;
  today: string;
  filter: string;
  view: CalendarView;
  /** Location names, for naming a closure on a blocked row (issue #1091, #1079). */
  locationNameById: Map<string, string>;
  /** Crew seats filled / needed per booked Event — List view only (issue #1079); empty on the grid,
   *  which never shows it, so the grid pays for no extra reads. */
  crewByEventId: Map<string, { filled: number; required: number }>;
  /** The confirm the operator is being shown, resolved from `?hold=`/`?release=` (#703). */
  pending: PendingHold | null;
  err?: string | undefined;
}

/**
 * The slot whose pane is open (#1104; was the confirm banner, #703). Both variants carry the
 * physical slot, because the pane names the boat and time and its form posts them — a param that
 * no longer resolves to a real slot (someone booked it while the pane sat open) produces `null`
 * and no pane at all.
 *
 * `offerings` is every offering proposing this boat-time — one slot, several cruises when more
 * than one sells the boat — so the pane can say what is being booked or blocked.
 */
interface PendingSlot {
  vesselId: string;
  vesselName: string;
  time: string;
  /** The boat's certified capacity — "Boat takes 12 guests". */
  capacity: number;
  offerings: { name: string; tripMinutes?: number | undefined }[];
}
export type PendingHold =
  | (PendingSlot & { action: "hold" })
  | (PendingSlot & { action: "release"; blockId: string })
  /** Darkened by a boat-out or closure (#1091): not undoable from one card, so the pane names the
   *  block ("Brew 3 out of service · Oct 5–7") and opens it on /admin/blocks. */
  | (PendingSlot & { action: "scoped"; blockId: string; blockLabel: string });

/** The physical slot key shared by `tripBySlot`, `holdBySlot` and the confirm params. */
export function slotKey(vesselId: string, date: string, time: string): string {
  return `${vesselId}|${date}|${time}`;
}

/**
 * Load + derive everything both routes need for one day. Mirrors /admin/blocks' six reads.
 *
 * **`asOf` is passed since 14.9**, which is what lets a slot be `held` or `departed`. It was
 * omitted while `held` meant a `checkout_holds` row, on the reasoning that operator vessel-holds
 * already surface as `blocked` — but a customer standing at the checkout is not an operator block,
 * and an operator looking at today's grid needs to know a boat is mid-sale before they hold it for
 * a repair. `departed` needs the same clock (issue #824). Returns `null` on a repo failure so each
 * route renders its own notice.
 */
export async function loadCalendarData(sp: Search): Promise<CalendarData | null> {
  let offerings: Offering[];
  let vessels: Vessel[];
  let blocks: Block[];
  let events: Event[];
  let reservations: Reservation[];
  let locations: Location[];
  let bookingCutoffHours: number;
  try {
    const repo = getRepo();
    [offerings, vessels, blocks, events, reservations, locations, bookingCutoffHours] = await Promise.all([
      repo.listOfferings(),
      repo.listVessels(),
      repo.listBlocks(),
      repo.listEvents(),
      repo.listAllReservations(),
      repo.listLocations(),
      repo.getBookingCutoffHours(),
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
  const view: CalendarView = sp.view === "list" ? "list" : "grid";

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
      // One instant for the whole render — it decides both which pending rows are live and which
      // departures have gone, so the two cannot disagree about what time it is (issue #713).
      asOf: new Date().toISOString(),
      // DEC-193: a slot inside the cutoff stays `available` — counted open, bookable here — and
      // carries `phoneOnly`, which the open card names so the operator knows the website won't.
      bookingCutoffHours,
    }).filter((s) => drawsOnCalendar(s, events)),
  );

  // Only the single-slot kind, and only on the day being drawn — the map's whole job is
  // answering "is this dark card releasable from here?" (#703).
  const holdBySlot = new Map<string, Block>();
  for (const b of blocks) {
    if (b.kind !== "vesselHold" || b.date !== day) continue;
    holdBySlot.set(slotKey(String(b.vesselId), b.date, b.time), b);
  }

  // An `admin` pending row is always unpaid and never lapses (DEC-163; it becomes `muster` when
  // paid), so on the grid it is a `held` slot that will not clear by itself. Unlike a customer's
  // checkout it is the operator's own, and the pane is where it is paid for or cancelled.
  const phoneBookingBySlot = new Map<string, Reservation>();
  for (const r of reservations) {
    if (r.source !== "admin" || r.status !== "pending" || r.date !== day) continue;
    if (!r.vesselId || !r.time) continue;
    phoneBookingBySlot.set(slotKey(String(r.vesselId), r.date, r.time), r);
  }

  const vesselById = new Map(vessels.map((v) => [String(v.id), v]));
  const nameOf = (id: string) => vesselById.get(id)?.name ?? id;
  const offeringByIdLocal = new Map(offerings.map((o) => [String(o.id), o]));
  /** What the pane says about a physical slot: the boat's capacity and every offering on it. */
  const slotFacts = (vesselId: string, time: string, onSlot: readonly VirtualSlot[]) => ({
    capacity: vesselById.get(vesselId)?.coiMaxPax ?? 0,
    offerings: [...new Set(onSlot.map((s) => String(s.offeringId)))]
      .map((id) => offeringByIdLocal.get(id))
      .filter((o): o is Offering => o !== undefined)
      .map((o) => ({ name: o.name, tripMinutes: o.tripLengthMinutes })),
  });

  const scopedBySlot = scopedBlocksBySlot(slots, blocks, holdBySlot, offeringByIdLocal);
  const locationName = new Map(locations.map((l) => [String(l.id), l.name]));
  const blockLabel = (b: Block) => describeBlock(b, nameOf, (id) => locationName.get(id) ?? id);
  const onSlot = (vid: string, time: string) =>
    slots.filter((s) => String(s.vesselId) === vid && s.time === time);
  /** The pane for a DARK card at this boat-time — its slot block's, else its boat-out's or closure's. */
  const blockedPane = (vid: string, time: string): PendingHold | null => {
    const key = slotKey(vid, day, time);
    const hold = holdBySlot.get(key);
    const facts = { vesselId: vid, vesselName: nameOf(vid), time, ...slotFacts(vid, time, onSlot(vid, time)) };
    if (hold) return { action: "release", blockId: String(hold.id), ...facts };
    const block = scopedBySlot.get(key);
    if (block) return { action: "scoped", blockId: String(block.id), blockLabel: blockLabel(block), ...facts };
    return null;
  };

  // Resolve the confirm from the query. A param that names nothing real renders NO banner
  // rather than an error: the common way to get one is a slot that was booked or already
  // released while the confirm sat open, and the grid behind it already shows what happened.
  let pending: PendingHold | null = null;
  if (sp.release) {
    const block = [...holdBySlot.values()].find((b) => String(b.id) === sp.release);
    if (block && block.kind === "vesselHold") pending = blockedPane(String(block.vesselId), block.time);
  } else if (sp.scoped) {
    const [vesselId = "", time = ""] = sp.scoped.split("|");
    pending = blockedPane(vesselId, time);
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
        ...slotFacts(vesselId, time, open),
      };
    } else {
      // Blocked since the pane opened — most often a phone booking refused because the boat was
      // taken out mid-call. Land on the block that did it rather than on no pane at all (#1091).
      pending = blockedPane(vesselId, time);
    }
  }

  const crewByEventId = view === "list" ? await crewForDay(events, day) : new Map();

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
    scopedBySlot,
    phoneBookingBySlot,
    day,
    today,
    filter,
    view,
    locationNameById: locationName,
    crewByEventId,
    pending,
    err: sp.err,
  };
}

/**
 * Crew seats filled / needed for each of the day's Events (List view, issue #1079), counted the way
 * the booking pane counts them (`crewCount`). Only the shifts covering this day's Events are read,
 * one seat read each — a handful per day. A failed read draws no crew column rather than no page:
 * the list is for selling, and crew is a glance.
 */
async function crewForDay(events: readonly Event[], day: string): Promise<Map<string, { filled: number; required: number }>> {
  const out = new Map<string, { filled: number; required: number }>();
  const dayEventIds = new Set(events.filter((e) => e.date === day).map((e) => String(e.id)));
  if (dayEventIds.size === 0) return out;
  try {
    const repo = getRepo();
    const shifts = (await repo.listShifts()).filter((s) => s.eventIds.some((id) => dayEventIds.has(String(id))));
    const seats = await Promise.all(shifts.map((s) => repo.listSeatsForShift(s.id)));
    shifts.forEach((s, i) => {
      const count = crewCount(seats[i] ?? []);
      for (const id of s.eventIds) if (dayEventIds.has(String(id))) out.set(String(id), count);
    });
  } catch (e) {
    logSwallowed("admin/calendar:list", e, "the crew counts did not load — the list shows none");
  }
  return out;
}

/**
 * Which boat-out or closure darkened each blocked card that no slot block did (issue #1091).
 *
 * Attributed per block with the same `isSlotBlocked` the deriver used, measured against the same
 * trip length, so the block the pane names is one that really covers this departure. When two
 * overlap, the first in the list is named — opening either one is a true answer.
 */
function scopedBlocksBySlot(
  slots: readonly VirtualSlot[],
  blocks: readonly Block[],
  holdBySlot: ReadonlyMap<string, Block>,
  offeringById: ReadonlyMap<string, Offering>,
): Map<string, Block> {
  const scoped = blocks.filter((b) => b.kind !== "vesselHold");
  const out = new Map<string, Block>();
  for (const s of slots) {
    if (s.status !== "blocked") continue;
    const key = slotKey(String(s.vesselId), s.date, s.time);
    if (holdBySlot.has(key) || out.has(key)) continue;
    const offering = offeringById.get(String(s.offeringId));
    if (!offering) continue;
    const trip = candidateTripMinutes(offering);
    const hit = scoped.find((b) =>
      isSlotBlocked([b], String(offering.locationId), s.vesselId, s.date, s.time, trip),
    );
    if (hit) out.set(key, hit);
  }
  return out;
}

/** The block, named the way /admin/blocks names it: "Brew 3 out of service · Oct 5–7". */
export function describeBlock(
  b: Block,
  vesselName: (id: string) => string,
  locationName: (id: string) => string,
): string {
  switch (b.kind) {
    case "vessel":
      return `${vesselName(String(b.vesselId))} out of service · ${dayRange(b.startDate, b.endDate)}`;
    case "location":
      return `${locationName(String(b.locationId))} closed · ${clockTime(b.startTime)}–${clockTime(b.endTime)}`;
    case "vesselHold":
      return "This departure only";
  }
}

/** What every calendar href is built from: the day on screen, today, the filter chip and the view. */
export type HrefData = Pick<CalendarData, "day" | "today" | "filter"> & Partial<Pick<CalendarData, "view">>;

/**
 * Build the `/admin/calendar` href preserving the other axis (date ↔ filter).
 *
 * `hold`/`release` are deliberately NOT preserved: every other link on this surface (date nav,
 * filter chips, the banner's own Cancel) should DROP an open confirm, because moving off the
 * slot you were asked about is an answer. They are set explicitly, one link each.
 */
export function calendarHref(data: HrefData, o: {
  date?: string;
  filter?: string;
  hold?: string;
  release?: string;
  scoped?: string;
  view?: CalendarView;
}): string {
  const d = o.date ?? data.day;
  const f = o.filter ?? data.filter;
  const v = o.view ?? data.view ?? "grid";
  const params = new URLSearchParams();
  if (d !== data.today) params.set("date", d);
  if (f !== "all") params.set("filter", f);
  if (v === "list") params.set("view", "list");
  if (o.hold) params.set("hold", o.hold);
  if (o.release) params.set("release", o.release);
  if (o.scoped) params.set("scoped", o.scoped);
  const q = params.toString();
  return q ? `/admin/calendar?${q}` : "/admin/calendar";
}

/** The same query string, hung off a reservation's detail route. */
export function detailHref(
  data: HrefData,
  reservationId: string,
): string {
  const params = new URLSearchParams();
  if (data.day !== data.today) params.set("date", data.day);
  if (data.filter !== "all") params.set("filter", data.filter);
  if (data.view === "list") params.set("view", "list");
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
    // `held` and `departed` join the original two (14.9). All four describe ONE physical trip's
    // state, so two offerings sharing a boat-time draw one card rather than two stacked identical
    // ones — the defect this function exists to prevent. Only `available` and `blocked` stay
    // per-offering: those ARE a real choice about which offering to sell or block.
    if (
      s.status === "booked" ||
      s.status === "unavailable" ||
      s.status === "held" ||
      s.status === "departed"
    ) {
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
    unpaid: data.slots.filter((s) => isUnpaidPhoneBooking(data, s)).length,
    open: data.slots.filter((s) => s.status === "available").length,
    blocked: data.slots.filter((s) => s.status === "blocked").length,
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <div className="segmented">
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
        // A one-segment `.segmented`, not `btn-sm`: it sits in a row of segmented groups, and
        // `btn-sm`'s 12px type left it 4px shorter than its neighbours (`@ui-reviewer`).
        <AppLink
          href={calendarHref(data, { date: data.today })}
          className="segmented px-3 py-1.5 text-sm text-muted"
        >
          Today
        </AppLink>
      )}

      {/* Grid or List (16.1b, issue #1079): the same day, drawn as cards on boats or as one row per
          departure to sell from. Links, not state — the choice is in the URL and every link keeps it. */}
      <div className="segmented">
        {(["grid", "list"] as const).map((v) => {
          const active = data.view === v;
          return (
            <AppLink
              key={v}
              href={calendarHref(data, { view: v })}
              aria-current={active ? "page" : undefined}
              data-testid={`view-${v}`}
              className={`border-r border-line px-3 py-1.5 text-sm last:border-r-0 ${
                active ? "bg-ink font-medium text-white" : "text-muted"
              }`}
            >
              {v === "grid" ? "Grid" : "List"}
            </AppLink>
          );
        })}
      </div>

      <span className="flex-1" />

      <div className="segmented">
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
    <div data-testid="cal-legend" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      {legendOfferings.map((o) => (
        <span key={String(o.id)} className="inline-flex items-center gap-1.5">
          <span
            className={`${LEGEND_KEY} ${offeringDotClass(String(o.id))}`}
            aria-hidden
          />
          {o.name}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`${LEGEND_KEY} border border-dashed border-faint`}
          aria-hidden
        />
        Open
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`${LEGEND_KEY} border border-line`}
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
            className={`${LEGEND_KEY} border border-accent/60`}
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
  not_a_hold: "That’s a boat out of service or a closure, not one departure — open it on Blocks to change it.",
  error: "Couldn’t do that just now — try again in a moment.",
};

/** The `?err=` banner for a refused hold/release (#703, #654 typed copy). */
export function CalendarError({ err }: { err?: string | undefined }) {
  const copy = errCopyFor(ERR_COPY, err, "error");
  return copy ? <Notice tone="bad">{copy}</Notice> : null;
}

/**
 * The pane for one open or blocked departure (#1104; the confirm banner of #703 before it).
 *
 * **Every card opens a pane.** A booked card always opened its reservation beside the grid; an
 * open or blocked one opened a strip above it that fitted no pattern the operator could name, and
 * had nowhere to put more than two buttons. Now both go the same way, in the same frame
 * (`MasterDetail`), with the same header shape as the shift cockpit: the thing's name, a status
 * pill, a meta line, cards, then what you can do.
 *
 * The title names the departure and the buttons say what can be done to it — no explanatory
 * sentence (operator, 2026-09-25). A slot block is physical: one boat, one clock time, every
 * offering proposing it, which is why the Cruise rows list them all.
 *
 * Server-rendered and no-JS like the rest of the calendar (DEC-026): the URL says which slot is
 * open, Close is a link back to the grid, and the write's inputs come from the RESOLVED slot,
 * never from the raw query.
 */
export function SlotPane({ data, bookErr }: { data: CalendarData; bookErr?: string | undefined }) {
  const p = data.pending;
  if (!p) return null;
  const blocked = p.action !== "hold";
  const one = p.offerings.length === 1 ? p.offerings[0] : undefined;
  const onWater = one ? formatDuration(one.tripMinutes) : null;
  const cruiseLabel = p.offerings.length > 1 ? "Cruises" : "Cruise";

  return (
    <div data-testid="slot-pane" className="flex flex-col gap-3">
      <SlotHeader data={data} p={p} />

      {/* A phone booking refused because the departure went dark mid-call lands here (#1091). */}
      {blocked && bookErr === "blocked" ? (
        <Notice tone="bad">Blocked while you were booking — nothing was booked.</Notice>
      ) : null}

      <Card as="dl" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        {blocked ? (
          <>
            <dt className="text-muted">Blocked</dt>
            <dd className="text-right text-ink">
              {p.action === "scoped" ? p.blockLabel : "This departure only"}
            </dd>
          </>
        ) : null}
        {p.offerings.map((o, i) => (
          <SlotRow key={o.name} label={i === 0 ? cruiseLabel : ""}>
            {o.name}
          </SlotRow>
        ))}
        {!blocked ? <SlotRow label="Boat takes">{p.capacity} guests</SlotRow> : null}
        {!blocked && onWater ? <SlotRow label="On the water">{onWater}</SlotRow> : null}
      </Card>

      <div className="flex gap-3">
        {!blocked ? (
          // A phone booking (16.1, §2.10.6). A link, not a form: booking needs the customer's
          // details, so it turns this pane into the booking's two steps (issue #1104 part 3),
          // keyed on the same physical slot, with the calendar still beside it.
          <AppLink
            href={bookHref(data, p, {})}
            data-testid="book-slot"
            className="btn-primary flex-1"
          >
            Book it
          </AppLink>
        ) : null}
        {p.action === "scoped" ? (
          // A boat-out or closure covers more than this card, so it is changed where its whole
          // scope shows — and this is the way there, not a sentence saying it exists (#1091).
          <AppLink
            href={`/admin/blocks?sel=${encodeURIComponent(p.blockId)}`}
            className="btn-secondary flex-1"
          >
            Open that block →
          </AppLink>
        ) : (
          <form action={blocked ? releaseHold : holdSlot} className="flex flex-1">
            <input type="hidden" name="date" value={data.day} />
            <input type="hidden" name="filter" value={data.filter} />
            <input type="hidden" name="view" value={data.view} />
            {p.action === "release" ? (
              <input type="hidden" name="id" value={p.blockId} />
            ) : (
              <>
                <input type="hidden" name="vesselId" value={p.vesselId} />
                <input type="hidden" name="time" value={p.time} />
              </>
            )}
            {/* Beside Book, Block is the secondary action — outlined, so the two are never one
                colour at 375px where a mis-tap would take a slot off the market. */}
            <SubmitButton className={blocked ? "btn-primary w-full" : "btn-secondary w-full"}>
              {blocked ? "Unblock it" : "Block it"}
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * The slot pane's header — "3:30 PM · Brew 3", the Open / Blocked pill, the day. Shared with the
 * booking steps (`BookPane`), so the pane does not jump when Book it turns it into a booking.
 */
export function SlotHeader({ data, p }: { data: CalendarData; p: PendingHold }) {
  const blocked = p.action !== "hold";
  return (
    // Pinned under Close ✕ as the pane scrolls on desktop (issue #1128) — `PANE_HEAD` below.
    <div data-testid="pane-head" className={PANE_HEAD}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold text-ink">
          {clockTime(p.time)} · {p.vesselName}
        </h2>
        <Badge data-testid="slot-state" tone={blocked ? "accent" : "neutral"}>
          {blocked ? "Blocked" : "Open"}
        </Badge>
      </div>
      <p className="text-sm text-muted">{formatFullDay(data.day)}</p>
    </div>
  );
}

/**
 * A pane's title block — the name and its pill, then the meta line — pinned to the top of the
 * pane column as it scrolls on desktop (issue #1128), directly under the frame's Close ✕ row
 * (`master-detail.tsx`, which is `h-9`, hence `top-9`). On the page's own background so the cards
 * slide under it cleanly. Shared by the slot pane, the booking steps and the booking pane.
 *
 * `-mt-3 pt-3` takes over the pane's `gap-3` above it: the block covers the gap with its own
 * padding, so it sits in the same place at rest and pinned. Without it the gap vanished as the
 * block caught and the title nudged up 12px (operator, 2026-09-30).
 */
export const PANE_HEAD = "flex flex-col gap-1 lg:sticky lg:top-9 lg:z-10 lg:-mt-3 lg:bg-bg lg:pb-2 lg:pt-3";

/**
 * The booking steps' href (issue #1104 part 3): the calendar, this slot's pane, `book=1`, plus the
 * step's own params — `offering`, `guests` (selects the checkout step), `party` (prefills Guests).
 */
export function bookHref(
  data: HrefData,
  p: Pick<PendingHold, "vesselId" | "time">,
  extra: Record<string, string>,
): string {
  const base = calendarHref(data, { hold: `${p.vesselId}|${p.time}` });
  const q = new URLSearchParams(base.split("?")[1] ?? "");
  q.set("book", "1");
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `/admin/calendar?${q.toString()}`;
}

function SlotRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </>
  );
}

/** Is this slot the operator's own unpaid phone booking (16.1) — a `held` slot `phoneBookingBySlot`
 *  knows, as opposed to a customer at the checkout? What the Unpaid chip counts and keeps. */
function isUnpaidPhoneBooking(data: Pick<CalendarData, "phoneBookingBySlot">, s: VirtualSlot): boolean {
  return s.status === "held" && data.phoneBookingBySlot.has(slotKey(String(s.vesselId), s.date, s.time));
}

/** Does a slot pass the filter chip? Shared by the grid and the List (issue #1079). */
export function slotMatchesFilter(
  data: Pick<CalendarData, "filter" | "phoneBookingBySlot">,
  s: VirtualSlot,
): boolean {
  const filter = data.filter;
  if (filter === "all") return true;
  if (filter === "unpaid") return isUnpaidPhoneBooking(data, s);
  const want = FILTERS.find((f) => f.key === filter)?.status;
  // "Booked" means "this boat is committed", which includes a hull occupied by an imported
  // Xola charter. Matching only the literal `booked` status would filter those away and
  // disagree with the count beside the tab.
  if (want === "booked") return s.status === "booked" || s.status === "unavailable";
  return want === s.status;
}

/** `data-cal-selected` present on the selected card(s), absent elsewhere — what
 *  `RevealSelectedCard` looks for. A helper so the grid's render stays under the complexity ceiling. */
export const selectedAttr = (on: boolean): "" | undefined => (on ? "" : undefined);

/**
 * The grid itself: 52px time gutter + one column per fleet vessel, blocks absolutely
 * positioned over a fixed 8:00–21:30 axis. `selectedReservationId` rings the open block on
 * the detail route.
 */
export function CalendarGrid({
  data,
  selectedReservationId,
  fill = false,
}: {
  data: CalendarData;
  selectedReservationId?: string | undefined;
  /**
   * In the list-and-detail frame (a pane open): on desktop the grid's own box fills the column
   * under the controls and legend and scrolls both ways, with the row of boat names pinned to its
   * top (issue #1128). The box has to be the vertical scroller for that row to stick: inside a box
   * that only scrolls sideways, `sticky` has nothing to stick to. Without a pane the page scrolls
   * as it always has.
   */
  fill?: boolean;
}) {
  const gridCols = `52px repeat(${data.vessels.length}, minmax(120px, 1fr))`;
  // What is selected, as one string: a reservation, or the slot whose pane is open. Changes on
  // exactly the navigations that should re-reveal the selected card.
  const p = data.pending;
  const selectedKey =
    selectedReservationId ?? (p ? `${p.action}:${p.vesselId}|${p.time}` : "");
  const matchesFilter = (s: VirtualSlot) => slotMatchesFilter(data, s);

  const slotsByVessel = new Map<string, VirtualSlot[]>();
  for (const s of data.slots) {
    const k = String(s.vesselId);
    (slotsByVessel.get(k) ?? slotsByVessel.set(k, []).get(k)!).push(s);
  }

  return (
    <Card
      pad="none" className={`mt-2 overflow-hidden ${fill ? "lg:flex lg:min-h-[240px] lg:flex-1 lg:flex-col" : ""}`}
    >
      {/* Opening a pane re-renders the page: bring the selected card back into view (#1104). */}
      <RevealSelectedCard selectedKey={selectedKey} />
      <div
        data-cal-scroll
        data-testid="cal-grid-scroll"
        className={fill ? "overflow-x-auto lg:min-h-0 lg:flex-1 lg:overflow-y-auto" : "overflow-x-auto"}
      >
        {/* Header row: corner + vessel names with hue dots. Pinned to the top of the grid's box when
            it scrolls (issue #1128). Each CELL paints its own background and rule, not the row: the
            row is only as wide as the box, so scrolled sideways past it the boat names had nothing
            under them and the cards showed through ("Brew 4", operator 2026-09-30). */}
        <div
          data-cal-head
          data-testid="cal-head"
          className={`grid ${fill ? "lg:sticky lg:top-0 lg:z-20" : ""}`}
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="border-b border-line bg-card px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Time
          </div>
          {data.vessels.map((v) => (
            <div
              key={String(v.id)}
              className="flex items-center gap-1.5 border-b border-l border-line bg-card px-2 py-2 text-[11.5px] font-semibold text-ink"
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
                className="absolute right-1 -translate-y-[6px] text-right font-mono text-[10px] text-muted"
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
                    const cls = `absolute flex flex-col justify-center overflow-hidden rounded-box border px-2 py-1 ${offeringColorClass(
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
                        data-cal-selected={selectedAttr(selected)}
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
                  // it rings ALL of them — with the banner's scope sentence gone (16.1d), this ring
                  // is the only thing showing that a block takes every offering at that boat-time.
                  const asked =
                    data.pending?.action === "hold" &&
                    data.pending.vesselId === String(s.vesselId) &&
                    data.pending.time === s.time;
                  const ring = asked ? " ring-2 ring-ink ring-offset-1" : "";

                  if (s.status === "blocked") {
                    // A dark card is releasable HERE only when a single-slot hold is what made
                    // it dark. A `vessel` or `location` block covers far more than this card
                    // shows, so its pane only names it and opens it on /admin/blocks, where its
                    // scope is visible — the same reason `releaseVesselHoldAdmin` refuses one by id.
                    const hold = data.holdBySlot.get(physical);
                    const askedRelease =
                      (data.pending?.action === "release" &&
                        hold !== undefined &&
                        data.pending.blockId === String(hold.id)) ||
                      (data.pending?.action === "scoped" &&
                        data.pending.vesselId === String(s.vesselId) &&
                        data.pending.time === s.time);
                    // A slot block wears an accent border, a scoped one the plain line. Both dark
                    // and unsellable, but only one is the operator's own and undoable from
                    // here — if they looked identical the legend would be the only thing
                    // saying which dark cards click, and a legend is not where you look.
                    const cls = `absolute flex items-center justify-center overflow-hidden rounded-box border text-[10px] ${
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
                        data-cal-selected={selectedAttr(askedRelease)}
                        className={cls}
                        style={style}
                      >
                        Blocked
                      </AppLink>
                    ) : (
                      // A boat-out or closure: not undoable from one card, but no longer inert —
                      // its pane names the block and opens it on Blocks (issue #1091).
                      <AppLink
                        key={key}
                        href={calendarHref(data, { scoped: `${String(s.vesselId)}|${s.time}` })}
                        spinner="overlay"
                        aria-label={`Blocked ${shortTime(s.time)}, ${
                          data.vesselById.get(String(s.vesselId))?.name ?? String(s.vesselId)
                        }`}
                        data-testid="cal-block"
                        data-vessel={String(s.vesselId)}
                        data-status="blocked"
                        data-blocked-by="scoped"
                        data-cal-selected={selectedAttr(askedRelease)}
                        className={cls}
                        style={style}
                      >
                        Blocked
                      </AppLink>
                    );
                  }

                  // A customer is at the checkout for this exact slot (14.9, §2.8.10), or the
                  // departure has already left (issue #824). Both are INERT: the fallthrough
                  // below draws an "open" card whose link takes the slot off the market, and
                  // neither of these is open. Blocking a slot somebody is mid-purchase of does
                  // not cancel their claim, and blocking a trip that already sailed means
                  // nothing at all — so the card says what it is and does not invite a click.
                  //
                  // They are separate from `blocked` above rather than folded into it because a
                  // dark card there is the operator's own act and undoable from here; neither of
                  // these is either. `held` clears itself when the payment window runs out.
                  // The one `held` card that IS the operator's own (16.1): an unpaid phone booking.
                  // It never clears by itself (DEC-163), so it has to lead somewhere — its pane,
                  // where it is paid for or cancelled.
                  const phoneBooking =
                    s.status === "held" ? data.phoneBookingBySlot.get(physical) : undefined;
                  if (phoneBooking) {
                    return (
                      <AppLink
                        key={key}
                        href={detailHref(data, String(phoneBooking.id))}
                        spinner="overlay"
                        aria-label={`Awaiting payment, ${phoneBooking.customerName}, ${shortTime(s.time)}`}
                        data-testid="cal-block"
                        data-vessel={String(s.vesselId)}
                        data-status="awaiting-payment"
                        data-cal-selected={selectedAttr(selectedReservationId === String(phoneBooking.id))}
                        // eslint-disable-next-line muster/surface -- a calendar block tinted for "Unpaid", not a message box: <Notice> has no absolute position or grid size (issue #484)
                        className={`absolute flex flex-col justify-center overflow-hidden rounded-box border border-dashed border-warn-line bg-warn-bg px-2 py-1 text-warn${
                          selectedReservationId === String(phoneBooking.id) ? " ring-2 ring-ink ring-offset-1" : ""
                        }`}
                        style={pos}
                      >
                        {/* Laid out like a booked card — who, then time · party — so the customer is
                            on the grid (#1104). The amber dashed tint and "Unpaid" say it is not a
                            sale yet. */}
                        <span className="truncate text-[11px] font-semibold">{phoneBooking.customerName}</span>
                        <span className="font-mono text-[9.5px]">
                          {shortTime(s.time)} · {phoneBooking.partySize} · Unpaid
                        </span>
                      </AppLink>
                    );
                  }

                  if (s.status === "held" || s.status === "departed") {
                    const departed = s.status === "departed";
                    return (
                      <div
                        key={key}
                        data-testid="cal-block"
                        data-vessel={String(s.vesselId)}
                        data-status={s.status}
                        className={`absolute flex items-center justify-center overflow-hidden rounded-box border text-[10px] ${
                          departed
                            ? "border-line border-dashed text-muted"
                            : "border-accent/60 font-medium text-accent"
                        }`}
                        style={{ ...pos, background: "transparent" }}
                      >
                        {departed ? "Departed" : "Checking out"}
                      </div>
                    );
                  }

                  // available → an offering-tinted dashed "open" block. The link opens the confirm
                  // that books it by phone (16.1) or takes it OFF the market (#703). The href is
                  // keyed on the PHYSICAL slot, not the offering, so every card sharing a
                  // boat-time leads to the same confirm — which is what the block really does, and
                  // the Book page asks which offering when more than one sells the slot.
                  return (
                    <AppLink
                      key={key}
                      href={calendarHref(data, {
                        hold: `${String(s.vesselId)}|${s.time}`,
                      })}
                      spinner="overlay"
                      // The card says "open" and the link asks to BOOK or BLOCK it — without a
                      // name of its own a screen reader announces the state and hides the action.
                      aria-label={`Book or block ${shortTime(s.time)}, ${
                        data.vesselById.get(String(s.vesselId))?.name ?? String(s.vesselId)
                      }${s.phoneOnly ? ", phone only" : ""}`}
                      data-testid="cal-block"
                      data-vessel={String(s.vesselId)}
                      data-status="available"
                      data-cal-selected={selectedAttr(asked)}
                      data-lane={laneCount > 1 ? `${lane + 1}/${laneCount}` : undefined}
                      // Which offering a sliver belongs to is the thing 1/n width takes away.
                      // The tint says it against the legend.
                      className={`absolute flex items-center justify-center overflow-hidden rounded-box border-2 border-dashed text-[10px] text-muted ${offeringOpenClass(
                        String(s.offeringId),
                      )}${ring}`}
                      style={pos}
                    >
                      {/* Inside the booking cutoff (DEC-193, §2.10.2): drawn as open, marked. */}
                      open · {shortTime(s.time)}
                      {s.phoneOnly && " · phone only"}
                    </AppLink>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
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
