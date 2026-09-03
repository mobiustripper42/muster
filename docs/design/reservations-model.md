# Reservations — Verified Data Model (build-facing)

Status: **VERIFIED by @architect 2026-07-11 — proceed w/ corrections** · owner: reservations (Phase 11/12)

**Verification outcome (@architect, 2026-07-11):**
- **Capacity is a whole-boat MUTEX, not seat subtraction.** DEC-108/109 + tasks 11.1/11.3 said "COI −
  Σ party sizes" — wrong for whole-boat. Correct rule: an event is available iff it has **zero active
  `source='muster'` reservations** AND party **≤ `Event.capacity`**; remaining = step function
  (`capacity` or `0`). DEC-109's atomic-claim *mechanism* is unchanged; only the predicate. → amend
  DEC-108/109.
- **`Offering` is P12, not P11** — derived/seeded; the Phase 11 exit gate seeds one `Event` directly.
- **Insurance-as-flag** is a recorded decision (DEC-113 draft) but a **P12 build** — not in the P11 harness.
- **Per-event price** = nullable `Event.price` column, folded into **11.0's migration** (additive/inert,
  lands on `main`); P11 resolution order is `Event.price` only (no Offering cascade yet). → DEC-112 draft.
- **11.0 logic unchanged** (source + vessel-day partition) — only gains the inert `Event.price` column.
- Owner-gated (Drew) — price values, deposit-%, balance timing, refund tiers, Stripe account, waiver
  provider — gate 11.2/11.5 only, not the phase start.
Supersedes the "Tier 4 / 2027 / parked" scope notes on `the-booking-1.md` + `the-living-link-1.md`
for build purposes — **DEC-105 decided reservations go live in 2026**, so those design docs are now
the *substrate* for Phase 11/12, not parked futures.

> **Why this doc exists.** DEC-105–111 + the Phase 11/12 plan were authored before this grounding was
> assembled: the two `docs/design/the-*.md` design docs, the real Xola schema (from `crewbook/lib/xola`
> + `xola-tip-extractor`), the operator's confirmations (2026-07-11), and the Xola UI screenshots in
> `docs/design/xola *.png`. This records the verified model so @architect can reconcile the DECs + plan
> against it. **11.0 is on hold until that verification returns.**

## Provenance (sources this model is built from)
- `docs/design/the-booking-1.md` — the 6-tap booking funnel (the birth).
- `docs/design/the-living-link-1.md` — the customer coordination surface (the life): move-set, emit map,
  policy-as-code refunds, insurance selector, waiver, split-pay, the living link.
