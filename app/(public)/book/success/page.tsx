/**
 * Booking success landing (DEC-107/108, 11.2) — where Stripe redirects after payment.
 * Deliberately says "confirming", NOT "booked": the redirect is not proof of payment —
 * the webhook is what writes the reservation. Throwaway P11 harness surface; the real
 * confirmation + manage page is Phase 12.
 */
export default function BookingSuccessPage() {
  return (
    <main style={{ maxWidth: "32rem", margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Confirming your booking…</h1>
      <p>
        Thanks — your payment went through. We&rsquo;re finalizing your reservation and
        will send your booking link and details shortly.
      </p>
    </main>
  );
}
