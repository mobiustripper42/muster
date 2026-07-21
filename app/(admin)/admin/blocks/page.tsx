import type { Block, Event, Location, Offering, Reservation, Vessel } from "@core/domain/entities.js";
import type { MusterOwnedVesselDay } from "@core/domain/entities.js";
import { vesselDateOf } from "@core/config/tenant.js";
import { blockDateSpan, computeBlockImpact } from "@core/reservations/block-impact.js";
import { BackLink } from "../../../../components/ui/back-link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { liftBlock } from "./actions";
import {
  CreateBlockAside,
  KindPill,
  VesselHueDot,
  formatDay,
  formatMoney,
  formatTime,
  type BlockKind,
} from "./block-sections";

/**
 * /admin/blocks (task 12.10, DEC-125) — the single block registry, laid out to
 * `docs/design/mockups/blocks.html`: every block, regardless of where it was made, in one
 * list (the anti-Xola), with a per-row server-computed impact ("removes N slots" + any booked-
 * trip conflict), a create aside for the two SCOPED kinds (location / vessel), and a two-step
 * Lift. Single-slot `vesselHold` blocks are made on the calendar (#464) and show here read-only
 * with an "On calendar →" forward link. Master data drives the filters + selects; native forms,
 * no JS (DEC-026).
 *
 * Impact is computed on load via `computeBlockImpact` (reuses the DEC-125 deriver + isSlotBlocked),
 * so the "removes N" the operator sees is exactly what the calendar will subtract.
 */

export const dynamic = "force-dynamic";

type Search = {
  kind?: string;
  upcoming?: string;
  lift?: string;
  saved?: string;
  lifted?: string;
  err?: string;
};

const ERR_COPY: Record<string, string> = {
  bad_kind: "Pick a block kind — Location or Vessel. (Holds are made on the calendar.)",
  bad_location: "Pick a location that still exists.",
  bad_date: "Give the block a real date.",
  bad_window: "Check the time window — HH:MM, and the start can’t be after the end.",
  bad_vessel: "Pick a vessel that still exists.",
  bad_range: "Check the date range — real dates, start on or before end.",
  not_found: "That block was already lifted.",
  error: "Couldn’t do that just now — try again in a moment.",
};

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "location", label: "Location" },
  { key: "vessel", label: "Vessel" },
  { key: "hold", label: "Hold" },
];

/** Registry filter key for a block kind (both hold-family kinds fold to "hold"). */
function filterKeyOf(kind: BlockKind): string {
  return kind === "vesselHold" ? "hold" : kind;
}

