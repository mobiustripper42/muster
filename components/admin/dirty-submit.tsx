"use client";

import { useFormGuard } from "../ui/unsaved-guard";
import { SubmitButton } from "../ui/submit-button";

/**
 * A submit button that stays disabled until its form actually changes — and, while it
 * is dirty, guards against navigating away from the unsaved edit.
 *
 * **Disabled until dirty.** A row of always-live Save buttons reads as "there is
 * something to do here" on every punch the operator is only *looking* at (operator,
 * 2026-08-01). This makes the one row they edited the only one offering to save.
 *
 * **Deliberately not optimistic.** An optimistic save would paint success before the
 * server answered, and these writes are refusable — `out_before_in`, `day_moved`,
 * `already_in` all come back as codes the page maps to copy. Showing "saved" and then
 * not having saved is worse on a surface whose output is a paycheck. The pending
 * spinner (DEC-089, via {@link SubmitButton}) covers the in-flight moment.
 *
 * **The navigation guard moved out at #781** into {@link useFormGuard}, which now covers
 * ten surfaces rather than this component's two. Everything this file used to say about
 * `beforeunload`, capture-phase anchor clicks and `AutoSubmitSelect` lives there, along
 * with the Back/Forward case none of them caught. This component is what is left once
 * the guard is shared: the guard, plus a button wired to it.
 *
 * **One behaviour changed here, and it reaches a money-computed surface.** Dirtiness is
 * now a comparison against the form's mount-time values rather than a flag set by the
 * first `input` event (`components/ui/form-dirty.ts`), so Save **re-disables** when a
 * punch is edited and then put back exactly as it was. Previously it stayed enabled for
 * the rest of the page's life. Saving an unchanged punch was always a no-op write, so
 * nothing about a paycheck changes — but `/admin/time-clock` and `/crew/time` are the
 * two callers, and that is a surface worth eyeballing rather than assuming.
 *
 * **No-JS:** the effect never runs, the button renders from the server as enabled, and
 * there is no guard — a no-JS operator gets the previous always-live behaviour rather
 * than a dead button.
 */
export function DirtySubmit({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { ref, dirty } = useFormGuard();

  return (
    <span ref={ref} className="contents">
      <SubmitButton className={className} disabled={!dirty}>
        {children}
      </SubmitButton>
    </span>
  );
}
