"use client";

import { useState } from "react";
import { Select } from "../../../../components/ui/input";

/**
 * Departure-times editor (12.8) — a small client island so the operator can add and remove
 * several departure times in one pass, instead of the one-time-per-save round trip a native
 * form forces. Times live in React state and each serializes to a hidden `departureTime`
 * input, which the server action reads via `getAll("departureTime")` — the island owns
 * interaction only; persistence stays on the server form. Plain-data props (RSC rule).
 *
 * Time entry is an hour + quarter-hour pair of selects, NOT a free `type="time"` field: it
 * constrains choices to :00/:15/:30/:45 visibly and reliably (a native time input's `step`
 * doesn't restrict the picker UI). A richer picker can come later; this guarantees the grid.
 */

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];

export function DepartureTimesEditor({ initial }: { initial: string[] }) {
  const [times, setTimes] = useState<string[]>(initial);
  const [hh, setHh] = useState("");
  const [mm, setMm] = useState("");

  const add = () => {
    if (hh === "" || mm === "") return;
    const t = `${hh}:${mm}`;
    if (times.includes(t)) return;
    setTimes([...times, t].sort());
    setHh("");
    setMm("");
  };

  return (
    <div className="flex flex-col gap-2">
      {/* The serialized list — what the form submits (getAll("departureTime")). */}
      {times.map((t) => (
        <input key={t} type="hidden" name="departureTime" value={t} />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        {times.map((t) => (
          <span
            key={t}
            // eslint-disable-next-line muster/pill -- token (issue #484): a value you typed, removed with ×, not a choice; "10:00" never wraps
            className="flex select-none items-center gap-1.5 rounded-full border border-line bg-bg px-3 py-1 font-mono text-sm text-ink"
          >
            {t}
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={() => setTimes(times.filter((x) => x !== t))}
              className="text-muted hover:text-ink"
            >
              ×
            </button>
          </span>
        ))}
        {times.length === 0 && <span className="text-xs text-muted">No departures yet.</span>}
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={hh}
          onChange={(e) => setHh(e.target.value)}
          aria-label="New departure hour"
          density="dense"
          className="font-mono"
        >
          <option value="">HH</option>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </Select>
        <span className="font-mono text-sm text-muted">:</span>
        <Select
          value={mm}
          onChange={(e) => setMm(e.target.value)}
          aria-label="New departure minute"
          density="dense"
          className="font-mono"
        >
          <option value="">MM</option>
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <button
          type="button"
          onClick={add}
          className="rounded-box border border-dashed border-line px-3 py-1.5 text-sm text-accent"
        >
          + Add time
        </button>
      </div>
    </div>
  );
}
