import { TwilioChannel } from "@core/adapters/twilio-channel.js";
import { LogChannel } from "@core/adapters/log-channel.js";
import type { Repository } from "@core/ports/repository.js";
import { isProdDeploy } from "./flags";

/**
 * The channel when Twilio is not configured (#934). It logs the message it would have
 * sent, magic link and all, and that is the whole of what replaced the outbox: three
 * queues, three tables and a screen whose only surviving job was letting a human read
 * a message nothing could deliver.
 *
 * Severity is the app's call, not the core's: `console.error` in production so sheepdog
 * ingests it (sheepdog issue 62), a plain log in dev where you are already watching the
 * terminal.
 *
 * **Moved here from `channel.ts` in #955**, and not for tidiness: `makeSmsChannel` below has to
 * construct it, and `channel.ts` already imports this module. Leaving it there made the cycle.
 * It is private now — every caller goes through `makeSmsChannel`, which is the point.
 */
function logChannel(repo: Repository, linkBase: string, now?: () => Date): LogChannel {
  const prod = isProdDeploy();
  return new LogChannel(repo, {
    linkBase,
    ...(now ? { now } : {}),
    sink: prod ? (l) => console.error(l) : (l) => console.log(l),
    // The link is a CREDENTIAL, and for `OPERATOR_CREW_MEMBER_ID` an admin one —
    // `switchToAdmin` upgrades a crew session to admin with no re-auth. Minted in dev,
    // where the log is a terminal you are watching; never in prod, where it is a stream
    // that log-read access alone can reach. Same rule as `auth-delivery.ts:58`.
    mintLink: !prod,
  });
}

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
      "[sms] Twilio half-configured — need TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + (TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM); falling back to logging what would have been sent (#934)",
    );
  }
  return null;
}

/**
 * The configured Twilio channel, or null when SMS is dark. One class serves
 * all three relay ports (ChannelPort / NoticePort / NotificationPort) — the
 * DEC-050 convergence; each wiring site swaps its own constructor.
 *
 * **Deliberately NOT exported (#955).** Nine send sites imported this and each answered its own
 * "what if it is null": three fell back to the console, two did so only when email was also
 * missing, two dropped the message, two returned early. Exporting a nullable constructor is what
 * made those nine answers possible, so the export is the thing that had to go. Call
 * {@link makeSmsChannel} — the compiler now stops a tenth site inventing a tenth answer, which no
 * test could have done.
 */
function makeTwilioChannel(
  repo: Repository,
  linkBase: string,
): TwilioChannel | null {
  const env = readTwilioEnv();
  return env ? new TwilioChannel(repo, { ...env, linkBase }) : null;
}

/**
 * **The one SMS construction (#955).** Every send site calls this and every site gets a channel
 * that writes somewhere. There is no null, so there is no per-site decision about what null means.
 *
 * `live` is not "should I send" — you always send. It is **"may I tell a human this was sent."**
 * DEC-170 states the rule: a log line is not a send, and a caller must never
 * report success off the back of one. Only the two surfaces that report an outcome to a person
 * read this flag; `resendReservationLink` still returns `skipped` rather than `attempted`, so the
 * operator is never shown "Sent" for a message that only reached a terminal.
 *
 * The log channel's production posture comes from {@link logChannel} and is unchanged: the minted
 * link is a credential, so it is minted in dev where the log is a terminal you are watching, and
 * never in prod where the log is a stream that log-read access alone can reach.
 */
export function makeSmsChannel(
  repo: Repository,
  linkBase: string,
  now?: () => Date,
): { channel: TwilioChannel | LogChannel; live: boolean } {
  const twilio = makeTwilioChannel(repo, linkBase);
  if (twilio) return { channel: twilio, live: true };
  return { channel: logChannel(repo, linkBase, now), live: false };
}
