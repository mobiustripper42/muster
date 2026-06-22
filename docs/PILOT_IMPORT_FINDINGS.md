# Pilot Import — Resolved Model (Session 22)

**Status: RESOLVED and shipped.** What was a blocker (the importer collapsed BrewBoat's
4 boats into one shift) is fixed by the events-driven rework — see **DEC-043** for the
decision and **DEC-044** for the MMC placeholder. This doc is the quick reference.

---

## The boat lives on the event (the unlock)

The assigned boat is a Xola **Resource on the trip's event**, not derivable from the
product string. The chain, verified against live production:

```
purchase item → item.event.id → GET /events → resourceUsages[].resource.id → /resources (name + capacity)
```

- The `/events` LIST feed returns `resourceUsages` (the boat), `quantity` (pax), and
  `guides` **inline** — a bare array, now-forward, ignores date filters.
- **Boated ⟺ has confirmed bookings** — a boat is assigned only once a trip has pax;
  no "boated but empty" events exist. (≤12 auto-assigns boat 3/4; >12 Drew hand-assigns
  boat 1/2 — `manuallyAssignedAt`/`By` is visible on the event.)
- Ingest pulls **`/events` ⨝ `/orders`** joined on `event.id`: events give the boat,
  orders give the bookings (`items[].id` is a stable reservation key, cross-referenced
  on `event.purchaseItems[].id`). One event = one boat-trip = one shift, keyed on the
  real `event.id`.

## The real fleet (replaces the invented product-map vessels)

| Boat | Cap | Xola resource id | Role |
|------|-----|------------------|------|
| Brew 1 | 14 | `656e10bc5b8ef1b1800a02c4` | crewed (captain + mate) |
| Brew 2 | 16 | `656e10ce46c61175bd0de305` | crewed (captain + mate) |
| Brew 3 | 12 | `656e0fcdf9f593e84b0e1782` | crewed (captain + mate) |
| Brew 4 | 12 | `656e0feb91aa27f36908371b` | crewed (captain + mate) |
| Duffy 1 / Duffy | 12 | `656e0f76…` / `656e0f96…` | **self-captained — excluded** |

Prod seller id: `6564f488e56ba88c4f0ebdaa`. Seeded by `db/seed-fleet.ts` (`npm run db:seed:fleet`).

## Cancels & changes

- **Cancels are explicit `status: 700` rows** (the pull includes 700), matched by item
  id — `200 → 700` is the signal. A fully-cancelled trip de-boats; its 700 row
  reconciles against the stored event → shift cancelled. No absence-tracking needed.
- **Field edits** match by item id + the DEC-029 materiality compare. Pax never changes
  crew (manning is fixed 2/boat); a reassigned boat reconciles in place.

## Crew

- Roster seeded by `db/seed-pilot-crew.ts` (`npm run db:seed:crew:pilot`): 21 real crew
  (name/email/phone), real captain/mate split (7 captains, 14 mates; captains can also
  mate). `PILOT_GUIDES` env scopes the active subset.
- **MMC:** BrewBoat tracks none yet → a placeholder far-future expiry keeps the universal
  eligibility gate open (**DEC-044**). The guide roster endpoint is `403` for the seller
  key, so crew is seeded manually, not imported.

## Remaining (operator data, not code)

- Real MMC expiries per person, as BrewBoat starts collecting them (replace the
  `2099-12-31` placeholder).
- An unknown resource id surfacing in a pull (`XolaPullResult.unmappedResources`) = a new
  or renamed boat to add to `resource-map.ts`.
