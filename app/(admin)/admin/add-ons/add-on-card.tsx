"use client";

import { useState } from "react";
import type { AddOn } from "@core/domain/entities.js";
import { Field, settingsInputClass } from "../../../../components/admin/settings-field";

/**
 * The "Add-on" facts card — **controlled client fields (#699)**. Same reasoning as
 * `admin/vessels/vessel-card.tsx`: the post-action RSC refresh resets uncontrolled inputs even
 * when nothing navigates, so the values are held in React.
 *
 * The checkboxes are controlled too, and that is not decoration: `active` defaults ON for a new
 * add-on, so a remount doesn't blank it — it silently flips it back to true after the operator
 * turned it off. A value that resets to a non-empty default is harder to notice than one that
 * resets to empty.
 */
export function AddOnCard({ addOn, creating }: { addOn: AddOn | null; creating: boolean }) {
  const isNew = creating || !addOn;
  const [label, setLabel] = useState(addOn?.label ?? "");
  const [amount, setAmount] = useState(addOn ? (addOn.amountCents / 100).toFixed(2) : "");
  const [required, setRequired] = useState(addOn?.required ?? false);
  const [active, setActive] = useState(isNew ? true : addOn.active);

  return (
    <section className="rounded-card border border-line bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Add-on</h2>
      </div>

      <div className="px-4 py-1">
        <Field label="Label" sub="what the customer sees">
          <input
            name="label"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={`${settingsInputClass} w-full max-w-[420px]`}
          />
        </Field>

        <Field label="Amount" sub="a flat charge, revenue">
          <span className="flex items-center gap-2">
            <span className="text-xs text-faint">$</span>
            <input
              name="amount"
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${settingsInputClass} max-w-[130px] font-mono`}
            />
          </span>
        </Field>

        <Field label="Required" sub="the customer must buy it">
          <label className="flex items-center gap-2 pt-1 text-sm text-ink">
            <input
              type="checkbox"
              name="required"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            Required at checkout
          </label>
        </Field>

        <Field label="Active" sub="uncheck to retire">
          <label className="flex items-center gap-2 pt-1 text-sm text-ink">
            {/* Default checked on a new add-on; retired add-ons drop from the offering picker
                + browse but keep their references (DEC-123 soft-delete). */}
            <input
              type="checkbox"
              name="active"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Available to attach to offerings
          </label>
        </Field>
      </div>
    </section>
  );
}
