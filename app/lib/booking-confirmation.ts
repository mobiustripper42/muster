import { EmailChannel } from "@core/adapters/email-channel.js";
import type { Reservation } from "@core/domain/entities.js";
import { sendBookingConfirmation } from "@core/reservations/booking-confirmation.js";
import { readEmailEnv } from "./auth-delivery";
import { isProdDeploy } from "./flags";
import { getRepo } from "./repo";
import { makeTwilioChannel } from "./sms";

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

    const linkBase = process.env.APP_BASE_URL?.replace(/\/+$/, "");
    const linkSecret = process.env.RESERVATION_LINK_SECRET;
    if (!linkBase || !linkSecret) {
      if (isProdDeploy()) {
        console.error(
          "[reservations] confirmation skipped — set APP_BASE_URL and RESERVATION_LINK_SECRET",
        );
      }
      return;
    }

    const repo = getRepo();
    const emailEnv = readEmailEnv();
    const email = emailEnv ? new EmailChannel(emailEnv) : undefined;
    const sms = makeTwilioChannel(repo, linkBase) ?? undefined;
    if (!email && !sms) {
      if (isProdDeploy()) {
        console.error(
          "[reservations] confirmation skipped — no email or SMS channel configured",
        );
      }
      return;
    }

    await sendBookingConfirmation(
      {
        linkBase,
        linkSecret,
        ...(email ? { email } : {}),
        ...(sms ? { sms } : {}),
        // Low-severity: the booking succeeded; only the notice failed → resend when
        // convenient. Distinct from the urgent paid-but-unbooked refund alert.
        onFailure: (detail) =>
          console.error(`[reservations] confirmation send failed — ${detail}`),
      },
      reservation,
    );
  } catch (e) {
    console.error(
      `[reservations] confirmation errored for ${reservation.id} — ${e instanceof Error ? e.message : e}`,
    );
  }
}
