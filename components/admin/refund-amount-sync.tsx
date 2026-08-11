"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps the cancel confirm's refund amount in step with the who-cancelled radio (#616).
 *
 * **What it buys (DEC-147 rule 2).** The published-terms figure differs by reason — full refund
 * when we cancelled, minus the $50 fee when the customer did — and a server round-trip cannot
 * update a text input in response to a radio without either an extra click or a prefill that
 * silently belongs to the other option. The operator asked for one press; this is what makes the
 * number in the box true at the moment they press it.
 *
 * **Nothing depends on it, by construction.** With JS off the box stays empty, and an empty box
 * means "use the figure for whichever reason was posted" — computed server-side in
 * `cancelBooking` from the same `quoteCancelRefund` these props were rendered from. So the island
 * writes a value the server would have arrived at anyway; it is visible confirmation, never the
 * source of truth. That is why it is safe to sit on a money path at all.
 *
 * **It stops the moment the operator types.** Overwriting a hand-entered refund amount because a
 * radio moved would be the worst thing this component could do, so the first real keystroke in
 * the field retires the sync permanently. `defaultValue` is never set — React must not own this
 * input, or the server's blank-means-compute contract stops holding when JS fails to load.
 */
export function RefundAmountSync({
  inputId,
  radioName,
  /** Cents per radio value, e.g. `{ customer: 53880, operator: 58880 }`. */
  amountByReason,
}: {
  inputId: string;
  radioName: string;
  amountByReason: Record<string, number>;
}) {
  const touched = useRef(false);

  useEffect(() => {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (!input) return;
    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${radioName}"]`),
    );
    if (radios.length === 0) return;

    const sync = (): void => {
      if (touched.current) return;
      const chosen = radios.find((r) => r.checked);
      const cents = chosen ? amountByReason[chosen.value] : undefined;
      // An unknown reason leaves the box alone rather than writing 0 — blank still means
      // "server computes", which is the correct answer for a value this island cannot resolve.
      if (cents === undefined) return;
      input.value = (cents / 100).toFixed(2);
    };

    const markTouched = (): void => {
      touched.current = true;
    };

    sync();
    radios.forEach((r) => r.addEventListener("change", sync));
    input.addEventListener("input", markTouched);
    return () => {
      radios.forEach((r) => r.removeEventListener("change", sync));
      input.removeEventListener("input", markTouched);
    };
  }, [inputId, radioName, amountByReason]);

  return null;
}
