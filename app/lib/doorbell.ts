import { doorbellTick } from "@core/builder/doorbell-tick.js";
import { forwardNotifications } from "@core/adapters/forward-notifications.js";
import { makeDoorbellRules } from "@core/messaging/doorbell-decider.js";
import {
  DOORBELL_BATCH_WINDOW_MS,
  DOORBELL_PRESENCE_WINDOW_MS,
  DOORBELL_SHORT_NOTICE_MAX_CHARS,
} from "@core/config/tenant.js";
import { getPresence, getRepo } from "./repo";
import { makeSmsChannel } from "./sms";
import { messagingEnabled } from "./flags";
import { appBaseUrl } from "./base-url";

/**
 * Run one doorbell sweep + relay the rings — the edge wiring (DEC-070), the
 * doorbell analog of `relayAsks`. This is the ONE place the app picks the
 * notification adapter.
 *
 * **Delivery**: with Twilio configured (9.4, DEC-MSG-1) each ring goes out as a
 * real SMS; unset, the ring is LOGGED with its thread deep-link (#934) — the
 * operator-outbox relay it used to enqueue into is gone. Best-effort (DEC-070):
 * a failed send drops that cycle's ring until read / re-ring.
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
  // Active admins are excluded from ring-membership inside the tick (DEC-072, issue #293).
  const r = await doorbellTick(repo, getPresence(), now, rules);
  // Delivered links MUST be host-safe — the cron has no trustworthy request Host, so the link
  // rides the configured origin (base-url.ts on host-header poisoning). Fail loud in prod when
  // unset: otherwise every relayed ring is a dead localhost link the operator texts to crew with
  // no error signal.
  //
  // #1007: that reasoning is intact; the predicate was not. This hand-spelled
  // `NODE_ENV === "production"`, which Vercel also sets on PREVIEWS, so a preview's doorbell
  // threw rather than ringing — and `alert.ts` and `channel.ts` carried the same line, each
  // citing the others as precedent. `appBaseUrl` keys on `isProdDeploy()` and gives a preview
  // its own origin, which is what DEC-057 wanted all along.
  const linkBase = appBaseUrl();
  // Twilio configured (9.4, DEC-MSG-1) ⇒ rings go out as real SMS; unset ⇒ the console
  // (#934/#955). The clock is passed through so a logged ring carries the tick's `now`.
  const { channel } = makeSmsChannel(linkBase, () => now);
  const relayed = await forwardNotifications(repo, channel, r.rings);
  return { threadsSwept: r.threadsSwept, rings: r.rings.length, relayed };
}
