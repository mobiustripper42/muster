/**
 * The record of an error the CORE caught and did not rethrow (#902).
 *
 * The core half of `app/lib/swallowed.ts`, which closed this in `app/**` and
 * `components/**` at #854 and deliberately stopped there. `src/` is framework-free
 * (DEC-013/DEC-020) and cannot import from `app/` — the core-purity ban in
 * `eslint.config.mjs` enforces that, and `tsconfig.core.json` declares no path
 * alias, so the import could not resolve even if the ban were lifted. Hence a
 * second function rather than a shared one.
 *
 * **Why a core-local logger and not a `Logger` port.** A port is the architecture's
 * own answer and was the expensive one: threading an injected logger to sites deep
 * inside loops, for diagnostics. It was rejected on evidence — `src/` already wrote
 * to `console.error` in seven files before this existed, including four times in
 * `booking-webhook.ts`, the same file as three of the sites this closes. The premise
 * that the core has no I/O concern was already not true, so a port would have been
 * ceremony added on top of a boundary nobody was keeping. `console` is ambient, not
 * a framework import; purity survives.
 *
 * **`db/` is deliberately out of scope**, and this sentence is the record of that
 * so nobody counts those five as debt. They are scripts run by hand at a terminal
 * where an unhandled throw is already on screen — the invisibility this fixes is
 * specific to code running inside a server.
 *
 * ## Where it lands, and what that is not
 *
 * `console.error` from a Vercel function reaches the runtime logs. That is the whole
 * destination. **Nothing alerts on any of this** — sheepdog watches muster by
 * fetching `/api/health`, which proves Postgres answered `select 1` and nothing
 * more. Making 23 silent failures visible in a place nobody watches is an
 * improvement and is not monitoring. Filed on that side as sheepdog issue #62.
 */

/**
 * @param surface Where it happened, as a reader would name it: `"reservations:confirm"`,
 *   `"asks:drip"`. Module-ish, `module:operation` when one module has several
 *   catches, so a log line says which.
 * @param e Whatever was thrown. Not necessarily an `Error`.
 * @param consequence What is now untrue because this failed — "the customer was not
 *   sent their confirmation". Worth writing exactly where the failure is otherwise
 *   **invisible**: a best-effort notify has no banner and no notice, so this line is
 *   the only artifact that will ever exist.
 */
export function logSwallowed(surface: string, e: unknown, consequence?: string): void {
  try {
    console.error(
      consequence ? `[${surface}] ${consequence}` : `[${surface}] failed`,
      // A SECOND argument, never `${e}`. Interpolating renders "Error: boom" and
      // drops the stack — and the stack is the half that names the repository
      // method and the table. Pinned by a test.
      e,
    );
    // No eslint-disable needed: `eslint.config.mjs` exempts this file wholesale,
    // because it is the destination the ban routes everything else to and cannot
    // route through itself. The reason lives there, in one place.
  } catch {
    // NOT a swallowed application error, and it must not call itself. This function
    // runs INSIDE a catch block; if it throws, the caller's degrade path never runs
    // and a recoverable failure becomes a crash — the helper causing a worse outage
    // than the one it reports. There is by definition nowhere to report a broken
    // `console.error` to.
  }
}
