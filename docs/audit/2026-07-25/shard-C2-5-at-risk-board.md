# Shard C2.5 — At-Risk Board

**Subject:** `docs/SPEC.md` lines **848–932** — all of `## 2.5 At-Risk Board`: the source block-quote,
Purpose & design stance, What lands on the board, Urgency model, Triage from the list, The decision
surface, Data read, Edge cases, and the 6 acceptance criteria.

**Audited tree:** `main` @ `f401e9c` (branch `task/audit-c2-4-to-c2-7`).

> **Which-tree check (lesson 4) — re-run for §2.5, per range, not per file.**
> `git diff main origin/feature/reservations -- docs/SPEC.md` = **13 hunks**. Their `main`-side spans
> are `116–124`, `236–320`, `498–504`, `516–524`, `540–545`, `566–573`, `606–616`, `644–669`,
> `684–706`, `720–737`, `744–758`, `1177–1186`, `1215–1225`. **None touches 848–932** — the nearest
> above ends at 758, the nearest below starts at 1177. §2.5 is byte-identical on both trees, so a
> `main` sweep is complete for this subject. (Note the hunk set is *larger* than C2.3 reported —
> that shard saw 10 hunks; `feature/reservations` has moved since. The range check must be re-run
> per sub-shard, never inherited.)

**Live-evidence check (lesson 12).** Every component cited below was grepped for callers, not merely
found on disk:
- `RiskRow` / `components/at-risk/risk-row.tsx` — **mounted**: imported at
  `app/(admin)/admin/at-risk/page.tsx:5`, rendered at `:156`.
- `deriveAtRiskBoard` — **two live callers**: the page (`page.tsx:57`) and the engine tick
  (`src/builder/tick.ts:27,380`). Membership is single-sourced, as DEC-026 requires.
- `leanOn` (`app/(admin)/admin/at-risk/actions.ts:20`) — **mounted**: the per-person form action at
  `risk-row.tsx:151`.
- `forwardBoardAlerts` — **wired to prod**: `app/lib/alert.ts:16` ← `app/api/cron/tick/route.ts:64`.
- `EmptySuccess` — local to `page.tsx:151,251`. **Mounted.**
- The two **disabled** Reschedule/Cancel buttons (`risk-row.tsx:169–182`) render but are inert by
  design (DEC-026 §3); counted as shipped *copy*, not shipped *capability*.

**Evidence read.** `src/admin/at-risk-board.ts` (full) + the `it(...)` inventory of
`at-risk-board.test.ts` (28 tests). `app/(admin)/admin/at-risk/page.tsx` + `actions.ts` (full).
`components/at-risk/risk-row.tsx` (full). `src/adapters/forward-board-alerts.ts` (full),
`app/lib/alert.ts` (full), `app/api/cron/tick/route.ts:60–70`, `src/builder/tick.ts:60–95, 360–390`.
`src/builder/derive.ts:330–360, 600–635` (`FILL_DEADLINE_HOURS`, `resolveShiftState`).
`src/oracle/eligibility.ts:40–50, 170–190`. `src/domain/entities.ts:88–106`.
`components/admin/admin-nav.tsx`, `app/(crew)/crew/auth/route.ts:130–140`. `e2e/board-nudge.spec.ts`.
`docs/DECISIONS.md` — DEC-019, DEC-022, DEC-023, DEC-024, DEC-025, DEC-026, DEC-031, DEC-038,
DEC-054, DEC-065, DEC-066, DEC-095, DEC-115. `docs/BRAND.md:10–20, 67`,
`docs/USER_STORIES.md:43–49`, `docs/design/DESIGN-REFERENCE.md:81–121`, `docs/SPEC.md` §1.1 / §2.1
edge cases / §2.4 / §3.1 / §3.3 / §4.

