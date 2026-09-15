import { forwardBoardAlerts as forwardCore, type BoardLanding } from "@core/adapters/forward-board-alerts.js";
import { forwardMoneyAlert } from "@core/adapters/forward-money-alert.js";
import {
  forwardFormationAlert,
  type FormationFailure,
} from "@core/adapters/forward-formation-alert.js";
import { makeSmsChannel } from "./sms";
import { getRepo } from "./repo";
import { appBaseUrl } from "./base-url";

/**
 * Operator At-Risk alert — the edge wiring (DEC-095), the At-Risk analog of
 * `relayAsks`/`runDoorbellTick`. The ONE place the app picks the channel +
 * the host-safe board link and hands the tick's new landings to the core sender.
 *
 * **A Twilio-dark tick writes the alert to the console (DEC-170, superseding DEC-095's
 * no-relay-fallback clause).** It used to send nothing, on the reasoning that the recipient is the
 * operator and `/admin/at-risk` is the standing surface — but a board is a fallback for somebody
 * looking at it, and the reason this alert exists is that nobody is.
 *
 * **The count it returns therefore includes logged alerts**, because `LogChannel` accepts every
 * message. Read it as "reached a recipient's record", not "reached a phone". No civil-hours gating
 * (DEC-088 N/A — a Tier-3 "needs a human" signal is urgent). Recipients are the active admins, not
 * the `OPERATOR_CREW_MEMBER_ID` singleton (#293) — the core sender fans out.
 */
export async function forwardBoardAlerts(landings: BoardLanding[] | undefined): Promise<number> {
  if (!landings || landings.length === 0) return 0;
  const repo = getRepo();

  // #1007: one resolver, four branches, three environments. This site used to hand-spell the
  // check as `NODE_ENV === "production"` — the exact wrong predicate `src/config/deploy.ts:22-26`
  // was written to name, because Vercel sets `NODE_ENV=production` on PREVIEWS too. So the
  // At-Risk alert threw on every preview deploy, in the one environment where DEC-057 says the
  // variable is supposed to be missing. `appBaseUrl` keys on `isProdDeploy()` and hands previews
  // their own origin.
  const linkBase = appBaseUrl();

  // #955 (DEC-170 supersedes DEC-095's no-relay-fallback clause): this used to `return 0` when
  // Twilio was dark, on the reasoning that the At-Risk board is the standing fallback. A board is
  // a fallback for a person who is looking at it, and the whole reason this alert exists is that
  // nobody is. Twilio-dark now writes the alert to the console like every other send site.
  const { channel } = makeSmsChannel(repo, linkBase);
  return forwardCore(repo, channel, landings, `${linkBase}/admin/at-risk`);
}

/**
 * A vessel-day that failed to form texts the office (#1001) — the second alert class on this lane.
 *
 * **Why it exists.** Formation failing means a boat was sold and has no crew shift. Since #957 that
 * no longer aborts the run; it lands in `FormResult.failures` and the tick logs it. Nobody reads a
 * log that prints the same line every fifteen minutes — you read it after somebody has already told
 * you a trip had no crew, which is too late.
 *
 * **No dedup, unlike the board alert above.** That one rides the tick's per-(shift, reason) dedup
 * so a steady board is silent. This one repeats every tick on purpose: one text about an unformed
 * shift is a drop-everything, so the repeats are self-limiting — and a stateful alert is one that
 * can go quiet at the wrong moment, which is the failure #1001 is named for.
 *
 * **The `APP_BASE_URL` posture changed at #1007, and the old reasoning is worth recording.** This
 * used to fall back to localhost rather than throw, arguing that the link is a convenience on a
 * message whose text already names the boat and the day, so taking the alert down to protect a
 * hyperlink is the wrong trade. That was right about the case it faced: before `appBaseUrl` gave
 * previews their own origin, an unset variable was reachable in ordinary use, and degrading beat
 * going silent. It no longer is — the only unset-in-prod case left is a broken deploy that is also
 * dropping customer confirmations. The floor still holds either way: the route writes its
 * `console.error` naming the failed vessel-days BEFORE calling this, so a throw here costs the
 * text and not the record.
 */
export async function forwardFormationFailures(
  failures: readonly FormationFailure[],
): Promise<number> {
  if (failures.length === 0) return 0;
  try {
    const repo = getRepo();
    const linkBase = appBaseUrl();
    const { channel } = makeSmsChannel(repo, linkBase);
    return await forwardFormationAlert(repo, channel, failures, `${linkBase}/admin/shifts`);
  } catch (e) {
    // The tick's own response must survive this. The core sender already swallows per-recipient
    // failures; this covers the wiring around it — a bad env, a dead pool, a channel that will not
    // construct. The `console.error` in the route stands either way.
    console.error("[tick] formation-failure alert could not be sent", e);
    return 0;
  }
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
 * **#1007 unified the `APP_BASE_URL` answer and this site keeps its guarantee** — not because it
 * is exempt, but because of the line above the `try`. `appBaseUrl()` throws on a prod deploy with
 * the variable unset; that lands in the `catch` below, so the SMS is lost and the ledger write is
 * not. The log line is written first and unconditionally for exactly this reason, and it was
 * already the floor for a Twilio-dark deploy and a repo outage.
 */
export async function alertMoneyProblem(message: string): Promise<void> {
  console.error(`[reservations] ${message}`);
  try {
    const repo = getRepo();
    const linkBase = appBaseUrl();
    // #955: Twilio-dark used to make the `console.error` above the whole alert. It still is the
    // floor, written first and unconditionally — but the message itself now also reaches the
    // console with its recipients and body, rather than only the summary line.
    const { channel } = makeSmsChannel(repo, linkBase);
    const sent = await forwardMoneyAlert(repo, channel, message, `${linkBase}/admin/purchases`);
    if (sent === 0) console.error("[reservations] money alert reached NO admin (none reachable)");
  } catch (e) {
    console.error("[reservations] money alert failed to send", e);
  }
}
