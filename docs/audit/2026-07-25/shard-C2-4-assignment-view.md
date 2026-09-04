# Shard C2.4 — Assignment View

**Subject:** `docs/SPEC.md` lines **759–847** — all of `## 2.4 Assignment View`: the source
block-quote, Purpose (the two postures + warming), View structure / states to render, Actions, the
fork-resolved note, "Both protocols live here", Data read, Edge cases, the 5 acceptance criteria, and
the 2 open questions.

**Audited tree:** `main` @ `f401e9c` (branch `task/audit-c2-4-to-c2-7`).

> **Which-tree check (lesson 4) — run, not assumed. Result: §2.4 is byte-identical on both trees.**
> `git diff main origin/feature/reservations -- docs/SPEC.md` = **169 insertions / 149 deletions across
> 12 hunks** — the file diverges materially. **None touch 759–847.** The two nearest hunks bracket the
> section on the low side (`@@ -720,18` covering `main` 720–737 and `@@ -744,15` covering 744–758 — the
> §2.3 acceptance criteria and open questions); the next is `@@ -1177,10`, in §4. Verified directly
> rather than by hunk arithmetic: §2.4 starts at `main:759` and at `feature/reservations:776`, and
> `diff <(main 759–847) <(fr 776–864)` is **empty**. A `main` sweep is complete for this subject.

**Evidence read.** `app/(admin)/admin/shift/[shiftId]/page.tsx` (full) + `actions.ts` (full, 446 lines).
`components/assignment/` — `shift-cockpit.tsx` (full), `seat-card.tsx` (full), `candidate-row.tsx`
(full), `cockpit-bits.tsx` (full), `warming-panel.tsx` (full); `bits.tsx`, `shift-manifest.tsx`,
`manning-section.tsx` (targeted). `src/asks/assignment-view.ts` (full), `ask-loop.ts` (targeted:
`rankedEligible`, the two protocol entries, `bail`, `recordResponseAndConfirm`, `resolveProtocol`),
`escalate.ts`, `lean.ts` (call sites). `src/oracle/eligibility.ts:1–90`, `reliability-score.ts:117–252`.
`src/admin/at-risk-board.ts:240–290`. `src/builder/derive.ts` (`FILL_DEADLINE_HOURS`,
`fillDeadlineFromEvents`), `tick.ts` (targeted). `app/(admin)/admin/at-risk/page.tsx`,
`components/at-risk/risk-row.tsx` (link only), `app/(admin)/admin/page.tsx` + `actions.ts` (engine
pause). `app/(crew)/crew/actions.ts:59`. `docs/DECISIONS.md` — DEC-007, DEC-019, DEC-022, DEC-024,
DEC-026, DEC-027 (full, incl. the Unit-C amendment), DEC-028, DEC-031, DEC-038, DEC-039/#87, DEC-054,
DEC-061, DEC-062, DEC-063, DEC-064, DEC-065, DEC-066, DEC-085, DEC-087, DEC-096, DEC-128, DEC-129,
DEC-130. Test *names*: `src/asks/assignment-view.test.ts` (16), and the `test(...)` inventory of
`e2e/{cockpit-override,cockpit-polish,cockpit-manifest,bail-reask,bail-regression,board-nudge,crew-ask,trainee-staffing}.spec.ts`.

**Live-component check (lesson 12) — one grep per cited symbol, no exceptions.** Every component this
ledger cites as shipped operator surface was grepped for callers across `app/` + `components/` + `src/`:

| component | verdict |
|---|---|
| `ShiftCockpit` | **live, two hosts** — `app/(admin)/admin/shift/[shiftId]/page.tsx:44` (standalone) and `app/(admin)/admin/shifts/page.tsx:533` (board right pane, DEC-085) |
| `SeatCard` | **live** — `shift-cockpit.tsx:347` |
| `CandidateRow` | **live** — `seat-card.tsx:195` |
| `WarmingPanel` | **live** — `shift-cockpit.tsx:374` |
| `ShiftManifest` | **live, two hosts** — `shift-cockpit.tsx:371` and `app/(crew)/crew/shift/[shiftId]/page.tsx:255` |
| `GuestTextButton` | **live** — `shift-manifest.tsx:113` |
| `toSeatVM` / `Badge` (`cockpit-bits.tsx`) | **live** — `shift-cockpit.tsx:16,186,242` |
| `ManningSection` | **DEAD, confirmed again.** Its only remaining mention anywhere is the tombstone comment at `app/(admin)/admin/shift/[shiftId]/actions.ts:333`. **Not cited as evidence in this ledger.** |

Two **domain** symbols were also caller-checked and turned out dead — those are findings, not
citations: `broadcastAsk` (C2.4-2) and `resolveProtocol` (C2.4-4).

**What this shard did not do.** No speculative whole-tree zero-caller sweep. §2.4's surface is shipped
and reachable end-to-end, so the budget went to doc-vs-code drift. The three absences that *were*
proven cost one grep each with a small named search space (`broadcast`; `protocolOverride|resolveProtocol`;
`reliability` across `components/`+`app/`).

