/**
 * Booking cancel landing (DEC-107/108, 11.2) — where Stripe redirects if the customer
 * backs out of Checkout. No charge was made; no reservation was written. Throwaway P11
 * harness surface; the real booking flow is Phase 12.
 */
export default function BookingCancelPage() {
  return (
    <main style={{ maxWidth: "32rem", margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Booking cancelled</h1>
      <p>No charge was made. Start over whenever you&rsquo;re ready.</p>
    </main>
  );
}
