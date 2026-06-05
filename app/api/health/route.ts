import { NextResponse } from "next/server";
import { SEAT_STATES, SHIFT_STATES } from "@core/domain/states.js";

/**
 * Health route — the topology proof (DEC-020): a Next server route importing the
 * framework-free domain core via the `@core/*` alias. If this builds and returns
 * the state vocabularies, the core is consumable from the app without leaking a
 * framework import back into src/. (A real readiness check — DB ping, etc. —
 * lands with the Postgres adapter in PR 2.)
 */
export function GET() {
  return NextResponse.json({
    status: "ok",
    core: { shiftStates: SHIFT_STATES, seatStates: SEAT_STATES },
  });
}
