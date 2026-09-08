import { NextResponse } from "next/server";
import { runDoorbellTick } from "../../../lib/doorbell";
import { messagingEnabled } from "../../../lib/flags";
import { getRepo } from "../../../lib/repo";

/**
 * The Smart Doorbell tick — **no longer on a schedule** (DEC-167, #949). It was a
 * SEPARATE cron from the engine `tick` and the Xola pull (DEC-040 precedent, DEC-070)
 * every 2 minutes, so a doorbell hiccup couldn't disrupt staffing and each had its own cadence.
 *
 * **That cadence was withdrawn because it kept the production database permanently awake.**
 * Neon's scale-to-zero is 5 minutes; a 2-minute cron resets the idle timer before it can
 * expire. Measured 93% awake, roughly $76/month, for sweeps that did nothing because
 * `MESSAGING` is off. `vercel.json` now schedules `/api/cron/tick` only; this route stays
 * and is hand-triggerable. Re-scheduling it means re-reading DEC-167 first — a cadence is
 * chosen against the host's idle window now, not for latency alone.
 *
 * Why a cron: presence + the batch/cancel window are time-driven, and a ring is
 * an irreducible outbound side-effect (DEC-049) — "no babysitting" means it fires
 * whether or not anyone's looking, so an autonomous trigger is required. The sweep
 * is idempotent (first-only-until-read on recorded notify-state), so a tick with
 * nothing due is a cheap no-op.
 *
 * Crons run only on the production deploy (never preview), and Phase 6 isn't
 * promoted until 6.8's real relay lands — so the pilot's fake delivery never runs
 * against live traffic (DEC-070).
 *
 * `runtime = "nodejs"` — `pg` opens a TCP connection the Edge runtime can't.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Vercel sends `Authorization: Bearer <CRON_SECRET>`; fail closed if unset so a
  // public URL can't trigger rings.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = new Date();

  // FLAG FIRST, and the order is the whole point (#949). `MESSAGING` is off by default
  // (operator's call 2026-07-12) and the doorbell sweep no-ops when it is — but the pause
  // check below is a DATABASE QUERY, and it used to run first. So a dormant feature woke
  // the database every two minutes to ask a question and then do nothing.
  //
  // Neon scale-to-zero is 5 minutes; this cron ran every 2. The idle timer never got there,
  // the compute never slept, and it billed ~24 CU-hours a day — about $76/month, for months,
  // on a feature nobody could reach. Returning before `getRepo()` is what makes an off
  // feature actually cost nothing.
  if (!messagingEnabled()) {
    return NextResponse.json({ ok: true, messaging: false, at: now.toISOString() });
  }

  // Shares the engine pause gate (#124, DEC-054 / DEC-070): a paused operator means
  // a quiet doorbell too — ringing phones is autonomous activity, armed/disarmed
  // from /admin without a redeploy, enforced at the edge so the core stays pure.
  if (await getRepo().isEnginePaused()) {
    return NextResponse.json({ ok: true, paused: true, at: now.toISOString() });
  }

  const r = await runDoorbellTick(now);
  return NextResponse.json({ ok: true, at: now.toISOString(), ...r });
}
