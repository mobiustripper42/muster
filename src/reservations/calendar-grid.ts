/**
 * Pure geometry + colour helpers for the Day·Grid reservation calendar (#464, 12.11).
 * Framework-free (plain strings + arithmetic) so they unit-test without React/Next.
 *
 * The grid renders one day as boat columns × a fixed vertical time axis. A slot's block
 * is absolutely positioned by {@link gridPosition}; its colour comes from the offering it
 * belongs to. Laid out to `docs/design/mockups/reservation-calendar-scale.html` — the
 * "Day · Grid (A revised)" section (window 8:00–21:30 = 810 min; top=(min−480)/810).
 */

// ── Time window (matches the mockup: 8:00 → 21:30) ───────────────────────────
/** Grid start — 08:00 in minutes-since-midnight. */
import type { VesselId } from "../domain/ids.js";

export const GRID_START_MIN = 8 * 60; // 480
/** Grid end — 21:30 in minutes-since-midnight. */
export const GRID_END_MIN = 21 * 60 + 30; // 1290
/** Total vertical span in minutes — the denominator for every top/height %. */
export const GRID_SPAN_MIN = GRID_END_MIN - GRID_START_MIN; // 810

/**
 * Fallback trip length (minutes) for the legacy/nullable case ONLY. `Offering.tripLengthMinutes`
 * is semantically always set (operator-confirmed); this covers an old offering that predates the
 * field, so a block still gets a sane height instead of collapsing to zero.
 */
export const DEFAULT_TRIP_MINUTES = 90;

/**
 * "HH:MM" → the grid's terse clock, no am/pm: "13:30" → "1:30". Malformed input passes through
 * unchanged rather than rendering "NaN:30" in a card.
 *
 * Lives in core, not in the view, because the e2e specs address open slots by their VISIBLE
 * label ("open · 3:30"). A spec that reimplements the format asserts its own idea of correct,
 * which is how a test keeps passing while the card says something else.
 */
