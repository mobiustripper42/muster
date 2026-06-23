/**
 * Xola live-API Land adapter (DEC-036 → DEC-043) — the ingest behind the DEC-015
 * Land→Map→Reconcile seam. It produces `RawReservationRecord[]` and hands them to
 * `importRecords`; everything downstream (event upsert, identity, DEC-029
 * materiality) is unchanged.
 *
 * **DEC-043 (events-driven):** the boat a trip runs on is a Xola **Resource** on
 * the trip's *event* (`event.resourceUsages[].resource.id`), not a vessel invented
 * from the product string (DEC-016, retired). So a pull is two feeds joined on
 * `event.id`:
 *   - `/orders` → the bookings (reservation id, customer, pax, status, the
 *     `item.event.id` join key) — same shape DEC-036 settled.
 *   - `/events` → one boat-trip per row, carrying `resourceUsages` (the boat)
 *     inline. A BARE ARRAY, not a `{data,paging}` page; it ignores date filters,
 *     so it returns a now-forward window — the windowed `/orders` pull is what
 *     bounds the import (a booked trip out of that window forms no record).
 * `eventVesselMap` resolves the events to real vessels; `mapXolaOrders` stamps the
 * resolved `vesselId` + the real `eventId` onto each booked record.
 *
 * What the live (prod) response settled (Session 22), vs DEC-036's guesses:
 *  - **Reservation identity = `items[].id`** — stable, unique, cross-referenced on
 *    `event.purchaseItems[].id`. We do NOT synthesize a key.
 *  - **Cancels are status-flip-in-place:** a cancelled booking keeps its `id` +
 *    `event.id` and flips to status 700 (verified on real cancellations) — so
 *    cancel detection is a status match across pulls, never absence-tracking.
 *  - **Time is vessel-local wall-clock under a misleading `Z`/offset:** the order
 *    item's `arrivalDatetime` ("…T18:00:00-04:00") and the event's `start`
 *    ("…T18:00:00+00:00") are BOTH 18:00 *local* (DEC-032) — string-slice, never
 *    `new Date(...)`, or every departure shifts by the offset.
 *
 * Layering (DEC-020): the pure pieces — `mapXolaOrders`, `eventVesselMap`, and the
 * `fetchOrders` pagination loop — take an injected `fetcher` and are unit-tested
 * with no I/O. The real network call (`makeXolaFetcher`) is built at the Next edge.
 */

import { isClockTime, isIsoDate } from "../domain/iso-date.js";
import type { VesselId } from "../domain/ids.js";
import type { RawReservationRecord, SkippedRow } from "./import-reservations.js";
import { resolveResource } from "./resource-map.js";

export const XOLA_API_VERSION = "2021-03-10";
export const XOLA_API_BASE_DEFAULT = "https://xola.com/api";

/**
 * The confirmed-booking family (matches the sibling extractor / crewbook DEC-115):
 * 200 confirmed, 201 deposit, 202 confirmed-uncharged, 203 pay-later. 700 is a
 * cancelled item — we **include** it in the pull (unlike the tip extractor, which
 * drops it) so a booked→cancelled transition actually reconciles; the mapper turns
 * 700 into a `cancelled` record and the rest into `booked`.
 */
export const BOOKED_STATUS_CODES = [200, 201, 202, 203] as const;
export const CANCELLED_STATUS_CODE = 700;
export const PULL_STATUS_CODES = [...BOOKED_STATUS_CODES, CANCELLED_STATUS_CODE];

const DEFAULT_PAGE_LIMIT = 100;
/** Pagination backstop — a runaway loop guard, far above any real window. */
const DEFAULT_MAX_ITEMS = 5000;

export class XolaError extends Error {
  readonly status?: number;
  readonly path?: string;
  constructor(message: string, opts: { status?: number; path?: string } = {}) {
    super(message);
    this.name = "XolaError";
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.path !== undefined) this.path = opts.path;
  }
}

/** Server-only config (never `NEXT_PUBLIC`). Read + validated at the edge. */
export interface XolaEnv {
  apiKey: string;
  sellerId: string;
  base: string;
  apiVersion: string;
}

// ── Wire shapes (only the fields we read; Xola returns far more) ──────────────

