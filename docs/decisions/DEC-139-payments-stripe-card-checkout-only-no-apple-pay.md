---
id: DEC-139
title: "Payments — Stripe card checkout only; no Apple Pay / wallets (foreseeable future)"
topic: "Reservations & payments"
---

## DEC-139: Payments — Stripe card checkout only; no Apple Pay / wallets (foreseeable future)

**Status:** Decided 2026-07-20 (Eric). Refines the DEC-138 payment note; sits under DEC-105 (Phase 11–12 payments).

**Decision.** The customer checkout takes **card payment via Stripe and nothing else** — **no Apple Pay, no Google Pay, no PayPal or other wallets** — for the foreseeable future. One checkout, Stripe only. (FareHarbor ships several checkout variants; that's multi-tenant tax we don't inherit — Muster ships a single checkout.)

**Why.** Card-only is enough for BrewBoat; wallets add surface without a clear return, and Apple Pay specifically carries a **per-embedding-domain verification burden**. Dropping wallets **removes that headache from the DEC-138 iframe embed entirely** — payment is just Stripe card on Muster's origin, embeddable on any operator page with no per-domain wallet setup.

**Stripe Link is not excluded.** Link is Stripe-native (1-click card autofill, not a third-party wallet), so it's compatible with "Stripe only" and could be added later as a pure Stripe feature. The current booking mockup leaves it out for simplicity.

**Revisit if:** conversion data later shows wallets meaningfully lift completion, or a specific tenant's audience clearly expects Apple/Google Pay — then weigh the per-domain verification cost against the measured lift.
