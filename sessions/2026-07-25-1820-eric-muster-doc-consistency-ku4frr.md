---
session: 70
dev: eric
slug: muster-doc-consistency-ku4frr
branch: claude/muster-doc-consistency-ku4frr
started: 2026-07-25T18:20:31Z
ended: 2026-07-26T13:44:46Z
points: 0
pr_numbers: [535, 536, 537, 538, 539, 540, 541, 542, 543]
status: closed
transcript: /root/.claude/projects/-home-user/a4345c09-5cc8-5c83-b57c-30b0a4342e41.jsonl
---

# Session 70 — muster-doc-consistency-ku4frr

<!-- Task blocks appended by /kill-this, one per task. -->

**Next Steps:**
- **Merge #543 first — it blocks C2.** Shard G's fix hands the mockup→spec-section mapping to C2, and
  the audit README's current shard table + resume state (E/G closed, C2 next, lessons 9–10) exist only
  on that branch. A fresh C2 session reads that README to start cold.
- **Then C2** — `SPEC.md` §2.1–§2.7, ~700 lines of per-surface *States to render / Actions / Data read
  / Edge cases / Acceptance criteria*, checked against `src/builder`, `src/crewapp`, `src/admin`,
  `app/`. **Use a sweep agent + the ledger-on-disk pattern** (lesson 9) — this corpus is narrative, and
  in-context reading ran out of room at 44% of a smaller one in shard D. Own session.
- **Then Z** — `DECISIONS.md` internals (ACTIVE/archive split, status markers, dead cross-refs). Own
  session. Deferred by standing rule all run.
- Muster-only from here; seeds isn't in either corpus.

**Context:**
- **Points 0 is honest, not an error.** No `/kill-this` ran — this wasn't issue-tracked task work, it
  was the #525 doc-consistency debt paid down. `pr_numbers` was backfilled at close; retro can read
  merge timestamps from it as normal.
- **What shipped:** seeds PR #148 (merged — agent `model:` pins across 3 mirrors, the
  `CLAUDE.md §Commands` build-gate repoint, the dropped approval/branch-cut workflow steps), plus
  muster #535–#543. Eight of nine merged; #543 open.
- **Audit state:** shards F, A, B, C, D, E, G all closed. C2 and Z remain. Full record in
  `docs/audit/2026-07-25/` — README carries the shard table, resume state, and ten lessons.
- **Two operator decisions landed as DECs:** DEC-138 rewrote SPEC §1.3 to the DEC-125 model (two
  availability mechanisms, not one rule engine) and closed COI-expiry + lead-time-cutoff as
  out-of-scope with rationale, so no future sweep re-raises them.
- **Deleted:** `OPERATOR_MANUAL.md`, `E2E-PILOT-WALKTHROUGH.md`, `PILOT_RUNBOOK.md`,
  `PILOT_IMPORT_FINDINGS.md`, 14 duplicated Xola PNGs (7.4 MB). A fresh operator manual gets written
  after reservations lands.
- **Glossary now defines `admin` vs `operator`** (SPEC §0.4) — two session kinds, every admin is also
  crew, no roles until maybe-multi-tenant. `OPERATOR_CREW_MEMBER_ID` left alone deliberately: unset,
  defaults to a dev-seed id absent from the real roster, and its remaining uses are behind the
  messaging flag. Inert. #293 stands, unrewritten.
- **Highest-consequence finding still worth your eyes:** shard E1 in #543 — `DEPLOY.md` was missing 22
  env vars, so a deploy built from the runbook has crew unable to sign in and no reservations import.
  Prod is fine; a rebuild or DR restore would not be.
- **Wall clock includes an overnight gap** — started 18:20 on the 25th, closed 13:44 on the 26th.
