# Shard A — Money / pricing / payments

**Subject:** money, pricing, payments — deposit/balance, Stripe topology, gratuity, service fee,
extras, add-ons, refund policy.

**Audited tree:** `feature/reservations` @ `0ad83d6` (2026-07-25), **not `main`**.

> **Why not `main`.** The money model does not exist on `main`. `feature/reservations` is 862
> commits / +22,412 lines ahead and exclusively carries every money migration — `gratuity`,
> `reservation_extras_cents`, `payment_service_fee_cents`, `add_ons_entity`, `customers`,
> `offering_catalog_fields`, `vessel_included_guest_count`. A sweep on `main` would have reported
> "SPEC describes money features that don't exist" and nothing else. Line numbers below are on that
> branch at that SHA and will drift as it advances; the `claim` column is verbatim so rows stay
> findable after a rebase.

**Primary docs:** `docs/SPEC.md`, `docs/DECISIONS.md` (money DECs only), `db/migrations/*`.
**Checked against:** `src/reservations/*`, `src/adapters/*payment*`, `src/ports/payment.ts`,
`src/admin/*`, `db/migrations/*`.

`DECISIONS.md` is read as **authority, not subject** (standing rule) — but a money DEC contradicted
by the code it governs is a shard-A finding, not a shard-Z one. Rows below are all of that kind:
none propose restructuring `DECISIONS.md`.

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| A1 | `DECISIONS.md:2792` (DEC-107) | "**Stripe hosted Checkout (redirect)**, not embedded Payment Intents" | DEC-134 (`:3914`): "the customer booking charge moves off hosted Stripe Checkout onto an **inline Payment Element**"; `src/reservations/create-departure-payment-intent.ts` | MISMATCH | doc-wrong |
| A2 | `DECISIONS.md:3351` (DEC-107 amend, 11.2b) | "`balanceOwedCents = (event.price + tax) − Σ succeeded payments`" | `src/reservations/payment-config.ts:84-102` — `fareCents + tax(fareCents) − Σ(amountCents − gratuityCents − serviceFeeCents)`; docstring `:78-82` defines `fareCents = event.price + extrasCents` | MISMATCH | doc-wrong |
| A3 | `DECISIONS.md:3042` (DEC-113) | "**General add-ons stay parked** — model as Xola `item.addOns[]` only if ever built." | `db/migrations/20260721000000_add_ons_entity.sql` — "AddOn becomes a first-class entity (#491)"; `src/admin/add-on-admin.ts`; DEC-123 `:3441` lists add-ons in catalog scope | MISMATCH | doc-wrong |
| A4 | `SPEC.md:1175` | "**Deposit vs full payment** at booking — Drew. (Recommendation: full upfront for v1.)" | DEC-107 `:2796` — "The operator chose **deposit + balance** over full-upfront" | MISMATCH | doc-wrong |
| A5 | `SPEC.md:1179` | "**Balance-capture timing** if deposits are used (tie to a horizon?)." | DEC-107 amend `:3351` — "Balance is collected **on demand**"; scheduler explicitly P12+ | MISMATCH | doc-wrong |
| A6 | `DECISIONS.md:3041` (DEC-113) | "It rides the existing `terms` argument of `refund_owed(who, when, paid, terms)`; **no new machinery**." | No `refund_owed`/`refundOwed` anywhere in `src/` or `db/`. It exists only as a SPEC §3.3 formula (`SPEC.md:1075`) in a section DEC-107 lists as **parked**. DEC-135 `:3924` confirms "the #472 refund policy … does not exist" | CODE-CONTRADICTS | doc-wrong |
| A7 | `DECISIONS.md:3008` (DEC-112) | "there is no `Offering`/schedule default cascade because **`Offering` is a Phase 12 entity**… **Revisit if:** the `Offering` catalog lands (P12) — then add the default-cascade." | `src/reservations/availability.ts:247-251` resolves `offering.priceVariations` → `basePriceCents` with delta/percent adjustment; `db/migrations/20260720100500_offering_catalog_fields.sql` landed | MISMATCH | doc-wrong |

## Severity read

**A1 is the one that matters.** DEC-107 is the DEC every other money decision cites, and its headline
decision — hosted Checkout over embedded Payment Intents, justified at length on PCI-surface grounds —
is now false for the booking charge. DEC-134 reversed it and says so in its own title ("revisits
DEC-107/108"), but **DEC-107 carries no forward pointer**: reading it top-to-bottom, including both its
existing amendments, gives you the wrong architecture with the reasoning intact. Anyone onboarding onto
the money path reads DEC-107 first.

A2 and A7 are the same failure mode one layer down: a DEC amended in *code* whose prose was never
re-opened. A2 is the more dangerous of the two — the stale formula omits both the extras term and the
gratuity/service-fee netting, so anyone re-deriving a balance from the DEC undercollects.

A3–A5 are decided-then-never-closed: an owner gate or a parked item that the build has since settled.
Cheap to fix, and they're what make the docs read as untrustworthy.

A6 is low severity and arguably by design — DEC-113 is explicitly forward-looking ("the build is Phase
12") — but "the **existing** … `refund_owed`" asserts something that exists in neither code nor an
active spec section.

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| `taxRateBps` = 725 | DEC-134 | `src/adapters/repository-contract.ts:931` |
| `serviceFeeBps` default 300 (3%) | DEC-134 | `src/adapters/repository-contract.ts:932` |
| Gratuity tiers 15/20/25, 20% preselected, pre-trip required | DEC-124 / DEC-134 | `src/reservations/pricing.ts:60-67` (`[1500,2000,2500]`, `GRATUITY_DEFAULT_BPS = 2000`, `required: true`) |
| "the later balance charge carries NO fee" | DEC-134 | `src/reservations/create-balance-checkout.ts` sets no `serviceFeeCents` |
| `payments.service_fee_cents` column added | DEC-134 | `db/migrations/20260723150000_payment_service_fee_cents.sql` |
| Balance derived, never stored on `Reservation` | DEC-107 amend | `balanceOwedCents` is a pure deriver; no balance column in the reservations migrations |
| Flex insurance unimplemented | DEC-113 | Zero hits in `src/`/`db/` — but DEC-135 `:3924` already states it doesn't exist, so the docs agree with each other |
| SPEC defers money detail to DECISIONS | `SPEC.md:544-547`, `:66`, `:1018` | Consistent and deliberate — this is why SPEC carries only 24 money term-lines |

## Not checked

- **`docs/design/*`** — the mockup/design notes DEC-134 and DEC-113 both cite as evidence
  (`the-booking-1.md`, `the-living-link-1.md`). Out of this shard's primary-doc list; they'd be the
  natural corpus for shard G (brand/UI) or a design-doc shard.
- ~~**`OPERATOR_MANUAL.md` / `PILOT_*`** money passages — those are shard D's corpus.~~ *(Those
  files were deleted 2026-07-25; nothing left to check.)*
- **Live Stripe config** (which account, webhook endpoint subscriptions) — UNVERIFIABLE without
  dashboard access. DEC-134 notes the endpoint must subscribe to `payment_intent.succeeded`
  alongside `checkout.session.completed`; worth an operator confirmation, not a doc fix.
- **`DECISIONS.md` internal structure** — shard Z, deferred by standing rule.

## Cost

Run in-context rather than via a sweep agent — the corpus reachable by grep (7 money DECs, 24 SPEC
lines, ~12 source files) was small enough that the ledger-on-disk indirection would have cost more
than it saved. Shard F's lesson holds for the large shards (C, D), not this one.
