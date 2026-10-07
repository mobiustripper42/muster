"use client";

import { useEffect, useState } from "react";
import { SubmitButton } from "../../../../../../../components/ui/submit-button";
import { confirmCount } from "./actions";
import { Input } from "../../../../../../../components/ui/input";
import { Card } from "../../../../../../../components/ui/card";

/**
 * The passenger count (Phase 18.5a; surfaces §C1, §C4): the mate's number, set separately from the
 * ticks, from 0 to the boat's limit, then **Confirm 16 aboard and depart** — or **Update count**
 * once one is recorded (it can change at any time; a new one replaces it).
 *
 * **Why this is an island (DEC-147 rule 2).** One hand on a moving deck: [–] and [+] beside a big
 * number beat a keyboard, and the button says the number it will record. Without JS the number is
 * a plain field and the button says "Confirm and depart"; the form posts the same either way.
 *
 * **It follows the page until the mate touches it** (operator, 2026-10-02). The page re-reads itself
 * (18.5b), so `start` climbs as people sign at the rail; an untouched stepper climbs with it, so the
 * one-tap button never says "Confirm 4" when sixteen have signed. Once the mate taps –/+ or types,
 * the number is theirs and a re-read leaves it alone.
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
  const [touched, setTouched] = useState(false);
  const [seenStart, setSeenStart] = useState(start);
  if (start !== seenStart) {
    setSeenStart(start);
    if (!touched) setText(String(start));
  }
  // The [–]/[+] buttons and the number in the button label need JS; until it runs, the plain field
  // and a label without a number are what a phone without JS keeps.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const n = Number(text);
  const valid = text.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= limit;
  const step = (d: number) => {
    setTouched(true);
    setText(String(Math.max(0, Math.min(limit, (valid ? n : start) + d))));
  };

  let label = "Confirm and depart";
  if (counted) label = "Update count";
  else if (ready && valid) label = `Confirm ${n} aboard and depart`;

  return (
    <Card action={confirmCount} as="form" className="flex flex-col gap-3">
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
          <Input
            id="pax"
            name="pax"
            type="number"
            inputMode="numeric"
            min={0}
            max={limit}
            step={1}
            required
            value={text}
            onChange={(e) => {
              setTouched(true);
              setText(e.target.value);
            }}
            // The count is the screen's one number, sized to match the 48px steppers beside it — the one
            // place a field overrides its text size and floor, so both carry `!` to win over <Input>'s.
            className="min-h-12! w-20 text-center font-mono text-2xl!"
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
    </Card>
  );
}
