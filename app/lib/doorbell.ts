import { doorbellTick } from "@core/builder/doorbell-tick.js";
import { forwardNotifications } from "@core/adapters/forward-notifications.js";
import { FakeNotificationChannel } from "@core/adapters/fake-notification-channel.js";
import { makeDoorbellRules } from "@core/messaging/doorbell-decider.js";
import {
  DOORBELL_BATCH_WINDOW_MS,
  DOORBELL_PRESENCE_WINDOW_MS,
  DOORBELL_SHORT_NOTICE_MAX_CHARS,
} from "@core/config/tenant.js";
import { getPresence, getRepo } from "./repo";

/**
 * Run one doorbell sweep + relay the rings — the edge wiring (DEC-070), the
 * doorbell analog of `forwardToOutbox`. This is the ONE place the app picks the
 * notification adapter.
 *
 * **Pilot delivery is the FAKE/log adapter** (DEC-050): the loop is closed end to
 * end — decider → recorded ring → relay — but the real ring relay is 6.8 (operator
 * outbox, DEC-030) then 6.9 (Twilio, DEC-MSG-1). The fake channel records to a
 * per-request array, so its job here is to prove the loop *fires* and to count
 * rings, not to reach a phone. Swapping it for the real adapter is a one-line
 * change here, zero domain change.
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
  const r = await doorbellTick(repo, getPresence(), now, rules);
  const channel = new FakeNotificationChannel(() => now);
  const relayed = await forwardNotifications(repo, channel, r.rings);
  return { threadsSwept: r.threadsSwept, rings: r.rings.length, relayed };
}
