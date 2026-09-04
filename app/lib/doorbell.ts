import { doorbellTick } from "@core/builder/doorbell-tick.js";
import { forwardNotifications } from "@core/adapters/forward-notifications.js";
import { OutboxNotificationChannel } from "@core/adapters/outbox-notification-channel.js";
import { makeDoorbellRules } from "@core/messaging/doorbell-decider.js";
import {
  DOORBELL_BATCH_WINDOW_MS,
  DOORBELL_PRESENCE_WINDOW_MS,
  DOORBELL_SHORT_NOTICE_MAX_CHARS,
} from "@core/config/tenant.js";
import { getPresence, getRepo } from "./repo";
import { OPERATOR_CREW_MEMBER_ID } from "./operator";
import { makeTwilioChannel } from "./sms";
import { messagingEnabled } from "./flags";
import { stripTrailingSlashes } from "@core/config/base-url.js";

/**
 * Run one doorbell sweep + relay the rings — the edge wiring (DEC-070), the
 * doorbell analog of `forwardToOutbox`. This is the ONE place the app picks the
 * notification adapter.
 *
 * **Delivery**: with Twilio configured (9.4, DEC-MSG-1) each ring goes out as a
 * real SMS; unset, the operator-outbox relay stays (DEC-073, the promotion gate):
 * each ring enqueues a `RingOutboxEntry` (thread deep-link) the operator texts
 * from `/admin/outbox` — the DEC-030 web-link model, mirroring asks. Best-effort
 * (DEC-070): a failed enqueue/send drops that cycle's ring until read / re-ring.
 */
export async function runDoorbellTick(now: Date): Promise<{
  threadsSwept: number;
  rings: number;
  relayed: number;
}> {
  // Messaging disabled (#389) → the doorbell is inert: no sweep, so the cron can't
  // ring crew about pre-existing unread threads once the entry points are gone.
  if (!messagingEnabled()) return { threadsSwept: 0, rings: 0, relayed: 0 };

  const repo = getRepo();
  const rules = makeDoorbellRules({
    batchWindowMs: DOORBELL_BATCH_WINDOW_MS,
    presenceWindowMs: DOORBELL_PRESENCE_WINDOW_MS,
    shortNoticeMaxChars: DOORBELL_SHORT_NOTICE_MAX_CHARS,
  });
  // Exclude the operator from ring-membership (DEC-072): they hold seats as crew
  // (DEC-030) so they'd otherwise be a member of all-staff + their shifts, and
  // every broadcast they send would ring them. They monitor via /admin/messages.
  const r = await doorbellTick(repo, getPresence(), now, rules, OPERATOR_CREW_MEMBER_ID);
  // Delivered links MUST be host-safe — APP_BASE_URL in prod (base-url.ts on
  // host-header poisoning); the cron has no trustworthy request Host. Fail LOUD in
  // prod when unset: otherwise every relayed ring is a dead localhost link the
  // operator texts to crew with no error signal. Dev falls back to localhost.
  if (!process.env.APP_BASE_URL && process.env.NODE_ENV === "production") {
    throw new Error("APP_BASE_URL must be set in production — ring links would dead-link to localhost");
  }
  const linkBase = stripTrailingSlashes(process.env.APP_BASE_URL ?? "http://localhost:3000");
  // Twilio configured (9.4, DEC-MSG-1) ⇒ rings go out as real SMS; unset ⇒ the
  // operator-relay ring outbox stays (DEC-073). Same constructor-swap as channel.ts.
  const channel =
    makeTwilioChannel(repo, linkBase) ??
    new OutboxNotificationChannel(repo, { linkBase, now: () => now });
  const relayed = await forwardNotifications(repo, channel, r.rings);
  return { threadsSwept: r.threadsSwept, rings: r.rings.length, relayed };
}
