import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { vesselDateOf } from "@core/config/tenant.js";
import { peopleSigned } from "@core/checkin/duplicates.js";
import { groupCoverage, loadSigningScene, MAX_CHILDREN, partyChoices, partyFor } from "@core/checkin/signing.js";
import { normalizeTripCode, openTripLink, tripLinkUrl, type TripLinkTrip } from "@core/checkin/trip-link.js";
import { limitKeyFor } from "@core/rate-limit/rate-limit.js";
import { formatClock, formatShortDay } from "@core/reservations/availability-screen.js";
import { appBaseUrl } from "../../lib/base-url";
import { clientIpFrom } from "../../lib/client-ip";
import { errCopyFor } from "../../lib/err-copy";
import { readFormDraft } from "../../lib/form-draft";
import { getRepo } from "../../lib/repo";
import { logSwallowed } from "../../lib/swallowed";
import { TENANT_NAME } from "../../lib/tenant";
import type { SignErr } from "./actions";
import { SigningFormView } from "./signing-form";
import { PartyStep, SuccessView } from "./signing-steps";

/**
 * /w/<code> — a departure's trip link, and the waiver signing page behind it (Phase 18.3b, issue
 * #1141; Phase 18.4, issue #1118). Spec: `docs/design/check-in-surfaces.md` §A.
 *
 * **Limited first, then resolved** (`openTripLink`): over the limit nothing is looked up, so a guess
 * and a real code get the same answer. Throttled never reads "we can't find that trip".
 *
 * An open trip opens on the form: the guest's details, a card per child they add, and the agreement,
 * on one page → the success screen. Only a departure with more than one booking asks first which
 * party they are with; that step is links, and the pick rides the URL (`party`), so the page works
 * with no client JS (DEC-147).
 *
 * The boat is never named to a customer (the manage page's rule). No operator phone yet: Muster
 * stores none (issue #1140). **Never logs the code**, and is not indexed.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your trip",
  robots: { index: false, follow: false },
};

type Search = { party?: string; err?: string; signed?: string; restore?: string };

export default async function TripLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Search>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const now = new Date().toISOString();

  let view: Awaited<ReturnType<typeof openTripLink>>;
  try {
    view = await openTripLink(
      { repo: getRepo(), now: () => now, onFailure: (m) => console.error(`trip-link: ${m}`) },
      code,
      limitKeyFor(clientIpFrom(await headers())),
    );
  } catch (e) {
    logSwallowed("w/[code]", e, "a trip link did not resolve");
    return <SomethingWrong />;
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
      try {
        return <Page trip={view.trip}>{await openTrip(view.trip, code, sp, now)}</Page>;
      } catch (e) {
        logSwallowed("w/[code]:open", e, "the signing page did not load");
        return <SomethingWrong />;
      }
  }
}

/** The signing flow for an open trip — which step the URL asks for. */
async function openTrip(trip: TripLinkTrip, rawCode: string, sp: Search, now: string): Promise<ReactNode> {
  // `openTripLink` resolved this code, so it normalizes; links are built from the canonical form.
  const code = normalizeTripCode(rawCode)!;
  const repo = getRepo();
  const scene = await loadSigningScene(repo, trip.eventId, now);

  // The success screen — after a signing, before anything else. A `signed` id that is not this
  // trip's signer reads as no id: a fresh form.
  if (sp.signed) {
    const signer = (await repo.listGuestsForEvent(trip.eventId)).find((g) => g.id === sp.signed && g.signedAt);
    if (signer) {
      const booking = scene.reservations.find((r) => r.id === signer.reservationId);
      const coverage = booking
        ? groupCoverage(booking.partySize, peopleSigned(await repo.listGuestsForReservation(booking.id)), scene.coiMaxPax)
        : null;
      return (
        <SuccessView
          firstName={signer.name.split(" ")[0] ?? signer.name}
          coverage={coverage}
          shareUrl={tripLinkUrl(appBaseUrl(), code)}
          code={code}
        />
      );
    }
  }

  if (!scene.template) {
    return (
      <>
        <h1 className="mb-2 text-xl font-semibold">Waivers aren’t open for this trip yet</h1>
        <p className="text-muted">Check back closer to your trip.</p>
      </>
    );
  }

  // The party step shows when the departure has several bookings and none is chosen yet, or when
  // the one chosen was cancelled mid-form (then their details wait in the draft).
  const booking = partyFor(scene.reservations, sp.party);
  if (booking === "choose") {
    return (
      <PartyStep
        code={code}
        parties={partyChoices(scene.reservations).map((p) => ({ ...p, reservationId: String(p.reservationId) }))}
        refused={sp.err === "bad_party"}
      />
    );
  }

  // Refill from the draft after a refusal, after picking again from a refused party, or after
  // "+ Add a minor" or Remove without JS (both `restore`).
  const draft = sp.err || sp.restore === "1" ? await readFormDraft(`/w/${code}`) : null;
  return (
    <SigningFormView
      code={code}
      // Carried on the form only when the guest actually picked one; a private charter needs none.
      party={sp.party}
      template={scene.template}
      ageOfMajority={scene.ageOfMajority}
      today={vesselDateOf(new Date(now))}
      draft={draft}
      error={errCopyFor(errorCopy(scene.ageOfMajority), sp.err, "error")}
    />
  );
}

/** What each refusal says, in the guest's words. Keyed to the action's codes, so a code with
 *  nothing to say is a build error (#654). */
function errorCopy(age: number): Record<SignErr, string> {
  return {
    no_waiver: "Waivers aren’t open for this trip yet.",
    waiver_changed: "The waiver was just updated. Read it again below, then tick the box and tap Sign.",
    bad_party: "Pick who you’re here with.",
    bad_kids_count: `One signature covers up to ${MAX_CHILDREN} minors.`,
    bad_name: "Enter your full legal name.",
    legal_name_unconfirmed: "Tick the box to confirm this is your full legal name.",
    bad_dob: "Pick your full date of birth — month, day and year.",
    adult_too_young: `You need to be ${age} or older to sign. A parent or guardian signs for you.`,
    bad_email: "Enter an email address we can reach you at.",
    bad_phone: "That phone number doesn’t look right. Fix it, or leave it blank.",
    bad_child_name: "Enter each minor’s full name.",
    bad_child_dob: "Pick each minor’s full date of birth.",
    child_too_old: `Each minor must be under ${age}. Anyone ${age} or older signs for themselves.`,
    consent_required: "Tick the box to agree to sign electronically.",
    throttled: "Lots of people are signing from this connection right now. Wait a minute, then tap Sign again.",
    error: "Something went wrong saving that. Tap Sign again.",
  };
}

function SomethingWrong() {
  return (
    <Page>
      <h1 className="mb-2 text-xl font-semibold">Something went wrong</h1>
      <p className="text-muted">We couldn’t open this trip just now. Try again in a moment.</p>
    </Page>
  );
}

function Page({ trip, children }: { trip?: TripLinkTrip; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
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
