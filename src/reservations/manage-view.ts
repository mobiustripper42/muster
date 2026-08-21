/**
 * Customer "Your booking" view model (Phase 12.6, #459) — the pure shaping behind the
 * capability-URL manage page (`/b/<code>`, DEC-122 as amended by DEC-154). The code scheme + resolve
 * already exist (`booking-link.ts`); this turns a loaded reservation into what the mockup's
 * "Your booking" screen draws, in TWO states driven by trip time: **upcoming** (details +
 * balance) and **completed** (post-trip tip + receipt).
 *
 * Reuses the admin detail money model (`buildReservationDetail`) verbatim — one source of
 * truth for fare/tax/gratuity/paid/balance across the admin pane and the customer page — and
 * adds only the customer-facing extras: the trip-phase flip, the post-trip gratuity tiers, and
 * the trip timing (back-by / arrive-by). Customer-facing rule (mockup, settled 2026-07-17): the
 * BOAT is never named; the crew are (once assigned). Pure; the page does the repo reads.
 */

import type { Offering } from "../domain/entities.js";
import {
  buildReservationDetail,
  type ReservationDetailInput,
  type ReservationDetailView,
} from "./calendar-detail.js";
import { formatClock } from "./availability-screen.js";
import { gratuityCentsFor, gratuityKindsFor } from "./pricing.js";

export type TripPhase = "upcoming" | "completed";

export interface PostTipTier {
  bps: number;
  /** Whole-percent label, e.g. 15 for "+15%". */
  pct: number;
  /** `bps` of the (tip-free) fare — what this tier adds, in cents. */
  amountCents: number;
}

export interface TripTiming {
  /** "1:30 PM" — the departure clock. */
  startLabel: string;
  /** Minutes on the water (offering config), or null when unset. */
  durationMinutes: number | null;
  /** "3:10 PM" — start + duration, or null when the duration is unknown. */
  backByLabel: string | null;
  /** "1:15 PM" — start − arrive-before, or null when arrive-before is unset. */
  arriveByLabel: string | null;
  /** The offering's arrive-before minutes, or null. */
  arriveBeforeMinutes: number | null;
}

export interface ManageView {
  detail: ReservationDetailView;
  phase: TripPhase;
  timing: TripTiming;
  /** The post-trip gratuity tiers to offer (the offering's `post` kind, or the default set).
   *  Empty when the offering disables post tips. */
  postTipTiers: PostTipTier[];
  /** True once the fare is settled (no balance) — gates the receipt's "Paid in full". */
  paidInFull: boolean;
}

/** "HH:MM" → minutes since midnight, or null on a malformed clock. */
function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Add `delta` minutes to an "HH:MM" clock, clamped to the same day, → "H:MM AM/PM". Null on
 *  malformed input or when the result would cross a day boundary (a trip that runs past
 *  midnight is out of scope — the mockup's trips are same-day). */
function shiftClock(hhmm: string, delta: number): string | null {
  const base = minutesOf(hhmm);
  if (base === null) return null;
  const total = base + delta;
  if (total < 0 || total >= 24 * 60) return null;
  const h = Math.floor(total / 60);
  const mm = String(total % 60).padStart(2, "0");
  return formatClock(`${h}:${mm}`);
}

/** Trip phase from the event's vessel-local date+time vs a vessel-local "now". A trip is
 *  `completed` once its START has passed (the mockup flips at trip time, not trip end — the
 *  post-trip tip is offered the moment the trip is underway). */
export function tripPhaseOf(
  eventDate: string,
  eventTime: string,
  now: { date: string; time: string },
): TripPhase {
  if (eventDate < now.date) return "completed";
  if (eventDate > now.date) return "upcoming";
  const evt = minutesOf(eventTime);
  const cur = minutesOf(now.time);
  if (evt === null || cur === null) return "upcoming"; // unknown ⇒ don't prematurely close it
  return cur >= evt ? "completed" : "upcoming";
}

/** The post-trip gratuity tiers for an offering (DEC-124 `post` kind), priced off the fare. */
export function postTipTiersFor(
  offering: Pick<Offering, "gratuityKinds"> | undefined,
  fareCents: number,
): PostTipTier[] {
  const post = gratuityKindsFor(offering ?? {}).find((k) => k.kind === "post");
  if (!post) return [];
  return post.tiersBps.map((bps) => ({
    bps,
    pct: Math.round(bps / 100),
    amountCents: gratuityCentsFor(fareCents, bps),
  }));
}

export interface ManageViewInput extends ReservationDetailInput {
  /** Vessel-local "now" for the phase flip (the page passes `vesselDateOf(new Date())` + clock). */
  now: { date: string; time: string };
}

/** Build the customer manage view. Pure — every input is already-loaded data. */
export function buildManageView(input: ManageViewInput): ManageView {
  const detail = buildReservationDetail(input);
  const phase = tripPhaseOf(detail.date, detail.time, input.now);
  const durationMinutes = input.offering?.tripLengthMinutes ?? null;
  const arriveBeforeMinutes = input.offering?.arriveBeforeMinutes ?? null;
  const timing: TripTiming = {
    startLabel: formatClock(detail.time),
    durationMinutes,
    backByLabel: durationMinutes !== null ? shiftClock(detail.time, durationMinutes) : null,
    arriveByLabel: arriveBeforeMinutes !== null ? shiftClock(detail.time, -arriveBeforeMinutes) : null,
    arriveBeforeMinutes,
  };
  return {
    detail,
    phase,
    timing,
    postTipTiers: postTipTiersFor(input.offering, detail.money.fareCents),
    // **`paidCents > 0` is not redundant (issue #803).** Zeroing a cancelled booking's balance
    // made `balanceCents <= 0` true for a booking nobody has paid a net penny on — a FULLY
    // refunded one, where the payment row is `refunded` and so counts as zero paid. The guest
    // page renders this as its headline money line, and it read "Paid in full $0.00" directly
    // above "Refunded −$758.49". Found by `@code-review`, not by the operator, and it is the
    // common case on the operator-cancel path (#797): a full refund leaves exactly this state.
    paidInFull:
      detail.money.priceKnown && detail.money.paidCents > 0 && detail.money.balanceCents <= 0,
  };
}
