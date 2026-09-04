import { EmailChannel } from "@core/adapters/email-channel.js";
import type { SoldOutCharge } from "@core/reservations/booking-webhook.js";
import { sendSoldOutNotice } from "@core/reservations/sold-out-notice.js";
import { readEmailEnv } from "./auth-delivery";
import { isProdDeploy } from "./flags";
import { getRepo } from "./repo";
import { makeTwilioChannel } from "./sms";
import { stripTrailingSlashes } from "@core/config/base-url.js";

/**
 * Sold-out-notice wiring (12.1b, DEC-109 residual race) — the edge that builds the email +
 * SMS channels and hands `processBookingWebhook` a best-effort `notifyCustomerSoldOut`.
 * Mirrors `booking-confirmation.ts`: dark until configured, and STRUCTURALLY best-effort —
 * the auto-refund already succeeded, so nothing here may throw back to the webhook (a 500 →
 * Stripe retries the whole event). No link/secret: there's no reservation to manage.
 */
export async function sendReservationSoldOutNotice(
  charge: SoldOutCharge,
): Promise<void> {
  try {
    if (process.env.MESSAGING === "false") return;

    const linkBase = stripTrailingSlashes(process.env.APP_BASE_URL);
    const repo = getRepo();
    const emailEnv = readEmailEnv();
    const email = emailEnv ? new EmailChannel(emailEnv) : undefined;
    // makeTwilioChannel needs a base for its deep links; the sold-out notice has none, but
    // the SMS body carries no link, so an unset base only disables SMS (email still fires).
    const sms = linkBase ? (makeTwilioChannel(repo, linkBase) ?? undefined) : undefined;
    if (!email && !sms) {
      if (isProdDeploy()) {
        console.error("[reservations] sold-out notice skipped — no email or SMS channel configured");
      }
      return;
    }

    const m = charge.metadata;
    await sendSoldOutNotice(
      {
        ...(email ? { email } : {}),
        ...(sms ? { sms } : {}),
        onFailure: (detail) =>
          console.error(`[reservations] sold-out notice send failed — ${detail}`),
      },
      {
        customerName: m.customerName ?? "",
        ...(m.email ? { email: m.email } : {}),
        ...(m.phone ? { phone: m.phone } : {}),
      },
    );
  } catch (e) {
    console.error(
      `[reservations] sold-out notice errored for charge ${charge.chargeRef} — ${e instanceof Error ? e.message : e}`,
    );
  }
}
