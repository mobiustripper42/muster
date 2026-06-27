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

/**
 * Run one doorbell sweep + relay the rings — the edge wiring (DEC-070), the
 * doorbell analog of `forwardToOutbox`. This is the ONE place the app picks the
 * notification adapter.
 *
 * **Delivery is the operator-outbox relay** (DEC-073, the promotion gate): each ring
 * enqueues a `RingOutboxEntry` (thread deep-link) the operator texts from
 * `/admin/outbox` — the DEC-030 web-link model, mirroring asks. The Twilio swap (6.9,
 * DEC-MSG-1) is a different constructor here, zero domain change. Best-effort
 * (DEC-070): a failed enqueue drops that cycle's ring until read / re-ring.
 */
export async function runDoorbellTick(now: Date): Promise<{
  threadsSwept: number;
  rings: number;
  relayed: number;
}> {
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
  // host-header poisoning); the cron has no trustworthy request Host. Dev falls back.
  const linkBase = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const channel = new OutboxNotificationChannel(repo, { linkBase, now: () => now });
  const relayed = await forwardNotifications(repo, channel, r.rings);
  return { threadsSwept: r.threadsSwept, rings: r.rings.length, relayed };
}
