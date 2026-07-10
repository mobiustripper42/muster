/**
 * The Xola pull orchestrator (DEC-036 → DEC-043) — Architecture B's primary
 * ingest: a windowed `fetchOrders` ⨝ `fetchEvents` → `mapXolaOrders` →
 * `importRecords` → `formShifts`, so the board self-updates without anyone
 * uploading a spreadsheet. Runs hourly off its own cron (`/api/cron/xola-pull`),
 * isolated from the ask `tick` so a Xola outage can't disrupt the engine.
 *
 * **Two feeds, joined on `event.id` (DEC-043):** orders carry the bookings; events
 * carry the assigned boat (`resourceUsages`). `eventVesselMap` resolves events →
 * vessels; `mapXolaOrders` stamps each booked record with its boat. Orders are
 * windowed [today−1, today+lead+1]; the events feed is now-forward (Xola ignores
 * its date filter), so the orders window is what bounds the import — a booked trip
 * whose event isn't boated-in-window surfaces in `mapSkipped` (the truncation tell).
 *
 * Pure of real I/O: the network `fetcher` is injected, and `now` is injected like
 * every clock op (DEC-023). So the whole chain — window math included — is
 * unit-tested against the in-memory repo. `app/lib/xola.ts` is the only piece that
 * touches `process.env` + global `fetch`.
 */

import {
  STAFFING_HORIZON_LEAD_DAYS,
  XOLA_PULL_LEAD_DAYS,
} from "../builder/derive.js";
import { formShifts } from "../builder/form-shifts.js";
import type { FormResult } from "../builder/form-shifts.js";
import { TENANT_TIMEZONE } from "../config/tenant.js";
import type { VesselId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { importRecords } from "./import-reservations.js";
import type { ImportResult, RawReservationRecord, SkippedRow } from "./import-reservations.js";
import { eventVesselMap, fetchEvents, fetchOrders, mapXolaOrders } from "./xola-client.js";
import type { XolaFetcher } from "./xola-client.js";

/** The vessel-local calendar date ("YYYY-MM-DD") of an instant, DST-correct. */
export function vesselLocalDate(at: Date, tz: string = TENANT_TIMEZONE): string {
  // en-CA renders ISO-style YYYY-MM-DD; the timeZone option does the DST math.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Add `n` (possibly negative) days to a "YYYY-MM-DD" string. Pure, UTC-anchored. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** [today − 1, today + leadDays + 1] in vessel-local dates. `leadDays` is the
 * Xola **pull** lead (DEC-080), decoupled from the staffing horizon. */
export function pullWindow(
  now: Date,
  leadDays: number = XOLA_PULL_LEAD_DAYS,
  tz: string = TENANT_TIMEZONE,
): { start: string; end: string } {
  const today = vesselLocalDate(now, tz);
  return { start: addDays(today, -1), end: addDays(today, leadDays + 1) };
}

/** One boat's trips on one day — a row of the operator's per-pull assignment review. */
export interface BoatAssignment {
  vesselId: VesselId;
  /** Departure clock times this boat runs that day, earliest first. */
  times: string[];
}

/** What this pull says runs each day — the surface the operator eyeballs to catch a
 * bad Xola boat assignment ("why is Brew 3 on Saturday?") before it matters. */
export interface DayAssignments {
  date: string;
  boats: BoatAssignment[];
}

/**
 * Group the pull's BOOKED records into a per-day boat→times view. Cancelled records
 * are omitted (they carry no boat and represent trips coming off the board). Pure.
 */
export function summarizeAssignments(records: RawReservationRecord[]): DayAssignments[] {
  // date → vesselId → set of times
  const byDay = new Map<string, Map<VesselId, Set<string>>>();
  for (const rec of records) {
    if (rec.status !== "booked" || !rec.vesselId) continue;
    const boats = byDay.get(rec.date) ?? new Map<VesselId, Set<string>>();
    const times = boats.get(rec.vesselId) ?? new Set<string>();
    times.add(rec.time);
    boats.set(rec.vesselId, times);
    byDay.set(rec.date, boats);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, boats]) => ({
      date,
      boats: [...boats.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([vesselId, times]) => ({
          vesselId,
          times: [...times].sort(),
        })),
    }));
}

