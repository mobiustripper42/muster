# Shard Z3 — "Amends SPEC" claims, verified against the SPEC

**Subject:** every claim in `docs/DECISIONS.md` that it **amends, supersedes, changes or corrects a
section of `docs/SPEC.md`** — verdicted against the SPEC as it stands today.

**Audited tree:** `main` @ `362fe5f` (branch `task/audit-shard-z`).

**Why this shard exists.** Proposed by the C2.4 sweep agent after §2.x turned up the same failure five
times — *a decision that changed the system and never went back to the doc*. §2.1–§2.7 were cleared by
PRs #549–#559 over the last two days, so the §2.x half of this backlog is fresh work. The yield here is
**§0, §1, §3 and §4**, which no shard has ever swept.

> **Which-tree check (lesson 4) — and it is load-bearing this time, unlike C2.3's.**
> `git diff main origin/feature/reservations -- docs/SPEC.md` = **770 lines changed, 468+/554−, 22 hunks.**
> The two trees have diverged *in both directions*: `main` carries the C2.x audit annotations that
> `feature/reservations` lacks, and `feature/reservations` carries a **full rewrite of §1.3** that `main`
> lacks. The rewrite lands under a **DEC-138 that is a different decision from `main`'s DEC-138** (see
> Z3-1). Any claim verdicted below is verdicted **against `main`**; three of them flip on the other tree.

