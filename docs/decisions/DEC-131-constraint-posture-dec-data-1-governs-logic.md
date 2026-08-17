---
id: DEC-131
title: "Constraint posture — DEC-DATA-1 governs *logic placement*, not structural constraints; FK/UNIQUE/NOT NULL are storage and are allowed"
topic: "Core architecture & engine mechanics"
---

## DEC-131: Constraint posture — DEC-DATA-1 governs *logic placement*, not structural constraints; FK/UNIQUE/NOT NULL are storage and are allowed

**See also** — later decisions that changed part of this one:
- Corrected by DEC-151 — the named precedent only — a constraint the caller must react to is still exposed through the port as a typed result, which is the holding

**Nature:** A correction of the record plus a standing boundary. Prompted by the operator (2026-07-22):
*"I'm not sure when we decided there was no foreign key on reservations. But it seems arbitrary and
actually unhelpful. Please reevaluate."* They were right, and the record was wrong.

**The misattribution (stop propagating it).** `DEC-DATA-1` decides one thing: Muster keeps its own
service/domain layer, and **RLS/triggers/procs are never where domain logic lives** — the seat state
machine, REQ-CLAIM-1, escalation, reliability scoring. It **never mentions foreign keys or referential
integrity.** The no-FK rule was actually minted in the header of `db/migrations/0001_init.sql`, which
extended DEC-DATA-1's "the DB is storage, not architecture" into "no referential enforcement" and added
its own second rationale (in-memory-adapter parity). Roughly **nineteen** later migration headers then
cited *"DEC-DATA-1"* as the authority for `NO foreign keys`. A house style back-attributed itself to a
decision that never made it. New migration headers **must not** cite DEC-DATA-1 for constraint choices;
cite this DEC.

**Decision — the line, and it is not "no constraints":**
- The database **never holds business rules or decisions.** That is DEC-DATA-1's real content and it is
  unchanged. One-party-per-boat, satisfiability, escalation policy, the claim — service layer, always.
- The database **may hold structural invariants**: `NOT NULL`, `UNIQUE`, `FOREIGN KEY`. These are not
  logic; they are the same species as the `NOT NULL`s the schema already uses everywhere. The schema had
  already broken its own "no constraints" story where it counted — the checkout-hold mutex is a
  **unique index** (`20260718142705_claim_hold_mutex.sql`), because concurrent writers need an arbiter
  and only the DB can be one.
- **DEC-123's guardrail survives intact**: still no unique constraint on `Reservation.eventId`. One
  reservation per boat is a *business rule*, and the line above puts it in the service predicate. That
  it and the customer FK land on opposite sides is the line working, not an inconsistency.

**New tables take real constraints; the existing graph is ratified as-built — no retrofit.** Retrofitting
FKs across ~30 tables mid-P12 buys nothing and costs real risk: cascade semantics would have to be
designed per edge, the manual referential cleanup that exists *because* there are no FKs (e.g.
`removeShift` tearing down seats, `postgres-repository.ts`) would need re-reasoning, and the contract
suite **deliberately writes dangling references** — `src/adapters/repository-contract.ts:441-455` saves a
reservation whose `eventId` names an event that was never created, and both adapters accept it. That
parity semantics is load-bearing for the in-memory double and is not worth rewriting for tables that
work today.

**Adapter parity under a constraint — asymmetric strictness is accepted.** The in-memory double stays
dumb: it does **not** reimplement FK checking in TypeScript (that would put integrity in two places, the
exact smear this project avoids). Postgres rejects a dangling `customer_id`; in-memory accepts it. The
two only diverge on *invalid* writes; the parity the contract suite proves is over **valid** operations,
and `postgres-repository.test.ts` runs against real Postgres so the constraint is genuinely exercised.
Where a constraint is *semantically* load-bearing (uniqueness the caller must react to), it is exposed
through the **port as a typed result** — the `saveReservationIfUnclaimed` precedent — so both adapters
implement one contract and no raw driver error escapes.

**Why this is worth a constraint at all:** the service layer can only guarantee integrity for writes that
go *through* it. Backfill scripts, `db/reset-pilot.ts`, data migrations, and manual prod `psql` do not.
The orphan-check tripwire (`src/admin/integrity.ts`) is the *detective* control and stays; a foreign key
is the *preventive* one, at no meaningful runtime cost.

**Operational note:** `db/reset-pilot.ts` truncates a classified subset with `cascade`, and truncating a
parent cascades into unlisted children. Any new table must be classified into `KEEP`/`CLEAR` in the same
class as its parent — the script's unclassified-table tripwire refuses to guess, which is the behavior we
want.

**Composes with:** DEC-DATA-1 (clarified, not amended — its text was always about logic placement),
DEC-123 (`eventId` guardrail reaffirmed), DEC-132 (first table built under this posture).
