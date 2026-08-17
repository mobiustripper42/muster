---
id: DEC-037
title: "Task #73 (5.4) splits — xlsx import surface first (5.4a), Xola API Land adapter fast-follow (5.4b); review surface stays deferred"
topic: "Xola ingest & import"
---

## DEC-037: Task #73 (5.4) splits — xlsx import surface first (5.4a), Xola API Land adapter fast-follow (5.4b); review surface stays deferred

**See also** — later decisions that changed part of this one:
- Superseded by DEC-043 — the xlsx-first half is retired; the API Land adapter shipped

**Status:** Accepted (Phase 5 / 5.4) — @architect 2026-06-16 (Opus; Fable unavailable). Confirmed at build, single-step result + Vercel-safe reader folded in (operator's call, 2026-06-16).

**Decision:** Task #73 splits in two.
- **5.4a (xlsx surface, build first):** split `importReservations` → `decodeXlsxRows(rows): { records, warnings, skipped }` + `importRecords(repo, records, now): ImportResult` (the DEC-036 (B) seam, on a `RawReservationRecord` intermediate with **already-normalized** ISO date + clock-time). Build admin-gated `/admin/import` (Server Component + `readSubject` gate + DEC-026 redirect-param feedback) — **single-step**: upload `.xlsx` → `importRecords` → `formShifts` → result summary. Includes the first upload-security pass.
- **5.4b (fast-follow, creds in hand 2026-06-16):** port `fetchOrders`/`fetchEvents` from `xola-tip-extractor` into strict TS **at the Next edge** (I/O-bearing, not the framework-free core — DEC-020), map JSON → `RawReservationRecord[]` → the **same** `importRecords`; resolve DEC-036's two field confirmations against a live response.

**Sequencing rationale (a change from DEC-036's "API primary," NOT a scope reversal):** the xlsx core is built + tested and needs no new dependency or credential; the API path is greenfield (PR #81 was docs-only) and was gated on live Xola creds. xlsx-first unblocks the real-crew weekend off the critical path of an external credential. DEC-036 already **retains the xlsx reader as the permanent downtime fallback**, so 5.4a builds a kept path, not a throwaway. The seam (`RawReservationRecord` + `importRecords`) is built once in 5.4a and reused in 5.4b — each Land adapter normalizes before the seam (xlsx parses strings; the API maps instants → vessel-local per DEC-032), so neither launders instants through wall-clock strings.

**Build decisions (2026-06-16):**
- **Single-step, not two-phase preview→confirm.** No-client-JS makes a true pre-commit file preview awkward; import is idempotent (upsert by `evt-`/`resv-` identity, DEC-029 materiality) and unmapped-product rows are **skipped, never mis-imported**, so committing "closer to blind" is safe and re-import is the undo. DEC-036 already licensed minimal-preview / commits-closer-to-blind.
- **Result surface carries counts only** (DEC-026: codes/ids in redirect params, never prose). Quarantined product **names** go to **server logs** (`console.warn`) for the dev — there is no product-mapping UI (the map is code), so the operator can't self-fix an unmapped product anyway; the visible count ("P rows skipped") + the dev's log read is the pilot answer. A richer in-surface quarantine list is a noted follow-up.
- **Vercel-safe xlsx reader (folded into 5.4a).** `xlsx-extract.ts` shelled out to the system `unzip` binary (absent on Vercel's Node runtime → an import green locally would ENOENT in prod, i.e. fail during the crew test). Rewritten to **pure-Node** (`node:zlib` `inflateRaw` + a minimal ZIP central-directory parse — no new dependency, stays core-framework-free) and **buffer-based** (parses the upload in memory, no temp file). Upload security: magic-byte type check (`PK\x03\x04`, not extension), hard size cap, per-entry decompressed-size cap (zip-bomb guard via `maxOutputLength`), Reservations-sheet only, no formula/macro eval (the regex reader never evaluated — kept that way).
- **Event-cancellation propagation (architect landmine #1, fixed not deferred).** Nothing in the codebase ever set `event.status = "cancelled"` — the import always wrote `"scheduled"` — so `formShifts`' all-cancelled→Cancelled path never fired from the import chain, and a re-import that cancelled out an event left a live "ghost" shift (crew asked for a dead trip). `importRecords` now derives `event.status` per upsert: an event with ≥1 booked reservation is `scheduled`, an event whose every reservation is cancelled is `cancelled` → `formShifts` cancels its shift. (An event that *disappears* from a later export — vs appearing with cancelled rows — is still not reconciled; noted, out of pilot scope.)

**Open / deferred:**
- **Capacity-stomp on re-import** noted, not fixed (import overwrites `event.capacity` each run; no COI-correction UI yet — DEC-016).
- **DEC-035's full preview/validate/quarantine-review surface** stays deferred.
- The two DEC-036 field confirmations + the API client → **5.4b** (creds in hand).

**Relationship:** DEC-036 holds (API is the eventual primary; this only sequences it second). DEC-035 deferred. DEC-015 Land→Map→Reconcile is the architecture; both Land adapters feed one Reconcile.
