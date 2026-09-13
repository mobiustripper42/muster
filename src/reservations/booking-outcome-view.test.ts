import { describe, expect, it } from "vitest";
import {
  bookingOutcomeView,
  SOLD_OUT_VIEW_COPY,
  type BookingOutcome,
} from "./booking-outcome-view.js";

/**
 * `/book/success` told the residual-race loser "You're booked!" (15.5). It called the confirm,
 * threw the result away, and rendered one card for every outcome. The customer who had just lost
 * the boat read "Payment received. Your crew will see you on the water" and got a text saying the
 * opposite a few minutes later.
 *
 * Found by staging the real race in the app, not by a test.
 */
describe("bookingOutcomeView", () => {
  it("a residual-race loss is NOT a booking", () => {
    expect(bookingOutcomeView("lost")).toEqual({ kind: "sold_out" });
  });

  it("booked and already are both a booking", () => {
    // `already` is a redelivered webhook or a reloaded success page on a real sale.
    expect(bookingOutcomeView("booked")).toEqual({ kind: "booked" });
    expect(bookingOutcomeView("already")).toEqual({ kind: "booked" });
  });

  it("everything else reads as pending, never as sold out", () => {
    // The asymmetry is deliberate: telling a booked customer they lost their seat is worse than
    // telling a lost customer to wait, and the webhook is still coming in all of these cases.
    //
    // Exhaustive over the real outcome union rather than a hand-picked sample — `BookingOutcome`
    // is derived from `WebhookResult`, so a tenth outcome added to the webhook lands here and
    // must be classified deliberately. Typecheck already caught one invented name in this list.
    const rest: Exclude<BookingOutcome, "lost" | "booked" | "already">[] = [
      "refund_recorded",
      "ignored",
      "unbookable",
      "balance_paid",
      "gratuity_paid",
      "dispute_recorded",
    ];
    expect(bookingOutcomeView(undefined)).toEqual({ kind: "pending" });
    for (const o of rest) expect(bookingOutcomeView(o)).toEqual({ kind: "pending" });
  });

  it("the sold-out copy says charged AND refunded, and never that they were not charged", () => {
    const all = Object.values(SOLD_OUT_VIEW_COPY).join(" ");
    expect(all).toContain("charged and refunded in full");
    expect(all).not.toMatch(/not been charged|were not charged/i);
    // It must set the timing expectation, or the statement looks wrong to them.
    expect(all).toContain("few days");
  });
});
