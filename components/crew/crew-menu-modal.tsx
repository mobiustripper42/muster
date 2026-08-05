"use client";

import { useEffect } from "react";

/**
 * Makes the crew drawer behave like a modal (#644 follow-up, operator 2026-08-05).
 *
 * **An island earned under DEC-147 rule 2, and the "where it can" clause is why it exists.** The
 * drawer itself is a `<details>` so it opens and closes with no JS — that part is not negotiable,
 * because the hub's navigation moved into it and a JS-less crew member must not be stranded. But
 * three things a modal needs cannot be expressed in CSS, and all three were reported as bugs:
 *
 * 1. **The page behind stayed operable.** The backdrop blocks the pointer, but focus does not
 *    care: the pay-period `<select>` on `/crew/time` was still reachable and still changed value
 *    with the drawer open — "it's grey but you can select anything". Only `inert` fixes that, and
 *    `inert` cannot be applied to an element's siblings from CSS.
 * 2. **Tapping the dimmed page did nothing.** The backdrop is a `::before`, so it hit-tests as
 *    the element that owns it and never activates the summary — a `<details>` toggles only on
 *    clicks inside the summary's own border box. A dead click on a dimmed page reads as a broken
 *    app, so the handler below closes on a click that lands on the details itself.
 * 3. **Escape.** Native `<details>` has no Escape, and the AC asks for keyboard dismissal.
 *
 * Everything here is enhancement. With JS off the drawer still opens and closes on the summary,
 * which is now drawn ABOVE the panel and swaps to an ✕ (see `crew-menu.tsx`) so there is always a
 * visible way out — the bug that made this file necessary was that at 375px the panel covered the
 * only control that could close it.
 *
 * Inerting is per-sibling rather than on `<main>` itself, because the drawer lives inside the
 * header inside main: inerting main would inert the drawer too, and `inert` cannot be lifted from
 * a subtree once an ancestor sets it.
 */
export function CrewMenuModal() {
  useEffect(() => {
    const details = document.querySelector<HTMLDetailsElement>("details[data-crew-menu]");
    if (!details) return;
    const panel = details.querySelector<HTMLElement>("[data-crew-menu-panel]");
    const summary = details.querySelector<HTMLElement>("summary");
    const main = details.closest("main");

    /** Everything the drawer is layered over — main's children other than the header holding it,
     *  plus the back link, which sits in that header beside the summary. */
    const behind = (): HTMLElement[] => {
      if (!main) return [];
      const sibs = Array.from(main.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && !el.contains(details),
      );
      const back = details.closest("header")?.querySelector<HTMLElement>("a[data-crew-back]");
      return back ? [...sibs, back] : sibs;
    };

    const sync = () => {
      const open = details.open;
      for (const el of behind()) el.inert = open;
    };

    const close = () => {
      details.open = false;
      sync();
    };

    const onToggle = () => sync();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && details.open) close();
    };
    // A click that lands on the summary but OUTSIDE its own box is a backdrop click — the
    // `::before` covers the viewport and hit-tests as the summary. Inside the box is the real
    // control and the browser's own toggle handles it.
    const onClick = (e: MouseEvent) => {
      if (!details.open) return;
      if (panel?.contains(e.target as Node)) return;
      if (summary?.contains(e.target as Node)) return; // the browser's own toggle owns this
      // The backdrop is the details' own `::before`, so a tap on it hit-tests as the details.
      if (e.target === details) close();
    };

    // Tells the e2e suite the enhancement is live. Without it a test can click faster than
    // hydration and conclude that Escape or `inert` is broken when it simply had not attached.
    details.setAttribute("data-crew-menu-ready", "");
    details.addEventListener("toggle", onToggle);
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    sync();
    return () => {
      details.removeEventListener("toggle", onToggle);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
      details.removeAttribute("data-crew-menu-ready");
      for (const el of behind()) el.inert = false;
    };
  }, []);

  return null;
}
