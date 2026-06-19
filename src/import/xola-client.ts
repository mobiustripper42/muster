/**
 * Xola live-API Land adapter (DEC-036, task 5.4b) — the second ingest source
 * behind the DEC-015 Land→Map→Reconcile seam. It produces the same
 * `RawReservationRecord[]` the xlsx reader does and hands them to `importRecords`;
 * everything downstream (event upsert, identity, DEC-029 materiality, DEC-018
 * product quarantine) is unchanged.
 *
 * Ported from the sibling `xola-tip-extractor` client, trimmed to the two things
 * Muster needs (orders only — no gratuity/guide machinery) and re-grounded on a
 * live sandbox response (2026-06-18). What that response settled, vs DEC-036's
 * guesses:
 *  - **No `expand` needed.** `items[]`, the item `name`, `arrival*`, and `quantity`
 *    all come inline; `event`/`experience`/`organizer`/`travelers` are `{id}` refs
 *    we don't need to form shifts.
 *  - **Contact is order-level, inline:** `order.phone` / `order.phoneCanonical`
 *    (NOT `organizer.phone`) — so the DEC-017 customers-export email-join dies; we
 *    thread phone straight through.
 *  - **Reservation identity = `items[].id`** (one record per item, since a Xola
 *    order can hold several bookable items).
 *  - **Party size = `items[].quantity`** (agrees with `guests.length`).
 *  - **Time is vessel-local inline:** `arrivalDatetime` ("…T18:00:00-04:00") carries
 *    the vessel offset, so the wall-clock components need no tz math (DEC-032) — no
 *    instant laundering, which was DEC-036 seam-B's whole worry.
 *
 * Layering (DEC-020): the pure pieces — `mapXolaOrders` and the `fetchOrders`
 * pagination loop — take an injected `fetcher` and are unit-tested with no I/O.
 * The real network call (`makeXolaFetcher`: global `fetch` + auth headers + retry)
 * is built at the Next edge and passed in, like the postgres adapter's connection.
 */

import { isClockTime, isIsoDate } from "../domain/iso-date.js";
import type { RawReservationRecord, SkippedRow } from "./import-reservations.js";

export const XOLA_API_VERSION = "2021-03-10";
export const XOLA_API_BASE_DEFAULT = "https://xola.com/api";

/**
 * The confirmed-booking family (matches the sibling extractor / crewbook DEC-115):
 * 200 confirmed, 201 deposit, 202 confirmed-uncharged, 203 pay-later. 700 is a
 * cancelled item — we **include** it in the pull (unlike the tip extractor, which
 * drops it) so a booked→cancelled transition actually reconciles (Architecture B
 * job #3); the mapper turns 700 into a `cancelled` record and the rest into
 * `booked`, exactly as the xlsx Status column does.
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

/** One HTTP GET against a `/api`-relative path → parsed page. Injected for tests. */
export type XolaFetcher = (path: string) => Promise<XolaPage>;

// ── Pure mapping: orders → records ───────────────────────────────────────────

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
  // vessel-local (the offset IS the vessel zone, DEC-032), so a string slice is
  // exact and tz-free.
  const dt = item.arrivalDatetime;
  if (typeof dt === "string" && dt.length >= 16) {
    return { date: dt.slice(0, 10), time: dt.slice(11, 16) };
  }
  // Fallback: the split components.
  if (typeof item.arrival === "string" && typeof item.arrivalTime === "number") {
    const time = formatHhmm(item.arrivalTime);
    if (time) return { date: item.arrival, time };
  }
  return null;
}

/**
 * Pure: explode orders → one `RawReservationRecord` per item. A missing id, a
 * blank product name, or an unparseable date/time drops just that item to
 * `skipped` (batch-safe, mirrors the xlsx decoder) — never aborts the run.
 */
export function mapXolaOrders(orders: XolaOrder[]): {
  records: RawReservationRecord[];
  skipped: SkippedRow[];
} {
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
      const when = itemDateTime(item);
      if (!when || !isIsoDate(when.date) || !isClockTime(when.time)) {
        skipped.push({
          reservationId,
          product,
          reason: `unparseable arrival: "${item.arrivalDatetime ?? item.arrival}" "${item.arrivalTime ?? ""}"`,
        });
        continue;
      }
      const phone = (order.phoneCanonical ?? order.phone ?? "").trim();
      const email = (order.email ?? "").trim();
      const partySize = Number.isFinite(item.quantity) ? Number(item.quantity) : 0;
      records.push({
        reservationId,
        product,
        date: when.date,
        time: when.time,
        customerName: (order.customerName ?? "").trim(),
        partySize,
        status: item.status === CANCELLED_STATUS_CODE ? "cancelled" : "booked",
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

/**
 * Follow Xola's skip-based pagination: accumulate `data`, advance via
 * `paging.next` (a ready-made path) until it's null or a short page lands. The
 * `maxItems` backstop turns a never-terminating `next` into a loud error instead
 * of an infinite loop.
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
    const page: XolaPage = await fetcher(path);
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

  return async (path: string): Promise<XolaPage> => {
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
      if (res.ok) return (await res.json()) as XolaPage;
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
