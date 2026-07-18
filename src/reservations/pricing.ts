/**
 * Party-fare composition (Phase 12.2) — the BOOKING-TIME price the customer actually pays.
 * The formula is fixed by the **DEC-125 build note** ("base fare + `extraGuestPrice` per guest
 * over N"); DEC-112 established the per-`Event` base price it composes over. Deliberately kept
 * OUT of the availability deriver (which resolves only the display base per slot, DEC-125). A
 * departure sells the whole boat at a
 * **base fare up to the vessel's included guest count**, plus a per-guest surcharge for each
 * guest above it, to the boat's COI cap:
 *
 *   fare = base + max(0, guestCount − includedGuestCount) × extraGuestPriceCents + gratuity
 *
 * where `base` is the resolved per-departure price (`Event.price` for a materialized slot, or
 * the first-match price variation off `Offering.basePriceCents` for a virtual one — resolved
 * by the caller). Tax + deposit split are computed AFTER this, from `PaymentConfig` (DEC-107),
 * over the fare. Pure + integer-cents throughout (float-safe, Stripe-aligned).
 *
 * `gratuityCents` is a parameter here so 12.3 (DEC-124) slots the tip in without reshaping the
 * composition; it defaults to 0 (12.2 composes base + extras only).
 */

export interface FareInput {
  /** Resolved per-departure base fare in cents (Event.price or variation-resolved base). */
  baseCents: number;
  /** Guests on the booking (never "party") — 1..coiMaxPax, validated upstream. */
  guestCount: number;
  /** Guests the base fare covers (Vessel.includedGuestCount, or coiMaxPax when unset). */
  includedGuestCount: number;
  /** Per-guest surcharge above the included count (Offering.extraGuestPriceCents). */
  extraGuestPriceCents: number;
  /** Gratuity in cents (DEC-124, 12.3) — 0 in 12.2. */
  gratuityCents?: number;
}

export interface Fare {
  /** Guests billed as "extra" (above the included count) — 0 if within the base. */
  extraGuests: number;
  /** `extraGuests × extraGuestPriceCents`. */
  extrasCents: number;
  /** `baseCents + extrasCents + gratuityCents` — the pre-tax fare. */
  fareCents: number;
}

/** Compose the pre-tax party fare. Never negative extras: fewer guests than included still
 *  pays the whole-boat base (you don't get a discount for a small party — DEC-105). */
export function composeFare(input: FareInput): Fare {
  const extraGuests = Math.max(0, input.guestCount - input.includedGuestCount);
  const extrasCents = extraGuests * input.extraGuestPriceCents;
  const fareCents = input.baseCents + extrasCents + (input.gratuityCents ?? 0);
  return { extraGuests, extrasCents, fareCents };
}

/** The effective included-guest count for a vessel: its `includedGuestCount`, or `coiMaxPax`
 *  when unset (whole boat included, no extras). Centralizes the DEC-112 default. */
export function effectiveIncludedGuests(vessel: {
  includedGuestCount?: number;
  coiMaxPax: number;
}): number {
  return vessel.includedGuestCount ?? vessel.coiMaxPax;
}
