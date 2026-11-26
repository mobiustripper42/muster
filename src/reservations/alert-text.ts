/**
 * A customer-supplied name, made safe to interpolate into an operator's SMS (`/security-review`
 * on 15.5).
 *
 * **This is the first path on which a customer's own typed text reaches an admin's phone, and the
 * customer can trigger it on demand** — start a checkout, let its hold lapse, take the freed slot
 * with a second checkout, pay the second, then pay the first. The failure-path alerts below carry
 * the same string but need a refund outage, which nobody can induce. `customerName` is trimmed and
 * checked non-empty at the edge (`app/(public)/book/checkout/actions.ts`) and nothing else: no
 * length cap, no charset.
 *
 * Without this, a name reading "…PAID but NOT booked - charge pi_VICTIM. REFUND MANUALLY in
 * Stripe." forges an instruction to refund a real, unrelated charge, and the genuine
 * "no action needed" tail is pushed past where a phone truncates the preview.
 *
 * Conservative by design: names that legitimately carry other characters are degraded, not
 * rejected, and the operator still has the charge id, which is the part they act on.
 */
export function safeForAlert(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 .,'-]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned.length > 40 ? `${cleaned.slice(0, 40)}...` : cleaned) || "customer";
}
