import { NextResponse } from "next/server";
import { XolaError } from "@core/import/xola-client.js";
import { persistImportRun } from "../../../lib/import-audit";
import { getRepo } from "../../../lib/repo";
import { runXolaPull } from "../../../lib/xola";

/**
 * Xola pull endpoint (DEC-036, task 5.4b) — Architecture B's primary ingest.
 *
 * **NO CRON IS ATTACHED, AND NONE IS COMING.** This ran on its own `vercel.json`
 * schedule (`0 * * * *`) until `13d3fb5` removed it — the operator wants to control
 * when imports land, so the only path that reaches this code today is the "Pull from
 * Xola now" button at `/admin/import`. The route survives as the shared runner
 * behind that action; it is not a scheduled job. Don't re-add the schedule without
 * an operator decision — a background import is exactly what was ruled out.
 *
 * Read-only against Xola; idempotent downstream (identity on `items[].id`,
 * DEC-029 materiality), so a re-pull over an overlapping window is a cheap no-op.
 * The manual xlsx upload (5.4a) is retired outright (DEC-043 — it can't resolve a
 * boat), so there is no fallback ingest either.
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
  const repo = getRepo();
  try {
    const r = await runXolaPull(repo, now);
    // Persist the audit record (#128, DEC-056) — the cron is the highest-payoff
    // path: an unattended hourly pull left no trace before this. BEST-EFFORT: a
    // failed audit write must not mask a successful import as a 502 (false alert +
    // a needless retry) — log it and still report ok (#128 code-review).
    let runId: string | null = null;
    try {
      runId = await persistImportRun(repo, r, "cron", now);
    } catch (auditErr) {
      console.error("xola-pull audit persist failed (import succeeded)", auditErr);
    }
    return NextResponse.json({
      ok: true,
      at: now.toISOString(),
      runId,
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
