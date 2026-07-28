---
id: DEC-090
title: "Click & loading feedback — the standing rule (`<SubmitButton>` for submits, `<AppLink>` for links; lint-enforced)"
topic: "UI, brand & frontend patterns"
---

## DEC-090: Click & loading feedback — the standing rule (`<SubmitButton>` for submits, `<AppLink>` for links; lint-enforced)

**Decision:** Every interactive control gives feedback, by construction. Three layers:

1. **Press feedback** (instant, zero-JS, automatic) — a global `@layer base` rule in `app/globals.css` darkens/shrinks any `button`/`[role=button]` and dips the opacity of any `a` on `:active`. Applies to every control forever, no wiring.
2. **In-flight spinner for form submits** — `<SubmitButton>` (DEC-089). A raw `<button type="submit">` in a server-action form must be a `<SubmitButton>`.
3. **In-flight spinner for navigations** — `<AppLink>` (`components/ui/app-link.tsx`): a `next/link` with `<NavSpinner>` (`useLinkStatus`) built in. **Every internal link is an `<AppLink>`**; raw `next/link` is reserved for the wrapper itself. `tel:`/`mailto:`/external/`#` targets are plain `<a>` (no page load, no spinner — AppLink also auto-suppresses). `spinner="overlay"` for card/row links (scrim + centered spinner over a `relative` box); `spinner="inline"` (default) for text/nav links.

**Why every internal link gets one:** every page is `force-dynamic` — there are no "fast" internal navigations, so every one deserves feedback.

**Minimum display time (`useHeld`, ~600ms):** both spinners are held for a floor duration so a fast round-trip still shows a *visible* spinner rather than a sub-frame flash (the earlier bug — the spinner rendered but for ~15ms, so it effectively wasn't there). The hold is a floor, not an addition; it can't outlive an unmount (a redirecting button), but same-surface cases (a row opening a pane, a non-redirecting submit) get the full floor.

**Enforcement (lint):** ESLint (`eslint.config.mjs`, the project's first — minimal, via the typescript-eslint parser) enforces it: `no-restricted-imports` bans the raw `next/link` default import (use `<AppLink>`); `no-restricted-syntax` flags raw `<button type="submit">` (use `<SubmitButton>` or `<GetFormSubmit>`). Wired into `verify` + CI, so a raw link/button fails the build. Exempt: the wrapper components, and `outbox-card.tsx` (owns its optimistic "Sent ✓"/"Copied ✓" feedback). **Phase:** 9.
