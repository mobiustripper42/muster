/**
 * Party-fare composition (Phase 12.2) — the BOOKING-TIME price the customer actually pays.
 * The formula is fixed by the **DEC-125 build note** ("base fare + `extraGuestPrice` per guest
 * over N"); DEC-112 established the per-`Event` base price it composes over. Deliberately kept
 * OUT of the availability deriver (which resolves only the display base per slot, DEC-125). A
 * departure sells the whole boat at a
 * **base fare up to the offering's included guest count** (12.8; vessel `coiMaxPax` fallback),
 * plus a per-guest surcharge for each
 * guest above it, to the boat's COI cap:
 *
 *   fare = base + max(0, guestCount − includedGuestCount) × extraGuestPriceCents + gratuity
 *
 * where `base` is the resolved per-departure price (`Event.price` for a materialized slot, or
 * the first-match price variation off `Offering.basePriceCents` for a virtual one — resolved
 * by the caller). Tax + deposit split are computed AFTER this, from `PaymentConfig` (DEC-107),
 * over the fare. Pure + integer-cents throughout (float-safe, Stripe-aligned).
 *
 * **Gratuity is deliberately NOT part of `fareCents`** (@architect, 12.3). It is crew money,
 * tax- and fee-EXEMPT and charged in FULL regardless of deposit mode (DEC-124) — folding it in
 * here would (i) tax the tip via `taxCentsFor(fareCents)` and (ii) deposit-split it via
 * `chargeNowCents`. The checkout computes gratuity separately (% of `fareCents`) and adds it on
 * top, after tax. `fareCents` is the TAXABLE base — keep it tip-free.
 */

export interface FareInput {
  /** Resolved per-departure base fare in cents (Event.price or variation-resolved base). */
  baseCents: number;
  /** Guests on the booking (never "party") — 1..coiMaxPax, validated upstream. */
  guestCount: number;
  /** Guests the base fare covers (Offering.includedGuestCount, or the vessel's coiMaxPax when unset). */
  includedGuestCount: number;
  /** Per-guest surcharge above the included count (Offering.extraGuestPriceCents). */
  extraGuestPriceCents: number;
}

export interface Fare {
  /** Guests billed as "extra" (above the included count) — 0 if within the base. */
  extraGuests: number;
  /** `extraGuests × extraGuestPriceCents`. */
  extrasCents: number;
  /** `baseCents + extrasCents` — the pre-tax, tip-free taxable fare. */
  fareCents: number;
}

/** Compose the pre-tax party fare (base + extras). Never negative extras: fewer guests than
 *  included still pays the whole-boat base (no small-party discount — DEC-105). Gratuity is
 *  added by the checkout AFTER tax, never here (see the module note). */
export function composeFare(input: FareInput): Fare {
  const extraGuests = Math.max(0, input.guestCount - input.includedGuestCount);
  const extrasCents = extraGuests * input.extraGuestPriceCents;
  const fareCents = input.baseCents + extrasCents;
  return { extraGuests, extrasCents, fareCents };
}

// ── Gratuity tiers (DEC-124, 12.3) ───────────────────────────────────────────
/** Default gratuity tiers in basis points (15/20/25%) — mirrors the live Xola config. Per
 *  `Offering` override via `gratuityTiersBps`; required at checkout, no decline. */
export const GRATUITY_TIERS_DEFAULT = [1500, 2000, 2500];
/** Default pre-selected tier (20%). */
export const GRATUITY_DEFAULT_BPS = 2000;

/** Gratuity in cents = `bps` of the (tip-free) fare, rounded half-up. Pure. */
export function gratuityCentsFor(fareCents: number, bps: number): number {
  return Math.round((fareCents * bps) / 10000);
}

/** The gratuity tiers for an offering: its `gratuityTiersBps`, or the default. */
export function gratuityTiersFor(offering: { gratuityTiersBps?: number[] }): number[] {
  return offering.gratuityTiersBps ?? GRATUITY_TIERS_DEFAULT;
}

/** The effective included-guest count for a departure: the OFFERING's `includedGuestCount`
 *  (12.8 — the included count prices the product, not the boat), or the running vessel's
 *  `coiMaxPax` when unset (whole boat included, no extras). Deliberately a two-entity read:
 *  the cap stays a Vessel fact. Centralizes the DEC-112 default. */
export function effectiveIncludedGuests(
  offering: { includedGuestCount?: number },
  vessel: { coiMaxPax: number },
): number {
  return offering.includedGuestCount ?? vessel.coiMaxPax;
}
