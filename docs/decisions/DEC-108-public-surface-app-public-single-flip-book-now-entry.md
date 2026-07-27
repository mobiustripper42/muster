---
id: DEC-108
title: "Public surface `app/(public)` + single-flip \"Book Now\" entry (instant Xola rollback)"
topic: "Reservations & payments"
---

## DEC-108: Public surface `app/(public)` + single-flip "Book Now" entry (instant Xola rollback)

**Status:** Decided 2026-07-11 (@architect, under DEC-105). First net-new route group since DEC-020.

**Decision.** A new **`app/(public)`** route group. **Built in two stages, matching the P11/P12 split:**
the **Phase 11 surface is a throwaway, unstyled harness** — the minimum to drive one real paid booking
through the service layer, replaced wholesale in P12. The **real, designed customer surface is Phase 12**
(mockup-first on mildev, no Claude Design). The service-layer pieces below are P11; the UI is P12.
- **Availability read** — Muster-owned events with remaining capacity (`COI max − Σ booked party sizes`
  over `source='muster'` reservations); read-only, no auth, pure deriver. *(Read model P11; real page P12.)*
- **Booking form → Stripe redirect (DEC-107) → confirmation + manage page.** *(Throwaway form P11; real
  surfaces P12.)*
- **Manage link reuses the DEC-020 capability-URL primitive as an addressed deep-link, not a login**
  (respecting DEC-081 "a link is only ever a deep-link"). v1 "manage" = view + request-cancel-out-of-band;
  no self-service cancel. This is the **customer half of the same capability-URL family** — the crew
  calendar feed (**DEC-098**) is the first persistent bearer flavor shipped; this is the customer one.
  **"Living link" is an internal name only — it never appears in customer- or crew-facing copy;**
  to a customer it is **"your booking link,"** to crew **"your shifts."** Confirmation email + SMS both
  carry the link and emphasize **"save this link — it's how you manage your booking."**
- **Link recovery — a public "lost your link?" form.** The general public loses emails and won't grok a
  bare bearer URL. Recovery is **resend, not reveal:** the customer enters **email-or-phone + last name**
  (operator-confirmed 2026-07-11), we match the reservation and **re-send the existing link to the
  email/phone already on file** — we **never** display the booking or link from typed input. **The match
  fields are a lookup key, not the authorization:** the real gate is controlling the on-file contact
  (same boundary as any magic-link / password-reset). Two hygiene rules make the enumeration-resistance
  real: **(1) neutral response always** — "if we found a booking, we've sent your link," identical whether
  or not a match exists (no found/not-found existence leak); **(2) rate-limit the resend** per IP + per
  target contact (against enumeration + mailbombing). **Right-sized:** the protected asset is a
  booking-management link (view + request-cancel-out-of-band), not payment/account creds (money already
  moved through Stripe), so neutral-response + throttle is proportionate — no OTP on top (the resent link
  *is* the delivered-to-verified-channel token). *(P12.)*
- **The public "Book Now" entry point is a single flag** pointing at **Muster or Xola**. Flipping back to
  Xola is one setting, instant and total — the rollback contract behind DEC-105's "switch back to Xola."
  Combined with pilot volume (~5 bookings, deletable + re-keyable; the only manual wrinkle is Stripe-held
  money), a failed launch is a five-minute reversal.

**Revisit if:** the redirect UX proves unacceptable (then reconsider embedded Payment Intents, DEC-107).

**Amendment (2026-07-11, @architect, under DEC-105 — verified reservations model, `docs/design/reservations-model.md`):**
the "Availability read" bullet's formula **`COI max − Σ booked party sizes`** is **corrected to a whole-boat
mutex** — BrewBoat sells whole-boat-private charters, one reservationist per boat-event, so seat-subtraction
is wrong (it would re-offer a booked boat's residual seats to a stranger). An event is available **iff it
carries zero active (`booked`) `source='muster'` reservations** AND the requested party **≤ `Event.capacity`**
(the per-event COI cap). Remaining-capacity is a step function — `Event.capacity` unclaimed, `0` claimed —
never a running subtraction. See the DEC-109 amendment for the claim predicate. Customer availability is a
**new pure deriver (task 11.1)**, distinct from the crew-eligibility oracle in `src/oracle`.
