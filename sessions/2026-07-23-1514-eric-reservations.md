---
session: 64
dev: eric
slug: reservations
branch: feature/reservations
started: 2026-07-23T15:14:37Z
ended:
points:
pr_numbers: [513, 514]
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

## Task 2: Phase 12.5 — customer checkout, inline Stripe Elements + PaymentIntent rails (#458)

**Completed** (built as a scope-confirmed bundled **Fable** run — architect-vetted design, Fable build, then verified/reviewed/shipped by the main loop):
- **The Elements decision forced a payment-rails migration**, not just a UI screen. Inline Elements (Muster-styled form around an inline card widget) needs a **PaymentIntent**, not a hosted Checkout Session. So the *departure* purchase migrated to PI; **balance + post-gratuity stay on hosted Checkout** (scope discipline — @architect).
- **Ran @architect (Fable) first** on the migration (new deps + posture reversal + dual-event webhook). It improved the plan three ways, all adopted: **deferred intent** (PI created at "Book & pay", not page load — the tip tier is chosen on THIS screen, so a page-load PI can't know the amount; also stops parking a boat per checkout visit and *narrows* the DEC-109 residual race), **only the departure flow migrates**, and **#484 stays open** (fix the checkout's own inputs, not the app-wide decision).
- **Rails (commit `ed3da31`):** `serviceFeeBps` on `PaymentConfig` (default 300) + `feeCentsFor`; `chargeNowCents` charges the fee in full at deposit like tax; `balanceOwedCents` nets `serviceFeeCents` like gratuity (balance carries no fee). `PaymentPort.createPaymentIntent` + a discriminated `parseEvent` union replacing `parseCheckoutCompleted` (Stripe adapter + fake). Webhook: shared `processBookingCharge` spine for both event types; **`payment_intent.succeeded` books ONLY intents carrying `purpose` metadata** — the double-write guard (a hosted session's bare PI is ack-and-ignored, so one charge never books twice / auto-refunds a winner). `createDeparturePaymentIntent` (deferred builder: waiver→tip→hold→price→freeze `serviceFeeCents`→PI). `Payment.serviceFeeCents` + additive migration. DEC-134.
- **Screen (commit `58e314b`):** `/book/checkout` consuming Task 1's Continue link. Server shell re-derives the exact slot (stale/sold-out/over-cap → honest notice, no doomed form), computes the summary via the pure money fns, guards a missing `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` loudly. One client island (DEC-133): lazy `@stripe/stripe-js` (spinner + real failure state), deferred `<Elements mode:payment>`, tip-tile updates the amount client-side, Book&pay → server action (hold + PI) → `confirmPayment`. Phone canonicalized server-side. #484 tinted inputs on this form only. Retired the 11.6 harness (`book/actions.ts` deleted). New deps `@stripe/stripe-js` + `@stripe/react-stripe-js`.
- **Money verified on-screen + by hand:** Fare $499 · Tip 20% $99.80 · Tax 7.25% $36.18 · **Fee 3% $14.97** · Total $649.95; **Due now $275.70** + Balance $374.25 (fee entirely in the deposit; 275.70+374.25=649.95).
- **Verification (main loop, independent of the Fable agent):** `npm run verify` green (1519 unit tests + build); `book-checkout` + `book-availability` e2e **20/20** desktop + 375px; both viewports screenshot-checked against the mockup.

**Money model (operator-decided this session):** service fee = 3% of the FARE (all charges minus tax and tips), untaxed + untipped, charged in FULL once at the deposit, balance carries none. Tax stays the 725 default (NOT the mockup's 5.2%) — tax + fee are `PaymentConfig` settings; no admin editor this phase.

**Code review:** `@code-review` — verified the double-write guard, money-freeze (webhook never recomputes from config), RSC boundary (no functions cross; lazy Stripe.js has a real failure state), missing-key guard, clean harness deletion. **No bugs.** Three cleanup-tier findings deferred to the batched polish pass: the ~285-line `InnerForm` could split; `page.tsx`'s five guard blocks could share a helper; two failure-state e2e cases (Stripe.js load-fail, missing key) uncovered.
**PR:** [#514](https://github.com/mobiustripper42/muster/pull/514) — **base `feature/reservations`**, two commits (rails, screen).
**Points:** 8
**Branch:** task/12.5-checkout
**Opened at:** 2026-07-23T21:05:00Z

**⚠️ Operator ship checklist (in the PR):** (1) Stripe dashboard must subscribe the webhook to **`payment_intent.succeeded`** (test + live) or a paid Elements booking never books, silently; (2) `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` set in every Vercel env (build-inlined); (3) apply migration `20260723150000`; (4) manual paid-booking exit gate with a 4242 test card (e2e can't cross `confirmPayment`).

**Next Steps:**
- **#459 (12.6) confirmation + manage page** — the booking link (DEC-122); `sendReservationConfirmation` already fires it. Then **#460 (12.7) link recovery**.
- **Follow-ups from the 12.5 review (batched polish pass, not blocking):** split `checkout-form.tsx` `InnerForm` into sub-components; extract a guard helper in checkout `page.tsx`; add the two failure-state e2e cases; `serviceFeeBps` admin editor (a later settings screen); persist the marketing opt-in (needs a `Customer` field); the #484 app-wide input-contrast rollout + @ui-reviewer stays open.
- **The parked idea** (direct-to-crew tip distribution via Stripe Connect) sits on top of this PaymentIntent spine — worth a priority re-look post-Xola.

**Context:**
- **Fable build pattern worked well here:** @architect (Fable) → Fable build (uncommitted) → main-loop verify/review/ship. The main loop independently ran `verify` + e2e + @code-review rather than trusting the agent's self-report; the money math was hand-checked against the rendered screen.
- **DEC-133 had to be absorbed into `feature/reservations` before DEC-134** could append (it was on main only) — merged `origin/main` into feature (`c0f1a0b`) first, per the specs-on-main/code-on-feature split. DEC-134 lives on the feature branch (with the code), unlike DEC-133 (docs-only, on main).
- **Two hosted checkout builders now have zero live app callers** — `createDepartureCheckout` (superseded by the PI builder) and `createBookingCheckout` (only `db:checkout` dev script). Kept intact (pass `feeCents: 0`), not deleted — balance/gratuity flows still use the hosted *session* path.
