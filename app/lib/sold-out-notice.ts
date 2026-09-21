import { EmailChannel } from "@core/adapters/email-channel.js";
import { asId } from "@core/domain/ids.js";
import { recordTrail } from "@core/reservations/trail.js";
import type { SoldOutCharge } from "@core/reservations/booking-webhook.js";
import { sendSoldOutNotice } from "@core/reservations/sold-out-notice.js";
import { readEmailEnv } from "./auth-delivery";
import { getRepo } from "./repo";
import { makeSmsChannel } from "./sms";
import { appBaseUrl } from "./base-url";

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
  const repo = getRepo();
  const trail = { repo, now: () => new Date().toISOString(), key: charge.chargeRef };
  try {
    // **The same defect this commit closed in `booking-confirmation.ts`, in its sibling.**
    // The kill-flag skipped the whole notice and recorded nothing — a customer charged,
    // auto-refunded, and never told, silent by construction. `@code-review` caught that the
    // fix went into one file and not the other. Derived id, because this path is re-entered
    // on Stripe redelivery.
    if (process.env.MESSAGING === "false") {
      await recordTrail(trail, {
        id: asId<"TrailEventId">(`sold_out_notice_failed:${charge.chargeRef}:flag`),
        actorKind: "engine",
        type: "sold_out_notice_failed",
        metadata: { reason: "MESSAGING=false — not attempted on any channel" },
      });
      return;
    }

    const linkBase = appBaseUrl();
    const emailEnv = readEmailEnv();
    const email = emailEnv ? new EmailChannel(emailEnv) : undefined;
    // #1007, the issue the old comment here deferred to. The guard it describes is gone: an unset
    // base no longer silently disables SMS on this path, which mattered most on a preview, where
    // unset is the designed state (DEC-057) and a customer whose payment lost the race would have
    // got email only — while the whole point of §2.8.7 is that this notice accompanies a refund
    // and must reach the person.
    //
    // #955: Twilio-dark used to mean no SMS and, when email was also unconfigured, a prod-only
    // console line. §2.8.7 is why that was the wrong shape — this notice accompanies an automatic
    // refund, and "a refund nobody was told about reads as a silent failed payment." It now always
    // has somewhere to write.
    // #1007: `linkBase` is a `string` now, never `undefined`, so the conditional that produced a
    // channel-less notice is gone. With #955 already guaranteeing `makeSmsChannel` never returns
    // null, `sms` is always present — so the `!email && !sms` early return below could never fire
    // and has been deleted rather than left as reassuring dead code.
    const sms = makeSmsChannel(repo, linkBase).channel;

    // The contact is already resolved off the reservation row by the webhook (15.5) — this edge
    // does not reach for it, and there is no longer any metadata here to reach into.
    await sendSoldOutNotice(
      {
        ...(email ? { email } : {}),
        ...(sms ? { sms } : {}),
        onFailure: (detail) =>
          console.error(`[reservations] sold-out notice send failed — ${detail}`),
        // The durable half of the same fact (issue #1052). `onFailure` reaches a console; this
        // reaches the trail, and answers "how often is a refunded customer never told" months
        // later, which no console line can.
        trail,
      },
      charge.contact,
    );
  } catch (e) {
    console.error(
      `[reservations] sold-out notice errored for charge ${charge.chargeRef} — ${e instanceof Error ? e.message : e}`,
    );
  }
}
