"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";
import type { CheckInRow } from "@core/checkin/check-in.js";
import { tickGuest, tickGuestForm, type TickOutcome } from "./actions";

/**
 * The mate's list for one departure (Phase 18.5a; surfaces §C1, §C3): tap a name and the row moves
 * to Checked in; tap it there to take it back.
 *
 * **Why this is an island (DEC-147 rule 2).** The whole party is on the dock at once and the mate
 * taps a name per person, on dock signal. Waiting on a round trip per tap is the gangway backing up,
 * so a tap moves the row at once and the save follows. A tap the server refuses (the boat filled
 * from another phone, the guest gone) moves back and the list re-reads; a tap that never arrived
 * says "Didn't save" with a Retry, and never silently vanishes (§C3).
 *
 * **Without JS it still works**: each row is a real form posting `tickGuestForm`, a round trip that
 * lands back on this page.
 *
 * **The boat's limit (§4a)**: at the limit the rows still to board stop taking taps and the header
 * reads "Full · 12 of 12". No message names the limit. Every number shown is capped at it.
 *
 * The row buttons are raw `<button type="submit">`, not `SubmitButton` (DEC-090): with JS a tap
 * never waits on a submit, so there is no spinner to show. A row is held for the moment its save is
 * in flight, so two taps on one name cannot race each other to the server.
 */

type Local = { checkedIn: boolean; status: "saving" | "saved" | "failed" };

export function CheckInList({
  shiftId,
  eventId,
  rows,
  limit,
  signed,
}: {
  shiftId: string;
  eventId: string;
  /** Every guest on the departure, alphabetical, as the server last read them. */
  rows: CheckInRow[];
  limit: number;
  /** "16 SIGNED", already capped at the limit. */
  signed: number;
}) {
  const router = useRouter();
  // Taps not yet reflected in `rows`, by guest. A refused tap is dropped, so the row shows the
  // server's answer again.
  const [local, setLocal] = useState<Record<string, Local>>({});

  const shown = rows.map((r) => ({ ...r, checkedIn: local[r.guestId]?.checkedIn ?? r.checkedIn, status: local[r.guestId]?.status }));
  const toBoard = shown.filter((r) => !r.checkedIn);
  const aboard = shown.filter((r) => r.checkedIn);
  const full = aboard.length >= limit;

  async function send(guestId: string, on: boolean) {
    setLocal((l) => ({ ...l, [guestId]: { checkedIn: on, status: "saving" } }));
    let outcome: TickOutcome;
    try {
      outcome = await tickGuest(shiftId, eventId, guestId, on);
      // eslint-disable-next-line no-restricted-syntax -- a tap that never reached the server is shown as failed (§C3), not a fault
    } catch {
      outcome = "error";
    }
    if (outcome === "ok") {
      setLocal((l) => ({ ...l, [guestId]: { checkedIn: on, status: "saved" } }));
    } else if (outcome === "error") {
      setLocal((l) => ({ ...l, [guestId]: { checkedIn: on, status: "failed" } }));
    } else {
      // Refused: the list on this phone is behind (another phone filled the boat, or the guest is
      // gone). Put the row back and read the list again.
      setLocal((l) => {
        const { [guestId]: _dropped, ...rest } = l;
        return rest;
      });
      router.refresh();
    }
  }

  const tap = (guestId: string, on: boolean) => (e: MouseEvent) => {
    e.preventDefault();
    void send(guestId, on);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-card border border-line bg-card px-4 py-3" data-testid="checked-in-tile">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">{full ? "Full" : "Checked in"}</div>
          <div className="font-mono text-2xl font-semibold text-ink">
            {full ? `${Math.min(aboard.length, limit)} of ${limit}` : aboard.length}
          </div>
        </div>
        <div className="rounded-card border border-line bg-card px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Signed</div>
          <div className="font-mono text-2xl font-semibold text-ink">{signed}</div>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Still to board · {Math.min(toBoard.length, limit)}
        </h2>
        {rows.length === 0 && (
          <p className="rounded-card border border-line bg-card px-4 py-3 text-sm text-muted">
            Nobody has signed for this trip yet.
          </p>
        )}
        {rows.length > 0 && toBoard.length === 0 && (
          <p className="rounded-card border border-ok-line bg-ok-bg px-4 py-3 font-semibold text-ok">✓ Everyone’s aboard</p>
        )}
        {toBoard.length > 0 && (
          // Every name, never "…9 more" (§C1): the list scrolls in its own region.
          <ul className="max-h-[55vh] divide-y divide-line overflow-y-auto rounded-card border border-line bg-card">
            {toBoard.map((r) => (
              <Row key={r.guestId} row={r} shiftId={shiftId} eventId={eventId} inert={full} onTap={tap} onRetry={send} />
            ))}
          </ul>
        )}
      </section>

      {aboard.length > 0 && (
        <details className="rounded-card border border-line bg-card">
          <summary className="flex min-h-[48px] items-center justify-between gap-3 px-4 py-2 font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span>
              <span className="text-ok" aria-hidden>
                ✓{" "}
              </span>
              Checked in · {Math.min(aboard.length, limit)}
            </span>
            <span className="text-sm font-normal text-muted">tap a name to undo ›</span>
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {aboard.map((r) => (
              <Row key={r.guestId} row={r} shiftId={shiftId} eventId={eventId} inert={false} onTap={tap} onRetry={send} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Row({
  row,
  shiftId,
  eventId,
  inert,
  onTap,
  onRetry,
}: {
  row: CheckInRow & { status?: Local["status"] | undefined };
  shiftId: string;
  eventId: string;
  /** At the boat's limit, a row still to board takes no tap. */
  inert: boolean;
  onTap: (guestId: string, on: boolean) => (e: MouseEvent) => void;
  onRetry: (guestId: string, on: boolean) => Promise<void>;
}) {
  const next = !row.checkedIn;
  return (
    <li className="flex items-center">
      <form action={tickGuestForm} className="min-w-0 flex-1">
        <input type="hidden" name="shiftId" value={shiftId} />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="guestId" value={row.guestId} />
        <input type="hidden" name="aboard" value={next ? "1" : "0"} />
        {/* eslint-disable-next-line no-restricted-syntax -- a tap moves the row at once; no submit to spin for (header) */}
        <button type="submit"
          disabled={inert || row.status === "saving"}
          onClick={onTap(row.guestId, next)}
          className="flex min-h-[50px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="min-w-0">
            <span className="font-medium text-ink">{row.name}</span>
            {row.detail && <span className="text-sm text-muted"> {row.detail}</span>}
            <span className="sr-only">{row.checkedIn ? " — undo check-in" : " — check in"}</span>
          </span>
          <span aria-hidden className={row.checkedIn ? "text-ok" : "text-muted"}>
            {row.checkedIn ? "✓" : "○"}
          </span>
        </button>
      </form>
      {row.status === "failed" && (
        <span className="flex shrink-0 items-center gap-2 pr-3 text-sm">
          <span className="text-bad">Didn’t save</span>
          <button
            type="button"
            onClick={() => void onRetry(row.guestId, row.checkedIn)}
            aria-label={`Retry ${row.name}`}
            className="btn-secondary min-h-[44px] px-3"
          >
            Retry
          </button>
        </span>
      )}
    </li>
  );
}
