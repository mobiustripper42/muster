import type { ShiftId } from "../domain/ids.js";
import type { AssignmentAction } from "../domain/entities.js";
import type { Recipient, SendResult } from "./channel.js";

/**
 * Crew assignment-change notice (DEC-084) — the THIRD operator-relay sibling, next
 * to the ask outbox (`ChannelPort`, DEC-030/050) and the doorbell ring
 * (`NotificationPort`, DEC-073). A no-claim, no-thread "you're on / you're off a
 * shift" message: SMS in production, an operator-relayed entry in the pilot.
 *
 * Kept off the other two lanes on purpose (DEC-084): overloading the ask channel
 * breaks its NOT-NULL `askId`/`seatId` correlation; riding the ring's
 * `NotificationPort` forces a nullable `threadId` and breaks its drop-on-read rule.
 * A release has neither an ask nor a thread. One future Twilio class implements all
 * three interfaces (DEC-050 convergence, DEC-MSG-1 swap).
 */

/** One "you're on / you're off a shift" notice to deliver. `body` is composed at
 * the edge (`forwardNotices`) and frozen; `shiftId` keys the deterministic entry id
 * (one slot per shift + member + action). No `askId`/`seatId`/`threadId` — a release
 * is not an ask and not a thread. */
export interface AssignmentNotice {
  to: Recipient;
  action: AssignmentAction;
  shiftId: ShiftId;
  body: string;
}

export interface NoticePort {
  /** Hand one assignment-change notice to the delivery medium. Throws if rejected. */
  send(notice: AssignmentNotice): Promise<SendResult>;
}