---

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| C2.5-1 | `SPEC.md:921-922` (AC-1) | "A shift appears on the board **only after Tiers 1–2 exhaust** (or a regression/credential-lapse occurs) — **not while still being actively worked**." | **Contradicted by the section's own body, 47 lines above it.** `SPEC.md:874-877` already carries the DEC-065 reconciliation — "Inside the deadline it boards **regardless of in-flight asks** (DEC-065)… a nudge no longer hides it" — and `:866-867` repeats it. AC-1 was left at the pre-DEC-065 rule. Code: route (b) boards a still-`Filling` shift on `gapSeats.length > 0 && hoursToTrip <= deadlineHours` with **no ask-state term** (`at-risk-board.ts:259-269`; the comment at `:266-267` names the deleted gate: "the `asked > 0 && pending === 0` willingness gate is gone"). DEC-065 (`DECISIONS.md:1720-1726`) is explicit that this **supersedes** "the §2.5 board copy rationale". Pinned by three tests — `at-risk-board.test.ts:176` *"boards an uncrewed shift even with a live ask in flight (DEC-065 — no hide-while-working)"*, `:209` *"boards a never-asked uncrewed shift inside the threshold (DEC-065 — visible before the engine even asks)"* — and one e2e, `e2e/board-nudge.spec.ts:16` *"nudging a candidate keeps the near-term row on the board (DEC-065)"*. The **operator-reported bug DEC-065 fixed is the exact behavior AC-1 still specifies** | MISMATCH | doc-wrong |
| C2.5-2 | `SPEC.md:865-867` | "(a) eligibility-exhausted (nobody left to ask — **boards however far out**)" | **False past the staffing horizon.** Route (a) fires only on `resolvedState === "AtRisk"` (`at-risk-board.ts:257-258`), and `resolveShiftState` returns **`Pending`** for any shift before its horizon *whatever the pool says* — `if (ctx.now < ctx.horizon) return "Pending"` precedes the `poolExhausted` branch (`derive.ts:626-630`), per DEC-022 "crew rules abstain before the horizon". So a trip 3 weeks out that **nobody on the roster may legally crew** is invisible until `STAFFING_HORIZON_LEAD_DAYS` (default 7). Pinned as intended by `at-risk-board.test.ts:254` *"does NOT board a pre-horizon shift — crew rules abstain before the horizon"* (its comment: "the shift resolves Pending **even though its pool is empty today**"). **The module's own doc repeats the doc's error** — `at-risk-board.ts:16-18` "summoned immediately, **however far out the trip is**" — so this is not only a SPEC clause. The `regression` route genuinely *is* horizon-free (`:271`, unconditional), which is what makes the core route's bound legible as unstated rather than intended-and-documented | CODE-CONTRADICTS | **decision** |
| C2.5-3 | `SPEC.md:928` (AC-5) + `:896-905` | "Cancel triggers the **cancel-cascade (§3)** across every booking on the shift, not a silent delete." / "Make the three real options **first-class** — especially the painful ones" | **Two of the three options do not exist, deliberately, and §2.5 is the only doc that doesn't say so.** `risk-row.tsx:169-182` renders Reschedule and Cancel `disabled` with the honest title "customer-side cancellation cascades land with payments (parked, P3)", plus a standing line "Handle reschedule/cancel by phone for now" (`:191-193`). DEC-026 §3 (`DECISIONS.md:889-894`): "**Reschedule/cancel render disabled** … the cancel-cascade AC (§2.5) is **explicitly deferred to the payments phase** (P3 scoping, Drew)". Nothing implements it: `grep -rn 'cancelShift\|cancelCascade\|refund' src/ app/` over non-test source returns **one hit, a comment** (`doorbell-decider.ts:8`). `USER_STORIES.md:48-49` SP-13 carries the marker — "*(cancel cascade is 2027 / parked)*" — and so does the shipped UI; SPEC §2.5 does not. §3.3 (`:1130-1132`) also still states the AC as in-scope | MISMATCH | doc-wrong |
| C2.5-4 | `SPEC.md:913-914` (edge case) | "**Regression channel** — given the 11pm timing, a regression may warrant a **louder channel than a normal in-app ping** (e.g. SMS to Eric). *(Open, §3 notifications.)*" | **Answered, and by removing the question's premise.** DEC-095 ships the delivery half of DEC-026 as **SMS to every active admin for every landing** — one composed body, one `admin_alert` kind, no per-reason routing (`forward-board-alerts.ts:89-129`; the reason only picks a label string, `:45-49`), fired from `tick.boardLandings` (`tick.ts:380-388`) via `app/lib/alert.ts:16` ← `app/api/cron/tick/route.ts:64`. There **is no "normal in-app ping"** to be louder than — the board itself is the only non-SMS surface (`alert.ts:11` "`/admin/at-risk` is the standing surface"). Same claim, same staleness, at `SPEC.md:1074` (§3.1, outside the range): "**Regression ping** → possibly a **louder channel** (SMS)… *(Open — §3 below.)*" — the C2.3-3 shape, one clause outside the section restating the section's dead one. Also worth carrying: `SPEC.md:1072` says the ping goes "to Eric"; recipients are **all active admins** (`listActiveAdminRecipients`, `forward-board-alerts.ts:35-43`), deliberately not the `OPERATOR_CREW_MEMBER_ID` singleton (#293) | MISMATCH | doc-wrong |
| C2.5-5 | `SPEC.md:918` (edge case) + `SPEC.md:1231` (§4 Tuning knobs) | "**'Exhausted' threshold** — **how many declines** / how close to horizon before a shift lands here is tunable; keep it high. *(Open, don't agonize.)*" | Answered on both halves, and one half was **deleted rather than tuned**. (i) The "how close" half is settled and bound: `EXHAUSTED_THRESHOLD_HOURS = FILL_DEADLINE_HOURS` (`at-risk-board.ts:97`) — one constant so the rendered deadline **is** the boarding instant (DEC-031, `DECISIONS.md:1077`), env-overridable as `FILL_DEADLINE_HOURS`, default 48 (`derive.ts:349`, DEC-115), pinned by `at-risk-board.test.ts:320` *"binds the displayed deadline to the boarding instant"* and `:197` *"boards at exactly the threshold — the deadline bound is inclusive"*. (ii) The "**how many declines**" half no longer exists at any value: DEC-065 removed decline/ask counts from membership entirely — the board boards a **never-asked** shift (`at-risk-board.test.ts:209`). §4's Tuning-knobs row at `:1231` parks the same resolved question | MISMATCH | doc-wrong |
| C2.5-6 | `SPEC.md:880-882` | Urgency = "time to trip · **severity of gap** (missing a **captain** — small, fickle pool — outranks a **mate**…) · **fillability** (how thin the remaining pool is)" | Three listed terms; **two of them are one term in code, and the role-name ordering is explicitly rejected**. DEC-025 (`DECISIONS.md:835-845`): "expressed as fillability/pool-thinness … **never with the seat's role name**. The spec's own rationale for captain-outranks-mate *is* the small pool — thinness is the cause, the role name only its BrewBoat-shaped shadow." Code agrees and says so: `at-risk-board.ts:50-52` ("expressed ONLY as pool-thinness … never a role-name check"), the blend is `timeTerm + thinnessTerm + regressionTerm` (`:334-341`) with no role branch anywhere in the module. So a missing **mate** with two candidates outranks a missing **captain** with six — the literal reading of `:881` is false. Pinned by `at-risk-board.test.ts:433` *"thinner pool beats deeper pool at the same time-to-trip — DEC-025: thinness, not role names"*. The spec is right in **spirit** (it supplies DEC-025's own rationale) and wrong in **letter and arity** | MISMATCH (partial) | doc-wrong |
| C2.5-7 | `SPEC.md:859-860` | "**Push, not pull.** A shift reaching the board **pings Eric**; he goes there *when summoned*, **he does not monitor it**." | The push half is real and shipped (DEC-026 detection + DEC-095 delivery — see C2.5-4). The "**does not monitor it**" half is not what shipped: `/admin/at-risk` is the **admin post-login landing page** (`app/(crew)/crew/auth/route.ts:134` — `subject.kind === "admin" ? "/admin/at-risk" : crewLanding(thread)`), a **standing nav item** (`components/admin/admin-nav.tsx:23`), the **redirect target of four other actions** (`shift/[shiftId]/actions.ts:72,350,355`), and the code's own words for it are "**the standing surface**" (`app/lib/alert.ts:11`). Six e2e specs annotate the sign-in step "// lands on /admin/at-risk". Defensible — the empty state renders as success (`page.tsx:251-271`), so monitoring it costs nothing — but the shipped posture is **push *and* pull**, and the spec asserts the absolute | MISMATCH | doc-wrong |
| C2.5-8 | `risk-row.tsx:146-148` vs `SPEC.md:892` | UI: "**nobody left in the eligible pool — this is the reschedule / cancel**" / SPEC: "Who's still **theoretically available** (if anyone) for a manual lean" | **The board tells the operator to cancel in a case DEC-066 says to override.** `available` comes from `rankedEligible` (`at-risk-board.ts:322`), which since DEC-066 drops **over-ranked** crew — a captain is never offered for a mate seat. But the **oracle still counts a captain as able to crew a mate seat**, so `trail.exhausted` stays `false` (DEC-066: "satisfiability/exhaustion … unchanged"). Result on a mate seat whose only remaining candidates are captains: the flag reads "Lacking crew · **no takers**" (`page.tsx:187-189`) while the availability line reads "**nobody left in the eligible pool — this is the reschedule / cancel**" — and reschedule/cancel are both disabled buttons (C2.5-3). DEC-066's own text names the right move: "it surfaces on the board within 48h (DEC-065) for the operator to **override a captain in** — acceptable and rare." That path exists (the §2.4 cockpit's `manualOverride`, DEC-064/027) and the row's only pointer to it is an unlabelled "Assignment ↗" link. SPEC's "**theoretically** available" is precisely what the list is **not** — it is the *leanable* set, one narrower notion. Low frequency, but the wrong instruction at the 11pm decision | CODE-CONTRADICTS | code-wrong (copy, low-med) |
| C2.5-9 | `SPEC.md:871-872` | "**Credential lapse on assigned crew** — an assigned person's **MMC/medical/TWIC** will expire before the trip date, invalidating the assignment." | **Only MMC is checked.** The scan calls `mmcValidOnDate` (`at-risk-board.ts:281`), which filters to `HARD_CREDENTIAL_TYPES` — and that list is `["MMC"]`, one element (`eligibility.ts:43`). `medical`, `TWIC` and `drug_consortium` are all modeled credential types (`entities.ts:91-96`) that **can never board a shift**. The board UI then generalizes back up: the row line reads "*{name}*'s **credential** lapses before the trip" (`page.tsx:206`) and the flag "**Credential lapse**" (`:185`) — broader words than the check behind them. Consistent with the oracle (one boundary, DEC-032, correctly shared), so this is a **scope-of-claim** question, not a divergence between two code paths. Tested only for MMC (`at-risk-board.test.ts:276,287`) | MISMATCH | **decision** |
| C2.5-10 | `SPEC.md:864-877` — the **absence** of a status-lapse reason | (§2.5 enumerates exactly three things that land: uncrewed, regression, credential lapse) | **Escalated as a question, not a defect (lesson 7); §2.5's silence is recorded rather than converted into a claim.** `deriveAtRiskBoard` reads **no** crew `active` flag anywhere in the module — the only person-level scan is MMC (`:276-285`). So a `Confirmed` seat held by a crew member deactivated *after* confirming boards nothing and reopens nothing. `grep -rn 'deactivat\|active: false' src/ app/` over non-test source hits **only the `admins` table** (`admin-cli.ts:104-126`) and the crew login gate (`switch-actions.ts:31`, `dev-link/route.ts:46`) — no seat path. SPEC **§2.1** does make the claim, at `:470-472`: "**Deactivation while assigned to a future shift.** Deactivating must surface the affected future assignments (don't silently strand a shift); **those seats reopen.**" Nothing does. This is **C2.1-8 / AC-7 unchanged** — still open with the operator. §2.5 is correctly silent (it claims no coverage it doesn't have); the asymmetry lives between §2.1's edge case and the code | MISMATCH (carried, C2.1-8) | **decision** |
| C2.5-11 | `SPEC.md:908-909` | "**Data read** — Reads **shifts in At-Risk (and regressed) state** (§1.1), the escalation log (§1.2), roster + credential data (§2.1)." | Describes reading a **stored badge**, which is the one thing DEC-023's corollary forbids a display surface from doing. The deriver reads **every** shift, skipping only the two lifecycle terminals, and **re-resolves state itself**: `for (const shift of await repo.listShifts())` … `if (shift.state === "Cancelled" \|\| shift.state === "Completed") continue` (`at-risk-board.ts:210-212`), then `resolveShiftState(...)` at `:244-248`. Its own header states the rule (`:6-10`: "membership is **recomputed on read** … never trust the badge"). Consequence the doc's phrasing hides: **`Crewed` shifts are scanned too** — deliberately, since "the headline case is precisely the boat that looks fine" (`:38-39`), tested at `at-risk-board.test.ts:287` *"flags a fully-Crewed shift whose confirmed captain's MMC lapses before the trip"*. A shift in stored `At-Risk` state is neither necessary nor sufficient for a row | MISMATCH | doc-wrong |
| C2.5-12 | `SPEC.md:857-858` | "**Empty is success.** If Tiers 1–2 are working, nothing lands here. An empty board is the system doing its job, **not a reminder Eric forgot to check**." | True **only while the engine is running**, and the shipped page says so where the spec doesn't. DEC-054's operator pause makes an empty board a lie, and `page.tsx:117-126` renders a warn banner naming it: "Engine paused — the automation isn't firing asks. **An empty board here means the engine is muted, not that every shift is covered.**" The code comment is blunter (`:69-70`: "an empty board below is a **MUTED** engine, not success — say so loudly"). §2.5 carries no caveat, so the doc states unconditionally the thing the UI exists to contradict. Doc-incomplete rather than doc-wrong: the shipped behavior is *better* than the spec, and the spec predates DEC-054 | MISMATCH (incomplete) | doc-wrong |

