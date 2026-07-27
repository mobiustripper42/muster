---
id: DEC-080
title: "The Xola pull window is decoupled from the staffing horizon"
topic: "Timing — horizons, deadlines & vessel clock"
---

## DEC-080: The Xola pull window is decoupled from the staffing horizon

**Status:** Accepted (pilot tuning, 2026-06-29).

**Decision:**
- The importer's `/orders` fetch window now reads its own env knob **`XOLA_PULL_LEAD_DAYS`**
  (`src/builder/derive.ts`, `envPositiveInt`), **defaulting to `STAFFING_HORIZON_LEAD_DAYS`** so an
  unset value reproduces the prior behaviour exactly. `pullWindow` and `pullXola`
  (`src/import/xola-pull.ts`) size the fetch window from the **pull** lead.
- **Shift formation is unchanged.** Inside `pullXola`, `formShifts` keeps keying off
  `STAFFING_HORIZON_LEAD_DAYS` (the staffing horizon, `opts.leadDays`), so a wider pull imports more
  bookings for the operator to *see* without the engine starting to *ask* crew that far out
  (Pending→Filling, and therefore the Tier-1 asks, are unaffected).

**Why:** The operator wanted to pull ~a month of bookings ahead, but the import window and the
staffing horizon were the **same constant** — bumping it to 30 would have made the engine ask crew a
month out, against the anti-anxiety design (DEC-042 ethos, the §2.6 "no stale far-future" stance). The
two leads answer different questions ("how much do I want to *see*?" vs "how early do I *ask*?") and
now have independent knobs.

**Tradeoff:** A second days-ahead knob the operator can set inconsistently (e.g. a pull *narrower*
than the horizon would starve the engine of far-horizon shifts) — accepted; the default-to-horizon
fallback makes "unset" safe, and a too-narrow pull is an obvious misconfiguration, not a silent
corruption. **Rejected:** bumping the shared `STAFFING_HORIZON_LEAD_DAYS` (couples seeing to asking —
the bug); a fixed wider pull constant (un-tunable; the pilot wants to dial it); deriving the pull lead
as `horizon × k` (a magic multiplier hides intent vs an explicit days value). **Revisit if:** the pull
and horizon want to diverge per-rule or per-tenant → fold both into the tenant-config layer the
DEC-022 "constant now, config later" note already anticipates. **Phase:** pilot tuning (between 6 and 7).
