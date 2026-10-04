/**
 * Waiver reminders (Phase 18.7, issue #1121) — the booker is texted, and emailed when the booking has
 * an address, on each of the admin's reminder days until the party has signed. Spec:
 * `docs/design/check-in-and-waivers.md` §5; the page the message opens is `check-in-surfaces.md` §B.
 *
 * Run from the cron tick (`app/api/cron/tick/route.ts`), so the rules are about one tick at a time:
 *
 * - **A reminder day is the boat's calendar day that is N days before the trip**, for each N in
 *   `CheckInConfig.reminderDaysBefore`. A day the tick never reached is not made up later — the
 *   next reminder day is the next chance.
 * - **Only inside the civil send window** (DEC-088's `withinCivilWindow`, the hours the staffing
 *   engine already keeps): the first tick after it opens sends, and a retry never lands at night.
 * - **Never twice for one window.** The window is claimed in `waiver_reminders` before the send and
 *   given back when nobody was told, so a later tick that day tries again.
 * - **Stops once the party has signed**, counted exactly as the party page counts it
 *   (`groupCoverage` over `peopleSigned`): a guarded minor is covered, someone who signed twice
 *   counts once, and no number passes the party size or the boat's limit.
 * - **Nothing while no waiver is in effect** — nobody could sign. Posting the first waiver is what
 *   turns reminders on; an empty reminder-days list turns them off.
 *
 * Text every time there is a phone, email when there is an address. A message only written to the
 * log (a deploy with no Twilio keys) told nobody, and is treated so (DEC-170).
 */
