---
id: DEC-125
title: "Virtual availability — the schedule is a rule, `Event` rows materialize on state; blackout is scoped blocks, not per-event toggles"
topic: "Reservations & payments"
---

## DEC-125: Virtual availability — the schedule is a rule, `Event` rows materialize on state; blackout is scoped blocks, not per-event toggles

**Status:** Accepted (operator, 2026-07-16) — data-model shape; **build resolved** (@architect, 2026-07-18,
task 12.0 / PR #470 — see the build-resolution block at the end). Corrects DEC-123's withdrawn "eager event
generation" leg. See the v3 catalog mockup (`docs/design/mockups/offering-catalog.html`).

**Decision:** Muster does **not** materialize an `Event` row per potential departure. The `Offering` +
schedule is a **rule**; open availability is **computed**, and a row is written only when a slot acquires
real state.

**Open slots = `schedule × vessels × dates × muster-owned-days − blocks − bookings`**, derived on read. The
**`× muster-owned-days`** term is load-bearing and was missing from the first draft (@architect, 2026-07-17):
DEC-106 partitions a boat-day to exactly one system, and Muster must **never** generate a virtual slot on a
**Xola-owned** vessel-day — it would re-list a boat Xola is selling. *(This term is a **pilot-coexistence**
concern only; after the DEC-126 cutover Muster owns every reservation, so the mask is the whole calendar and
the term is moot — see DEC-126.)* A `Event` (and any `Reservation`) row **materializes only when a slot gets
state**:
- **booked** — the DEC-109 claim writes the `Event` + `Reservation` on first booking (11.3's lazy
  `Event(if new)` — **which therefore STANDS**; DEC-123's claim that availability reverses it was wrong).
  **First-booking atomicity (@architect, 2026-07-17):** a single-row CAS protects an *existing* row; the
  first booking of a virtual slot has **no row**, so the atomicity is a **conditional insert on the slot
  identity `(vessel, date, time, source='muster')`** — see the new guardrail below.
- **per-departure override** — an operator edits one departure's time/price/capacity on the calendar;
- **customer checkout-hold** — a transient soft-reservation (DEC-109, 15 min); materializes a short-lived
  **hold** row (not necessarily a full `Event`), distinct from the admin/vessel hold below;
- **blocked** — see blocks below. *(An admin **vessel hold** materializes a **block-family** row, **not** an
  `Event` — corrected from the first draft, which wrongly listed "held" among Event-materializing states.)*

So a season is a **few dozen rows, not thousands** (the ~3,060-row materialization the operator flagged is
avoided), and editing an `Offering`'s schedule just **recomputes** the virtual slots — no row rewrite. A
**Draft** `Offering` publishes no rule, so it generates no slots (DEC-123 catalog model).

**Mid-season propagation (the "I edit the offering after editing a trip" case):**
- An `Offering` edit changes the **rule** → applies **forward** to unbooked, unmodified slots (virtual →
  they just recompute). Nothing to rewrite.
- A **per-departure override** is a materialized row and **wins** — an `Offering` edit never silently
  overwrites it (same "manual entry survives re-import" discipline as DEC-043).
- A **booked** slot is **frozen**: a price change never retroactively alters what a customer paid (a
  contract); a time/capacity change to a booked trip flows through the **customer-notify** path (the
  cancellation/relocation family), never a silent bulk update. **Retroactive re-pricing of booked trips is
  out of P12** (Stripe re-charge/refund territory).

**Blackout is scoped *blocks*, not Xola's per-event toggle** (operator: "Xola blackout sucks"). A block is
just another **availability subtraction** in the formula above — which is why the virtual model absorbs it
for free. Three kinds, from the operator's use cases:
- **Location block** — a date **+ time window**; the river's closed → **every** slot at that `Location`
  (across offerings/vessels) goes dark. *(This is what surfaced `Location` as a first-class entity — DEC-123.)*
- **Vessel block** — a **date range**; a boat's out of service → all its slots gone.
- **Vessel hold** — a **single slot**; reserve a boat for a private thing with **no customer `Event`** — an
  operator hold, not a reservation.

Blocks are their **own admin surface** (the "bulk blackout" screen the catalog kept pointing at), **not**
on the `Offering`.

> **Guardrail (@architect, 2026-07-17) — the complement of DEC-123's `Reservation.eventId` rule.** Lazy
> materialization is only safe if the slot can't be materialized twice. Add a **uniqueness/identity on the
> `Event` slot `(vessel, date, time)` for `source='muster'`** — enforced as a **both-adapters contract**
> (pg: partial unique index or row lock; in-memory: the critical section). This is **not** the constraint
> DEC-123 forbids: that one ("one reservation per event") is a *policy* and stays out; this one ("one
> materialized event per physical boat-slot") is a *physical fact* — there is exactly one Brew 3. Different
> key, opposite purpose. Without it, two first-bookings of the same virtual slot each insert-and-claim their
> own row → a double-sold boat.

> **Price composition (@architect, 2026-07-17).** DEC-112 said "resolution order is `Event.price` only,"
> but the catalog + booking form sell **base fare (up to N guests) + `extraGuestPrice` per guest over N, to
> the boat max**. `extraGuestPrice` is an **`Offering`-level** field; a booking's fare composes as
> `Event.price` (the per-departure/variation base) **+** `extras × Offering.extraGuestPrice` **+** gratuity
> (DEC-124). Name it in the price model before poker.

**Touches** DEC-108/109 (the claim writes the row on booking; hold + backstop live in DEC-109), DEC-106 (the
`× muster-owned-days` mask — pilot-only, moot post-DEC-126), DEC-112 (`Event.price` is the per-departure
override's home; extra-guest price is `Offering`-level), DEC-123, **DEC-126** (the cutover that retires the
ownership mask). **Open:** whether price variations stack (DEC-123 — operator: **no, ordered list, first
match wins**, now settled in the catalog mockup); boat-selection policy (DEC-109).

> **Build resolution (@architect, 2026-07-18, task 12.0 — PR #470).** 12.0 fixes the read model, reads-only:
> - **Entities** (`src/domain/entities.ts` + `ids.ts`): id types `OfferingId`/`LocationId`/`BlockId`; `Offering`
>   (`status` draft|live|hidden · `vesselIds` · `locationId` · `OfferingSchedule` {seasonStart, seasonEnd,
>   weekdays[], departureTimes[]} · `basePriceCents` · ordered `PriceVariation[]` · `extraGuestPriceCents`);
>   `Location`; and the **three-kind `Block` union** (`location` = date + time window · `vessel` = date range ·
>   `vesselHold` = single slot, distinct from the DEC-109 checkout-hold).
> - **Read ports** on both adapters: `listOfferings`/`getOffering`, `listLocations`/`getLocation`, `listBlocks`.
>   **Writes + admin UI are deferred** — offerings → 12.8, locations → 12.9, blocks → 12.10, which **append**
>   inert display/config fields (photos, add-ons, tax override, gratuity config; `Vessel.includedGuestCount`)
>   **without redefining** these entities. Migration `20260718045012_reservation_catalog_tables.sql` lands the
>   three tables additive + inert (DEC-111 posture; empty ⇒ zero behavior change).
> - **Deriver** `deriveVirtualAvailability(input) → VirtualSlot[]` over `offerings × vessels × dateRange ×
>   ownedDays − blocks − events − reservations`. Precedence: draft/hidden emit nothing → **owned-day mask** →
>   **materialized `Event` wins its slot** (override recomputes price/capacity, booked is frozen; committed
>   state beats blocks) → blocks subtract virtual-only → remainder `available`. Resolves the **display base**
>   only (first-match variation, or an override `Event.price`); the **party fare** (base + extras ×
>   `extraGuestPrice` + gratuity, DEC-124) is **booking-time, out of 12.0**.
> - **Guardrail split:** 12.0 ships `slotIdentity(vessel,date,time)` + the deterministic `eventIdForSlot`
>   helpers and documents the both-adapters uniqueness *contract*; **enforcement** (conditional insert on the
>   slot identity, pg partial unique index, in-memory critical section) is **12.1**.
> - `deriveAvailability` / `canBook` (the P11 seeded-`Event` path) are **untouched**; the old browse path is
>   superseded when 12.8 repoints the calendar at the virtual deriver. Tests: **vitest unit only** (pure
>   service-layer, no RLS/UI); 12.1's conditional-insert is where the DB-level (pgTAP/parity) test lands.
