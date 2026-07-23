/**
 * Customer checkout screen (Phase 12.5, #458, DEC-134) — the second designed public booking
 * surface. Consumes the availability screen's Continue link
 * (`?offering=&date=&time=&guests=`), re-derives availability for that exact slot (a stale
 * link renders an honest sold-out notice, not a doomed form), prices it with the SAME pure
 * money functions the charge builder freezes (fare → tax → service fee → tip tiers), and
 * renders the inline-Elements form. Gated behind `RESERVATIONS` (DEC-111).
 *
 * Server-rendered shell + ONE client island (`CheckoutForm`, DEC-133 posture): the form is
 * intrinsically interactive (tip tiles re-total live, the card Element is client-only), so
 * the island owns contact/tip/waiver/card + the sticky pay bar; everything above it —
 * gates, derivation, money — is computed here and passed as plain data (no functions cross
 * the RSC boundary).
 *
 * `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is BUILD-INLINED (the `<VersionTag/>` v0.0.0 trap):
 * absent ⇒ a loud configuration-error state, never a silently-broken Element (DEC-134).
 */
import type { Block, Event, Location, MusterOwnedVesselDay, Offering, Reservation, Vessel } from "@core/domain/entities.js";
import { WAIVER_TERMS_URL, vesselDateOf } from "@core/config/tenant.js";
import { deriveVirtualAvailability } from "@core/reservations/availability.js";
import {
  buildSlotRows,
  formatClock,
  formatDuration,
  formatShortDay,
  guestPricing,
} from "@core/reservations/availability-screen.js";
import {
  GRATUITY_DEFAULT_BPS,
  gratuityCentsFor,
  gratuityKindsFor,
  gratuityTiersFor,
} from "@core/reservations/pricing.js";
import { chargeNowCents, feeCentsFor, taxCentsFor } from "@core/reservations/payment-config.js";
import { AppLink } from "../../../../components/ui/app-link";
import { Notice } from "../../../../components/ui/notice";
import { getRepo } from "../../../lib/repo";
import { CheckoutForm } from "./checkout-form";

export const dynamic = "force-dynamic";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

type Search = { offering?: string; date?: string; time?: string; guests?: string };

