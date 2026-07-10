import { BackLink } from "../../../../../components/ui/back-link";
import { buildShiftCard, type ShiftCardView } from "@core/crewapp/shift-card.js";
import { ShiftManifest } from "../../../../../components/assignment/shift-manifest";
import { asId } from "@core/domain/ids.js";
import { Notice } from "../../../../../components/ui/notice";
import { RoleGlyph } from "../../../../../components/ui/role-glyph";
import { Shell } from "../../../../../components/ui/shell";
import { SubmitButton } from "../../../../../components/ui/submit-button";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";
import { fmt12, tel, sms } from "../../../../lib/format";
import { bailFromSeat } from "./actions";
import { startDm } from "../../threads/actions";

/**
 * Shift card (SPEC §2.6.3) — the single source of truth a crew member reads on
 * the dock: call time vs departure (the #1 confusion, shown distinct + labeled),
 * the per-event guest manifest (the hinge that ends the Xola split), the dock as
 * a tappable map pin, pax, and one-tap co-crew contact. "Can't make it" (#56)
 * lives at the bottom behind a deliberate confirm step — neutral voice, no
 * guilt-trip; lateness is the signal (DEC-028), not the bail itself.
 *
 * Server component, session-gated; `buildShiftCard` returns null unless the
 * viewer is confirmed crew on this shift (no peeking at others' cards). The
 * live-changed indicator is a deferred follow-up.
 */

/** Bail-error params carry codes only (DEC-026) — mapped to copy here. */
const BAIL_ERROR_COPY: Record<string, string> = {
  stale: "This card changed under you — what you see now is current. Check it before acting.",
  unavailable: "Couldn’t reach the schedule — nothing was changed. Try again.",
  trainee_seat:
    "You’re riding this shift as a trainee — ask the office to take you off; no penalty.",
};
const mapHref = (q: string) => `https://maps.google.com/?q=${encodeURIComponent(q)}`;

function fmtDate(iso: string): string {
  // Date-only label: parse + format in UTC so the stored vessel-local date shows
  // verbatim regardless of server zone (DEC-032).
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function ShiftCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ shiftId: string }>;
  searchParams: Promise<{ bail_error?: string }>;
}) {
  const { shiftId } = await params;
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") {
    return (
      <Shell>
        <Notice>You’re signed out. Tap the link your operator sent.</Notice>
      </Shell>
    );
  }

  let card: ShiftCardView | null;
  try {
    card = await buildShiftCard(
      getRepo(),
      asId<"ShiftId">(shiftId),
      asId<"CrewMemberId">(subject.id),
      new Date(),
    );
  } catch {
    return (
      <Shell>
        <Notice>Can’t reach the schedule right now. Try again in a moment.</Notice>
      </Shell>
    );
  }
  if (!card) {
    return (
      <Shell>
        <BackLink href="/crew">Shifts</BackLink>
        <Notice>That shift isn’t on your list.</Notice>
      </Shell>
    );
  }

  const bailError = sp.bail_error ? BAIL_ERROR_COPY[sp.bail_error] ?? null : null;
  return <Card card={card} shiftId={shiftId} bailError={bailError} />;
}