export function shortTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]}`;
}

/** "HH:MM" → minutes since midnight. Returns NaN for a malformed clock. */
export function parseHhmmToMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Absolute-position a slot in its vessel column. `topPct` is where the block's top edge sits
 * (0% = 8:00), `heightPct` is its duration as a fraction of the 810-min span — both in percent,
 * ready to drop into `style={{ top, height }}`.
 *
 * Sanity from the mockup: 11:30 → top 25.9%; 100 min → 12.3%; 90 min → 11.1%; 150 min → 18.5%.
 */
export function gridPosition(
  time: string,
  durationMin: number,
): { topPct: number; heightPct: number } {
  const startMin = parseHhmmToMinutes(time);
  const topPct = ((startMin - GRID_START_MIN) / GRID_SPAN_MIN) * 100;
  const heightPct = (durationMin / GRID_SPAN_MIN) * 100;
  return { topPct, heightPct };
}

// ── Lanes for concurrent slots (#702) ────────────────────────────────────────

/** Where a slot sits across the width of its column: lane `n` of `laneCount`. */
export type LanePlacement = { lane: number; laneCount: number };

/**
 * Share a vessel column between slots that run at the same time (#702).
 *
 * A boat-time can be scheduled by more than one offering — three ways to sell one hour, only one
 * of which can be sold. Every block is absolutely positioned from its start time, so concurrent
 * ones landed at identical coordinates and drew on top of each other: in the seeded fixture, three
 * deep, text over text. This is the standard calendar answer — side by side at 1/n width — and it
 * is the geometry half only; what each card *says* at 1/3 width is the view's problem.
 *
 * **Overlap is an interval question, not an equal-start-time one.** A 14:00 departure that begins
 * inside a 13:30 trip collides with it just as surely as a second 13:30 does. A check keyed on
 * matching times finds the second and misses the first, while appearing to work — which is worse
 * than not checking, because the remaining overlap looks like a rendering glitch rather than a
 * missing rule.
 *
 * Intervals are **half-open**: a trip ending at 14:30 does not overlap a departure at 14:30, so a
 * back-to-back schedule keeps full-width cards. Treating that as a collision would halve every
 * card on the busiest days, which is exactly the days that matter.
 *
 * `laneCount` is per **cluster** — a connected run of overlaps — not per slot, so every card in
 * one run gets the same width and their edges line up. A slot that overlaps nothing is lane 0 of
 * 1: unchanged geometry, which is what keeps this invisible on the ordinary single-offering day.
 *
 * Returns placements **parallel to the input array** (index in, index out). Ties on start time
 * fall back to input order, so the caller's order decides — and the caller's order is derived
 * deterministically, so a card does not swap lanes between two renders of the same day.
 */
export function assignLanes(
  slots: readonly { time: string; durationMin: number }[],
): LanePlacement[] {
  const out: LanePlacement[] = [];
  if (slots.length === 0) return out;

  const items = slots.map((s, i) => {
    const start = parseHhmmToMinutes(s.time);
    // A non-positive or non-finite duration becomes zero-length: it can share an edge with
    // anything and overlaps nothing, rather than poisoning every comparison in its cluster.
    const span = Number.isFinite(s.durationMin) && s.durationMin > 0 ? s.durationMin : 0;
    return { i, start, end: start + span };
  });

  // A malformed clock parses to NaN, and every NaN comparison is false — left in the sweep it
  // would sort unpredictably and read as overlapping nothing, i.e. land in lane 0 on top of a
  // real card. It gets its own full-width placement instead, and the geometry helper already
  // renders it harmlessly.
  const placeable = items.filter((x) => Number.isFinite(x.start));
  for (const x of items) {
    if (!Number.isFinite(x.start)) out[x.i] = { lane: 0, laneCount: 1 };
  }

  placeable.sort((a, b) => a.start - b.start || a.end - b.end || a.i - b.i);

  let cluster: typeof placeable = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const flush = (): void => {
    /** The end time currently occupied by each lane; a lane is free once it ends. */
    const laneEnds: number[] = [];
    const laneOf = new Map<number, number>();
    for (const x of cluster) {
      let lane = laneEnds.findIndex((end) => end <= x.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(x.end);
      } else {
        laneEnds[lane] = x.end;
      }
      laneOf.set(x.i, lane);
    }
    for (const x of cluster) out[x.i] = { lane: laneOf.get(x.i)!, laneCount: laneEnds.length };
    cluster = [];
  };

  for (const x of placeable) {
    // A slot starting at or after everything seen so far begins a new cluster — nothing before it
    // can still be running, so its width is decided independently.
    if (cluster.length > 0 && x.start >= clusterEnd) {
      flush();
      clusterEnd = Number.NEGATIVE_INFINITY;
    }
    cluster.push(x);
    clusterEnd = Math.max(clusterEnd, x.end);
  }
  if (cluster.length > 0) flush();

  return out;
}

// ── Offering colour (the #495 gap) ───────────────────────────────────────────
//
// Offerings carry NO colour field (#495): the calendar needs a stable per-offering hue so
// two offerings on the same day read apart, so we DERIVE one — hash the offering id into a
// fixed palette, exactly like vessel-hue.ts does for boats. This is a display-only stopgap;
// whether colour becomes a stored Offering value is deferred (#495). Reuses the DEC-021/042
// `--color-vessel-N` palette tokens (no new colours introduced).

/** How many palette hues an offering can land on. */
export const OFFERING_COLOR_COUNT = 6;

/** Literal Tailwind classes so the scanner sees them (index = hue − 1). */
const OFFERING_BLOCK_CLASSES = [
  "border-vessel-1/45 bg-vessel-1/15",
  "border-vessel-2/45 bg-vessel-2/15",
  "border-vessel-3/45 bg-vessel-3/15",
  "border-vessel-4/45 bg-vessel-4/15",
  "border-vessel-5/45 bg-vessel-5/15",
  "border-vessel-6/45 bg-vessel-6/15",
] as const;

const OFFERING_DOT_CLASSES = [
  "bg-vessel-1",
  "bg-vessel-2",
  "bg-vessel-3",
  "bg-vessel-4",
  "bg-vessel-5",
  "bg-vessel-6",
] as const;

/** Dashed-border tint (no fill) for an OPEN/available slot of this offering. */
const OFFERING_OPEN_CLASSES = [
  "border-vessel-1/40",
  "border-vessel-2/40",
  "border-vessel-3/40",
  "border-vessel-4/40",
  "border-vessel-5/40",
  "border-vessel-6/40",
] as const;

/** 1-based palette index (1…{@link OFFERING_COLOR_COUNT}) for an offering id — stable hash. */
export function offeringColorIndex(offeringId: string): number {
  let h = 7;
  for (const ch of offeringId) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (Math.abs(h) % OFFERING_COLOR_COUNT) + 1;
}

/** The tinted fill+border class bundle for a booked/available block of this offering. */
export function offeringColorClass(offeringId: string): string {
  return OFFERING_BLOCK_CLASSES[offeringColorIndex(offeringId) - 1]!;
}

/** The solid swatch/dot class for this offering (legend + header). */
export function offeringDotClass(offeringId: string): string {
  return OFFERING_DOT_CLASSES[offeringColorIndex(offeringId) - 1]!;
}

/** The dashed-border tint (transparent fill) for an OPEN slot of this offering. */
export function offeringOpenClass(offeringId: string): string {
  return OFFERING_OPEN_CLASSES[offeringColorIndex(offeringId) - 1]!;
}

/**
 * Should the operator's calendar draw this slot? (#615/#691, operator's call 2026-08-07.)
 *
 * `unavailable` covers two very different things, and the calendar must not treat them alike:
 *
 *  - **A real trip is running at this exact time.** The boat is out — a Xola charter, or a
 *    Muster departure. The operator has to see that, so it is DRAWN.
 *  - **Nothing is running here.** The slot is unsellable only because a trip at a *different*
 *    time overlaps it — a 17:30 charter reaching over an 18:00 departure. There is no booking
 *    and no trip; it is a departure the schedule proposes and the boat cannot make. Drawing it
 *    put a second "Booked" card on a hull that had sold one trip, which is what the operator
 *    saw. It is HIDDEN.
 *
 * Every other status draws as before. The customer surface makes no such distinction — it
 * collapses everything non-available to sold out, which is the honest answer to "can I book
 * this?" The operator's question is different: "what is my boat doing?"
 */
export function drawsOnCalendar(
  slot: { vesselId: VesselId; date: string; time: string; status: string },
  events: readonly { vesselId: VesselId; date: string; time: string; status: string }[],
): boolean {
  if (slot.status !== "unavailable") return true;
  return events.some(
    (e) =>
      e.status === "scheduled" &&
      String(e.vesselId) === String(slot.vesselId) &&
      e.date === slot.date &&
      e.time === slot.time,
  );
}
