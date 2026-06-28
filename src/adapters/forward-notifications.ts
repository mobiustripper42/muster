/**
 * Doorbell ring → notification channel forwarding glue (#167, DEC-050 / DEC-030).
 * The doorbell analog of `forward-asks.ts`.
 *
 * The pure decider decides WHICH rings fire; the doorbell tick records them; this
 * edge module turns each `ring:true` `NotificationDecision` into a
 * `NotificationMessage` (recipient + composed body) and pushes it through the
 * injected `NotificationPort` — today the fake/log adapter (the pilot), later the
 * operator relay (6.8) then Twilio (6.9), this glue reused verbatim.
 *
 * **Body composition lives HERE, not in the decider** (DEC-048): `content` mode
 * inlines the single short message's text (§7.5); `summary` is an "N new" ping.
 * The decider hands a `mode` + `messageIds`, never a string.
 *
 * BEST-EFFORT by design (like the ask relay): a channel hiccup must not undo a
 * ring the tick already recorded — delivery is the swappable part. Failures are
 * swallowed per ring; the return value says how many actually forwarded.
 */

import { asId } from "../domain/ids.js";
import type { Message } from "../messaging/entities.js";
import type { NotificationDecision } from "../messaging/doorbell-decider.js";
import type { ThreadId } from "../domain/ids.js";
import type { NotificationPort } from "../ports/notification.js";
import type { Repository } from "../ports/repository.js";

export async function forwardNotifications(
  repo: Repository,
  channel: NotificationPort,
  decisions: readonly NotificationDecision[],
): Promise<number> {
  // Cache a thread's messages within this relay so N rings on one thread don't
  // re-query (content mode needs the message body the decision doesn't carry).
  const byThread = new Map<string, Map<string, Message>>();
  const messagesFor = async (threadId: ThreadId): Promise<Map<string, Message>> => {
    const key = String(threadId);
    let m = byThread.get(key);
    if (!m) {
      const list = await repo.listMessagesForThread(threadId);
      m = new Map(list.map((x) => [String(x.id), x]));
      byThread.set(key, m);
    }
    return m;
  };

  let forwarded = 0;
  for (const d of decisions) {
    if (!d.ring || d.mode === null) continue; // only outgoing rings carry a mode
    try {
      // v1 thread members are crew (DEC-058); the subject id IS the crew id.
      const crew = await repo.getCrewMember(asId<"CrewMemberId">(d.subject.id));
      if (!crew) continue; // dangling member — nothing to relay
      const body =
        d.mode === "content"
          ? (await messagesFor(d.threadId)).get(String(d.messageIds[0]))?.body ??
            "New message"
          : `${d.messageCount} new message${d.messageCount === 1 ? "" : "s"}`;
      await channel.send({
        to: { crewMemberId: crew.id, phone: crew.phone },
        threadId: d.threadId,
        mode: d.mode,
        body,
        messageIds: d.messageIds,
      });
      forwarded++;
    } catch {
      // Best-effort (see header): the ring is already recorded.
    }
  }
  return forwarded;
}
