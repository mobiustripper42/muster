"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type MouseEvent } from "react";
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
 * **New signers appear on their own** (18.5b, DEC-192): every `refreshSeconds` while the page is on
 * screen it re-reads itself (`router.refresh()`), and once straight away on coming back to it. A phone
 * with the screen off, or on another app, sends nothing. A beat is skipped while a tap is saving or
 * a read is still out. Next runs reads and taps one at a time, so a read never undoes a tick.
 * New names get a brief highlight.
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
  refreshSeconds,
}: {
  shiftId: string;
  eventId: string;
  /** Every guest on the departure, alphabetical, as the server last read them. */
  rows: CheckInRow[];
  limit: number;
  /** "16 SIGNED", already capped at the limit. */
  signed: number;
  /** Seconds between re-reads while on screen (DEC-192), from the server. */
  refreshSeconds: number;
}) {
  const router = useRouter();
  // Taps not yet reflected in `rows`, by guest. A refused tap is dropped, so the row shows the
  // server's answer again.
  const [local, setLocal] = useState<Record<string, Local>>({});

  // A fresh read from the server (`rows` is a new array only when the page renders again) is the
  // truth for every row whose save has landed. Kept, a "saved" tap would hide what another phone
  // did to that guest since (code review, 18.5a). Taps still in flight, or failed, stay on top.
  const [readRows, setReadRows] = useState(rows);
  // Names a re-read brought in, highlighted for a moment — never on first load.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  if (rows !== readRows) {
    const before = new Set(readRows.map((r) => r.guestId));
    const added = rows.filter((r) => !before.has(r.guestId)).map((r) => r.guestId);
    setReadRows(rows);
    setLocal((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v.status !== "saved")));
    if (added.length > 0) setFresh(new Set(added));
  }
  useEffect(() => {
    if (fresh.size === 0) return;
    const t = setTimeout(() => setFresh(new Set()), 4000);
    return () => clearTimeout(t);
  }, [fresh]);

  // Re-read while on screen (DEC-192). `busy` is read by the timer, so it is a ref, kept current
  // after every render: a tap saving, or a read still out, skips the beat.
  const [reading, startReading] = useTransition();
  const busy = useRef(false);
  useEffect(() => {
    busy.current = reading || Object.values(local).some((v) => v.status === "saving");
  });
  useEffect(() => {
    const read = () => {
      if (document.visibilityState !== "visible" || busy.current) return;
      startReading(() => router.refresh());
    };
    const timer = setInterval(read, refreshSeconds * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") read();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, refreshSeconds]);

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
              <Row key={r.guestId} row={r} shiftId={shiftId} eventId={eventId} inert={full} fresh={fresh.has(r.guestId)} onTap={tap} onRetry={send} />
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
              <Row key={r.guestId} row={r} shiftId={shiftId} eventId={eventId} inert={false} fresh={false} onTap={tap} onRetry={send} />
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
  fresh,
  onTap,
  onRetry,
}: {
  row: CheckInRow & { status?: Local["status"] | undefined };
  shiftId: string;
  eventId: string;
  /** At the boat's limit, a row still to board takes no tap. */
  inert: boolean;
  /** Just arrived on a re-read: highlighted for a moment. */
  fresh: boolean;
  onTap: (guestId: string, on: boolean) => (e: MouseEvent) => void;
  onRetry: (guestId: string, on: boolean) => Promise<void>;
}) {
  const next = !row.checkedIn;
  return (
    <li
      data-new={fresh || undefined}
      className={`flex items-center transition-colors duration-700 motion-reduce:transition-none ${fresh ? "bg-ok-bg" : ""}`}
    >
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
