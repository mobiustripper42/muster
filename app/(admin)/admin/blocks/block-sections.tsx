import { vesselHueClass } from "../../../lib/vessel-hue";

/**
 * /admin/blocks server-rendered presentational bits (task 12.10, DEC-125): the kind pill, the
 * vessel hue dot, and the display formatters. The interactive create/edit panel is a client
 * island — see `./block-editor`.
 */

export type BlockKind = "location" | "vessel" | "vesselHold";

export const KIND_META: Record<BlockKind, { label: string; dot: string; pill: string }> = {
  location: { label: "Location", dot: "bg-muted", pill: "border-line bg-bg text-muted" },
  vessel: { label: "Vessel", dot: "bg-bad", pill: "border-bad-line bg-bad-bg text-bad" },
  vesselHold: { label: "Hold", dot: "bg-accent", pill: "border-line bg-bg text-ink" },
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
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${meta.pill}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-sm ${meta.dot}`} aria-hidden />
      {meta.label}
    </span>
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
