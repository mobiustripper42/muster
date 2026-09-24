/**
 * Doorbell ring → notification channel forwarding glue (#167, DEC-050 / DEC-030).
 * The doorbell analog of `forward-asks.ts`.
 *
 * The pure decider decides WHICH rings fire; the doorbell tick records them; this
 * edge module turns each `ring:true` `NotificationDecision` into a
 * `NotificationMessage` (recipient + body) and pushes it through the injected
 * `NotificationPort` — the operator relay, then Twilio, this glue reused verbatim.
 *
 * **Body is a bare notification (#387):** every ring reads exactly
 * `RING_NOTIFICATION_BODY` + the deep link the channel appends — NEVER the
 * note's text inline. Relaying a message's content out-of-context (no sender, no
 * thread) as an SMS read as confusing (the §7.5 content-inlining, retired here); a
 * pointer-to-the-app is the clear signal, and it also keeps message text out of the
 * SMS transport entirely. The decider's `mode` still flows through — it just no
 * longer shapes the SMS text.
 *
 * BEST-EFFORT by design (like the ask relay): a channel hiccup must not undo a
 * ring the tick already recorded — delivery is the swappable part. Failures are
 * swallowed per ring; the return value says how many actually forwarded.
 */

import { asId } from "../domain/ids.js";
import { logSwallowed } from "../log.js";
import { describeSendFailure } from "../ports/channel.js";
import type { NotificationDecision } from "../messaging/doorbell-decider.js";
import type { NotificationPort } from "../ports/notification.js";
import type { Repository } from "../ports/repository.js";
import { outbound } from "./message-opener.js";

/** The one line every ring carries — a pointer to the app, never the note itself. */
export const RING_NOTIFICATION_BODY = outbound("crew", "you have a new message");

export async function forwardNotifications(
  repo: Repository,
  channel: NotificationPort,
  decisions: readonly NotificationDecision[],
): Promise<number> {
  let forwarded = 0;
  for (const d of decisions) {
    if (!d.ring || d.mode === null) continue; // only outgoing rings carry a mode
    try {
      // v1 thread members are crew (DEC-058); the subject id IS the crew id.
      const crew = await repo.getCrewMember(asId<"CrewMemberId">(d.subject.id));
      if (!crew) continue; // dangling member — nothing to relay
      await channel.send({
        to: { crewMemberId: crew.id, phone: crew.phone },
        threadId: d.threadId,
        mode: d.mode,
        body: RING_NOTIFICATION_BODY,
        messageIds: d.messageIds,
      });
      forwarded++;
    } catch (e) {
      // Best-effort (see header): the ring is already recorded, so the decider's own
      // history stays honest. The delivery is what failed, and a recorded ring nobody
      // received is indistinguishable from one they ignored.
              // **Never the error itself.** A `ChannelSendError`'s message carries the provider's
        // raw response body, and what we sent it was a crew member's 6-digit sign-in code
        // or — until issue #1030 retires ask links — a live magic link. Credentials do not
        // go in logs. That is the rule, not a judgement about whether Resend or Twilio
        // happen to echo request content back.
        //
        // `describeSendFailure` keeps the status, which is the useful half and carries
        // none of it: 422 is a misconfigured sender, 429 is rate limiting, 503 is wait.
logSwallowed(
        "doorbell:relay",
        describeSendFailure(e),
        `the doorbell ring for thread ${d.threadId} was recorded but not delivered`,
      );
    }
  }
  return forwarded;
}
