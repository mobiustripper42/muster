/**
 * What "your shift changed" says, in the shortest true tokens that fit one SMS segment (#740).
 *
 * The notice used to be `your Fri Aug 14 - Brew 3 shift changed - check the app.` — it named the
 * shift and said something moved, never what. A call time sliding 90 minutes earlier and a fourth
 * trip appearing produced byte-identical text, so the crew member had to open the app and
 * remember what the day used to look like to spot the difference.
 *
 * **This is deliberately not prose.** The body is GSM-7 and one segment on purpose
 * (`forward-notices.ts`), and #619 has already been bitten by a single character silently
 * doubling the segment count. Two tokens, ASCII only, ordered by what the crew member acts on.
 *
 * **It is always a SUBSET, never the whole story.** The app carries the complete diff, so this
 * can drop tokens — or return `null` and let the caller fall back to the old text — without
 * losing information. That is what makes the fitting rule boring rather than risky: the worst
 * case is a shorter pointer to a surface that has everything.
 */
import { CALL_LEAD_MINUTES } from "../builder/derive.js";
import { TENANT_TIMEZONE, tzOffsetMs } from "../config/tenant.js";
import type { EventId } from "../domain/ids.js";

/** One GSM-7 SMS segment. A body over this splits and bills as two. */
export const GSM7_SEGMENT = 160;

const MINUTE_MS = 60_000;

export interface ChangeDetail {
  added: EventId[];
  removed: EventId[];
  /** Earliest scheduled departure before/after, ISO instants. `null` = unknown or none. */
  startBefore: string | null;
  startAfter: string | null;
}

/**
 * Vessel-local 12-hour clock, no zero pad, no meridiem: `2:45`, `11:05`.
 *
 * The meridiem is dropped on purpose — it costs 3 characters twice in a budget measured in
 * single digits, and a crew member reading `call 2:45->1:15` about their own shift is not in
 * doubt about whether they are being asked to show up at two in the morning.
 */
function localClock(iso: string): string {
  const at = new Date(iso);
  const local = new Date(at.getTime() + tzOffsetMs(at, TENANT_TIMEZONE));
  const h24 = local.getUTCHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * Departure minus the lead — the time the crew member actually has to be there.
 *
 * The code calls this the CALL time and the crew are told **"start"**. That is not sloppiness:
 * `app/(crew)/crew/shift/[shiftId]/page.tsx` labels this exact value **"Shift Start"**, sitting
 * beside "First departure", because nobody outside the trade knows what a call time is (operator,
 * 2026-08-17). The SMS uses the crew's vocabulary, not the codebase's.
 */
function startClock(iso: string): string {
  return localClock(new Date(new Date(iso).getTime() - CALL_LEAD_MINUTES * MINUTE_MS).toISOString());
}

/**
 * The tokens for one change, joined with `, `, fitted to `budget` characters. `null` when there
 * is nothing true to say, or when not even the first token fits — the caller then sends the
 * unadorned "shift changed" text.
 *
 * Tokens are dropped WHOLE. A truncated token is worse than an absent one: `call 2:45->1:` is
 * unreadable and `+1 tri` looks like a defect to the person holding the phone.
 */
export function changeSummary(detail: ChangeDetail, opts: { budget: number }): string | null {
  const tokens: string[] = [];

  // Shift start first: it changes when they leave the house. A trip added mostly does not, so if
  // only one token fits this is the one worth spending the characters on.
  //
  // A null on either side is UNKNOWN, not "moved" — a pre-watermark row (see the `earliest_start`
  // migration) must not produce a notice claiming a time change it cannot substantiate.
  if (detail.startBefore && detail.startAfter && detail.startBefore !== detail.startAfter) {
    tokens.push(`start ${startClock(detail.startBefore)}->${startClock(detail.startAfter)}`);
  }

  // `added` and `removed` read the same, by the operator's call (2026-08-17) — no distinct
  // phrasing for a day that grew versus one that shrank. Netted, because "+1 trip, -1 trip" is
  // noise and "+0 trips" says nothing.
  //
  // **What netting cannot express** (@code-review): a 1-for-1 swap of two LATE trips nets to
  // zero AND leaves the earliest departure alone, so both tokens vanish and the body falls back
  // to the bare "shift changed." The manifest really did move, and the SMS cannot say so. That is
  // survivable only because the fallback is by design a pointer to a surface carrying the full
  // diff — which is issue #769, not yet built. Until it is, this case is the thinnest the notice
  // gets, and it is the strongest argument for finishing that half.
  const net = detail.added.length - detail.removed.length;
  if (net !== 0) {
    const n = Math.abs(net);
    tokens.push(`${net > 0 ? "+" : "-"}${n} trip${n === 1 ? "" : "s"}`);
  }

  if (tokens.length === 0) return null;

  let out = "";
  for (const t of tokens) {
    const next = out ? `${out}, ${t}` : t;
    if (next.length > opts.budget) break;
    out = next;
  }
  return out || null;
}
