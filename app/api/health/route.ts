import pg from "pg";
import { NextResponse } from "next/server";
import { SEAT_STATES, SHIFT_STATES } from "@core/domain/states.js";

/**
 * Health route (DEC-020). Two jobs:
 *  1. Topology proof — a Next server route importing the framework-free core via
 *     `@core/*`; if this builds and serves, the core is consumable without leaking
 *     a framework import into src/.
 *  2. Real readiness — a **cheap** Postgres ping (`select 1`).
 *
 * Dev-without-Docker returns `degraded` (db unreachable) rather than failing —
 * the app itself is up. A prod deploy can map `degraded` → 503 at the edge.
 *
 * Unauthenticated, so it does **only** bounded work (10.3 security audit): a single
 * `select 1`, never a table scan. The referential-integrity diagnostic (`checkIntegrity`,
 * ~a dozen full-table `listAll*` reads) used to run here on every hit — an anonymous
 * compute-amplification/DoS vector — so it moved OFF this path. Run it from an
 * authenticated admin diagnostic or a scheduled job, never an open probe (issue filed).
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
    await pool.query("select 1"); // cheap liveness — bounded work for an open endpoint
    return NextResponse.json({
      status: "ok",
      core,
      db: { reachable: true },
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
