"use client";

import { useState } from "react";

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

  const selectClass = "rounded-lg border border-line bg-bg px-2 py-1.5 font-mono text-sm text-ink";

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
            className="flex select-none items-center gap-1.5 rounded-full border border-line bg-bg px-3 py-1 font-mono text-sm text-ink"
          >
            {t}
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={() => setTimes(times.filter((x) => x !== t))}
              className="text-faint hover:text-ink"
            >
              ×
            </button>
          </span>
        ))}
        {times.length === 0 && <span className="text-xs text-faint">No departures yet.</span>}
      </div>

      <div className="flex items-center gap-2">
        <select
          value={hh}
          onChange={(e) => setHh(e.target.value)}
          aria-label="New departure hour"
          className={selectClass}
        >
          <option value="">HH</option>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="font-mono text-sm text-faint">:</span>
        <select
          value={mm}
          onChange={(e) => setMm(e.target.value)}
          aria-label="New departure minute"
          className={selectClass}
        >
          <option value="">MM</option>
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={add}
          className="rounded-lg border border-dashed border-line bg-card px-3 py-1.5 text-sm text-accent"
        >
          + Add time
        </button>
      </div>
    </div>
  );
}
