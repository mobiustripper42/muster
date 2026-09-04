import { forwardBoardAlerts as forwardCore, type BoardLanding } from "@core/adapters/forward-board-alerts.js";
import { forwardMoneyAlert } from "@core/adapters/forward-money-alert.js";
import { makeTwilioChannel } from "./sms";
import { getRepo } from "./repo";
import { stripTrailingSlashes } from "@core/config/base-url.js";

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
  const linkBase = stripTrailingSlashes(process.env.APP_BASE_URL ?? "http://localhost:3000");

  const channel = makeTwilioChannel(repo, linkBase);
  if (!channel) return 0; // no live SMS ⇒ no send; the board is the fallback (DEC-095)

  return forwardCore(repo, channel, landings, `${linkBase}/admin/at-risk`);
}

/**
 * Money moved and nobody in Muster decided it should — text the office (issue #723).
 *
 * This is what `alertPaidButUnbooked` should always have been. It was a `console.error` with a
 * TODO, which meant every money alert Muster could raise — paid-but-unbooked, a refund matching
 * no payment, and now a chargeback — reached exactly nobody unless someone happened to be
 * reading Vercel logs. "We recorded it" and "you found out" are not the same thing, and this
 * whole class of work exists for the second one.
 *
 * **The log line is the floor, not the fallback.** It is written FIRST and unconditionally, so a
 * Twilio-dark deploy, a missing `APP_BASE_URL`, or a repo outage still leaves a trace. The text
 * is the addition on top.
 *
 * **Never throws, for the same reason the core sender doesn't:** the only callers are Stripe
 * webhooks, where an exception becomes a 500 and a 500 becomes a redelivery loop. Failing to
 * tell someone must not also fail to record the money.
 *
 * Unlike `forwardBoardAlerts`, a missing `APP_BASE_URL` in production does NOT throw here. That
 * check exists so a crew member is never texted a dead localhost link; here the link is a
 * convenience on a message whose text already carries the ids the operator needs, and taking
 * down the ledger write to protect a hyperlink is the wrong trade.
 */
export async function alertMoneyProblem(message: string): Promise<void> {
  console.error(`[reservations] ${message}`);
  try {
    const repo = getRepo();
    const linkBase = stripTrailingSlashes(process.env.APP_BASE_URL ?? "http://localhost:3000");
    const channel = makeTwilioChannel(repo, linkBase);
    if (!channel) return; // Twilio-dark ⇒ the log line above is the whole alert
    const sent = await forwardMoneyAlert(repo, channel, message, `${linkBase}/admin/purchases`);
    if (sent === 0) console.error("[reservations] money alert reached NO admin (none reachable)");
  } catch (e) {
    console.error("[reservations] money alert failed to send", e);
  }
}
