# Reservations — Admin Surfaces (build-facing)

Status: **DRAFT 2026-07-15 (S54)** — enumerated from the Xola seller UI + operator confirmations, pending
`@architect`. Owner: reservations (Phase 12). Companion to `reservations-model.md` (the data model);
this doc is the **operator/back-office surface set**.

> **Why this doc exists.** The Phase 12 plan carried a ⚠️ admitting the reservation **admin** surfaces
> were unspecced and "likely the larger half of P12," with one question to settle before poker: *how much
> rides the existing crew-admin cockpit vs. a distinct reservations-admin area?* This enumerates the
> concrete surface set from source so that question can be answered with a list rather than a hunch.
> It confirms the ⚠️: the admin half **is** the larger half.

## Provenance

- **Xola seller UI**, `docs/design/xola *.png` — experiences/schedules config, purchases list + detail,
  dashboard (day/week/month/list/equipment), event detail pane, customers/contacts.
- **`reservations-model.md`** — the @architect-verified data model (`Offering → Departure → per-boat
  Event → Reservation + addOns`; whole-boat mutex).
- **`xola-tip-extractor`** — the operator's finished tip/payroll tool (see DEC-124).
- **Operator confirmations, 2026-07-15 (S54).**

## Naming

**`Offering`**, not "Experience." Experience is Xola's word; `Offering` is the term already established
and @architect-verified in `reservations-model.md` (2026-07-11). Xola screenshots say "Experience" —
read it as `Offering` throughout this doc.

---

## 1. The enumerated surface set

Xola's seller side maps to six areas. The column that matters is the third — **Muster already owns
several of these**, and a straight port would rebuild them.

| Xola surface | Contents | Muster's position |
|---|---|---|
| **Products → Experiences** | Descriptive content · Schedules & Availability (event duration, inventory duration, named schedules with price variations — "Prime Saturday +$50", "Sunday −20%" — blackout schedules, early arrival) · Photos · Pricing · Add-ons · Questionnaire | **Net-new.** No equivalent exists. The largest single build in P12. |
| **Purchases** | Order list + search (name/email/phone/tag/ID) · detail: Arrival, Guests, Add-ons, Refund, Message Guests, Resend Confirmation / Gratuity / Waiver Email, Switch Experience · purchase summary (line items, tax, 3% service fee) · payment summary · attendee roster with per-attendee waiver | **Net-new.** |
| **Dashboard** (day / week / month / list / equipment views) | Event calendar, filters by Product / Equipment / Guide, available-vs-reserved counts | **Net-new — the reservation calendar.** Customer-centric; a different surface from the crew-centric `/admin/shifts`. Muster needs both. Drop the seat counts (see §2). |
| **Event detail pane** | Guide + Manage Guides · Equipment (Brew 4 ×1) · Capacity (0 available / 12 reserved) · Message, Change Arrival, Cancel Reservations, Email/Export/Print Roster · Event Notes · Guests table | **Net-new** as a *reservation* detail pane (roster, change arrival, cancel, refund, resend link, message). Guide/Equipment/Capacity are Muster's already — they cross-link to the shift view rather than being re-managed here. |
| **Customers → Contacts** | List/search · total value, store credit, purchase count · primary + additional contacts · cards on file · customer notes · export | **Net-new** — except cards-on-file, which is Stripe's and is not rebuilt. |
| **Resources / Reports / Marketing / Distribution / App Store** | — | **Out of P12.** |

### Cut list (operator-confirmed, 2026-07-15)

Out: **Reports, Marketing, Distribution, App Store, store credit, questionnaire.** Gratuity was
initially on this list and came **back in** — see §3 and DEC-124.

---

## 2. The shape: three things, not one-area-vs-two

**The cockpit question was a false binary.** Xola needs its own event calendar because Xola has no crew
concept — assigning a "guide" to an event is a thing its operator does by hand. Muster's entire crew
engine already does that autonomously, per vessel-day. So the reservations admin is not one area, and
not two areas. It is **three things**:

> **⚠️ Superseded framing (refined 2026-07-16).** This section's "**graft, not build**" (item 3) and the
> "**reservations rent space on the vessel-day**" callout below were an early draft; **DEC-123 records both
> as errors** — the reservation calendar and the shift view are **two co-equal surfaces**, and reservations
> are *upstream* of the vessel-day, not renting it. And item 1's catalog contents are refined by the
> **DEC-123 catalog model** + **DEC-125** (virtual availability). Read **DEC-123 / DEC-124 / DEC-125** as
> authoritative where they and this doc disagree; the corrected inline bits below track them.