/** Standalone dock pin (the shared-dock case) — prominent, above the manifest. */
function DockPin({ dock }: { dock: string }) {
  return (
    <a
      href={mapHref(dock)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-[44px] items-center justify-between rounded-card border border-line bg-card px-4 py-3 text-sm"
    >
      <span className="text-ink">
        <span aria-hidden>📍</span> {dock}
      </span>
      <span className="font-semibold text-accent">Map ›</span>
    </a>
  );
}

function Card({
  card,
  shiftId,
  bailError,
}: {
  card: ShiftCardView;
  shiftId: string;
  bailError: string | null;
}) {
  const firstDeparture = card.events[0]?.departureTime;
  return (
    <Shell>
      <BackLink href="/crew">Shifts</BackLink>
      {bailError && <Notice tone="bad">{bailError}</Notice>}

      <header className="flex flex-col">
        <span className="text-sm text-muted">{fmtDate(card.date)}</span>
        <h1 className="text-2xl font-semibold text-ink">{card.vesselName}</h1>
        <span className="text-sm text-muted">
          {card.viewerRole} · {card.paxTotal} guests
        </span>
      </header>

      {/* The load-bearing distinction: shift start (call/report time, = first
          departure − the lead) vs the first departure itself, distinct + labeled. */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-card border border-ok-line bg-ok-bg px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-ok">
            Shift Start
          </div>
          <div className="font-mono text-2xl font-semibold text-ink">
            {card.callTime ? fmt12(card.callTime) : "—"}
          </div>
        </div>
        <div className="rounded-card border border-line bg-card px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            First departure
          </div>
          <div className="font-mono text-2xl font-semibold text-ink">
            {firstDeparture ? fmt12(firstDeparture) : "—"}
          </div>
        </div>
        {/* The other end of the commitment (DEC-041): last trip + trip length +
            teardown. Spans both columns under the start/departure pair so "when
            am I free" sits with "when do I report". */}
        <div className="col-span-2 rounded-card border border-line bg-card px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Shift End <span className="font-normal normal-case text-muted">· off the clock</span>
          </div>
          <div className="font-mono text-2xl font-semibold text-ink">
            {card.shiftEndTime ? fmt12(card.shiftEndTime) : "—"}
          </div>
        </div>
      </div>

      {card.events.length === 0 && <Notice>No departures scheduled yet.</Notice>}
      {card.sharedDock && <DockPin dock={card.sharedDock} />}

      {card.coCrew.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Crewing with you
          </h2>
          {card.coCrew.map((c) => (
            <div
              key={c.crewMemberId}
              className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-3"
            >
              {/* Role glyph (DEC-086, aria-hidden) + name + role — who's running the
                  boat at a glance. Name/role take their own row above the actions so
                  the three contact buttons never squeeze the name at 375px; truncate
                  is the safety net for an unusually long name. */}
              <span className="flex min-w-0 items-center gap-2">
                <RoleGlyph roleName={c.role} />
                <span className="truncate font-semibold text-ink">{c.name}</span>
                <span className="shrink-0 text-xs capitalize text-muted">· {c.role}</span>
              </span>
              {/* Call/Text expose the phone (SPEC §2.6.3); Message is the in-app DM
                  — the §6 number-privacy channel, additive, not a replacement. */}
              <span className="flex flex-wrap items-center gap-2">
                <a
                  href={tel(c.phone)}
                  className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-bg px-3 font-semibold text-accent"
                  aria-label={`Call ${c.name}`}
                >
                  Call
                </a>
                <a
                  href={sms(c.phone)}
                  className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-bg px-3 font-semibold text-accent"
                  aria-label={`Text ${c.name}`}
                >
                  Text
                </a>
                <form action={startDm} className="inline-flex">
                  <input type="hidden" name="crewMemberId" value={c.crewMemberId} />
                  <SubmitButton
                    className="inline-flex min-h-[44px] items-center rounded-card border border-accent bg-accent px-3 font-semibold text-white"
                    aria-label={`Message ${c.name}`}
                  >
                    Message
                  </SubmitButton>
                </form>
              </span>
            </div>
          ))}
        </section>
      )}

      <ShiftManifest events={card.events} sharedDock={card.sharedDock} />

      {/* A trainee ride (DEC-087) has no bail: it's not a reliability
          commitment, and the seat must never re-ask — the office unstaffs. */}
      {card.traineeSeat ? (
        <p className="rounded-card border border-line bg-card px-4 py-3 text-sm text-muted">
          You’re riding this shift as a trainee. Can’t make it? Tell the office
          and they’ll take you off — no penalty.
        </p>
      ) : (
      <details className="rounded-card border border-line bg-card px-4 pb-3">
        {/* The summary owns the 44px hit area (clicks on details padding don't
            toggle); marker kept deliberately — the "…" + triangle reads as
            "more here" without borrowing the manifest's chevron idiom. */}
        <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-semibold text-muted">
          I can’t make it…
        </summary>
        <p className="pb-2 text-sm text-muted">
          {card.bailLate
            ? "This shift is soon — dropping now may not leave time to refill it. We’ll still try, but call your operator right away so they can react."
            : "This gives up your spot on a shift you confirmed. The sooner you tell us, the easier it is to refill — so if you can’t make it, drop it now."}
        </p>
        {/* Confirm gate (#271): the drop is destructive AND logs a bail on the
            crew member's reliability record (DEC-028), so it sits behind one more
            deliberate tap — the button reveals the confirm rather than dropping.
            No-JS: a nested <details>, same posture as the claim confirm (DEC-077). */}
        <details className="rounded-card border border-bad-line bg-bad-bg">
          <summary className="flex min-h-[44px] cursor-pointer items-center justify-center px-4 text-sm font-semibold text-bad [&::-webkit-details-marker]:hidden">
            Drop this shift
          </summary>
          <div className="flex flex-col gap-2 border-t border-bad-line px-4 py-3">
            <p className="text-sm text-muted">
              This gives up your shift — sure you can’t make it?
            </p>
            <form action={bailFromSeat}>
              <input type="hidden" name="seatId" value={card.mySeatId} />
              <input type="hidden" name="shiftId" value={shiftId} />
              <SubmitButton className="min-h-[44px] w-full rounded-card border border-bad-line bg-bad px-4 font-semibold text-white">
                Yes, drop this shift
              </SubmitButton>
            </form>
          </div>
        </details>
      </details>
      )}
    </Shell>
  );
}