function backHref(offering: string | undefined, date: string | undefined): string {
  const q = new URLSearchParams();
  if (offering) q.set("offering", offering);
  if (date) q.set("date", date);
  const s = q.toString();
  return s ? `/book?${s}` : "/book";
}

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Search> }) {
  if (process.env.RESERVATIONS !== "true") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-xl font-semibold">Reservations are off</h1>
        <p className="mt-2 text-muted">
          Set <code>RESERVATIONS=true</code> to enable booking (DEC-111).
        </p>
      </main>
    );
  }

  const sp = await searchParams;
  const guests = Number(sp.guests ?? 0);
  const validParams =
    Boolean(sp.offering) &&
    Boolean(sp.date && ISO_DAY.test(sp.date)) &&
    Boolean(sp.time && HHMM.test(sp.time)) &&
    Number.isInteger(guests) &&
    guests >= 1;
  if (!validParams) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <Notice>
          This checkout link is incomplete.{" "}
          <AppLink href="/book" className="font-semibold text-accent underline">
            Pick a date &amp; time
          </AppLink>{" "}
          to start a booking.
        </Notice>
      </main>
    );
  }

  let offerings: Offering[];
  let vessels: Vessel[];
  let blocks: Block[];
  let ownedRaw: MusterOwnedVesselDay[];
  let events: Event[];
  let reservations: Reservation[];
  let locations: Location[];
  let config: Awaited<ReturnType<ReturnType<typeof getRepo>["getPaymentConfig"]>>;
  try {
    const repo = getRepo();
    [offerings, vessels, blocks, ownedRaw, events, reservations, locations, config] = await Promise.all([
      repo.listOfferings(),
      repo.listVessels(),
      repo.listBlocks(),
      repo.listMusterOwnedVesselDays(),
      repo.listEvents(),
      repo.listAllReservations(),
      repo.listLocations(),
      repo.getPaymentConfig(),
    ]);
  } catch {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <Notice tone="bad">Couldn&rsquo;t load this checkout. Please try again in a moment.</Notice>
      </main>
    );
  }

  const chosen = offerings.find((o) => String(o.id) === sp.offering && o.status === "live");
  if (!chosen) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <Notice>
          That cruise isn&rsquo;t bookable anymore.{" "}
          <AppLink href="/book" className="font-semibold text-accent underline">
            See what&rsquo;s available
          </AppLink>
          .
        </Notice>
      </main>
    );
  }

  // Re-derive availability for the exact slot — a stale link (someone else booked it, a
  // block landed, the day passed) gets an honest notice instead of a doomed form. Same
  // derivation shape as /book (no holds passed — the action's hold is authoritative).
  const today = vesselDateOf(new Date());
  const date = sp.date!;
  const time = sp.time!;
  const slots =
    date >= today
      ? deriveVirtualAvailability({
          offerings: [chosen],
          vessels,
          dateRange: { start: date, end: date },
          ownedDays: ownedRaw.map((o) => ({ vesselId: o.vesselId, date: o.date })),
          blocks,
          events,
          reservations,
        })
      : [];
  const row = buildSlotRows(slots.filter((s) => s.date === date)).find((r) => r.time === time);
  const bookable = row !== undefined && !row.soldOut && guests <= row.capacity;
  if (!bookable) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-xl font-semibold">That departure is no longer available</h1>
        <p className="mt-2 text-muted">
          {formatShortDay(date)} · {formatClock(time)} sold out or went off the schedule while
          you were deciding. Nothing was charged.
        </p>
        <p className="mt-4">
          <AppLink
            href={backHref(sp.offering, date)}
            className="inline-block rounded-[11px] bg-accent px-5 py-3 text-sm font-semibold text-white"
          >
            Pick another time
          </AppLink>
        </p>
      </main>
    );
  }

  // The build-inlined publishable key (DEC-134). Missing ⇒ loud config error, no Element.
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <Notice tone="bad">
          <b>Checkout is not configured.</b> NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set for
          this deployment, so the payment form can&rsquo;t load. No charge is possible until it
          is. (Operators: set it in the host env — it is build-inlined, so a redeploy is
          required.)
        </Notice>
      </main>
    );
  }

  // ── Money (the same pure functions the charge builder freezes — DEC-107/134) ──
  const fare = guestPricing(chosen, row.capacity, row.priceCents, guests);
  const taxCents = taxCentsFor(fare.fareCents, config.taxRateBps);
  const serviceFeeCents = feeCentsFor(fare.fareCents, config.serviceFeeBps);
  // Due now, EXCLUDING tip (the island adds the selected tier's tip on top live).
  const dueNowBeforeTipCents = chargeNowCents(fare.fareCents, taxCents, serviceFeeCents, config);
  const depositMode = config.depositMode === "deposit";
  // The later balance = remaining fare only (tax + fee ride the deposit in full).
  const balanceLaterCents = depositMode ? fare.fareCents + taxCents + serviceFeeCents - dueNowBeforeTipCents : 0;

  // Tip tiers (DEC-124 via the per-kind config): 15/20/25 default, 20% preselected, required.
  const tiersBps = gratuityTiersFor(chosen);
  const defaultBps =
    gratuityKindsFor(chosen).find((k) => k.kind === "pre")?.defaultBps ?? GRATUITY_DEFAULT_BPS;
  const tiers = tiersBps.map((bps) => ({ bps, tipCents: gratuityCentsFor(fare.fareCents, bps) }));
  const selectedDefaultBps = tiersBps.includes(defaultBps) ? defaultBps : tiersBps[0]!;

  const location = locations.find((l) => String(l.id) === String(chosen.locationId));
  const durationLabel = formatDuration(chosen.tripLengthMinutes);
  const dateTimeLabel = `${formatShortDay(date)} · ${formatClock(time)}`;
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

  return (
    <main className="min-h-screen bg-bg px-3 py-6 sm:px-4 sm:py-8">
      <div className="mx-auto flex w-full max-w-[560px] flex-col overflow-hidden rounded-[18px] border border-line bg-card shadow-sm">
        {/* header — same shell as /book */}
        <div className="flex flex-none items-center gap-2.5 border-b border-line px-4 py-3">
          <AppLink
            href={backHref(sp.offering, date)}
            aria-label="Back to date & time"
            className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-line text-muted"
          >
            ‹
          </AppLink>
          <div className="flex min-w-0 flex-col">
            <b className="truncate text-[13.5px] font-semibold">Checkout</b>
            <span className="text-[11.5px] text-muted">Whole boat, one group</span>
          </div>
          <span className="ml-auto flex items-center gap-1.5 text-[11.5px] font-semibold text-ok">🔒 Secure</span>
        </div>

        <div className="flex flex-col overflow-y-auto">
          {/* hero */}
          <div className="border-b border-line bg-gradient-to-br from-accent/10 to-transparent px-[18px] py-4">
            <h1 className="text-[19px] font-semibold tracking-[-0.01em]">{chosen.name}</h1>
            <div className="mt-1 text-[12.5px] text-muted">
              {[location?.name, durationLabel && `${durationLabel} on the water`]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>

          {/* your trip — the picked slot, changeable */}
          <div className="px-[18px] pt-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-faint">Your trip</div>
            <div className="flex items-center gap-2.5 rounded-xl border border-line px-3.5 py-3">
              <span className="flex-1 text-sm">
                <b className="font-semibold">{dateTimeLabel}</b>
                <span className="text-muted"> · {guests} {guests === 1 ? "guest" : "guests"}</span>
              </span>
              <AppLink href={backHref(sp.offering, date)} className="text-xs font-semibold text-accent">
                Change
              </AppLink>
            </div>
          </div>

          <CheckoutForm
            publishableKey={publishableKey}
            returnUrl={`${base}/book/success`}
            slot={{ offeringId: String(chosen.id), date, time, guests }}
            money={{
              fareCents: fare.fareCents,
              baseCents: row.priceCents,
              extraGuests: fare.extraGuests,
              extrasCents: fare.extrasCents,
              extraGuestPriceCents: fare.extraGuestPriceCents,
              includedGuests: fare.included,
              taxCents,
              taxRateBps: config.taxRateBps,
              serviceFeeCents,
              serviceFeeBps: config.serviceFeeBps,
              dueNowBeforeTipCents,
              depositMode,
              balanceLaterCents,
            }}
            tiers={tiers}
            defaultBps={selectedDefaultBps}
            waiverUrl={WAIVER_TERMS_URL}
          />
        </div>
      </div>
    </main>
  );
}
