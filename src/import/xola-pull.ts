/**
 * The Xola pull orchestrator (DEC-036, task 5.4b) — Architecture B's primary
 * ingest: a windowed `fetchOrders` → `mapXolaOrders` → `importRecords` →
 * `formShifts`, so the board self-updates without anyone uploading a spreadsheet.
 * Runs hourly off its own cron (`/api/cron/xola-pull`), isolated from the ask
 * `tick` so a Xola outage can't disrupt the engine.
 *
 * Pure of real I/O: the network `fetcher` is injected (the edge supplies the
 * `makeXolaFetcher` one; tests supply a fake), and `now` is injected like every
 * other clock op (DEC-023). So the whole chain — window math included — is
 * unit-tested against the in-memory repo. `app/lib/xola.ts` is the only piece
 * that touches `process.env` + global `fetch`.
 *
 * The window spans [today − 1d, today + leadDays + 1d] in vessel-local dates: the
 * back-day catches a just-cancelled near trip (reconcile — Architecture B job #3),
 * the forward span covers the staffing horizon the builder forms shifts within.
 */

import { STAFFING_HORIZON_LEAD_DAYS } from "../builder/derive.js";
import { formShifts } from "../builder/form-shifts.js";
import type { FormResult } from "../builder/form-shifts.js";
import { TENANT_TIMEZONE } from "../config/tenant.js";
import type { Repository } from "../ports/repository.js";
import { importRecords } from "./import-reservations.js";
import type { ImportResult } from "./import-reservations.js";
import { fetchOrders, mapXolaOrders } from "./xola-client.js";
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

/** [today − 1, today + leadDays + 1] in vessel-local dates. */
export function pullWindow(
  now: Date,
  leadDays: number = STAFFING_HORIZON_LEAD_DAYS,
  tz: string = TENANT_TIMEZONE,
): { start: string; end: string } {
  const today = vesselLocalDate(now, tz);
  return { start: addDays(today, -1), end: addDays(today, leadDays + 1) };
}

export interface XolaPullResult {
  window: { start: string; end: string };
  ordersFetched: number;
  recordsMapped: number;
  mapSkipped: number;
  import: ImportResult;
  form: FormResult;
}

/**
 * One pull cycle. `sellerId` + the `fetcher` come from the edge (env-derived);
 * `now`/`leadDays`/`tz` are injectable for tests. Order of ops matters: import the
 * reservations (which upserts events with derived status), THEN form shifts off
 * the refreshed events — same chain the xlsx surface uses.
 */
export async function pullXola(
  repo: Repository,
  fetcher: XolaFetcher,
  sellerId: string,
  now: Date = new Date(),
  opts: { leadDays?: number; tz?: string } = {},
): Promise<XolaPullResult> {
  const leadDays = opts.leadDays ?? STAFFING_HORIZON_LEAD_DAYS;
  const tz = opts.tz ?? TENANT_TIMEZONE;
  const window = pullWindow(now, leadDays, tz);

  const orders = await fetchOrders(fetcher, {
    sellerId,
    start: window.start,
    end: window.end,
  });
  const { records, skipped } = mapXolaOrders(orders);
  const imported = await importRecords(repo, records, now);
  const formed = await formShifts(repo, { now, leadDays });

  return {
    window,
    ordersFetched: orders.length,
    recordsMapped: records.length,
    mapSkipped: skipped.length,
    import: imported,
    form: formed,
  };
}
