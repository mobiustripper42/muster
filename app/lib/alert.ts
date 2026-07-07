import { forwardBoardAlerts as forwardCore, type BoardLanding } from "@core/adapters/forward-board-alerts.js";
import { makeTwilioChannel } from "./sms";
import { getRepo } from "./repo";

/**
 * Operator At-Risk alert — the edge wiring (DEC-095), the At-Risk analog of
 * `forwardToOutbox`/`runDoorbellTick`. The ONE place the app picks the channel +
 * the host-safe board link and hands the tick's new landings to the core sender.
 *
 * No relay fallback (DEC-095): with no live SMS the recipient IS the operator and
 * `/admin/at-risk` is the standing surface, so a Twilio-dark tick simply doesn't
 * send. No civil-hours gating (DEC-088 N/A — a Tier-3 "needs a human" signal is
 * urgent). Recipients are the active admins, not the `OPERATOR_CREW_MEMBER_ID`
 * singleton (#293) — the core sender fans out.
 */
export async function forwardBoardAlerts(landings: BoardLanding[] | undefined): Promise<number> {
  if (!landings || landings.length === 0) return 0;
  const repo = getRepo();

  // Delivered links must be host-safe in prod (base-url.ts on host-header
  // poisoning); the cron has no trustworthy Host. Fail loud rather than text a
  // dead localhost link (the doorbell posture).
  if (!process.env.APP_BASE_URL && process.env.NODE_ENV === "production") {
    throw new Error("APP_BASE_URL must be set in production — the At-Risk board link would dead-link to localhost");
  }
  const linkBase = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

  const channel = makeTwilioChannel(repo, linkBase);
  if (!channel) return 0; // no live SMS ⇒ no send; the board is the fallback (DEC-095)

  return forwardCore(repo, channel, landings, `${linkBase}/admin/at-risk`);
}
