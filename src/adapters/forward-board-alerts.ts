/**
 * Operator At-Risk alert — the delivery half of DEC-026 ("landing on the board
 * pings the office"), realized as DEC-095 now that Twilio is live. Core, so it's
 * FakeChannel-testable: takes an INJECTED channel (transport-free, DEC-030/MSG-3)
 * and the newly-recorded landings the tick surfaced, and texts every active
 * admin. The edge (`app/lib/alert.ts`) picks the channel + host-safe board link.
 *
 * NOT a fourth outbound lane (DEC-095): no port/entity/table. The durable record
 * already exists (`board_landed`, deduped in the tick); recipients ARE the
 * operator; payload is a plain body + static board link riding `ChannelPort` as
 * `admin_alert`. Recipients = active admins, NOT the `OPERATOR_CREW_MEMBER_ID`
 * singleton (its retirement is #293 — `listActiveAdminRecipients` is the helper
 * #293 reuses).
 */
import { asId } from "../domain/ids.js";
import type { CrewMemberId } from "../domain/ids.js";
import type { ChannelPort } from "../ports/channel.js";
import type { Repository } from "../ports/repository.js";
import { outbound } from "./message-opener.js";

/** A landing the tick surfaced (DEC-095) — shift + why it boarded. */
export interface BoardLanding {
  shiftId: string;
  reason: string;
}

export interface AdminRecipient {
  crewMemberId: CrewMemberId;
  phone: string;
  name: string;
}

/** The office = every active admin with a reachable phone. The seam #293 reuses
 *  to retire the operator singleton. An admin with no crew record or no phone is
 *  skipped, never thrown on — one bad record can't mute the alert for the rest. */
export async function listActiveAdminRecipients(repo: Repository): Promise<AdminRecipient[]> {
  const admins = (await repo.listAdmins()).filter((a) => a.active);
  const out: AdminRecipient[] = [];
  for (const a of admins) {
    const crew = await repo.getCrewMember(asId<"CrewMemberId">(a.id));
    if (crew?.phone) out.push({ crewMemberId: crew.id, phone: crew.phone, name: crew.name });
  }
  return out;
}

const REASON_LABEL: Record<string, string> = {
  core: "needs crew",
  regression: "someone bailed",
  credential_lapse: "credential lapse",
};

/** "Sat Jul 12" — stored vessel-local calendar date, parsed UTC (DEC-032). */
function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** One SMS body for all admins (the board is shared) — one line per landed shift
 *  (date · vessel — reason[s]). Full detail lives on the linked board. */
export async function composeBoardAlert(repo: Repository, landings: BoardLanding[]): Promise<string> {
  const byShift = new Map<string, Set<string>>();
  for (const l of landings) {
    const set = byShift.get(l.shiftId) ?? new Set<string>();
    set.add(l.reason);
    byShift.set(l.shiftId, set);
  }
  const lines: string[] = [];
  for (const [shiftId, reasons] of byShift) {
    const shift = await repo.getShift(asId<"ShiftId">(shiftId));
    const vessel = shift ? await repo.getVessel(shift.vesselId) : null;
    const when = shift ? fmtDate(shift.date) : shiftId;
    const what = vessel?.name ?? "a shift";
    const why = [...reasons].map((r) => REASON_LABEL[r] ?? r).join(" + ");
    lines.push(`* ${when} - ${what} - ${why}`);
  }
  const n = byShift.size;
  // #599: the audience marker leads. This used to open `⚠ Muster:` against the crew
  // ask's `Muster:` — a one-glyph difference, at the front of a preview that
  // truncates from the RIGHT, for the one person (DEC-092: every admin is also crew)
  // who receives both classes on the same phone from the same sender. On 2026-07-29
  // the operator read this alert as an ask. The distinguishing words ("needs you" vs
  // "In or out?" — the ask's wording that day; #630 has since made it "Yes or no?")
  // were already there — they just sat behind a date and a vessel name, i.e. exactly
  // where truncation eats them.
  //
  // The `⚠` was dropped for legibility only. It saved no SMS segments: the `•`/`·`/`—` this
  // line used to carry were also non-GSM-7, so the body was UCS-2 either way — 70 characters
  // per segment instead of 160, which is what issue #777 measured as 2 segments where 1 would do.
  //
  // **They are now plain `*` and `-` in the template above** (issue #777). The separators were
  // never chosen for a reason; they were prose typography leaking into a transport that bills
  // by the character. Keep SMS copy in plain ASCII.
  return outbound(
    "admin",
    `${n} shift${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you\n${lines.join("\n")}`,
  );
}

/**
 * Text the active admins about shifts that just landed on the At-Risk board.
 * Best-effort per recipient (one failed send can't drop the rest). Returns the
 * number actually sent. `boardLink` is the pre-resolved (host-safe) `/admin/at-
 * risk` URL — core stays host-agnostic. Empty landings / no recipients ⇒ 0.
 */
export async function forwardBoardAlerts(
  repo: Repository,
  channel: ChannelPort,
  landings: readonly BoardLanding[],
  boardLink: string,
): Promise<number> {
  if (landings.length === 0) return 0;
  const recipients = await listActiveAdminRecipients(repo);
  if (recipients.length === 0) return 0;

  const body = await composeBoardAlert(repo, [...landings]);
  let sent = 0;
  for (const r of recipients) {
    try {
      await channel.send({
        to: { crewMemberId: r.crewMemberId, phone: r.phone },
        kind: "admin_alert",
        body,
        link: boardLink,
      });
      sent++;
    } catch {
      // best-effort: keep going so one bad number can't mute the rest
    }
  }
  return sent;
}
