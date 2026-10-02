"use client";

import { useEffect, useState } from "react";
import { SubmitButton } from "../../../../../../../components/ui/submit-button";
import { confirmCount } from "./actions";

/**
 * The passenger count (Phase 18.5a; surfaces §C1, §C4): the mate's number, set separately from the
 * ticks, from 0 to the boat's limit, then **Confirm 16 aboard and depart** — or **Update count**
 * once one is recorded (it can change at any time; a new one replaces it).
 *
 * **Why this is an island (DEC-147 rule 2).** One hand on a moving deck: [–] and [+] beside a big
 * number beat a keyboard, and the button says the number it will record. Without JS the number is
 * a plain field and the button says "Confirm and depart"; the form posts the same either way.
 */
export function PassengerCount({
  shiftId,
  eventId,
  start,
  limit,
  counted,
}: {
  shiftId: string;
  eventId: string;
  /** Where the number starts: the recorded count, else the number signed — capped at the limit. */
  start: number;
  limit: number;
  /** A count is already recorded: the button updates it. */
  counted: boolean;
}) {
  const [text, setText] = useState(String(start));
  // The [–]/[+] buttons and the number in the button label need JS; until it runs, the plain field
  // and a label without a number are what a phone without JS keeps.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const n = Number(text);
  const valid = text.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= limit;
  const step = (d: number) => setText(String(Math.max(0, Math.min(limit, (valid ? n : start) + d))));

  let label = "Confirm and depart";
  if (counted) label = "Update count";
  else if (ready && valid) label = `Confirm ${n} aboard and depart`;

  return (
    <form action={confirmCount} className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-3">
      <input type="hidden" name="shiftId" value={shiftId} />
      <input type="hidden" name="eventId" value={eventId} />
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="pax" className="text-xs font-semibold uppercase tracking-wide text-muted">
          Passengers
        </label>
        <div className="flex items-center gap-2">
          {ready && (
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={valid && n <= 0}
              aria-label="One fewer passenger"
              className="btn-secondary min-h-[48px] min-w-[48px] text-xl"
            >
              –
            </button>
          )}
          <input
            id="pax"
            name="pax"
            type="number"
            inputMode="numeric"
            min={0}
            max={limit}
            step={1}
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[48px] w-20 rounded-card border border-line bg-bg text-center font-mono text-2xl text-ink"
          />
          {ready && (
            <button
              type="button"
              onClick={() => step(1)}
              disabled={valid && n >= limit}
              aria-label="One more passenger"
              className="btn-secondary min-h-[48px] min-w-[48px] text-xl"
            >
              +
            </button>
          )}
        </div>
      </div>
      <SubmitButton className="btn-primary min-h-[52px] w-full">{label}</SubmitButton>
    </form>
  );
}
