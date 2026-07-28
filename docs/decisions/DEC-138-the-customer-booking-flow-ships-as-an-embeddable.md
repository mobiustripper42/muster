---
id: DEC-138
title: "The customer booking flow ships as an embeddable widget — the BrewBoat rollout path and the multi-tenant seam"
topic: "Reservations & payments"
---

## DEC-138: The customer booking flow ships as an embeddable widget — the BrewBoat rollout path and the multi-tenant seam

**Status:** Decided 2026-07-20 (Eric + design). Extends DEC-105 (Phase 11–12 booking) as a mechanism DEC under it. Reflected in the booking mockups (`the-booking-1.md` §8, `availability-picker` + `booking-form`).

**Context.** DEC-105 established Muster sells its own reservations in 2026 as a permanent parallel-run — "the cutover is a sales-channel flip, not a data event." It left open *how the customer booking flow physically reaches customers.* **brewcle.com still runs on WordPress.** Rebuilding the marketing site just to launch bookings would couple two unrelated efforts and delay the money-making half of the Xola replacement.

**Decision.** The customer booking flow ships as a **self-contained, URL-routed surface on its own origin** (`book.brewcle.com` or `/embed/book/…`), delivered as an **iframe embed via a paste-in `<script>` snippet**, with **postMessage** for height/resize and open/close. Presentation is responsive — a **lightbox dialog on desktop, a full-screen routed page on mobile** (both first-class; mobile leads). This is *how* DEC-105's sales-channel flip actually happens:
- **BrewBoat rollout.** Muster takes over bookings on the existing WordPress brewcle.com by dropping the widget onto the page (replacing the current booking widget). No site rebuild; WordPress keeps doing marketing indefinitely; the site migration is decoupled and optional. This *is* the coexistence mechanism — same page, Muster owns the flow inside the frame.
- **Multi-tenant seam.** The same snippet on another operator's site is the sell-it path. Built once for BrewBoat as a widget; sellable later without forking (the SPEC's standing policy/mechanism bet). Not built now — the shape just doesn't foreclose it.

**Constraints (build discipline).**
- Keep the flow **iframe-shaped**: self-contained, works in a narrow/constrained viewport, no dependency on top-level browser navigation or Muster's app chrome; postMessage-ready for resize + launch.
- Each step is **URL-addressable** and renders standalone at its own origin too (deep-linkable — coherent with "the confirmation IS the living link," DEC-122). `frame-ancestors` CSP allows the embedding operator's domain.
- **Stripe wallet gotcha:** Apple Pay requires per-domain association. Keep **payment on Muster's own origin inside the frame** (as FareHarbor does), so wallet verification is against Muster's domain, not each operator's. **— Made moot by DEC-139 (no Apple Pay / no wallets): payment is plain Stripe card on Muster's origin, embeddable anywhere with no per-domain wallet setup.**

**Revisit if:** a tenant needs the flow where per-domain Apple Pay verification isn't feasible (fall back to a hosted redirect link for that tenant), or a non-iframe distribution (hosted booking link) is preferred.

**Numbering note.** Authored as DEC-126, renumbered to DEC-131, and landed as DEC-138 — each earlier number was taken by an unrelated DEC on `main` while this branch sat unmerged. ~~Numbers 136/137 are reserved for `feature/reservations`, which renumbered `main`'s DEC-134/135 into them.~~ **Superseded 2026-07-27:** `main`'s DEC-134 and DEC-135 were **deleted**, not renumbered — neither decided anything (one documented a seed script, one described `db:all`), and the operator's call was that they should never have existed. `feature/reservations` therefore keeps **134/135** as its own, 136/137 are free, and only **DEC-138** still collides across the two trees (#562).
