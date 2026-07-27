---
id: DEC-089
title: "`<SubmitButton>` — standing pending-state client island for async form submits (#202/#250, Layer 2)"
topic: "UI, brand & frontend patterns"
---

## DEC-089: `<SubmitButton>` — standing pending-state client island for async form submits (#202/#250, Layer 2)

**Decision:** A single contained `'use client'` island `components/ui/submit-button.tsx` using `useFormStatus()` gives every server-action form an inline pending state: a calm `animate-spin` spinner (currentColor, ≤1em) **and** `disabled` while the enclosing form is pending. The spinner overlays the label (label kept in-flow but `opacity-0` — **not** `visibility:hidden`, which would strip the button's accessible name while busy — reserving its width) so the button never grows or jitters when pending flips — no layout shift. Renders a real `type="submit"`, so no-JS still posts (progressive enhancement); pending auto-clears on the action's `redirect()`. `MiniButton` folds into it. Wired at ~10 sites: In/Out ask, confirm-into-seat, place-X override, remove/bailed, nudge, self-claim, sign-in (request/verify/resend), sign-out. Excluded: plain `<Link>` nav + `<details>` toggles (press-only, Layer 1 / DEC-089's sibling in #262); RelaySend/CopyButton (own their optimistic "Sent ✓"/"Copied ✓").

**Two-button ask:** the crew In/Out ask is one `<form>` with two `name="response"` submits — each spins only when its own serializable `name`/`value` matches `useFormStatus().data`; both disabled in flight. Scoping is derived from props, **not** a function prop — `AskCard` is a Server Component and a function can't cross the Server→Client boundary (this bit in CI: an original `spinsWhen` callback crashed `/crew` at render). `useFormStatus` must render as a **child** of the form (it reads the nearest parent form context), which every folded-in button already is.

**Why an exception to DEC-026:** the no-client-JS beat (domain + Neon round-trip over Tailscale) reads as dead → re-tap → double-fire. `disabled`-on-pending is the real double-tap guard; the spinner is the honest "working" signal. Joins the DEC-026 island family (DEC-030 RelaySend, CopyButton) — a contained, progressively-enhanced exception, not a drift toward client-rendered surfaces.

**Tradeoff:** ~10 forms gain a client boundary (hydration cost). Accepted — bounded, one reused primitive, no data-layer change. **Strand-safe:** handled failures redirect (codes-in-params, DEC-026) so pending always clears on navigation; an unhandled throw unmounts the form via the error boundary; a resolve-without-redirect re-renders the server tree and clears pending. **Calm posture (DEC-042):** currentColor only (palette lock DEC-021/042), no overlay beyond the button's own box, no layout shift. **Phase:** 9. (@architect-gated.)
