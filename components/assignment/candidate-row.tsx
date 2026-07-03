import { assignTo, nudgeOn } from "../../app/(admin)/admin/shift/[shiftId]/actions";
import { HiddenIds, MiniButton } from "./bits";
import type { CandidateVM, SeatCardVM } from "./seat-card";

/**
 * One eligible-pool row (§2.4) — name, ask status (silent ≠ declined: the
 * ghost gets the loud treatment), and the action the domain would accept
 * (Assign on available, Nudge on declined/silent — never a button the action
 * refuses).
 */

const STATUS_COPY: Record<
  CandidateVM["status"],
  { label: string; glyph?: string; cls: string }
> = {
  available: { label: "not yet asked", cls: "text-muted" },
  asked: { label: "awaiting reply", cls: "text-accent" },
  in: { label: "said yes", cls: "font-semibold text-ok" },
  declined: { label: "declined", cls: "text-muted" },
  silent: { label: "silent — no reply, timed out", glyph: "👻", cls: "font-semibold text-bad" },
  bailed: { label: "bailed", cls: "font-semibold text-bad" },
};

/** An Asked seat's collapsed line must say WHO is in flight (binding fact). */
export function askedSummary(pool: CandidateVM[]): string {
  const waiting = pool.filter((c) => c.status === "asked").map((c) => c.name);
  return waiting.length === 0
    ? " — asks in flight, watching"
    : ` — awaiting reply from ${waiting.join(", ")}`;
}

export function CandidateRow({ vm, c }: { vm: SeatCardVM; c: CandidateVM }) {
  const s = STATUS_COPY[c.status];
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
      <span className="text-sm text-ink">{c.name}</span>
      <span className="flex items-center gap-3">
        <span className={`text-xs ${s.cls}`}>
          {/* The ghost is decorative (9.8) — the label says "silent" in words. */}
          {s.glyph && <span aria-hidden="true">{s.glyph} </span>}
          {s.label}
          {c.replyLabel && <span className="text-muted"> · {c.replyLabel}</span>}
        </span>
        {c.action === "assign" && (
          <form action={assignTo} className="inline-flex">
            <HiddenIds vm={vm} crewId={c.id} />
            <MiniButton
              label="Ask to fill"
              title="Name them into this seat — they get the ask; their yes still needs your confirm"
            />
          </form>
        )}
        {c.action === "nudge" && (
          <form action={nudgeOn} className="inline-flex">
            <HiddenIds vm={vm} crewId={c.id} />
            {/* lean() is shift-level (first gap seat that fits) — say so. */}
            <MiniButton
              label="↗ Nudge"
              title="Direct nudge — asks them onto this shift's open seat"
            />
          </form>
        )}
      </span>
    </li>
  );
}
