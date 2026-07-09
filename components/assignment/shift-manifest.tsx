import type { EventManifestView } from "@core/crewapp/shift-card.js";
import { fmt12 } from "../../app/lib/format";

const tel = (p: string) => `tel:${p.replace(/[^0-9+]/g, "")}`;
const mapHref = (q: string) => `https://maps.google.com/?q=${encodeURIComponent(q)}`;

/**
 * The per-event guest manifest — booked guests, pax, departure, and per-event
 * dock, soonest first. Shared by the crew shift card and the operator cockpit
 * (#319) so both render the same manifest from one assembly (`buildShiftManifest`),
 * never a parallel query. When every event shares a dock the caller renders that
 * dock prominently, so the per-event dock row here is suppressed (`sharedDock`
 * set) — matching the crew card's layout exactly.
 */
export function ShiftManifest({
  events,
  sharedDock,
}: {
  events: EventManifestView[];
  // Explicit `| undefined` so a possibly-absent shared dock can be passed straight
  // through under exactOptionalPropertyTypes (crew card + cockpit both do).
  sharedDock?: string | undefined;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
        Manifest{" "}
        <span className="font-normal normal-case text-muted">
          · different guests each trip
        </span>
      </h2>
      {events.map((ev) => (
        <details
          key={ev.eventId}
          className="group overflow-hidden rounded-card border border-line bg-card"
          open={events.length === 1}
        >
          <summary className="flex min-h-[44px] cursor-pointer items-center justify-between px-4 py-3 font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span className="font-mono">{fmt12(ev.departureTime)}</span>
            <span className="flex items-center gap-2 text-sm font-normal text-muted">
              {ev.pax} guests
              <span className="text-faint transition-transform group-open:rotate-90" aria-hidden>
                ›
              </span>
            </span>
          </summary>
          {!sharedDock && ev.dock && (
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
  );
}
