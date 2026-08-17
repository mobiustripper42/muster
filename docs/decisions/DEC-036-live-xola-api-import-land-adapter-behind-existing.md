---
id: DEC-036
title: "Live Xola API import — Land adapter behind existing Map/Reconcile; supersedes DEC-011's API kill"
topic: "Xola ingest & import"
amends_spec:
  - section: "4"
    scope: "\"Explicitly killed · The Xola API bolt-on\" is un-killed — DEC-011's kill rested on a premise falsified by a working client proven live 2026-06-15"
---

## DEC-036: Live Xola API import — Land adapter behind existing Map/Reconcile; supersedes DEC-011's API kill

**See also** — decisions this one changed part of:
- Amends DEC-011 — the Xola API bolt-on kill, which DEC-036 revived. The coexistence leg is live

**See also** — later decisions that changed part of this one:
- Corrected by DEC-040 — resolves DEC-036's 'confirm at build' items and corrects its field-mapping guesses
- Amended by DEC-043 — the planned `fetchEvents` half is now the primary adapter; the xlsx upload is retired
- Reversed by DEC-124 — its tip/gratuity/guide-machinery parking only

**Status:** Proposed (Phase 5 / reframes 5.4, #73) — @architect 2026-06-15 (Opus; Fable unavailable). Confirm at build; **two field-shape confirmations deferred to build (below).**

**Decision (proposed):** The 2026 coexistence import gains a **live Xola API Land adapter** as the primary ingest, replacing the manual `.xlsx` export+upload. **Everything downstream of the Land seam is unchanged** — `importReservations`'s Map+Reconcile (event upsert by `evt-${vesselId}-${date}-${time}`, identity on `Reservation ID`, `updatedAt` materiality per DEC-029, `resolveProduct` quarantine per DEC-018) stays as-is. The client (`X-API-Key`/`X-API-Version` auth, skip-pagination, 429/5xx retry, DST-aware date windows) is **ported from the sibling `xola-tip-extractor` (`netlify/functions/lib/xola.js`) into strict TS/NodeNext** — **`fetchOrders` + `fetchEvents` only**; the gratuity / tip-split / guide machinery is left behind (not Muster's job — payments parked, SPEC §4).

**Scope (operator's call, 2026-06-15) — bare pull, review surface deferred:** pull → `importRecords` → `formShifts` → board live, with minimal preview. The full preview / validate / quarantine **review surface of DEC-035 is deferred** (commits closer to blind — an accepted tradeoff for the fastest path to a working pilot). The **xlsx reader is retained** as the Xola-downtime fallback (an API pull can 503 on a crew Saturday; a file upload can't).

**Land seam — build (B):** split `importReservations` into `decodeXlsxRows()` + `importRecords(repo, records, now)`; the API adapter maps JSON straight to a `RawReservationRecord[]` intermediate and calls `importRecords`. Chosen over the fake-header shim (A) because the API returns true instants — re-stringifying them into `"03:30 PM"` for re-parse would throw away DEC-032's vessel-local correctness at the seam.

**Field mapping (spike, 2026-06-15 — Xola Purchase `expand`):**
- contact (`customerName` / `email` / `phone`) ← `expand=organizer` (the booking account — *not* `travelers`, who are the participants).
- event link / arrival date+time / per-item status ← `expand=items` (`items[].event`, `items[].arrival`, `items[].status`; codes 200–203 booked, 700 cancelled).
- `partySize` ← `expand=travelers` (count) **or** `items[].quantity` — **confirm which at build.**
- **Confirm at build** (one live `?expand[]=organizer&expand[]=items&expand[]=travelers` response settles both): (1) is `organizer.phone` actually *populated*, not just present in the schema? (2) the party-size source. The list endpoint (the extractor's `/orders`) takes the same `expand`.

**Supersedes DEC-011's API kill** — and corrects SPEC §4 "Explicitly killed · The Xola API bolt-on" (a DEC-014 correction). DEC-011 killed the API believing it unreliable / hard to extract from (traced to faulty "crewbook" info) — **falsified** by a working, tested client proven live 2026-06-15. DEC-011's *other* leg (the ~18-month kill date / disposability) **stands, and is what licenses this**: a finished, quarantined adapter is as disposable as the xlsx reader it replaces, dying in 2027 with the rest of the import path (SPEC §0.3). The **manual guide write-back sheet (§3.5) is unaffected** — this is read-only ingest, no writes to Xola.

**Relationship to DEC-015 / 017 / 018 / 032 / 035:**
- **DEC-015 holds** — Land→Map→Reconcile quarantine is the architecture; this is a second Land adapter, exactly the case it anticipated.
- **DEC-017 (phone email-join): revision unblocked, pending confirm.** If `organizer.phone` comes back populated inline, the separate customers-export email-join dies. Until confirmed, phone stays nullable (DEC-017's existing model) — a missing phone degrades, never blocks.
- **DEC-018 (product map): holds.** Its "stable vessel/product ID" revisit trigger is now *reachable* via the API's `event.id` / listing ids → parked to FUTURE_IDEAS, **not** done in the pilot. Quarantine-unconfirmed-products stays mandatory.
- **DEC-032 (vessel-local time): preserved** by seam (B) — true instants flow through rather than being laundered into ambiguous wall-clock strings.
- **DEC-035: reframed, not deleted** — its `/admin/import` review surface is deferred per scope above; the `import → formShifts` chaining it specified is reused.

**Credentials:** `XOLA_API_KEY` / `XOLA_API_BASE` / `XOLA_SELLER_ID` — server-only env (never `NEXT_PUBLIC`), read-scoped key, admin-gated route. The I/O-bearing fetch lives at the Next edge, not the framework-free core (DEC-020).

**Open at build:** the two field confirmations above; placement of the client (Next edge vs `src/import/`); re-import idempotency for an overlapping week (carried from DEC-035). (@architect pass — 2026-06-15, Opus.)
