import pg from "pg";
import { NextResponse } from "next/server";
import { checkIntegrity } from "@core/admin/integrity.js";
import { PostgresRepository } from "@core/adapters/postgres-repository.js";
import { SEAT_STATES, SHIFT_STATES } from "@core/domain/states.js";

/**
 * Health route (DEC-020). Two jobs:
 *  1. Topology proof — a Next server route importing the framework-free core via
 *     `@core/*`; if this builds and serves, the core is consumable without leaking
 *     a framework import into src/.
 *  2. Real readiness — pings Postgres and runs the referential-integrity
 *     diagnostic (the no-FK loud-failure relocated to our schedule, DEC-DATA-1).
 *     A dangling reference no foreign key would catch surfaces here as `degraded`.
 *
 * Dev-without-Docker returns `degraded` (db unreachable) rather than failing —
 * the app itself is up. A prod deploy can map `degraded` → 503 at the edge.
 *
 * This endpoint is unauthenticated, so it returns only a verdict + a violation
 * COUNT — never the violations themselves, which carry crew ids and internal
 * topology. The full report is logged server-side for ops; an authenticated
 * admin diagnostic surface (1.5b) can expose the detail.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://muster:muster@localhost:5432/muster_dev";

export async function GET() {
  const core = { shiftStates: SHIFT_STATES, seatStates: SEAT_STATES };

  // Short timeout so a down DB degrades fast instead of hanging the probe.
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 2000,
  });
  try {
    const report = await checkIntegrity(new PostgresRepository(pool));
    if (!report.ok) {
      // Detail (crew ids, dangling refs) goes to the server log, not the wire.
      console.warn("[health] integrity violations", report.violations);
    }
    return NextResponse.json({
      status: report.ok ? "ok" : "degraded",
      core,
      db: { reachable: true },
      integrity: { ok: report.ok, violationCount: report.violations.length },
    });
  } catch {
    return NextResponse.json({
      status: "degraded",
      core,
      db: { reachable: false },
    });
  } finally {
    await pool.end();
  }
}
