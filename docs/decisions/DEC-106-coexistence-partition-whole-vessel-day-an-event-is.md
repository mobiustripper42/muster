---
id: DEC-106
title: "Coexistence partition = whole vessel-day; an event is owned by exactly one system"
topic: "Reservations & payments"
amends:
  - id: DEC-029
    relation: extends
    scope: "the import merge rule"
  - id: DEC-043
    relation: extends
    scope: "the import merge rule"
---

## DEC-106: Coexistence partition = whole vessel-day; an event is owned by exactly one system

**Status:** Decided 2026-07-11 (@architect, under DEC-105). Extends the DEC-029/043 import merge rule.

**Context.** The make-or-break risk of selling on two systems at once is **double-selling the same seats**.
Capacity truth for any given event must be unambiguous.

**Decision.** Partition at the **whole vessel-day** — the existing `shift-{vessel}-{date}` grouping grain.
A concrete boat + date is owned by **exactly one** system; a Muster-owned vessel-day forms its shift
entirely from `source='muster'` events, a Xola vessel-day entirely from Xola events. Both flow through the
same `formShifts` → same state machine → same crewing.
- **`source: 'xola' | 'muster'`** discriminator on `Event` and `Reservation` (small migration, backfill
  `'xola'`). The importer writes **only** `source='xola'` rows (it structurally can't produce a Muster id —
  it upserts by Xola id and never reaps). Muster-native selling reads remaining capacity **only** from
  same-event `source='muster'` reservations. **No cross-source capacity arithmetic ever happens**, so
  double-counting on the next pull is impossible by construction — this makes the DEC-029 "manual-add
  survives re-import" guarantee a first-class invariant, not an accident of id-namespacing.
- **Importer guard for the one residual risk (listing discipline):** when a Xola event resolves onto a
  **Muster-owned** vessel-day, the importer **skips it and surfaces a counted, itemized skip** (same idiom
  as the excluded-resource / `bookedNoBoat` reporting in `xola-pull.ts`) — an actionable "you double-listed
  this boat-day," never a silent clobber. **Operator discipline:** a Muster-owned vessel-day is de-listed
  in Xola.

**Why whole-vessel-day, not finer/coarser.** Per-product straddles capacity across both systems (both sell
the same BrewBoat product). Per-event is the correctness floor but mixing Xola + Muster events inside one
vessel-day means one shift's manifest draws from two truth sources — a reconciliation trap on the crewing
atom. Whole-vessel-day aligns the ownership boundary with the shift boundary already in the code.
**Revisit if:** an operator genuinely needs to sell the same boat-day split across both systems (not a
BrewBoat need — would require per-event capacity reconciliation).
