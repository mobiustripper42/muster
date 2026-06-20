# Pilot Import — Findings & Handoff (2026-06-20)

**Status: BLOCKED on a real import model.** The pilot cannot run on the current importer.
This is the cold-start context for picking it back up in a CLI session (where we can run code and
trial-and-error the live Xola API).

---

## The blocker (one line)

The importer **collapses BrewBoat's 4 physical boats into a single shift**, so it undercounts how
many crews a day needs. A Saturday running 3 boats reads as one trip needing one captain+mate.

## Root cause

- `src/import/import-reservations.ts` → `importRecords()` keys an event as **`vessel + date + time`**
  and resolves the vessel from the **product string** via `PRODUCT_MAP` (`src/import/product-map.ts`).
- One Xola **experience** (product) → **one** vessel in that map. BrewBoat is one experience across
  **4 boats**, so every boat-trip at the same date/time merges into one event/seat-set.
- The map's 5 vessels are **invented** (DEC-016 says so in the file header): capacities guessed,
  manning fabricated, vessel "name" = the id handle. Never validated against real COIs.
- **The xlsx upload and the live-API pull share this same `importRecords`** — so switching off the
  xlsx does **not** fix the collapse. The real axis is **orders vs events**, not xlsx vs API. Both
  current paths ingest orders.

## What the real export proved

Operator uploaded a real **"Events Export"** (`Xola_purchaseItems_…2026_06_17`). It has 4 sheets;
the importer only reads `Reservations`. The **`Events` sheet** is the useful one:

- **127 event rows — one per boat-trip.** Same date+time appears as **multiple rows**
  (e.g. 25-Jul 7:30 PM = 3 rows; 20-Jun = 9 events; 27-Jun = 8). **Xola already separates the boats**
  into distinct events — the importer just never looks here.
- **Guides are already assigned per event**, as named columns marked `1` (16-pax → Brendan McGovern +
  Eric Stoffer; 11-pax → Eric Stoffer + Kevin Berger). The importer ignores crew entirely.
- Lots of pax-0 / pax-1 Duffy "Self Captained" noise to filter.
- **No explicit boat number and no per-event ID** in the sheet → idempotent re-import needs a
  synthetic key to tell identical-time boats apart.

## The real Xola model (per operator)

- **Purchases** hold line **items**. **Vessels = Resources** (equipment).
- A booking ≤12 pax **auto-assigns** to boat **3 or 4** (the 12-pax boats).
- A booking >12 pax triggers addon questions ("*Are you interested in adding more guests over 12?*",
  "*…call BrewBoat to confirm a larger boat*", "*Extra Tickets: $40/person*") and **Drew hand-assigns
  boat 1 or 2** on the back end.
- So the assigned boat is **a Resource attached to a purchase item.** The operator is confident the
  **API can return the boat** — we just have to find the field by trial-and-error.

## The real fleet (replaces the invented product-map vessels)

| Boat | Capacity |
|------|----------|
| BrewBoat 1 | 14 |
| BrewBoat 2 | 16 |
| BrewBoat 3 | 12 |
| BrewBoat 4 | 12 |

(There is **one** experience today: "BrewBoat Non Cycle Private 12," sold as 12–16 pax.)

## The real crew roster (names seen in the Events-sheet guide columns)

Brendan McGovern · Kelsey Kelly · Will Whalen · Eric Stoffer · Ashley Londrico · Liam McHale ·
Gerald Czarnecki · Darrell Hughes · Brandon Suarez · Paul Learman · Mackenzie Gerl · Kevin Berger ·
Calli Neumann · Tiffany Kay · Michael Scaffide.
*(Ratings captain-vs-mate, phones, and MMC expiries still unknown — needed for `seed-pilot-crew.ts`.)*

## Fix direction

Ingest Xola **events/resources, not orders**:
1. Pull the assigned **boat (Resource)** per purchase item.
2. **One boat-trip = one shift.** Drop the `product → single-vessel` collapse.
3. Seed the **4 real boats** with real COI capacities + manning.
4. (Stretch) carry the already-assigned guides through as pre-filled seats.

## Immediate next step (CLI session)

Get one real **`GET /purchases/{id}`** JSON — ideally a **14+ pax trip Drew hand-assigned to boat
1 or 2** — and find the resource/boat field on the line item. Relevant endpoints the operator
listed: `/purchases`, `/purchases/{id}/items/{itemId}`, `/resources`, `/experiences/{id}/resources`.
The live client (`src/import/xola-client.ts`) currently reads only `items[].{id,name,arrival,
arrivalTime,arrivalDatetime,quantity,status}` and **drops the `event`/`experience` refs** — that's
where the boat resolution has to be added.

## Files added this session (WIP scaffolds)

- `db/seed-fleet.ts` (`npm run db:seed:fleet`) — seeds the product-map fleet so import stops forming
  zero-seat shifts. **Built on the wrong (invented) fleet model** — replace its vessels with the 4
  real boats once the import model is fixed.
- `db/seed-pilot-crew.ts` (`npm run db:seed:crew:pilot`) — editable real-crew template (names, phone,
  ratings, MMC). Fill from the roster above + the missing ratings/phones/MMC.
