import type { EventManifestView } from "@core/crewapp/shift-card.js";
import { buildIntroText, firstName } from "@core/crewapp/intro-text.js";
import { PICKUP_LOCATION, PICKUP_MAP_URL, TENANT_TIMEZONE } from "@core/config/tenant.js";
import { fmt12, tel, sms } from "../../app/lib/format";
import { TENANT_NAME } from "../../app/lib/tenant";
import { GuestTextButton } from "./guest-text-button";

const mapHref = (q: string) => `https://maps.google.com/?q=${encodeURIComponent(q)}`;

/** "2:14 PM" — a guest-contact instant in vessel-local time (#345, DEC-032). */
const contactedTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TENANT_TIMEZONE,
  });

/**
 * The per-event guest manifest — booked guests, pax, departure, and per-event
 * dock, soonest first. Shared by the crew shift card and the operator cockpit
 * (#319) so both render the same manifest from one assembly (`buildShiftManifest`),
 * never a parallel query. When every event shares a dock the caller renders that
 * dock prominently, so the per-event dock row here is suppressed (`sharedDock`
 * set) — matching the crew card's layout exactly.
 *
 * `senderName` (the viewer's name, #345) makes the guest Text button preload the
 * intro message. Absent → the Text button is a plain (empty) sms, the #319 behavior.
 */
export function ShiftManifest({
  events,
  sharedDock,
  senderName,
  shiftId,
}: {
  events: EventManifestView[];
  // Explicit `| undefined` so a possibly-absent shared dock can be passed straight
  // through under exactOptionalPropertyTypes (crew card + cockpit both do).
  sharedDock?: string | undefined;
  senderName?: string | undefined;
  /** The shift these guests belong to — keys their contact records (#345 Part B). */
  shiftId: string;
}) {
  return (
    <section aria-label="Manifest" className="flex flex-col gap-2">
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
              ev.guests.map((g, i) => (
                // Guest row: name ×party (+ the "✓ texted" mark when someone's
                // contacted them, #345 Part B), then Call/Text buttons when we have a
                // number. The number itself lives in the button hrefs (+ `title`).
                <div
                  key={i}
                  className="flex min-h-[44px] items-start justify-between gap-2 px-4 py-3 text-sm"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-ink">
                      {g.name} <span className="text-muted">×{g.party}</span>
                    </span>
                    {g.contact && (
                      <span className="text-xs text-ok">
                        ✓ Texted by {firstName(g.contact.by)} · {contactedTime(g.contact.at)}
                      </span>
                    )}
                  </span>
                  {g.phone && (
                    <span className="flex shrink-0 gap-1">
                      <a
                        href={tel(g.phone)}
                        title={g.phone}
                        className="inline-flex min-h-9 items-center px-1.5 text-xs font-semibold text-accent"
                      >
                        <span aria-hidden="true">✆&nbsp;</span>Call
                      </a>
                      {/* Client island (#345 Part B): records the tap, then hands off
                          to Messages with the intro preloaded (Part A). No-JS still
                          opens Messages, just unrecorded. */}
                      <GuestTextButton
                        href={sms(
                          g.phone,
                          buildIntroText({
                            senderName,
                            tenantName: TENANT_NAME,
                            departureLabel: fmt12(ev.departureTime),
                            location: PICKUP_LOCATION,
                            mapUrl: PICKUP_MAP_URL,
                          }),
                        )}
                        phone={g.phone}
                        reservationId={g.reservationId}
                        shiftId={shiftId}
                        className="inline-flex min-h-9 items-center px-1.5 text-xs font-semibold text-accent"
                      />
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </details>
      ))}
    </section>
  );
}
