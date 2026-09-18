/**
 * A vessel-day that failed to form texts the office (#1001).
 *
 * **What it is for.** Formation failing means a boat was sold and has no crew shift — nobody was
 * asked to work it and it is on no board. Since #957 that no longer aborts the run; it lands in
 * `FormResult.failures`, and the tick writes a `console.error`. A log line is not somebody finding
 * out. Nobody reads a log that prints the same thing every fifteen minutes; you read it *after*
 * someone has told you a trip had no crew, by which point the trip has sailed.
 *
 * **No dedup, and that is a decision.** The At-Risk alert (DEC-095) rides the tick's
 * per-(shift, reason) dedup so a steady board fires nothing. This one deliberately does not. The
 * operator's ruling, 2026-09-13: one text about an unformed shift is a drop-everything, so the
 * repeats are self-limiting — and *"if this is sending me too many messages, then THAT is a bug."*
 * Volume is the report, not noise. A stateful alert is also one that can go quiet at the wrong
 * moment, which is exactly the failure #1001's title names.
 *
 * **Not a fourth outbound lane**, same as DEC-095: no port, no entity, no table. A plain body and
 * a static board link riding `ChannelPort` as `admin_alert`, through the adapter's existing
 * generic branch. Core, so it takes an INJECTED channel and stays transport-free (DEC-030/MSG-3);
 * the edge picks the channel and the host-safe link.
 *
 * **Never throws.** It runs inside the cron route beside the engine's own work, and an alert that
 * throws turns "one vessel-day did not form" into "the tick failed" — strictly worse, on the one
 * path whose job is to keep going.
 */
import type { VesselId } from "../domain/ids.js";
import { logSwallowed } from "../log.js";
import type { ChannelPort } from "../ports/channel.js";
import type { Repository } from "../ports/repository.js";
import { listActiveAdminRecipients } from "./forward-board-alerts.js";
import { outbound } from "./message-opener.js";

/** One entry from `FormResult.failures` — structurally, so core need not import the builder. */
export interface FormationFailure {
  vesselId: VesselId;
  date: string;
  error: unknown;
}

/** "Sat Sep 13" — a stored vessel-local calendar date, parsed UTC (DEC-032). */
function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Text every active admin, once per failed vessel-day. Returns how many messages landed.
 *
 * One message per DAY rather than one summary: a count tells the operator a number, and the boat
 * and the date are the only actionable part.
 */
export async function forwardFormationAlert(
  repo: Repository,
  channel: ChannelPort,
  failures: readonly FormationFailure[],
  link: string,
): Promise<number> {
  if (failures.length === 0) return 0;

  let recipients;
  try {
    recipients = await listActiveAdminRecipients(repo);
  } catch (e) {
    // A repo outage must not take the tick's own response down. But returning 0 is
    // indistinguishable from "no admins are configured", and the difference is whether
    // a boat with no crew went unreported or whether nobody was ever going to be told.
    logSwallowed(
      "alerts:formation",
      e,
      `${failures.length} vessel-day(s) failed to form and no admin could be looked up to tell`,
    );
    return 0;
  }
  if (recipients.length === 0) return 0;

  /**
   * **Group by cause first — many vessel-days sharing one error is ONE outage (#1001).**
   *
   * `FormResult.failures`' own docstring sets this obligation: *"Many entries carrying the SAME
   * error is one outage, not N data problems, and #1001 should say so rather than fan out that
   * many leads."* Per-group isolation (#957) is what turns a dead connection into one entry per
   * vessel-day in the fleet rather than one abort, so without this a pool outage texts every admin
   * once per boat — burying the single fact that matters under its own symptoms.
   *
   * This is NOT the no-dedup case DEC-172 settled. That one is the same vessel-day repeating
   * across ticks, where the repeats are self-limiting because you go and fix it. This is many
   * different days inside ONE tick, all saying the same thing.
   *
   * Distinct causes still fan out. Two boats broken two ways are two leads, and collapsing them
   * would hide one.
   */
  const byCause = new Map<string, FormationFailure[]>();
  for (const f of failures) {
    const key = String(f.error);
    const group = byCause.get(key);
    if (group) group.push(f);
    else byCause.set(key, [f]);
  }

  let sent = 0;
  for (const [cause, group] of byCause) {
    let body: string;
    if (group.length > 1) {
      // One message naming the scale and the shared cause. No vessel is named because no vessel is
      // the problem — naming the first of forty would point at the wrong thing.
      body = outbound(
        "admin",
        `${group.length} vessel-days failed to form with the same error - likely one outage, not ${group.length} problems: ${cause}`,
      );
    } else {
      const f = group[0]!;
      // Degrade to the id rather than to silence: an unreadable vessel row is not a reason to stop
      // telling somebody a boat has no crew, and the id is still enough to find it.
      let name = String(f.vesselId);
      try {
        const vessel = await repo.getVessel(f.vesselId);
        if (vessel?.name) name = vessel.name;
      } catch (e) {
        // Keep the id — an unreadable vessel row is not a reason to stop telling somebody
        // a boat has no crew. The alert still goes out; this says why it names an id.
        logSwallowed("alerts:formation", e, `vessel ${f.vesselId} unreadable — alerting by id`);
      }
      body = outbound(
        "admin",
        `${name} on ${fmtDate(f.date)} has NO crew shift - formation failed. Nobody has been asked to work it.`,
      );
    }
    for (const r of recipients) {
      try {
        await channel.send({
          to: { crewMemberId: r.crewMemberId, phone: r.phone },
          kind: "admin_alert",
          body,
          link,
        });
        sent++;
      } catch (e) {
        // Best-effort per recipient — one dead number cannot mute the rest, on the one message
        // that means a boat is uncrewed. The `sent` count already tells you how many landed;
        // this tells you WHICH admin did not get it, which is the half that finds a dead number.
        logSwallowed(
          "alerts:formation",
          e,
          `admin ${r.crewMemberId} was not told that a boat has no crew shift`,
        );
      }
    }
  }
  return sent;
}
