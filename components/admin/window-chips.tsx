import type { ReactNode } from "react";
import type { Scope } from "./shifts-view-types";
import { AppLink } from "../ui/app-link";
import { GetFormSubmit } from "../ui/get-form-submit";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { chipLook } from "../ui/choice";

/** What each preset chip says. `range` has no chip — it is the From/To form's. */
const PRESET_LABEL: Partial<Record<Scope, string>> = {
  today: "Today",
  weekend: "Weekend",
  next7: "Week",
  next8to15: "2 Weeks out",
  days30: "30 Days",
  past: "Past",
  all: "All",
};

/**
 * The preset chips row and the **More filters** From/To `<details>`, shared by All Shifts and
 * Purchases (issue #1142) — lifted out of `shifts-filter.tsx` so both pages draw the window one
 * way. Renders no `Card`: the page's filter bar owns that, and `children` land inside the
 * `<details>` after the From/To form (All Shifts' crew select and toggles).
 *
 * Plain links and a no-JS GET form (DEC-026). `hidden` is the From/To form's hidden fields —
 * carrying no window key, or a carried preset would beat the submitted range.
 */
export function WindowChips({
  kind,
  from,
  to,
  presets,
  hrefFor,
  hidden,
  submitLabel,
  open,
  children,
}: {
  kind: Scope;
  from: string;
  to: string;
  /** Which presets to show, in order. */
  presets: readonly Scope[];
  hrefFor: (preset: Scope) => string;
  /** The From/To form's hidden fields. */
  hidden: ReactNode;
  submitLabel: string;
  /** Whether the panel opens by default — when something inside it is in effect. */
  open: boolean;
  /** Rendered inside the `<details>` after the From/To form. */
  children?: ReactNode;
}) {
  // The chip face, dark when on (issue #484): a link cannot be a <Chip>, so it wears its look.
  const chip = (active: boolean) => `pressable ${chipLook(active, "dense")}`;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {presets.map((p) => (
          <AppLink key={p} href={hrefFor(p)} className={chip(kind === p)}>
            {PRESET_LABEL[p]}
          </AppLink>
        ))}
      </div>

      {/* Custom date range, tucked behind a no-JS <details> toggle (DEC-026 — native
          disclosure, no client JS). Open by default when something in it is actually active so
          an in-effect filter is never hidden. */}
      <details open={open} className="flex flex-col gap-2">
        <summary className="btn-quiet select-none text-xs">More filters</summary>

        <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
          {hidden}
          <Field label="From" htmlFor="filter-from">
            <Input id="filter-from" type="date" name="from" defaultValue={from} density="dense" />
          </Field>
          <Field label="To" htmlFor="filter-to">
            <Input id="filter-to" type="date" name="to" defaultValue={to} density="dense" />
          </Field>
          <GetFormSubmit className="btn-secondary btn-sm">{submitLabel}</GetFormSubmit>
        </form>

        {children}
      </details>
    </>
  );
}