---

## Per-acceptance-criterion verdicts

The six `- [ ]` boxes at `SPEC.md:921–929`, ticked against source for the first time.

### AC-1 — "A shift appears on the board only after Tiers 1–2 exhaust (or a regression/credential-lapse occurs) — not while still being actively worked." — **NOT MET AS WRITTEN — deliberately superseded (DEC-065)**
This is C2.5-1 and it is the shard's headline. Membership has **four** entries, not the AC's two:
route (a) eligibility-exhaustion (`at-risk-board.ts:257-258`), route (b) **imminence regardless of
ask state** (`:259-269`), regression (`:271`), credential lapse (`:285`). Route (b) is exactly what
AC-1 forbids. Implementing function: `deriveAtRiskBoard`. Tests that pin the *opposite* of the AC:
`at-risk-board.test.ts:176` (*live ask in flight*), `:209` (*never-asked*), `:220` (*a Claimed seat
is not a gap — `gapSeats` is the sole guard now*), and `e2e/board-nudge.spec.ts:16` end-to-end. The
correct replacement clause is already written 47 lines above it at `SPEC.md:874-877`; AC-1 just
never received it. **Not a defect — a doc edit that stopped early** (lesson 11).
*Sub-clause that IS met:* the "still actively worked" exclusion survives **beyond** the deadline —
`at-risk-board.test.ts:188` *"does NOT board a still-Filling shift whose trip is still far out"*.

