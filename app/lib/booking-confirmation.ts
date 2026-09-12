import { EmailChannel } from "@core/adapters/email-channel.js";
import type { Reservation } from "@core/domain/entities.js";
import { sendBookingConfirmation } from "@core/reservations/booking-confirmation.js";
import { ensureBookingCode } from "@core/reservations/ensure-booking-code.js";
import {
  resendBookingLink,
  type ResendResult,
} from "@core/reservations/resend-booking-link.js";
import { readEmailEnv } from "./auth-delivery";
import { isProdDeploy } from "./flags";
import { getRepo } from "./repo";
import { makeSmsChannel } from "./sms";
import { stripTrailingSlashes } from "@core/config/base-url.js";

/**
 * Booking-confirmation wiring (11.4, DEC-122) — the edge that builds the email +
 * SMS channels and hands `processBookingWebhook` a best-effort `sendConfirmation`.
 * Mirrors `auth-delivery.ts`: dark until configured (a missing channel/secret is a
 * loud no-op in prod, never a throw — the booking already succeeded).
 *
 * The delivered link MUST ride the trusted `APP_BASE_URL` (host-header poisoning —
 * see base-url.ts); an unset base is a no-op, never a Host-header fallback here.
 */
export async function sendReservationConfirmation(
  reservation: Reservation,
): Promise<boolean> {
  // Structural best-effort: the booking is already committed, so NOTHING in here — a channel
  // send, a misconfigured env, a repo/pool hiccup — may throw back to the webhook (a 500 → the
  // provider retries the whole event). The whole body is wrapped; failures are logged here, where
  // the context is, and never rethrown.
  //
  // **It returns whether the customer was actually told (15.3, issue #971), and that is load
  // bearing rather than informational.** The caller claims the right to send before calling and
  // records the claim on the reservation; if this never reported failure, a carrier outage would
  // leave every booking marked as told with nobody having been told — the defect 15.3 fixes,
  // re-entered through a different door. `/security-review` caught exactly that: the release path
  // was dead code because this function swallowed everything and returned `void`, so the recovery
  // the port documented could not happen.
  //
  // `false` covers "deliberately not sent" as well as "tried and failed" — MESSAGING off, an
  // unset `APP_BASE_URL`, no channel configured. That is the right answer for all of them: none
  // of those customers has been told, and a deployment where confirmations silently are not
  // going out is exactly what §2.8.9's reconciler should be reporting.
  //
  // The old text credited DEC-122, retired 2026-08-26. The live authority is §2.8.6.
  try {
    // MESSAGING kill-flag — future-proofs #390 (not yet on this branch). A hard
    // "false" silences every send; anything else (incl. unset) leaves sends on.
    if (process.env.MESSAGING === "false") return false;

    const linkBase = stripTrailingSlashes(process.env.APP_BASE_URL);
    if (!linkBase) {
      if (isProdDeploy()) {
        console.error("[reservations] confirmation skipped — set APP_BASE_URL");
      }
      return false;
    }

    const repo = getRepo();
    const emailEnv = readEmailEnv();
    const email = emailEnv ? new EmailChannel(emailEnv) : undefined;
    // #955, defect 1 — the bug this refactor was named for. This read
    // `makeTwilioChannel(...) ?? undefined` and then gated the fallback on `!email && !sms`. With
    // email configured and Twilio dark, `email` was defined, so the fallback was skipped — and
    // `sendBookingConfirmation` then skipped the SMS leg too, because it guards on `deps.sms`.
    // No send, no log, no `onFailure`. The customer's text evaporated with no record anywhere.
    //
    // Worse in production than in dev: email is optional at `/book` because phone is the identity
    // (DEC-132), so a customer who gave only a phone number got nothing at all, and the one place
    // that would have recorded it required BOTH channels to be missing.
    //
    // A configured email can never suppress the SMS leg now. They are separate legs to separate
    // addresses, and `sms` is always present.
    //
    // The `logUnsent` block that stood here went with the same change: it minted the code early,
    // composed the body by hand and wrote it to the console, which is exactly what the log channel
    // below now does for every audience in one place.
    const { channel: sms, live } = makeSmsChannel(repo, linkBase);

    // Mint (or reuse) the code BEFORE composing the message — there is no link to send without
    // one. A failure here is caught by the outer wrapper and logged: the booking is already
    // committed and paid, so it must never reach the webhook as a throw (Stripe would retry the
    // whole event). The operator's resend recovers it.
    const bookingCode = await ensureBookingCode(repo, reservation.id, () => new Date().toISOString());

    await sendBookingConfirmation(
      {
        linkBase,
        ...(email ? { email } : {}),
        sms,
        // Low-severity: the booking succeeded; only the notice failed → resend when
        // convenient. Distinct from the urgent paid-but-unbooked refund alert.
        onFailure: (detail) =>
          console.error(`[reservations] confirmation send failed — ${detail}`),
      },
      reservation,
      bookingCode,
    );
    // **The #955/#971 seam, and the one place this merge was not mechanical.** 15.3 made this
    // return whether the customer was actually TOLD, and the caller records that on the
    // reservation — so `true` here with nobody told is the precise defect 15.3 exists to prevent.
    //
    // #955 made `sms` always present, which would have turned this into an unconditional `true`:
    // a Twilio-dark deploy with no email would mark every booking as confirmed-sent on the
    // strength of a console line. The channel reports whether it can actually transmit, so ask it.
    //
    // An email SEND failure still reads as told, exactly as it did before this branch —
    // `sendBookingConfirmation` returns void and reports failures through `onFailure`. Narrowing
    // that is 15.3's ground, not this issue's.
    return Boolean(email) || live;
  } catch (e) {
    console.error(
      `[reservations] confirmation errored for ${reservation.id} — ${e instanceof Error ? e.message : e}`,
    );
    return false;
  }
}

