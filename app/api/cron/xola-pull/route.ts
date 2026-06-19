import { NextResponse } from "next/server";
import { XolaError } from "@core/import/xola-client.js";
import { getRepo } from "../../../lib/repo";
import { runXolaPull } from "../../../lib/xola";

/**
 * Hourly Xola pull (DEC-036, task 5.4b) — Architecture B's primary ingest, on its
 * OWN cron (`vercel.json`, `0 * * * *`) rather than folded into `/api/cron/tick`.
 * The isolation is deliberate: a Xola 5xx on a crew Saturday must not take down
 * the ask `tick`, and the two have different cadences (hourly vs every 15m).
 *
 * Read-only against Xola; idempotent downstream (identity on `items[].id`,
 * DEC-029 materiality), so a re-pull over an overlapping window is a cheap no-op.
 * The manual xlsx upload (5.4a) stays the Xola-downtime fallback.
 *
 * `runtime = "nodejs"` — the pull writes through `pg`, which the Edge runtime
 * can't open a TCP socket for.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Same fail-closed Bearer guard as /api/cron/tick — a public URL must not be
  // able to trigger a pull (it spends Xola API budget and rewrites shifts).
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = new Date();
  try {
    const r = await runXolaPull(getRepo(), now);
    return NextResponse.json({
      ok: true,
      at: now.toISOString(),
      window: r.window,
      ordersFetched: r.ordersFetched,
      recordsMapped: r.recordsMapped,
      mapSkipped: r.mapSkipped,
      reservationsAdded: r.import.reservationsAdded,
      reservationsUpdated: r.import.reservationsUpdated,
      reservationsNewlyCancelled: r.import.reservationsNewlyCancelled,
      eventsCreated: r.import.eventsCreated,
      shiftsCreated: r.form.shiftsCreated,
      shiftsUpdated: r.form.shiftsUpdated,
    });
  } catch (e) {
    // A Xola outage / config gap is reported as a failed run (502), not a 500
    // stack — the cron retries next hour. Only echo a XolaError's message (path +
    // status, never the key); anything else collapses to a generic code so a
    // future thrower can't leak a secret into the response. Full error → logs.
    console.error("xola-pull failed", e);
    const error = e instanceof XolaError ? e.message : "pull_failed";
    return NextResponse.json({ ok: false, at: now.toISOString(), error }, { status: 502 });
  }
}