### AC-2 — "Regressions render with a distinct flag and sort above never-filled at-risk shifts of similar time-to-trip." — **MET**
Detection: `if (required.some((s) => s.state === "Bailed")) reasons.push("regression")`
(`at-risk-board.ts:271`), horizon-free by design (`:28-34`, DEC-019 makes a resting-`Bailed` seat
reachable only through an exhausted re-ask, so "can't auto-refill" is true by construction).
Sort: a flat `REGRESSION_URGENCY = 72` hours-equivalent constant (`:105`, `:338-340`) — chosen so a
regression outranks never-filled rows *up to three days closer to their trip* without burying an
imminent one. Flag: `{ label: "Lacking crew · late bail", tone: "bad" }` — the **only** `bad`-toned
row and the only one taking the red rail (`page.tsx:182-183`, `risk-row.tsx:42-45, 81`), plus a
count pill in the header ("N late bails", `page.tsx:108-112`). Tests, and both halves of the AC:
`at-risk-board.test.ts:264` *"flags a rested-Bailed seat as regression (and core, via resolved
AtRisk)"*, `:403` *"regression beats a never-filled shift at similar time-to-trip"*, `:417` *"a
regression days out does NOT bury a trip leaving in hours"* — the boundedness DEC-025 asked for,
asserted ordinally so the weights stay tunable.
*Note, not a caveat:* the operator-facing word is "**late bail**", never "regression"
(`page.tsx:178-181` — "operator words, not dev words"). The AC says "distinct flag", not "this word".

