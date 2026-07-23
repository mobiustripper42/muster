---
session: 64
dev: eric
slug: reservations
branch: feature/reservations
started: 2026-07-23T15:14:37Z
ended:
points:
pr_numbers: [513]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/6da407ca-dee6-4ee7-a82b-42ab340c4e3a.jsonl
---

# Session 64 — reservations

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: Phase 12.4 — customer availability screen, the designed public /book (#457)

**Completed:**
- Replaced the throwaway 11.6 booking harness at `/book` with the approved mockup's "Date & time" screen ("Muster · Customer booking flow", screen 1), re-expressed against Muster's own tokens (DEC-021, not imported). The tokens turned out to be the SAME source palette the mockup was harvested from — no palette fork.
- `src/reservations/availability-screen.ts` (+24 unit tests) — pure customer view model: month calendar day-states (avail/selected/sold-out/off, Sunday-first), `buildSlotRows` collapsing per-vessel slots to per-time rows with whole-boat "boats open" (never seats, DEC-125), `guestPricing` delegating to `composeFare` (12.2) so screen + checkout price identically, clock/duration formatters.
- `app/(public)/book/page.tsx` — server component, six-read loader + derive over the visible month. Hero, calendar, honest-scarcity slots, guest card, sticky footer. Date/time are zero-JS `AppLink` server nav; single live offering opens straight in, multi shows a thin picker.
- `app/(public)/book/book-controls.tsx` — the ONE client island (DEC-133): a context provider holding guest count, feeding `GuestCard` + sticky `Footer`. Server-rendered hero/calendar/slots pass through as children; **no function crosses the RSC boundary** (the serialization trap). Footer's Continue composes URL-selected slot + client guest count → `/book/checkout` (12.5's route).
- `e2e/book-availability.spec.ts` (3 specs × desktop + 375px) + `playwright.config.ts`: added `RESERVATIONS=true` to the e2e webServer env — **it was absent, so `/book` would have rendered "Reservations are off"** — and registered the spec at 375px.
- `npm run verify` green (typecheck core+app, lint, 1493 unit tests, build); e2e 6/6; both viewports screenshot-checked against the mockup.

**Mockup deltas (noted in code):** eyebrow brand line dropped (no tenant brand string in config), duration line omitted when the offering has no `tripLengthMinutes`, sold-out slot prices from its booked-event override ($549) vs open slots' base ($499) — honest. Service fee / discount / Stripe Elements / add-ons are Task 2 or later, per the session's scope agreement.

**Accepted wrinkle:** guest count is client state (not in the URL), so it resets to default on a date/time change. Natural order is date→time→guests→continue; recorded in DEC-133, revisit only if it bites.

**Decisions this task rests on:** DEC-133 (server-rendered screen + one client island for the stepper) — landed on `main` (`6885828`) per the specs-on-main / code-on-feature split, NOT in this task PR, to dodge the DEC-number renumber collision.

**Elements decision (Task 2):** operator wants Stripe Elements (inline card fields), lazy-loaded with a spinner, NOT hosted Checkout — "FareHarbor manages Elements, so can we." Service fee = bps of fare, added after tax, untaxed + untipped. Tax + service fee will be `PaymentConfig` system settings eventually; for now use the code defaults (no admin settings screen this phase). Add-ons set aside.

**Code review:** `@code-review` — RSC boundary clean, flag gating correct, money math traced. Two findings fixed in `278e209`: (1) **bug** — guest ceiling was the offering's fleet-wide max, not the selected departure's open-boat capacity (a multi-vessel checkout-rejection trap); `capacity` now threads through `SlotRow`. (2) Continue was a raw `<a>` → `AppLink`. Declined the optional loader-extraction suggestion.
**PR:** [#513](https://github.com/mobiustripper42/muster/pull/513) — **base is `feature/reservations`**, not main (the branch carries all P11–P12; one merge to main at the customer-ready flip).
**Points:** 5
**Branch:** task/12.4-availability-screen
**Opened at:** 2026-07-23T19:52:00Z

**Next Steps:**
- **Task 2 — #458 (12.5) booking form + checkout (8):** order summary (fare · required tip · tax · **service fee** · total), contact (phone canonicalized server-side), tip tiles (15/20/25%, 20% preselected, required), disabled discount row, waiver + terms, sticky pay bar → `createDepartureCheckout` → **Stripe Elements** (lazy + spinner, operator-confirmed over hosted Checkout). Adds `serviceFeeBps` to `PaymentConfig`. Consumes `/book/checkout?offering=&date=&time=&guests=` — the route this task's Continue link already points at. Folds in #484 (near-invisible white-on-white inputs) via the field styling.
- Then #459 (12.6 confirmation + manage), #460 (12.7 link recovery).

**Context:**
