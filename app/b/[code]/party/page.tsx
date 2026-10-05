import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { buildPartyView, type PartyView } from "@core/checkin/party.js";
import { stillToSignLine } from "@core/checkin/signing.js";
import { ensureTripLink, tripDayOver, tripLinkUrl } from "@core/checkin/trip-link.js";
import { vesselDateOf } from "@core/config/tenant.js";
import { formatClock, formatShortDay } from "@core/reservations/availability-screen.js";
import { CopyButton } from "../../../../components/ui/copy-button";
import { appBaseUrl } from "../../../lib/base-url";
import { getRepo } from "../../../lib/repo";
import { logSwallowed } from "../../../lib/swallowed";
import { TENANT_NAME } from "../../../lib/tenant";
import { loadBookingByCode } from "../load";

/**
 * /b/<code>/party — the booker's party page (Phase 18.6, issue #1120). Spec:
 * `docs/design/check-in-surfaces.md` §B.
 *
 * **Behind the booking's own code, not the trip link**, because it shows names. It loads through
 * `loadBookingByCode`, so it is guarded exactly as the manage page is; a code that does not open a
 * booking goes to `/b/<code>`, which owns the replaced / expired / not-valid states.
 *
 * Read-only: the booker chases people, she does not administer records. Every signed name, never
 * folded; an obvious duplicate once, "×2", and counted once (`buildPartyView`). **Share the link**
 * copies the departure's trip link (`/w/<code>`), made the first time it is needed — the crew QR
 * page's rule. Reached from **See who’s signed ›** on `/b/[code]` (18.10, issue #1124) and from
 * waiver reminders.
 *
 * The boat is never named to a customer. **Never logs the code**, and is not indexed.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your party",
  robots: { index: false, follow: false },
};

export default async function PartyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const load = await loadBookingByCode(code);
  // `redirect()` throws, so it stays outside every try (house convention).
  if (load.kind !== "ok") redirect(`/b/${encodeURIComponent(code)}`);
  const { reservation, event, vessel } = load.booking;
  const now = new Date();

  const trip = (
    <p className="mb-6 text-sm text-muted">
      Your {TENANT_NAME} trip
      <span className="block text-base font-semibold text-ink">
        {formatShortDay(event.date)} · {formatClock(event.time)}
      </span>
    </p>
  );

  if (reservation.status === "cancelled" || event.status === "cancelled") {
    return (
      <Page>
        {trip}
        <h1 className="mb-2 text-xl font-semibold">This trip was cancelled</h1>
        <p className="text-muted">There’s nobody left to sign for it.</p>
      </Page>
    );
  }

  let view: PartyView;
  try {
    const guests = await getRepo().listGuestsForReservation(reservation.id);
    view = buildPartyView(guests, reservation.partySize, vessel?.coiMaxPax ?? event.capacity, vesselDateOf(now));
  } catch (e) {
    logSwallowed("b/[code]/party", e, "the party page did not load its signers");
    return (
      <Page>
        {trip}
        <h1 className="mb-2 text-xl font-semibold">Something went wrong</h1>
        <p className="text-muted">We couldn’t load who has signed just now. Try again in a moment.</p>
      </Page>
    );
  }

  const sailed = tripDayOver(event.date, now.toISOString());
  const shareUrl = sailed ? null : await shareUrlFor(event.id);
  const { names, coverage } = view;

  return (
    <Page>
      {trip}
      <h1 className="mb-1 text-center font-mono text-3xl font-semibold text-ink" data-testid="party-count">
        {coverage.covered} of {coverage.of} signed
      </h1>
      <p className="mb-6 text-center text-sm text-muted">{stillToSignLine(coverage.remaining)}</p>

      {names.length === 0 ? (
        <p className="rounded-card border border-line bg-card px-4 py-3 text-sm text-muted">Nobody has signed yet.</p>
      ) : (
        // Every name, never "… 10 more" (§B): the booker is looking for who is missing.
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-card border border-line bg-card px-4 py-3" aria-label="Who has signed">
          {names.map((n, i) => (
            <li key={`${n.name}-${i}`} className="min-w-0 break-words text-sm text-ink">
              <span aria-hidden className="text-ok">
                ✓{" "}
              </span>
              {n.name}
              {n.times > 1 && (
                <span className="font-mono text-muted" title="Signed more than once — counted once">
                  {" "}×{n.times}
                </span>
              )}
              {n.age !== undefined && <span className="text-muted"> ({n.age})</span>}
            </li>
          ))}
        </ul>
      )}

      {sailed ? (
        <p className="mt-6 text-center text-sm text-muted">This trip has sailed.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-2 border-t border-line pt-6">
          {shareUrl ? (
            <>
              <CopyButton value={shareUrl} label="Share the link" className="btn-primary min-h-[48px] w-full" />
              <p className="text-center text-xs text-muted">
                Copies the link to send your group: <span className="select-all break-all">{shareUrl}</span>
              </p>
            </>
          ) : (
            <p className="text-center text-sm text-muted">The link to share didn’t load. Reload the page to try again.</p>
          )}
        </div>
      )}
    </Page>
  );
}

/**
 * The departure's trip link, made the first time it is needed (`ensureTripLink`, as the crew QR page
 * does). A failure costs the Share button, never the names.
 */
async function shareUrlFor(eventId: Parameters<typeof ensureTripLink>[1]): Promise<string | null> {
  try {
    const code = await ensureTripLink(getRepo(), eventId, () => new Date().toISOString());
    return tripLinkUrl(appBaseUrl(), code);
  } catch (e) {
    logSwallowed("b/[code]/party:share", e, "the party page had no trip link to share");
    return null;
  }
}

function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-lg px-4 py-10">{children}</main>;
}
