"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { useHeld } from "./use-held";

/** Inline spinner — currentColor ring, ~20px so it's clearly visible in a button.
 * `animate-spin` (Tailwind). Decorative; the button carries `aria-busy` for AT. */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-[3px] border-current border-r-transparent"
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
 * **Multi-submit forms** (the crew Yes/No ask: one form, two buttons): give each
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
  disabled,
  formAction,
  formNoValidate,
  "aria-label": ariaLabel,
  "data-commits": dataCommits,
}: {
  children: ReactNode;
  className?: string;
  name?: string;
  value?: string;
  title?: string;
  /** Disable for a reason of the caller's own (e.g. nothing has changed yet — see
   *  `DirtySubmit`). Additive: pending still disables regardless. */
  disabled?: boolean;
  /**
   * Marks a button that COMMITS in a single press — money moves, or state changes, with no
   * further confirmation. Purely declarative: nothing in this component reads it. It exists so a
   * test can ask "what would a stray second tap actually do here?" without matching on visible
   * labels, which change for copy reasons and would silently stop matching (#616 / DEC-152).
   */
  "data-commits"?: string | undefined;
  /** Post this form's fields to a DIFFERENT server action — the second-verb button
   *  (#635's Delete, which shares the edit form's one reason field). Native HTML, so
   *  it still works with no JS. */
  formAction?: (formData: FormData) => void | Promise<void>;
  /**
   * Skip the browser's own field validation for THIS submit — native HTML, no JS needed.
   *
   * For a button that restructures the form rather than committing it: #861's "Add a role"
   * appends a crew row, and the row you are adding one from is frequently a blank `required`
   * select, so without this the browser refuses the very submit that would let you fill it in.
   * The server still validates on the real save.
   */
  formNoValidate?: boolean;
  /** For an icon/short-label button whose accessible name needs to be fuller. */
  "aria-label"?: string;
}) {
  const { pending, data } = useFormStatus();
  // `mine` = this button fired the pending submit. A named button (multi-submit
  // form) matches its own name/value in the submitted FormData; an unnamed button
  // is the form's sole submit, so it spins whenever the form is pending.
  const mine =
    pending && (name != null ? data?.get(name) === value : true);
  // Held for a minimum beat so a fast submit still shows a visible spinner.
  const showing = useHeld(mine);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      title={title}
      formAction={formAction}
      formNoValidate={formNoValidate}
      aria-label={ariaLabel}
      disabled={pending || disabled}

      data-commits={dataCommits}
      aria-busy={showing}
      // `relative` only while spinning, to host the centered spinner overlay.
      className={showing ? `relative ${className ?? ""}` : className}
    >
      {showing ? (
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
