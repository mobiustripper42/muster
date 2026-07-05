"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** Calm inline spinner — currentColor ring, ~14px, no layout box of its own beyond
 * its fixed size. `animate-spin` (Tailwind). Decorative; the button carries
 * `aria-busy` for assistive tech. */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent align-[-2px]"
    />
  );
}

/**
 * Pending-aware submit button (#202 / #250 Layer 2, DEC-089) — a contained
 * `'use client'` island on top of a server-action `<form>`. While the form's
 * action is in flight it shows an inline spinner and sets `disabled` (the real
 * double-tap guard). It renders a real `type="submit"`, so **no-JS still submits**
 * (progressive enhancement) — the island only adds the "I heard you, working…"
 * beat the server round-trip can't. Pending auto-clears on the action's
 * `redirect()` (or when it throws — the form settles non-pending either way, so a
 * failed action never strands the button disabled).
 *
 * Same island family as `RelaySend` / `CopyButton`; extends the DEC-026 no-client-
 * JS posture for pending state only (DEC-089). Plain nav `<Link>`s and `<details>`
 * toggles have no pending state and stay press-only (Layer 1's `:active` cue).
 *
 * **Multi-submit forms** (the crew In/Out ask: one form, two buttons): give each
 * button a distinct `name`/`value`. `useFormStatus().pending` is form-wide (both
 * buttons `disabled`), but `.data` carries the submitted FormData, so a NAMED
 * button spins only when its own `name`/`value` is the pair that was submitted.
 * This is derived from serializable props on purpose — a function prop can't cross
 * the Server→Client boundary (`AskCard` is a Server Component).
 */
export function SubmitButton({
  children,
  className,
  name,
  value,
  title,
}: {
  children: ReactNode;
  className?: string;
  name?: string;
  value?: string;
  title?: string;
}) {
  const { pending, data } = useFormStatus();
  // `mine` = this button fired the pending submit. A named button (multi-submit
  // form) matches its own name/value in the submitted FormData; an unnamed button
  // is the form's sole submit, so it spins whenever the form is pending.
  const mine =
    pending && (name != null ? data?.get(name) === value : true);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      title={title}
      disabled={pending}
      aria-busy={mine}
      // `relative` only while spinning, to host the centered spinner overlay.
      className={mine ? `relative ${className ?? ""}` : className}
    >
      {mine ? (
        <>
          {/* Label stays in flow but `opacity-0` (NOT `invisible`/visibility:hidden,
              which would drop it from the a11y tree and leave a busy button with no
              accessible name). Opacity keeps the name and reserves the exact width,
              so the button never grows/jitters when pending flips (DEC-042 calm, the
              @architect no-layout-shift mod). Spinner overlays it, centered. */}
          <span className="opacity-0">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
