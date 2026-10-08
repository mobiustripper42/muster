import { vesselHueClass } from "../../../lib/vessel-hue";
import { Badge, type Tone } from "../../../../components/ui/badge";

/**
 * /admin/blocks server-rendered presentational bits (task 12.10, DEC-125): the kind pill, the
 * vessel hue dot, and the display formatters. The interactive create/edit panel is a client
 * island — see `./block-editor`.
 */

export type BlockKind = "location" | "vessel" | "vesselHold";

/**
 * The three kinds are one FAMILY — a block — distinguished by SCOPE: a location, a vessel, or a
 * single slot. The `vesselHold` kind used to label itself "Hold", which gave the operator two
 * words for one thing (you held on the calendar, then went to Blocks to find it) and collided
 * with DEC-109's transient customer checkout-hold, a different row with a countdown on it.
 * Operator's call, 2026-08-08. The data-model name stays `vesselHold`; this is the label only.
 *
 * The labels say what happened, not the scope's name (issue #1091): a new admin reads "Boat out"
 * without first learning that a vessel block is what takes a boat out.
 */
export const KIND_META: Record<BlockKind, { label: string; dot: string; tone: Tone }> = {
  location: { label: "Closed", dot: "bg-muted", tone: "neutral" },
  vessel: { label: "Boat out", dot: "bg-bad", tone: "bad" },
  vesselHold: { label: "One departure", dot: "bg-accent", tone: "neutral" },
};

/** "2026-08-12" → "Wed Aug 12". Read at UTC midnight so the label never shifts by TZ. */
export function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** "13:30" → "1:30 PM". Falls back to the raw string if it isn't HH:MM. */
export function formatTime(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2];
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${ampm}`;
}

/** Integer cents → "$1,098". */
export function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function KindPill({ kind }: { kind: BlockKind }) {
  const meta = KIND_META[kind];
  return (
    <Badge tone={meta.tone}>
      <span
        // eslint-disable-next-line muster/radius -- mark (issue #484): a 6px square dot keeps its corner
        className={`inline-block h-1.5 w-1.5 rounded-sm ${meta.dot}`}
        aria-hidden
      />
      {meta.label}
    </Badge>
  );
}

export function VesselHueDot({ vesselId, hue }: { vesselId: string; hue?: number }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${vesselHueClass(vesselId, hue)}`}
      aria-hidden
    />
  );
}
