import { NextResponse } from "next/server";
import { formShifts } from "@core/builder/form-shifts.js";
import { logFormAudit } from "@core/oracle/audit-log.js";
import { tick } from "@core/builder/tick.js";
import { getRepo } from "../../../lib/repo";
import { forwardFormNotices, forwardToOutbox } from "../../../lib/channel";
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
  // **Formation runs BEFORE the pause gate, deliberately (@code-review).** DEC-054 defines pause
  // as gating `tick()` — asks and escalations, the outbound noise the operator wants to stop.
  // Shift FORMATION is structural bookkeeping, not outbound: it is what turns a paid booking into
  // a crewable day. The first cut sat this after the pause return, which meant a paused engine
  // never formed a shift — and since the booking-path form is best-effort, a booking whose inline
  // form failed while paused had NO path to a shift at all until someone unpaused. Pause was
  // never meant to mean "stop recording what was sold".
  //
  // `tick` still never runs while paused; only the derivation does.
  //
  // Best-effort per leg: a formation, relay or audit failure must not cost this tick the asks and
  // escalations it exists for.
  //
  // `notifyTripChanges: true` (#765) — deliberately, and this is the one caller where it is a
  // judgment call rather than an obvious fix. The old reasoning was that notices should only come
  // from a human action, and a scheduled tick is not one. But the tick is the BACKSTOP for two
  // best-effort callers: the booking webhook and the cancel path both form inline and swallow a
  // failure, and this is what forms the shift when they do. Leaving the flag off meant the
  // backstop path formed silently — the crew member's day moved, the inline notice never fired,
  // and the retry that fixed the shift told nobody either.
  //
  // It cannot chatter: the gate in `form-shifts.ts` is diff-gated against the STORED trip set, so
  // once any caller has formed a change this tick sees no diff and sends nothing. It fires only
  // when this tick is genuinely the first to observe the change — which is exactly the case that
  // was silent.
  let shiftsFormed = 0;
  try {
    const form = await formShifts(repo, { now, notifyTripChanges: true });
    shiftsFormed = form.createdShiftIds.length;
    // Relay + audit like every other `formShifts` caller. `cancelledCrew`/`restoredCrew` are NOT
    // gated by `notifyTripChanges`, and after DEC-126 this and the booking webhook are the only
    // triggers left — an unrelayed transition is a crew member who is never told (DEC-084, #244).
    try {
      await forwardFormNotices(form);
    } catch (e) {
      console.error("tick: form-notice relay failed — crew may not have been told", e);
    }
    try {
      await logFormAudit(repo, form, { kind: "engine" }, now);
    } catch (e) {
      console.error("tick: form audit failed — the transition is unrecorded", e);
    }
  } catch (e) {
    console.error("tick: formShifts failed — existing shifts still advance", e);
  }

  if (await repo.isEnginePaused()) {
    return NextResponse.json({ ok: true, paused: true, shiftsFormed, at: now.toISOString() });
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
    shiftsFormed,
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