export interface XolaPullResult {
  window: { start: string; end: string };
  ordersFetched: number;
  eventsFetched: number;
  /** Events with a resolved crewed boat (the join's usable rows). */
  boatedEvents: number;
  /** Boated events on a self-captained Duffy resource — excluded from crewing. */
  excludedResources: number;
  /** Events on an UNKNOWN resource id — a new/renamed boat to confirm (DEC-018). */
  unmappedResources: SkippedRow[];
  recordsMapped: number;
  mapSkipped: number;
  /** Booked trips whose event has no boat AND fall inside the pulled window (#338)
   *  — the actionable subset of `mapSkipped`: a real trip Xola hasn't boated yet.
   *  Assign a boat in Xola + re-import and it crews. Out-of-window booked-boatless
   *  rows stay a benign part of the `mapSkipped` count, not itemized here. */
  bookedNoBoat: SkippedRow[];
  import: ImportResult;
  form: FormResult;
  /** Per-day boat→times — the operator's review surface (catch bad assignments). */
  assignments: DayAssignments[];
}

/**
 * One pull cycle. `sellerId` + the `fetcher` come from the edge (env-derived);
 * `now`/`tz` and the two leads are injectable for tests. The Xola **pull** lead
 * (`opts.pullLeadDays`, default `XOLA_PULL_LEAD_DAYS`) sizes the `/orders`
 * fetch window; the **staffing horizon** (`opts.leadDays`, default
 * `STAFFING_HORIZON_LEAD_DAYS`) drives shift formation — decoupled per DEC-080,
 * so a wide pull never widens the ask horizon. Order of ops: resolve the boats
 * from `/events`, join them onto the windowed `/orders`, import (which upserts
 * events with derived status), THEN form shifts off the refreshed events.
 */
export async function pullXola(
  repo: Repository,
  fetcher: XolaFetcher,
  sellerId: string,
  now: Date = new Date(),
  opts: { leadDays?: number; pullLeadDays?: number; tz?: string } = {},
): Promise<XolaPullResult> {
  const horizonLeadDays = opts.leadDays ?? STAFFING_HORIZON_LEAD_DAYS;
  const pullLeadDays = opts.pullLeadDays ?? XOLA_PULL_LEAD_DAYS;
  const tz = opts.tz ?? TENANT_TIMEZONE;
  const window = pullWindow(now, pullLeadDays, tz);

  const orders = await fetchOrders(fetcher, {
    sellerId,
    start: window.start,
    end: window.end,
  });
  const events = await fetchEvents(fetcher, { sellerId });
  const { vessels, excluded, unmapped } = eventVesselMap(events);

  const { records, skipped } = mapXolaOrders(orders, vessels);
  // A booked item with no boat is only actionable when its trip date lands inside
  // the pulled window (#338) — an out-of-window one is just the window edge. Dates
  // are `YYYY-MM-DD`, same shape as the window bounds, so string compare is correct.
  const inWindow = (d?: string): boolean =>
    !!d && d >= window.start && d <= window.end;
  const bookedNoBoat = skipped.filter(
    (s) => s.category === "booked_no_boat" && inWindow(s.date),
  );
  const imported = await importRecords(repo, records, now);
  const formed = await formShifts(repo, { now, leadDays: horizonLeadDays });

  return {
    window,
    ordersFetched: orders.length,
    eventsFetched: events.length,
    boatedEvents: vessels.size,
    excludedResources: excluded,
    unmappedResources: unmapped,
    recordsMapped: records.length,
    mapSkipped: skipped.length,
    bookedNoBoat,
    import: imported,
    form: formed,
    assignments: summarizeAssignments(records),
  };
}
