---
id: DEC-128
title: "`bail()` and `vacateSeat()` fire no asks — re-crewing is deferred to the tick (#483)"
topic: "Seats, shifts & state machine"
---

## DEC-128: `bail()` and `vacateSeat()` fire no asks — re-crewing is deferred to the tick (#483)

**See also** — decisions this one changed part of:
- Amends DEC-019
- Amends DEC-039

**Decision:** `bail()` and `vacateSeat()` (`src/asks/ask-loop.ts`) stop minting asks. Both now: validate (occupant-pin guard, unchanged) → (`bail()` only) `logShiftBailed` (+`latenessMs`/`noticeMs`, unchanged — DEC-028) → drop the occupant + clear provenance (#196) → rest the seat **`Open`** → **horizon-aware state refresh** → return. Deleted from both: the `rankedEligible` fetch, the inline `Promise.all(pool.map(fireAsk))` pool blast, the exhausted-vs-not branching, and the DEC-088 civil-window branch. The **tick is the sole ask-writer** again (SPEC §1.2, DEC-063): a `bail`/`vacate` previously fired its own re-ask **inline and horizon-blind**, blasting the whole ranked-eligible pool at once regardless of the staffing horizon (DEC-022) or the drip (DEC-063) — so releasing a seat weeks out immediately texted the entire role pool. Verified in prod 2026-07-19 (Brew 4 / Aug 8 shift, ~13 days pre-horizon: a captain bail stamped 6 identical-millisecond `push` asks). Re-crewing is now entirely the tick's: pre-horizon → `Pending` (silent — **the fix**); in-horizon → next tick drips one (DEC-063); inside `fillsBy` (DEC-031) → the tick's urgent path blasts the remaining pool within one cadence (~15 min). The re-crew latency is operator-accepted.

**New helper `refreshShiftStateHorizon(repo, shiftId, now)`** (`src/asks/ask-loop.ts`): persists the composed `resolveShiftState(seats, {now, horizon, poolExhausted})` under the same terminal guard as `refreshShiftState`, so a re-opened seat lands in its horizon-correct badge **synchronously** rather than momentarily writing the raw seat-fold's `Filling`/`Pending`. **Scoped to bail+vacate only** (not globalized): the drip hot path and the claim/override paths only move *toward* crewed, which `resolveShiftState` passes through and the next tick self-heals — they keep the cheaper `refreshShiftState`. Composed from `resolveShiftState` + `staffingHorizonFromEvents` (`derive.ts`) + `poolExhaustedFor`, the last **relocated `tick.ts` → `oracle.ts`** so the new refresh composes it without an import cycle (`resolveShiftStateOnRead` lives in `tick.ts`, which imports `ask-loop.ts`).

**`Bailed` retired as a resting state.** No writer produces a resting `Bailed` seat anymore; past-horizon At-Risk for an exhausted pool comes from `resolveShiftState(poolExhausted)`, not from a `Bailed` seat driving `deriveShiftState → AtRisk`. The `deriveShiftState` `Bailed` branch and its readers (`lean.ts`, `assignment-view.ts`, `at-risk-board.ts`) are **retained** for legacy seats that may still rest `Bailed` in an existing store — they keep today's board/lean-rescue behavior; no migration.

**Accepted behavior changes (operator sign-off given):**
- **Board `regression` re-ping lost for new bails.** A rescued-then-re-bailed shift that already showed AtRisk won't re-ping the operator (`at-risk-board.ts` board-landing dedup keys on `(shiftId, reason)`; `regression` derives from a resting-`Bailed` seat, which no longer occurs). This also blanks the At-Risk page's "N late bails" count + row flag (`app/(admin)/admin/at-risk/page.tsx`) and the alert copy (`forward-board-alerts.ts`) for new bails. The `shift_bailed` event, crew score, audit trail, and bail notices are all unchanged. Accepted for V1; if wanted back, derive `regression` from a recent `shift_bailed` event (separate follow-up).
- **Engine pause (DEC-054):** a bail during a pause won't re-crew until resume (the inline re-ask previously fired regardless). Accepted.
- **Out-of-hours bail before a morning trip:** never auto-re-crewed — but this **predates** DEC-128 (DEC-088 already routed the out-of-hours bail to the tick, and the tick's past-trip + civil guards apply). Not a regression.

**Amends:** DEC-019 (`Bailed` no longer the AtRisk source — the seat-fold branch is legacy-only), DEC-039/#87 (vacate rests `Open` and fires no asks), **DEC-063** (reverses its "Bail/vacate re-asks stay blast-all" clause — that inline blast is exactly the bug; the drip/tick now governs re-crewing too). **Refines:** DEC-088/022/024/031. **Untouched:** `logShiftBailed`/DEC-028, the occupant-pin race guard, `lean`/override.
