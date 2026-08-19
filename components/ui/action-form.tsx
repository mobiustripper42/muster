"use client";

/**
 * A form whose action reports failure **without navigating** (#699, DEC-147 as amended 2026-08-18).
 *
 * **What it buys, and why a server round-trip cannot.** The admin editors post to a server action
 * that used to `redirect()` with an `?err=` code on a validation refusal. The redirect *is* the
 * data loss: it remounts the form, and every uncontrolled input goes back to its `defaultValue`.
 * The operator hit this creating an offering — one incomplete price variation, thirty fields
 * gone — and reported it as *"the error was mine; the data loss was not."* No amount of
 * server-side care preserves a dirty DOM value across a navigation, which is precisely the
 * "server round-trips genuinely cannot deliver" test DEC-147 rule 2 reserves an island for.
 *
 * **The island is this file and nothing else.** Fields stay Server Components with `defaultValue`
 * and arrive as `children` — the DEC-133 pass-through technique. Values survive because this
 * component *does not navigate*: no redirect → no `sel` change → no `key` flip → no remount →
 * the dirtied DOM nodes keep what was typed. Nothing is lifted into `useState`.
 *
 * **Do not "improve" this by controlling the fields.** A sibling project does exactly that, but
 * only because its component library's `Select` requires controlled state. Muster uses native
 * inputs, so lifting them would convert ~30 server-rendered fields per surface into client state
 * — a page-sized island, and the rule-2 violation DEC-147 names explicitly ("never a page").
 *
 * **Codes, never prose.** The action returns a code from the surface's own union; the copy table
 * crosses as plain data. DEC-147 rule 3's content requirement holds on this channel exactly as it
 * does in the URL — and its *security* half gets stronger, because the code never touches the
 * address bar, so there is no attacker-controllable input to the lookup at all.
 */
import { useActionState, type ReactNode } from "react";

import { Notice } from "./notice";

export function ActionForm<K extends string>({
  action,
  errCopy,
  fallback,
  className,
  children,
}: {
  /**
   * A `"use server"` action in `useActionState` shape. **Pass it bare, never `.bind()`-ed** —
   * React only progressively enhances the un-bound form, and binding client-side is how you
   * silently lose the no-JS post. Ids belong in a hidden input, which these forms already do.
   */
  action: (prev: K | null, formData: FormData) => Promise<K | null>;
  /** The surface's own code→copy table. Plain data, authored server-side. */
  errCopy: Readonly<Record<K, string>>;
  /** Shown when the action returns a code the table doesn't carry. */
  fallback: K;
  className?: string;
  children: ReactNode;
}) {
  const [code, formAction] = useActionState(action, null);
  // `Object.hasOwn`, matching `errCopyFor`: `code` is typed, but a stale deploy can return one
  // this table hasn't got, and plain access on a name like `constructor` yields a FUNCTION —
  // which React renders by throwing. Cheaper to keep the guard than to reason about when it's safe.
  const message =
    code === null ? null : Object.hasOwn(errCopy, code) ? errCopy[code] : errCopy[fallback];

  return (
    <form action={formAction} className={className}>
      {/* **The slot is ALWAYS mounted, and that is load-bearing.** Rendering
          `{message && <Notice/>}` directly here looks equivalent and is not: on the first
          refusal the Notice *appears*, every unkeyed sibling below it shifts one index, React
          reconciles each child against its neighbour's position, and the whole form remounts —
          wiping exactly the typed values this component exists to protect. It fails in the one
          scenario the component is for, which is the hardest kind of bug to spot in review.
          A constant wrapper keeps `children` at a stable index; only the wrapper's contents change. */}
      <div>{message !== null && <Notice tone="bad">{message}</Notice>}</div>
      {children}
    </form>
  );
}
