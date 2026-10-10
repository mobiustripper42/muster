"use client";

import { Checkbox } from "../ui/choice";
import { money } from "./money";

/** "$30", not "$30.00", in a sentence; the summary row keeps the cents like every other row. */
function wholeDollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : money(cents);
}

/**
 * Cancellation insurance — optional (16.8, issue #683, SPEC §2.8.4c). A box after the tip, shared by
 * the customer's checkout and the operator's phone booking, so the two surfaces sell it the same
 * way. Only the hint differs: a customer reads what it does, an operator reads what to ask.
 *
 * `inputName` posts the choice, for a form that submits to a server action (the phone booking).
 * A browser posts an unticked box as nothing, which the action reads as no insurance.
 */
export function InsuranceBox({
  checked,
  onChange,
  priceCents,
  hint,
  inputName,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  priceCents: number;
  hint: string;
  inputName?: string;
}) {
  return (
    <div className="pt-5">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.07em] text-muted">
        Cancellation insurance <span className="font-normal normal-case text-muted">· optional</span>
      </div>
      <Checkbox
        data-testid="add-insurance"
        {...(inputName ? { name: inputName, value: "1" } : {})}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      >
        <span>
          <b className="font-semibold">Add cancellation insurance — {wholeDollars(priceCents)}</b>
          <span className="mt-0.5 block text-xs text-muted">{hint}</span>
        </span>
      </Checkbox>
    </div>
  );
}
