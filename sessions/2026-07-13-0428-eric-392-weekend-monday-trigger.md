---
session: 48
dev: eric
slug: 392-weekend-monday-trigger
branch: task/392-weekend-monday-trigger
started: 2026-07-13T04:28:28Z
ended:
points:
pr_numbers: []
status: abandoned
transcript: /home/eric/.claude/projects/-home-eric-muster/9cca4acb-4918-445d-bdf5-2bda645a3415.jsonl
---

# Session 48 — 392-weekend-monday-trigger

<!-- Task blocks appended by /kill-this, one per task. -->

**Next Steps:**

**Context:**
- **Concurrent Session 47** (`pwa-screenshots`, transcript `60da5bf5`) is live in another window — left untouched (user-confirmed concurrent, not stale). Session points advisory per cross-machine reality.
- **Orphan branch** `claude/great-heisenberg-04ddjl` (1 commit `Tiller: latency-aware drip leash`, 2026-06-30, no PR) — left as-is by user decision, revisit later.
- **Task #392** — day-of-week-aware ask trigger. Core-engine change (@architect nod required + a DEC extending 022/062/088). Seam: generalize `staffingHorizonFromEvents` in `src/builder/derive.ts` (6 call sites inherit); 4 `STAFFING_HORIZON_WEEKEND_*` config knobs in `src/config/tenant.ts` (poison-resistant, `CIVIL_SEND_*` pattern). Supersedes #340; interacts with #341/#342. Refs `docs/ask-timing-research.md`.
- **Owed from S46:** prod migrations `0021`–`0024` hand-apply on next push (verify which already applied).
