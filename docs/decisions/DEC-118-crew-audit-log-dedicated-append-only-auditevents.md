---
id: DEC-118
title: "Crew audit log — dedicated append-only `audit_events`, edge-emitted actor, unioned read, out of the scoring path (#400)"
topic: "Core architecture & engine mechanics"
---

## DEC-118: Crew audit log — dedicated append-only `audit_events`, edge-emitted actor, unioned read, out of the scoring path (#400)

**Status:** Decided 2026-07-13 (Eric + @architect).

**Decision.** An operator-facing audit trail of every crew add/drop/change lands in a NEW append-only
`audit_events` table — **not** by extending `reliability_events`.

- **Separate table** because `reliability_events` is scoring substrate (DEC-008: "whose behavior is this"),
  and an admin removal / operator force-place / self-claim is explicitly NOT the subject's behavior
  (`vacateSeat`/`manualOverride`/`claimSeat` deliberately emit no reliability event). `audit_events` carries
  an orthogonal actor dimension `{actor_kind: crew|admin|importer|engine, actor_id}` the reliability row has
  no room for (it keys to the behaving crew, with `SYSTEM_ACTOR_ID` as its one escape hatch).
- **A genuine store, not a derived read-model** — unlike ask-trail / escalation-trail (DEC-024), which
  project from persisted facts. The add/drop transitions persist NOTHING today, so there is nothing to
  derive; that is what clears DEC-024's "no second parallel log" bar.
- **Read = UNION, not dual-write.** The `/admin/audit` view unions `audit_events` (the new facts) with a
  projection over `reliability_events` (accepted→add, bailed/no_show→drop, plus decline/ignored/nudged
  context). One source per fact; no drift-consistency burden.
- **Actor captured at the EDGE, never threaded through the core** (DEC-030 posture). Server actions emit the
  audit event after the domain call returns, using the session's actor. Domain return-shape deltas:
  `vacateSeat` +`removed`; `manualOverride`→`{seat, displaced?}`, `overrideSeat` +`displaced?`; `claimSeat`
  unchanged; import already exposes `changedCrew`.
- **Audit never feeds scoring.** `reliability-score.ts` reads `reliability_events` only, never `audit_events`.
  Absolute — it is the reason for the second table.

**Tradeoff:** the audit read touches two tables; the audit append is post-mutation and **not** transactional
with the seat write — a crash in the gap drops one audit row (accepted at pilot scale; same posture as the
ask loop's reliability appends). **No backfill** — the unlogged history was never persisted, so capture
starts at ship; the UI says so.

**Slicing:** A (~5) migration + table + port + edge emitters + return-shape changes + tests ships FIRST (risk
seam + no-backfill clock); B (~3) read port + union projection + `/admin/audit` UI trails. `/admin/audit`
stays a **sibling** of `/admin/asks` — no fold-in. **Revisit if:** audit volume outgrows the union read
(materialize), or a compliance need makes the post-mutation append gap unacceptable (transactional outbox).

**Trainee staffing emitter — CLOSED in Slice B.** Slice A emitted at four edges (override, vacate,
self-claim, import `changedCrew`) and deferred `staffTrainee`/`unstaffTrainee` (operator force-place/pull of a
trainee onto a supernumerary seat) — the *same* operator-authority add/drop shape, inside this DEC's "every
crew add/drop/change" bar. Slice B closed it: a `logCrewAdded` on staff success + a `logCrewRemoved` on
unstaff success (`app/(admin)/admin/shift/[shiftId]/actions.ts`, admin actor, `reason:"trainee"`), so the
union view is complete on day one. (Split/merge `changedCrew` — a shared `forwardFormNotices` path with an
`admin` actor — remains a lower-priority follow-up in the same spirit.)

**Slice B read shape.** `/admin/audit` is ONE list (not a sibling of `/admin/asks`, not two lists) — the
union folds the reliability add/drop projection into the same rows, filterable by **crew** and by **kind**
(added / removed / changed). The `ask_declined`/`ask_ignored`/`nudged` "context" rows floated above are
**excluded**: they aren't an add/drop/change of a seat and belong on `/admin/asks` — including them would
smuggle the asks list back in. Projection kept minimal: `ask_accepted`→added, `shift_bailed`/`no_show`→
removed; the audit facts carry the rest.
