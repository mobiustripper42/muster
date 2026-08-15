"use server";

/**
 * The recovery request (12.7, issue #460) — the edge for `recoverBookingLink`.
 *
 * **Always redirects to the same place.** No error param, no "not found", no branch on the
 * result — `recoverBookingLink` returns `void` precisely so this cannot vary. The only thing a
 * submitter learns is that the form was submitted.
 *
 * Reads the whole reservation+event set and joins it here, the way the manage loader does. That
 * is a full-table read on an unauthenticated route, which is affordable at this operator's scale
 * (hundreds of bookings) and is bounded ahead of it by the throttle claimed inside
 * `recoverBookingLink` — one request per contact per 15 minutes. If the table ever grows past
 * that being sensible, the fix is an indexed lookup by contact, not a lighter guard.
 */

import { redirect } from "next/navigation";
import { EmailChannel } from "@core/adapters/email-channel.js";
import { vesselDateOf } from "@core/config/tenant.js";
import { recoverBookingLink } from "@core/reservations/recover-booking-link.js";
import type { RecoveryRow } from "@core/reservations/find-booking.js";
import { readEmailEnv } from "../../lib/auth-delivery";
import { getRepo } from "../../lib/repo";
import { makeTwilioChannel } from "../../lib/sms";

export async function requestBookingLink(formData: FormData): Promise<void> {
  const contact = String(formData.get("contact") ?? "").slice(0, 200);
  const lastName = String(formData.get("lastName") ?? "").slice(0, 100);

  try {
    // MESSAGING kill-flag, same as every other send path.
    if (process.env.MESSAGING !== "false") {
      const linkBase = process.env.APP_BASE_URL?.replace(/\/+$/, "");
      // The link rides the trusted origin or nothing at all — never a Host header, which is how
      // a recovery link would get minted against an attacker-supplied domain (base-url.ts).
      if (linkBase) {
        const repo = getRepo();
        const [reservations, events] = await Promise.all([
          repo.listAllReservations(),
          repo.listEvents(),
        ]);
        const eventById = new Map(events.map((e) => [String(e.id), e]));
        const rows: RecoveryRow[] = reservations
          .map((reservation) => ({ reservation, event: eventById.get(String(reservation.eventId)) }))
          .filter((r): r is RecoveryRow => r.event !== undefined);

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
          rows,
          { contact, lastName },
        );
      }
    }
  } catch (e) {
    // Swallowed on purpose: an error page is a different answer from the confirmation, and the
    // difference is the oracle. Logged for the operator instead.
    console.error(
      `[reservations] recovery request errored — ${e instanceof Error ? e.message : e}`,
    );
  }

  // Outside the try — `redirect` throws by design and a catch would swallow it.
  redirect("/b/find?sent=1");
}
