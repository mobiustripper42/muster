---
id: DEC-043
title: "Ingest is events-driven — the boat is the event's assigned Resource, not a vessel invented from the product string (supersedes DEC-016's collapse)"
topic: "Xola ingest & import"
---

## DEC-043: Ingest is events-driven — the boat is the event's assigned Resource, not a vessel invented from the product string (supersedes DEC-016's collapse)

**See also** — decisions this one changed part of:
- Amends DEC-016 — the vessel-from-product collapse only. The worked-example leg is live authority — cited by SPEC §Fleet for per-vessel manning counts
- Supersedes DEC-037 — the xlsx-first half is retired; the API Land adapter shipped
- Amends DEC-036 — the planned `fetchEvents` half is now the primary adapter; the xlsx upload is retired
- Amends DEC-018 — quarantine keys off `resource.id`
- Amends DEC-029 — `vesselId` joins the material set

**See also** — later decisions that changed part of this one:
- Extended by DEC-106 — the import merge rule

**Status:** Built (Session 22, PR #110). @architect-gated. The Xola Land adapter pulls **`/events`** alongside `/orders` and joins them on the real `event.id`; everything downstream of the DEC-015 seam is unchanged.

**The bug it fixes:** `importRecords` keyed events as `vessel+date+time`, resolving the vessel from the free-text product via `PRODUCT_MAP` (DEC-016). BrewBoat is ONE experience run across 4 boats, so every boat-trip at the same slot collapsed into one event/shift — under-counting crews. Both the xlsx and the orders pull shared this collapse. Verified in production (Session 22): the assigned boat is a **Resource on the event** (`event.resourceUsages[].resource.id`), which the orders feed drops.

**Decision:**
- **Events-driven join.** `fetchEvents` (a bare-array, now-forward feed) → `eventVesselMap` resolves each boated event to a real vessel; `mapXolaOrders` stamps the resolved `vesselId` + the real `eventId` onto each booked record. Orders carry the bookings + the `item.event.id` join key; the windowed orders pull bounds the import.
- **Key the event on the real `event.id`.** Four boats at one slot → four events → four shifts. A reassigned boat (Drew moves a >12-pax trip) reconciles **in place** — same `event.id`, new vessel — and `formShifts` now cancels the old vessel+day shift instead of orphaning it (the one builder change).
- **The fleet is seeded by resource id**, not invented: Brew 1/2/3/4 (cap 14/16/12/12, all captain+mate); the 2 self-captained Duffy resources are excluded; an unknown resource id is quarantined (fulfilling DEC-018's "key off a stable id" revisit). `product-map.ts` → `resource-map.ts`.
- **Time = wall-clock string-slice off `event.start`** (DEC-032) — never `new Date()`, which would shift every departure by the offset (`start` carries the local wall-clock under a `Z` suffix; verified against `arrivalDatetime`'s offset).
- **Cancels are explicit status-700 rows, not absences** (verified) — matched by `items[].id`, status `200→700`. A fully-cancelled trip de-boats; its 700 row reconciles against the **stored** event (which kept its vessel) → event `cancelled` → shift cancelled. No vanish/absence-detection (DEC-037 punt holds).
- **Boat-less events are skipped + counted**; the next pull picks them up once a boat is assigned.
- **Crew is seeded manually, not imported** (the guide roster is 403 for the seller key); Xola guide *assignments* are **not** imported as seats (DEC-009 — Muster owns crewing).
- **Operator trust model:** ~~auto-import stays~~, Xola is the single source of truth; a bad boat assignment is fixed **in Xola + "Pull now"** (no Muster-side staging/override). `XolaPullResult.assignments` (per-day boat→times) + `unmappedResources` (an unknown boat id) are the operator's review surface to catch a bad assignment.
  > **Amended 2026-07-26 (S71, audit shard C2.2).** *Auto-import did not stay.* Commit `13d3fb5` removed the hourly `xola-pull` cron from `vercel.json` — the operator wants to control when imports land — and on operator confirmation this session, **there is no automatic import and there will not be one**. Every import is the "Pull now" button. The rest of the trust model is unaffected: Xola is still the single source of truth and the review surface is unchanged; the only change is that "Pull now" is the *sole* trigger rather than a manual supplement to a background pull. Five files asserted the hourly cadence in operator-facing copy and comments long after it was gone (`/admin/import` ×2, `xola-pull/route.ts`, `xola-pull.ts`, `DEPLOY.md`) — all corrected here.

**Supersedes:** DEC-016's single-vessel-per-product collapse + its 5 invented vessels (the durable DEC-016 / DEC-ROLE-1 principle — manning is data the deriver loops — **stands**; only the invented fleet dies). **Amends:** DEC-036/DEC-037 (the planned `fetchEvents` half is now the primary adapter; the xlsx upload is retired — it can't resolve a boat), DEC-018 (quarantine keys off `resource.id`), DEC-029 (`vesselId` joins the material set; event identity is the real `event.id`). **Untouched:** DEC-015 (seam), DEC-032 (vessel-local), DEC-022/DEC-031 (horizon / fills-by), DEC-009.

**Relationship:** the second Land adapter DEC-015 anticipated, and simpler than the orders adapter (boat + crew inline). G1–G9 reconcile harness in `xola-pull.test.ts` pins the behavior — it caught the reassignment-orphan bug before ship.
