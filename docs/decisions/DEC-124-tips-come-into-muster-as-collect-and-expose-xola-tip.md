---
id: DEC-124
title: "Tips come into Muster as collect-and-expose; `xola-tip-extractor` owns the split and the Xola+Muster union until Xola dies (reverses DEC-036's tip parking)"
topic: "Reservations & payments"
amends_spec:
  - section: "4"
    scope: "the payments park no longer covers gratuity — Muster collects and exposes tips, though it does not own the split"
---

## DEC-124: Tips come into Muster as collect-and-expose; `xola-tip-extractor` owns the split and the Xola+Muster union until Xola dies (reverses DEC-036's tip parking)

**See also** — decisions this one changed part of:
- Reverses DEC-036 — its tip/gratuity/guide-machinery parking only

**Status:** Accepted (operator, 2026-07-15, S54).

**What tips ARE — the amounts, the tiers, the split, what is taxed — is `SPEC.md` §2.8.4a/§2.8.4b.**
Read it there. This file keeps only the two things the spec cannot carry: an alternative that was
rejected for a reason that still applies, and where the work lives during the Xola overlap.

### Gratuity is first-class, NOT an add-on

Rejected 2026-07-16 (operator), reversing an earlier "tipping is an optional add-on setting, mirrors
Xola."

**Xola's add-on tips have been bad precisely because an add-on is taxed and fee'd like revenue.**
Gratuity is crew money, not revenue: it routes to crew, and it is exempt from tax and the service fee.
Modelling it as a flagged add-on was considered and rejected — a first-class typed table keyed by
`kind` is the honest shape and avoids the name-matching fragility that already bit the Gusto map.

**Add-ons stay a separate generic mechanism** for real upsells — extra hour, catering, photos. The one
good thing about Xola's add-ons is no-code extensibility; that is kept, with gratuity pulled out of it.

This is why the two must not be merged later for convenience. The tax and fee treatment is the whole
difference, and it is stated in §2.8.4a.

### Where the split lives during the Xola overlap

Muster computes its own even split and its own Gusto CSV, lifted from `xola-tip-extractor` (2026-07-18,
operator + S56 — narrowing the original "Muster builds no split/report" scope).

**The Muster + Xola union is not built.** For the whole overlap, tips exist in both systems, and the
tool that already does splits and emits the Gusto CSV is the cheapest place to union two readers.
Building a parallel union in Muster during the drain duplicates a working tool and risks the worst bug
in the phase — Spink hands Gusto a half-empty payroll CSV. The operator gets two lists and adds them by
hand, as they did for two years.

**At Xola sunset the whole apparatus moves into Muster** — split, Gusto CSV, union, one final export —
and the extractor retires. It belongs here eventually because tips are the one surface spanning both
halves of the app: reservation money reaching crew people. Three of the extractor's load-bearing parts
are things Muster already has natively — which crew worked an event, the crew identity map, and a
per-crew self-serve view. None of that is licensed until Xola is gone. The transition mechanism, for
the period when both systems run, is deferred to that phase.

**Amends DEC-036** — its tip/gratuity/guide-machinery parking only; the `fetchOrders`/`fetchEvents`
adapter, the seam and every other leg stand. **Revise if:** Xola's drain stalls long enough that the
overlap outlives the tool's usefulness.
