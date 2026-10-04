import { EmailChannel } from "@core/adapters/email-channel.js";
import { sendWaiverReminders, type WaiverReminderRun } from "@core/checkin/reminders.js";
import { readEmailEnv } from "./auth-delivery";
import { appBaseUrl } from "./base-url";
import { getRepo } from "./repo";
import { makeSmsChannel } from "./sms";

/**
 * Waiver reminders from the cron tick (Phase 18.7, issue #1121) — the edge that builds the email and
 * SMS channels, the same wiring as the booking confirmation (`booking-confirmation.ts`), and hands
 * them to `sendWaiverReminders`, which holds every rule.
 *
 * The link rides the trusted `APP_BASE_URL` (`appBaseUrl`), never a Host header; a production
 * deploy without it throws here, and the tick's own catch keeps that from costing its asks.
 *
 * A deploy with no Twilio keys gets the log channel, whose sends count as nobody told (DEC-170):
 * the window is given back and the next tick inside the send hours writes the message to the log
 * again. That is the dev and preview case; production has Twilio.
 */
export async function runWaiverReminders(): Promise<WaiverReminderRun> {
  const linkBase = appBaseUrl();
  const emailEnv = readEmailEnv();
  const { channel: sms } = makeSmsChannel(linkBase);
  return sendWaiverReminders({
    repo: getRepo(),
    ...(emailEnv ? { email: new EmailChannel(emailEnv) } : {}),
    sms,
    linkBase,
    now: () => new Date().toISOString(),
    onFailure: (detail) => console.error(`[waiver-reminders] ${detail}`),
  });
}
