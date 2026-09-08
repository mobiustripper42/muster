/**
 * Abandoned checkouts (14.8, SPEC §2.8.8) — PURE. Feed it `repo.listAllReservations()` and an
 * instant; it returns the lapsed `pending` rows, newest first.
 *
 * **Why this exists rather than a reaper.** Nothing deletes a lapsed row. §2.8.8 chose to build the
 * monitor before the destructive tool: an abandoned checkout is the only evidence that says whether
 * the payment window is the right length, and writing the delete first would have destroyed the
 * data that says whether the delete was ever needed. So the rows accumulate, and this reads them.
 *
 * **No port method, deliberately.** With nothing reaping, the row count stays small enough to
 * filter in memory — the same shape the availability deriver already uses. A dedicated query is
 * worth adding the day this list is too long to hand to a page, and not before.
 *
 * **This ranks nothing and accuses nobody.** A pending reservation is creatable by anyone who can
 * reach the checkout, so these rows carry scripted abuse alongside real abandonment — and no field
 * separates the two. An absent payment id means "never reached the provider", which is a script, a
 * provider outage, or a dropped connection: three facts wearing one blank. The screen shows what
 * was stored. Categories can be added once somebody has read a season of them.
 */
import type { Reservation } from "../domain/entities.js";
import type { OfferingId, ReservationId, VesselId } from "../domain/ids.js";
import { isLivePending, pendingLiveSince } from "./pending.js";

/** One walked-away checkout, as the screen shows it. */
export interface AbandonedCheckout {
  id: ReservationId;
  /** ISO-8601 vessel-local day of the departure they were buying. */
  date: string;
  /** Departure clock "HH:MM". */
  time: string;
  vesselId: VesselId;
  offeringId?: OfferingId | null;
  partySize: number;
  /** ISO-8601 UTC — when the checkout claimed the boat. The window ran from here. */
  reservedAt: string;
  /**
   * How many PaymentIntents this checkout minted (§2.8.5). Zero means it never reached the
   * provider. **That is not a verdict** — see the module note.
   */
  paymentIntentCount: number;
  /**
   * A short stable hash of the holder token, so repeat attempts by one customer group on screen.
   * NEVER the token itself: it is an httpOnly possession credential, and a page carrying one can
   * be screenshotted. Absent when the checkout carried no token — two anonymous attempts are two
   * customers, not one session with two tries.
   */
  session?: string;
}

/**
 * The lapsed public `pending` rows at `asOf`, newest reserved first.
 *
 * Excluded, each for its own reason:
 *  - **`booked` / `cancelled`** — bought, or ended by a person. Not walked away from.
 *  - **Still inside the window** — that customer is at the card form right now.
 *  - **`source: "admin"`** — an operator's booking has no window and never lapses (DEC-163,
 *    §2.8.8's first rule). It is a phone booking waiting for its customer, and counting it here
 *    would put the operator's own work on a screen about strangers leaving.
 *  - **No `reservedAt`** — a Xola-imported or pre-14.4 row. With no start there is no window, so
 *    it cannot have lapsed, and dating it from anything else would invent the number this screen
 *    exists to report.
 */
export function abandonedCheckouts(
  reservations: readonly Reservation[],
  asOf: string,
): AbandonedCheckout[] {
  const liveSince = pendingLiveSince(asOf);
  const out: AbandonedCheckout[] = [];
  for (const r of reservations) {
    if (r.status !== "pending") continue;
    // `source` first (§2.8.8). An admin row is live-forever to `isLivePending`, so testing that
    // alone would exclude it — but for the wrong reason, and the day DEC-163 is revisited this
    // screen would silently start counting phone bookings. Say it here, in its own line.
    if (r.source !== "muster") continue;
    if (r.reservedAt === undefined) continue;
    if (isLivePending(r, liveSince)) continue; // still paying
    if (!r.vesselId || !r.date || !r.time) continue; // not a slot-bearing row; nothing to show
    out.push({
      id: r.id,
      date: r.date,
      time: r.time,
      vesselId: r.vesselId,
      partySize: r.partySize,
      reservedAt: r.reservedAt,
      paymentIntentCount: r.paymentIntentIds?.length ?? 0,
      ...(r.offeringId !== undefined ? { offeringId: r.offeringId } : {}),
      ...(r.holderToken ? { session: sessionLabel(r.holderToken) } : {}),
    });
  }
  // Newest first: the operator's question is "what happened lately", and the tail of this list is
  // the oldest thing that ever happened.
  return out.sort((a, b) => b.reservedAt.localeCompare(a.reservedAt));
}

/**
 * A short, stable, non-reversing label for a holder token.
 *
 * **Not a security boundary and not claiming to be one** — it is a grouping key for a screen. It is
 * a hash rather than a prefix so that the rendered value cannot be pasted back into a cookie: a
 * prefix of a secret is a piece of the secret, and this page is exactly the kind of thing that ends
 * up in a screenshot. FNV-1a because the requirement is "same input, same short label", not
 * collision resistance; two colliding tokens would merge two customers' rows on one screen, which
 * is a cosmetic wrong and not a leak.
 */
function sessionLabel(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The header facts — what the screen states above the table. */
export interface AbandonmentSummary {
  /** How many walked-away checkouts are on disk. */
  total: number;
  /**
   * The payment window in force RIGHT NOW, in minutes — stated rather than per-row, because it is
   * not recorded per row. Every abandoned checkout held its boat for exactly one window, so the
   * per-row number would be this same value repeated, and after the knob moves it would read the
   * NEW value against OLD rows. `SPEC.md:2116` accepts that and says the honest fix is recording
   * when the knob moved, not stamping the number on every row. Stating it once is that honesty:
   * one number, visibly current, that a reader can weigh against a note of when it changed.
   */
  windowMinutes: number;
  /** `total × windowMinutes`, in hours — the hull time these checkouts withheld. The number
   *  §2.8.8 wants weighed: a window that is too long shows up here and nowhere else. */
  hullHoursWithheld: number;
  /** How many reached the payment provider at all. The remainder did not; §2.8.8 and the module
   *  note above are explicit that neither number is a verdict about who or what caused it. */
  reachedProvider: number;
}

/** Summarize `rows` against the window currently in force. Pure; the caller supplies the window
 *  so this module reads no env and no clock. */
export function summarizeAbandonment(
  rows: readonly AbandonedCheckout[],
  windowMinutes: number,
): AbandonmentSummary {
  const reachedProvider = rows.filter((r) => r.paymentIntentCount > 0).length;
  return {
    total: rows.length,
    windowMinutes,
    // One decimal: the difference between 4.2 and 4.25 hours is not a difference anybody acts on,
    // and a full float here renders as noise.
    hullHoursWithheld: Math.round((rows.length * windowMinutes) / 6) / 10,
    reachedProvider,
  };
}
