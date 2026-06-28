import { NextResponse } from "next/server";
import { runDoorbellTick } from "../../../lib/doorbell";
import { getRepo } from "../../../lib/repo";

/**
 * The Smart Doorbell tick, on a schedule (#167, DEC-070) — a SEPARATE cron from
 * the engine `tick` and the Xola pull (DEC-040 precedent), so a doorbell hiccup
 * can't disrupt staffing and each has its own cadence. Vercel GETs this per
 * `vercel.json` `crons` (every 2 min — the batch window is 90 s, so a posted
 * message rings within ~one cadence; cadence is the latency lever, DEC-040).
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
  // Shares the engine pause gate (#124, DEC-054 / DEC-070): a paused operator means
  // a quiet doorbell too — ringing phones is autonomous activity, armed/disarmed
  // from /admin without a redeploy, enforced at the edge so the core stays pure.
  if (await getRepo().isEnginePaused()) {
    return NextResponse.json({ ok: true, paused: true, at: now.toISOString() });
  }

  const r = await runDoorbellTick(now);
  return NextResponse.json({ ok: true, at: now.toISOString(), ...r });
}