- Xola schema, confirmed from the operator's own integrations: `crewbook/lib/xola/{experiences,mapping,
  events,orders}.ts`, `xola-tip-extractor/api/lib/xola.js`.
- Xola UI screenshots: `docs/design/xola *.png` (experiences/schedules, equipment grid, event detail,
  purchase detail).
- Operator confirmations, 2026-07-11 (this session).

## Confirmed business model (operator, 2026-07-11)
1. **Whole-boat-private, one reservationist.** One booking = one group = the whole boat. Party size checks
   against the vessel COI cap, not against per-seat inventory. *(Xola: "Fixed Price up to 12 guests
   $499"; event detail shows one reservation "Alexis Bowen, 12 Adults" filling a 12-cap boat.)*
2. **One boat per event.** Xola models one boat per event ("Brew 4 (x1)"). "4 boats at this time" = FOUR
   single-boat events under one experience (the Equipment grid: Brew 1 / Brew 2 / Brew 4 each with their
   own 1:30 / 3:30 / 7:30 event). **Muster's existing `Event` (one boat + date + time) IS the Xola event.**
3. **Per-event pricing (operator correction, 2026-07-11).** Price resolves **at the individual `Event`** —
   each boat-trip can carry its own price. The offering/schedule supplies a default; an event can override.
   (Xola shows per-schedule variation — Prime Sat +$50, Sunday −20% — AND the operator states per-event
   flexibility beyond that.) The model must carry price at the Event level; **do not** bake a flat
   experience-price assumption into the schema.
4. **Insurance is a boolean selector, not an add-on product.** "Flex Insurance: Yes/No" — $30 buys a 72-hr
   free-cancel window replacing the 14-day one; it flips which tier `refund_owed(who,when,paid,terms)`
   reads. No new machinery. General add-ons + questionnaire exist in Xola but Muster v1 deliberately
   reduces to insurance-as-flag; **general add-ons are PARKED** (model as Xola `item.addOns[]` only if
   ever built).
5. **Payment = deposit + balance** (two Stripe charges — confirmed in the purchase detail). Deposit-%,
   balance timing, refund tiers, and WHICH Stripe account are **Drew/Eric owner calls** (DEC-107/103).
6. **Refund = policy-as-code.** BrewBoat: cancel ≥14d → −$50; <14d/no-show → $0; operator-cancel → full.
   Insurance flips 14d→72h. (`the-living-link-1.md §5`.)
7. **Split-pay is a reimbursement layer, never a trip gate.** Owner (reservationist) is whole at booking;
   each guest may optionally pay a share via the shared link; operator reimburses/nets out. No min-pax.
   *(This is the "each guest pays their share" idea — already designed in `the-living-link-1.md §6/§8`.)*
8. **Waiver facilitated, not gated** (`the-living-link-1.md §6`; matches DEC-110). **Customer availability
   is a NEW pure deriver (task 11.1)** reading event capacity vs. muster reservations — **distinct from
   the crew-eligibility oracle in `src/oracle`** (do not route customer availability through it). The
   booking funnel is a thin face over that deriver. **Staffing horizon is the weld** — one number =
   crew-ask trigger AND customer self-reschedule cutoff.

## Entity model
```
Offering  (= Xola Experience) — **PHASE 12, derived-or-deferred; NOT a P11 entity**
   name · duration · schedule + default price · insurance option · [general add-ons parked]
   (P11 seeds a single Event directly; no Offering. Price default-cascade is P12.)
      │  one offering → many events
      ▼
Event  [EXISTS — src/domain/entities.ts]  extend
   vesselId (one boat) · date · time · capacity · dock · source='muster' · PRICE (per-event, overridable)
      │  many reservations per event NOT precluded (see below)
      ▼
Reservation  [EXISTS]  extend
   one reservationist (name/phone/email) · party ≤ COI · insurance flag · payment (deposit+balance) · source

Departure (public calendar unit) = (offering + date + time) → the set of same-time boat-events
   — DERIVED display grouping, like Shift. Not necessarily a stored entity.

Shift (vessel + day) [UNCHANGED] — spans offerings via per-boat events; crew engine untouched.
```

### Load-bearing invariants
- **Whole-boat "one booking per boat" is a SERVICE-LAYER rule (the atomic claim, DEC-109), NEVER a DB
  unique constraint on `reservations.event_id`.** The schema stays n:1 (Xola routinely has many
  reservations per event), so a future per-seat model is a policy change in the claim, not a migration.
  *Operator directive 2026-07-11: don't preclude multi-reservation-per-event, don't design for it.*
- No-FK / no-CHECK / text posture (DEC-DATA-1) holds throughout; integrity is the service layer's.

## Xola schema — kept vs dropped
- **Kept:** Experience (→Offering), Event(one boat via `resourceUsages[0]`, time), Order.item(→Reservation),
  guests[] (party/attendees), price (per-event), insurance flag, gratuity/tip (post-trip), contact.
- **Dropped (garbage):** questionnaire/custom-fields, tax + service-fee lines (Stripe/accounting concern),
  general add-ons (parked), OTA/channel, POS, loyalty, accounts (the living link is the credential).

## Open questions for verification (@architect) + owner (Drew/Eric)
1. **Is `Offering` a stored native entity now, or derived/seeded for the pilot?** (Phase 11 exit gate needs
   only a single seeded native Event — does it need Offering at all, or is Offering a Phase 12 entity?)
2. **Where does per-event price live** — a column on `Event`, with Offering/schedule as the resolved
   default? Confirm the resolution order.
3. **Does the model change any of DEC-105–111 or the Phase 11 task list (11.0–11.8)?** Specifically:
   does 11.1 "availability = COI − Σ party sizes" restate as a whole-boat mutex? Does per-event pricing
   land in 11.2 or its own task?
4. Owner (Drew/Eric): deposit-vs-full, refund tiers, which Stripe account, waiver provider.
