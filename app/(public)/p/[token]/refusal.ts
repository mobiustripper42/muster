import { PRICE_CHANGED_MESSAGE } from "../../../../components/checkout/money";
import { TENANT_NAME } from "../../../lib/tenant";

/**
 * What the payment link's pay action tells the customer for each refusal (issue #1251). Its own
 * module because a `"use server"` file may export only async functions.
 */
const EXPIRED = `This payment link has expired. Ask ${TENANT_NAME} for a new one.`;

export const REFUSAL: Record<
  "missing" | "paid" | "cancelled" | "already_paid" | "stale" | "departed" | "blocked",
  string
> = {
  missing: EXPIRED,
  paid: "This trip is already paid — check your texts and email for the confirmation. You have not been charged twice.",
  already_paid:
    "This trip is already paid — check your texts and email for the confirmation. You have not been charged twice.",
  cancelled: "This booking was cancelled, so there’s nothing to pay.",
  stale: PRICE_CHANGED_MESSAGE,
  // The pay link's check (issue #1279): the page renders these two words for its own two states,
  // and a Pay press on a form opened earlier is refused with the same.
  departed: "This trip has already left, so it can’t be paid for here. Nothing was charged.",
  blocked: `This trip can’t be paid for right now. Nothing was charged. Please contact ${TENANT_NAME} before you try again.`,
};
