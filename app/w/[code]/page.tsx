import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { openTripLink, type TripLinkTrip } from "@core/checkin/trip-link.js";
import { limitKeyFor } from "@core/rate-limit/rate-limit.js";
import { formatClock, formatShortDay } from "@core/reservations/availability-screen.js";
import { clientIpFrom } from "../../lib/client-ip";
import { getRepo } from "../../lib/repo";
import { logSwallowed } from "../../lib/swallowed";
import { TENANT_NAME } from "../../lib/tenant";

/**
 * /w/<code> — a departure's trip link (Phase 18.3b, issue #1141, DEC-190). The page the booker's
 * shared link and the dock QR open. States per `docs/design/check-in-surfaces.md` §A5.
 *
 * **Limited first, then resolved** (`openTripLink`): over the limit nothing is looked up, so a guess
 * and a real code get the same answer. Throttled never reads "we can't find that trip" — a real
 * guest would conclude their link is broken.
 *
 * The signing form behind an open link is 18.4's; until then an open trip says so. The boat is never
 * named to a customer (the manage page's rule). No operator phone yet: Muster stores none
 * (issue #1140).
 *
 * **Never logs the code**, and is not indexed: the code in the path is the whole credential.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your trip",
  robots: { index: false, follow: false },
};

export default async function TripLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  let view: Awaited<ReturnType<typeof openTripLink>>;
  try {
    view = await openTripLink(
      {
        repo: getRepo(),
        now: () => new Date().toISOString(),
        onFailure: (m) => console.error(`trip-link: ${m}`),
      },
      code,
      limitKeyFor(clientIpFrom(await headers())),
    );
  } catch (e) {
    logSwallowed("w/[code]", e, "a trip link did not resolve");
    return (
      <Page>
        <h1 className="mb-2 text-xl font-semibold">Something went wrong</h1>
        <p className="text-muted">We couldn’t open this trip just now. Try again in a moment.</p>
      </Page>
    );
  }

  switch (view.state) {
    case "throttled":
      return (
        <Page>
          <h1 className="mb-2 text-xl font-semibold">One moment</h1>
          <p className="text-muted">
            Lots of people are signing from this connection right now. Try again in a minute.
          </p>
          <div className="mt-5 flex justify-center">
            {/* A plain link to this same page: reloading is the retry, and it works with no JS. */}
            <a href={`/w/${encodeURIComponent(code)}`} className="btn-primary inline-flex min-h-[44px] items-center">
              Try again
            </a>
          </div>
        </Page>
      );
    case "not_found":
      return (
        <Page>
          <h1 className="mb-2 text-xl font-semibold">We can’t find that trip</h1>
          <p className="text-muted">
            The link may be incomplete or mistyped. Check the text or email it came in, or ask the
            person who booked to send it again.
          </p>
        </Page>
      );
    case "departed":
      return (
        <Page trip={view.trip}>
          <h1 className="mb-2 text-xl font-semibold">This trip has already sailed</h1>
          <p className="text-muted">Waivers for this trip are closed.</p>
        </Page>
      );
    case "cancelled":
      return (
        <Page trip={view.trip}>
          <h1 className="mb-2 text-xl font-semibold">This trip was cancelled</h1>
          <p className="text-muted">There’s nothing to sign for it.</p>
        </Page>
      );
    case "open":
      return (
        <Page trip={view.trip}>
          <h1 className="mb-2 text-xl font-semibold">Waiver signing opens here soon</h1>
          <p className="text-muted">Keep this link — it’s where everyone on this trip will sign.</p>
        </Page>
      );
  }
}

function Page({ trip, children }: { trip?: TripLinkTrip; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <p className="mb-6 text-sm text-muted">
        {TENANT_NAME}
        {trip && (
          <>
            {" · "}
            <span className="text-ink">
              {formatShortDay(trip.date)} · {formatClock(trip.time)}
            </span>
          </>
        )}
      </p>
      {children}
    </main>
  );
}
