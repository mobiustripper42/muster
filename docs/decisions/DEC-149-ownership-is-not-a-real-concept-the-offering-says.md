---
id: DEC-149
title: "Ownership is not a real concept — the offering says when, blocks say what's off"
topic: "Availability & commitment rules"
amends:
  - id: DEC-106
    relation: retires
    scope: "the whole-vessel-day ownership allowlist and its availability mask only — the `source` discriminator on Event and Reservation, and the no-cross-source-capacity-arithmetic rule, both stand"
---

## DEC-149: Ownership is not a real concept — the offering says when, blocks say what's off

**Status:** Decided 2026-08-06 (Eric). Retires the DEC-106 ownership allowlist. Implemented in #688.

**Context.** DEC-106 partitioned Muster and Xola at the whole vessel-day: a boat on a date belonged to
exactly one system, recorded as a row in `muster_owned_vessel_days`. `deriveVirtualAvailability` applied
that set as an **allowlist mask** before anything else, so a boat-day with no row emitted no slots at all,
whatever the offering's season said. Nothing computed the rows; an operator typed them in one boat and one
date at a time via `npm run db:own`.

The premise was a stretch of **simultaneous selling** — a period where Xola and Muster both took bookings
and could double-sell the same boat.

**That stretch was never in the plan.** Xola sells until the cutover (Muster only imports, for crewing);
Muster sells after it (DEC-126, a hard flip with a one-time full import). There is no interval in which
both systems sell, so the allowlist protected against nothing while charging a per-boat-per-day chore for
every day the business wanted to be open.

It also answered the wrong question. The unit of sale is **a boat at a time slot** ("Whole boat, one
group", DEC-105/108). Ownership gated at boat + **date**, a grain borrowed from the crewing key
(`shift-{vessel}-{date}`, `src/builder/form-shifts.ts`). A gate at that grain can only blank a whole day.

And it was a **second gate pointing the opposite way from one that already worked.** Blocks (DEC-125) are
a denylist: everything sellable unless blocked, and a block surfaces its slot as `blocked` so the operator
can see what they closed. Ownership was an allowlist whose absence was silent — an unmarked day was
indistinguishable from a day the offering never scheduled. That is how it presented in practice: a new
offering with a May–September season showed seven days in September, because seven was how many rows the
dev seed had written.

**Decision.** **The offering's schedule says when a boat can be sold. Blocks remove exceptions. Nothing
else gates availability.**

- The owned-day mask and its `ownedDays` input come out of `deriveVirtualAvailability`, `candidateVessels`,
  and `computeBlockImpact`.
- `listMusterOwnedVesselDays` / `markVesselDayMusterOwned` come off the repository port and both adapters;
  the `db:own` CLI is deleted.
- The importer's partition guard (a Xola event landing on an owned day was skipped and itemized under
  category `muster_owned`) is dead code once the set is always empty, and comes out with the category.
- `muster_owned_vessel_days` is **dropped**. The house style is additive/reversible and this is the
  deliberate exception: an allowlist row records a *permission*, not an event, so the table holds no
  history to preserve, and production held zero rows (verified 2026-08-06). Keeping it would cost the
  only thing it ever cost — a reader finding a table they cannot identify, which is what this decision
  is about.

**What survives of DEC-106, and why this is `retires` and not `supersedes`.** The `source: 'xola' |
'muster'` discriminator on `Event` and `Reservation` is a *different mechanism* and stays: it is what keeps
Xola money in Xola, keeps Xola events out of the Muster funnel, and makes "no cross-source capacity
arithmetic" true by construction. DEC-106's actual correctness argument — that double-counting is
impossible because the two sources never mix — is untouched. Only the whole-vessel-day allowlist, and the
listing-discipline guard built on it, are retired.

**Revisit if:** Muster and Xola ever genuinely sell at the same time. Then this needs a new decision, and
almost certainly a **different grain** — per departure, not per boat-day, because that is the unit that
gets sold. Do not restore the allowlist by reflex — recreating this shape because it is the one that existed before is how the wrong grain gets a second life.
