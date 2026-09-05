/**
 * The line that replaces the outbox (#933, tracking #901).
 *
 * The outbox was three queues, three tables and a screen whose only surviving job
 * was letting a human read a message that no configured channel could send. That
 * is one log line's worth of work, and this is the line.
 *
 * **The trigger is "no channel configured", never the environment.** In dev those
 * coincide, because dev is where nothing is configured — which is what made the
 * outbox a test harness by accident. In production this is the ONLY record of what
 * did not go out, so gating it on `isProdDeploy()` would throw it away exactly when
 * it matters. What differs by environment is severity, not whether it happens:
 * `console.log` in dev, where you are already watching the terminal, and
 * `console.error` in production, where sheepdog is what reads it (sheepdog issue 62).
 *
 * **Nothing here is masked.** The operator's call: the recipient's phone and the
 * booking link both go in whole. The line is server-side only — this runs in a
 * server action, a route or a webhook, so it reaches the platform runtime log and
 * never a browser. The `/b/CODE` link in a booking body IS a capability URL, and
 * `ensureBookingCode` mints it before the send is attempted, so on this path a live
 * code lands in a log having never reached the customer. Accepted: the path is rare,
 * and in dev the clickable link is the entire point of reading the line.
 *
 * **This is not a send.** It is what gets written instead of one. Callers must not
 * report success off the back of it — `resendReservationLink` still returns
 * `{ kind: "skipped" }` (see `booking-confirmation.ts`), because rendering a skip as
 * "Sent" tells a customer their link is on the way when nothing left the building.
 */

import { isProdDeploy } from "./flags";

/** Just enough of a recipient to say who this was for. Matches `Recipient` structurally. */
export interface UnsentRecipient {
  phone?: string | undefined;
  email?: string | undefined;
}

/**
 * The line itself, pure and therefore testable (`unsent.test.ts`).
 *
 * Body last and on its own line: it is multi-line and the part you paste out of, so
 * anything after it would be lost in the wrap.
 */
export function unsentLine(surface: string, to: UnsentRecipient, body: string): string {
  const who = [to.phone, to.email].filter((x) => x !== undefined && x !== "");
  const recipient = who.length > 0 ? who.join(" / ") : "no recipient";
  return `[${surface}] NOT SENT — no channel configured. to=${recipient}\n${body}`;
}

/**
 * Write it. `sink` exists for the test; production callers pass nothing and get the
 * severity split described above.
 *
 * Never throws. It runs on a degrade path — the send has already failed to happen —
 * and a logger that throws there turns "nothing was sent" into a 500, which is
 * strictly worse. Same posture as `logSwallowed` (#854).
 */
export function logUnsent(
  surface: string,
  to: UnsentRecipient,
  body: string,
  sink?: (line: string) => void,
): void {
  try {
    const write = sink ?? (isProdDeploy() ? console.error : console.log);
    write(unsentLine(surface, to, body));
    // eslint-disable-next-line no-restricted-syntax -- see above: this must not throw
  } catch {
    // Deliberately empty. Nothing above this frame can act on a failed log, and the
    // caller's degrade path has to keep running.
  }
}
