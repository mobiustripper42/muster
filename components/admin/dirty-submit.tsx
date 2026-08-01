"use client";

import { useEffect, useRef, useState } from "react";
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
 * **Listens on the enclosing FORM, not on a wrapper around the button.** The first cut
 * wrapped the button in a `<span onInput>`, which never fired: the inputs are siblings
 * of that span, so their events bubble to the form and stop there. Reached through the
 * button's own `.form` — no prop threading, and it covers any field the caller adds.
 *
 * **The navigation guard has two halves, because one doesn't cover the other.**
 * `beforeunload` catches a reload, a tab close, or a link out of the app — but NOT an
 * in-app `AppLink`, which is a client-side `router.push` and fires no unload. The day
 * ‹/› steps and the view tabs are exactly that. So a capture-phase click listener
 * intercepts anchor clicks while dirty and asks first. Both are removed the moment the
 * form is submitted, so saving never argues with you on the way out.
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
  const [dirty, setDirty] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const mark = () => setDirty(true);
    // `change` covers a committed select/date pick; `input` covers typing into a time
    // field, where `change` only lands on blur.
    form.addEventListener("input", mark);
    form.addEventListener("change", mark);
    const clear = () => setDirty(false);
    form.addEventListener("submit", clear);
    return () => {
      form.removeEventListener("input", mark);
      form.removeEventListener("change", mark);
      form.removeEventListener("submit", clear);
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;

    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers show their own wording; returnValue is the legacy trigger.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);

    // In-app navigation never fires `beforeunload` — intercept the click instead.
    // Capture phase so this runs before Next's router picks the event up.
    const guard = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor || anchor.target === "_blank") return;
      if (!window.confirm("You have an unsaved change on this punch. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", guard, true);

    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guard, true);
    };
  }, [dirty]);

  return (
    <span ref={ref} className="contents">
      <SubmitButton className={className} disabled={!dirty}>
        {children}
      </SubmitButton>
    </span>
  );
}
