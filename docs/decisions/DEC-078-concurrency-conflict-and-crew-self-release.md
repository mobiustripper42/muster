---
id: DEC-078
title: "Concurrency, conflict, and crew self-release"
topic: "Seats, shifts & state machine"
---

## DEC-078: Concurrency, conflict, and crew self-release

**See also** — later decisions that changed part of this one:
- Corrected by DEC-145 — only the clause 'a claim itself emits no reliability event' — a winning self-claim now logs `self_claim` (+4). The adjacent 'Rejected: reliability-dinging the claim' line is untouched and still stands; that rejected a PENALTY, and this is the opposite direction.

> **⚠️ Amended twice (2026-07-27, audit shard Z).** (1) **The one-shift-per-date guard is asserted below without caveat and is not concurrency-safe** — two in-flight claims by one crew member for two same-date shifts both pass and both win their CAS. `src/asks/claim.ts:111-119` names it a known open hole. **#554.** The single-seat race *is* genuinely closed. (2) The **"MVP claimable set"** below ("Open required seats on shifts in `Pending` or `Filling`") was widened by **#440**: `AtRisk` shifts and `Asked`/`Bailed` seats are claimable. SPEC §2.7 was corrected 2026-07-27; this text is the origin of the stale wording.

**Status:** Accepted (Phase 7).

**Decision:**
- **Concurrency:** the claim is a **guarded transition** in the claim service — write `Confirmed` **only
  if the seat is still `Open`** (domain-owned optimistic check, no FK, per DEC-DATA-1). Loser of a race
  gets a clean "just taken" and a refreshed list. No locking.
- **Conflict guard:** a crew member may hold **at most one shift per date** via self-claim (whole-day
  commitment = can't be on two boats the same day). Reject a self-claim for date *D* if they already hold
  a Confirmed seat on a different shift on *D*. The operator-assign door may override (it owns edge cases).
- **Self-release reuses the existing bail edge** (§2.6 principle 2 "bailing is as easy as accepting"):
  crew can release a self-claimed seat → seat returns to `Open` via the `Confirmed → Bailed → Open` /
  graceful `Crewed → Filling` edge (§1.1), which **re-opens and re-asks** automatically. A self-release
  **emits a reliability event** (§1.4 / DEC-008); the existing score machinery weights it by lead time
  (a release weeks out barely registers; a near-departure release is effectively a bail and is weighted
  as one). No new cutoff logic — lean on §1.4 weighting. A **claim itself emits no reliability event**
  (it's an assignment, like an operator assign; reliability is earned at `Completed`).
- **MVP claimable set:** Open **required** seats on shifts in **`Pending` or `Filling`** (claiming during
  `Pending`, *before* the cascade fires, is the point — it front-loads commitment and the later horizon
  crossing finds the seat already Confirmed and skips it). Supernumerary seats are **out of scope** for
  Phase 7. Self-claim during `Pending` does not violate "crew rules abstain" (§1.1) — the *system* still
  abstains from asking; a crew member pulling is orthogonal.

**Why:** Reuses the seat machine's existing re-open/re-ask edges and the reliability model rather than
inventing release rules; the guarded transition is the minimal correct concurrency story for the
no-FK/domain-owns-integrity substrate.

**Tradeoff:** Optimistic-only (no reservation/hold during the confirm tap) can briefly show a
since-taken seat — accepted at pilot scale; the guard makes the failure clean. **Rejected:** pessimistic
seat locking (overkill at this scale); a fixed release-cutoff constant (the §1.4 lead-time weighting
already encodes "later = worse"); reliability-dinging the claim (wrong signal — showing up is what
counts). **Revisit if:** race "just taken" rejections become common enough to annoy → add a brief
client-side optimistic hold. **Phase:** 7.
