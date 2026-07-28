---
id: DEC-DATA-1
title: "Muster keeps a service layer; Supabase (if used) is managed Postgres, not the architecture"
topic: "Core architecture & engine mechanics"
---

## DEC-DATA-1: Muster keeps a service layer; Supabase (if used) is managed Postgres, not the architecture

> ⚠️ **This DEC has never said anything about foreign keys. See DEC-131.**
> Roughly nineteen migration headers (from `db/migrations/0001_init.sql` onward) cite *"no foreign
> keys — DEC-DATA-1"* as though the rule were decided here. **It is not, and never was.** The text
> below is about *logic placement* — domain decisions live in the service layer, not in RLS policies,
> triggers, or procs. It draws no conclusion about referential constraints. The no-FK convention was
> minted independently in `0001_init.sql`'s own header and then propagated by copy, acquiring this
> DEC's number as a credential it was never granted. **DEC-131** decides the constraint posture:
> the DB never holds business rules, but may hold structural invariants (`NOT NULL`/`UNIQUE`/`FK`).
> Cite **DEC-131**, not this DEC, for anything about constraints.

**Nature:** An architecture-boundary decision, made **before** adopting Supabase so the boundary is on
paper, not improvised against a tempting RLS policy later. No slice work changes; this is a standing
boundary that composes with DEC-013 (stack deferred to M4) — it pre-commits *how* a datastore is used,
not *which* one.

**Decision:** If Supabase is adopted as the datastore, Muster **retains its own service/domain layer.**
The client does **not** talk directly to the database via PostgREST as the primary path. Supabase is
used as **managed Postgres + auth**, behind Muster's API. **RLS is authorization only —
defense-in-depth, never the place domain logic lives.**

**The line (hold it):**
- **RLS / policies** answer one kind of question: *"can this identity see or write this row?"* —
  declarative, per-row, stateless. That's all they're for.
- **The service layer** owns *decisions*: the seat state machine, crew satisfiability, reliability
  scoring, tier escalation, and especially the **atomic first-come claim (REQ-CLAIM-1)** —
  procedural, stateful, transactional. None of this goes in policies or triggers.

**Rationale:**
- Muster is a crew **engine** — almost entirely domain logic of the kind that must not be smeared
  across RLS policies, triggers, and procs. Pushing it into the database recreates the stored-procedure
  trap: logic you can't grep, can't unit-test without a database, can't reason about in one place.
- A service layer in front of Supabase is **not** misusing the tool. "Client talks to PostgREST
  directly" is a default aimed at thin CRUD apps, not engines. Supabase as plain Postgres behind an API
  is a fully supported, normal pattern.
- Composes cleanly with the rest: the schema is just Postgres DDL (drops onto Supabase unchanged); the
  channel port/adapters are orthogonal to where data lives.

**REQ-CLAIM-1 specifically:** the atomic claim stays domain logic. Its home is a **service-layer
method** (transactional conditional update). If a future reason ever pushes parts of the app
Supabase-native, the claim relocates to a **`SECURITY DEFINER` Postgres function / RPC** — *not* to RLS
policies. Either address is fine; RLS is not.

**When going Supabase-native *would* win (the bar — Muster does not clear it):** adopt the
PostgREST-direct + RLS-as-authorization posture only when there is **almost no domain logic to
displace** — thin CRUD, the database genuinely is the app, a backend would be pure ceremony. That is
the opposite of Muster. Re-check against this bar if tempted; expect Muster to keep failing it.

**Tradeoff:** A service layer to build/maintain instead of free PostgREST CRUD. **Rejected:** the
PostgREST-direct + logic-in-RLS posture — it scatters an engine's logic across policies/triggers/procs.
**Revisit if:** never for the boundary; the datastore *identity* is the M4 decision (DEC-013 / DEC-TBD).
**Phase:** standing boundary; binds whenever a datastore is chosen (M4). (Handoff, 2026-06-04.)
