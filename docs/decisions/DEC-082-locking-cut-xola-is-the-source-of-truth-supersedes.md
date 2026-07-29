---
id: DEC-082
title: "Locking cut — Xola is the source of truth (supersedes SPEC §2.3 Lock; reframes DEC-029)"
topic: "Xola ingest & import"
amends:
  - id: DEC-029
    relation: supersedes
    scope: "\"changed since you reviewed it\" derivation is reframed"
amends_spec:
  - section: "2.3"
    scope: "the Lock action and Lock semantics are cut — Xola is the source of truth, so there is nothing to lock against"
---

## DEC-082: Locking cut — Xola is the source of truth (supersedes SPEC §2.3 Lock; reframes DEC-029)

**Status:** Decided 2026-07-01 (operator). Phase 8 drops **8.2b** (Edit mode = per-shift lock) and **8.6** (bulk "lock the weekend"). The lock scaffolding shipped **unwired** in 4.6/DEC-029 — `lockShift`, `Shift.lockedAt`, `changedSinceReviewed` + the cockpit "changed since reviewed" nudge — but **no UI ever called `lockShift`**, so nothing was ever locked in production (only `seed-atrisk-dev` scenario G sets one, to demo the nudge). Formally cut, not completed.

**Why:** a "reviewed / locked" stamp is meaningless when **Xola owns the truth**. Bookings *and their changes* arrive from the **Xola importer** (DEC-036/040/043) on its own cadence — a "reviewed" flag would be re-reconciled against a system that re-imports. And lock never gated crewing: the engine asks crew **autonomously** off the staffing horizon (DEC-022/023), independent of any lock. So lock had no teeth beyond enabling a review-checkpoint nudge — the very human-review-everything ritual the **no-babysitting** thesis (BRAND §Philosophy) is built to eliminate.

**Vision it records:** Muster **sits next to Xola** as the operator's real scheduling companion — *Xola knows the booking is paid; Muster knows who's running it.* Muster does not re-own Xola's truth; it owns **crew**. The eventual loop is **write-back** (crew assignments → Xola — parked HIGH idea, 2026-07-01), not a lock-and-review gate inside Muster.

**Still Muster-native (NOT cut):** split/merge of *crew*-shifts + seat/manning overrides (Phase 8: 8.3–8.5). Xola has no crew concept, so these are Muster's to own. Their live question is **re-derivation survival** — a manual crew-split must survive the importer re-forming that vessel-day from Xola (the 8.3 @architect/DEC gate, sharpened by this framing).

**Supersedes / reframes:** SPEC §2.3's **Lock** action + **Lock semantics** section (not built). **DEC-029's** "changed since reviewed" nudge loses its lock anchor — if change-detection is wanted later, anchor it to **Xola import diffs** ("changed in the last pull") or a *view*-based "changed since you last looked," never a lock.

**Cleanup (follow-up issue):** retire the dead scaffolding — `lockShift` / `changedSinceReviewed` (`src/builder/lock.ts`), the cockpit nudge (`app/(admin)/admin/shift/[shiftId]/page.tsx`), the seed's scenario-G lock; `Shift.lockedAt` may linger inert until a migration prunes it. Not ripped out here.
