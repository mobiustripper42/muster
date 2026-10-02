import { redirect } from "next/navigation";
import { buildCheckInScreen, checkInTrip } from "@core/checkin/check-in.js";
import { TENANT_TIMEZONE, vesselDateOf } from "@core/config/tenant.js";
import { asId } from "@core/domain/ids.js";
import { CrewHeader } from "../../../../../../../components/crew/crew-header";
import { Notice } from "../../../../../../../components/ui/notice";
import { Shell } from "../../../../../../../components/ui/shell";
import { readSubject } from "../../../../../../lib/auth";
import { errCopyFor } from "../../../../../../lib/err-copy";
import { fmt12 } from "../../../../../../lib/format";
import { getRepo } from "../../../../../../lib/repo";
import { CREW_UNAVAILABLE, logSwallowed } from "../../../../../../lib/swallowed";
import type { CheckInErr } from "./actions";
import { CheckInList } from "./check-in-list";
import { PassengerCount } from "./passenger-count";

/**
 * Crew check-in for one departure (Phase 18.5a, issue #1119) — reached from the **Check in** button
 * in that departure's row on the shift card. Spec: `docs/design/check-in-surfaces.md` §C.
 *
 * The list that empties (who boarded) and the passenger count (how many) are independent on
 * purpose (spec §3): the count covers people the list cannot, and a guest can sign and never come.
 * Neither blocks departure (§8), and nothing here turns read-only after the trip — the captain's
 * official log is the record that locks (operator, 2026-10-02).
 *
 * Only confirmed crew on the shift, for a departure on it (`checkInTrip`). New signers show up on a
 * reload; re-reading on its own is 18.5b.
 */

export const dynamic = "force-dynamic";

/** Codes only in `?err=` (DEC-147); copy here. None names the boat's limit (§4a). */
const ERR_COPY: Record<CheckInErr, string> = {
  full: "That one didn’t save — the list changed on another phone. Here it is now.",
  not_found: "That guest isn’t on this trip’s list any more.",
  bad_count: "Enter how many people are aboard.",
  error: "That didn’t save. Try again.",
};

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "2:58 PM" on the boat's clock. */
function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TENANT_TIMEZONE });
}

export default async function CheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ shiftId: string; eventId: string }>;
  searchParams: Promise<{ err?: string }>;
}) {
  const { shiftId, eventId } = await params;
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew"); // /crew owns the login UI
  const back = { href: `/crew/shift/${encodeURIComponent(shiftId)}`, label: "Shift" };

  let view;
  try {
    const repo = getRepo();
    const trip = await checkInTrip(repo, asId<"ShiftId">(shiftId), asId<"EventId">(eventId), asId<"CrewMemberId">(subject.id));
    if (trip) {
      const [guests, count] = await Promise.all([repo.listGuestsForEvent(trip.eventId), repo.getDepartureCount(trip.eventId)]);
      const counter = count ? await repo.getCrewMember(count.countedBy) : null;
      view = {
        trip,
        count,
        counterName: counter?.name ?? "crew",
        screen: buildCheckInScreen(guests, trip.limit, count, vesselDateOf(new Date())),
      };
    } else {
      view = null;
    }
  } catch (e) {
    logSwallowed("crew/check-in", e, "the check-in page did not load");
    return (
      <Shell>
        <CrewHeader title="Check in" back={back} />
        <Notice>{CREW_UNAVAILABLE}</Notice>
      </Shell>
    );
  }

  if (!view) {
    return (
      <Shell>
        <CrewHeader title="Check in" back={back} />
        <Notice>That trip isn’t on your list.</Notice>
      </Shell>
    );
  }

  const { trip, count, counterName, screen } = view;
  const error = errCopyFor(ERR_COPY, sp.err, "error");
  return (
    <Shell>
      <CrewHeader title="Check in" back={back} />
      {/* Every screen states its trip — boat · date · time (cross-cutting rules). */}
      <p className="-mt-2 text-center text-sm text-muted">
        {trip.vesselName} · {fmtDate(trip.date)} · {fmt12(trip.time)}
      </p>
      {error && <Notice tone="bad">{error}</Notice>}

      <CheckInList
        shiftId={shiftId}
        eventId={String(trip.eventId)}
        rows={screen.rows}
        limit={screen.limit}
        signed={screen.signed}
      />

      <section className="flex flex-col gap-2">
        {count && (
          <p className="rounded-card border border-ok-line bg-ok-bg px-4 py-3 text-sm font-semibold text-ok">
            ✓ {Math.min(count.pax, screen.limit)} aboard · counted {clockOf(count.countedAt)} by {counterName}
          </p>
        )}
        <PassengerCount
          shiftId={shiftId}
          eventId={String(trip.eventId)}
          start={screen.startingCount}
          limit={screen.limit}
          counted={count !== null}
        />
      </section>
    </Shell>
  );
}
