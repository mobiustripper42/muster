---
id: DEC-123
title: "Reservations gets its own calendar — customer-centric, beside the crew-centric shift view; plus a net-new catalog and purchases/customers area"
topic: "Reservations & payments"
---

## DEC-123: Reservations gets its own calendar — customer-centric, beside the crew-centric shift view; plus a net-new catalog and purchases/customers area

**Status:** Accepted (operator, 2026-07-15, S54) — the two-surface call is the operator's; the rest is
**pending @architect**. Numbered **123, not 122** — `feature/reservations` already holds DEC-122 (the
booking link, renumbered there at the S53 merge). See `docs/design/reservations-admin.md` and the mockup
`docs/design/mockups/reservation-calendar.html`.

**Decision:** Phase 12's open question — *"how much rides the existing crew-admin cockpit vs. a distinct
reservations-admin area — settle before P12 poker"* — is answered: **a distinct reservation calendar.**
Muster needs **both**, and they are **two different things**:

- **Reservation calendar — customer-centric.** What's for sale, what's sold, what's open, what it costs,
  who bought it.
- **Shift view (`/admin/shifts`) — crew-centric.** Who works the vessel-day.

They **share the Vessel and the vessel-day** (one entity, not a twin — DEC-125 / `vessel.html`), and each
cross-links to the other. *(An earlier draft said they "meet at the vessel-day and nowhere else" — reworded:
the Vessel is a single shared entity, so "share" is right, not "meet.")* So the reservations admin is:

1. **The reservation calendar** — *net-new.* Departures by day/boat, Open-or-Sold, price, buyer; the
   per-reservation detail pane (roster, change arrival, cancel, refund, resend link, message).
2. **Catalog & pricing** — *net-new.* `Offering` create/edit: descriptive content, photos, `Location`,
   vessels, schedule + price variations, add-ons, per-event price (DEC-112), gratuity (DEC-124). Blocks
   (blackout) are **not** here — they're their own scoped surface (DEC-125). Refined 2026-07-16, below.
3. **Purchases & customers** — *net-new.* Order list + detail (refund, resends, purchase/payment summary,
   attendee roster) and the customer contact record. **Cards-on-file are Stripe's; not rebuilt.**

**Why two surfaces, not one:** a reservation calendar and a crew roster answer different questions for
different readers. Folding customer and money surfaces into the crew board to reuse what exists would
overload a surface built for a different job — and the reuse argument decays the moment reservations need
a view the shift board structurally cannot give (an Offering-major view, payment-state filters).
**Superseded reasoning:** an earlier draft of this DEC claimed a second calendar was "the trap," on the
theory that Xola only needs its own dashboard because Xola has no crew concept, and that "the crew engine
owns the vessel-day; reservations rent space on it." **Both are wrong and are recorded here as errors.**
Reservations are upstream — events generate the vessel-day that `formShifts` derives (`src/builder/
form-shifts.ts`) — and after the DEC-105 flip, reservations are the primary business.

