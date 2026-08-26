"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { bornFormState, formState } from "./form-dirty";
import { confirmLeaveOnce, forgetDirty, markDirty, retainBackTrap } from "./dirty-state";

/**
 * Ask before walking away from an unsaved edit (#781).
 *
 * Issue #699 and issue #780 cover work lost to a **refused save**. This covers the ordinary way
 * it goes: a half-filled form, a click on the master list inches away, and it is gone with no
 * prompt and no trace.
 *
 * ## Four exits, and no one mechanism covers more than two of them
 *
 *  1. **Reload, tab close, an external URL, the address bar** — `beforeunload`. The browser owns
 *     the wording; there is no copy control and none is available.
 *  2. **In-app links** — an `AppLink` is a client-side push that fires no unload at all, so a
 *     capture-phase `click` listener intercepts the anchor before Next's router sees it. This is
 *     the common case here: every CRUD surface is master–detail, and the list that navigates
 *     away sits inches from the fields being typed into.
 *  3. **`AutoSubmitSelect` / `AutoSubmitDate`** — navigate from a `change` handler and are not
 *     anchors, so they consult the shared registry in `dirty-state.ts` themselves.
 *  4. **Back and Forward** — fire neither an unload nor a click. See the sentinel below.
 *
 * All four release the moment the form submits, so saving never argues with you on the way out.
 *
 * ## No-JS
 *
 * The effect never runs and there is no guard, which is the status quo rather than a regression
 * (DEC-147: the form still posts without JS, and this island adds nothing the form needs).
 */

/**
 * Track the enclosing form's dirtiness and guard every exit while it is dirty.
 *
 * **Listens on the enclosing FORM, reached through the returned ref's `.closest("form")`** — no
 * prop threading, and it covers any field the caller adds later. The first version of this in
 * `DirtySubmit` wrapped the button in a `<span onInput>`, which never fired: the inputs are
 * siblings of that span, so their events bubble to the form and stop there.
 *
 * Returns `dirty` because {@link DirtySubmit} needs it for a button, and because a hook is how
 * the guard and that button share one definition rather than two spellings of it.
 */
export function useFormGuard(opts: { restored?: boolean } = {}): {
  ref: RefObject<HTMLSpanElement | null>;
  dirty: boolean;
} {
  // **A form re-rendered after a refusal starts dirty and never goes clean until it submits.**
  //
  // No baseline makes this case right, which is the part worth knowing before "improving" it.
  // Everywhere else, dirty asks *has this diverged from what the server rendered*. Here the
  // question is *has this been saved*, and the answer is no whatever the boxes currently hold —
  // so clearing the fields must not silence it either.
  //
  // The trap this replaces: `form-draft.ts` hands the submitted values back as the form's
  // DEFAULTS (DEC-147 rule 4), and the baseline is read from exactly those defaults, so a
  // restored form is born equal to itself and compares CLEAN. The guard was therefore inert on
  // the one screen where the operator most reliably has work worth protecting — they had just
  // failed to save it. Found by the operator by hand; the test that used to cover this asserted
  // the opposite and passed. See DEC-160's 2026-08-25 amendment.
  const [dirty, setDirty] = useState(opts.restored === true);
  const ref = useRef<HTMLSpanElement>(null);
  // Identity for this form's entry in the shared registry — several rows are on screen at once
  // on the per-row surfaces, and each owns its own dirtiness.
  const token = useMemo(() => Symbol("form-guard"), []);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;

    // The values the form was BORN with — read from its server-rendered defaults rather than
    // from whatever is in it right now, because this effect runs at hydration and the form is
    // typeable before that. See `bornFormState`; snapshotting the live form here read an
    // already-typed value as the baseline and left the guard silent on real work.
    const born = bornFormState(form);

    // `change` covers a committed select or date pick; `input` covers typing into a text or time
    // field, where `change` only lands on blur.
    //
    // On a RESTORED form this never lowers the flag — a refused submission stays unsaved however
    // the boxes are edited afterwards, including back to empty.
    const recompute = () =>
      setDirty(opts.restored === true || formState(form) !== born);
    form.addEventListener("input", recompute);
    form.addEventListener("change", recompute);

    // **Evaluate once now, not only on the next keystroke.** The form is typeable before this
    // effect runs — that is what hydration means — and an edit made in that window fired its
    // `input` event at nobody. Without this line the guard stays blind to it until the operator
    // happens to type again, so the work most at risk (typed the instant the page appeared, on
    // the slow cold route where the window is widest) is precisely the work it would miss.
    // Safe to call unconditionally: `born` comes from the server-rendered defaults, so on a form
    // nobody has touched this computes clean.
    recompute();
    const clear = () => setDirty(false);
    form.addEventListener("submit", clear);

    return () => {
      form.removeEventListener("input", recompute);
      form.removeEventListener("change", recompute);
      form.removeEventListener("submit", clear);
      forgetDirty(token);
    };
  }, [token, opts.restored]);

  // Publish to the shared registry so the auto-submitting pickers can see it.
  useEffect(() => {
    markDirty(token, dirty);
  }, [token, dirty]);

  // The Back/Forward trap is page-level and refcounted (`retainBackTrap`), not per-form: there
  // is one back stack, so two guarded forms on one page must not push two sentinels. It arms for
  // the whole mount rather than while dirty — a pop with nothing dirty is consumed transparently,
  // so arming early costs nothing and closes the hole where a Back press during a momentarily
  // clean form silently spent the sentinel.
  useEffect(() => retainBackTrap(), []);

  useEffect(() => {
    if (!dirty) return;

    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers show their own wording; returnValue is the legacy trigger.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);

    // Capture phase, so this runs before Next's router picks the event up.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor || anchor.target === "_blank") return;
      // `confirmLeaveOnce`, not `confirmLeaveIfDirty`: two dirty forms on one page each have a
      // listener on this event, and asking per listener showed two dialogs for one click.
      if (!confirmLeaveOnce(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  return { ref, dirty };
}

/**
 * Drop this inside a `<form>` to guard it. Renders nothing.
 *
 * **Pass `restored` when THIS FORM is being re-rendered after a refusal.** The page hands the
 * fact over rather than the island inferring it, because the island cannot tell restored values
 * from ordinary defaults — that is the whole defect this exists to fix (DEC-160, 2026-08-25).
 *
 * **Per form, not per surface**, and the distinction is not pedantic. A draft is scoped to the
 * surface, but a surface can hold two independently-submittable forms and only one of them can
 * own the draft: `/crew/time-off` renders an add-window form and a weekday-blackout form, and
 * only `addMyTimeOff` ever writes a draft. Wiring both from the page-level `draft !== null` marks
 * a form permanently dirty while it holds nothing but what is already saved. Ask which form's
 * fields the draft actually restores; the others pass nothing.
 *
 * `display: contents` so it never affects the form's layout — the span exists only as a handle
 * for `.closest("form")`.
 */
export function UnsavedGuard({ restored = false }: { restored?: boolean } = {}) {
  const { ref } = useFormGuard({ restored });
  // `data-testid` so a test can wait for React to own this island before asserting that it
  // guards anything (`e2e/fixtures.ts` `isHydrated`). Nothing can guard before it exists, and a
  // test that clicks away during that window reads as "no guard" while reporting nothing useful.
  return <span ref={ref} className="contents" data-testid="unsaved-guard" />;
}
