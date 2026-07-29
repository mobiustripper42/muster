---
id: DEC-124
title: "Tips come into Muster as collect-and-expose; `xola-tip-extractor` owns the split and the Xola+Muster union until Xola dies (reverses DEC-036's tip parking)"
topic: "Reservations & payments"
amends:
  - id: DEC-036
    relation: reverses
    scope: "its tip/gratuity/guide-machinery parking only"
amends_spec:
  - section: "4"
    scope: "the payments park no longer covers gratuity — Muster collects and exposes tips, though it does not own the split"
---

## DEC-124: Tips come into Muster as collect-and-expose; `xola-tip-extractor` owns the split and the Xola+Muster union until Xola dies (reverses DEC-036's tip parking)

**Status:** Accepted (operator, 2026-07-15, S54) — the reversal is the operator's call; the shape is
**pending @architect**. Amends **DEC-036**.

**Decision:** Muster **collects and reports tips**. DEC-036 said the Xola client port leaves behind "the
gratuity / tip-split / guide machinery (**not Muster's job** — payments parked, SPEC §4)." **That is
reversed.** But the reversal is *not* an instruction to build a payroll subsystem:

**Muster's Phase 12 scope — collect + expose, nothing more:**
- **Pre-gratuity at checkout, required.** Tiers (15/20/25%), mirroring the live Xola config — which
  offers three positive choices and **no decline option**.
- **Post-trip gratuity** — supported, via the booking link.
- Configured per-`Offering`, in the catalog (DEC-123 §2).
- **Expose to be read**: per-event gratuity pool + assigned crew.

> **Refined 2026-07-16 (operator): "gratuity," first-class, NOT an add-on.**
> - **Call it `gratuity`, not "tips."** One table, keyed by **`kind`** (`pre` | `post` — the two known
>   now; the column takes more if they appear). Pre = at checkout; post = via the booking link.
> - **Gratuity is NOT an add-on** — the operator's explicit reversal of "Tipping is an optional add-on
>   setting... mirrors Xola." *Xola's add-on tips have been terrible precisely because an add-on gets
>   **taxed and fee'd like revenue**.* Gratuity is **crew money, not revenue**: it **routes to crew** (the
>   `xola-tip-extractor` union below), is **exempt from tax and the service fee**, and reports as crew pay,
>   not sales. Modeling it as a flagged add-on was considered and rejected — a first-class typed table with
>   `kind` is the honest shape and avoids the name-matching fragility that already bit the Gusto map.
> - **Add-ons stay a separate generic mechanism** for real upsells (extra hour, catering, photos) — the
>   one good thing about Xola's add-ons (no-code extensibility), kept, but with gratuity pulled out of it.

**Muster does NOT build** the split, the Gusto CSV, a tip report, or a crew "my tips" view in P12.

**`xola-tip-extractor` is a finished app** (the operator's). It keeps the per-event-pool ÷ assigned-guides
split, the Gusto timesheet CSV + guide→Gusto identity map, and its operator/guide auth. **The only change
it needs is a second reader**, so it pulls tips from **Muster** as well as Xola during the coexistence
drain. **The Xola + Muster union lives there, not in Muster.**

**Lifecycle:** it **lives until Xola is gone and dies with it** (DEC-105's drain: Xola's forward book
empties naturally, then the subscription is cancelled). Its function moves into Muster only **after**
Xola retires — a later phase, **not P12**.

**Amendment (2026-07-18, operator + S56 poker — re-scopes the collect-and-expose leg).** The "collect +
expose only; Muster builds no split/Gusto/report; the union lives in the extractor" model is narrowed:
- **P12 (task 12.3): Muster generates its OWN Gusto report** — the even-split-per-crew + the Gusto CSV,
  **lifted from `xola-tip-extractor`** (the code is done; getting it is the work) — for **Muster-side**
  tips. So Muster **does** build the split + Gusto CSV in P12, **for its own tips** (this reverses "Muster
  does NOT build the split/Gusto/report," on the Muster side). There is **no read contract** exposed to the
  extractor and **no `muster-tip-extractor`** — "collect + expose" becomes "collect + Muster reports its
  own."
- **Deferred: the Xola tip reader / union.** During the transition the operator gets **two lists** —
  Muster's Gusto report and the extractor's — and **adds them by hand** (as they did for ~2 years). The
  in-Muster Muster+Xola union is **not** built for P12.
- **End state (post-P12, at Xola sunset): the whole apparatus lives in Muster** — split, Gusto CSV, the
  Muster+Xola **union**, and a single final Gusto export; the extractor's machinery moves in and it retires.
  The **transition mechanism** (one combined export while both systems run) is **TBD**, deferred to the
  Xola-sunset phase — not forced now.

The DEC-124 core is unchanged (gratuity is first-class crew money, tax/fee-exempt, routes to crew). What
changed is **who computes the payroll report and when**: Muster owns its own from P12; the union arrives at
sunset.

**Why the union lives there, not here:** for the whole overlap, tips exist in **both** systems. The tool
that already does splits and emits the Gusto CSV is the cheapest place to union two readers. Building a
parallel tip report in Muster during the drain duplicates a working tool and risks the worst bug in the
phase — **Spink hands Gusto a half-empty payroll CSV**. A first pass sized this at 15–20 pts by assuming
Muster absorbs the extractor; that was wrong, and the correct scope is **single digits**.

**Why it belongs in Muster eventually:** tips are the **one surface spanning both halves of the app** —
reservation money → crew people. Nothing else does. Three of the extractor's load-bearing parts are
things Muster already has natively: *guides assigned to an event* (the crew engine knows), the
*Xola-name → Gusto identity map* (crew records could carry it), and the *per-guide self-serve view* (the
crew app, DEC-081). None of that is licensed until Xola is gone.

**Booking-link consequence:** post-trip tipping means the **DEC-122 capability URL outlives the trip** —
"manage your booking" becomes "tip your crew." A lifecycle change to the link, not just a new form.
*(DEC-122 itself lives on `feature/reservations` until the P12 merge — a forward reference from `main`,
expected under the spec-on-`main` / code-on-`feature` split, not drift.)*

**Amends DEC-036** (its tip/gratuity/guide-machinery parking only — the `fetchOrders`/`fetchEvents` Land
adapter, the seam, and every other leg stand). **Touches** DEC-107 (Stripe), DEC-122 (booking link),
DEC-123 (the per-`Offering` setting lives in the catalog). **Open at build:** the read's shape and auth;
whether Muster crew names resolve against the extractor's (done, Xola-correct) Gusto map at the new seam —
it warns loudly rather than failing silently. **Revise if:** Xola's drain stalls long enough that the
overlap outlives the tool's usefulness.
