import { EmailChannel } from "@core/adapters/email-channel.js";
import { deliverCancelNotice, recordCancelNotice, type TellCustomer } from "@core/reservations/cancel-notice.js";
import { readEmailEnv } from "./auth-delivery";
import { appBaseUrl } from "./base-url";
import { getRepo } from "./repo";
import { makeSmsChannel } from "./sms";
import { logSwallowed } from "./swallowed";
import { TENANT_NAME } from "./tenant";

/**
 * The cancel notice's edge (issue #1212): builds this deployment's channels and hands them to
 * `deliverCancelNotice`, which owns the send, the trail row and the code the pane reads. Passed to
 * the two cancel paths as `tellCustomer`; `getRepo()` is Postgres only, so what is tested is the
 * core function this calls.
 *
 * Never throws: the cancel and the refund have committed. A throw while building the channels
 * (`appBaseUrl` on a deploy with no trusted origin) is `error`, written as a `cancel_notice_failed`
 * row where the repository still answers.
 */
export const tellCustomerOfCancel: TellCustomer = async (reservationId, by, refund, actor) => {
  const now = () => new Date().toISOString();
  try {
    const linkBase = appBaseUrl();
    const emailEnv = readEmailEnv();
    const email = emailEnv ? new EmailChannel(emailEnv) : undefined;
    const { channel: sms, live } = makeSmsChannel(linkBase);
    return await deliverCancelNotice(
      {
        repo: getRepo(),
        now,
        tenantName: TENANT_NAME,
        linkBase,
        ...(email ? { email } : {}),
        sms,
        live,
        onFailure: (detail) => console.error(`[reservations] ${detail}`),
      },
      reservationId,
      by,
      refund,
      actor,
    );
  } catch (e) {
    logSwallowed("reservations:tellCustomerOfCancel", e, `${reservationId} is cancelled but the customer was not told`);
    try {
      await recordCancelNotice({ repo: getRepo(), now }, reservationId, "error", actor);
    } catch (recordErr) {
      logSwallowed("reservations:tellCustomerOfCancel", recordErr, `no cancel_notice_failed row for ${reservationId}`);
    }
    return "error";
  }
};
