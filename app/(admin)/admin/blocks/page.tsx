import type { Block, Event, Location, Offering, Reservation, Vessel } from "@core/domain/entities.js";
import { vesselDateOf } from "@core/config/tenant.js";
import { blockDateSpan, computeBlockImpact } from "@core/reservations/block-impact.js";
import { Notice } from "../../../../components/ui/notice";
import { Tag } from "../../../../components/ui/badge";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { errCopyFor } from "../../../lib/err-copy";
import { readFormDraft } from "../../../lib/form-draft";
import { getRepo } from "../../../lib/repo";
import { ADMIN_LOG_HINT, logSwallowed } from "../../../lib/swallowed";
import type { BlockErr } from "./actions";
import {
  KindPill,
  VesselHueDot,
  formatDay,
  formatMoney,
  formatTime,
  type BlockKind,
} from "./block-sections";
import { BlockEditor } from "./block-editor";
import { Card } from "../../../../components/ui/card";

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
  past?: string;
  sel?: string;
  /** `1` right after a save — the page says how many departures came off (issue #1091). */
  saved?: string;
  err?: string;
};

const ERR_COPY: Record<BlockErr, string> = {
  bad_kind: "Pick what’s happening first.",
  bad_location: "Pick a location that still exists.",
  bad_date: "Give the closure a real date.",
  bad_window: "Check the times — the closure has to start before it ends.",
  bad_vessel: "Pick a boat that’s still in the fleet.",
  bad_range: "Check the dates — From has to be a real date, on or before To.",
  not_found: "That block was already unblocked.",
  error: "Couldn’t do that just now — try again in a moment.",
};

/**
 * The chips, in the editor's words (issue #1091). The URL keys keep the kinds' names — links and
 * tests already carry `?kind=slot` — only the labels changed.
 */
const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "vessel", label: "Boats out" },
  { key: "location", label: "Closures" },
  { key: "slot", label: "Single departures" },
];

/** "removes N" in the operator's words — what the confirmation line after a save says. */
function offCalendarLine(n: number): string {
  if (n === 0) return "Blocked. Nothing in it was on sale, so nothing came off the calendar.";
  return `Blocked. ${n} ${n === 1 ? "departure is" : "departures are"} off the calendar.`;
}

/**
 * The Which column's second line: what the block reaches beyond the name above it. A boat out
 * needs nothing — the badge and the boat already say it.
 */
const ROW_SCOPE: Record<BlockKind, string> = {
  location: "every boat leaving here",
  vessel: "",
  vesselHold: "opens on the calendar",
};

/**
 * The When column: the date on one line, the time on the next (operator, 2026-10-02) — one string
 * wrapped wherever the column ran out, mid-phrase. A one-day boat out reads as one day, not
 * "Oct 5 – Oct 5".
 */
function whenOf(block: Block): { date: string; time: string } {
  switch (block.kind) {
    case "location":
      return { date: formatDay(block.date), time: `${formatTime(block.startTime)} – ${formatTime(block.endTime)}` };
    case "vesselHold":
      return { date: formatDay(block.date), time: formatTime(block.time) };
    case "vessel":
      return {
        date:
          block.startDate === block.endDate
            ? formatDay(block.startDate)
            : `${formatDay(block.startDate)} – ${formatDay(block.endDate)}`,
        time: "all day",
      };
  }
}

/**
 * The registry's columns, header and rows alike. `minmax(0, …)` because each row is its own grid:
 * plain `fr` tracks grow to fit their row's text, so rows with shorter text drifted left of the
 * headers (issue #1090). Fixed tracks make every row line up whatever it holds.
 */
const ROW_COLS = "min-[720px]:grid-cols-[130px_minmax(0,1.4fr)_minmax(0,1.2fr)_110px]";

