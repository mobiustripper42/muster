import Link from "next/link";
import { buildShiftCard, type ShiftCardView } from "@core/crewapp/shift-card.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";

/**
 * Shift card (SPEC §2.6.3) — the single source of truth a crew member reads on
 * the dock: call time vs departure (the #1 confusion, shown distinct + labeled),
 * the per-event guest manifest (the hinge that ends the Xola split), the dock as
 * a tappable map pin, pax, and one-tap co-crew contact.
 *
 * Server component, session-gated; `buildShiftCard` returns null unless the
 * viewer is confirmed crew on this shift (no peeking at others' cards). Bail,
 * credential nudge, and the live-changed indicator are deferred follow-ups.
 */
const tel = (p: string) => `tel:${p.replace(/[^0-9+]/g, "")}`;
const sms = (p: string) => `sms:${p.replace(/[^0-9+]/g, "")}`;
const mapHref = (q: string) => `https://maps.google.com/?q=${encodeURIComponent(q)}`;

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default async function ShiftCardPage({
  params,
}: {
  params: Promise<{ shiftId: string }>;
}) {
  const { shiftId } = await params;
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
        <BackLink />
        <Notice>That shift isn’t on your list.</Notice>
      </Shell>
    );
  }

  return <Card card={card} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-4 py-6">
      {children}
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-card px-4 py-3 text-sm text-muted">
      {children}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/crew" className="text-sm font-semibold text-accent">
      ‹ Shifts
    </Link>
  );
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

function Card({ card }: { card: ShiftCardView }) {
  const firstDeparture = card.events[0]?.departureTime;
  return (
    <Shell>
      <BackLink />

      <header className="flex flex-col">
        <span className="text-sm text-muted">{fmtDate(card.date)}</span>
        <h1 className="text-2xl font-semibold text-ink">{card.vesselName}</h1>
        <span className="text-sm text-muted">
          {card.viewerRole} · {card.paxTotal} guests
        </span>
      </header>

      {/* The load-bearing distinction: call time vs departure, distinct + labeled. */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-card border border-ok-line bg-ok-bg px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-ok">
            Be there (call)
          </div>
          <div className="font-mono text-2xl font-semibold text-ink">
            {card.callTime ?? "—"}
          </div>
        </div>
        <div className="rounded-card border border-line bg-card px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            First departure
          </div>
          <div className="font-mono text-2xl font-semibold text-ink">
            {firstDeparture ?? "—"}
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
              className="flex items-center justify-between rounded-card border border-line bg-card px-4 py-3"
            >
              <span className="font-semibold text-ink">{c.name}</span>
              <span className="flex gap-2">
                <a
                  href={tel(c.phone)}
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-line bg-bg px-4 font-semibold text-accent"
                  aria-label={`Call ${c.name}`}
                >
                  Call
                </a>
                <a
                  href={sms(c.phone)}
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-line bg-bg px-4 font-semibold text-accent"
                  aria-label={`Text ${c.name}`}
                >
                  Text
                </a>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Manifest{" "}
          <span className="font-normal normal-case text-faint">
            · different guests each trip
          </span>
        </h2>
        {card.events.map((ev) => (
          <details
            key={ev.eventId}
            className="group overflow-hidden rounded-card border border-line bg-card"
            open={card.events.length === 1}
          >
            <summary className="flex min-h-[44px] cursor-pointer items-center justify-between px-4 py-3 font-semibold text-ink [&::-webkit-details-marker]:hidden">
              <span className="font-mono">{ev.departureTime}</span>
              <span className="flex items-center gap-2 text-sm font-normal text-muted">
                {ev.pax} guests
                <span className="text-faint transition-transform group-open:rotate-90" aria-hidden>
                  ›
                </span>
              </span>
            </summary>
            {!card.sharedDock && ev.dock && (
              <a
                href={mapHref(ev.dock)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[44px] items-center justify-between border-t border-line px-4 py-3 text-sm"
              >
                <span className="text-ink">
                  <span aria-hidden>📍</span> {ev.dock}
                </span>
                <span className="font-semibold text-accent">Map ›</span>
              </a>
            )}
            <div className="border-t border-line">
              {ev.guests.length === 0 ? (
                <div className="px-4 py-3 text-sm text-muted">No guests booked.</div>
              ) : (
                ev.guests.map((g, i) =>
                  g.phone ? (
                    <a
                      key={i}
                      href={tel(g.phone)}
                      className="flex min-h-[44px] items-center justify-between px-4 py-3 text-sm"
                    >
                      <span className="text-ink">
                        {g.name} <span className="text-muted">×{g.party}</span>
                      </span>
                      <span className="font-mono text-accent">{g.phone}</span>
                    </a>
                  ) : (
                    <div
                      key={i}
                      className="flex min-h-[44px] items-center justify-between px-4 py-3 text-sm"
                    >
                      <span className="text-ink">
                        {g.name} <span className="text-muted">×{g.party}</span>
                      </span>
                    </div>
                  ),
                )
              )}
            </div>
          </details>
        ))}
      </section>
    </Shell>
  );
}
