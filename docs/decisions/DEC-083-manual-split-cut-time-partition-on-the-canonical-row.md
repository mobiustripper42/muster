---
id: DEC-083
title: "Manual Split — cut-time partition on the canonical row, re-derived each pull; import-diff cue over the existing audit"
topic: "Xola ingest & import"
amends_spec:
  - section: "2.3"
    scope: "Split is a cut-time partition on the canonical row, re-derived each pull; the \"new block needing attention\" cue is an import-diff over the existing audit"
---

## DEC-083: Manual Split — cut-time partition on the canonical row, re-derived each pull; import-diff cue over the existing audit

**Status:** Decided 2026-07-01 (@architect, Phase 8.3, #206). Two passes: the first set the shift-rows-as-override model; this refines it — cut-time replaces the event-id list, `splitId` is dropped, and the change-cue mechanism is pinned. Sharpens DEC-082's "split/merge must survive re-derivation."

**Decision.** A manual split is TWO shift rows sharing `vesselId|date`:
- **Side A keeps the canonical `shift-{vessel}-{date}` id** — its seats and confirmed/live-ask crew are preserved for free (seat ids are namespaced `seat-{shiftId}-{role}-{n}`; `formShifts` preserves seat state by id). **Side B is `…-b`**, born fresh.
- **The split is stored as ONE nullable field, `Shift.splitCutTime` (vessel-local "HH:MM"), on the canonical row only.** Its presence is the split marker and the sole authoritative partition fact. **No `splitId`** — side B's id is deterministic (`…-b`, a keyed get) and merge tears it down explicitly, so a link field buys nothing (DEC-005 single-source-of-truth).

**Re-derivation survival (the 8.3 gate, sharpened by DEC-082).** `formShifts` becomes split-aware via an additive branch gated on `splitCutTime`:
- **Un-split path is byte-identical** (the branch only runs when the field is set) — the xola-pull reconcile harness stays green. Enforced structurally by extracting the per-shift form/reconcile body into `formOneShift(...)`, called once (un-split) or twice (split).
- **Split partition:** side A = scheduled trips with `e.time < cut`, side B = `e.time >= cut` (half-open `[cut, …)` → a boundary trip goes to B). Both `e.time` and `cut` are vessel-local zero-padded "HH:MM" on the same day → a chronologically-correct string compare, no instant conversion, DST-immune (DEC-032). Deterministic + idempotent: a new Xola trip in a later pull auto-lands on the correct side by its own departure time (the operator's morning/afternoon intent), not a nearest-neighbor guess.
- **A side empties** (all its trips cancelled) → that side derives to `Cancelled` (per-side, existing lifecycle); **the split marker PERSISTS. The importer never auto-dissolves a split** — that would silently undo the operator's decision (the DEC-082 wrinkle). The Cancelled husk is honest; the cue fires; **Merge (8.4) is the operator's only inverse.** A side resurrects on the correct side if its trips reappear (cut-time survives collapse-and-return; an event-id list could not — a replacement trip has a new id).

**Contiguity is structural, by design.** Cut-time expresses a single time partition only — SPEC §2.3's definition ("two shifts whose trips partition the original's"; `suggestSplit` is gap/span only). Interleaved / 3-way / multi-cut splits are out of scope.

**"Changed in the last pull" cue (DEC-082-compliant, no lock/review baseline).** `formOneShift` already holds old vs new eventIds per side, so the composition delta is free: a split day whose side gained or lost a trip (or one retimed *across* the cut — a within-side retime doesn't move the partition, so it doesn't fire) is recorded into `FormResult.splitDaysChanged` and snapshotted in the `ImportRunSummary` JSONB (no DDL — the #128/DEC-056 audit is already persisted). The Builder View (8.2a read surface) renders a quiet "changed in the last pull — check the split" cue by pure derivation over the LATEST `ImportRun`. No per-shift stored flag, no baseline timestamp, no snapshot — baseline is "the last pull," exactly DEC-082's sanctioned framing. Scoped to trip-composition deltas (not party-size/booking churn — the Builder's normal pax/seat surface), keeping it quiet (BRAND anti-anxiety). Accepted V1 limitation: latest-run-transient, not a durable unread queue.

**Emergent-safe (DEC-027 §2) — no `automationPaused`.** The ask engine sees two ordinary shifts; per-side re-derivation preserves seat state by id, so live asks/confirmed crew ride through every pull. Adding a trip to a side changes events, not seat count (manning is per-vessel), so asks are untouched. Forbidden op: re-cutting/merging in a way that strands an occupied seat — surfaced via the existing `seatsStranded` channel, guarded in the 8.3b UI.

**Merge (8.4) inverse, pinned here:** clear `splitCutTime` AND explicitly remove the `…-b` shift + its seats, then re-run `formShifts`. Clearing the cut alone orphans `…-b` (the un-split machinery is vessel|date-keyed and never emits/revisits a `…-b` id).

**Scope seam:** 8.3a = migration (one column `split_cut_time`) + `formOneShift` extraction + split branch + `splitDaysChanged` detection + engine tests. 8.3b = View/Edit toggle shell + split UI + cue render.

**Don't-build:** `splitId`; auto-dissolve on collapse; `splitCreatedAt`/expected-event snapshots (DEC-082 lock in disguise); durable unread change queue; interleaved/multi-cut splits; reservation-churn in the split cue.

**Relationship:** implements SPEC §2.3 Split action + AC; reuses DEC-005 (derived state, seat-id preservation), DEC-032 (vessel-local wall-clock), DEC-056/#128 (import audit), DEC-082 (Xola is truth; change-detection anchored to import diffs, never a lock), DEC-043 (events-driven ingest). Supersedes the prior draft's `splitId` + event-id-list partition.

**Amendment — freshly-spawned-shift cue (9.10/#236, 2026-07-04).** SPEC §2.3's "new block needing
review" text is realized as a second muted row cue in this DEC's idiom: a shift the LATEST pull
minted reads **"new in the last pull"** on the Builder View (fed by the run's `shift_created` audit
items, #128 — best-effort like the changed-cue). This formally supersedes the mockup/SPEC amber
"new · review" treatment DEC-082 already killed: a fresh shift is a calm fact, not an approval
demand — the engine is already working it (empty board = success). Operator-made splits don't fire
it (run items exist only for imports); a resurrected side reads as new only when the pull re-creates
it.
