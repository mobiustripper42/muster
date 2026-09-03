/**
 * The record of an error the app caught and *did not* rethrow (#854).
 *
 * A page, action or route that hits a broken repository is right to degrade —
 * a calm notice or an `act_error=` banner beats a stack trace at the operator
 * or a boat captain. The defect this fixes is that the catch block was the
 * only place that knew WHY, and it discarded it. `/crew` once rendered
 * "Can't reach the schedule right now" with an empty server log; the real cause
 * was an unapplied migration (`relation "shift_changes" does not exist`), and
 * recovering it took a throwaway script that called the view builder directly.
 *
 * `eslint.config.mjs` bans a bare `catch {}` across `app/**` and `components/**`
 * so the next one fails CI rather than being written. That rule is the durable
 * half; this function only makes obeying it a one-liner.
 *
 * **It does not reach the core.** 23 bare catches remain in `src/` and `db/`,
 * three on the money path (`src/reservations/booking-webhook.ts:461,546,605`),
 * and they are outside both the rule's globs and this helper's reach: `src/` is
 * framework-free (DEC-013/DEC-020) and cannot import from `app/`. Filed as issue
 * #902. Said here as well as in the config because this is the file someone
 * lands in when they ask "did we fix the swallowed errors" — and the answer is
 * "in the framework layer, yes; in the core, no."
 *
 * **What "swallowed" does NOT mean.** This is for a caught error that stops here.
 * A catch that RETHROWS (`app/api/cron/tick/route.ts:118`) already surfaces as a
 * 500 and logs its own message — it is not swallowing anything and does not call
 * this. Nor does a `catch` guarding malformed *input*, where the throw is an
 * expected value rather than a fault; those carry an eslint-disable naming which.
 *
 * ## Where it lands
 *
 * `console.error` from a server component, server action or route handler is
 * captured by Vercel's runtime logs. That is the current destination and the
 * whole of it — **nothing alerts on these**. sheepdog watches muster from the
 * outside by fetching `/api/health`, which proves Postgres answered a `select 1`
 * and nothing more, so the founding bug above would have left every probe green.
 * Closing that needs an ingest surface sheepdog does not have; it is filed there
 * as issue #62. Until it exists, the honest thing to tell a crew member is to
 * notify the admin, which is what the shared copy in `err-copy.ts` says.
 */

/**
 * What a CREW member is told when a surface degrades — one string for every crew
 * page, deliberately (#854, operator's wording).
 *
 * It replaced twelve variants of *"Can't reach the schedule right now. Try again
 * in a moment."* Two things were wrong with that. It described a transient blip,
 * and the failure that produced this task was a missing table — permanent, and
 * retrying reproduces it forever. And it gave a crew member nothing to do, on a
 * system where the human path is the ONLY path: nothing notifies the operator
 * that a page threw (see the destination note above, and sheepdog issue #62).
 * So the last sentence is not politeness — it is the alerting mechanism.
 *
 * The per-page noun went with it. "The schedule" vs "your time off" told a
 * captain nothing they could act on differently, and a single string is one
 * thing to get right. Admin surfaces keep their noun — see below.
 */
export const CREW_UNAVAILABLE =
  "Cannot access muster at the moment. There is a server error. Please notify the admin.";

/**
 * The ADMIN half, appended to each admin surface's own "Couldn't reach the
 * <thing> right now." sentence.
 *
 * Admin surfaces keep their noun and get a different second sentence, because
 * the operator IS the admin — "please notify the admin" is nonsense on their own
 * screen. What they can actually do is read the line `logSwallowed` just wrote,
 * so that is what it points at.
 */
export const ADMIN_LOG_HINT = "The server log has the reason.";

/**
 * @param surface Where it happened, as a reader would name it: `"crew/shift"`,
 *   `"admin/shifts:assignCrew"`. Route-ish for renders, `route:action` for
 *   server actions, so a log line says which of eleven catches in one actions
 *   file this was.
 * @param e Whatever was thrown. Not necessarily an `Error`.
 * @param consequence What is now untrue because this failed — "the audit row was
 *   not written". Optional, and worth writing exactly where the failure is
 *   otherwise *invisible*: a best-effort audit or notify has no banner and no
 *   notice, so the log line is the only artifact that will ever exist.
 */
export function logSwallowed(surface: string, e: unknown, consequence?: string): void {
  try {
    console.error(
      consequence ? `[${surface}] ${consequence}` : `[${surface}] failed`,
      // A SECOND argument, never `${e}`. Interpolating renders "Error: boom" and
      // drops the stack — and the stack is the half that says which repository
      // method and which table. Pinned by a test.
      e,
    );
    // eslint-disable-next-line no-restricted-syntax -- see below
  } catch {
    // NOT a swallowed application error, and it must not call itself. This
    // function runs INSIDE a catch block; if it throws, the caller's degrade
    // path never runs and a recoverable page becomes a 500 — the helper would
    // cause a worse outage than the one it reports. There is by definition
    // nowhere left to report a broken `console.error` to.
  }
}