export default async function AdminBlocks({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  let blocks: Block[];
  let offerings: Offering[];
  let vessels: Vessel[];
  let locations: Location[];
  let ownedDaysRaw: MusterOwnedVesselDay[];
  let events: Event[];
  let reservations: Reservation[];
  try {
    const repo = getRepo();
    [blocks, offerings, vessels, locations, ownedDaysRaw, events, reservations] = await Promise.all([
      repo.listBlocks(),
      repo.listOfferings(),
      repo.listVessels(),
      repo.listLocations(),
      repo.listMusterOwnedVesselDays(),
      repo.listEvents(),
      repo.listAllReservations(),
    ]);
  } catch {
    return (
      <Shell width="6xl">
        <Notice>Couldn’t reach the blocks right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  vessels.sort((a, b) => a.name.localeCompare(b.name));
  locations.sort((a, b) => a.name.localeCompare(b.name));
  const vesselById = new Map(vessels.map((v) => [String(v.id), v]));
  const locationById = new Map(locations.map((l) => [String(l.id), l]));
  const ownedDays = ownedDaysRaw.map((o) => ({ vesselId: o.vesselId, date: o.date }));
  const impactInput = { offerings, vessels, ownedDays, events, reservations };

  const today = vesselDateOf(new Date());
  const filter = sp.kind && FILTERS.some((f) => f.key === sp.kind) ? sp.kind : "all";
  const upcomingOnly = sp.upcoming === "1";
  const liftingId = sp.lift ?? null;
  const qs = (extra: Record<string, string>) => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("kind", filter);
    if (upcomingOnly) params.set("upcoming", "1");
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    const s = params.toString();
    return s ? `/admin/blocks?${s}` : "/admin/blocks";
  };

  // Build a view model per block: identity, when, past-ness, and the server-computed impact.
  const rows = blocks
    .map((b) => {
      const span = blockDateSpan(b);
      const past = span.end < today;
      const impact = past
        ? { removedSlots: 0, conflictCount: 0, conflictCents: 0 }
        : computeBlockImpact(b, impactInput);
      const vessel = "vesselId" in b ? vesselById.get(String(b.vesselId)) : undefined;
      const location = b.kind === "location" ? locationById.get(String(b.locationId)) : undefined;
      return { block: b, span, past, impact, vessel, location };
    })
    // Upcoming first, then by start date; a lifted block is simply gone (real delete).
    .sort((a, b) => Number(a.past) - Number(b.past) || a.span.start.localeCompare(b.span.start));

  const visible = rows.filter(
    (r) => (filter === "all" || filterKeyOf(r.block.kind) === filter) && (!upcomingOnly || !r.past),
  );

  // The upcoming toggle preserves the active kind filter, flips only `upcoming`.
  const upcomingParams = new URLSearchParams();
  if (filter !== "all") upcomingParams.set("kind", filter);
  if (!upcomingOnly) upcomingParams.set("upcoming", "1");
  const upcomingHref = upcomingParams.toString()
    ? `/admin/blocks?${upcomingParams}`
    : "/admin/blocks";

  const errCopy = sp.err ? ERR_COPY[sp.err] ?? ERR_COPY.error : null;

  return (
    <Shell width="6xl">
      <BackLink href="/admin">Back</BackLink>

      <header className="flex flex-col gap-1">
        <p className="text-xs text-faint">Settings / Blocks</p>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">Blocks</h1>
        <p className="max-w-3xl text-sm text-muted">
          Every block, wherever it was made — the one registry Xola never gave you. Scoped blocks
          (a location window, a vessel range) are created here; single-slot ones (a hold, a one-off
          blackout) are made on the calendar, but all of them show here. Each subtracts slots;
          lifting puts them back.
        </p>
      </header>

      {sp.saved && <Notice tone="ok">Block created.</Notice>}
      {sp.lifted && <Notice tone="ok">Block lifted — those slots are back on the calendar.</Notice>}
      {errCopy && <Notice tone="bad">{errCopy}</Notice>}

      {/* Filters */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-line bg-card">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const params = new URLSearchParams();
            if (f.key !== "all") params.set("kind", f.key);
            if (upcomingOnly) params.set("upcoming", "1");
            const href = params.toString() ? `/admin/blocks?${params}` : "/admin/blocks";
            return (
              <AppLink
                key={f.key}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`border-r border-line px-3 py-1.5 text-sm last:border-r-0 ${
                  active ? "bg-ink font-medium text-white" : "text-muted"
                }`}
              >
                {f.label}
              </AppLink>
            );
          })}
        </div>
        <AppLink href={upcomingHref} className="px-1 text-xs text-muted underline">
          {upcomingOnly ? "Show past too" : "Upcoming only"}
        </AppLink>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 min-[1080px]:grid-cols-[1fr_340px]">
        {/* Registry (master) */}
        <div className="overflow-hidden rounded-card border border-line bg-card shadow-sm">
          <div className="hidden border-b border-line px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-faint min-[720px]:grid min-[720px]:grid-cols-[110px_1.4fr_1.2fr_100px_90px] min-[720px]:gap-3">
            <div>Kind</div>
            <div>What it blocks</div>
            <div>When</div>
            <div>Removes</div>
            <div />
          </div>

          {visible.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">
              No blocks{filter !== "all" ? " of this kind" : ""} yet. Create one on the right, or
              make a hold on the calendar.
            </p>
          ) : (
            visible.map(({ block, span, past, impact, vessel, location }) => {
              const kind = block.kind as BlockKind;
              const calendarMade = kind === "vesselHold";
              const when =
                block.kind === "location"
                  ? `${formatDay(block.date)} · ${formatTime(block.startTime)}–${formatTime(block.endTime)}`
                  : block.kind === "vesselHold"
                    ? `${formatDay(block.date)} · ${formatTime(block.time)}`
                    : `${formatDay(block.startDate)} – ${formatDay(block.endDate)} · all day`;
              const vesselName = vessel?.name ?? (("vesselId" in block) ? String(block.vesselId) : "");
              const locationName = location?.name ?? (block.kind === "location" ? String(block.locationId) : "");

              return (
                <div
                  key={block.id}
                  className={`grid grid-cols-1 gap-1 border-t border-line px-4 py-3 text-sm min-[720px]:grid-cols-[110px_1.4fr_1.2fr_100px_90px] min-[720px]:items-center min-[720px]:gap-3 ${
                    past ? "opacity-50" : ""
                  }`}
                >
                  <div>
                    <KindPill kind={kind} />
                  </div>

                  <div className="min-w-0">
                    <div className="font-medium text-ink">
                      {kind === "location" ? (
                        <>{locationName}</>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <VesselHueDot vesselId={String("vesselId" in block ? block.vesselId : "")} hue={vessel?.hue} />
                          {vesselName}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-faint">
                      {kind === "location"
                        ? "all vessels · all offerings here"
                        : kind === "vesselHold"
                          ? "reserved · made on calendar"
                          : "out of service"}
                      {block.note ? ` · ${block.note}` : ""}
                    </div>
                    {!past && impact.conflictCount > 0 && (
                      <span className="mt-1 inline-block rounded-full border border-warn-line bg-warn-bg px-2 py-0.5 text-[10px] font-semibold text-warn">
                        ⚠ {impact.conflictCount} booked ({formatMoney(impact.conflictCents)}) conflict
                      </span>
                    )}
                  </div>

                  <div className="font-mono text-xs text-muted">{when}</div>

                  <div className="font-mono text-sm font-semibold text-ink">
                    {past ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <>
                        {impact.removedSlots}
                        <span className="block text-[10px] font-normal text-faint">
                          {impact.removedSlots === 1 ? "slot" : "slots"}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="text-xs">
                    {calendarMade ? (
                      <AppLink href="/admin/calendar" className="text-accent">
                        On calendar →
                      </AppLink>
                    ) : liftingId === block.id ? (
                      <form action={liftBlock} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={block.id} />
                        <SubmitButton className="rounded-md border border-bad-line bg-bad-bg px-2 py-1 text-[11px] font-semibold text-bad">
                          Confirm
                        </SubmitButton>
                        <AppLink href={qs({})} className="text-muted">
                          Cancel
                        </AppLink>
                      </form>
                    ) : (
                      <AppLink href={qs({ lift: block.id })} className="text-accent">
                        Lift
                      </AppLink>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Create (aside) */}
        <CreateBlockAside locations={locations} vessels={vessels} />
      </div>

      <VersionTag />
    </Shell>
  );
}
