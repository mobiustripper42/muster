import { EmailChannel } from "@core/adapters/email-channel.js";
import type { Reservation } from "@core/domain/entities.js";
import {
  bookingConfirmationBody,
  sendBookingConfirmation,
} from "@core/reservations/booking-confirmation.js";
import { bookingUrl } from "@core/reservations/booking-code.js";
import { ensureBookingCode } from "@core/reservations/ensure-booking-code.js";
import {
  resendBookingLink,
  resendBookingLinkBody,
  type ResendResult,
} from "@core/reservations/resend-booking-link.js";
import { readEmailEnv } from "./auth-delivery";
import { isProdDeploy } from "./flags";
import { getRepo } from "./repo";
import { makeTwilioChannel } from "./sms";
import { logUnsent } from "./unsent";
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
): Promise<void> {
  // Structural best-effort (DEC-122): the booking is already committed, so NOTHING
  // in here — a channel send, a misconfigured env, a repo/pool hiccup — may throw
  // back to the webhook (a 500 → Stripe retries the whole event). The whole body
  // is wrapped; the core webhook also guards its call, so the promise holds at both
  // layers. Failures are logged here (this layer has the context), never rethrown.
  try {
    // MESSAGING kill-flag — future-proofs #390 (not yet on this branch). A hard
    // "false" silences every send; anything else (incl. unset) leaves sends on.
    if (process.env.MESSAGING === "false") return;

    const linkBase = stripTrailingSlashes(process.env.APP_BASE_URL);
    if (!linkBase) {
      if (isProdDeploy()) {
        console.error("[reservations] confirmation skipped — set APP_BASE_URL");
      }
      return;
    }

    const repo = getRepo();
    const emailEnv = readEmailEnv();
    const email = emailEnv ? new EmailChannel(emailEnv) : undefined;
    const sms = makeTwilioChannel(repo, linkBase) ?? undefined;
    if (!email && !sms) {
      // #933: log the body that would have gone out, rather than the fact that one
      // didn't. This is the outbox's replacement — in dev it is the only way to read
      // (and click) a confirmation, and in prod it is the only record of what the
      // customer never received.
      //
      // The code is minted HERE rather than six lines down because there is no
      // manage URL without one, and the URL is the part worth reading. That is an
      // extra idempotent write on this path — `ensureBookingCode` reuses a live code
      // and its own docstring calls a booking without one exactly the case that
      // should get one.
      const code = await ensureBookingCode(repo, reservation.id, () =>
        new Date().toISOString(),
      );
      logUnsent(
        "reservations:confirm",
        { phone: reservation.phone ?? undefined, email: reservation.email ?? undefined },
        bookingConfirmationBody(reservation, bookingUrl(linkBase, code)),
      );
      return;
    }

    // Mint (or reuse) the code BEFORE composing the message — there is no link to send without
    // one. A failure here is caught by the outer wrapper and logged: the booking is already
    // committed and paid, so it must never reach the webhook as a throw (Stripe would retry the
    // whole event). The operator's resend recovers it.
    const bookingCode = await ensureBookingCode(repo, reservation.id, () => new Date().toISOString());

    await sendBookingConfirmation(
      {
        linkBase,
        ...(email ? { email } : {}),
        ...(sms ? { sms } : {}),
        // Low-severity: the booking succeeded; only the notice failed → resend when
        // convenient. Distinct from the urgent paid-but-unbooked refund alert.
        onFailure: (detail) =>
          console.error(`[reservations] confirmation send failed — ${detail}`),
      },
      reservation,
      bookingCode,
    );
  } catch (e) {
    console.error(
      `[reservations] confirmation errored for ${reservation.id} — ${e instanceof Error ? e.message : e}`,
    );
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
  const sms = makeTwilioChannel(repo, linkBase) ?? undefined;
  if (!email && !sms) {
    // #933, the resend half of "once for send, once for resend". The return value is
    // deliberately UNCHANGED: this still reports `skipped`, never `attempted`, so the
    // operator is never shown "Sent" for a message that was only written to a log.
    // That distinction is the entire reason `ResendOutcome` is a union.
    const code = await ensureBookingCode(repo, reservation.id, () => new Date().toISOString());
    logUnsent(
      "reservations:resend",
      { phone: reservation.phone ?? undefined, email: reservation.email ?? undefined },
      resendBookingLinkBody(reservation, bookingUrl(linkBase, code)),
    );
    return { kind: "skipped", reason: "no_channels" };
  }

  // Reuses the live code; mints only if there is none (an imported booking, or one whose
  // confirmation predates codes). A resend is NOT a reissue — see `resend-booking-link.ts`.
  const bookingCode = await ensureBookingCode(repo, reservation.id, () => new Date().toISOString());

  const result = await resendBookingLink(
    {
      linkBase,
      ...(email ? { email } : {}),
      ...(sms ? { sms } : {}),
      onFailure: (detail) => console.error(`[reservations] link resend failed — ${detail}`),
    },
    reservation,
    bookingCode,
  );
  return { kind: "attempted", result };
}
