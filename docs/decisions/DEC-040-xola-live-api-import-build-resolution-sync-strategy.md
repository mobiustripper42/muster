---
id: DEC-040
title: "Xola live-API import — build resolution + sync strategy (5.4b; resolves DEC-036)"
topic: "Xola ingest & import"
amends:
  - id: DEC-017
    relation: supersedes
    scope: "manifest contact via email-join is retired"
  - id: DEC-036
    relation: corrects
    scope: "resolves DEC-036's 'confirm at build' items and corrects its field-mapping guesses"
---

## DEC-040: Xola live-API import — build resolution + sync strategy (5.4b; resolves DEC-036)

**Status:** Built (task 5.4b). Resolves DEC-036's "confirm at build" items against a live sandbox `GET /orders` (2026-06-18) and sets the ongoing-sync strategy DEC-036 left open. DEC-036's architecture (a second Land adapter behind the DEC-015 seam) stands unchanged; this corrects its field-mapping guesses and adds the "how it stays current" leg.

**Field mapping — confirmed from live data (corrects DEC-036's `expand` spike):**
- **No `expand` needed.** `items[]`, item `name`, `arrival*`, and `quantity` are inline on the order; `event`/`experience`/`organizer`/`travelers` are `{id}` refs we don't need to form shifts.
- **Contact is order-level, inline:** `order.phone` + `order.phoneCanonical` (NOT `organizer.phone`). → **DEC-017's customers-export email-join is retired**; phone threads straight through. A new optional `phone` on `RawReservationRecord` carries it (xlsx leaves it undefined); **excluded from DEC-029 materiality** — a phone correction isn't shift-material and must not cry wolf on a locked shift.
- **Reservation identity = `items[].id`** (one record per item — a Xola order holds N bookable items).
- **Party size = `items[].quantity`** (agrees with `guests.length`).
- **Time:** `items[].arrivalDatetime` ("…T18:00:00−04:00") carries the vessel offset, so the wall-clock slices out tz-free (DEC-032) — DEC-036 seam-B's instant-laundering worry is **moot** (Xola hands us vessel-local components directly). Falls back to `arrival` + `arrivalTime` (HHMM).
- **Status:** `items[].status` int — 200/201/202/203 booked, **700 cancelled**. The pull's `items.status[in]` filter **includes 700** (unlike the tip extractor) so a booked→cancelled transition reconciles (sync job #3); the mapper turns it into a `cancelled` record exactly as the xlsx Status column does.

**Sync strategy (the leg DEC-036 left open) — three jobs, one client:**
- **Backfill + primary live sync = hourly poll (Architecture B).** A dedicated cron `/api/cron/xola-pull` (`0 * * * *`), **separate from `/api/cron/tick`** so a Xola 5xx can't disrupt the ask loop. Pulls a [today−1, today+horizon+1] vessel-local window → `importRecords` → `formShifts`. Idempotent (identity + materiality), so an overlapping re-pull is a cheap no-op.
- **CSV (5.4a) stays the manual Xola-downtime fallback** — a pull can 503 on a crew Saturday; a file upload can't.
- **Webhooks (`order.create`/`order.update`/`order.cancel`) are ABANDONED for the pilot — there is no 5.4c.** Investigation (2026-06-19) established they're not a per-key feature but an **approved-App** one, configured in the App Store Console (event checkboxes + API version; the seller API key 403s on the hooks endpoint). The BrewBoat sandbox app is approved, but **production** webhooks would need that app approved + installed in production (kickoff/review) — a gate the operator has and is unlikely to clear. Net cost ≈ nil: the hourly poll already does all three ingest jobs; webhooks would only add latency, immaterial against a days-long horizon. **If same-day freshness ever matters, the lever is poll cadence** (hourly → 15m/5m in `vercel.json`), never webhooks. The 5.4b client would be reused if a production app ever lands. *(Independently corroborated: the sibling `crewbook` reached the same poll-primary conclusion.)*

**Layering (DEC-020):** the client splits into pure, unit-tested pieces (`mapXolaOrders`, the `fetchOrders` skip-pagination loop, `pullXola` orchestration, window math) that take an injected `fetcher`, and a single edge module (`app/lib/xola.ts`) that reads the server-only `XOLA_*` env and binds global `fetch` + retry (3× backoff, 429 `Retry-After`). `vercel.json`'s second cron is fail-closed on `CRON_SECRET` like the first.

**Open / verify-at-pilot:**
- **Sandbox product names ≠ production export names.** The sandbox's "Brewboat Tour - captained" isn't in `PRODUCT_MAP` (seeded from the real 2026 export), so a *sandbox* pull quarantines everything (DEC-018 working as intended). Live BrewBoat data carries the mapped names; confirm at first prod pull, or add sandbox names to the map for end-to-end sandbox exercises.
- **Cancellation visibility.** The default list query carries `status=committed`; whether a fully-cancelled *order* (vs a 700 *item* on a committed order) still appears needs a real cancelled sandbox order to confirm — the operator can create one. Booked path is validated live; cancel path is built to best understanding.
- **Multi-guest party size** (`quantity` vs `guests.length`) verified equal on a 1-guest order; confirm on a 2+ order.

**Relationship:** resolves DEC-036; retires DEC-017's email-join; preserves DEC-015/018/029/032; adds no new domain state.