export interface XolaOrderItem {
  id?: string;
  name?: string;
  /** Vessel-local date, "YYYY-MM-DD". */
  arrival?: string;
  /** Vessel-local wall-clock as HHMM int, e.g. 1800 = 18:00. */
  arrivalTime?: number;
  /** Vessel-local instant with offset, "2026-06-06T18:00:00-04:00". Richest source. */
  arrivalDatetime?: string;
  quantity?: number;
  status?: number;
  /** The boat-trip this item belongs to — the join key into `/events` (DEC-043). */
  event?: { id?: string };
}

export interface XolaOrder {
  id?: string;
  customerName?: string;
  phone?: string;
  phoneCanonical?: string;
  email?: string;
  items?: XolaOrderItem[];
}

export interface XolaPage {
  data: XolaOrder[];
  paging?: { next?: string | null };
}

/** One assigned Resource on an event — the boat lives in `resource.id` (DEC-043). */
export interface XolaResourceUsage {
  resource?: { id?: string };
}

/** A Xola event = one boat-trip. The `/events` list returns these inline. */
export interface XolaEvent {
  id?: string;
  /**
   * Vessel-local wall-clock under a misleading `Z`/`+00:00` suffix (DEC-032):
   * "2026-07-04T18:00:00+00:00" means 18:00 *local*. Slice it, never parse it.
   */
  start?: string;
  resourceUsages?: XolaResourceUsage[];
}

/** One HTTP GET against a `/api`-relative path → parsed JSON. An orders call is a
 * `{data,paging}` page; the events call is a bare array — callers cast. Injected. */
export type XolaFetcher = (path: string) => Promise<unknown>;

// ── Pure mapping: orders ⨝ events → records ──────────────────────────────────

