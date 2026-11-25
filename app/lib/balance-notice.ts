import { EmailChannel } from "@core/adapters/email-channel.js";
import { deliverBalanceNotice, recordBalanceFailed, type TellBalanceFailed } from "@core/reservations/balance-notice.js";
import { readEmailEnv } from "./auth-delivery";
import { appBaseUrl } from "./base-url";
import { getRepo } from "./repo";
import { makeSmsChannel } from "./sms";
import { logSwallowed } from "./swallowed";
import { TENANT_NAME } from "./tenant";

/**
 * The failed balance charge's customer notice at the edge (issue #1273): builds this deployment's
 * channels and hands them to `deliverBalanceNotice`, which owns the send and the trail row. Passed to
 * the scheduled job as `tellBalanceFailed`; `getRepo()` is Postgres only, so what is tested is the
 * core function this calls.
 *
 * Never throws: the attempt is recorded and must stand. A throw while building the channels
 * (`appBaseUrl` on a deploy with no trusted origin) is `error`, written as a `balance_charge_failed`
 * row where the repository still answers.
 */
export const tellCustomerOfBalanceFailure: TellBalanceFailed = async (reservation, failure) => {
  const now = () => new Date().toISOString();
  try {
    const linkBase = appBaseUrl();
    const emailEnv = readEmailEnv();
    const email = emailEnv ? new EmailChannel(emailEnv) : undefined;
    const { channel: sms, live } = makeSmsChannel(linkBase);
    await deliverBalanceNotice(
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
      reservation,
      failure,
    );
  } catch (e) {
    logSwallowed(
      "reservations:tellCustomerOfBalanceFailure",
      e,
      `the balance charge for ${reservation.id} failed and the customer was not told`,
    );
    try {
      await recordBalanceFailed({ repo: getRepo(), now }, reservation.id, failure, "error");
    } catch (recordErr) {
      logSwallowed(
        "reservations:tellCustomerOfBalanceFailure",
        recordErr,
        `no balance_charge_failed row for ${reservation.id}`,
      );
    }
  }
};
