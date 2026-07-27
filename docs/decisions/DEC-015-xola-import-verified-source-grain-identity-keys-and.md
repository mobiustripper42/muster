---
id: DEC-015
title: "Xola import — verified source, grain, identity keys, and quarantined Land→Map→Reconcile architecture"
topic: "Xola ingest & import"
---

## DEC-015: Xola import — verified source, grain, identity keys, and quarantined Land→Map→Reconcile architecture

**Source:** verified against two real Xola exports (`purchaseItems`, `customers`), 2026-06-04.
**Supersedes** an earlier informal DEC-015 sketch that assumed only an aggregated revenue report with
no guest detail — that was the wrong export.

**Decision:**
- Import source = the `purchaseItems` export's **`Reservations` sheet** — **per-reservation grain**
  (~99 live rows), not the aggregated revenue report. Inline: customer **Name**, **Email**, party
  size (**Total Demographics**), **Product**, **Arrival Date/Time**, **Status**, and stable Xola IDs.
- **Identity keys (no fragile composite needed):** `Reservation ID` (primary, ~99/99 filled) and
  `Confirmation Code` (~99/99); `Purchase ID` groups multiple reservations in one purchase. These are
  the reconcile keys for insert/update/cancel and for protecting manual entries.
- The `Events` sheet is **event-grained** with a guide-assignment matrix (one column per guide) — a
  cross-check / the guide picture, **not** the reservation source.
- **Architecture — quarantine the mess behind an adapter; Land → Map → Reconcile:**
  - *Land:* ingest raw rows into staging (tagged source-file + import-batch), untouched.
  - *Map:* normalize raw → candidate Events/Reservations against an explicit field mapping; the
    multi-file join (DEC-017) and the Product map (DEC-018) run here; bad rows quarantine with a reason.
  - *Reconcile:* merge candidates into Event Admin by identity key — insert/update/cancel, protect
    manual entries. The domain only ever sees clean Reconcile output; never a CSV or a column.
  - The reader/adapter is the only throwaway piece (coexistence §2); everything it feeds is permanent.

**Thin-path first (the end-to-end steer):** the first end-to-end shift (form → ask → crew tap) may be
driven by the *minimum* importer — a single-file, single-product, no-reconcile happy-path read, or a
seeded fixture (DEC-016 blesses invented fixtures) — **before** Land/Map/Reconcile is fully built. The
three-stage architecture is the durable target, **not a gate on the first tap.** The riskiest unknown
is whether the whole loop works end to end, not whether the parser is perfect.

**Resolves the DEC-011/012 M1 verification — but only the *data-availability* half.** The export
carries name + party inline and phone is reachable via DEC-017, so the §2.6.3 manifest **data** can be
populated **from the import** — no manual write-back is needed to *populate the manifest.* The **§3.5
write-back sheet's retirement is a separate, later event** that still waits on the **card's manifest
being live and authoritative to crew** (the §0.4/§2.6.3 hinge, M4+); until the card is authoritative,
crew still see their guests via Xola. DEC-015 does **not** kill the locked-§3.5 sheet at M1.

**Reconciliation policy stays open.** Reconcile's "protect manual entries" is the *mechanism*; the
*policy* (manual-wins vs reconcile-on-conflict) remains the operator-owned open question (DEC-TBD /
SPEC §2.2), defaulting to "manual wins, flag conflicts."

**Why:** real exports verified the grain and keys the build had been guessing at; the per-reservation
source exists and is authoritative. It is also genuinely messy (multi-row header — real field names
sit in a sub-header row under parent headers; ~70 columns, most of them per-add-on insurance/tip junk)
— exactly why the mess is quarantined in Land/Map and the parser selects the ~10 columns that matter
and skips the sub-header row.
**Tradeoff:** a staged adapter is more than a one-shot script. Accepted — it is the only throwaway
piece and it keeps the domain clean. **Rejected:** parsing CSV columns directly in the domain (recouples
the engine to Xola's schema — the exact thing the adapter exists to prevent).
**Revisit if:** Xola changes its export schema; a per-reservation export adds phone inline (simplifies
DEC-017); or the first end-to-end tap shows the three-stage staging is heavier than the loop needs
(collapse stages — durable target, not dogma).
**Phase:** M1 (task 1.2) onward; the thin-path permits the first tap ahead of full staging. (Verified
handoff, 2026-06-04.)
**Reader format (clarifies DEC-011):** Xola only exports **xlsx**, so the disposable reader parses the
xlsx directly (the `Reservations` sheet) rather than forcing a manual xlsx→CSV step — DEC-011's "CSV
export" was format-shorthand for "the disposable bridge." The slice reader shells out to the system
`unzip` + a light XML scan (no npm dependency in this dep-minimal phase, DEC-013); it gets a real
xlsx library when the stack lands (M4). (Operator-chosen, 2026-06-04.)
