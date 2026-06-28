/**
 * The notification (RING) delivery port — DEC-050's `sendNotification` sibling to
 * the ask `ChannelPort`, realized (6.6a) as its **own** interface rather than a
 * second method bolted onto `ChannelPort`.
 *
 * Why a separate port (DEC-050): the ask is a structured yes/no with atomic-claim
 * semantics (REQ-CLAIM-1) and an inbound reply; a doorbell ring is a different
 * payload — "new message(s), tap to open" or a content-carrying short note — with
 * no claim logic and no inbound reply. DEC-050 forbids overloading the ask path;
 * a separate interface also keeps the just-hardened ask `ChannelPort` /
 * `WebLinkChannel` / outbox (#158/#160) literally untouched. Convergence isn't
 * lost: one future Twilio class implements BOTH `ChannelPort` and `NotificationPort`
 * (the "many adapters, one transport" end-state — DEC-MSG-1).
 *
 * **Ring-only seam (DEC-068).** This carries only a decision the doorbell decided
 * to RING (`ring:true`, always `sms` in v1). A toast (`channel:"in_app_toast"`) is
 * NOT a port send — it surfaces as in-app unread state in the crew app (6.7), never
 * pushed through a delivery adapter. So there is no `channel` discriminator and no
 * `mode:null` here: both would mean "not a ring," which never reaches the port.
 *
 * Build order (DEC-MSG-3 spirit, doorbell sibling): fake/log recorder
 * (`FakeNotificationChannel`, 6.6a) → operator relay-of-rings (6.8, DEC-030
 * machinery) → Twilio SMS (the final swap, DEC-MSG-1).
 */

import type { MessageId, ThreadId } from "../domain/ids.js";
import type { Recipient, SendResult } from "./channel.js";

/** One doorbell ring to deliver. Composed by the tick (6.6b) from a `ring:true`
 *  `NotificationDecision` — the decider decides, the edge composes the body. */
export interface NotificationMessage {
  to: Recipient;
  threadId: ThreadId;
  /** §7.5 — `content` carries the lone short note inline; `summary` is an "N new" ping. */
  mode: "summary" | "content";
  body: string;
  /** The unread messages this ring covers (one, for `content`). */
  messageIds: MessageId[];
}

export interface NotificationPort {
  /** Hand one doorbell ring to the delivery medium. Throws if the medium rejects it. */
  send(message: NotificationMessage): Promise<SendResult>;
}
