/**
 * Throwaway booking harness (Phase 11.6, DEC-108) — the extremely-thin, unstyled public
 * surface that exercises the whole reservation service layer to put ONE real paid booking
 * through (the Phase 11 exit gate). **Explicitly disposable — replaced wholesale by the
 * designed customer UI in Phase 12.** Not customer-quality; bare HTML on purpose.
 *
 * Lists bookable Muster events (11.1 `deriveAvailability`) and posts to `startBooking`,
 * which opens Stripe Checkout (11.2 `createBookingCheckout`). Gated behind the
 * `RESERVATIONS` flag (DEC-111).
 */
import { deriveAvailability } from "@core/reservations/availability.js";
import { WAIVER_TERMS_URL } from "@core/config/tenant.js";
import { SubmitButton } from "../../../components/ui/submit-button";
import { getRepo } from "../../lib/repo";
import { startBooking } from "./actions";

export const dynamic = "force-dynamic";

const box = { border: "1px solid #ccc", padding: "1rem", margin: "1rem 0" } as const;

export default async function BookHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  if (process.env.RESERVATIONS !== "true") {
    return (
      <main style={{ maxWidth: "40rem", margin: "2rem auto", padding: "0 1rem" }}>
        <h1>Reservations are off</h1>
        <p>Set <code>RESERVATIONS=true</code> to enable the booking harness (DEC-111).</p>
      </main>
    );
  }

  const { err } = await searchParams;
  const repo = getRepo();
  const [events, reservations] = await Promise.all([
    repo.listEvents(),
    repo.listAllReservations(),
  ]);
  const bookable = deriveAvailability(events, reservations).filter(
    (a) => a.available && a.price !== undefined,
  );

  return (
    <main style={{ maxWidth: "40rem", margin: "2rem auto", padding: "0 1rem", fontFamily: "system-ui" }}>
      <h1>Book a boat (harness)</h1>
      {err && <p style={{ color: "crimson" }}>Couldn&rsquo;t start checkout: {err}</p>}
      {bookable.length === 0 && (
        <p>
          No bookable Muster events. Seed one with <code>npm run db:checkout -- --dry-run</code>, or
          mark a vessel-day owned with <code>db:own</code>.
        </p>
      )}
      {bookable.map((a) => (
        <form key={String(a.eventId)} action={startBooking} style={box}>
          <input type="hidden" name="eventId" value={String(a.eventId)} />
          <p>
            <strong>
              {a.date} {a.time}
            </strong>{" "}
            — whole boat, up to {a.capacity} guests — ${(a.price! / 100).toFixed(2)} + tax
          </p>
          <p>
            <label>
              Your name{" "}
              <input name="customerName" required />
            </label>
          </p>
          <p>
            <label>
              Party size{" "}
              <input name="partySize" type="number" min={1} max={a.capacity} defaultValue={2} required />
            </label>
          </p>
          <p>
            <label>
              Email <input name="email" type="email" />
            </label>
          </p>
          <p>
            <label>
              Phone <input name="phone" />
            </label>
          </p>
          <p>
            <label>
              <input type="checkbox" name="waiverConsent" value="yes" required />{" "}
              I agree to the{" "}
              <a href={WAIVER_TERMS_URL} target="_blank" rel="noopener noreferrer">
                liability waiver
              </a>
              .
            </label>
          </p>
          <SubmitButton>Book &amp; pay &rarr;</SubmitButton>
        </form>
      ))}
    </main>
  );
}
