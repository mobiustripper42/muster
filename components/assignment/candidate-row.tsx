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
            {/* No `title` (#555). It read "Name them into this seat — they get the ask;
                their yes still needs your confirm", and both halves were false: this
                action sends an ask (`assignFromPool` → `assignPerson`, `lean.ts:241`)
                rather than naming anyone in, and a crew "In" has auto-confirmed since
                DEC-061. Deleted rather than reworded — "Ask to fill" already says what
                the button does, and a replacement sentence is one more claim to keep
                true. This one went stale the day DEC-061 landed and nothing noticed,
                because no gate reads prose. */}
            <MiniButton label="Ask to fill" />
          </form>
        )}
        {c.action === "nudge" && (
          <form action={nudgeOn} className="inline-flex">
            <HiddenIds vm={vm} crewId={c.id} />
            {/* lean() is shift-level (first gap seat that fits) — say so. */}
            <MiniButton
              label="Nudge"
              glyph="↗"
              title="Direct nudge — asks them onto this shift's open seat"
            />
          </form>
        )}
      </span>
    </li>
  );
}