/** Registry filter key for a block kind — the single-slot kind files under "slot". */
function filterKeyOf(kind: BlockKind): string {
  return kind === "vesselHold" ? "slot" : kind;
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
  let events: Event[];
  let reservations: Reservation[];
  try {
    const repo = getRepo();
    [blocks, offerings, vessels, locations, events, reservations] = await Promise.all([
      repo.listBlocks(),
      repo.listOfferings(),
      repo.listVessels(),
      repo.listLocations(),
      repo.listEvents(),
      repo.listAllReservations(),
    ]);
  } catch (e) {
    logSwallowed("admin/blocks", e, "the blocks view did not load");
    return (
      <Shell width="6xl">
        <Notice>Couldn’t reach the blocks right now. {ADMIN_LOG_HINT}</Notice>
      </Shell>
    );
  }

  vessels.sort((a, b) => a.name.localeCompare(b.name));
  locations.sort((a, b) => a.name.localeCompare(b.name));
  const vesselById = new Map(vessels.map((v) => [String(v.id), v]));
  const locationById = new Map(locations.map((l) => [String(l.id), l]));
  const impactInput = { offerings, vessels, events, reservations };

  const today = vesselDateOf(new Date());
  const filter = sp.kind && FILTERS.some((f) => f.key === sp.kind) ? sp.kind : "all";
  // Time scope: Upcoming (default) or Past — a two-way segment, never both.
  const showPast = sp.past === "1";
  // The selected block loads into the edit panel (master-detail); absent ⇒ a fresh "New block".
  // A SLOT block is never selectable: its row links to the calendar instead, and there is
  // nothing here to edit. Excluding it at the source matters — a stale `?sel=<slot-id>` would
  // otherwise reach the editor, which has no branch for the kind and would render a LOCATION
  // form pointed at a slot block (#703).
  const selected = sp.sel
    ? blocks.find((b) => String(b.id) === sp.sel && b.kind !== "vesselHold") ?? null
    : null;

  /**
   * The refused submission's own values, read back as the editor's defaults (#780).
   *
   * Flattened to a plain record on purpose: `BlockEditor` is a client island (the kind toggle
   * swaps the field sets), and a `FormDraft` carries methods, which cannot cross the
   * server/client boundary. So the page does the reading and hands over data.
   *
   * A flat `name → value` map is only safe because every control on this form is single-valued —
   * no checkboxes, no multi-selects. On a form with either, `has()` is the accessor and a
   * `?? ""` map would quietly turn "unticked" into "absent". Keep that in mind before copying
   * this shape to another island.
   */
  const draft = sp.err ? await readFormDraft("/admin/blocks") : null;
  const draftValues = draft
    ? Object.fromEntries(
        (
          [
            // The answer to "What's happening?" — a refused boat-out has to come back as one (#1090).
            "kind",
            "locationId",
            "date",
            "startTime",
            "endTime",
            "vesselId",
            "startDate",
            "endDate",
            "note",
          ] as const
        ).map((n) => [n, draft.get(n) ?? ""]),
      )
    : null;
  // Every nav link preserves the OTHER axes (kind + time scope + selection), so filtering never
  // drops your selection or empties the panel.
  const hrefWith = (o: { kind?: string; past?: boolean; sel?: string | null }) => {
    const k = o.kind ?? filter;
    const p = o.past ?? showPast;
    const s = o.sel !== undefined ? o.sel : sp.sel ?? null;
    const params = new URLSearchParams();
    if (k !== "all") params.set("kind", k);
    if (p) params.set("past", "1");
    if (s) params.set("sel", s);
    const q = params.toString();
    return q ? `/admin/blocks?${q}` : "/admin/blocks";
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
    .sort((a, b) => a.span.start.localeCompare(b.span.start));

  const visible = rows.filter(
    (r) => (filter === "all" || filterKeyOf(r.block.kind) === filter) && (showPast ? r.past : !r.past),
  );

  const errCopy = errCopyFor(ERR_COPY, sp.err, "error");
  const selectedRow = selected ? rows.find((r) => r.block === selected) : undefined;
  const offSale = selectedRow?.impact.removedSlots ?? 0;

  return (
    <Shell width="6xl">

      <header className="flex flex-col gap-1">
        <p className="text-xs text-muted">Bookings / Blocks</p>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">Blocks</h1>
      </header>

      {errCopy && <Notice tone="bad">{errCopy}</Notice>}
      {!errCopy && sp.saved === "1" && selectedRow && (
        <Notice tone="ok">
          <span data-testid="blocked-notice">{offCalendarLine(offSale)}</span>
        </Notice>
      )}

      {/* Filters — kind + time scope, both segmented chips. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="segmented">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <AppLink
                key={f.key}
                href={hrefWith({ kind: f.key })}
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
        <div className="segmented">
          {([["Upcoming", false], ["Past", true]] as const).map(([label, past]) => {
            const active = showPast === past;
            return (
              <AppLink
                key={label}
                href={hrefWith({ past })}
                aria-current={active ? "page" : undefined}
                className={`border-r border-line px-3 py-1.5 text-sm last:border-r-0 ${
                  active ? "bg-ink font-medium text-white" : "text-muted"
                }`}
              >
                {label}
              </AppLink>
            );
          })}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 min-[1080px]:grid-cols-[1fr_340px]">
        {/* Registry (master) */}
        <Card pad="none" className="overflow-hidden">
          <div className={`hidden border-b border-line px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted min-[720px]:grid ${ROW_COLS} min-[720px]:gap-3`}>
            <div>What</div>
            <div>Which</div>
            <div>When</div>
            {/* What the number counts: open departures the block takes off the calendar. Not
                reservations — a block never removes a booking; those are the conflict badge. */}
            <div>Departures blocked</div>
          </div>

          {visible.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">
              {filter === "all"
                ? "Nothing blocked. Take a boat out of service, close a dock for part of a day, or hold one departure on the calendar."
                : "Nothing of this kind is blocked."}
            </p>
          ) : (
            visible.map(({ block, past, impact, vessel, location }) => {
              const kind = block.kind as BlockKind;
              const when = whenOf(block);
              const vesselName = vessel?.name ?? (("vesselId" in block) ? String(block.vesselId) : "");
              const locationName = location?.name ?? (block.kind === "location" ? String(block.locationId) : "");

              const isSel = selected !== null && String(selected.id) === String(block.id);
              // A SLOT block row goes straight to its day on the calendar, not into the edit
              // panel (#703). Selecting one used to open a read-only aside whose entire content
              // — boat, day, time — is already on the row you clicked, plus a second link to
              // the place you were trying to reach. There is nothing to edit here: a slot block
              // is made and unmade on the calendar, so the row IS the forward link — and it opens
              // that block's pane with its card selected (`?release=`), not just the bare day
              // with the operator left to find the card (issue #1090).
              const rowHref =
                block.kind === "vesselHold"
                  ? `/admin/calendar?date=${block.date}&release=${encodeURIComponent(String(block.id))}`
                  : hrefWith({ sel: String(block.id) });
              return (
                <AppLink
                  key={block.id}
                  href={rowHref}
                  // `overlay`, not the default inline spinner: the inline one wraps the row in an
                  // `inline-flex` span, which shrank each row's grid to its own text and pulled
                  // the columns out of line with the headers (issue #1090).
                  spinner="overlay"
                  data-testid="block-row"
                  aria-current={isSel ? "page" : undefined}
                  className={`relative block border-t border-line hover:bg-bg ${isSel ? "bg-bg" : ""} ${
                    past ? "opacity-50" : ""
                  }`}
                >
                  <div className={`grid grid-cols-1 gap-1 px-4 py-3 text-sm ${ROW_COLS} min-[720px]:items-center min-[720px]:gap-3`}>
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
                    <div className="text-xs text-muted">
                      {[ROW_SCOPE[kind], block.note].filter(Boolean).join(" · ")}
                    </div>
                    {!past && impact.conflictCount > 0 && (
                      <Tag tone="warn" className="mt-1">
                        ⚠ {impact.conflictCount} booked ({formatMoney(impact.conflictCents)}) conflict
                      </Tag>
                    )}
                  </div>

                  <div className="font-mono text-xs text-muted">
                    <div data-testid="when-date">{when.date}</div>
                    <div data-testid="when-time">{when.time}</div>
                  </div>

                  <div data-testid="off-sale" className="font-mono text-sm font-semibold text-ink">
                    {past ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <>
                        {impact.removedSlots}
                        {/* The header says what this counts on desktop; at 375px there is no
                            header row, so the number carries its own words. */}
                        <span className="ml-1 text-xs font-normal text-muted min-[720px]:hidden">
                          {impact.removedSlots === 1 ? "departure blocked" : "departures blocked"}
                        </span>
                      </>
                    )}
                  </div>

                  </div>
                </AppLink>
              );
            })
          )}
        </Card>

        {/* Create (aside) */}
        <BlockEditor
          key={selected ? String(selected.id) : "new"}
          selected={selected}
          locations={locations}
          vessels={vessels}
          draftValues={draftValues}
          offSale={offSale}
        />
      </div>

      <VersionTag />
    </Shell>
  );
}