---

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| C2.4-1 | `SPEC.md:779-780` + AC-5 `:837-838` | "the **fills-by deadline** to the staffing horizon, **rendered 'deadline'** on the cockpit (DEC-038)" / "the fills-by deadline (rendered **'deadline'**, DEC-038) **reflects the staffing horizon**" | **Two different instants, conflated.** `fillsBy` = `earliestScheduledStart − FILL_DEADLINE_HOURS` (**48h**, `derive.ts:347, 360-368`, DEC-031). The staffing horizon = `earliestScheduledStart − STAFFING_HORIZON_LEAD_DAYS` (**7 days**, DEC-022/062). They are computed by two separate functions, carried as two separate fields (`assignment-view.ts:86-93, 259-261`), and **rendered as two separate lines stacked in the same header block** — `staffing starts: <date>` at `shift-cockpit.tsx:277-287`, then `deadline: <fillsBy>` at `:288-299`. DEC-027 §4 is the decision that pulled them apart, in as many words: *"the §2.4 'fills by' AC wording is deliberately under-shipped — **the staffing horizon is when asks start, not a fill deadline**, and a countdown to it reads 'passed' for any shift being worked."* DEC-031 then built the real one; DEC-038 relabeled its display. The doc absorbed the **label** change and kept the **anchor** error — and the AC restates it, so the box can never be honestly ticked as written | CODE-CONTRADICTS | doc-wrong |
| C2.4-2 | `SPEC.md:793`, `:798` | "**Broadcast ask** — fire to the whole eligible pool" / "**Widen / re-ask** — broaden the pool or re-fire after declines/timeouts" — listed as two of the six cockpit Actions | **Neither exists, and a DEC says so.** DEC-027 §1: *"Manual broadcast is **deferred** (the §2.4 broadcast AC is satisfied by the tick-fired path; a blanket re-broadcast to decliners is spam, not escalation); **'widen' has no rail by DEC-024**."* The shipped inventory is assign / nudge / confirm / override (DEC-027 §1) + report-a-bail (DEC-027 Unit-C amendment) + no-penalty remove (#87/DEC-039) — `actions.ts:131,153,175,190,248,298`. No broadcast or widen control renders anywhere on the cockpit. Deeper: **`broadcastAsk` has zero production callers** — the only non-test references are its own definition (`ask-loop.ts:204`) and two docstrings; DEC-063 replaced the birth blast with the staged `widenAsk` drip (`tick.ts:306,339`). Same reconcile-stopped-early shape as C2.3-1: DEC-027 answered this in June and the Actions list was never revisited | MISMATCH | doc-wrong |
| C2.4-3 | `SPEC.md:820-821` (Edge cases) | "**Bail** → seat card **flips red**, auto-reopens, **re-asks the next candidate** (the `Crewed → Filling` edge, §1.1)" | **Superseded by DEC-128 (#483), which is 8 days old and was a prod fix.** `bail()` now rests the seat **`Open`**, not `Bailed`, and mints no asks: `const reopened: Seat = { ...seat, state: "Open" }` → `refreshShiftStateHorizon` (`ask-loop.ts:533-538`). DEC-128 verbatim: *"**`Bailed` retired as a resting state.** No writer produces a resting `Bailed` seat anymore"*, and *"a `bail`/`vacate` previously fired its own re-ask **inline and horizon-blind**… Verified in prod 2026-07-19 (Brew 4 / Aug 8 shift, ~13 days pre-horizon: a captain bail stamped 6 identical-millisecond `push` asks)."* So for any **new** bail the card never flips red, and re-crewing is the tick's — **pre-horizon it deliberately asks nobody**. `seat-card.tsx:45-51,141-147` retains the red `Bailed` treatment for legacy seats only (DEC-128 keeps the readers, no migration). Pinned by e2e `bail-reask.spec.ts:25` *"bail rests the seat Open (no inline re-ask)… cockpit shows the reopened seat"* and `bail-regression.spec.ts:28` | CODE-CONTRADICTS | doc-wrong |
| C2.4-4 | `SPEC.md:809-812` (### Both protocols live here) | "the only difference is whether the ask goes to the crowd first (**ask-then-assign**, mates) or names someone first (**assign-then-confirm**, captains). **Per-role default with per-person override** (the override lives on the roster record, §2.1)." | **The two-protocol split is not a live decision anywhere in the running system.** `resolveProtocol` (`ask-loop.ts:772-777`) — the one function that would choose — has **zero production callers**; its only references are `ask-loop.test.ts:24,796-808`. Its `roleDefault` argument has **no source**: no per-role protocol default exists as tenant data, config or schema (grep `roleDefault|defaultProtocol|askProtocol` across `src/` returns only the parameter itself). `protocolOverride` is a persisted field (`entities.ts:117,142`; `postgres-repository.ts:130,445,514`) with **zero readers outside `resolveProtocol`** and **zero UI** — no hit anywhere in `app/` or `components/`, so §2.1's "the override lives on the roster record" describes a column with no editor. What actually runs is one shape: every autonomous ask is `widenAsk`-drip (`tick.ts:306,339`, DEC-063) and every manual/Tier-2 ask is `assignPerson` (`lean.ts:155,231`; `escalate.ts:122`). DEC-007 is the authority the section restates, and DEC-063 + DEC-061 have since collapsed the distinction from the two ends — the drip means no one is "asked as a crowd", and auto-confirm means no one is "named then confirmed" by a human. **This is the C2.1 `buildRoster` / C2.2 `browse.ts` shape a third time: a designed mechanism, complete enough to be tested, with no surface and no caller** | CODE-CONTRADICTS | **decision** |
| C2.4-5 | `SPEC.md:841-843` (Open questions) | "Whether the autonomous posture needs an explicit **'pause automation, I've got this'** toggle per shift, or whether any manual action implicitly pauses the bots. *(Lean: any manual action pauses; confirm in build.)*" | **Answered in build, in a DEC, thirteen months of phases ago — and still standing unstruck.** DEC-027 §2 (its title carries it: *"implicit automation-pause confirmed as emergent"*): *"`escalate` fires only on a stalled shift with no live asks, and every manual assign/nudge **creates** a live ask; `broadcastAsk` fires only at the `Pending→Filling` birth inside `tick`. The autonomous tier is **already incapable of fighting a manual placement — no pause flag, no resume action in v1**. The explicit toggle is parked in FUTURE_IDEAS with the trigger 'automation gains a lever that can act on a seat carrying a live manual ask.'"* Independently overtaken from the other side: **DEC-054 shipped an operator engine pause** — but **global, at `/admin`, not per-shift** (`app/(admin)/admin/page.tsx:44,132,158` → `actions.ts:16-25` → `repo.setEnginePaused`, honored at `app/api/cron/tick/route.ts:46` and `doorbell-tick/route.ts:39`). A reader of §2.4 today learns neither fact. Exactly C2.3-1's shape | MISMATCH | doc-wrong |
| C2.4-6 | `SPEC.md:782` + `:796` | Seat card sub-state "**Claimed** (accepted, **awaiting confirm**)" / Action "**Confirm** — lock a claimant into the seat" | **DEC-061 amends this section by name and the amendment landed on the AC only.** DEC-061: *"A winning accept advances `Asked → Claimed → Confirmed` in one operation… the manual cockpit confirm — **now a vestigial backstop**"*, and under Tradeoff: *"**Amends SPEC §2.4** (the 'confirm down the list' step)… `Claimed` becomes non-resting on the happy path."* AC-3 (`:832-834`) **is** annotated with DEC-061; the two body bullets 50 lines above are not, so the section describes `Claimed` as a resting state an operator works and `Confirm` as a first-class action rather than a backstop. The UI still ships both (`seat-card.tsx:71-85` Claimed branch → `confirmInto`, `actions.ts:175`), so this is a stance/prominence error, not a dead-feature error | MISMATCH | doc-wrong |
| C2.4-7 | `components/assignment/candidate-row.tsx:49` *(shipped operator copy, not a doc)* | "Ask to fill" button tooltip: "Name them into this seat — they get the ask; **their yes still needs your confirm**" | **False since DEC-061, and it is live UI.** Caller chain verified: `CandidateRow` ← `seat-card.tsx:195` ← `shift-cockpit.tsx:347` ← both hosts. The button posts `assignTo` → `assignFromPool` (`actions.ts:131-151`), which mints an ask; the crew's "In" then routes `respondToAsk` → **`recordResponseAndConfirm`** (`app/(crew)/crew/actions.ts:59` → `ask-loop.ts:433-439`), which auto-confirms. DEC-061 applies to **both** protocols explicitly (*"the mate broadcast's first-yes **and** the named-captain's accept"*), so there is no path on which this tooltip is true. Pinned the other way by e2e `crew-ask.spec.ts:14` *"In auto-confirms the seat → My shifts shows it as a confirmed shift"*. Consequence is mild but real: the operator is told to expect a confirm step, so a seat that goes straight to Confirmed reads as something having gone wrong | CODE-CONTRADICTS | code-wrong |
| C2.4-8 | `components/assignment/shift-cockpit.tsx:39-41` *(code docstring)* | "Honest header (DEC-027 §4): the countdown is 'departs in' (trip start) and the staffing horizon renders as a dated fact — **the named 'fills by' deadline is NOT faked; it lands with #59.**" | **#59 landed.** DEC-031 is #59's decision and the deadline is rendered 250 lines below the docstring that says it isn't: `view.fillsBy` → `deadline: {fmtDeadline(view.fillsBy)}` + `· overdue` (`shift-cockpit.tsx:288-299`), fed by `fillDeadlineFromEvents` (`assignment-view.ts:261`), relabeled by DEC-038. Same *pair* of anchors as C2.4-1 — the docstring is the last place in the repo still asserting the under-shipped state, and it is the file a reader opens to check C2.4-1. Low severity, one clause | CODE-CONTRADICTS | code-wrong (low) |
| C2.4-9 | `SPEC.md:799-800` + AC-5 `:837` | "**Manual override** — drop **anyone** into a seat directly. Eric is always the authority; last-resort backstop." / "Manual override places **any person** into a seat regardless of rank" | **"Regardless of rank" is right; "anyone" is not, by two deliberate decisions.** `overrideSeat` bypasses pool, rank and seat state — but returns `not_rated` under DEC-064's role-competency floor (`actions.ts:200-207`; DEC-064: *"no mate as captain"*) and `archived` under DEC-096 (`:208`). The picker itself is doubly scoped: archived crew are dropped from `ratingsById` (`shift-cockpit.tsx:130-138`, #323/DEC-096) and the list is filtered per-seat to crew rated for **that** role (`:351-353`, DEC-064) — so a mate is not even offered for a captain seat, and `seat-card.tsx:206-208` says so in operator copy ("Only crew rated for this role appear"). DEC-064's own framing keeps the authority claim intact: the override is the *only* unguarded path *except* the competency floor. One word — "anyone" → "anyone rated for the role" — in two places | MISMATCH | doc-wrong |
| C2.4-10 | `SPEC.md:825-826` (Edge cases) + `:816` (Data read) | "**Reliability exposure** — **resolved:** show Eric the **ordering plus reasons on demand**; no need to hide a number from the operator" / reads "the **reliability ordering + reasons** (§1.4)" | **Ordering ships; reasons do not exist, in the UI or as a shape.** Ordering: `rankedEligible` → `rankEligibleIds` → `rankByReliability` (`ask-loop.ts:186`, `reliability-score.ts:242-251`), and the pool renders in that order. Reasons: the score's return type is `ReliabilityScore { score, eventCount, windowEvents }` (`reliability-score.ts:117-124`) — a scalar plus two window facts, **no per-event or per-factor breakdown to expose** — and **no admin component renders a reliability score, indicator, or reason at all**: grepping `reliability` across `components/` + `app/` returns only `seat-card.tsx:110,113` (bail-vs-remove copy), two crew-facing comments, and `crew/help/page.tsx:79` (the *crew's* own standing, §1.4/§2.6). The sibling clause at `:786-787` hedges the pool row explicitly — *"reliability indicator (high/med/low **or ordering is enough**)"* — so ordering-only is a sanctioned outcome **there**; the edge case's "plus reasons on demand" is the unhedged half and it is the one that says "resolved". **Escalate as a question, not a defect** (lesson 7): the operator may well have decided ordering *is* the answer | CODE-CONTRADICTS | **decision** |
| C2.4-11 | `SPEC.md:822-823` (Edge cases) | "**All declined / all silent** → pool exhausts; **if also close to the deadline**, the shift escalates to At-Risk and onto the board (§2.5)." | **Describes the boarding gate DEC-065 deleted.** Route (b) of `deriveAtRiskBoard` now boards a still-`Filling` shift whenever a required seat is uncrewed **and** the trip is within `EXHAUSTED_THRESHOLD_HOURS` — *"boards **regardless of in-flight asks**. The pending/asked gate is gone — a live ask (or a nudge) no longer hides a near-term uncrewed shift"* (`at-risk-board.ts:252-269`, comment verbatim). DEC-065 deletes the old `trail.asked > 0 && trail.pending === 0` willingness precondition by name and adds: *"The 'on the board = automation gave up' framing (the §2.5 board copy rationale) **no longer holds for route (b)**."* So the doc's conjunction is inverted — exhaustion is **not** required inside 48h, and the *eligibility*-exhaustion route (a) boards **however far out**, with no deadline condition at all (`:257-258`). Both halves of "if also" are wrong. Pinned by e2e `board-nudge.spec.ts:16` *"nudging a candidate keeps the near-term row on the board (DEC-065)"*. §2.5 is C2.5's subject — logged here because the claim is stated in §2.4 | MISMATCH | doc-wrong |
| C2.4-12 | `SPEC.md:777-791` (### View structure / states to render) | The rendered cockpit is enumerated as three things: shift header, seat cards, eligible pool | **Three shipped sections are absent from the enumeration, one of which an open question in the same file parks as unbuilt.** (a) The per-event **guest manifest** (#319) — `ShiftManifest` at `shift-cockpit.tsx:370-372`, same `buildShiftManifest` assembly the crew card reads, pinned by e2e `cockpit-manifest.spec.ts:19,65`. (b) The **"✉ Message this day's crew →"** cohort deep-link (#317, `:308-315`) — which is a **cross-shift** operator action, i.e. partial delivery of §2.4's *own* open question at `:844` ("Bulk actions across multiple shifts… partly here, partly on the board") and of the `§4 Parked` "cross-shift broadcast" row C2.3-3 left standing. (c) The **Crewed-gate summary** line — "N/M required seats confirmed — Crewed when all confirm" (`:359-367`, 9.8), pinned by `cockpit-polish.spec.ts:17`. Also unlisted, and correctly so: the trainee staff/unstaff path (DEC-087), whose *error copy* the cockpit still carries (`:61-64`) although its UI went with `ManningSection` | MISMATCH | doc-wrong |
| C2.4-13 | `SPEC.md:781-784` | "**Seat cards** — one per required seat… **Open** (**expands to** the eligible pool)" / "**Eligible pool** (**per open seat**)" | **Two small drifts, both against the doc.** (i) Pools render on **Open, Asked and Bailed** seats, not Open alone — `POOLED_STATES` (`assignment-view.ts:121-126`), the P3 monitor gap DEC-027 closed on purpose (*"the assignment view now also feeds pools to Asked seats (monitor transparency) and Bailed seats minus bailers"*), tested at `assignment-view.test.ts:222` *"an Asked seat shows its pool — the monitor view of who's in flight"* and `:234`. (ii) "Expands to" is now the **opposite** of the shipped default: every pool is a `<details>` **collapsed by default** (`seat-card.tsx:176-200`), an explicit operator preference dated 2026-07-05 and commented as a reversal (*"Previously an un-Asked seat auto-expanded its pool; the operator wants a uniformly compact cockpit"*), pinned by e2e `cockpit-polish.spec.ts:44`. "One per required seat" is exactly right (`assignment-view.ts:137-139` filters `kind === "required"`) | MISMATCH (partial) | doc-wrong |
| C2.4-14 | `SPEC.md:778` | Shift header: "boat · date · trips (1/3/5pm) · **pax totals** · overall crewing-state badge" | Ambiguous, and the aggregate reading is false. `AssignmentView.paxTotal` **is** computed (`assignment-view.ts:83, 258`) and is read by **no component** — zero hits for `paxTotal` across `components/`. The header renders per-trip pax chips only (`shift-cockpit.tsx:250-260`), with the drop recorded deliberately at `:248-249`: *"The 'aboard total' tail is **dropped for now** (add back if missed)."* Read as "per-trip pax totals" the claim is true; read as an aggregate it is false. Near-noise — logged because the field's existence makes it look shipped to anyone grepping | MISMATCH (partial) | doc-wrong |
| C2.4-15 | `SPEC.md:786-787` | Eligible pool: "**Only legally fillable people appear** (credentials valid on date, correct rating, not double-booked, not on PTO)." | **The promise holds; the parenthetical list is four exclusions short, always in the safe direction.** The hard eligibility rule set is six, not four — `is_active`, `has_rating`, `mmc_valid_on_date`, `not_double_booked`, `not_on_pto`, **`not_recurring_off`** (`eligibility.ts:46-52`); the doc omits inactive-crew and standing weekdays-off. On top of that `rankedEligible` drops three more classes the doc doesn't mention: **over-ranked** crew (DEC-066/#148 — a captain rated `[captain, mate]` is never *asked* for a mate seat, `ask-loop.ts:190-194`), this shift's **bailers** (DEC-019, `assignment-view.ts:220`, tested `:257`), and **live-ask holders on other seats of the same shift** (`:221-223`, tested `:294`). Under-inclusive only, so "only legally fillable people appear" is never violated — but a reader auditing the pool against this list will find people missing and no explanation. Separately note DEC-129's send-time suppression is deliberately **not** in this pool (it filters the tick, not the operator's list) — correct, and the reason it isn't a fifth omission | MISMATCH (partial) | doc-wrong |

---

## Per-acceptance-criterion verdicts

The five `- [ ]` boxes at `SPEC.md:828–838`, ticked against source for the first time.

### AC-1 — "Each required seat renders its current sub-state and, when Open, an eligible pool ranked by reliability containing only legally fillable people." — **MET**
**Required seats only:** `buildAssignmentView` filters `s.kind === "required"` (`assignment-view.ts:137-139`),
so supernumeraries never mint a card. **Sub-state:** carried per card (`:209-214`) and rendered as the
tone-coded pill at `seat-card.tsx:45-51,167-171`, with the occupant zone switching on it (`:70-149`).
**Ranked by reliability:** `rankedEligible` → `rankEligibleIds` → `rankByReliability`
(`ask-loop.ts:186`, `reliability-score.ts:242-251`) — the one askable pool every path shares, so the
cockpit can never rank differently from the engine. **Only legally fillable:** `eligiblePool` applies
the six hard rules (`eligibility.ts:46-52`), and the view then subtracts bailers and cross-seat ask
holders (C2.4-15) — strictly tighter than the criterion, never looser.
Tests: `assignment-view.test.ts:83` *"renders an Open seat with the ranked eligible pool, all
'available'"*, `:210` *"labels each seat card with its role"*, `:315` *"excludes crew already committed
on another seat of this shift"*; e2e `cockpit-polish.spec.ts:44`.
*Nothing makes this hollow.* Two wording caveats only: "when Open" understates the shipped set
(Open/Asked/Bailed) and the pool is collapsed by default — both C2.4-13, neither a functional gap.

### AC-2 — "A `silent` candidate is visually distinct from a `declined` one." — **MET**
**Domain half:** `statusFromAsks` separates the two at the source — `response === "declined"` → `declined`
with a reply latency; `respondedAt` set with **no** response (the `expireAsks` timeout stamp) → `silent`
(`assignment-view.ts:98-119`). Pinned directly: `assignment-view.test.ts:101` *"distinguishes silent
(timed out) from declined — both first-class"*.
**UI half:** `STATUS_COPY` (`candidate-row.tsx:12-22`) — `declined` is plain `text-muted` reading
"declined"; `silent` is `font-semibold text-bad` reading **"👻 silent — no reply, timed out"**. The
distinction is carried by weight, colour **and words** simultaneously, and the ghost glyph is
`aria-hidden` with the word "silent" doing the accessible work (`:39-41`) — so it survives a colourblind
reader and a screen reader both. `askedSummary` (`:25-30`) additionally names who is still in flight on
the collapsed line.
*Dependency worth naming:* the **domain** half is unit-tested; the **visual** half is not — no e2e in
`e2e/` asserts the two candidate rows differ. The criterion is about a visual property and is verified
by reading the component, not by a test.

### AC-3 — "Broadcasting an ask and a candidate accepting moves the seat Open → Asked → Confirmed (auto-confirm, DEC-061; `Claimed` is momentary) and reflects it in the shift badge." — **MET, but the criterion's first word no longer names anything that runs**
**The transition is met and tested.** A crew "In" routes `respondToAsk` → `recordResponseAndConfirm`
(`app/(crew)/crew/actions.ts:59` → `ask-loop.ts:433-439`), which calls `recordResponse` (CAS claim) and,
only on `claimed === true`, `confirmSeat` — so `Claimed` is genuinely momentary, for **both** protocols
per DEC-061. e2e `crew-ask.spec.ts:14` *"In auto-confirms the seat → My shifts shows it as a confirmed
shift"*. **Badge reflects it:** the cockpit resolves the badge **on read** rather than trusting the
persisted value — `resolveShiftStateOnRead` (`shift-cockpit.tsx:117,174`, the DEC-023 corollary) → `Badge`
(`cockpit-bits.tsx:79-88`).
**Where it's stale:** *"Broadcasting"* is not the shipped fan-out. `broadcastAsk` has **zero production
callers** (C2.4-2); DEC-063 replaced the birth blast with a staged drip — `widenAsk` seeds **one** ask to
the top-ranked candidate and widens by one per `ASK_DRIP_INTERVAL_MINUTES` (`tick.ts:306,339`), going
blast-all only once `now ≥ fillsBy` or with the knob at `0`. And there is no manual broadcast control
for an operator to perform the act the criterion describes. The box is tickable; the sentence should
say "an ask going out" rather than "broadcasting".

### AC-4 — "A confirmed crew bailing flips the seat to Bailed, reopens it, and re-asks the next candidate without manual intervention." — **PARTIALLY MET — two of three clauses superseded by DEC-128 (#483, 2026-07-19)**
**Clause 1, no longer true.** The seat does **not** flip to `Bailed`. `bail()` writes
`{ ...seat, state: "Open" }`, drops the occupant, clears provenance, and calls
`refreshShiftStateHorizon` (`ask-loop.ts:533-538`). DEC-128: *"`Bailed` retired as a resting state. No
writer produces a resting `Bailed` seat anymore."* The red `Bailed` card
(`seat-card.tsx:45-51,141-147`) and the `Bailed` branches in `assignment-view.ts` / `lean.ts` /
`at-risk-board.ts` are **retained for legacy rows only** — no migration, so an old store may still show
one.
**Clause 2, true.** The seat reopens — that is the same write.
**Clause 3, true in outcome, false in mechanism, and the change was the *point*.** Nothing re-asks
inline; re-crewing is deferred wholly to the tick. **Pre-horizon the correct behavior is now to ask
nobody at all** — DEC-128 shipped precisely because the inline blast was horizon-blind and, in prod on
2026-07-19, a captain bail 13 days out *"stamped 6 identical-millisecond `push` asks"* at the whole role
pool. In-horizon the drip picks it up next tick (DEC-063); inside `fillsBy` the urgent path blasts
within one ~15-minute cadence. Both operator-accepted on the record.
Tests: e2e `bail-reask.spec.ts:25` *"bail rests the seat Open (no inline re-ask), keeps Hops off the
board, cockpit shows the reopened seat"*; `bail-regression.spec.ts:28` *"far-out only-captain bail rests
Open and leaves the board quiet — no late-bail alarm (#483)"*.
***The dependency that would make a "MET" here hollow:*** "without manual intervention" is now carried
**entirely by the cron tick**. Before DEC-128 the bail itself fired the asks, so the guarantee was
synchronous and self-contained; today a paused engine (DEC-054 — called out in DEC-128's accepted
changes: *"a bail during a pause won't re-crew until resume"*), a stalled cron, or a pre-horizon shift
all mean the seat sits `Open` and nobody is asked. That is correct behavior, not a bug — but it is a
different guarantee from the one the criterion states, and DEC-128 also **knowingly gave up** the
board's `regression` re-ping and the At-Risk "N late bails" count for new bails.

### AC-5 — "Manual override places any person into a seat regardless of rank (authority backstop), and the fills-by deadline (rendered **"deadline"**, DEC-038) reflects the staffing horizon." — **PARTIALLY MET — clause 1 nearly, clause 2 false as written**
**Clause 1 — met in substance, over-stated in letter (C2.4-9).** `overrideSeat` is the authority
backstop and genuinely bypasses pool, rank and seat state (`actions.ts:190-240`), displacing a prior
occupant with a logged `crew_removed` (`:226-234`, DEC-118). But it is not "any person": `not_rated`
(DEC-064's role floor) and `archived` (DEC-096) are hard rejects at `:206-209`, and the picker is scoped
per seat to crew rated for that role (`shift-cockpit.tsx:351-353`) with archived crew already dropped
(`:134-138`). The override deliberately does **not** read `rankedEligible`, which is what keeps a
captain manually placeable into a mate seat despite DEC-066's ask-suppression — so "regardless of rank"
is precisely right. e2e `cockpit-override.spec.ts:14` *"override is a first-name-sorted dropdown; placing
via it confirms"*.
**Clause 2 — false (C2.4-1).** The rendered "deadline" is `fillsBy` = earliest departure − 48h
(`FILL_DEADLINE_HOURS`, DEC-031), **not** the staffing horizon = earliest departure − 7 days (DEC-022).
The cockpit renders the horizon on its **own separate line** immediately above
(`shift-cockpit.tsx:277-299`), and DEC-027 §4 is the decision that separated them on the explicit ground
that the horizon *"is when asks start, not a fill deadline."* This clause cannot be ticked without
either changing the code (nobody wants that — DEC-031/038 are settled) or rewording the AC.

---

## What this shard would recommend

**§2.4 is the least-reconciled section swept so far, and the reason is structural: it was specced
before the engine existed and every subsequent DEC amended it without coming back.** Five separate
decisions — DEC-027, DEC-061, DEC-063, DEC-065, DEC-128 — each state in their own text that they change
§2.4's behavior, and four of the five left the section untouched. DEC-027 alone answers three of this
shard's rows (C2.4-2 manual broadcast deferred, C2.4-5 pause confirmed emergent, C2.4-1 the horizon-vs-
deadline conflation it named in June 2026) and none of the three ever landed in the doc. Unlike C2.3,
this is not one pass that stopped early — it is a section that was never re-read.

**The headline is C2.4-1 / AC-5: a spec sentence and an acceptance criterion that assert two different
instants are the same one, corrected by a DEC, then half-corrected by a later DEC.** DEC-027 §4
identified the conflation explicitly and deferred the real thing; DEC-031 built it (departure − 48h);
DEC-038 relabeled its display to "deadline". The doc absorbed **only the label** — it now carries
DEC-038's citation attached to DEC-022's anchor, which is the most convincing possible way to be wrong.
The cockpit renders both instants, one above the other, differing by five days. This is also the one
finding that makes an acceptance criterion permanently un-tickable: AC-5 clause 2 is false against code
that is correct and settled, so the AC must be reworded, not the code.

**Three clean strike-or-annotate edits with a DEC to cite and zero judgment required (C2.4-2, -5, -6).**
The Actions list carries two actions a DEC says were never built; the pause open question was resolved
as *emergent* by DEC-027 §2 and separately overtaken by DEC-054's global toggle; and DEC-061's
"`Claimed` is momentary / confirm is vestigial" reached AC-3 but not the two body bullets it also
amends. Same treatment §2.3's lock bullets got.

**Two supersession rewrites where the code changed under the doc (C2.4-3 / AC-4, C2.4-11).** DEC-128 is
**eight days old** and was a production fix — the bail edge case and AC-4 describe the exact behavior it
deleted, down to the red card. DEC-065 deleted the willingness-exhaustion boarding gate the At-Risk edge
case describes. Both need a sentence, not a strike, because the *outcome* survives and only the
mechanism moved.

**Two operator decisions. Ask; do not file (lesson 7).**
1. **C2.4-4 — "Both protocols live here" describes a fork the system no longer takes.** `resolveProtocol`
   has no callers, `protocolOverride` has no reader and no UI, and no per-role default exists as data.
   DEC-063 (drip) and DEC-061 (auto-confirm) each independently collapsed one side of the distinction:
   nobody is asked "as a crowd" any more, and no human confirms a named person's own yes. **The question
   is whether the two-protocol model is now dead design or a deliberate dormancy** — the same shape
   C2.1's `buildRoster` and C2.2's `browse.ts` had, and the answers there differed (one wanted, one
   correctly abandoned). If it's dead, DEC-007's per-role default is the thing to strike, and §2.1's
   "the override lives on the roster record" goes with it.
2. **C2.4-10 — reliability "reasons on demand" is marked *resolved* in the spec and exists nowhere.**
   Ordering ships; the score has no breakdown shape to expose (`ReliabilityScore` is a scalar plus two
   window facts), and no admin surface renders a reliability anything. The pool-row clause 40 lines
   above already sanctions ordering-only ("or ordering is enough"). **Ask: is ordering the settled
   answer?** If yes this is one clause deleted from an edge case. Do **not** file a build task off it —
   §1.4 is another shard's subject and the operator has rejected this shape of "gap" before.

**Two cheap code items (C2.4-7, C2.4-8).** The "Ask to fill" tooltip tells the operator a confirm step
is coming that DEC-061 removed a year of phases ago — live copy, one string, `candidate-row.tsx:49`.
The cockpit's own docstring says the fills-by deadline "is NOT faked; it lands with #59" 250 lines above
the code that renders it — one clause, `shift-cockpit.tsx:39-41`, and it is the first thing a reader
opens when checking C2.4-1.

**Three under-descriptions worth one line each (C2.4-12, -13, -15).** The View-structure list omits the
guest manifest, the cohort message link and the Crewed-gate summary — and the cohort link is *partial
delivery of §2.4's own "bulk actions" open question*, which C2.3-3 already flagged as parked-wrongly in
§4. Pools render on three seat states and start collapsed, not "expand" on Open. The eligible-pool
parenthetical lists four of nine exclusions.

---

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| "The per-shift **crewing cockpit** — both a **monitor** and a **control panel**… Reached directly or **by clicking a shift on the At-Risk board**" | `SPEC.md:761-763` | Both entries real. Standalone route `app/(admin)/admin/shift/[shiftId]/page.tsx`; At-Risk row links straight to it (`components/at-risk/risk-row.tsx:185`, and the lean-confirmation link at `at-risk/page.tsx:138`). The monitor/control-panel duality is the file's own stated design (`shift-cockpit.tsx:24-29`: *"monitor by default, controls on demand"*). Note the standalone host **dropped** its hardcoded "← At-Risk board" back-link in 9.7 because *"it lied when the entry was All-shifts/outbox"* (`page.tsx:17-19`) — a correction, not a regression |
| "The optional **warming view** lives *here* — shifts trending toward risk (horizon approaching, low response) but not yet At-Risk. It is opened **deliberately**, and explicitly **does not** live on the At-Risk board" | `SPEC.md:770-773` | Shipped exactly as specced and as DEC-027 §3 refined it. `WarmingPanel` (`warming-panel.tsx`, mounted `shift-cockpit.tsx:374`) is a link-opened `?warming=1` panel — no client JS, no auto-refresh, no ping (`:3-7`: *"this is the weather, not the alarm"*). Membership is `deriveWarming` = candidate predicate **minus** `deriveAtRiskBoard` rows, so the board stays single-sourced and warming inherits its quiet zone (DEC-027 §3). Signals are the conservative pair — silent count and settled-ask response rate (`shift-cockpit.tsx:149-166`) — and a live ask is deliberately never a signal. Derived only when opened |
| "**Both postures without clutter, defaulting to a calm monitor that exposes controls on demand**" | `SPEC.md:766-767` | Structural, not aspirational. Every control is behind a `<details>` disclosure — the pool (`seat-card.tsx:183`), the override picker (`:202`), the remove/bail pair (`:114`) — and `toSeatVM` emits an action **only where the domain would accept it** (`cockpit-bits.tsx:15,28-34`: Assign on `available`, Nudge on `declined`/`silent`, nothing on an `asked` row). `seat-card.tsx:12-16` states the rule: *"an Asked seat shows its pool as status only (people mid-decision are the system working — no buttons to mash)… never render a button the action refuses"* |
| "**Assign a person** — name someone into a seat; they get a confirm/decline ask" · "**Nudge** — direct individual escalation (manual Tier 2)" · "**Confirm**" · "**Manual override**" | `SPEC.md:794-800` | Four of the six listed actions are exactly the DEC-027 §1 inventory and all four ship: `assignTo`→`assignFromPool` (guarded, lean's accept set per seat), `nudgeOn`→`lean` (shift-level, and the tooltip says so — `candidate-row.tsx:56-62`), `confirmInto`→`confirmSeat`, `overrideTo`→`overrideSeat` (`actions.ts:131,153,175,190`). The other two are C2.4-2 |
| "In the autonomous posture the system performs broadcast → rank → confirm on its own; **these actions are Eric's manual equivalents for taking over**" | `SPEC.md:802-803` | True, and it is the load-bearing sentence behind DEC-027 §2's emergent-pause finding: the manual actions ride the *same* rails (`lean`/`assignPerson`/`confirmSeat`) rather than a parallel path, which is why a manual placement always leaves a live ask the autonomous tier then refuses to fight. (The "broadcast" verb is C2.4-2's problem, not this sentence's) |
| Fork resolved: "**contested seat → first-acceptable-yes-wins** for rollout; **best-by-score** is a knob to flip once reliability data is trusted" | `SPEC.md:805-807` | Accurate and still the shipped policy. DEC-007 states it; DEC-061 confirms it survives auto-confirm and explains why the flip stays cheap — *"the CAS claim already locks the first yes **before** any confirm step; the claim policy, not the confirm step, is the knob to change."* `recordResponse`'s CAS claim is the mechanism (`ask-loop.ts:313`) |
| Data read: "the **shift + seat states** (§1.1), the **escalation/tier activity** (§1.2), the **eligible pool** from the oracle (§1.3)… **roster** detail (§2.1). Writes seat-state changes back through the machine." | `SPEC.md:815-817` | Every read is real and sourced where claimed: shift/seats `repo.getShift` + `listSeatsForShift` (`assignment-view.ts:134-139`), tier activity `listAsksForSeat` → `statusFromAsks` (`:190-205`), pool `eligiblePool`/`rankedEligible` (`ask-loop.ts:177-194`), roster `listCrewMembers` (`shift-cockpit.tsx:123-138`). Writes go through the domain rails only — every action delegates to `@core` and the page never writes a seat directly (`actions.ts:27-31`: *"auth + glue over the domain rails; the rules live in `@core`"*). Only the "+ reasons" half of the §1.4 clause fails — C2.4-10 |
| "**Manual override of the automation** — see open question on whether it implicitly pauses the bots" | `SPEC.md:824` | Correct as a cross-reference — it points at the open question rather than asserting a behavior, so it is not itself wrong. It inherits C2.4-5's staleness (the question is answered) but needs no separate edit beyond that one |
| Seat sub-state vocabulary — **Open · Asked · Claimed · Confirmed · Bailed** | `SPEC.md:781-783` | Exactly the five `Seat["state"]` values the VM and the UI carry (`seat-card.tsx:39`, `STATE_TONE` `:45-51`). The occupant-zone rendering matches the spec's parentheticals: Claimed shows "accepted — awaiting your confirm", Confirmed shows name + **one-tap contact** (`tel:`/`sms:` at `:94-106` — the spec's "name + one-tap contact", shipped literally) |
| Candidate ask-status vocabulary — "**available · asked · in (+reply time) · declined · silent (asked, timed out)**" | `SPEC.md:787-788` | Five-for-five against `CandidateAskStatus` (`assignment-view.ts:33-40`), including "**+reply time**" — `replyMs` is computed from `respondedAt − sentAt` (`:105-114`) and rendered as "replied in 4m" (`cockpit-bits.tsx:39-40,47-50`). The shipped set has a **sixth**, `bailed`, added by DEC-019/#3.3 for context rows on a legacy Bailed seat (`:238-247`) — an addition, not a contradiction |
| Overall badge "(Filling / Crewed / At-Risk)" | `SPEC.md:778-779` | The three named states are the three that get a tone (`cockpit-bits.tsx:73-77`); anything else (`Pending`, `Cancelled`, `Completed`) falls through to neutral ink rather than being hidden or crashing (`:80`). Consistent with DEC-042's neutral-ink guardrail on the board. `AtRisk` is display-mapped to "At-Risk" (`:85`) |
| The cockpit is **one component with two hosts**, not two implementations | DEC-085 / `SPEC.md:761-763` implied | Verified: `ShiftCockpit` is rendered by `app/(admin)/admin/shift/[shiftId]/page.tsx:44` (`ctx={null}`) and by the board's right pane at `app/(admin)/admin/shifts/page.tsx:533` (`ctx=<filter query string>`), with `ctx` riding every action form so the redirect lands back in the correct host (`actions.ts:48-58`, `cockpitHref`). Heading level tracks the **breakpoint**, not the host, so AT sees exactly one `h1` at 375px (`shift-cockpit.tsx:225-241`). This is the surface-boundary C2.3's last NOISE row flagged, seen from the §2.4 side |
| "Only legally fillable people appear" is never **violated** (as distinct from under-described) | `SPEC.md:786` | The pool is strictly narrower than the doc's list, never wider — see C2.4-15. DEC-129's on-shift suppression is deliberately kept **out** of `rankedEligible` (*"a send-time filter, deliberately in `asks/` not `oracle/`… `rankedEligible` is untouched wholesale (it feeds the operator's manual-lean list)"*), so the operator's list is not silently thinned by an engine-only policy — the correct layering, and the reason it isn't another omission |
| Feedback/error copy is **codes-in-params, never prose** (DEC-026) | design invariant behind §2.4's actions | Held throughout: `ACT_ERROR_COPY` maps 14 codes to copy page-side (`shift-cockpit.tsx:48-65`) and success params carry **ids** resolved to names through the loaded roster, so *"a crafted URL with an unknown id renders nothing"* (`:189-200`). Every action returns `act_error=<code>` (`actions.ts:142,164,206-211,…`) |

---

## Mockup mapping (for the deferred `DESIGN-REFERENCE.md` index rebuild)

Per the ~10-minute cap; **not** written into `DESIGN-REFERENCE.md`.

**Belongs to §2.4 Assignment View:**

- `shiftdetail.jsx` → the detail pane. C2.3 flagged it as *"indexed under Shift builder, but the
  reconciliation compares it against the §2.4 cockpit"* — this shard confirms the §2.4 reading is the
  right one **and** that "either/or" is the wrong frame: DEC-085 made the board's right pane and the
  standalone cockpit **one component** (`ShiftCockpit`, two hosts), so the file maps to a surface that
  belongs to both sections. Index it under §2.4 with a §2.3 cross-reference.
- `Assignment View.html` (if present) → the rendered desktop cockpit. Not separately re-derived —
  C2.1-12 already logged that **all 11 rendered `.html` surface mockups are missing from the index**.

No §2.4-specific reconciliation document exists (`BUILDER-RECONCILIATION.md` is §2.3's). The nearest
equivalent is DEC-027 itself, which reads as an adopt-vs-defer punch-list for this section and is the
single most useful document for anyone rebuilding the index entry.

---

## Coverage — what this shard did and did not read

- **Read in full:** `SPEC.md:759–847`; `app/(admin)/admin/shift/[shiftId]/page.tsx` + `actions.ts`;
  `components/assignment/{shift-cockpit,seat-card,candidate-row,cockpit-bits,warming-panel}.tsx`;
  `src/asks/assignment-view.ts`; DEC-027 (incl. the Unit-C amendment), DEC-061, DEC-128, DEC-129,
  DEC-063 decision body, DEC-065, DEC-066, DEC-007.
- **Read in part / targeted:** `src/asks/ask-loop.ts` (`rankedEligible`, `broadcastAsk`, `assignPerson`,
  `bail`, `recordResponseAndConfirm`, `resolveProtocol` — ~200 of 800 lines), `src/oracle/eligibility.ts:1–90`,
  `src/oracle/reliability-score.ts:117–252`, `src/admin/at-risk-board.ts:240–290`,
  `src/builder/derive.ts` (the two deadline/horizon functions + `FILL_DEADLINE_HOURS`),
  `src/builder/tick.ts` (drip/blast call sites only), `src/asks/{lean,escalate}.ts` (call sites),
  `app/(admin)/admin/{page.tsx,actions.ts}` (engine pause), `app/(admin)/admin/at-risk/page.tsx` (links),
  `components/assignment/{shift-manifest,bits,manning-section}.tsx`.
- **Test-name-verified, not read line by line:** all 16 `it(...)` in `src/asks/assignment-view.test.ts`
  and the `test(...)` inventory of eight cockpit-adjacent e2e specs. Assertions were not read; every
  "tested at" citation names a test whose *name* states the behavior.
- **Not read:** `tick.ts` body beyond the two ask call sites, `warming.ts` body (its DEC-027 §3 contract
  + the VM mapping only), `reliability-score.ts` scoring internals, the `escalate`/`lean` bodies,
  `src/asks/suppression.ts` (DEC-129 — noted as deliberately out of the operator pool, not audited),
  `SPEC.md` §1.2/§1.3/§1.4/§2.5/§2.6 beyond the cross-references §2.4 makes, and the
  `feature/reservations` tree (§2.4 confirmed byte-identical — see the which-tree check).
- **Explicitly not cited as evidence:** `components/assignment/manning-section.tsx` (zero callers,
  known dead — lesson 12).

## Cost

**~90k subagent tokens**, against the brief's ~95–120k. In the C2.3 band and for the same reason: the
surface is shipped, so nearly every claim resolved by reading one module that cites §2.4 back at itself.
**The transferable observation for C2.5–C2.7 is different from C2.3's, though.** C2.3's cost driver was
whether the code had a surface; **this shard's finding density was driven by how many DECs amended the
section after it was written.** §2.4 collects five (DEC-027, -061, -063, -065, -128) and four never
returned to the doc — 15 findings from 89 lines, the highest rate of any C2 sub-shard. A cheap
pre-flight for the remaining sections: `grep -n "Amends SPEC §2.x\|SPEC §2.x" docs/DECISIONS.md` before
reading any code. Every hit is a doc edit that may or may not have happened, and the DEC tells you
exactly what to check.
