import { NextResponse } from "next/server";
import { tick } from "@core/builder/tick.js";
import { getRepo } from "../../../lib/repo";
import { forwardToOutbox } from "../../../lib/channel";
import { forwardBoardAlerts } from "../../../lib/alert";

/**
 * The engine tick, on a schedule — the DEC-023 "explicit clock op" trigger, fired
 * by Vercel Cron at the first hosted deploy (DEC-033). Vercel GETs this per
 * `vercel.json` `crons`; `tick` advances shift state, fires Tier-1 broadcasts /
 * Tier-2 escalations, and records board landings, and the fired asks are
 * forwarded to the pilot outbox (DEC-030, same edge wiring as `db:tick` and the
 * app actions).
 *
 * **Why a cron at all** (the design call, DEC-033): shift *state* is still derived
 * lazily on read (`resolveShiftStateOnRead`, the board deriver) — this does NOT
 * poll to compute expiry. It exists only for the irreducible outbound
 * side-effect: actually *sending* the asks. "No babysitting" means asks fire
 * whether or not Spink is looking, so an autonomous trigger is required — a
 * lazy-on-read fire would mean the engine only works when someone's watching.
 * The cadence is loose (15 min) against a 7-day staffing horizon; `tick` is
 * idempotent and guard-railed, so a tick with nothing due is a cheap no-op, and
 * its logic is fully unit-tested with injected `now` via the fake adapter.
 *
 * `runtime = "nodejs"` — `pg` opens a TCP connection the Edge runtime can't.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron invocations; a
  // public URL must not be able to trigger ticks. Fail closed if unset.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const repo = getRepo();

  // Operator pause gate (#124, DEC-054): the cron still fires every 15 min, but a
  // paused engine no-ops here — staffing arms/disarms from /admin without a
  // redeploy. Default is running (absent flag ⇒ false); pause is an explicit
  // operator state, never inferred. Enforced here at the edge, not in `tick`,
  // so the engine core stays pure.
  if (await repo.isEnginePaused()) {
    return NextResponse.json({ ok: true, paused: true, at: now.toISOString() });
  }

  const r = await tick(repo, now);
  // Edge channel wiring: every ask this tick fired → crew (DEC-030), and every
  // NEW At-Risk landing → the active admins by SMS (DEC-095). Best-effort at the
  // route level too: `tick` already committed its state, so a delivery OR config
  // hiccup (e.g. the alert's APP_BASE_URL guard) must not 500 the cron's own
  // response/monitoring — and an ask-relay failure must not skip the alert, or
  // vice versa. Independent try/catch each.
  try {
    await forwardToOutbox(r.firedAsks);
  } catch (e) {
    console.error("tick: forwardToOutbox failed — asks may not have relayed", e);
  }
  let alertsSent = 0;
  try {
    alertsSent = await forwardBoardAlerts(r.boardLandings);
  } catch (e) {
    console.error("tick: forwardBoardAlerts failed — admin At-Risk alert not sent", e);
  }

  return NextResponse.json({
    ok: true,
    at: now.toISOString(),
    shiftsAdvanced: r.shiftsAdvanced,
    bornFilling: r.bornFilling,
    toAtRisk: r.toAtRisk,
    asksFired: r.asksFired,
    alertsSent,
    shiftsEscalated: r.shiftsEscalated,
    nudgesFired: r.nudgesFired,
    boardLanded: r.boardLanded,
    relayed: r.firedAsks.length,
  });
}