### AC-3 — "Each row shows what's missing, time to trip, and the escalation trail — enough to triage without opening it." — **MET**
All three, plus two the AC doesn't ask for. *What's missing*: `roleGaps` folds gap seats into
per-role counts (`at-risk-board.ts:182-186`) rendered as pills, "1 captain" / "1 mate"
(`risk-row.tsx:112-126`). *Time to trip*: `hoursToTrip` (`:235-238`) → `ttLabel`
(`page.tsx:244-249`), reddening inside 36h (`TIGHT_HOURS`, `page.tsx:27` — a **UI-only** constant
explicitly *not* the membership threshold, `:24-26`). *Trail*: `escalationTrailFor` (DEC-024) →
`TrailLine` (`risk-row.tsx:47-75`), which renders `SPEC.md:890-891`'s example line almost verbatim
— asked / declined / silent / awaiting reply / pool widened / nudged *names* / exhausted — and
falls back to "no one eligible to ask" on an empty trail (`:64-66`), the honest zero. Extras: every
scheduled departure, not just the first (`tripStarts`, `at-risk-board.ts:141-146`, pinned by
`at-risk-board.test.ts:346`), and the lapsed-credential lines (`risk-row.tsx:127-131`).
**`SPEC.md:887-889`'s DEC-038 clause verified in code:** the fills-by deadline is computed
(`fillsBy`, `at-risk-board.ts:154`) and **deliberately not rendered** — `RiskRowVM` has no `fillsBy`
field at all (`risk-row.tsx:14-40`). Doc and code agree; the AC is met and the parenthetical is
accurate.

### AC-4 — "An empty board renders as a success state, and the board does not show 'warming' shifts." — **MET, with the caveat the spec omits (C2.5-12)**
*Empty as success*: `EmptySuccess` (`page.tsx:251-271`) — an ok-toned card, a check glyph, "Nothing
needs you right now", and copy that restates the stance ("An empty board is the system doing its
job — **not a reminder to go check something**"), plus a header line that reads "Right now, none."
(`:99`). Rendered on `vms.length === 0` (`:151`).
*No warming*: structurally impossible, not merely absent — a row exists **only** if `reasons` is
non-empty (`at-risk-board.ts:287`), and the three reasons are all "already broken", never
"trending". Pinned by `at-risk-board.test.ts:188` (*still-Filling, far out → no row*), `:254`
(*pre-horizon → no row*), `:301` (*"does NOT board a healthy fully-Crewed shift"*). Warming lives
where §2.5 says it does — the §2.4 monitor posture, `SPEC.md:772-773`, "explicitly **does not** live
on the At-Risk board".
*Dependency that keeps this from being hollow:* "empty" is only honest while the engine ticks. DEC-054
lets the operator pause it, and the page must (and does) say so — `page.tsx:117-126`. The AC as
written would be **passed by a dead cron**; the shipped banner is what makes it true. §2.5 doesn't
mention this (C2.5-12).

### AC-5 — "Cancel triggers the cancel-cascade (§3) across every booking on the shift, not a silent delete." — **NOT MET — deferred on the record (DEC-026 §3), no code exists**
No implementing function. `grep -rn 'cancelShift\|cancelCascade\|refund' src/ app/` over non-test
source returns **one comment** (`doorbell-decider.ts:8`) and no callable. No test pins it. The
surface is an inert button with honest hover copy (`risk-row.tsx:176-182`) and a standing line
"Handle reschedule/cancel by phone for now" (`:191-193`). DEC-026 §3 makes this the *decided*
position — "a **live** cancel without its cascade would violate 'cancel is never delete' far worse
than a disabled button" — and the §3.3 flow it depends on is gated on the payments phase. **The
finding is not the gap; it is that §2.5 alone doesn't say the gap is intentional** (C2.5-3), while
`USER_STORIES.md:48-49` and the UI both do. Reschedule is in the same state, and §2.5's "Make the
three real options **first-class**" (`:897`) describes one shipped option out of three.

### AC-6 — "Clicking a row opens that shift's assignment view (§2.4)." — **PARTIALLY MET (the destination is right; the affordance is a link, not the row)**
The `<article>` is not clickable and carries no row-level handler (`risk-row.tsx:80-197`). The
navigation is a footer `AppLink` — `href={/admin/shift/${row.shiftId}}`, labelled "Assignment ↗"
(`:184-189`). Destination correct and **fully built**: `/admin/shift/[shiftId]` is the real §2.4
cockpit (C2.3 evidence: `shift/[shiftId]/actions.ts:13-16`), not the "thin read-only render"
DEC-026 §3 promised as the v1 — that promise was overtaken by delivery. Functionally the operator
gets there in one tap; literally "clicking a row" is not what happens, and the row contains **other**
click targets (per-person Nudge forms) that a whole-row link would have to fight. **No e2e covers
the navigation** — `grep -rn 'Assignment' e2e/` is empty; the only board e2e is the nudge path.
That untested edge is the reason this reads PARTIALLY rather than MET-with-wording-nit.

---

## What this shard would recommend

