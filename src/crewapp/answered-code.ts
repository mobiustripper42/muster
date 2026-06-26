import type { ResponseOutcome } from "../asks/ask-loop.js";

/**
 * Map an In/Out response + its outcome to a `/crew` notice code (#161). A win or a
 * decline is straightforward; a non-claiming accept is one of three DISTINCT things
 * the crew member must not all hear as "you lost the seat":
 *  - `double_booked` — they already hold another seat that day (DEC-003).
 *  - `already_answered` — a re-tap of an ask they'd already settled (#145); they
 *    may well be ON the shift, so never tell them it was "filled" out from under them.
 *  - otherwise (`already_filled` / none) — a genuine lost CAS race (REQ-CLAIM-1).
 * Pure so the surface stays dumb and this is unit-testable (the action layer is not).
 */
export function answeredNoticeCode(
  response: "accepted" | "declined",
  outcome: ResponseOutcome,
): "in" | "out" | "filled" | "booked" | "already" {
  if (response === "declined") return "out";
  if (outcome.claimed) return "in";
  switch (outcome.reason) {
    case "double_booked":
      return "booked";
    case "already_answered":
      return "already";
    default:
      return "filled"; // already_filled / undefined — someone won it first
  }
}