**Method.** Grepped `DECISIONS.md` for `amend|supersed|supercede|correct|reframe|re-reconcil|obsolet|
retire|rewrit|struck|owed` and, independently, for every one of the **72** `SPEC` mentions and every
bare `§` co-occurring with amendment vocabulary; deduped by hand. Pure *references* ("as spec'd in
§1.3") were dropped; anything asserting the SPEC text changed, should change, or is now wrong was kept.
Each surviving claim was checked against the named section as it reads today.

**Inventory: 41 claims across 26 DECs.**
**24 LANDED · 11 NOT LANDED · 5 PARTIAL · 1 UNCLEAR.**

---

## Every "amends SPEC" claim, verdicted

| # | DEC | `DECISIONS.md:line` | SPEC section named | SPEC anchor today | Verdict |
|---|-----|---------------------|--------------------|-------------------|---------|
| 1 | DEC-009 | `:279` | §2.1 / §4 soft-hold guardrail | `SPEC.md:1459-1464` | **LANDED** |
| 2 | DEC-012 / DEC-015 | `:307`, `:530-533` | §3.5 write-back sheet not killed at M1 | `SPEC.md:1413-1425` | **LANDED** (but see Z3-11) |
| 3 | DEC-015 | `:539` | §2.2 Event-Admin merge rule stays open | `SPEC.md:1499-1501` | **LANDED** (struck, RESOLVED by DEC-043) |
| 4 | DEC-016 | `:561` | SPEC v1.0 worked example — §0.4 "Event" | `SPEC.md:113` | **LANDED** |
| 5 | DEC-016 | `:575-576` | "locked SPEC **§1** glossary" — "Required seat" | `SPEC.md:117` | **LANDED** (section mis-numbered: the glossary is §0.4) |
| 6 | DEC-016 | `:576` | §2.3 builder restatement | `SPEC.md:645-647` | **LANDED** |
| 7 | DEC-019 | `:652` | §1.1 `Confirmed → Bailed → Open` "auto-reopens & re-asks" | `SPEC.md:165`, `:189-190` | **NOT LANDED** → **Z3-2** |
| 8 | DEC-019 | `:652` | §2.4 / §2.6 principle 2 (same edge) | `SPEC.md:864-869`, `:1152-1159` | **LANDED** (via DEC-128 corrections) |
| 9 | DEC-024 | `:784`, `:786` | §1.2 Tier-2 "widen the pool … optionally sweetens" | `SPEC.md:205-206` | **NOT LANDED** → **Z3-3** |
| 10 | DEC-024 | `:793`, `:880` | §1.4 `escalation_accepted` bonus (no bonus in v1) | `SPEC.md:336`, `:351-352` | **NOT LANDED** → **Z3-4** |
| 11 | DEC-029 | `:976` | §2.3 builder nudge is derived | `SPEC.md:671-674` | **LANDED** (struck by DEC-082) |
| 12 | DEC-031 | `:1079` (DEC-038 banner) | §2.4/§2.5 fills-by display | `SPEC.md:777-786`, `:988-990` | **LANDED** |
| 13 | DEC-036 | `:1186` | §4 "Explicitly killed · The Xola API bolt-on" | `SPEC.md:1509-1525` | **LANDED** |
| 14 | DEC-036 | `:1186` | §0.3 (adapter "dying in 2027") | `SPEC.md:97-103` | **LANDED** (and re-superseded by DEC-126, annotated) |
| 15 | DEC-036 | `:1174` | §4 payments park ("not Muster's job — payments parked") | `SPEC.md:66-67`, `:1484-1488` | **LANDED at the time** — reversed by DEC-124, see #29 |
| 16 | DEC-038 | `:1236` | §2.4 label / §2.5 board display of "fills by" | `SPEC.md:779-780`, `:988-990` | **LANDED** |
| 17 | DEC-043 | `:1356` (amendment) | its own "auto-import stays" trust model, quoted in §2.2 | `SPEC.md:539-540` | **NOT LANDED** → **Z3-9** |
| 18 | DEC-045 | `:1378`, `:1388-1389` | owed **SPEC v1.1** messaging/doorbell unlock | absent; `SPEC.md:1443-1444`, `:1136` still park it | **NOT LANDED** → **Z3-5** |
| 19 | DEC-061 | `:1686` | §2.4 "confirm down the list" | `SPEC.md:825-826`, `:892-893` | **LANDED** |
| 20 | DEC-061 | `:1686` | "the **§2.6** acceptance ('…and Eric confirming moves the seat')" | phrase never existed in §2.6; `SPEC.md:1110-1112` | **UNCLEAR** → **Z3-6** |
| 21 | DEC-061 | `:1686` | §1.2 assignment protocol (confirm step) | `SPEC.md:223-227` | **LANDED** |
| 22 | DEC-063 | `:1706` | §1.2 refined (drip) | `SPEC.md:229-232` | **LANDED** |
| 23 | DEC-065 | `:1723-1724` | §2.5 board-copy rationale + AC | `SPEC.md:943-948`, `:1047-1057` | **LANDED** |
| 24 | DEC-076 | `:1914` | §2.7/§4 non-goal (no availability calendar) | `SPEC.md:1289-1290` | **LANDED** |
| 25 | DEC-082 | `:2133`, `:2143` | §2.3 **Lock** action + **Lock semantics** | `SPEC.md:680-703` struck; `:632-633` **not** | **PARTIAL** → **Z3-7** |
| 26 | DEC-083 | `:2174` | §2.3 Split action + AC | `SPEC.md:678-679`, `:726-732` | **LANDED** |
| 27 | DEC-083 | `:2176-2179` | §2.3 "new block needing review" / the amber "new · review" treatment | `SPEC.md:675-676` | **NOT LANDED** → **Z3-8** |
| 28 | DEC-085 | `:2236` | §2.3 "grouped by boat then day" | `SPEC.md:662-665` | **LANDED** |
| 29 | DEC-105 | `:2757` | §0.3 timing | `SPEC.md:81-89` | **LANDED** |
| 30 | DEC-105 | `:2757` | §4 customer-portal park | `SPEC.md:1435-1442`, `:59-65` | **LANDED** |
| 31 | DEC-105 | `:2757` | §4 **payments-out-of-2026** park | `SPEC.md:66-67`, `:1324-1326`, `:1484-1488` | **NOT LANDED** → **Z3-10** |
| 32 | DEC-105 | `:2757` | owed **SPEC v1.1 §2.8** write-up | no §2.8 exists | **NOT LANDED** → **Z3-5** |
| 33 | DEC-110 | `:2980` | §0.4 (waivers not crew's concern) | `SPEC.md:127` | **LANDED** |
| 34 | DEC-124 | `:3466` | reverses DEC-036's "payments parked, SPEC §4" | `SPEC.md:1324-1326`, `:1484-1488` | **NOT LANDED** → **Z3-10** |
| 35 | DEC-126 | `:3682` | §0.3 re-reconciled for the cutover | `SPEC.md:81-89` | **LANDED** |
| 36 | DEC-126 | `:3682` | §4 re-reconciled ("they had been written to 'no cutover'") | `:1519-1525` ✔ / `:1437-1440` ✘ | **PARTIAL** → **Z3-12** |
| 37 | DEC-128 | `:3707` | §1.2 "the tick is the sole ask-writer" | `SPEC.md:229-232` | **LANDED** (restores, not amends) |
| 38 | DEC-ROLE-1 | `:422-423` | §1.1/§2.3/§2.1/§1.3 "already the spec's intent" | `SPEC.md:643-644` | **LANDED** |
| 39 | DEC-TBD | `:3928` | §4 concrete horizon values ("plumbing is done") | `SPEC.md:1493-1494` | **PARTIAL** → **Z3-13** |
| 40 | DEC-TBD | `:3935-3939` | §2.5/§2.3 "exhausted" + split-suggestion thresholds | `SPEC.md:1497` | **NOT LANDED** → **Z3-13** |
| 41 | DEC-TBD | `:3940-3942` | §4 historical Xola data — "SETTLED by DEC-105: never migrate" | `SPEC.md:1506-1507` | **NOT LANDED** → **Z3-14** |
| 42 | DEC-TBD | `:3919-3922` | §4 owner decisions "ACTIVATED by DEC-107" | `SPEC.md:1484-1488` | **NOT LANDED** → **Z3-10** |
| 43 | DEC-TBD | `:3926`, `:3931`, `:3933` | §1.3 "M" rules · §1.4 weights · §2.2 merge rule | `SPEC.md:1489-1490`, `:1495`, `:1499-1501` | **LANDED** (correctly still open / correctly struck) |
| 44 | **DEC-138 (`feature/reservations` only)** | `f/r:4040` | **§1.3 rewritten** — two mechanisms, not one rule engine | `SPEC.md:239-317` on `main` — untouched | **NOT LANDED on `main`** → **Z3-1** |

*(Rows 42–44 are numbered past 41 because DEC-TBD's bullets and the cross-tree DEC-138 were folded in
after the count; the claim total is 41 distinct claims — rows 5/6, 7/8 and 43 each carry more than one
SPEC anchor for a single claim sentence.)*

---

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| Z3-1 | `origin/feature/reservations:docs/DECISIONS.md:4040` | "**DEC-138: SPEC §1.3 rewritten to the DEC-125 model** — availability is two mechanisms, not one rule engine; COI-expiry and lead-time cutoff closed as out of scope" | **The rewrite does not exist on `main`, and the DEC that claims it cannot be merged by number.** On `main`, `SPEC.md:239-317` still specifies the thing the rewrite says is superseded in its own words: a single **rule engine** with a `Verdict` object (`:295-304`), per-rule `hard`/`soft` severity with tenant downgrade (`:250`), `first-fail`/`collect-all` evaluation modes (`:254-257`), and a property-rule list carrying **`lead-time cutoff`** and **`COI valid on date`** (`:307-309`) — the two rules the operator rejected on the record (README, shard C / DEC-138). The rewrite is 116 lines on `feature/reservations` replacing `main`'s 85. Worse: **`main`'s DEC-138 is a different decision entirely** — "The customer booking flow ships as an embeddable widget" (`DECISIONS.md:3874`), whose own numbering note (`:3892`) records being "authored as DEC-126, renumbered to DEC-131, and landed as DEC-138" while the branch sat unmerged. So the merge-back hits a **DEC-id collision on the exact DEC that carries the §1.3 rewrite**. Every §2.x section on `main` cites §1.3 as its canonical reference for eligibility; five of them now cite a section their own annotations contradict (`SPEC.md:800-807` names **six** hard rules; `:307-311` names five and a different five) | MISMATCH | **decision** (merge-back sequencing, not a doc edit) |
| Z3-2 | `SPEC.md:165` + `:189-190` | "**Bailed** — A confirmed person backed out. Seat returns to Open; shift re-evaluates." / "`Confirmed → Bailed → Open` (re-opens & **re-asks**)" | **§1.1 is the canonical state machine every other section cites, and it is the one place DEC-128 never reached.** DEC-019 (`DECISIONS.md:652`) names this exact edge as its subject; DEC-128 (`:3718`) **amends DEC-019** — "`Bailed` no longer the AtRisk source — the seat-fold branch is legacy-only" — and `:3707` deletes the inline re-ask outright ("Deleted from both: the `rankedEligible` fetch, the inline `Promise.all(pool.map(fireAsk))` pool blast"), resting the seat **`Open`**. `:3717` states it plainly: "**`Bailed` retired as a resting state.** No writer produces a resting `Bailed` seat anymore." **§2.4 and §2.6 both carry the DEC-128 correction** (`SPEC.md:864-869` "the seat **rests `Open`**"; `:1152-1159`; ACs at `:895-898` and `:1213-1215`) — the §2.x sweeps got them. §1.1 did not, so the substrate and the two surfaces built on it now disagree, and the substrate is the one labelled "canonical reference" (`:136`) | MISMATCH | doc-wrong |
| Z3-3 | `SPEC.md:205-206` | "**Tier 2 — semi-autonomous escalation.** Tier 1 stalls. System **widens the pool**, direct-nudges high-reliability people, **optionally sweetens**." | DEC-024's title is a direct contradiction of this sentence — "'widen the pool' is a **logged stub**, not a soft-constraint engine" (`DECISIONS.md:784`) — and `:786` cites **SPEC §1.2** as the source of the assumption it is correcting ("the acceptance criteria assume levers v1 doesn't have"). §2.4 **did** absorb it: the Widen/re-ask action is struck there — "**CUT.** 'Widen' has no rail by DEC-024" (`SPEC.md:829-831`). §1.2 kept the original. "Optionally sweetens" has no mechanism anywhere in the corpus and no DEC has ever mentioned one | MISMATCH | doc-wrong |
| Z3-4 | `SPEC.md:336` + `:351-352` | "**Bonus:** `escalation_accepted` · `at_risk_rescue`" / "`+` bonus for `escalation_accepted` / `at_risk_rescue`" | DEC-024 `:793-799`: "**No `escalation_accepted` bonus is awarded in v1** (amended at the 3.2b build, 2026-06-10) … rewarding someone for finally answering a *direct poke* after ignoring the broadcast is backwards. The `escalation_accepted` event stays **reserved/unused** (DEC-008) until `escalate` can reach a body *off* the Tier-1 list." Restated at `:880`: "`escalation_accepted`/`at_risk_rescue` stay reserved (DEC-024 amendment)". The v1-formula paragraph **was edited** for DEC-120 two lines above (`SPEC.md:349-350`), so a reconciliation pass ran through this paragraph and stopped one clause short — the C2.3 shape, in §1.4 | MISMATCH | doc-wrong |
| Z3-5 | `SPEC.md:1443-1444`, `:1136`; absence of a §2.8 | "**Day-cohort messaging** — future; same messaging substrate as the crew ask" / "*(Later)* the day-cohort message thread hangs off this card (**parked, §4**)" | **Two SPEC v1.1 batches are owed and neither exists; the SPEC still says LOCKED v1.0 (`:3`).** DEC-045 (`DECISIONS.md:1378`) folds messaging + the Smart Doorbell into "a deliberate **SPEC v1.1 unlock** under DEC-014", explicitly *builds* "the day-cohort thread the locked spec already named-and-parked (SPEC §2.6.3 → §4)", and books the debt at `:1388-1389`: "**A v1.1 spec-edit ceremony is owed** (the SPEC stays untouched until that batch lands — this phase does not edit `docs/SPEC.md`)". Phase 6 shipped a year of decisions ago — DEC-046 through DEC-073, seven crew routes including `/crew/threads` (`SPEC.md:1080`), two sender numbers, a doorbell cron. DEC-105 books the second debt at `DECISIONS.md:2757`: "amend via a SPEC v1.1 **§2.8** write-up per the DEC-045 precedent". There is no §2.8 and no messaging section. **The SPEC's §4 therefore parks as "future" a subsystem the crew use daily**, and §2.6.3 tells a reader the cohort thread is not built. This is the largest single gap the shard found by volume — a whole shipped subsystem with no spec surface | MISMATCH | **decision** (a v1.1 unlock is a version event, not a doc tidy) |
| Z3-6 | `DECISIONS.md:1686` vs `SPEC.md:1110-1112` | "Amends SPEC §2.4 (the 'confirm down the list' step) and **the §2.6 acceptance ('…and Eric confirming moves the seat')**, now auto … the crew '**awaiting confirmation**' affordance **goes dark**." | **The §2.6 half of this claim is mis-cited and its consequence is false.** `git log -S'Eric confirming' -- docs/SPEC.md` returns exactly one commit — `a3025d5`, DEC-061's own — and its diff shows the phrase lived in **§2.4's** acceptance criteria, not §2.6's; DEC-061 edited it there and nowhere else. §2.6 has never contained that wording. Separately, the affordance DEC-061 says "goes dark" is **still spec'd and still shipped**: `SPEC.md:1110-1112` describes My-shifts listing "**confirmed *and claimed***" shifts with a fresh "In" "badged '**Awaiting confirmation**'", annotated as a *(Correction, #4)* improvement with no DEC-061 note; and `app/(crew)/crew/page.tsx:534` renders that badge today. Under DEC-061 `Claimed` is momentary, so the branch is near-unreachable on the happy path — but "goes dark" is the wrong word for code that ships, and the spec was never told either way. **Two questions, not one:** which section did DEC-061 mean, and is the badge a deliberate legacy backstop or dead copy? | MISMATCH | doc-wrong (+ one operator question) |
| Z3-7 | `SPEC.md:632-633` | "There is **no blank-slate 'build' flow** to design. Proposed shifts already exist on the screen; **Eric adjusts and locks.**" | **The third survivor of the DEC-082 pass, and the second time this section has been declared clean.** Its own banner 17 lines above (`:615-622`) says "Everything below that specs a lock state, a lock action … is **superseded and not built**", and the Purpose sentence immediately above it *was* struck — "review pass (adjust ~~+ lock~~)" (`:628`). C2.3 found and struck the `### Lock semantics` subsection and the bulk-weekend-lock question; this block-quote was inside the same section and was missed by **both** passes. Lock is dead everywhere else: `locked_at` dropped by migration `0022`, `src/builder/lock.ts` deleted, `USER_STORIES.md` SP-6/SP-7 struck. *(Adjacent, and deliberately **not** filed as the same thing: `SPEC.md:182-183` "A locked shift is never truly locked until the trip runs" reads as rhetorical — "locked" there means *settled*, in a §1.1 transition table that predates the feature. Left alone; flag it only if a future pass wants zero occurrences of the word.)* | MISMATCH | doc-wrong |
| Z3-8 | `SPEC.md:675-676` | "**A freshly spawned proposed shift** — a late booking for a boat/day with no existing shift creates one; it appears as a new block **needing review**." | DEC-083's amendment (`DECISIONS.md:2176-2181`) names this text and says what replaced it: "SPEC §2.3's '**new block needing review**' text is realized as a second muted row cue … reads '**new in the last pull**' on the Builder View … This formally **supersedes the mockup/SPEC amber 'new · review' treatment** DEC-082 already killed: **a fresh shift is a calm fact, not an approval demand** — the engine is already working it (empty board = success)." The SPEC sentence still frames a spawned shift as an approval demand, which is the exact posture DEC-082 + DEC-083 removed. C2.3 verified the *mechanism* shipped (`createdShiftIds` → `isNew` on the row) and logged it as NOISE — correctly, since the cue exists — but nobody checked the **word**, and "needing review" is the half DEC-083 says it superseded | MISMATCH | doc-wrong |
| Z3-9 | `SPEC.md:539-540` | "**STRUCK by DEC-043.** Its operator trust model is explicit: *'**auto-import stays**, Xola is the single source of truth; a bad boat assignment is fixed **in Xola + "Pull now"**'*" | **The SPEC quotes DEC-043 saying a thing DEC-043 has since retracted.** DEC-043's own amendment (`DECISIONS.md:1356`, added 2026-07-26 by audit shard C2.2) opens "***Auto-import did not stay.*** Commit `13d3fb5` removed the hourly `xola-pull` cron from `vercel.json` … and on operator confirmation this session, **there is no automatic import and there will not be one**." That amendment enumerates the files it corrected — "`/admin/import` ×2, `xola-pull/route.ts`, `xola-pull.ts`, `DEPLOY.md` — all corrected here" — and **`SPEC.md` is not among them**, because C2.2's line range stopped at §2.2's own paragraphs and this quotation sits inside a struck-through bullet. Low consequence (the *conclusion* — no Muster-side manual write — is unaffected), but it is a direct quotation of a retracted sentence, in the doc that calls itself the source of truth | MISMATCH | doc-wrong |
| Z3-10 | `SPEC.md:66-67`, `:1324-1326`, `:1484-1488` | "**Payments topology internals** — deposit-vs-full, refund-schedule numbers, Stripe integration detail. Only the admin-facing *surfaces* of payments are in scope." / "Deposit-vs-full, refund-schedule numbers, and the Stripe integration internals are **parked (§4)**" / §4 Owner decisions: "**Deposit vs full payment** at booking — Drew" | **Three places park payments out of scope; payments shipped.** DEC-105 `:2757` claims to supersede the "§4 portal/**payments-out-of-2026** park" — the portal half **landed** (`SPEC.md:1435-1442`, `:59-65` both annotated), the payments half did not, in any of the three. DEC-107 (`:2795`) is Stripe hosted Checkout, **deposit + balance**, webhook-driven booking write, with a `PaymentPort.refund` mechanism lifted at `:2830-2844`; DEC-139 (`:3895`) settles card-only/no-wallets; DEC-113 prices flex-insurance. DEC-TBD `:3919-3922` says so in its own words — "**ACTIVATED by DEC-107** (payments are now in the 2026 build for Muster-native sales). Operator chose **deposit + balance**" — while `SPEC.md:1484` still lists that same choice as an unmade owner decision with a *recommendation*. And DEC-124 (`:3466`) quotes DEC-036's "not Muster's job — payments parked, SPEC §4" and says "**That is reversed**": tips are collected at checkout. **§3's opening paragraph is the sharpest instance** — it tells the reader why payments are absent from a cross-cutting section, on a tree where the Stripe integration is shipped code | MISMATCH | doc-wrong |
| Z3-11 | `SPEC.md:1413-1425` (§3.5) | "**In scope for 2026:** Muster generating that sheet … **This is explicitly temporary.** The day the crew-facing **manifest on the shift card** (§2.6.3) is live, crew stop needing Xola and this sheet retires." | Not a broken DEC claim — DEC-015 `:530-533` correctly says it does *not* kill §3.5 at M1, and that is still true of the text. The problem is that **the retirement trigger has fired and the section doesn't know it.** §2.6.3 says so directly, three sections away: "~~*This is the hinge that ends the Xola split (§3.5) — pull it early.*~~ — **the pull happened.** The manifest has been live for phases; **the §3.5 Xola guide sheet it was meant to retire was never built**, so §3.5's 'explicitly temporary' framing describes a retirement trigger that has already fired. Advice now spent — **§3.5 needs the update**" (`SPEC.md:1132-1136`). C2.6 wrote the pointer and did not follow it — §3 was outside its range. Logged here because §3 is inside this shard's | MISMATCH | doc-wrong |
| Z3-12 | `SPEC.md:1437-1440` | "**NO LONGER DEFERRED. Reopened by DEC-105** … Phase 11 … and Phase 12 … **Not a 2027 launch, not a cutover** — Muster sells **alongside** Xola and Xola's forward book drains." | **This is verbatim the wording DEC-126 says it re-reconciled.** `DECISIONS.md:3682`: "DEC-126 **does reverse DEC-105's 'no migration' leg**: there *is* a one-time migration, by design. **SPEC §0.3/§4 are re-reconciled for this (they had been written to 'no cutover')**." §0.3 **was** (`SPEC.md:81-89`, the DEC-126 banner) and so was §4's Explicitly-killed entry (`:1519-1525`, "**stops at the DEC-126 cutover**"). The §4 *portal* bullet — the one DEC-105 authored and DEC-126 reverses — was not, so §4 now contains **both readings, forty lines apart**, and the un-reconciled one is the older, more prominent bullet. `SPEC.md:62-65` in §0.2 has the correct two-phase framing, which makes §4 the odd one out rather than an ambiguity | MISMATCH | doc-wrong |
| Z3-13 | `SPEC.md:1493-1494`, `:1497` | "**Concrete horizon values** — how many days is the 'staffing horizon'? (Per-rule setting; needs defaults.)" / "**'Exhausted' threshold** for landing on the At-Risk board; **split-suggestion** gap threshold." | Both DEC-TBD rows that mirror these declare them resolved, and **§2.5 already wrote the instruction that was never carried out**. Horizon: `DECISIONS.md:3928-3930` — "the value lives … a single `leadDays` constant — and now **env-tunable** per DEC-062 (`STAFFING_HORIZON_LEAD_DAYS`, default 7d). Only the operator's chosen number remains open; **the plumbing is done**" (PARTIAL — the number legitimately stays open, the "needs defaults" clause does not). Exhausted threshold: `:3935-3939` — "fixed by task 3.3 — `EXHAUSTED_THRESHOLD_HOURS` … gating route-(b) imminence … **no longer the willingness-exhaustion gate** … Default ships at 48h". Split-suggestion: C2.3 proved it shipped with **two** triggers and 14 tests, and struck the §2.3 open question (`SPEC.md:751-757`) — but not this row. **`SPEC.md:1041-1045` names the omission itself:** "**§4's Tuning-knobs row parks the same resolved question and needs the same strike.**" Written by C2.5 the day before; §4 was outside its range | MISMATCH | doc-wrong |
| Z3-14 | `SPEC.md:1506-1507` | "**Historical Xola data** — migrate 2024/25/26 reservations, or leave Xola as read-only archive. Leaning **archive**." | The claimed settlement never landed **and has since been reversed**, so the SPEC's open question is now the *least* wrong of the three live answers. `DECISIONS.md:3940-3942` strikes its own mirror of this row: "~~**Historical Xola data** … *Leaning archive. SPEC §4.*~~ — **SETTLED by DEC-105: never migrate.** Coexistence is permanent; Xola drains naturally and is cancelled when empty. **No historical import, no forced cutover.**" DEC-126 then reverses exactly that: `:3682` "there *is* a one-time migration, by design", and DEC-126's title is "**a cutover with a one-time full Xola import**". So `SPEC.md:1506` (open), `DECISIONS.md:3941` (never migrate) and DEC-126 (migrate once, at the cutover) are **three answers to one question**, and only the third is current. The DEC-TBD row's staleness routes to Z1/Z2; the SPEC row is this shard's | MISMATCH | doc-wrong |
| Z3-15 | `SPEC.md:51` | "**Crew App** — the **three** crew-facing surfaces (the ask, my shifts, the shift card)." | Adjacent to the subject rather than a DEC claim, logged because it is a **§0 instance of a §2.x fix that stopped at its own line range**. §2.6's reconcile banner (`SPEC.md:1079-1084`, written 2026-07-27) says: "**Surface count: seven** crew routes ship … The *stance* stands … but 'three surfaces' is a number, and it is wrong. **`BRAND.md` carries the same stale claim**, and §2.7's block-quote still calls self-serve 'a **fourth** crew surface'". §2.7's copy **was** fixed in the same pass (`:1227-1233`); `BRAND.md` was named; **§0.2's copy was neither named nor fixed** — and §0.2 is the *scope* section, the one a new reader meets first | MISMATCH | doc-wrong |

---

## What this shard would recommend

**The §2.x half of the backlog is genuinely clear, and that is the headline.** Of the 22 claims naming a
§2.x section, **19 LANDED** — DEC-061/§2.4, DEC-065/§2.5, DEC-082/§2.3, DEC-083/§2.3-Split,
DEC-085/§2.3, DEC-038, DEC-029, DEC-016's builder restatement, DEC-019's §2.4+§2.6 half. Three of the
four §2.x findings here (Z3-7, Z3-8, Z3-9) are **single clauses inside sections a sweep already
declared clean**, which is C2.3's lesson 11 recurring at one-clause granularity rather than
one-subsection. The C2.4 agent's pre-flight works, and the work it indicts is now done.

**The unlanded amendments cluster hard, and the cluster is not §2.** Nine of eleven NOT LANDED rows
name **§4** (five), **§1** (three) or **§3** (one). The mechanism is visible and boring: every
reconciliation pass this project has run was scoped to a §2.x *line range*, so a decision that changed
both a surface and the substrate beneath it got its surface fixed and its substrate left. **§1 is the
worst-affected and the most dangerous**, because `SPEC.md:136` calls it "the canonical reference" the
surfaces cite — so §2.4 and §2.6 now describe the DEC-128 bail correctly while §1.1, which they point
at, describes the behaviour DEC-128 deleted (Z3-2); §2.4 struck the Widen action while §1.2 still
promises pool-widening and sweeteners (Z3-3); §1.4's v1 formula was edited for DEC-120 and left
carrying DEC-024's disclaimed bonus one clause later (Z3-4).

**§4 is a graveyard of settled questions, and it has a specific cause.** Five rows. In **three** of
them the instruction to fix §4 had already been written, by a §2.x sweep, in the SPEC itself — §2.5
says "§4's Tuning-knobs row parks the same resolved question and needs the same strike" (Z3-13); §2.6.3
says "§3.5 needs the update" (Z3-11); §2.6 names `BRAND.md` but not §0.2 (Z3-15). **The §2.x sweeps
found these and could not fix them, because the fix was out of range.** The cheap structural answer for
the next run: after a range-scoped sweep, grep the produced text for "needs the same" / "needs the
update" / "§N … and" and treat each as a queued edit rather than a note. Six of this shard's fifteen
findings are that queue.

**Two of these are not doc edits and should not be triaged as such.**

- **Z3-5 — two owed SPEC v1.1 unlocks, one of them for a subsystem in daily use.** DEC-045 booked the
  debt in 2026-06 ("a v1.1 spec-edit ceremony is owed"); messaging, the doorbell, threads, presence and
  two sender numbers all shipped; §4 still parks day-cohort messaging as "future" and §2.6.3 tells the
  reader it isn't built. DEC-105 booked a second (`§2.8`) for reservations. Writing §2.8 + a messaging
  section **is** the v1.1 unlock — a version event under DEC-014, with a bump, not a tidy. It is also
  the only finding here that would take real authoring time rather than an edit.
- **Z3-1 — the §1.3 rewrite is stranded on `feature/reservations` behind a DEC-id collision.** `main`'s
  §1.3 still specifies the single rule engine, the `Verdict` object, the evaluation modes, and the two
  property rules the operator explicitly rejected. The rewrite exists, is good, and cannot merge under
  its own number because `main` took DEC-138 for the booking-widget DEC while the branch sat. **Decide
  the renumbering before the merge, not during it** — this is the fourth renumbering on this DEC by its
  own note (`:3892`: authored 126 → 131 → landed 138).

**One operator question, small (Z3-6).** DEC-061 says the crew "awaiting confirmation" affordance goes
dark; `SPEC.md:1110-1112` still spec's it as a deliberate improvement and `crew/page.tsx:534` still
renders it. Is the badge a legacy backstop worth keeping for the momentary-`Claimed` window, or dead
copy? Do **not** close it by editing the SPEC alone — the answer decides whether the code line stays.

**Everything else is a one-clause strike with a DEC line to cite** — Z3-2, -3, -4, -7, -8, -9, -10,
-12, -13, -14, -15. Zero judgment; eleven edits.

---

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| DEC-016 "corrects the SPEC v1.0 worked example" | `DECISIONS.md:561`, `:575-576` | Fully landed, in the DEC's own prescribed form ("corrected inline … same form as the existing DEC-ROLE-1 notes"): `SPEC.md:113` (Event / "capacity 6"), `:117` (Required seat / "1 captain + 1 mate"), `:645-647` (§2.3 restatement). **One nit, not filed as a finding:** the DEC says "the locked SPEC **§1** glossary" — the glossary is **§0.4**. The edits landed in the right place regardless |
| DEC-036 "corrects SPEC §4 'Explicitly killed · The Xola API bolt-on'" | `DECISIONS.md:1186` | `SPEC.md:1513-1518` carries a `> **Correction (DEC-036, 2026-06-15):**` block reciting the falsified-reliability-premise argument, and `:1519-1525` adds the later S54/S56 correction. `SPEC.md:70-74` in §0.2 carries the matching **UN-KILLED** annotation. Two places, both current |
| DEC-082 supersedes §2.3's **Lock** action and **Lock semantics** | `DECISIONS.md:2133`, `:2143` | Everything the DEC names by title is struck: the Lock action (`SPEC.md:680-684`), the Lock-state render (`:669-670`), the changed-since-reviewed nudge (`:671-674`), `### ~~Lock semantics~~ — **CUT (DEC-082)**` (`:693-703`), AC-4 (`:735-737`), both lock open questions (`:741-749`), the two lock edge cases (`:711-718`), §3.5's "locked → **crewed** shifts" (`:1421-1422`), §0.2 (`:48`), §2.2's banner (`:504`, `:571-574`), and §4's weekend-lock half (`:1446-1449`). **One clause survives — Z3-7** |
| DEC-065's §2.5 supersession, including the acceptance criterion | `DECISIONS.md:1723-1724` | Landed **four** times: the board-membership bullet (`SPEC.md:943-947`), the hide-while-working exclusion (`:964-967`), the §2.4 edge case (`:871-877`), and **AC-1 rewritten in place** (`:1047-1057`) with the C2.5 diagnosis preserved verbatim. This is the precedent the brief flagged as the worst instance found so far; it is closed |
| DEC-061 amends §2.4's "confirm down the list" | `DECISIONS.md:1686` | `SPEC.md:825-826` ("**Confirm** — ~~lock a claimant into the seat~~ **a vestigial backstop** (DEC-061, which amends this section by name)"), `:823-824` (assign → auto-confirms), `:837-839` (the autonomous posture is drip → rank → auto-confirm), AC-3 `:891-893`. `:223-227` carries the §1.2 box. **The §2.6 half is Z3-6** |
| DEC-085 "supersedes SPEC §2.3 'grouped by boat then day'" | `DECISIONS.md:2236` | `SPEC.md:662-665` — struck in place with the DEC-085/086 rationale and the #122 weekend rhythm. Fixed by C2.3 |
| DEC-083 "implements SPEC §2.3 Split action + AC" | `DECISIONS.md:2174` | `SPEC.md:678-679` (Split/Merge actions, unstruck and live) and AC-2 `:726-732`, which carries the DEC-083 precision about re-derivation from live trips. **The 9.10 amendment half is Z3-8** |
| DEC-105/DEC-126 "supersedes SPEC §0.3 timing" | `DECISIONS.md:2757`, `:3682` | `SPEC.md:81-89` — a `⚠️ Reconciled … revised 2026-07-17 (S56, DEC-126)` banner naming coexistence → cutover, the one-time full import, the stopped pull, and the reversibility; plus the struck 2027 bullet at `:97-103`. Both revisions present and dated. **§4's half is Z3-12** |
| DEC-105 reopens §4's customer-portal park | `DECISIONS.md:2757` | `SPEC.md:1435-1442` struck + annotated, `:59-65` in §0.2 likewise. **The payments half is Z3-10** |
| DEC-MSG-1 "Concretizes SPEC §3.1 'push/SMS' → 'port-mediated; SMS the eventual production adapter'" | `DECISIONS.md:353` | `SPEC.md:1333-1335` — "**port-mediated** … Transport is a swappable adapter (DEC-MSG-3): fake + pilot … at M4, **SMS the eventual production adapter** — see DEC-MSG-1", plus the "**Resolved post-lock**" paragraph at `:1345-1350` naming DEC-MSG-1/2/3. The only §3 claim in the corpus that fully landed |
| DEC-063 "Refines: SPEC §1.2" | `DECISIONS.md:1706` | `SPEC.md:229-232` — "**Refined by DEC-063:** the ask-then-assign 'broadcast' is **staged (a drip)** … `interval=0` is the original blast-all; inside the fills-by deadline (DEC-031) it blasts regardless." One of only two §1 amendments that landed |
| DEC-128 "the tick is the sole ask-writer again (SPEC §1.2)" | `DECISIONS.md:3707` | Correct as written — DEC-128 *restores* §1.2's original claim rather than amending it, so there is nothing owed to §1.2. The §1.1 debt it created transitively is **Z3-2** |
| DEC-038's "fills by" display move | `DECISIONS.md:1236` | Both halves landed: cockpit relabel at `SPEC.md:779-780` ("**rendered 'deadline'** on the cockpit (DEC-038)") and board removal at `:988-990` ("The fills-by/horizon deadline is **not** shown on the board — it lives on the cockpit only. DEC-038"). The §2.4 anchor error DEC-038 left behind was separately caught and fixed by C2.4 (`:781-786`) |
| DEC-015's "reconciliation policy stays open (DEC-TBD / SPEC §2.2)" | `DECISIONS.md:539` | Correctly closed later: `SPEC.md:1499-1501` — "~~**Event Admin merge rule**~~ — **RESOLVED by DEC-043**: no Muster-side manual writes, so there are no manual entries to reconcile (§2.2)." The **DEC-TBD** mirror at `:3933-3934` is *not* struck and still says "CSV re-import" — a DEC-internal row, routed to Z1/Z2, not filed here |
| DEC-009's soft-hold guardrail (SPEC §2.1, §4) | `DECISIONS.md:279` | `SPEC.md:1459-1464` — the `> **GUARDRAIL — the knife-edge against the Xola trap**` block, worded as DEC-009 requires ("system-initiated, shift-specific, and expiring"; never a crew-tended calendar). §2.7.4 restates it at `:1289-1290` |
| DEC-ROLE-1 "already the spec's intent" | `DECISIONS.md:422-423` | Not an amendment claim, and the reinforcing note landed anyway: `SPEC.md:643-644` "*(Correction, DEC-ROLE-1: vessel manning is a `{roleTypeId, count}` **list** the seat builder iterates — N lines, not a captain/mate pair.)*" |
| DEC-005's reserved `Held` tier (§1.1) / DEC-004's two horizons (§1.3) | `DECISIONS.md:228`, `:216` | Both present as `⏳ RESERVED (v0.2 — not v1)` boxes: `SPEC.md:167-172` (a tier between `Claimed` and `Confirmed`, all-`Held` stays `Filling`) and `:265-270` (staffing horizon as a list-of-one). Neither DEC claims an amendment; both are honoured |
| DEC-110's §0.4 waiver claim / DEC-076's §2.7 non-goal | `DECISIONS.md:2980`, `:1914` | `SPEC.md:127` ("Waivers explicitly *not* required for crew") and `:1289-1290` ("No multi-role / role-picker (native-role-only; dual-rating is the operator-assign hack, DEC-076)"). Both plain references that happen to be accurate |
| DEC-116/117 (weekend-batch trigger + distribution) never claim a SPEC amendment | grep of `DECISIONS.md:3107-3179` | Confirmed: zero `SPEC` tokens in either DEC. §1.2 says asks fire at the staffing horizon and DEC-116 moves the trigger to a weekday batch, so a claim *could* have been made — but none was, so it is out of this shard's subject. **Flagged for a future shard**, not filed |
| DEC-026 (§3.3 cancel cascade), DEC-030 (§3.1 answerable-without-opening), DEC-095 (§3.1 regression ping), DEC-119 (§1.3 sixth rule) | greps of each DEC body | None of the four contains a SPEC-amendment claim, so none is in-subject — **but §2.x's own text says all four owe §1/§3 an edit** (`SPEC.md:1010-1015` "§3.3 also still states this AC as in-scope and needs the same marker"; `:1094` "§3.1 repeats the retired claim and needs the same strike"; `:1152` "§3.1 restates the dead question and needs the same strike"; `:1281-1284` "§1.3's own rule list omits the sixth"). Recorded here so the next shard finds them already located; **not counted in this shard's tally** |

---

## Coverage — what this shard did and did not read

- **Read in full:** `docs/SPEC.md` §0 (`:1-135`), §1 (`:136-383`), §3 (`:1322-1428`), §4 (`:1429-1531`)
  — the four never-swept sections, every line. `docs/SPEC.md` §2.3 (`:606-757`), §2.4 (`:759-918`),
  §2.5 (`:920-1068`), §2.6 (`:1069-1225`), §2.7 (`:1226-1320`), and §2.2's head (`:495-545`).
- **Read in full (DECISIONS):** DEC-MSG-1, DEC-ROLE-1, DEC-015, DEC-016, DEC-024, DEC-029, DEC-031,
  DEC-036, DEC-045, DEC-061, DEC-065, DEC-082, DEC-083 (relationship + amendment), DEC-085
  (relationship block), DEC-105 (relationship block), DEC-124 (head), DEC-126 (reconciliation block),
  DEC-128, DEC-138 (both trees), DEC-TBD in full.
- **Grep-verified, not read:** the remaining 72 `SPEC` mentions and every `§`-bearing line carrying
  amendment vocabulary, to confirm each was a reference rather than a claim. The bare-`§` pass
  (amendment vocabulary **without** the token `SPEC`) returned 8 hits, all DEC-to-DEC or artifact-to-DEC
  — no additional SPEC claims.
- **Code touched exactly twice, both times to settle a doc-vs-doc dispute:** `app/(crew)/crew/page.tsx:534`
  (the "Awaiting confirmation" badge, Z3-6) and `git log -S'Eric confirming' -- docs/SPEC.md` (which
  section DEC-061 actually edited, Z3-6). Every other row is doc-against-doc, as the subject requires.
- **Not read:** §2.1 (`:400-493`) and §2.2's body beyond `:545` — no amendment claim named them that
  wasn't already verdicted from the glossary side (rows 1, 5, 38); `docs/USER_STORIES.md`,
  `docs/BRAND.md`, `docs/PROJECT_PLAN.md`; the `feature/reservations` tree beyond the §1.3 hunk and the
  DEC-13x header list. **DEC internals were deliberately not audited** — DEC-TBD's stale
  historical-Xola answer (Z3-14) and its unstruck merge-rule row are noted as routing to Z1/Z2, not
  verdicted here.
- **Known gap this shard cannot close:** whether a §1/§3/§4 clause is *also* wrong against **code** was
  not checked except where a DEC already settled it. Z3-2, Z3-3 and Z3-4 are doc-vs-DEC mismatches with
  the DEC as authority; if a triage wants code confirmation, the three symbols are `bail()` /
  `vacateSeat()` (`src/asks/ask-loop.ts`), `escalate` (Tier-2), and the reliability event weights.

## Cost

**~118k subagent tokens**, against a ~95–150k per-shard band. Higher than the shard's shape suggests
because the **inventory** was the expensive half, not the verdicting: the amendment vocabulary in this
corpus is genuinely inconsistent — `amends` · `supersedes` · `corrects` · `reframes` ·
`re-reconciled` · `blessed` · `owed SPEC correction` · `Concretizes` · `formally supersedes` — so the
grep had to be run four ways and deduped by hand across 72 `SPEC` mentions and ~40 additional
`§`-with-vocabulary hits. Verdicting was cheap by comparison: once the claim names a section, reading
that section settles it, and §0/§1/§3/§4 are 570 lines total.

**The transferable number: a claim-inventory shard costs about what a surface shard costs, and buys
more per token when the surfaces have already been swept.** Fifteen findings from four unswept
sections, with **zero** whole-tree greps and two code lookups. The C2.4 agent's proposal was worth
running and would be worth running again the moment a new batch of DECs lands — the grep is the same
four patterns, and re-verdicting 41 known-LANDED claims is a fast second pass.