1. **Catalog & pricing** *(net-new area)* — `Offering` create/edit: descriptive content, photos,
   **`Location`** (its own entity — pickup + route; DEC-123), **vessels** (capacity is a `Vessel` fact,
   not set here), schedule + price variations, add-ons, per-departure price (DEC-112), **gratuity**
   (DEC-124 — its own concept, *not* an add-on), and Draft/Live/Hidden publish state. Availability is
   **virtual** (DEC-125 — a computed rule, not materialized rows); **blocks/blackout are a separate scoped
   surface**, not on the `Offering`.
2. **Purchases & customers** *(net-new area)* — the order list + detail, refunds, resends, the customer
   contact record.
3. **Reservation actions on the event surface you already have** *(graft, not build)* — the roster
   actions (email/export/print), Change Arrival, Cancel Reservations, Event Notes, and the guest table
   attach to the **existing** shift/event surface.

> **The trap this avoids.** Building a second event calendar next to `/admin/shifts` is the mistake a
> straight Xola port walks into. Two calendars over one vessel-day means two places to look, two things
> to keep in sync, and an operator asking which one is right. The crew engine already owns the
> vessel-day; reservations rent space on it.

**Consequence for `Offering`:** the catalog is where Muster stops being a crew tool and starts being a
product the customer buys from. It has no crew-side analogue to lean on and no existing surface to graft
onto — which is why it's both net-new and the biggest piece.

---

## 3. Tips (see DEC-124)

Tips are the one surface that spans **both halves** of the app: reservation money → crew people. Nothing
else does. That is the argument for why it belongs in Muster at all — and the reason it is *not* built
in Muster yet.

**Muster's P12 scope is collect + expose, nothing more:**

- **Pre-gratuity at checkout — required.** Tiers (15/20/25%) mirroring the existing Xola config, which
  has three positive choices and no decline option.
- **Post-trip gratuity** — supported, via the booking link. See the lifecycle note below.
- **Gratuity is first-class, keyed by `kind` (pre/post) — NOT an add-on** (refined 2026-07-16, DEC-124):
  Xola's add-on tips were terrible because an add-on gets taxed/fee'd like revenue. Gratuity is crew
  money — routes to crew, exempt from tax + service fee. Configured per-`Offering`; add-ons stay a
  separate generic mechanism for real upsells.
- **Expose to be read** — per-event gratuity pool + assigned crew.

**Muster does NOT build** the split, the Gusto CSV, a tip report, or a crew "my tips" view in P12.
`xola-tip-extractor` owns all of that. It is a **finished app**; the only change it needs is a second
reader so it pulls from Muster as well as Xola. **The Xola + Muster union lives there, not here.**

**Lifecycle:** `xola-tip-extractor` lives until Xola is gone and dies with it. Its function moves into
Muster **after** Xola retires — a later phase, not P12.

**Booking-link consequence:** post-trip tipping means the DEC-122 capability URL **outlives the trip**.
It currently ends at "manage your booking"; post-trip it becomes "tip your crew." That is a lifecycle
change to the link, not merely a new form.

> **Forward reference:** DEC-122 (the customer booking link) currently lives on `feature/reservations`,
> not `main` — it arrives here at the P12 merge. Per the spec-on-`main` / code-on-`feature` split, that
> is expected, not drift.

---

## 4. Sizing

The customer-facing outline in `PROJECT_PLAN.md` §Phase 12 is six bullets. This enumeration is three
areas, two of them net-new, plus a graft. **The plan's ⚠️ was right: the admin half is the larger half
of Phase 12.** Tips, contrary to a first pass that sized it at 15–20 pts as a payroll subsystem, is
**single digits** — because the payroll machinery already exists and stays where it is.

Poker at the P12 boundary; this doc is the input to it, not a substitute for it.

## 5. Open questions

- **`Offering` ↔ vessel-day ownership.** DEC-106's Muster-owned-vessel-day config is the P11 partition.
  How an `Offering`'s schedule *generates* owned vessel-days (vs. an operator marking them by hand) is
  unsettled.
- **Reservation actions vs. crew actions on one surface.** The graft (§2.3) puts customer-facing actions
  on a surface built for crew. Whether that is one page with two action groups, or a per-event detail
  pane that admins open from the shift card, is a design call — mockup-first per the P12 method.
- **Waiver provider** (DEC-110) — a Drew/Spink call, still open.
- **Name reconciliation at the tip seam** — `xola-tip-extractor`'s Gusto map is done and correct for
  Xola. Whether Muster's crew names resolve against it when it starts reading Muster events is a
  build-time integration detail, not a design one. It warns loudly rather than failing silently.