**The headline is C2.5-1, and it is lesson 11 recurring in a section that already learned it.**
§2.5's *body* was reconciled to DEC-065 — twice, at `:866-867` and `:874-877`, both times naming the
DEC — while **AC-1 was left specifying the pre-DEC-065 rule**. That rule is not merely stale: it is
the exact behavior an operator reported as a bug ("a 2-days-out shift with no crew was invisible
because asks were in flight, and nudging a candidate **removed the shift from the board**", DEC-065).
So SPEC §2.5's acceptance criterion currently reads as a specification of the defect, sitting
beneath prose that describes the fix, above three unit tests and one e2e that assert the fix. Anyone
verifying the board against its own ACs would mark the shipped, correct behavior as a failure. The
edit is one clause and DEC-065 supplies the words.

**Four resolved-or-superseded clauses, all one-line edits with a DEC to cite (C2.5-4, -5, -6, -11).**
The two "Open" edge cases are both closed — the regression-channel question by DEC-095 answering it
uniformly (everything SMSes, so there is no quieter channel to be louder than), and the exhausted
threshold by DEC-031 binding it to `FILL_DEADLINE_HOURS` while DEC-065 **deleted** its
how-many-declines half outright. Each has a twin outside the range restating the same dead claim
(`:1074` in §3.1, `:1231` in §4 Tuning knobs) — the C2.3-3 pattern, worth fixing in the same pass.
The urgency model lists three terms where DEC-025 collapsed two, and "Data read" describes trusting
a stored badge that DEC-023's corollary forbids.

**Two questions for the operator, and neither is a bug report.**

1. **C2.5-2 — should eligibility-exhaustion really respect the staffing horizon?** Today a trip
   three weeks out that **nobody may legally crew** shows nothing, for two weeks, because
   `resolveShiftState` returns `Pending` before the horizon regardless of pool (`derive.ts:626-630`,
   DEC-022). SPEC says "boards however far out"; so does the module's own doc comment
   (`at-risk-board.ts:16-18`). A regression *does* board pre-horizon, so the two routes differ and
   nothing says why. Two coherent answers: **(a)** "abstain means abstain — a 3-weeks-out hole is
   not tonight's problem, and the horizon will surface it" → fix both doc lines, note the bound in
   the AC; **(b)** "no, an unfillable trip should summon me the day it becomes unfillable" → a real
   code change (route (a) reads `poolExhausted` directly rather than through `resolveShiftState`),
   and a new anxiety-dashboard exposure to weigh. **Do not close this by editing only SPEC** — the
   code comment asserts the same false thing, so a doc-only fix leaves the next reader misled by the
   source.
2. **C2.5-9 — is MMC-only the intended credential gate?** SPEC promises "MMC/**medical/TWIC**";
   `HARD_CREDENTIAL_TYPES = ["MMC"]` (`eligibility.ts:43`). The name says the scoping is deliberate,
   and widening it would change the **oracle's** eligibility gate too (one shared boundary, DEC-032)
   — i.e. this is not a board question, it's a "does an expired TWIC stop someone crewing" question,
   which is domain knowledge no amount of code-reading produces (lesson 7). If the answer is
   "MMC is the only one that legally grounds someone", trim §2.5's list and the board's generic
   "credential" copy (`page.tsx:185,206`) to say MMC.

**One code item, low-to-medium (C2.5-8).** When a mate seat's only remaining candidates are
captains, DEC-066 drops them from `rankedEligible`, so `available` is empty and the row renders
"nobody left in the eligible pool — **this is the reschedule / cancel**" — pointing at two disabled
buttons, while DEC-066's own text says the correct move is to **override a captain in** from the
cockpit. The trail simultaneously reads "no takers", not "none eligible", because the oracle still
counts captains as satisfying a mate seat. One copy string and, ideally, a pointer to the cockpit
override. Rare by construction; wrong at exactly the 11pm moment §2.5 is built for.

**One doc gap that the code already fixed (C2.5-12) and one absolute that shipped as a preference
(C2.5-7).** "Empty is success" needs DEC-054's "…while the engine is running" caveat — the page
already renders it. And "he does not monitor it" is contradicted by the board being the admin
landing page, a nav item, and four actions' redirect target; the shipped posture is push **and**
pull, which is fine, but the spec asserts otherwise and `alert.ts:11` calls it "the standing
surface" in so many words.

**On the anti-anxiety stance, checked as the brief asked: the board holds the line, and the one
place it bends is documented.** `BRAND.md:18-19` and `:67` set the rule ("No anxiety dashboard.
Nothing that invites the operator to sit and watch"); `app/(admin)/admin/shifts/page.tsx:22` books
itself as "a knowing, opt-in exception" to it. §2.5's board is **not** a second exception: the empty
state is a success card rather than a void, warming is structurally unreachable, membership carries
no "trending" reason, and the only always-visible number is a count of things that are already
broken. DEC-065 *did* move the bar — and said so in its own Tradeoff paragraph, "a small move toward
the anxiety-dashboard BRAND/SPEC §2.5 guard against", bounded to 48h and genuinely-uncrewed seats.
That is the discipline working, not drifting. The pull-affordance drift (C2.5-7) is the softer,
undocumented half.

---

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| "The cross-shift **triage worklist** — the shifts the automation couldn't close" | `SPEC.md:850` | Exactly the module's self-description (`at-risk-board.ts:1-2` "which shifts summon Eric, and in what order") and the page's (`page.tsx:14-16`). Cross-shift is literal: the loop is over `repo.listShifts()`, one row per shift, no per-shift entry point |
| "**A shift reaching the board pings Eric**" — the push half | `SPEC.md:859` | Shipped end to end, split exactly as DEC-026 specified: detection in `tick` asking **the same deriver the page renders** (`tick.ts:27,380` — membership single-sourced, never a second hand-rolled check), record as a `board_landed` event **deduped per (shift, reason)** (`tick.ts:374-388`), delivery by DEC-095 SMS (`forward-board-alerts.ts` ← `app/lib/alert.ts` ← `app/api/cron/tick/route.ts:64`). A steady-state board re-blasts nobody (`tick.ts:85-89`) |
| "**Empty state** — rendered as success, not as an error/void" | `SPEC.md:873` | `EmptySuccess`, `page.tsx:251-271` — ok tokens, not neutral-empty and not warn. See AC-4 |
| "**Regressions … rockets to the top** — was solved, now broken, little time" | `SPEC.md:868-870` | `REGRESSION_URGENCY = 72` (`at-risk-board.ts:105`) with the bound stated in its own doc comment. See AC-2 |
| "A shift still being actively worked **and more than the fill deadline (48h)** from its trip does not appear" | `SPEC.md:874-875` | `at-risk-board.ts:259-264` + `at-risk-board.test.ts:188`. The 48h is `FILL_DEADLINE_HOURS`'s **default**, env-overridable (`derive.ts:349`, DEC-115) — the spec naming the default alongside the concept is the house style (cf. the staffing horizon), not drift |
| "**What's missing** — 1 captain / 1 mate / both" | `SPEC.md:886` | `roleGaps` (`at-risk-board.ts:182-186`) → `"{count} {roleName}"` pills (`risk-row.tsx:117-124`). Role **names** come from `listAllRoleTypes` (`page.tsx:173`), never a hardcoded captain/mate pair — DEC-ROLE-1 honored on the render side too |
| **Gap definition** (brief item 2) — "a required seat still **empty**" | `SPEC.md:865` | `gapSeats = required.filter(s => s.state !== "Confirmed" && s.state !== "Claimed")` (`at-risk-board.ts:252-254`), i.e. **required-only** (supernumeraries never gate — DEC-005), and `Claimed` is deliberately **not** a gap ("a yes awaiting confirm, not a hole to fill", `:250-251`), pinned by `at-risk-board.test.ts:220`. `Bailed` **is** a gap *and* separately raises the regression flag (`:271`), so a bailed seat contributes to both the "what's missing" pills and the sort bonus — the spec's two clauses (`:865`, `:868`) compose correctly |
| "Deep work happens in the assignment view (§2.4) — clicking a row drops Eric into that workbench" | `SPEC.md:894` | Destination correct (`risk-row.tsx:184-189` → `/admin/shift/{id}`). The affordance nit is AC-6 |
| "**Lean** — direct nudge to a specific high-value person. **Manual Tier-2**" | `SPEC.md:898` | Shipped and the only live action of the three: `leanOn` (`at-risk/actions.ts:20-52`) over `@core/asks/lean`, per-person form buttons (`risk-row.tsx:151-160`), feedback via redirect codes never prose (`:29-38`, `actions.ts:11-18` — a crafted URL can't inject copy into the operator's trusted UI). DEC-026 §2's semantics hold: bailers and live-ask holders excluded on **both** sides, so the board never offers a name `lean()` would refuse (`at-risk-board.ts:289-310, 167-175`), pinned by `at-risk-board.test.ts:473,487` and `e2e/board-nudge.spec.ts:16` |
| "**Who's still theoretically available** (if anyone) for a manual lean" — the *field* | `SPEC.md:892` | The field exists, is deduped, per-seat-reliability-ordered, and renders as named Nudge buttons (`at-risk-board.ts:318-330`, `risk-row.tsx:150-161`), tested at `:453`. Only the DEC-066 blind spot and the "theoretically" wording are findings (C2.5-8) |
| "**Escalation transparency** — 'asked 6 mates · 4 declined · 2 silent · pool widened · nudged Bob · exhausted'" | `SPEC.md:890-891` | Rendered nearly clause-for-clause under a "System tried" label (`risk-row.tsx:47-75`), sourced from `escalationTrailFor` (DEC-024). See AC-3 |
| Urgency: "Most-urgent at top", "time to trip (sooner = more urgent)" | `SPEC.md:879-882` | `rows.sort((a,b) => b.urgencyScore - a.urgencyScore \|\| shiftId)` (`at-risk-board.ts:364-368`) — the tie-break exists so `listShifts` order can't leak into the render. Time term is **unclamped** so strict monotonicity survives past the cosmetic reference point (`:332-335`). Tested `:395` *"sooner trip beats later trip"* |
| The **credential-lapse scan location** the brief flagged (was cited as `:273–286` from an earlier commit) | brief | **Confirmed at `at-risk-board.ts:273–285`** on `f401e9c` — one line shorter than the brief's figure, same block. Runs over `required` seats on **every** non-lifecycle shift including `Crewed`, on `Claimed`/`Confirmed` occupants only, comparing `creds` against `shift.date` via `mmcValidOnDate` — a **date-only ISO-string** compare, timezone-invariant by construction (DEC-032), the same boundary the oracle gates on. This is the C2.1-10 fix holding: no instant-vs-date fork here |
| `AtRiskReason` union (brief) | brief | **Confirmed `"core" \| "regression" \| "credential_lapse"` at `at-risk-board.ts:119`.** Each is written in exactly one place (`:258`, `:268`, `:271`, `:285`), each is consumed by the UI flag mapper (`page.tsx:182-191`) and the SMS label map (`forward-board-alerts.ts:45-49`), and `reasons.length === 0 → continue` (`:287`) makes the union total for membership. **No derived reason is missing from the doc, and no doc reason lacks a derivation** — the taxonomy is symmetric. The findings against it are about the *conditions* (C2.5-1, -2, -9), not the set |
| **Lifecycle exclusion** — the board is not where cancelled shifts go | `SPEC.md:900-902` (implied) | `Cancelled`/`Completed` skipped outright, "mirrors tick's guard" (`at-risk-board.ts:211-212`), plus the past-trip guard `tripStart <= now` (`:217-221`, #147/DEC-062) so a departed trip never pings. Tested `:310`, `:132` *"a departed shift never boards, even short + willingness-exhausted"*. The module's own header explains what happens to an **event-less** shift (`:43-47`: no horizon, no trip start, neutral time term — "the cancel flow, not this board, is what mops those up") |
| The board is a **pure read** — no writes, no state stored | `SPEC.md:908-910` (Data read, non-write half) | `deriveAtRiskBoard` performs zero writes; landing detection + the `board_landed` record live in `tick`, and the page says so (`page.tsx:16-19`). The one write reachable from the surface is `lean` |
| DESIGN-REFERENCE's §2.5 mockup index | `DESIGN-REFERENCE.md:121` | **Already correct** — `riskapp.jsx`, `riskcards.jsx`, `riskdata.jsx`, `riskmobile.jsx`, `riskmodals.jsx`, rebuilt by shard G (which used this very section as its worked example, `:81-115`). `:89` "Regression flagged distinctly and sorted to the top" matches AC-2. **No mockup-mapping work owed by this shard** |
| `USER_STORIES.md` SP-11/SP-12/SP-13 | `USER_STORIES.md:43-49` | All three accurate against code, and SP-13 is the **only** doc outside DEC-026 that marks the cancel cascade parked ("*(cancel cascade is 2027 / parked)*"). Shard C's SP-6/SP-7 strikes didn't touch these |
| `BRAND.md` anti-anxiety stance vs the board | `BRAND.md:18-19, 67` | Consistent — see the recommendation section. `BRAND.md` remains the cleanest doc in the audit; the drift is in SPEC |

---

## Coverage — what this shard did and did not read

- **Read in full:** `SPEC.md:848–932`; `src/admin/at-risk-board.ts`; `app/(admin)/admin/at-risk/page.tsx`
  and `actions.ts`; `components/at-risk/risk-row.tsx`; `src/adapters/forward-board-alerts.ts`;
  `app/lib/alert.ts`; DEC-025, DEC-026, DEC-031, DEC-065, DEC-066, DEC-095 decision bodies.
- **Read in part / targeted:** `src/builder/tick.ts` (result shape + the board-landing block,
  `:60–95`, `:360–390`), `src/builder/derive.ts` (`FILL_DEADLINE_HOURS` doc + `resolveShiftState`,
  `:330–360`, `:600–635`), `src/oracle/eligibility.ts:40–50, 170–190`, `src/domain/entities.ts:88–106`,
  `app/api/cron/tick/route.ts:60–70`, `components/admin/admin-nav.tsx`,
  `app/(crew)/crew/auth/route.ts:130–140`, `SPEC.md:150–210, 460–475, 760–830, 1060–1080, 1105–1135,
  1225–1235`, `USER_STORIES.md:43–49`, `BRAND.md` (grep-targeted), `DESIGN-REFERENCE.md:81–121`.
- **Test-name-verified, not read line by line:** all 28 `it(...)` names in
  `src/admin/at-risk-board.test.ts` and the one `test(...)` in `e2e/board-nudge.spec.ts`. Assertions
  were not read; every "tested at" citation names a test whose *name* states the behavior. The
  arrange helpers (`addShift`/`addCrew`) were read only where a test's comment was load-bearing
  (`:254`).
- **Not read:** `src/asks/escalation-trail.ts` and `src/asks/lean.ts` bodies (their contracts are
  quoted from DEC-024/DEC-026 and from `at-risk-board.ts`'s own comments), `src/asks/ask-loop.ts`
  (`rankedEligible` taken from DEC-066's description plus the call site), `memoizing-repo.ts` (the
  #316 read-cache — a perf concern, not a §2.5 claim; its behavior is pinned by
  `at-risk-board.test.ts:543`), the `risk*.jsx` mockups, `SPEC.md` §2.4 / §2.6 / §2.7 beyond the
  cross-references named above, and the `feature/reservations` tree (§2.5 confirmed byte-identical —
  see the which-tree check).

## Cost

**~118k subagent tokens** — between C2.3's ~95k and the 150k budget, and the reason is the shape of
the section rather than its length. §2.5 is the **shortest** §2.x section swept so far (85 lines vs
§2.3's 112) and its surface is fully shipped, so no absence needed proving across the tree. What
cost the difference was that §2.5's claims are **cross-cutting**: "push not pull" is a claim about
the tick, the cron, an SMS adapter and a login redirect, not about the board module; "empty is
success" is a claim about DEC-054's pause flag; the urgency model is a claim about DEC-025's
reinterpretation. Each such row needed two or three modules plus a DEC read in full, where §2.3's
rows were mostly settled by one module that cited the spec back at itself. **Transferable to
§2.6/§2.7:** budget by how far a section's claims reach *outside* its own module, not by whether the
surface exists. Both remaining sections are crew-facing surfaces with their own modules and few
cross-cutting assertions — ~90–110k each is the expectation.
