---
id: DEC-ROLE-1
title: "Crew roles and vessel manning are tenant data, not a hardcoded enum"
topic: "Crew, vessels & manning model"
---

## DEC-ROLE-1: Crew roles and vessel manning are tenant data, not a hardcoded enum

**Decision:** Roles/ratings and per-vessel manning requirements are **data, defined per tenant** —
**not** a language enum or hardcoded constants. The engine must never assume there are exactly two
roles, nor that they are specifically "captain" and "mate." The model:
- **`RoleType`** — a per-tenant row `{ id, tenantId, name }`. BrewBoat seeds two rows (`captain`,
  `mate`); a later tenant adds deckhand / engineer / naturalist by adding rows, no code change.
- **Vessel manning** — a list of `{ roleTypeId, count }`. Seat derivation **iterates the list**; it
  must work for N lines, not assume two. BrewBoat = `[{captain,1}, {mate,1}]`.
- **`CrewMember.ratings`** — a set of `roleTypeId`. **`Seat.role`** — a `roleTypeId` reference.

**Why it's already the spec's intent:** seats declare a `role` and required seats are **derived from
the vessel's COI/manning** (SPEC §1.1, §2.3); the roster stores **ratings as a set** (§2.1); the
eligible pool filters by "holds the **required rating**" (§1.3) — role-agnostic by construction. The
engine is already role-as-config; this decision just forbids the build from collapsing it back into a
hardcode.

**Scope — model general, seed minimal.** The configurability is in the *model*, not yet an
*interface*. BrewBoat's two roles + 1+1 manning are seeded directly (fixture). **Do not** build a
role-admin UI, custom-manning editor, or multi-role config screen in the slice — that arrives with
multi-tenant, well past it.

**Anti-patterns (explicitly do not build):** ❌ `enum Role { CAPTAIN, MATE }` or a `'captain'|'mate'`
union anywhere in the domain · ❌ hardcoded `{ captains:1, mates:1 }` manning or seat-building that
makes "a captain seat and a mate seat" instead of looping a list · ❌ `if (role === 'captain')` in the
pool/rating check — match the required `roleTypeId` generically · ❌ UI assuming exactly two role
columns. These all compile and pass slice tests — that's the danger; the retrofit cost after
`captain`/`mate` is sprinkled through the code is high, the up-front cost (a table + a list vs an enum
+ constants) is near zero.

**Tradeoff:** A `RoleType` table + manning list instead of an enum + two constants, before a second
role type exists. **Rejected:** the enum/constant shortcut — bakes in the exact assumption this
decision exists to prevent. **Revisit if:** never for the model; a role-admin *interface* is revisited
at multi-tenant. **Phase:** applies from M0 (the data model) onward — no new milestone. (Handoff,
2026-06-04.)
