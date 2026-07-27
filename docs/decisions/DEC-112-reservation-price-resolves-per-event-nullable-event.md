---
id: DEC-112
title: "Reservation price resolves per-`Event`; nullable `Event.price` column"
topic: "Reservations & payments"
---

## DEC-112: Reservation price resolves per-`Event`; nullable `Event.price` column

**Status:** Decided 2026-07-11 (@architect + Eric, under DEC-105/107 — verified reservations model,
`docs/design/reservations-model.md`).
**Its own "revisit if" has since fired.** The `Offering` catalog landed in P12 (DEC-123,
`20260720100500_offering_catalog_fields.sql`), so the deferred **default cascade now exists**:
`src/reservations/availability.ts` resolves `offering.priceVariations` against the date and falls back to
`offering.basePriceCents`, applying either a `deltaCents` or a `percent` adjustment. The P11 statement
below — "resolution order is `Event.price` only … no `Offering`/schedule default cascade" — describes the
Phase 11 world and is retained as the record of why the column was added; it is no longer the whole
resolution path.

**Context.** The operator confirmed (2026-07-11) that **each individual event can carry its own price** —
per-event pricing, not a flat experience rate. (Xola models a per-schedule price variation — Prime Sat +$50,
Sunday −20% — *and* the operator states finer per-event flexibility.)

**Decision.** Add a **nullable `price` column on `Event`** — per-event, source-agnostic (`source='xola'`
events leave it `null`; their money lives in Xola, DEC-105). It is **additive + inert**, so it **rides the
DEC-106 `source` migration onto `main`** in the same task (11.0). **Phase 11 resolution order is `Event.price`
only** — there is no `Offering`/schedule default cascade because **`Offering` is a Phase 12 entity** (P11
seeds a single `Event` directly). The "offering/schedule default → per-event override" cascade is deferred to
P12 when `Offering` materializes. The customer party cap reads the existing per-event **`Event.capacity`** —
**no** new `Vessel.coiMaxPax` lookup in the customer path. **Ownership split:** the **schema column is not
owner-gated** (build it); the **price value, deposit-%, and balance timing are owner-gated (Drew, DEC-107)**
and gate task 11.2 only. **Revisit if:** the `Offering` catalog lands (P12) — then add the default-cascade.
