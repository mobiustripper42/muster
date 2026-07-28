---
id: DEC-035
title: "Xola import surface — import→formShifts chaining, re-import idempotency, upload security"
topic: "Xola ingest & import"
---

## DEC-035: Xola import surface — import→formShifts chaining, re-import idempotency, upload security

**Status:** Proposed (Phase 5 / 5.4, #73) — @architect 2026-06-12; confirm at build (@architect + security pass in-PR).

**Decision (proposed):** Operator-facing `/admin/import` (admin-session-gated, 375px): upload `.xlsx` → **preview + validate** (unmapped products quarantined via `product-map.ts`, bad dates/missing fields surfaced) → confirm → `importReservations` (events + reservations) **then `formShifts`** (shifts + seats) so the board is live immediately. **Open at build:** re-import semantics for an overlapping week (upsert vs dupe — needs a rule); upload security posture (first file-upload surface — size/sheet/scope limits, no formula eval). Gated on DEC-032 (real Pacific times must render correctly before real data reaches crew). #73.
