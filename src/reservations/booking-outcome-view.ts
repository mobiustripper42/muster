/**
 * What `/book/success` tells the customer, decided from the confirm outcome (15.5).
 *
 * **The page used to say "You're booked!" unconditionally.** It called the confirm, discarded the
 * result, and rendered the same success card for every outcome — including `lost`, the residual
 * race where the hull went to a rival and the customer is being refunded. So the person who lost
 * the seat read "Payment received. Your crew will see you on the water", and some minutes later
 * got a text saying the opposite. The screen wins that argument, because it comes first and they
 * are looking at it.
 *
 * Found by staging the real race in the app. No unit test would have caught it, because the page
 * never asked the question this module answers.
 *
 * Pure and in core with the rest of the customer copy (`sold-out-notice.ts`), so the wording is
 * testable and so the page stays a renderer.
 */
import type { WebhookResult } from "./booking-webhook.js";

/** The outcome of a HANDLED result. `WebhookResult` is a union and `{ handled: false }` carries
 *  none, which is itself a "we do not know" and maps to `pending` below. */
export type BookingOutcome = Extract<WebhookResult, { handled: true }>["outcome"];

export type BookingOutcomeView =
  | { kind: "booked" }
  /** The residual race: they paid, the boat went to someone else, the money is coming back. */
  | { kind: "sold_out" }
  /**
   * We do not know yet. The confirm was skipped, the id was absent or unresolvable, or Stripe is
   * unconfigured — all cases where the webhook is still coming and the booking is probably fine.
   * Deliberately NOT `sold_out`: telling a booked customer they lost their seat is the worse of
   * the two errors, and the honest reading of silence is "finalizing", which is what the page
   * already said in its body copy.
   */
  | { kind: "pending" };

/**
 * Map a confirm result to what the customer is shown. `undefined` means the confirm never ran.
 *
 * `already` is `booked` — a redelivered webhook or a page reload on a real booking.
 * `ignored` and `unconfirmable` are `pending`, not failure: the first is a metadata-less intent
 * (DEC-134's guard) and the second is a row we could not resolve *yet*, and in both cases a real
 * customer may be holding a real booking that the webhook is about to confirm.
 */
export function bookingOutcomeView(outcome: BookingOutcome | undefined): BookingOutcomeView {
  if (outcome === "lost") return { kind: "sold_out" };
  if (outcome === "booked" || outcome === "already") return { kind: "booked" };
  return { kind: "pending" };
}

/**
 * The sold-out heading and body, matching `soldOutNoticeBody`'s posture: say they were charged
 * AND refunded in one breath, because the money really did move and a screen claiming otherwise
 * is contradicted by their own statement for days.
 *
 * No amount here either, for the same reason as the SMS — the point is that all of it is coming
 * back (`docs/SPEC.md` §2.8.7).
 */
export const SOLD_OUT_VIEW_COPY = {
  heading: "That departure just sold out",
  lead: "Someone else completed payment for the last seats while yours was going through.",
  body:
    "Your card was charged and refunded in full right away. Refunds usually take a few days to " +
    "show up on a statement. You have not lost any money, and there is nothing you need to do.",
  action: "Find another trip",
} as const;
