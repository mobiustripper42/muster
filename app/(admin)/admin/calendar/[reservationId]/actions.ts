"use server";

import { redirect } from "next/navigation";
import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import { asId } from "@core/domain/ids.js";
import { createBalanceCheckout } from "@core/reservations/create-balance-checkout.js";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";

/**
 * Mint a BALANCE LINK for a deposit booking (11.2b, DEC-107) — the operator door for a
 * service that shipped tested and callable but with no caller outside `db:balance`.
 *
 * The operator sends the link; the CUSTOMER pays. Muster writes nothing here — the
 * `Payment{kind:'balance'}` lands via the Stripe webhook (`metadata.purpose="balance"`), so a
 * minted-but-unpaid link is inert and re-minting is free. That is why this can be a plain
 * button with no confirmation: it charges nobody and changes no state.
 *
 * The URL comes back on the query string rather than being stored: the link is **re-minted per
 * request against the CURRENT balance** (`createBalanceCheckout` derives the amount through
 * `balanceOwedCents`), so persisting one would be persisting a number that goes stale the moment
 * a payment lands. Query-string round-trip keeps the page server-rendered with no client JS.
 *
 * Deliberately NOT emailed/texted to the customer: customer messaging needs the second sender
 * number (#119) so a customer can never reach the crew line. Operator copies and sends.
 */
export async function createBalanceLink(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const reservationId = String(formData.get("reservationId") ?? "");
  const date = String(formData.get("date") ?? "");
  const filter = String(formData.get("filter") ?? "");

  /** Back to this reservation's detail, preserving the grid's day/filter. */
  const back = (extra: Record<string, string>): string => {
    const p = new URLSearchParams();
    if (date) p.set("date", date);
    if (filter) p.set("filter", filter);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    const q = p.toString();
    return `/admin/calendar/${encodeURIComponent(reservationId)}${q ? `?${q}` : ""}`;
  };

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) redirect(back({ balanceErr: "stripe_not_configured" }));

  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

  let result: Awaited<ReturnType<typeof createBalanceCheckout>>;
  try {
    result = await createBalanceCheckout(
      getRepo(),
      new StripePaymentPort(secretKey, webhookSecret),
      asId<"ReservationId">(reservationId),
      { successUrl: `${base}/book/success`, cancelUrl: `${base}/book/cancel` },
    );
  } catch {
    // Stripe unreachable / key rejected — say so rather than showing a dead button.
    redirect(back({ balanceErr: "stripe_unreachable" }));
  }

  if (!result.ok) redirect(back({ balanceErr: result.reason }));
  redirect(back({ balanceUrl: result.url }));
}
