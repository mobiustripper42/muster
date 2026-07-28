---
id: DEC-077
title: "Day-granularity commitment; elastic absorption is already built; sub-day \"watches\" are deferred"
topic: "Availability & commitment rules"
---

## DEC-077: Day-granularity commitment; elastic absorption is already built; sub-day "watches" are deferred

> **⚠️ Under review — #560.** The whole-day commitment rule below removes a crew member from the **eligible pool** for the entire date, so two non-overlapping trips on different boats can never be worked by one person — and that person is never even asked. The operator has questioned whether that is right. The likely replacement is a time-overlap + turnaround-buffer rule, which the code already anticipates (`eligibility.ts` — "a separate relational rule the time-aware oracle adds later"). **Do not rewrite this DEC until #560 is decided.**

**Status:** Accepted (Phase 7).

**Decision:**
- The commitment unit is the **whole vessel-day shift** (current `shift-{vessel}-{date}`). Claiming a
  seat = committing to crew **every trip on that boat that day, including trips booked later.** No schema
  or grouping change.
- **Elastic absorption needs no new code** — it's the existing idempotent `formShifts` (`src/builder/
  form-shifts.ts`): a later reservation → event on that vessel-day → folds into the same shift's
  `eventIds`; the Confirmed seat (the self-claimer) is preserved.
- **The affordance lives in the claim confirm sheet** and must state the elastic scope in words, mirroring
  the ask format (§2.6.1 `… call 12:30, back ~6 …`):
  > *Claim Sat Jul 18 on Brew 2 as **captain**? That's the **whole day** — every trip booked, including
  > any added later. Right now: **2 trips** (1:00 & 4:00 PM), call 12:30, back ~6.*
  The **live trip count** makes "whole day" concrete; the **"incl. added later"** clause sets the elastic
  expectation so a Thursday-booked 7 PM trip isn't a betrayal. Use the §2.6.3 DEC-041 committed-window
  computation (latest departure + trip length + call lead) for "back ~6".
- **The "a trip was added to your Saturday" nudge is not new** — it's the §2.6 principle 1 live-card
  behavior ("departure changes → card changes → crew gets a ping", §3.1) applied to the
  event-added-to-a-held-shift case. Reuse it; do not invent a parallel nudge.
- **Sub-day blocks ("watches") are deferred.** When whole-day proves too coarse, the refinement is small
  and known: change the grouping key `vessel|date` → `vessel|date|block` and the id mint to
  `shift-{vessel}-{date}-{block}`, deriving `block` from `event.time`; everything downstream keys off
  `shiftId` and is untouched. Fixed named windows (admin-set boundaries), **not** crew-defined windows.
  **NON-GOAL for Phase 7.**

**Why:** Day-first is the minimum coherent build and reuses the strongest existing machinery. The
operator confirmed day-granularity is the right MVP; "afternoon/evening" is a real future need but not a
day-one blocker.

**Tradeoff:** Whole-day commitment may deter crew who only want evenings — accepted for MVP; the
sub-day path is pre-scoped so it's a fast refinement, not a rewrite. **Rejected:** a new
`Block`/`Watch` entity above shifts (fights the model — the shift *is* the day-container); crew-defined
availability windows (needs an availability entity, breaks the deterministic shift id, and is really the
parked calendar). **Revisit if:** crew decline whole-day claims they'd take as evening-only → ship the
grouping-key refinement. **Phase:** 7 (day); sub-day deferred.
