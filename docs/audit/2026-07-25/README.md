# Doc consistency audit — 2026-07-25 (sharded run)

The first full consistency pass over this project's doc set. Run in **shards** because the
finding volume, not the corpus size, is what exhausts a context window: 9,281 doc lines produce
enough findings that triaging them in one pass produces bad decisions. S67's unsharded attempt
returned 46 findings (posted as a comment on #525) and lost one of four parallel sweeps silently.

## How this run works

1. **Findings live here, not in a conversation.** Each shard writes one ledger file. The sweep
   agent returns only a count and a path — never the findings themselves.
2. **Shards are subject-scoped, not file-scoped.** A cross-doc mismatch *is* the finding, so
   sharding per file would destroy the check. Each shard reads the slice of every doc that
   touches its subject.
3. **Sequential, one agent per shard.** A lost agent costs one shard, and the run resumes from
   this file across sessions.

## Row format (every ledger file)

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |

- **verdict** — `MISMATCH` (two docs disagree) · `PLACEHOLDER` (unfilled template text) ·
  `CODE-CONTRADICTS` (doc claim false against source) · `UNVERIFIABLE` (needs prod/env access) ·
  `NOISE` (looked like a finding, isn't — recorded so it isn't re-derived)
- **proposed bucket** — `doc-wrong` (edit the doc) · `code-wrong` (file an issue) ·
  `decision` (needs an operator call) · `known` (already an open/closed issue, cite it) ·
  `decisions-internal` (routes to the DECISIONS rewrite task, see below)

Buckets are *proposed* by the sweep and re-assigned at triage. The sweep does not decide.

## Shards

| Shard | Subject | Primary docs | Status |
|-------|---------|--------------|--------|
| F | Workflow / skills / velocity | `CLAUDE.md`, `AGENTS.md`, `CHEATSHEET.md`, `VELOCITY_AND_POKER_GUIDE.md`, `PROJECT_PLAN.md`, `DEV_REFERENCE.md` | **✅ CLOSED — 53 rows, all resolved** |
| B | Auth / RLS / login paths | `AUTH.md`, `SECURITY_AUDIT.md`, `RUNNING.md`, `SPEC.md` | **✅ CLOSED — 7 rows, 8 noise** (audited `main`) |
| A | Money / pricing / payments | `SPEC.md`, migrations | **✅ CLOSED — 7 rows, 8 noise** (audited `feature/reservations`) |
| C | Asks / shifts / derived state | `SPEC.md`, `USER_STORIES.md` | **✅ CLOSED — 6 rows, 9 noise** (audited `main`; 3 fixed, 3 are one operator decision) |
| C2.1 | §2.1 Crew Roster / People | `SPEC.md:400–493` | **✅ CLOSED — 12 rows, 13 noise, 7 AC verdicted** (audited `main`; 1 bug fixed, rest are one operator decision) |
| C2.2 | §2.2 Event Admin | `SPEC.md:495–605` | **✅ CLOSED — 12 rows, 12 noise, 7 AC verdicted** (audited `main` + `feature/reservations`; 3 fixed, 1 filed #548) |
| C2.3 | §2.3 Shift Builder | `SPEC.md:606–717` | **✅ CLOSED — 11 rows, 20 noise, 5 AC verdicted** (audited `main`; 9 fixed, 1 operator decision, 1 code item open) |
| C2.4 | §2.4 Assignment View | `SPEC.md:759–847` | **✅ SWEPT — 15 rows, 14 noise, 5 AC verdicted** (2 MET, 1 MET-stale-wording, 2 PARTIAL) |
| C2.5 | §2.5 At-Risk Board | `SPEC.md:848–932` | **✅ SWEPT — 12 rows, 18 noise, 6 AC verdicted** (3 MET, 1 PARTIAL, 2 NOT MET) |
| C2.6 | §2.6 Crew App | `SPEC.md:933–1022` | **✅ SWEPT — 13 rows, 16 noise, 7 AC verdicted** (3 MET, 1 nuance, 2 PARTIAL, 1 NOT MET) |
| C2.7 | §2.7 Crew Self-Serve | `SPEC.md:1023–1061` | **✅ SWEPT — 9 rows, 18 noise, 0 AC boxes exist** (the absence is finding C2.7-5; 5 sub-clauses verdicted instead) |
| D | Reservations & import | ~~`OPERATOR_MANUAL.md`, `E2E-PILOT-WALKTHROUGH.md`, `PILOT_*`~~ | **CLOSED — corpus DELETED 2026-07-25.** 7 rows found; the docs they indicted are gone |
| ~~D2~~ | ~~`PILOT_RUNBOOK` + `PILOT_IMPORT_FINDINGS` + walkthrough Parts 0–7~~ | — | **CANCELLED — corpus deleted** |
| E | Deploy / env / ops | `DEPLOY.md`, `RUNNING.md` *(`PILOT_RUNBOOK.md` deleted)* | **✅ CLOSED — 2 rows, 4 noise** (audited `main`; both fixed) |
| G | Brand / UI | `BRAND.md`, `docs/design/DESIGN-REFERENCE.md` | **✅ CLOSED — 4 rows, 5 noise** (audited `main`; all fixed, index rebuild deferred to C2) |
| Z | DECISIONS-internal | `DECISIONS.md` only | **deferred to its own task** |

## Standing rules for this run

- **`DECISIONS.md` is read as authority, never as subject.** It is the file most other docs are
  checked *against*, so every shard reads it. But findings *about* `DECISIONS.md` itself —
  internal contradictions, dead cross-refs, the ACTIVE/archive split — go to shard Z and are not
  edited in this run. `feature/reservations` carries ~114 divergent lines in that file
  (DEC-134–137); restructuring it on `main` would have to be hand-reconciled at merge-back.
- **`CLAUDE.md` edits are allowed**, against the usual seeds rule. Every edit to it is appended to
  `seeds-backport.md` so `/push-seeds` gets a manifest instead of a diff to reverse-engineer.
- **`.claude/skills/**` and `.claude/agents/*.md` are evidence, not subjects.** A claim in
  `CLAUDE.md` about what a skill does is checkable against the skill file. Drift *within* those
  template files is `@sync-config`'s job, not this run's.
- **Prior art:** reconcile against the 46-finding report on issue #525 rather than re-deriving it.
  A finding already in that report is still logged here, with the #525 reference in the
  "checked against" column.

## Resume state

- **Shard F closed** — 53 rows, 43 real findings fixed/filed/parked, 10 noise. One issue filed
  (#533, Phase 11 never closed). The six `CLAUDE.md` fixes **shipped** — seeds PR #148 (merged),
  which also carried the agent `model:` pins and the `CLAUDE.md §Commands` build-gate repoint.
  Muster-side fixes shipped in PR #535 (merged).
- **Shard A closed + FIXED** — 7 findings, 8 verified-consistent, all `doc-wrong`. Audited
  `feature/reservations`, not `main`. **Fixes merged in PR #538** (into `feature/reservations`,
  where those DECs live). Headline: DEC-107 had no forward pointer to the DEC-134 reversal.
- **Shard B closed + FIXED** — 7 findings, 8 verified-consistent, all `doc-wrong`. Audited `main`.
  **Fixes merged in PR #537.** `AUTH.md` had three doors and no switcher, and asserted
  "code-login cannot make you an admin" — which `SECURITY_AUDIT.md` contradicts outright.
- **Shard C closed** — 6 findings, 9 verified-consistent. **3 fixed here** (`USER_STORIES.md`
  SP-6/SP-7 described shift lock, cut by DEC-082; DR-1 said payments were parked to 2027).
  **3 were one operator decision — now RESOLVED by DEC-138** (PR #540): SPEC §1.3 rewritten to the
  DEC-125 model (two mechanisms, not one rule engine). COI-expiry and lead-time-cutoff both
  **rejected on operator input** and closed on the record. See the shard file's RESOLVED header for
  two corrections to the original severity read.
- **Shard C2 SPLIT PER SURFACE and two-sevenths done (S71, 2026-07-26).** The sweep-agent + ledger
  pattern was piloted on C2.1 alone before fanning out, and it held: every row cites `file:line` or a
  test name, absences escalate as questions, and each `- [ ]` acceptance criterion gets its own
  verdict block — **14 checkboxes ticked against source for the first time**. C2.1 and C2.2 closed;
  §2.3–§2.7 remain. **Fixes shipped in PR #549 (`main`) + PR #550 (`feature/reservations`).**
  - **The two shards found the same shape twice: a derivation layer with no surface on top.**
    `buildRoster` (§2.1) and `browse.ts` (§2.2) are both complete, both tested, and both have **zero
    callers on either tree**. Four of §2.1's seven Actions have no operator write path at all. The
    answers differ, though — the roster surface is wanted (#408), while §2.2's dies at the DEC-126
    cutover, so "unbuilt" there is correct rather than late.
  - **Live defect, now fixed:** `/admin/import` told the operator the Xola pull "runs automatically
    every hour". It hasn't since `13d3fb5`; the operator confirmed there is no automatic import and
    never will be. Five files carried the dead cadence — including `DEPLOY.md`, written by shard E
    *the previous night*. A doc audit's own output rotted within 24 hours.
  - **Real bug, now fixed:** the roster's expiry flag and the oracle's gate disagreed by one day
    (instant-vs-date compare), so a crew member could read EXPIRED and be askable the same afternoon.
    A code comment *and* a test name both asserted they agreed.
  - **Filed #548:** a retime that keeps its event id notifies nobody — DEC-029 caught it for free when
    event identity encoded the time, DEC-043 changed identity to Xola's real `event.id`, and nobody
    re-checked. Shipped as a characterization test, not a fix: whether the gap is reachable depends on
    whether Xola retimes in place or cancels-and-recreates, which this repo cannot answer.
  - **Deleted:** the five Event Admin mockups + `Event Admin.html` — design reference for a screen
    never built and, per DEC-126, now never to be.
  - **Cost, for whoever budgets C2.3–C2.7:** 120k subagent tokens for C2.1 (the *smallest* section)
    and 141k for C2.2. The original ~40–90k estimate was wrong by roughly half. The expensive work is
    proving *absences* — zero-caller greps across the whole tree — not reading the corpus. Budget
    ~150k per remaining sub-shard.
- **Shard C2.3 closed + FIXED (S72, 2026-07-26).** 11 findings, 20 verified-consistent, all 5 ACs
  verdicted: **3 MET, 1 MET-with-nuance, 1 PARTIALLY MET** — the healthiest section swept so far, and the
  first §2.x sub-shard whose surface is fully shipped. **9 doc fixes applied here**; 1 operator decision
  and 1 low-severity code item left open.
  - **Headline: a reconciliation pass that stopped early.** The DEC-082 pass of 2026-07-15 struck the
    Lock bullet, the Lock action, the locked-shift edge case and one of three open questions — then left
    the **entire `### Lock semantics` subsection** and the **bulk-weekend-lock open question** standing,
    both declared superseded by that section's own header 60 lines above. Lock is dead everywhere else:
    column dropped by migration `0022`, `src/builder/lock.ts` deleted, `USER_STORIES.md` SP-6/SP-7 struck
    by shard C. **SPEC §2.3 was the last live description of shift lock in the project.** Now struck in
    place, plus the `§4 Parked` "weekend-lock" row that parked as future work a thing DEC-082 cut.
  - **C2.3-6 / AC-3 — RESOLVED on operator input 2026-07-27, and the shard had it half wrong.** The
    ledger reported "a supernumerary seat **consumes a passenger slot** vs COI max-pax" as asserted in
    three places — spec, acceptance criterion, and shipped UI copy — and implemented in none. The third
    citation was wrong: `ManningSection` has **zero callers** and dropped out at `cc581f8` (Phase 9.5),
    so that copy is dead code. Caught by the operator, not the sweep — see lesson 12. The operator's two
    answers close it without any code: **(a)** COI max-pax counts *people* — a trainee, a guest and a
    working hand are identical to it, "if they have a heartbeat they count" — so the claim is **correct**,
    and correct for reasons unrelated to the seat being supernumerary; the spec's framing of it as a
    special trainee rule is the part that's off. **(b)** Supernumerary seats are **removed from the UI**;
    the seat machinery is retained but dead, so there is no operator path to create the seat and nothing
    to decrement against. AC-3's second clause is therefore **unreachable, not unmet**.
  - **Code item (C2.3-8) — FIXED 2026-07-27.** The split/merge server actions called
    `splitShift`/`mergeShift` without `now` (`app/(admin)/admin/shifts/actions.ts:34,83`), so a side B
    spawned inside the staffing horizon persisted as `Pending` rather than `Filling`. Both actions now
    build one clock above the `try` and pass it in; `mergeAction`'s audit `now` was hoisted rather than
    re-minted, so state resolution and the audit row share an instant. **Four tests pin both halves of
    the contract** (`Filling` with a clock, `Pending` without) at the domain layer — deliberately not
    e2e, because `resolveShiftStateOnRead` re-resolves on every read (the DEC-023 corollary, "never
    trust the persisted badge") and would mask the defect from any UI assertion. That masking is also
    why it stayed unnoticed: the only observable was the persisted row.
  - **Also fixed:** the pre-DEC-126 "2026 import-mode vs 2027 live-mode" framing (twice — §0.3 and §2.2
    were rewritten away from it, §2.3 was missed); "CSV import" (DEC-043-retired); "grouped by boat then
    day", which is the **opposite** of the shipped board (day-then-boat, blessed by DEC-085/086); the
    split-threshold open question, answered by two env knobs and 14 tests; and AC-2's "partition the
    original's trips", which mis-words a deliberate DEC-083 design (the partition re-derives from live
    trips, so the two sides' union is *not* the original's set after any booking change).
  - **Cost: ~95k subagent tokens** against a ~150k budget — the first sub-shard to come in under. The
    orchestrator's prediction held: **cost tracks whether the section's code has an operator surface, not
    the section's line count.** C2.1/C2.2 spent their budget proving absences (whole-tree zero-caller
    greps); §2.3's machinery is shipped and reachable, so the brief dropped the speculative-grep step.
    §2.4–§2.7 all have shipped routes — budget them at ~95–120k, not 150k.
  - **Which-tree check, corrected:** `docs/SPEC.md` **does** diverge between `main` and
    `feature/reservations` (10 hunks, 150+/89−), but none touch 606–717. The shorthand "SPEC §2.x is
    byte-identical" is **false at file granularity** — re-run the range check per sub-shard.
- **Shard D CLOSED — by deletion, not by fixing.** 7 findings, 6 verified-consistent. Its headline
  was that both *procedural* docs were wrong about procedure: `OPERATOR_MANUAL` §Import described a
  retired spreadsheet upload, and the walkthrough's "must be resolved before crew test" list had all
  four blockers resolved. **The operator's call was to delete the corpus rather than repair it** —
  the pilot ran for a week and ended long ago, and "this is only for the pilot" had become a
  standing tax. `OPERATOR_MANUAL.md`, `E2E-PILOT-WALKTHROUGH.md`, `PILOT_RUNBOOK.md`,
  `PILOT_IMPORT_FINDINGS.md` and 14 duplicated Xola screenshots (7.4 MB) are gone; references
  cleaned up across `CLAUDE-context`, `CREW_QUICKSTART`, `PROJECT_PLAN` and DEC-136.
  **The shard-D doc edits were discarded work** — they repaired files deleted hours later. The
  ledger survives as the record of *why* the deletion was justified. A fresh operator manual gets
  written after reservations lands.
- **Shard D2 CANCELLED** — its entire corpus was the deleted PILOT docs.
- **Shard E closed + FIXED** — 2 findings, 4 verified-consistent. **E1 is the highest-consequence
  finding still live anywhere in this audit:** `DEPLOY.md`'s env table omitted **22 variables the code
  reads**, derived mechanically by diffing every `process.env` read across `src/`/`app/`/`db/` against
  the documented set. A deploy built from that runbook comes up with **crew unable to sign in**
  (`CREW_SELF_SERVE` gates the login door and is OFF by default) and **no reservations importing**
  (`XOLA_API_KEY`/`XOLA_SELLER_ID`). Production has them — set in Vercel as each feature landed, never
  backfilled — so it bites a rebuild, a second environment, or a DR restore, not the running deploy.
  Fixed as a separate clearly-marked table with the consequence spelled out per variable.
- **Shard G closed + FIXED** — 4 findings, 5 verified-consistent. `DESIGN-REFERENCE.md`'s mockup index
  — the section whose entire job is *filename → surface → spec section* — listed **8 files, none of
  which exist**, and omitted ~50 that do, including the whole P12 reservations set. Its own footnote
  had offered the out ("*or update this table to match your filenames*"); nobody took it. Replaced
  with what is on disk; **the file→spec-section mapping is deferred to C2**, whose corpus is the
  §2.x sections that mapping requires. Also: `CLAUDE-context` said `@ui-reviewer` was *inert* until
  `.claude/ui-context.md` existed — it exists (83 lines), so the docs had been calling a working agent
  broken. **`BRAND.md` is the healthiest document in the audit**; its neighbours were the problem.
- **C2.4–C2.7 SWEPT IN PARALLEL (S72, 2026-07-27) — the §2.x corpus is now fully covered.** Four agents
  concurrently, ~10 minutes wall clock, ~490k subagent tokens, **49 findings + 66 verified-consistent
  rows**, every acceptance criterion in §2.4–§2.6 verdicted against source. **Sequential-only is retired
  as a rule** — the ledger-on-disk pattern was always what protected the orchestrator's context, not the
  sequencing, and four independent subjects share no state. Cost per shard was unchanged by running
  them together (90k / 118k / 110k / 105k).
  **Six code items filed: #554 #555 #556 #557 #558.** Doc fixes and the 12 operator decisions are open.
  - **#554 is the one that matters: a crew member can be confirmed to two boats the same day.** §2.7.2
    *and* DEC-078 both assert the claim is guarded against "the one-shift-per-date conflict". The
    single-seat race is genuinely closed by a CAS; the same-date guard is a read-then-CAS over a
    cross-record invariant the no-FK store cannot enforce, and `src/asks/claim.ts:111–119` **says so in
    its own words**. Two in-flight taps by one person, both read an empty `committedDates`, both CAS-win.
    Whole-day commitment is the entire premise DEC-077 chose day granularity for. Nothing had been filed —
    the only prior record of a reachable double-confirm was a code comment contradicting two documents.
  - **Two live copy defects that mislead the operator at the worst moment.** #555: the cockpit's "Ask to
    fill" tooltip still promises "their yes still needs your confirm" — false since DEC-061, which made
    a crew "In" auto-confirm. #556: when a mate seat's only remaining candidates are captains, DEC-066
    drops them from the ranked pool, so the At-Risk row reads "nobody left in the eligible pool — this is
    the reschedule / cancel" **while pointing at two disabled buttons**, when DEC-066's own text says the
    fix is a cockpit override. That is the 11pm-before-a-charter screen telling him to cancel a fillable
    trip.
  - **The audit found its own prior fix incomplete.** #557: PR #549 narrowed the C2.1-10 credential-expiry
    skew from a full day to ~4 evening-ET hours — it did not close it, and the comment beside it still
    asserts "Same rule, one boundary." Second time a **stated invariant** in a comment turned out false.
  - **Each section failed differently, which is why the per-surface split earned its cost.** §2.4 is the
    least-reconciled: five DECs (027/061/063/065/128) each say in their own text that they change its
    behavior and four never came back to the doc — the fills-by deadline (departure −48h, DEC-031) and the
    staffing horizon (departure −7d, DEC-022) are conflated in the spec and rendered on adjacent lines of
    the same header. §2.5's body was reconciled to DEC-065 twice while **AC-1 was left specifying the
    exact defect DEC-065 was filed to fix** — anyone verifying the board against its own criteria would
    mark correct shipped behavior as a failure. §2.6 has **never had a reconciliation pass at all**, and
    its founding claim — "Two buttons. ~3 seconds. No login, no navigate-to-respond" — describes the one
    thing the shipped ask does not do (DEC-030 chose an operator-relayed magic link; no inbound webhook
    exists). §2.7 is the only §2.x section with **no acceptance criteria at all**.
  - **Lesson 11 held three more times.** C2.5-1, C2.6's whole-section drift, and C2.4's five-DEC backlog
    are all the same shape as C2.3's unstruck lock section: a decision that changed the system and never
    went back to the doc. **C2.4's agent proposed the cheap pre-flight that would have found all of them:
    grep `DECISIONS.md` for "Amends SPEC §2.x" before reading any code** — each hit names a doc edit that
    may never have happened. Adopt it for shard Z and any future sweep.
- **Next: the C2.4–C2.7 doc fixes** (28 `doc-wrong` rows, enumerated per-ledger), the **12 operator
  decisions**, then **Z** (`DECISIONS.md` internals) — which C2.7-4 already feeds: DEC-078's "MVP
  claimable set" paragraph is the *origin* of stale wording #440 widened, so a SPEC-only fix would leave
  the DEC as the surviving wrong answer. Muster-only, no seeds.
- Shard F cost one agent, 143k subagent tokens, and produced 53 findings from the *smallest*
  corpus slice. A, B and C each ran in-context for far less — but all three had small, grep-reachable
  corpora. **C2 does not**; budget it closer to F.

### Lessons that change how later shards run

1. **Verify seeds claims against `origin/main`, not the local checkout.** The local `~/seeds` was
   11 commits behind, which produced four wrong or misfiled rows in shard F (4, 5, 6, 18) and one
   fabricated "11 commits of pull-seeds debt" that turned out to be a single low-priority file.
2. **A finding against `CLAUDE.md` is probably an upstream defect.** Muster's copy was
   byte-identical to the seeds template, so shell findings are template findings — they affect
   every project sharing it, and the fix routes through `/push-seeds`. **Confirmed at triage:** 23
   of shard F's 43 findings lived in files byte-identical to seeds templates.
4. **Check which tree the subject actually lives in before sweeping.** Shard A's entire corpus is
   on `feature/reservations`, not `main` — 862 commits and every money migration. A `main` sweep
   would have produced a ledger of "SPEC describes unbuilt features" and missed all 7 real rows.
   Shards C and D (asks/shifts, reservations/import) need the same check first.
5. **Not every shard needs a sweep agent.** Shard A's corpus was grep-reachable and small; running
   it in-context beat the ledger-on-disk indirection. Use the agent when the finding volume, not
   the corpus, is what threatens the window — that was F, and will be C2 and D.
6. **Before reporting "this spec machinery doesn't exist," check whether its *function* moved.**
   Shard C reported §1.3's property rules as absent. They were absent *as oracle rules* — but
   DEC-125 implements most of them as set subtraction under different vocabulary (`Block`,
   schedule terms, slot identity). Grep the shipped design's words, not only the spec's.
8. **Procedural docs rot worse than reference docs, and cost more when they do.** Every shard
   before D found reference docs describing the system wrongly. Shard D found the two docs a human
   *follows step by step* — `OPERATOR_MANUAL` and `E2E-PILOT-WALKTHROUGH` — wrong about the actual
   procedure: an upload control that no longer exists, and a readiness gate whose four blockers were
   all resolved. **Audit procedural docs first, not last.** `PILOT_RUNBOOK.md` is the remaining one
   and is still unread.
9. **In-context sweeps work on structure, not on prose.** A, B and C had grep-reachable corpora, so
   coverage came from searching. D's corpus is narrative, so coverage came from *reading* — and the
   shard ran out of room at ~44% of its corpus. That is exactly the condition the ledger-on-disk
   sweep-agent pattern exists for. **D2 and C2 both want an agent.**
10. **Ask whether a document should exist before auditing it.** Shard D found real drift in the
   pilot-era docs, fixed it, and watched the operator delete all four files the same day — the
   repair work was spent on documents with no future. **Cheapest first question for any shard:
   is this corpus still load-bearing?** A deletion closes more findings per minute than any fix.
7. **A "gap" the operator can close in one sentence was never a finding.** Both genuinely-absent
   rules shard C surfaced (COI expiry, lead-time cutoff) were rejected on domain knowledge no
   amount of code-reading would have produced — one because the risk is managed off-system, one
   because the "gap" was a designed-for behavior. Escalate absences as **questions**, not defects,
   and record the answer (DEC-138) so the next sweep doesn't re-derive them.
11. **A reconciliation pass is itself a doc edit, and doc edits stop early.** Shard C2.3's headline was
   not drift between a doc and the code — it was drift **inside one section** between a `⚠️ Reconciled`
   header and the four blocks below it that the header declared dead. Three of five got struck; two
   didn't, and the survivors were the last live description of a cut feature in the whole project.
   **When a section carries a reconcile banner, check every block against the banner's own claim** — the
   banner is a promise about the text beneath it, and it is checkable like any other claim. Cheap: the
   banner tells you exactly what to grep for.
12. **Budget a shard by whether its code has an operator surface, not by its line count — but "a route
   exists" is not "this component renders."** C2.1/C2.2 cost 120–141k because the expensive move was
   proving negatives across the whole tree. C2.3 covered a *longer* section for ~95k because
   `/admin/shifts` exists, so nothing had to be proven absent. **That saving cost one wrong row.** C2.3-6
   cited `manning-section.tsx:72` as shipped operator copy; `ManningSection` has **zero callers** and
   dropped out at `cc581f8` (Phase 9.5). The orchestrator's brief had suppressed the zero-caller sweep,
   and the operator caught it. The rule that survives: **drop the speculative whole-tree sweep, but
   always grep the symbol of any component you cite as live evidence.** One grep per citation, not per
   module. A component file existing on disk is worth nothing — this repo keeps withdrawn UI in place.
3. **The ledger-on-disk pattern held.** The orchestrator read one 79-line file instead of taking
   53 findings into context. Keep it for every remaining shard.
