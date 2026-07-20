"use client";

import { useState } from "react";

/**
 * Departure-times editor (12.8) — a small client island so the operator can add and remove
 * several departure times in one pass, instead of the one-time-per-save round trip a native
 * form forces. Times live in React state and each serializes to a hidden `departureTime`
 * input, which the server action reads via `getAll("departureTime")` — the island owns
 * interaction only; persistence stays on the server form. Plain-data props (no functions
 * server→client — RSC rule).
 */

export function DepartureTimesEditor({ initial }: { initial: string[] }) {
  const [times, setTimes] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");

  const add = () => {
    if (!draft || times.includes(draft)) return;
    setTimes([...times, draft].sort());
    setDraft("");
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
        <input
          type="time"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds the time instead of submitting the whole offering form.
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          aria-label="New departure time"
          className="rounded-lg border border-line bg-bg px-2 py-1.5 font-mono text-sm text-ink"
        />
        <button
          type="button"
          onClick={add}
          className="self-start rounded-lg border border-dashed border-line bg-card px-3 py-1.5 text-sm text-accent"
        >
          + Add time
        </button>
      </div>
    </div>
  );
}