import { addDays, TENANT_TIMEZONE, vesselDateOf, withinCivilWindow } from "../config/tenant.js";
import { isBooked, type Event, type Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { ChannelPort } from "../ports/channel.js";
import type { Repository } from "../ports/repository.js";
import { formatClock, formatShortDay } from "../reservations/availability-screen.js";
import { bookingUrl } from "../reservations/booking-code.js";
import { ensureBookingCode } from "../reservations/ensure-booking-code.js";
import { tryChannel, type ChannelOutcome } from "../reservations/resend-booking-link.js";
import { recordTrail } from "../reservations/trail.js";
import { peopleSigned } from "./duplicates.js";
import { groupCoverage } from "./signing.js";

export interface WaiverReminderDeps {
  repo: Repository;
  /** Absent ⇒ no email side. */
  email?: ChannelPort;
  /** Absent ⇒ no text side. */
  sms?: ChannelPort;
  /** Trusted public origin for the link (`APP_BASE_URL` at the edge), never a Host header. */
  linkBase: string;
  now: () => string;
  /** The send hours, for tests; absent reads the tenant's `CIVIL_SEND_START`/`_END`. */
  civilWindow?: { start: string; end: string };
  /** Observer for a failed send or a booking that errored — the console at the edge. It gets the
   *  provider's own message, which can name the recipient; the trail never does. */
  onFailure?: (detail: string) => void;
}

/** What one tick did. `failed` counts reminders due that reached nobody, including a booking that
 *  errored; a booking already reminded or fully signed is in neither. */
export interface WaiverReminderRun {
  sent: number;
  failed: number;
}

export async function sendWaiverReminders(deps: WaiverReminderDeps): Promise<WaiverReminderRun> {
  const run: WaiverReminderRun = { sent: 0, failed: 0 };
  const nowIso = deps.now();
  const now = new Date(nowIso);
  const reminderDays = await openReminderDays(deps, now);

  const today = vesselDateOf(now);
  const vessels = reminderDays.length > 0 ? await deps.repo.listVessels() : [];
  const coiOf = new Map(vessels.map((v) => [String(v.id), v.coiMaxPax]));

  for (const daysBefore of reminderDays) {
    const tripDate = addDays(today, daysBefore);
    const events = await deps.repo.listEventsForVesselDays(vessels.map((v) => ({ vesselId: v.id, date: tripDate })));
    for (const event of events) {
      if (event.status !== "scheduled") continue;
      const coiMaxPax = coiOf.get(String(event.vesselId)) ?? event.capacity;
      for (const reservation of await deps.repo.listReservationsForEvent(event.id)) {
        if (!isBooked(reservation)) continue;
        // One booking's failure must not cost the rest of the fleet its reminders.
        try {
          const outcome = await remindOne(deps, { reservation, event, coiMaxPax, daysBefore, nowIso });
          if (outcome === "sent") run.sent++;
          if (outcome === "failed") run.failed++;
        } catch (e) {
          run.failed++;
          deps.onFailure?.(
            `waiver reminder for reservation ${String(reservation.id)} errored: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
  }
  return run;
}

/** The admin's reminder days, or none: outside the send hours, with reminders switched off, or with
 *  no waiver in effect for anyone to sign. */
async function openReminderDays(deps: WaiverReminderDeps, now: Date): Promise<readonly number[]> {
  if (!withinCivilWindow(now, TENANT_TIMEZONE, deps.civilWindow)) return [];
  const { reminderDaysBefore } = await deps.repo.getCheckInConfig();
  if (reminderDaysBefore.length === 0) return [];
  return (await deps.repo.getCurrentWaiverTemplate(now.toISOString())) ? reminderDaysBefore : [];
}

async function remindOne(
  deps: WaiverReminderDeps,
  job: { reservation: Reservation; event: Event; coiMaxPax: number; daysBefore: number; nowIso: string },
): Promise<"sent" | "failed" | "not_due"> {
  const { reservation: r, event, coiMaxPax, daysBefore, nowIso } = job;
  const { repo } = deps;

  const guests = await repo.listGuestsForReservation(r.id);
  const coverage = groupCoverage(r.partySize, peopleSigned(guests), coiMaxPax);
  if (coverage.remaining === 0) return "not_due";

  const window = { reservationId: r.id, tripDate: event.date, daysBefore };
  const noteFailed = (reason: string) =>
    recordTrail(
      { repo, now: deps.now },
      {
        // One row per window, however many ticks retry it: the id collides on purpose.
        id: asId<"TrailEventId">(`waiver_reminder_failed:${String(r.id)}:${event.date}:${daysBefore}`),
        reservationId: r.id,
        actorKind: "engine",
        type: "waiver_reminder_failed",
        metadata: { reason },
      },
    );

  // Nobody to reach: nothing is claimed, so the window stays open if a phone is added later today.
  if (!(r.email && deps.email) && !(r.phone && deps.sms)) {
    await noteFailed(outcomes("absent", "absent"));
    return "failed";
  }

  if (!(await repo.claimWaiverReminder({ ...window, sentAt: nowIso }))) return "not_due";

  let email: ChannelOutcome;
  let sms: ChannelOutcome;
  try {
    const code = await ensureBookingCode(repo, r.id, deps.now);
    const body = waiverReminderBody({
      customerName: r.customerName,
      covered: coverage.covered,
      of: coverage.of,
      date: event.date,
      time: event.time,
      partyUrl: `${bookingUrl(deps.linkBase, code)}/party`,
    });
    const ctx = { body, what: "waiver reminder", onFailure: deps.onFailure, reservation: r };
    email = await tryChannel(deps.email, r.email, "email", ctx);
    sms = await tryChannel(deps.sms, r.phone, "SMS", ctx);
  } catch (e) {
    // Nothing was sent: the claim goes back before the error does.
    await repo.releaseWaiverReminder(r.id, event.date, daysBefore);
    throw e;
  }

  const reason = outcomes(email, sms);
  if (email !== "sent" && sms !== "sent") {
    await repo.releaseWaiverReminder(r.id, event.date, daysBefore);
    await noteFailed(reason);
    return "failed";
  }
  // Reminded — but a channel that was tried and missed is still worth a line on the trail.
  if (email === "failed" || email === "logged" || sms === "failed" || sms === "logged") await noteFailed(reason);
  return "sent";
}

/** The per-channel outcome, in the shape `link_resent` already writes. Never the provider's
 *  message: a Twilio or Resend error can echo the recipient, and this lands in a durable row. */
function outcomes(email: ChannelOutcome, sms: ChannelOutcome): string {
  return `email=${email} sms=${sms}`;
}

/**
 * The reminder, for text and email alike.
 *
 * **It asks the booker to look, not to forward.** The link is the booking's own (`/b/<code>/party`),
 * which opens the manage page one tap away; the link to send the group is on that page, behind
 * **Share the link**. A message saying "send this to your group" would hand everyone the booking.
 *
 * **Every character stays inside GSM-7** (`sms-alphabet.ts`): one outside it re-encodes the whole
 * text as UCS-2 at twice the segments. The boat is never named to a customer.
 */
export function waiverReminderBody(input: {
  customerName: string;
  covered: number;
  of: number;
  /** Vessel-local `YYYY-MM-DD`. */
  date: string;
  /** Vessel-local `HH:mm`. */
  time: string;
  partyUrl: string;
}): string {
  const who = input.customerName?.trim().split(/\s+/)[0] || "there";
  return (
    `Hi ${who}, waivers for your trip on ${formatShortDay(input.date)} at ${formatClock(input.time)}: ` +
    `${input.covered} of ${input.of} signed.\n\n` +
    `See who still needs to sign and get the link to send them: ${input.partyUrl}\n\n` +
    `- Muster`
  );
}
