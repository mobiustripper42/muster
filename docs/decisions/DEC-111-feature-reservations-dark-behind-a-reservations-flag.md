---
id: DEC-111
title: "`feature/reservations` dark behind a `RESERVATIONS` flag until the first real paid booking"
topic: "Reservations & payments"
---

## DEC-111: `feature/reservations` dark behind a `RESERVATIONS` flag until the first real paid booking

**Status:** Decided 2026-07-11 (@architect, under DEC-105 + DEC-059).

**Decision.** All Phase 11 work rides **`feature/reservations`** off `main`, behind a **`RESERVATIONS`
flag** (DEC-059) — the public surface is a broken half-feature until the webhook lands, and **money must
not reach `main`/`production` until one real paid reservation validates end-to-end**. **Exception:** the
`source` migration (DEC-106) and the availability deriver are additive and inert — land the **migration on
`main` first** (DEC-059 merge-hygiene: avoid long-lived schema divergence), then branch. The flag flips to
live only after the spine is proven in Stripe test-mode + a single real payment. **Revisit if:** the slice
proves out and the flag becomes permanent-on (then retire the flag at the Phase 12 flip).
