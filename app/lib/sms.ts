import { TwilioChannel } from "@core/adapters/twilio-channel.js";
import type { Repository } from "@core/ports/repository.js";
import { isProdDeploy } from "./flags";

/**
 * Twilio config seam (9.4/#225, DEC-MSG-1) — server-only.
 *
 * **Dark until set** (#70 — never silently go prod): all three vars or nothing.
 * Unset ⇒ callers keep the operator-relay outbox; set ⇒ crew relays go out as
 * real SMS. A HALF-set config is treated as unset but shouted about in prod —
 * the operator would otherwise believe SMS is live while every relay quietly
 * lands back on the outbox they've stopped watching.
 *
 * The from-number is Drew's TEST number for now — the production campaign
 * number waits on A2P 10DLC brand+campaign registration (#225 notes, #119).
 */
interface TwilioEnv {
  accountSid: string;
  authToken: string;
  messagingServiceSid?: string;
  from?: string;
}

export function readTwilioEnv(): TwilioEnv | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  // Sender: the A2P campaign's Messaging Service SID (MG…) is PREFERRED — it
  // routes through the campaign's sender pool and clears error 30034; a bare
  // TWILIO_FROM number is the fallback (toll-free / campaign-attached code).
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM;
  if (accountSid && authToken && (messagingServiceSid || from)) {
    return {
      accountSid,
      authToken,
      ...(messagingServiceSid ? { messagingServiceSid } : {}),
      ...(from ? { from } : {}),
    };
  }
  if ((accountSid || authToken || messagingServiceSid || from) && isProdDeploy()) {
    console.error(
      "[sms] Twilio half-configured — need TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + (TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM); falling back to the operator outbox",
    );
  }
  return null;
}

/**
 * The configured Twilio channel, or null when SMS is dark. One class serves
 * all three relay ports (ChannelPort / NoticePort / NotificationPort) — the
 * DEC-050 convergence; each wiring site swaps its own constructor.
 */
export function makeTwilioChannel(
  repo: Repository,
  linkBase: string,
): TwilioChannel | null {
  const env = readTwilioEnv();
  return env ? new TwilioChannel(repo, { ...env, linkBase }) : null;
}