**Availability is the product, not an edge case.** Unsold departures are first-class **display rows** on the
calendar: showing what is **not** booked *is* the ordering system. *(Display rows over **computed** slots —
they are **not** materialized `Event` rows; DEC-125. Don't let "first-class rows" read as "write a row.")*

> **Corrected 2026-07-16 (operator).** An earlier version of this paragraph concluded availability
> "forces **eager event generation** — an event must exist before it is sold — which reverses task 11.3's
> lazy `Event(if new)`." **That was wrong.** Unsold inventory must be *representable*, not *materialized*.
> The model is **virtual availability** (DEC-125): the schedule is a rule, open slots are computed
> (`schedule × vessels × dates − blocks − bookings`), and an `Event` row materializes only when a slot
> gets state — booked, per-departure override, or held. So **11.3's lazy materialization stands**, a
> season is a few dozen rows not thousands, and editing an `Offering` recomputes open slots with nothing
> to rewrite. See **DEC-125** for the model and the mid-season propagation policy.

**Whole-boat is a rule, not a shape — do not foreclose multi-party (operator, 2026-07-15).** BrewBoat
sells one boat to one party; multi-party selling is **explicitly not wanted** and **not built**. But the
model must not **weld it shut**. It currently doesn't, and that is not an accident to be tidied away: the
one-party rule is a **service-layer predicate** (11.3's CAS claim — *"claim iff the event is unclaimed by
any active `source='muster'` reservation"*) with **no DB unique constraint**, so the schema is already
`Event 1‥N Reservation`. Adding multi-party later = change the availability predicate (step function →
`capacity − Σ party sizes`) + an additive per-**guest** price column. No relationship migration.

> **Guardrail — do not add a unique constraint on `Reservation.eventId`.** It reads like an obvious
> correctness win and would enforce *today's business rule* as a *structural fact forever*. The one-party
> rule lives in the predicate. Consistent with DEC-020's service-layer-integrity posture.

**Cut from P12 (operator, 2026-07-15):** Reports, Marketing, Distribution, App Store, store credit,
questionnaire. *(Gratuity was on this list and came back — DEC-124.)*

**Naming:** **`Offering`**, not Xola's "Experience" (operator-confirmed 2026-07-15; already the
@architect-verified term in `reservations-model.md`).

**Not this:** seat counts. Xola's dashboard is "12/12 reserved" because Xola sells seats. Muster sells the
boat: an event is **Open or Sold**. Party size is a fact about the booking, never inventory to subtract.

### Catalog model — refined 2026-07-16 (operator, against the v3 catalog mockup)

The `Offering` catalog is the **global rule**; per-departure changes and blocks live off it. Settled:

- **`"seat"` is a crew word, full stop.** The reservation side never says "seat" — it counts **guests**
  against vessel capacity. `Seat` stays the crew-engine entity; overloading it was rejected.
- **Vessels, not a per-boat capacity table.** "Runs on" picks boats from the **Vessel** (equipment) list.
  **Capacity is a fact of the `Vessel`** (Brew 1 = 12, Brew 4 = 16), set on the Vessel screen — never
  overridden on the `Offering` (no use case). Pricing's "extra guest to that boat's max" reads the Vessel.
- **One schedule per Offering.** Boats sharing an Offering share its schedule. Boats needing a *different*
  schedule are a *different* Offering — this is what keeps the calendar a clean per-boat grid.
- **`Location` is a first-class entity** (new — surfaced by the "block a location" case). The `Offering`
  references one via a picker; the `Location` carries **pickup [description + link]** and a **route
  description**, and is what a location block targets (DEC-125). Managed on its own screen.
- **Tax + service fee are system-wide settings** with an **optional per-`Offering` override** (the
  two-municipalities escape hatch) — not primary fields re-entered on every Offering.
- **Publish + hidden, lifted from `bushel`** (its `is_active` soft-delete + "Show hidden" toggle):
  - **Draft** — unpublished, not sellable, **generates no slots**.
  - **Live** — on sale; the schedule publishes availability.
  - **Hidden** — a **reversible soft-delete**: out of customer browse **and** the default admin list,
    every existing `Event`/`Reservation` reference kept, recoverable via "Show hidden." The **only safe
    way to retire an Offering people have booked** — never a hard delete. The same flag will serve the
    customer contact records (DEC-123 §3), exactly as `bushel` reuses it for products and customers.
    *(bushel's second axis, `is_available` per-week sold-out, maps here to per-departure blocks — DEC-125,
    not an Offering flag.)*

**Consequence:** the plan's ⚠️ ("the admin surfaces are likely the larger half of P12") is **confirmed** —
three net-new surfaces against six customer-facing bullets.

**Open at build:** whether Week or Day-with-boat-columns is the calendar's default; where add-ons surface;
whether the operator ever books from the calendar or only from a customer record. **Touches**
DEC-105/106/112 and task 11.3 (see eager generation, above).
