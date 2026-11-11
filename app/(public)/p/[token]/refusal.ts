import { PRICE_CHANGED_MESSAGE } from "../../../../components/checkout/money";
import { TENANT_NAME } from "../../../lib/tenant";

/**
 * What the payment link's pay action tells the customer for each refusal (issue #1251). Its own
 * module because a `"use server"` file may export only async functions.
 */
const EXPIRED = `This payment link has expired. Ask ${TENANT_NAME} for a new one.`;

export const REFUSAL: Record<"missing" | "paid" | "cancelled" | "already_paid" | "stale", string> = {
  missing: EXPIRED,
  paid: "This trip is already paid — check your texts and email for the confirmation. You have not been charged twice.",
  already_paid:
    "This trip is already paid — check your texts and email for the confirmation. You have not been charged twice.",
  cancelled: "This booking was cancelled, so there’s nothing to pay.",
  stale: PRICE_CHANGED_MESSAGE,
};
