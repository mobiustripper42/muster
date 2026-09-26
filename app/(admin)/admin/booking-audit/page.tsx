import {
  buildReservationTrailList,
  TRAIL_ACTOR_LABEL,
  TRAIL_TYPE_LABEL,
  type TrailListRow,
} from "@core/admin/reservation-trail-list.js";
import {
  EMITTED_TRAIL_TYPES,
  TRAIL_ACTOR_KINDS,
  type EmittedTrailType,
  type TrailActorKind,
} from "@core/domain/reservation-trail.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { GetFormSubmit } from "../../../../components/ui/get-form-submit";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { VersionTag } from "../../../../components/ui/version-tag";
import { TrailRow } from "../../../../components/admin/trail-row";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { ADMIN_LOG_HINT, logSwallowed } from "../../../lib/swallowed";

/**
 * /admin/booking-audit (issue #1049) — every recorded event across every booking, newest first,
 * filterable by what happened and by who did it.
 *
 * The crew engine's counterpart is `/admin/asks`, and this follows its shape rather than
 * inventing one: core owns the vocabulary and the query, this file owns only markup.
 *
 * **The operator sees "audit"; the code underneath says `trail`.** That split is deliberate and
 * recorded on issue #1053: this codebase already used "trail" for a DERIVED read-model (ask-trail,
 * escalation-trail, DEC-024) and "audit" for a stored log (`audit_events`), and
 * `reservation_trail` is a stored log wearing the wrong one. Renaming the table, the branded id,
 * two modules and ~33 emit sites buys nothing behavioural, so the wart stays inside — but an
 * operator should never have to learn it.
 *
 * **The nav says `Bookings › Audit`; this heading says "Booking audit".** Not a drift: the nav
 * label sits under a group header that supplies the subject, and a page heading stands alone.
 * The crew twin's `/admin/asks` heading reads a bare "Audit" and is the weaker of the two.
 *
 * **It shows the EMITTED half only** (`buildReservationTrailList` says why). The seven derived
 * types appear on a booking's own page, which is the other half of this task.
 */

export const dynamic = "force-dynamic";

type Search = { type?: string; actor?: string };

/** A query string is user input; these two coerce it back into the closed unions. An unknown
 *  value is dropped rather than throwing, so a hand-edited URL renders the unfiltered list
 *  instead of an error page. */
const asType = (v?: string): EmittedTrailType | undefined =>
  v && (EMITTED_TRAIL_TYPES as readonly string[]).includes(v) ? (v as EmittedTrailType) : undefined;
const asActor = (v?: string): TrailActorKind | undefined =>
  v && (TRAIL_ACTOR_KINDS as readonly string[]).includes(v) ? (v as TrailActorKind) : undefined;

export default async function BookingAudit({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  const type = asType(sp.type);
  const actorKind = asActor(sp.actor);

  let rows: TrailListRow[];
  try {
    rows = await buildReservationTrailList(getRepo(), {
      ...(type ? { type } : {}),
      ...(actorKind ? { actorKind } : {}),
    });
  } catch (e) {
    logSwallowed("admin/booking-audit", e, "the booking audit did not load");
    return (
      <Shell width="3xl">
        <Notice>Couldn’t reach the booking audit right now. {ADMIN_LOG_HINT}</Notice>
      </Shell>
    );
  }

  const filtered = !!(type || actorKind);

  return (
    <Shell width="3xl">
      <h1 className="text-xl font-semibold text-ink">Booking audit</h1>
      <p className="text-sm text-muted">
        Every recorded event across every booking — sold, cancelled, refunded, declined, and the
        rest — one list, newest first. A single booking’s full history, including the parts worked
        out from other records, is on its own page.
      </p>

      <FilterForm sp={sp} />

      <section aria-label="Booking audit" className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
          {filtered ? " (filtered)" : ""}
        </h2>

        {rows.length === 0 ? (
          <Notice>
            {filtered
              ? "Nothing to show — try a wider filter."
              : "Nothing recorded yet."}
          </Notice>
        ) : (
          rows.map((r) => <TrailRow key={String(r.id)} row={r} />)
        )}
      </section>

      <VersionTag />
    </Shell>
  );
}

/** Type + actor filter — a native GET form (no JS, DEC-026), same as `/admin/asks`. */
function FilterForm({ sp }: { sp: Search }) {
  const inputClass = "min-h-[44px] rounded-card border border-line bg-card px-3 text-ink";
  // Alphabetical by LABEL, not by the union's order — that order is grouped by subsystem for a
  // reader of the source, and is arbitrary to an operator hunting one word in a select.
  const types = [...EMITTED_TRAIL_TYPES].sort((a, b) =>
    TRAIL_TYPE_LABEL[a].localeCompare(TRAIL_TYPE_LABEL[b]),
  );
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-sm"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="type" className="text-xs text-muted">
          What happened
        </label>
        <select id="type" name="type" defaultValue={sp.type ?? ""} className={`${inputClass} max-w-full`}>
          <option value="">Anything</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {TRAIL_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="actor" className="text-xs text-muted">
          Who
        </label>
        <select id="actor" name="actor" defaultValue={sp.actor ?? ""} className={inputClass}>
          <option value="">Anyone</option>
          {TRAIL_ACTOR_KINDS.map((a) => (
            <option key={a} value={a}>
              {TRAIL_ACTOR_LABEL[a]}
            </option>
          ))}
        </select>
      </div>
      <GetFormSubmit className="min-h-[44px] rounded-card bg-accent px-4 font-semibold text-white">
        Filter
      </GetFormSubmit>
      {(sp.type || sp.actor) && (
        <AppLink
          href="/admin/booking-audit"
          className="min-h-[44px] self-end px-2 py-2 text-sm text-muted underline"
        >
          Clear
        </AppLink>
      )}
    </form>
  );
}