/** 1800 → "18:00", 930 → "09:30". Null if not a sane HHMM. */
function formatHhmm(t: number): string | null {
  if (!Number.isInteger(t) || t < 0 || t > 2359) return null;
  const h = Math.floor(t / 100);
  const m = t % 100;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Pull vessel-local date + time off an item, preferring the offset-bearing instant. */
function itemDateTime(item: XolaOrderItem): { date: string; time: string } | null {
  // arrivalDatetime is "YYYY-MM-DDTHH:MM:SS±HH:MM" — the wall-clock is already
  // vessel-local (DEC-032), so a string slice is exact and tz-free.
  const dt = item.arrivalDatetime;
  if (typeof dt === "string" && dt.length >= 16) {
    return { date: dt.slice(0, 10), time: dt.slice(11, 16) };
  }
  if (typeof item.arrival === "string" && typeof item.arrivalTime === "number") {
    const time = formatHhmm(item.arrivalTime);
    if (time) return { date: item.arrival, time };
  }
  return null;
}

/**
 * Vessel-local date+time from a Xola event `start` — a **string slice, never a
 * `Date` parse** (DEC-032). `start` carries the local wall-clock under a `Z`/offset
 * suffix that is NOT the real zone, so `new Date(start)` would shift it by the
 * offset (verified: order `…-04:00` == event `start …+00:00`, both 18:00 local).
 */
function eventDateTime(ev: XolaEvent): { date: string; time: string } | null {
  const s = ev.start;
  if (typeof s === "string" && s.length >= 16) {
    return { date: s.slice(0, 10), time: s.slice(11, 16) };
  }
  return null;
}

/**
 * Build `eventId → vesselId` from the `/events` feed. Only **boated** events whose
 * resource maps to a crewed BrewBoat are included; self-captained Duffy resources
 * are excluded and unknown resource ids are quarantined (DEC-018, now keyed off the
 * stable resource id). Boat-less events (no `resourceUsages`) are simply absent —
 * a booking against one can't form a crewed shift (they reconcile, if cancelled,
 * against their stored event).
 */
export function eventVesselMap(events: XolaEvent[]): {
  vessels: Map<string, VesselId>;
  excluded: number;
  unmapped: SkippedRow[];
} {
  const vessels = new Map<string, VesselId>();
  let excluded = 0;
  const unmapped: SkippedRow[] = [];
  for (const ev of events) {
    const eventId = (ev.id ?? "").trim();
    if (!eventId) continue;
    // An event can carry more than one resource usage — take the FIRST that maps to
    // a crewed boat (don't assume index 0 is the boat). If none does, report why:
    // a self-captained Duffy → excluded; an unknown id → quarantined; no usable
    // resource at all → boat-less, silently skipped (not an error).
    let resolved = false;
    let sawExcluded = false;
    let unmappedReason: string | undefined;
    for (const u of ev.resourceUsages ?? []) {
      const rid = u.resource?.id;
      if (!rid) continue;
      const res = resolveResource(rid);
      if (res.kind === "mapped") {
        vessels.set(eventId, res.vessel.vesselId);
        resolved = true;
        break;
      }
      if (res.kind === "ignored") sawExcluded = true;
      else unmappedReason ??= res.reason;
    }
    if (resolved) continue;
    if (sawExcluded) excluded++;
    else if (unmappedReason) unmapped.push({ reason: unmappedReason });
  }
  return { vessels, excluded, unmapped };
}

/**
 * Pure: explode orders → one `RawReservationRecord` per item, stamping the resolved
 * boat (`vesselId`) + the real `eventId` from the join. Rules:
 *  - A missing item id, blank product name, missing `event.id`, or unparseable
 *    date/time drops just that item to `skipped` (batch-safe, never aborts).
 *  - A **booked** item whose event isn't boated-in-window is skipped (it can't form
 *    a crewed shift — rare; only the truncated-window edge, since boated ⟺ booked).
 *  - A **cancelled** item emits even without a resolved boat (its trip de-boated);
 *    `importRecords` reconciles it against its already-stored, already-boated event.
 */
export function mapXolaOrders(
  orders: XolaOrder[],
  eventVessels: Map<string, VesselId>,
): { records: RawReservationRecord[]; skipped: SkippedRow[] } {
  const records: RawReservationRecord[] = [];
  const skipped: SkippedRow[] = [];

  for (const order of orders) {
    for (const item of order.items ?? []) {
      const reservationId = (item.id ?? "").trim();
      const product = (item.name ?? "").trim();
      if (!reservationId) {
        skipped.push({ product, reason: "item missing id" });
        continue;
      }
      if (!product) {
        skipped.push({ reservationId, reason: "item missing product name" });
        continue;
      }
      const eventId = (item.event?.id ?? "").trim();
      if (!eventId) {
        skipped.push({ reservationId, product, reason: "item missing event ref" });
        continue;
      }
      const when = itemDateTime(item);
      if (!when || !isIsoDate(when.date) || !isClockTime(when.time)) {
        skipped.push({
          reservationId,
          product,
          reason: `unparseable arrival: "${item.arrivalDatetime ?? item.arrival}" "${item.arrivalTime ?? ""}"`,
        });
        continue;
      }
      const status = item.status === CANCELLED_STATUS_CODE ? "cancelled" : "booked";
      const vesselId = eventVessels.get(eventId);
      if (status === "booked" && !vesselId) {
        skipped.push({
          reservationId,
          product,
          reason: `booked item's event not boated/in-window: ${eventId}`,
        });
        continue;
      }
      // Logical-OR, not ??: prefer phoneCanonical only when non-empty; an empty ""
      // must fall through to the raw phone, not win.
      const phone = (order.phoneCanonical || order.phone || "").trim();
      const email = (order.email ?? "").trim();
      const partySize = Number.isFinite(item.quantity) ? Number(item.quantity) : 0;
      records.push({
        reservationId,
        product,
        date: when.date,
        time: when.time,
        eventId,
        customerName: (order.customerName ?? "").trim(),
        partySize,
        status,
        ...(vesselId ? { vesselId } : {}),
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
      });
    }
  }

  return { records, skipped };
}

// ── Pagination (injected fetcher; pure of real I/O) ──────────────────────────

/** Build the first `/orders?…` path for an [start, end] vessel-local date window. */
export function ordersPath(opts: {
  sellerId: string;
  start: string;
  end: string;
  statusCodes?: readonly number[];
  limit?: number;
}): string {
  const params = new URLSearchParams();
  params.set("seller", opts.sellerId);
  params.set("items.arrival[gte]", opts.start);
  params.set("items.arrival[lte]", opts.end);
  params.set("items.status[in]", (opts.statusCodes ?? PULL_STATUS_CODES).join(","));
  params.set("limit", String(opts.limit ?? DEFAULT_PAGE_LIMIT));
  return `/orders?${params.toString()}`;
}

/** Build the `/events?seller=…` path. Xola ignores date filters here and returns a
 * now-forward window as a bare array, so there's nothing to page — the caller trims. */
export function eventsPath(opts: { sellerId: string }): string {
  const params = new URLSearchParams();
  params.set("seller", opts.sellerId);
  return `/events?${params.toString()}`;
}

/**
 * Follow Xola's skip-based pagination on `/orders`: accumulate `data`, advance via
 * `paging.next` until it's null or a short page lands. `maxItems` turns a
 * never-terminating `next` into a loud error instead of an infinite loop.
 */
export async function fetchOrders(
  fetcher: XolaFetcher,
  opts: {
    sellerId: string;
    start: string;
    end: string;
    statusCodes?: readonly number[];
    limit?: number;
    maxItems?: number;
  },
): Promise<XolaOrder[]> {
  const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS;
  const all: XolaOrder[] = [];
  let path: string | null = ordersPath({ ...opts, limit });

  while (path) {
    const page = (await fetcher(path)) as XolaPage;
    const rows = Array.isArray(page?.data) ? page.data : [];
    all.push(...rows);
    const next = page?.paging?.next ?? null;
    if (rows.length < limit || !next) return all;
    if (all.length >= maxItems) {
      throw new XolaError(`fetchOrders: exceeded ${maxItems} items — refusing to loop`, {
        path,
      });
    }
    path = next;
  }
  return all;
}

/**
 * Pull the `/events` feed (one boat-trip per element). Xola returns a BARE ARRAY
 * here, not a paged `{data}`, and ignores date filters — so this is a single GET of
 * the default now-forward window; the windowed `/orders` pull bounds the import.
 */
export async function fetchEvents(
  fetcher: XolaFetcher,
  opts: { sellerId: string },
): Promise<XolaEvent[]> {
  const raw = await fetcher(eventsPath(opts));
  return Array.isArray(raw) ? (raw as XolaEvent[]) : [];
}

// ── Real fetcher (edge I/O: global fetch + auth + retry) ──────────────────────

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 250;
const RETRY_AFTER_CAP_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs < 0) return null;
  return Math.min(secs * 1000, RETRY_AFTER_CAP_MS);
}

