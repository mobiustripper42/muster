import { formatCents } from "@core/reservations/calendar-detail.js";
import { TRAIL_ACTOR_LABEL, TRAIL_TYPE_LABEL, type TrailListRow } from "@core/admin/reservation-trail-list.js";
import type { TrailEventMetadata } from "@core/domain/reservation-trail.js";
import type { TrailEntry } from "@core/reservations/reservation-trail-view.js";
import { AppLink } from "../ui/app-link";
import { fmtRunWhen } from "../../app/lib/format";

/**
 * One booking-audit line, in the two shapes the two surfaces have (issue #1049).
 *
 * `TrailRow` renders the cross-booking feed, where every row is a real recorded event and the
 * useful context is WHICH booking. `TrailEntryRow` renders one booking's own page, where the
 * booking is already known and the useful context is **how well the time is known** — five of
 * the seven derived facts borrow a clock from somewhere else.
 *
 * Calm and neutral, like `/admin/asks`: the type is a word on a pill, not an alarm colour. The
 * rows an operator most needs — a failed refund, a confirmation that never sent — are the ones a
 * colour would be most tempting on, and a list where a third of the rows shout is a list nobody
 * reads.
 */

/** The type as a calm neutral pill (BRAND, no alarm colour) — the word carries it. */
function TypeTag({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
      {label}
    </span>
  );
}

/**
 * The side-channel facts, as one short line.
 *
 * **Selective on purpose.** `TrailEventMetadata` has a dozen optional fields and different types
 * populate different ones; rendering the object generically would put `{"via":"webhook"}` on an
 * operator's screen. Each branch below is a field somebody would act on.
 *
 * `previous` names the FIELDS that were overwritten and not their values — the old phone and
 * email are in the row and a list is not where they belong. Whoever opens one booking can see
 * them; a feed scrolling past thirty bookings should not spray contact details down the page.
 */
export function detailLine(m: TrailEventMetadata): string | null {
  const parts: string[] = [];
  if (m.actualCents !== undefined) parts.push(formatCents(m.actualCents));
  if (m.quotedCents !== undefined) parts.push(`terms quoted ${formatCents(m.quotedCents)}`);
  if (m.previous !== undefined) {
    const fields = Object.keys(m.previous);
    if (fields.length > 0) parts.push(`overwrote ${fields.join(", ")}`);
  }
  if (m.wantedVesselId !== undefined && m.gotVesselId !== undefined) {
    parts.push(`wanted ${m.wantedVesselId}, got ${m.gotVesselId}`);
  }
  if (m.date !== undefined && m.time !== undefined) parts.push(`${m.date} ${m.time}`);
  if (m.guestCount !== undefined) parts.push(`${m.guestCount} guests`);
  if (m.reason !== undefined) parts.push(m.reason);
  if (m.via !== undefined) parts.push(`via ${m.via}`);
  if (m.chargeRef !== undefined) parts.push(m.chargeRef);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** A row in the cross-booking feed. */
export function TrailRow({ row }: { row: TrailListRow }) {
  const detail = detailLine(row.metadata);
  const who = TRAIL_ACTOR_LABEL[row.actorKind];
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-card px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <Subject row={row} />
        <TypeTag label={TRAIL_TYPE_LABEL[row.type]} />
      </div>
      {detail && <span className="break-words text-sm text-muted">{detail}</span>}
      <span className="text-xs text-muted">
        {who} · {fmtRunWhen(row.timestamp)}
      </span>
    </div>
  );
}

/**
 * Which booking this row is about — and the three answers are genuinely different.
 *
 * A named customer links to their booking. **A row whose reservation id resolves to nothing has
 * OUTLIVED its booking**, which is the designed state for a table with no foreign key (the
 * §2.8.8 reaper deletes lapsed rows and the trail is what makes that safe) — so it shows the id
 * and says so, rather than a dead link or a blank. A row with no reservation at all never had
 * one; it names the charge, and that class is the reason this page exists.
 */
function Subject({ row }: { row: TrailListRow }) {
  if (row.customerName !== undefined) {
    return (
      <AppLink
        href={`/admin/calendar/${encodeURIComponent(String(row.reservationId))}`}
        className="min-h-[44px] font-medium text-ink underline decoration-line underline-offset-2"
      >
        {row.customerName}
      </AppLink>
    );
  }
  if (row.reservationId !== undefined) {
    return (
      <span className="min-w-0 break-all font-medium text-muted">
        {String(row.reservationId)} <span className="text-xs">(booking gone)</span>
      </span>
    );
  }
  return (
    <span className="min-w-0 break-all font-medium text-muted">
      {row.paymentIntentId !== undefined ? String(row.paymentIntentId) : "No booking"}
    </span>
  );
}

/**
 * A row on one booking's own page.
 *
 * The difference from the feed is `when`. A `recorded` time is a time. A `computed` or
 * `inherited` one is a time **plus a claim about where it came from**, and the claim is shown
 * rather than hidden behind a `title` attribute — which is unreachable on a phone, and this
 * surface has to work at 375px.
 */
export function TrailEntryRow({ entry }: { entry: TrailEntry }) {
  const detail = detailLine(entry.metadata);
  const borrowed = entry.when.kind !== "recorded";
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-card px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium text-ink">{TRAIL_TYPE_LABEL[entry.type]}</span>
        {borrowed && <TypeTag label="approx" />}
      </div>
      {detail && <span className="break-words text-sm text-muted">{detail}</span>}
      <span className="text-xs text-muted">
        {TRAIL_ACTOR_LABEL[entry.actorKind]} · {fmtRunWhen(entry.when.at)}
      </span>
      {entry.when.kind !== "recorded" && (
        <span className="text-xs italic text-muted">{entry.when.from}</span>
      )}
    </div>
  );
}
