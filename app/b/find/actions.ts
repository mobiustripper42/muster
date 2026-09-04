"use server";

/**
 * The recovery request (12.7, issue #460) — the edge for `recoverBookingLink`.
 *
 * **Always redirects to the same place.** No error param, no "not found", no branch on the
 * result — `recoverBookingLink` returns `void` precisely so this cannot vary. The only thing a
 * submitter learns is that the form was submitted.
 *
 * **And it redirects at the same SPEED.** The whole of the work runs in `after()`, post-response,
 * so a match and a miss return at the identical moment. Awaiting it here would have made a match
 * slower than a miss by the cost of a database write and one or two network sends — the same
 * oracle, measured with a stopwatch. `app/(crew)/crew/actions.ts:124` does exactly this for the
 * login code, for exactly this reason (DEC-081); the first cut of this file didn't, and review
 * caught it.
 *
 * The reservation+event scan lives INSIDE that callback and behind the throttle claim (the thunk
 * `recoverBookingLink` takes), so an attacker cycling fresh contacts can't force a full-table
 * read per request. At this operator's scale a scan is affordable; unbounded, it wouldn't be.
 */

import { redirect } from "next/navigation";
import { after } from "next/server";
import { EmailChannel } from "@core/adapters/email-channel.js";
import { vesselDateOf } from "@core/config/tenant.js";
import { recoverBookingLink } from "@core/reservations/recover-booking-link.js";
import type { RecoveryRow } from "@core/reservations/find-booking.js";
import { readEmailEnv } from "../../lib/auth-delivery";
import { getRepo } from "../../lib/repo";
import { makeTwilioChannel } from "../../lib/sms";
import { stripTrailingSlashes } from "@core/config/base-url.js";

export async function requestBookingLink(formData: FormData): Promise<void> {
  const contact = String(formData.get("contact") ?? "").slice(0, 200);
  const lastName = String(formData.get("lastName") ?? "").slice(0, 100);

  // MESSAGING kill-flag, same as every other send path. The link rides the trusted origin or
  // nothing at all — never a Host header, which is how a recovery link would get minted against
  // an attacker-supplied domain (base-url.ts).
  const linkBase = stripTrailingSlashes(process.env.APP_BASE_URL);
  if (process.env.MESSAGING !== "false" && linkBase) {
    after(async () => {
      try {
        const repo = getRepo();
        const emailEnv = readEmailEnv();
        const email = emailEnv ? new EmailChannel(emailEnv) : undefined;
        const sms = makeTwilioChannel(repo, linkBase) ?? undefined;

        await recoverBookingLink(
          {
            repo,
            linkBase,
            ...(email ? { email } : {}),
            ...(sms ? { sms } : {}),
            now: () => new Date().toISOString(),
            today: vesselDateOf(new Date()),
            onFailure: (detail) => console.error(`[reservations] ${detail}`),
          },
          // The scan, deferred until the throttle has been claimed inside.
          async () => {
            const [reservations, events] = await Promise.all([
              repo.listAllReservations(),
              repo.listEvents(),
            ]);
            const eventById = new Map(events.map((e) => [String(e.id), e]));
            return reservations
              .map((reservation) => ({
                reservation,
                event: eventById.get(String(reservation.eventId)),
              }))
              .filter((r): r is RecoveryRow => r.event !== undefined);
          },
          { contact, lastName },
        );
      } catch (e) {
        // Inside the callback, so it can never reach the response — which is the point. An error
        // page is a different answer from the confirmation, and that difference is the oracle.
        console.error(
          `[reservations] recovery request errored — ${e instanceof Error ? e.message : e}`,
        );
      }
    });
  }

  // Fires immediately, identically, for every submission.
  redirect("/b/find?sent=1");
}