/**
 * The real network fetcher: `X-API-Key` + `X-API-Version` auth, retry on 5xx/429
 * (honoring `Retry-After`, capped) and transport errors, throw on any other 4xx.
 * `sleeper` is injectable so a retry path can be tested without real delay.
 */
export function makeXolaFetcher(
  env: XolaEnv,
  deps: { fetchImpl?: typeof fetch; sleeper?: (ms: number) => Promise<void> } = {},
): XolaFetcher {
  const doFetch = deps.fetchImpl ?? fetch;
  const doSleep = deps.sleeper ?? sleep;
  const base = env.base.replace(/\/+$/, "");

  return async (path: string): Promise<unknown> => {
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, {
          headers: {
            "X-API-Key": env.apiKey,
            "X-API-Version": env.apiVersion,
            Accept: "application/json",
          },
        });
      } catch (cause) {
        if (attempt >= RETRY_MAX_ATTEMPTS) {
          throw new XolaError(`Xola request failed: ${String(cause)}`, { path });
        }
        await doSleep(RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      if (res.ok) return (await res.json()) as unknown;
      const retriable = res.status >= 500 || res.status === 429;
      if (!retriable || attempt >= RETRY_MAX_ATTEMPTS) {
        throw new XolaError(`Xola ${res.status} ${res.statusText} for ${path}`, {
          status: res.status,
          path,
        });
      }
      const delay =
        res.status === 429
          ? (retryAfterMs(res) ?? RETRY_BASE_MS * 2 ** (attempt - 1))
          : RETRY_BASE_MS * 2 ** (attempt - 1);
      await doSleep(delay);
    }
  };
}
