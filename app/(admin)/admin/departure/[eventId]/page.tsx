import type { ReactNode } from "react";
import { loadDepartureView, type DeparturePerson, type DepartureView } from "@core/checkin/departure.js";
import { asId } from "@core/domain/ids.js";
import { AdminSignedOut } from "../../../../../components/admin/admin-signed-out";
import { WaiverVersionDisclosure } from "../../../../../components/admin/waiver-version";
import { AppLink } from "../../../../../components/ui/app-link";
import { Notice } from "../../../../../components/ui/notice";
import { Shell } from "../../../../../components/ui/shell";
import { VersionTag } from "../../../../../components/ui/version-tag";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";
import { ADMIN_LOG_HINT, logSwallowed } from "../../../../lib/swallowed";

/**
 * /admin/departure/[eventId] (Phase 18.8, issue #1122) — one departure's waivers, check-in and
 * count. Spec on the issue; `docs/design/check-in-and-waivers.md` §8, §10.
 *
 * Two ways in (operator, 2026-10-04): **See waivers ›** on the calendar's booking pane, and a
 * flagged departure on `/admin/integrity`. The second use is a claim: someone from a past cruise,
 * and what they signed. So every signer is listed with their signing's evidence, and the exact
 * words of each waiver version signed on this trip are one tap away.
 *
 * Read only, and nothing here blocks departure (spec §8). Zero client JS: disclosures are native
 * `<details>`.
 */

export const dynamic = "force-dynamic";

/** Decode a path segment, tolerating a malformed `%`. Muster's departure ids carry `|` and `:`,
 *  which arrive encoded (the 5:30 PM check-in bug, 18.5c). */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
    // NOT a fault (#854): `segment` is a URL a person can type, and a stray `%` is bad input with a
    // defined answer — it then matches no departure.
    // eslint-disable-next-line no-restricted-syntax -- malformed URL input, not a fault
  } catch {
    return segment;
  }
}

export default async function DeparturePage({ params }: { params: Promise<{ eventId: string }> }) {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;
  const eventId = safeDecode((await params).eventId);

  let view: DepartureView | null;
  try {
    view = await loadDepartureView(getRepo(), asId<"EventId">(eventId));
  } catch (e) {
    logSwallowed("admin/departure", e, `the departure page did not load for ${eventId}`);
    return (
      <Shell width="3xl">
        <Notice>Couldn’t load this departure right now. {ADMIN_LOG_HINT}</Notice>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell width="3xl">
        <Notice>That departure isn’t in Muster.</Notice>
      </Shell>
    );
  }

  return (
    <Shell width="3xl">
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <p className="text-xs text-muted">Departure</p>
          <h1 className="text-[22px] font-semibold leading-tight text-ink">{view.heading}</h1>
          {view.cruise && <p className="text-sm text-muted">{view.cruise}</p>}
          {view.bookings.length > 0 && (
            <p className="text-sm text-muted">
              Booked by{" "}
              {view.bookings.map((b, i) => (
                <span key={b.href}>
                  {i > 0 && ", "}
                  <AppLink href={b.href} className="btn-quiet">
                    {b.name} ↗
                  </AppLink>
                  {b.cancelled && " (cancelled)"}
                </span>
              ))}
            </p>
          )}
        </header>

        <Card title="Check-in">
          <p data-testid="count-line" className="text-sm text-ink">
            {view.countLine}
          </p>
          <p data-testid="numbers-line" className="text-sm text-ink">
            {view.numbersLine}
          </p>
        </Card>

        {view.warning && (
          <div data-testid="departure-warning">
            <Notice tone="warn">{view.warning}</Notice>
          </div>
        )}

        <Card title="Signed">
          {view.people.length === 0 ? (
            <p className="py-2 text-sm text-muted">Nobody has signed for this trip yet.</p>
          ) : (
            <ul aria-label="Signed" className="flex flex-col divide-y divide-line">
              {view.people.map((p) => (
                <PersonRow key={p.key} p={p} />
              ))}
            </ul>
          )}
        </Card>

        {view.versions.length > 0 && (
          <Card title="Waiver text">
            <ul className="flex flex-col divide-y divide-line">
              {view.versions.map((v) => (
                <li key={v.id} className="py-2">
                  <WaiverVersionDisclosure
                    summary={v.label}
                    version={v.version}
                    body={v.body}
                    meta="The words these guests accepted, exactly as posted."
                  />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <VersionTag />
    </Shell>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-card border border-line bg-card shadow-sm">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      <div className="flex flex-col gap-1 px-4 py-3">{children}</div>
    </section>
  );
}

/** One person: name, when they signed, whether they were checked in, and the evidence behind it. */
function PersonRow({ p }: { p: DeparturePerson }) {
  return (
    <li className="flex flex-col gap-0.5 py-3">
      <p className="text-sm font-medium text-ink">
        {p.name}
        {p.times > 1 && <span className="text-muted"> ×{p.times}</span>}
        {p.detail && <span className="font-normal text-muted"> {p.detail}</span>}
      </p>
      <p className="text-xs text-muted">{p.signedLine}</p>
      <p className={`text-xs ${p.checkedIn ? "text-ok" : "text-muted"}`}>{p.checkedInLine}</p>
      <details className="group mt-1">
        <summary className="flex min-h-[44px] items-center gap-1.5 text-sm text-accent [&::-webkit-details-marker]:hidden">
          Details
          <span aria-hidden className="transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        <div className="flex flex-col gap-3">
          {p.signings.map((s) => (
            <dl key={s.guestId} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-card border border-line bg-bg px-3 py-2 text-sm">
              {p.signings.length > 1 && <div className="col-span-2 text-xs font-semibold text-muted">{s.heading}</div>}
              {s.rows.map((r) => (
                <div key={r.label} className="contents">
                  <dt className="text-muted">{r.label}</dt>
                  <dd className="break-words text-ink">{r.value}</dd>
                </div>
              ))}
            </dl>
          ))}
        </div>
      </details>
    </li>
  );
}