/**
 * What a resend did, for a caller who is going to render it (#686).
 *
 * `skipped` is not a failure of a send — it means no send was ever attempted, because this
 * deployment cannot make one. Rendering that as "sent" is the defect this type exists to make
 * impossible: the operator would tell a customer their link is on the way when nothing left the
 * building. It stays distinct from `attempted`, whose per-channel outcomes may themselves be
 * `failed`.
 */
export type ResendOutcome =
  | { kind: "attempted"; result: ResendResult }
  | { kind: "skipped"; reason: "messaging_off" | "not_configured" | "no_channels" };

/**
 * Resend the manage link from an operator press (#686) — the same channel wiring as the
 * confirmation above, with the result handed back instead of swallowed.
 *
 * The confirmation path returns `void` on purpose: it runs inside the Stripe webhook, where
 * there is nobody to report to and a throw would make Stripe retry the whole event. Behind a
 * button, that same silence renders every outcome as a flat green "Sent" — including an
 * email-only booking, a Twilio outage, and a deployment with no channels configured at all.
 */
export async function resendReservationLink(reservation: Reservation): Promise<ResendOutcome> {
  if (process.env.MESSAGING === "false") return { kind: "skipped", reason: "messaging_off" };

  const linkBase = stripTrailingSlashes(process.env.APP_BASE_URL);
  // Same rule as the confirmation: the link rides the trusted APP_BASE_URL, never a Host header.
  if (!linkBase) return { kind: "skipped", reason: "not_configured" };

  const repo = getRepo();
  const emailEnv = readEmailEnv();
  const email = emailEnv ? new EmailChannel(emailEnv) : undefined;
  // #955: this is the ONE site where `live` earns its existence. The send is unconditional now —
  // the body reaches the console whatever the config — but an operator is reading the result, and
  // DEC-170 states the rule: a log line is not a send. So the outcome still reports
  // `skipped`, never `attempted`, when nothing live was behind it. That distinction is the entire
  // reason `ResendOutcome` is a union, and it survives the refactor unchanged.
  const { channel: sms, live } = makeSmsChannel(repo, linkBase);

  // Reuses the live code; mints only if there is none (an imported booking, or one whose
  // confirmation predates codes). A resend is NOT a reissue — see `resend-booking-link.ts`.
  const bookingCode = await ensureBookingCode(repo, reservation.id, () => new Date().toISOString());

  const result = await resendBookingLink(
    {
      linkBase,
      ...(email ? { email } : {}),
      sms,
      onFailure: (detail) => console.error(`[reservations] link resend failed — ${detail}`),
    },
    reservation,
    bookingCode,
  );
  if (!email && !live) return { kind: "skipped", reason: "no_channels" };
  return { kind: "attempted", result };
}
