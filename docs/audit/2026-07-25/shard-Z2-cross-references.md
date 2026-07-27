# Shard Z2 — `DECISIONS.md` cross-reference graph

**Subject:** every `DEC-NNN` reference *inside* `docs/DECISIONS.md`, treated as a directed graph. The
**edges**, not the content: does each reference resolve, and do supersede/amend/reverse relationships
point **both ways**?

**Audited tree:** `main` @ `362fe5f` (branch `task/audit-shard-z`). `origin/feature/reservations`
read as the divergence comparand.

**Scale of the graph.** 3,949 lines. **135 `^## DEC-` headings** (130 numbered `DEC-NNN` + 5 named:
`DEC-MSG-1/2/3`, `DEC-ROLE-1`, `DEC-DATA-1`), plus `## DEC-TBD`. **711 in-body `DEC-NNN` references**
resolving to **428 distinct ordered pairs**, of which **44 are reciprocated and 384 are one-way**. The
bulk of those 384 are ordinary citations ("reuses DEC-032", "sibling to DEC-062") and are *not*
findings — this shard's deliverable is the subset where the edge carries a **retiring or changing
verb**.

**Method.** Mechanical, not read-through. The graph was built with one `awk` pass that tracks the
enclosing `## DEC-` heading and emits `(source, line, target)` for every `DEC-[0-9]{3}` token outside
a heading; reciprocity is a set membership test on the reversed pair. Relationship edges were then
isolated by verb-adjacency (`(supersed|revers|replac|retir|amend|revis|refin|correct|extend|
resolv|reframe|obsolet|deprecat|rescind)[a-z]* (by|the)? DEC-NNN`) and by the file's own structured
`**Supersedes:** / **Amends:** / **Refines:** / **Relationship:**` lines. Every row below was then
opened and read in context — no row is asserted from the grep alone.

---

## Divergence result (the warning in the brief, resolved — and it is worse than "252 lines")

`git diff main origin/feature/reservations -- docs/DECISIONS.md` = **252 lines, 206+ / 46−**. The
brief predicted "DEC-134–137 and neighbours exist only on the feature branch." That is true but
understates it. The two trees **assign the same numbers to different decisions**:

| id | `main` | `origin/feature/reservations` |
|----|--------|-------------------------------|
| DEC-134 | Real crew never live in a seed script — roster bootstrapped by CLI (`:3849`) | Customer checkout is inline Stripe Elements over a deferred PaymentIntent (`:3952`) |
| DEC-135 | `db:all` — one always-destructive command; the DB resets, the seed registry grows (`:3859`) | The "Your booking" manage page ships view + post-tip + cancel-as-request (`:3962`) |
| DEC-136 | *(absent)* | Real crew never live in a seed script — **`main`'s DEC-134** (`:3972`) |
| DEC-137 | *(absent)* | `db:all` is **retired** in favor of `db:reset:dev` (`:3984`) |
| DEC-138 | The booking flow ships as an embeddable iframe widget (`:3874`) | **SPEC §1.3 rewritten to the DEC-125 model** (`:4040`) |
| DEC-139 | Payments — Stripe card checkout only, no wallets (`:3895`) | *(absent)* |

So **DEC-134, DEC-135 and DEC-138 each denote two different decisions depending on which tree you
read.** This is not a forward-reference problem; it is a collision, and it is already load-bearing on
both trees (Z2-1, Z2-2, Z2-20, Z2-21).

**Feature-branch-only references from `main` — the expected finding class.** `main` cites **DEC-122**
(customer booking link) at five sites: `:3357`, `:3531`, `:3533`, `:3537`, `:3886`. DEC-122 has no
heading on `main` and does have one on `feature/reservations` (`:3414`). This is **correctly
self-documented** — `:3357` says "Numbered **123, not 122** — `feature/reservations` already holds
DEC-122", and `:3533` says "*(DEC-122 itself lives on `feature/reservations` until the P12 merge — a
forward reference from `main`…)*". Recorded as **NOISE**, not a dead link.

**Not a divergence:** `DEC-099–104`. The brief's premise that these are feature-branch DECs is what
the file claims, and it is **false on both trees** — see Z2-4.

---

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| Z2-1 | `DECISIONS.md:3849`, `:3859`, `:3874` vs `feature/reservations` `DECISIONS.md:3952`, `:3962`, `:4040` | `## DEC-134: Real crew never live in a seed script` / `## DEC-135: db:all — one always-destructive command` / `## DEC-138: The customer booking flow ships as an embeddable widget` | **Three ids denote two different decisions each.** On `feature/reservations` the same numbers are DEC-134 *Stripe Elements checkout*, DEC-135 *"Your booking" manage page*, DEC-138 *SPEC §1.3 rewritten to the DEC-125 model*. The feature branch **already renumbered `main`'s pair** to DEC-136/DEC-137, so the collision was seen from one side and resolved only there. Every cross-reference to 134/135/138 in either file is therefore **tree-dependent**, and a merge silently rebinds them. `main`'s DEC-138 was created 2026-07-20 (`:3876`); `feature`'s DEC-138 is shard C's resolution DEC (PR #540). Neither file mentions the other's use of the number | MISMATCH | **decision** |
| Z2-2 | `DECISIONS.md:3859` vs `feature/reservations` `DECISIONS.md:3984` | `main` DEC-135: "`npm run db:all` … takes a dev database to a known-good state in one step" / `feature` DEC-137: "`db:all` **is retired** in favor of `db:reset:dev` — the reservations line got there first" | Beyond the numbering collision (Z2-1) these two **contradict on substance**: one decides `db:all` is *the* command, the other retires it. Neither cites the other. Both are live on their own tree today. This is the one collision where the merge cannot be resolved by renumbering alone — an operator has to pick a command | MISMATCH | **decision** |
| Z2-3 | `DECISIONS.md:3068` | "Joins the existing DEC-026 island family (DEC-097 redirect-feedback, **DEC-100 submit spinner**, DEC-030 CopyButton/RelaySend, the GuestText button)" | **Dead reference.** No `## DEC-100` heading exists on `main` *or* on `origin/feature/reservations`; `grep -rE 'DEC-(099\|101\|102\|103\|104)'` over the whole repo returns nothing either. The described decision exists under a different number: **DEC-089** — "`<SubmitButton>` — standing pending-state client island" (`:2395`), with DEC-090 as its standing rule (`:2407`). Sole dead-token reference in the file | MISMATCH | doc-wrong |
| Z2-4 | `DECISIONS.md:178` and `:2720` | index footer: "_Feature-branch DECs (**099–104**, 122) fold in when they merge._" / DEC-105: "the mechanism DECs (**099–104**, and DEC-138 — embed-first rollout) sit under it" | **A phantom range asserted twice, in the two most authoritative places in the file** (the index footer and the umbrella DEC's own scope statement). `git show origin/feature/reservations:docs/DECISIONS.md \| grep -cE '^## DEC-(099\|100\|101\|102\|103\|104)'` = **0**. They exist on no branch. DEC-105's actual mechanism DECs are **106–113** by content (coexistence partition, payments, public surface, capacity claim, waiver, flag, price, flex-insurance), all of which *do* exist and none of which DEC-105 names. Escaped every prior grep because it is written as an en-dash range, not as `DEC-NNN` tokens | MISMATCH | doc-wrong |
| Z2-5 | `DECISIONS.md:178` | "_Indexed **124 of 124** DECs._" | Both halves wrong. Actual: **135 headings** (130 numbered + 5 named); the index carries rows for **132** of them (131 `- DEC-` rows + DEC-127, which appears only in the index preamble at `:15`). The stated total is 11 short of the real one and the "N of N" framing asserts completeness the file does not have (Z2-6) | MISMATCH | doc-wrong |
| Z2-6 | `DECISIONS.md:15` vs `:3697`, `:3841`, `:3849`, `:3859` | "_Keep current: **every new DEC adds a row here** (DEC-127)._" | **DEC-127's own rule, broken by the four DECs written after it.** No index row exists for **DEC-127** (self-omitted — it is named only in the preamble sentence that states the rule), **DEC-133** (customer availability screen), **DEC-134** or **DEC-135**. The three §Reservations-adjacent ones are exactly the DECs a reader browsing the index would look for. Verified by set-differencing heading ids against index-row ids | MISMATCH | doc-wrong |
| Z2-7 | `DECISIONS.md:1170` (heading + body) vs `:1263`, `:1358`, `:3460`, `:3536` | `## DEC-036: Live Xola API import — Land adapter behind existing Map/Reconcile` — indexed at `:94` as "**(current)**" | **The most-amended DEC in the file, and its body says so nowhere.** Three later DECs change it and all three edges are one-way: **DEC-040** `:1263` "Resolves DEC-036's 'confirm at build' items … this **corrects** its field-mapping guesses"; **DEC-043** `:1358` "**Amends:** DEC-036/DEC-037 (the planned `fetchEvents` half is now the primary adapter; the xlsx upload is **retired**)"; **DEC-124** `:3460` (heading) "**reverses DEC-036's tip parking**" + `:3536` "**Amends DEC-036** (its tip/gratuity/guide-machinery parking only)". DEC-036's body (`:1170–1200`) references DEC-011/014/015/017/018/020/029/032/035 — **none of 040, 043, 124**. A reader landing on DEC-036 gets the xlsx-primary ingest and parked tips, both retired, under an index label reading "(current)" | MISMATCH | doc-wrong |
| Z2-8 | `DECISIONS.md:3681` vs `:2717–2762` | DEC-126: "but DEC-126 **does reverse DEC-105's 'no migration' leg** — there *is* a one-time migration, by design" | **A stated reversal with no forward pointer and no index mark.** DEC-105's body cites DEC-011/045/082/106/108/111/138 — never DEC-126. The index row (`:153`) reads "DEC-105 — reservations go live 2026 as a Muster-native parallel-run (pilot)" with no strike or amendment note, and DEC-105's own text at `:2757` still says "supersedes SPEC §0.3 timing + §4 portal/payments-out-of-2026 park", the pre-cutover framing. This is the same shape shard C2.3 found in SPEC §2.3 and shard A found at DEC-107 | MISMATCH | doc-wrong |
| Z2-9 | `DECISIONS.md:1257` vs `:1226–1245` | DEC-039: "**Relationship:** **supersedes the DEC-038 single always-bailing 'Remove' button**" | One-way, and **not covered by the index** — DEC-038's row (`:161`) reads "pilot-walkthrough UX/copy revisions" with no strike. DEC-038's body references DEC-007/019/028/031 and never DEC-039. Notable because DEC-038 *does* carry a correct reciprocal edge with DEC-031 (`:1236` ↔ `:1079`, see NOISE), so the mechanism was understood here and not applied to its sibling | MISMATCH | doc-wrong |
| Z2-10 | `DECISIONS.md:1136` vs `:717–753` | DEC-032: "**Why it matters:** DEC-022's '**render everything UTC**' v1 simplification showed an Eastern 6:50 AM departure as a wrong wall-clock" — the line is verbed "**Revises DEC-022**" | DEC-022's body (`:717–753`) cites DEC-004/005/019/021 and never DEC-032. Index rows for both (`:71`, `:72`) are unmarked. So the *stored-time* decision still reads as though "render everything UTC" stands, when DEC-032 replaced it with vessel-local rendering everywhere — the invariant three later shards (C2.1-10, #557, C2.3 AC-1) all had to re-derive from source | MISMATCH | doc-wrong |
| Z2-11 | `DECISIONS.md:2454`/`:2485` and `:3308`/`:3348` vs `:676–693` | DEC-092 heading: "(10.2, #283; **revises DEC-020**)"; body `:2485` "**Relationship.** **Revises DEC-020** (only its 'admin is a free-form non-identity' clause)". DEC-121 heading: "(**refines DEC-020**)"; body `:3348` "**Refines** DEC-020 (the runner)" | DEC-020 is the standing stack DEC and is **amended twice with no back-pointer either time**. Its body (`:676–693`) cites only DEC-010 and DEC-013. The index carries the relation on the *amending* rows (`:135`, `:175`) but DEC-020's own row (`:172`) is labelled "**(current)**" unqualified — the same "(current)" mislabel as Z2-7 | MISMATCH | doc-wrong |
| Z2-12 | `DECISIONS.md:1724` | DEC-065: "**Supersedes:** the membership half of the board's willingness-exhaustion rule." | **A supersede claim that names no DEC and no SPEC section** — the only untraceable relationship edge in the file. The rule it retires lives in SPEC §2.5 (and its acceptance criterion), which the same paragraph gestures at as "the §2.5 board copy rationale" without a supersede verb attached. This is the **origin** of shard C2.5's finding that §2.5's AC-1 still specifies the exact defect DEC-065 was filed to fix: there was never a pointer to follow. Compare DEC-082's `:2143` "**Supersedes / reframes:** SPEC §2.3's **Lock** action + **Lock semantics** section", which names the target and is why C2.3 could check it | MISMATCH | doc-wrong |
| Z2-13 | `DECISIONS.md:294`, `:560`, `:584`, `:974`, `:322` | The five **index-struck** supersessions: `~~DEC-011~~ → DEC-036` (`:85`), `~~DEC-016~~ → DEC-043` (`:87`), `~~DEC-017~~ → DEC-040` (`:88`), `~~DEC-029~~ → DEC-082` (`:89`), `~~DEC-013~~ → DEC-020` (`:171`) | **The index carries all five; not one of the five bodies does.** DEC-011's body (`:294–309`) cites DEC-012/015 only; DEC-016's cites DEC-014 only; DEC-017's cites nothing; DEC-029's cites DEC-005/016/017/026; DEC-013's cites nothing. Lower severity than Z2-7/8/9 because the index *is* a pointer — but only for a reader who arrives via the index. Anyone arriving by `Ctrl-F "DEC-029"`, by a code comment, or from another doc's citation lands in the body and reads the retired answer with no signal. Every other shard in this run arrived exactly that way | MISMATCH | doc-wrong |
| Z2-14 | `DECISIONS.md:3718` vs `:649–675`, `:1246–1260` | DEC-128: "**Amends:** DEC-019 (`Bailed` no longer the AtRisk source — the seat-fold branch is legacy-only), **DEC-039/#87** (vacate rests `Open` and fires no asks), **DEC-063** (**reverses** its 'Bail/vacate re-asks stay blast-all' clause…)" | **Three amendments from one line; one reciprocated, two not.** DEC-063 has the back-pointer (`:1701` "Amended by DEC-128") — the file's cleanest example. DEC-019 has an **index-only** note (`:39` "_(bail/vacate re-crewing now deferred to the tick — DEC-128)_") and a silent body. **DEC-039 has neither** — no body reference, no index note (`:44`), despite being the DEC that *defined* the vacate path DEC-128 changed | MISMATCH | doc-wrong |
| Z2-15 | `DECISIONS.md:3299` vs `:260–272`, `:957–973` | DEC-120: "**Amends** DEC-008 (decline-neutral) and DEC-028 (bail lateness floor). **Weights only**" | Both targets silent. DEC-008 is the *scoring* DEC and DEC-028 the *lateness* DEC — the two a reader consults when a reliability number looks wrong. Their index rows (`:66`, `:71`) are unmarked; DEC-120's row (`:67`) carries the relation. Mitigant: DEC-120's own scope line says "weights only", so the structural claims in 008/028 remain true — which is why this is one-way and not contradictory | MISMATCH | doc-wrong |
| Z2-16 | `DECISIONS.md:2598`, `:2241`, `:3083` vs `:859–896` | DEC-095 heading: "Operator At-Risk alert — **the deferred delivery half of DEC-026**"; DEC-085 `:2241` "builds on DEC-042 …, **DEC-026** (no-JS forms + server render)"; DEC-114 `:3083` "**extends DEC-026**, protects DEC-085" | DEC-026 is the file's most-extended DEC after DEC-020 and its body (`:859–896`) points forward to none of them — it cites DEC-008/022/023/024 only. DEC-095 is the sharp one: it **completes a half DEC-026 explicitly deferred**, so DEC-026's "deliver-later" leg is now decided elsewhere with no trail. (DEC-085's `:2232` mention of DEC-026 is a *rebuttal* of a claim, not a change, and is excluded from the edge table) | MISMATCH | doc-wrong |
| Z2-17 | `DECISIONS.md:2076`/`:2079` vs `:2000–2044` | DEC-081 heading: "…and it's the one login primitive (**refines DEC-079**)"; body `:2079` "**Refines DEC-079's mechanism** after building it surfaced four…" | DEC-079's body cites DEC-030 only. The index carries it on DEC-081's row (`:134`), not DEC-079's (`:133`). Consequence is concrete: DEC-079 still describes a **magic-link** front door, which DEC-081 replaced with a **6-digit email code** — the exact class of stale-primary-mechanism claim shard B found three of in `AUTH.md` | MISMATCH | doc-wrong |
| Z2-18 | `DECISIONS.md:2282` vs `:694–716` | DEC-086: "**Relationship:** **refines DEC-021** (adds *informational* tokens to the **locked palette**)" | DEC-021's body cites DEC-020 only and still presents the palette as closed. Neither index row (`:159`, `:165`) is marked. Same shape as Z2-17 at lower stakes — but "locked palette" is precisely the kind of word a later reader treats as a constraint | MISMATCH | doc-wrong |
| Z2-19 | `DECISIONS.md:504` | DEC-015: "**Supersedes** an earlier informal **DEC-015** sketch that assumed only an aggregated revenue report with…" | **A DEC that supersedes itself.** The "earlier informal DEC-015 sketch" is not in the file, in git history of the file under that id, or anywhere else in the corpus — the id was reused rather than retired. Harmless in effect, but it is the one edge in the graph that cannot be followed in either direction, and it makes `DEC-015` ambiguous in any citation that predates this line | UNVERIFIABLE | doc-wrong |
| Z2-20 | `DECISIONS.md:1713` vs `feature/reservations` `DECISIONS.md:1710` | DEC-064: "…then `db/seed-pilot-crew.ts`; that script was **retired by DEC-134** — the same…" | **The edge is correct on `main` and correct on `feature`, and the two are correct about different things.** `feature`'s copy of the same sentence reads "retired by **DEC-136**". So the identical prose in two trees names two different ids for one fact, and each is right locally. This is Z2-1 made concrete: a merge that keeps `main`'s numbering breaks `feature`'s sentence, and vice versa. Post-merge, exactly one of these lines will point at a Stripe checkout DEC | MISMATCH | **decision** |
| Z2-21 | `DECISIONS.md:2720` | DEC-105: "the mechanism DECs (099–104, and **DEC-138** — embed-first rollout) sit under it" | Second half of Z2-4's line, and a second collision hazard. On `main` this resolves to the **embeddable-widget** DEC (`:3874`) and the gloss is accurate. On `feature/reservations`, DEC-138 is **SPEC §1.3 rewritten to the DEC-125 model** (`:4040`), which is not a mechanism DEC under DEC-105 at all. The reference **inverts on merge** without any line being edited | MISMATCH | **decision** |
| Z2-22 | `DECISIONS.md:2795–2863` vs `feature/reservations` `DECISIONS.md:2795–2799` | `main` DEC-107 body carries **no** reversal banner; `feature`'s carries "**⚠️ The hosted-Checkout decision below was REVERSED for the customer booking charge by DEC-134 (12.5)** … Read DEC-134 before acting on the Decision paragraph." | Shard A's headline fix (PR #538) **landed on `feature/reservations` only**, which was correct — the reversing DEC lives there. But `main`'s DEC-134 is the *seed-script* DEC, so at merge the banner's "DEC-134" either survives pointing at the wrong decision or has to be renumbered by hand. Recorded so the merge does not silently inherit shard A's fix as a wrong pointer | MISMATCH | known (shard A / PR #538) |

---

## One-way supersede edges (complete)

Every edge where **DEC-X's body claims to supersede, amend, reverse, replace, retire, correct, revise
or refine DEC-Y**, and **DEC-Y's body contains no reference to DEC-X**. Purely additive citations
("reuses", "sibling to", "builds on", "compatible with", "extends" where the source states the target
is untouched) are **excluded** — they are the bulk of the other 384 one-way pairs and are not defects.

**28 edges, 27 with a named target.** "Index?" = whether the *index* carries the relation on the
target's row, which is the only mitigation present anywhere.

| # | source (verb) | source line | target | target heading line | index? |
|---|---------------|-------------|--------|---------------------|--------|
| 1 | DEC-036 — *supersedes … API kill* | `:1170`, `:1186` | DEC-011 | `:294` | ✅ struck `:85` |
| 2 | DEC-043 — *supersedes … collapse* | `:1341`, `:1358` | DEC-016 | `:560` | ✅ struck `:87` |
| 3 | DEC-040 — *retires … email-join* | `:1285` | DEC-017 | `:584` | ✅ struck `:88` |
| 4 | DEC-082 — *reframes* | `:2133`, `:2143` | DEC-029 | `:974` | ✅ struck `:89` |
| 5 | DEC-020 — *Resolves* | `:677` | DEC-013 | `:322` | ✅ struck `:171` |
| 6 | DEC-039 — *supersedes the … "Remove" button* | `:1257` | DEC-038 | `:1226` | ❌ |
| 7 | DEC-032 — *Revises* | `:1136` | DEC-022 | `:717` | ❌ |
| 8 | DEC-040 — *Resolves / corrects … field-mapping guesses* | `:1261`, `:1263`, `:1265` | DEC-036 | `:1170` | ❌ (labelled "(current)") |
| 9 | DEC-043 — *Amends* | `:1358` | DEC-036 | `:1170` | ❌ (labelled "(current)") |
| 10 | DEC-043 — *Amends* | `:1358` | DEC-037 | `:1201` | ❌ |
| 11 | DEC-043 — *Amends (quarantine keys off `resource.id`)* | `:1358` | DEC-018 | `:613` | ❌ |
| 12 | DEC-043 — *Amends (`vesselId` joins the material set)* | `:1358` | DEC-029 | `:974` | ⚠️ struck to DEC-082 only |
| 13 | DEC-124 — *reverses … tip parking* / *Amends* | `:3460`, `:3536` | DEC-036 | `:1170` | ❌ (labelled "(current)") |
| 14 | DEC-126 — *does reverse … "no migration" leg* | `:3681` | DEC-105 | `:2717` | ❌ |
| 15 | DEC-092 — *revises* | `:2454`, `:2485` | DEC-020 | `:676` | ❌ (labelled "(current)") |
| 16 | DEC-121 — *refines* | `:3308`, `:3348` | DEC-020 | `:676` | ❌ (labelled "(current)") |
| 17 | DEC-081 — *refines … mechanism* | `:2076`, `:2079` | DEC-079 | `:2000` | ❌ |
| 18 | DEC-086 — *refines (adds tokens to the locked palette)* | `:2282` | DEC-021 | `:694` | ❌ |
| 19 | DEC-120 — *Amends (decline-neutral)* | `:3299` | DEC-008 | `:260` | ❌ |
| 20 | DEC-120 — *Amends (bail lateness floor)* | `:3299` | DEC-028 | `:957` | ❌ |
| 21 | DEC-128 — *Amends* | `:3718` | DEC-019 | `:649` | ⚠️ index-only note `:39` |
| 22 | DEC-128 — *Amends* | `:3718` | DEC-039 | `:1246` | ❌ |
| 23 | DEC-088 — *Refines* | `:2381` | DEC-063 | `:1700` | ❌ |
| 24 | DEC-095 — *the deferred delivery half of* | `:2596`, `:2598` | DEC-026 | `:859` | ⚠️ on DEC-095's row only |
| 25 | DEC-106 — *Extends the … import merge rule* | `:2765` | DEC-029 | `:974` | ⚠️ struck to DEC-082 only |
| 26 | DEC-106 — *Extends the … import merge rule* | `:2765` | DEC-043 | `:1341` | ❌ |
| 27 | DEC-041 — *Supersedes the `Event.durationMinutes` line* | `:1308` | DEC-021 | `:694` | ❌ |
| 28 | DEC-065 — *Supersedes: the membership half of the board's willingness-exhaustion rule* | `:1724` | **unnamed** | — | ❌ |

**Reading of the table.** Five of 28 are index-mitigated strikes (rows 1–5); three more are partial
(12/21/24/25). **Twenty are unmitigated in both places.** The three targets that carry a "(current)"
label in the index while being amended — **DEC-036** (three amendments) and **DEC-020** (two) — are
the worst cases, because the index actively asserts the opposite of the truth.

---

## "Amends SPEC" claims (complete — input to Z3)

Every instance where a DEC says it amends, supersedes, corrects, refines, reframes, unlocks,
re-reconciles or realizes a **SPEC section**. **Not verified against `SPEC.md` here** — that is Z3's
job. One row per claim; `verb` is quoted from the line.

**23 claims across 15 DECs.**

| # | DEC | line | verb (verbatim) | SPEC section named |
|---|-----|------|-----------------|--------------------|
| S1 | DEC-012 | `:315` | "the 2026 write-back sheet **retires**" | §0.4, §2.6.3 |
| S2 | DEC-016 | `:561` | "**Corrects** the SPEC v1.0 worked example (a DEC-014-permitted *correction*, not new scope)" | SPEC v1.0 worked example (§1) |
| S3 | DEC-016 | `:575` | "**Owed SPEC correction** (lands with this DEC)" | §1 glossary ("Required seat", …) |
| S4 | DEC-029 | `:976` | "The SPEC §2.3 builder nudge … **is** `max(reservation.updatedAt) > shift.lockedAt`" (a realization; **itself later killed by DEC-082**, S11/S12) | §2.3 |
| S5 | DEC-029 | `:991` | "SPEC says 'new **or** changed'" (cited as binding text) | §2.3 |
| S6 | DEC-036 | `:1186` | "**corrects** SPEC §4 'Explicitly killed · The Xola API bolt-on' (a DEC-014 correction)" | §4 |
| S7 | DEC-045 | `:1378` | "a deliberate **SPEC v1.1 unlock** under DEC-014, **not** a correction to the frozen v1.0 baseline" | §2.6.3 → §4 (`:1379`) |
| S8 | DEC-045 | `:1388–1389` | "A **v1.1 spec-edit ceremony is owed** (the SPEC stays untouched until that batch lands — this phase does not edit `docs/SPEC.md`)" | — (whole-file, deferred) |
| S9 | DEC-061 | `:1686` | "**Tradeoff / supersedes:** **Amends SPEC §2.4** (the 'confirm down the list' step) and the **§2.6 acceptance** ('…and Spink confirming moves the seat'), now auto" | §2.4, §2.6 |
| S10 | DEC-063 | `:1706` | "**Refines:** SPEC §1.2, DEC-007 (fan-out timing)…" | §1.2 |
| S11 | DEC-082 | `:2133` (heading) | "**supersedes SPEC §2.3 Lock**" | §2.3 |
| S12 | DEC-082 | `:2143` | "**Supersedes / reframes:** SPEC §2.3's **Lock** action + **Lock semantics** section (not built)" | §2.3 |
| S13 | DEC-083 | `:2162` | "SPEC §2.3's **definition** ('two shifts whose trips partition the original's')" — cited as binding, and the wording C2.3-11 flagged | §2.3 |
| S14 | DEC-083 | `:2174` | "**implements SPEC §2.3 Split action + AC**" | §2.3 |
| S15 | DEC-083 | `:2176` | "**Amendment** — freshly-spawned-shift cue (9.10/#236): SPEC §2.3's 'new block needing review' text is **realized as** a second muted row cue" | §2.3 |
| S16 | DEC-083 | `:2179` | "This **formally supersedes** the mockup/**SPEC amber** 'new · review' treatment DEC-082 already killed" | §2.3 (amber cue) |
| S17 | DEC-084 | `:2209` | "**implements the SPEC §2.3 Merge action's** crew-facing half" | §2.3 |
| S18 | DEC-085 | `:2236` | "Day-grouping blessed (**supersedes SPEC §2.3 'grouped by boat then day'**)" | §2.3 |
| S19 | DEC-105 | `:2720` | "(SPEC §0.2/§0.3/§2.2/§4)" — the umbrella DEC's declared SPEC surface | §0.2, §0.3, §2.2, §4 |
| S20 | DEC-105 | `:2757` | "**supersedes SPEC §0.3 timing + §4 portal/payments-out-of-2026 park** (amend via a SPEC v1.1 §2.8 write-up per the DEC-045 precedent…)" | §0.3, §4 → new §2.8 |
| S21 | DEC-124 | `:3466` | quotes DEC-036's "payments parked, **SPEC §4**" and **reverses it** ("That is…") | §4 |
| S22 | DEC-126 | `:3682` | "**SPEC §0.3/§4 are re-reconciled** for this (they had been written to 'no cutover')" | §0.3, §4 |
| S23 | DEC-128 | `:3707` | "The **tick is the sole ask-writer** again (**SPEC §1.2**, DEC-063)" — cited as the restored contract | §1.2 |

**Two notes for Z3, not verdicts.**
- **§2.3 dominates: 8 of 23 claims** (S4, S11–S18). That section is also the one shard C2.3 found had a
  reconciliation pass that stopped at three of five blocks. The density is a signal about where to look
  first, not evidence of anything.
- **Three claims are explicitly *unpaid*, by their own text**: S3 ("Owed SPEC correction"), S8 ("a v1.1
  spec-edit ceremony is owed … this phase does not edit `docs/SPEC.md`") and S20 ("amend via a SPEC v1.1
  §2.8 write-up" — future tense). These are the highest-yield rows for Z3: the DEC states the doc edit
  has not happened, so no cross-check is needed to know a debt exists — only to see whether it was
  later paid.
- **One claim has no SPEC section to check** — DEC-065's `:1724` "Supersedes: the membership half of the
  board's willingness-exhaustion rule" (Z2-12). It belongs in Z3's scope by subject (§2.5) and cannot be
  reached by grepping for "SPEC §".

---

## Supersede-vocabulary self-consistency (brief item 5 — reported, not taxonomized)

**Verbs observed carrying a relationship to another DEC**, with counts of verb-adjacent occurrences
(`<verb> [the] DEC-NNN`, headings and bodies):

`supersedes/superseded by` ×9 · `resolves/Resolves` ×7 · `refines/Refines` ×6 · `extends/Extends` ×5 ·
`builds on` ×4 · `revises/Revises` ×2 · `retires/retired by` ×2 · `corrects/Corrects` ×2 ·
`amends/Amends` ×2 (plus `Amends:` block-verbs at `:1358`, `:3299`, `:3718`) · `reverses/reverse` ×2 ·
`reframes` ×1.

**What's actually there, as observed:**

1. **They are not used with distinct meanings, and two verbs carry both a strong and a weak sense.**
   `supersedes` means "this one is dead" at `:85` (`~~DEC-011~~ → superseded by DEC-036`) and means
   "one clause of this is dead" at `:1257` (DEC-039 supersedes only DEC-038's *Remove button*) and at
   `:1308` (DEC-041 supersedes only "the `Event.durationMinutes` line of #92"). `extends` is additive
   at `:2540` (DEC-094) and **changing** at `:2765` (DEC-106 "Extends the DEC-029/043 import merge
   rule", which alters the rule). A grep for `supersed` therefore over-returns and a grep for
   `extends` under-returns.
2. **`resolves` is overloaded onto a different axis entirely.** At `:677` and `:1261` it means "closes
   an open question this DEC left" (DEC-020 resolves DEC-013; DEC-040 resolves DEC-036) — a
   *completion*, not a retirement. At `:530` it means "verifies a data assumption". Neither sense
   retires the target, but both read like they might.
3. **`refines` and `revises` are used interchangeably.** DEC-081 "refines DEC-079" (`:2079`) and
   DEC-092 "Revises DEC-020" (`:2485`) are structurally identical acts — each narrows one clause of an
   earlier DEC while leaving the rest standing. Nothing in the file distinguishes them.
4. **Three structured block-verbs exist and are used inconsistently.** `**Supersedes:**` (`:1358`,
   `:1724`), `**Amends:**` (`:1358`, `:3299`, `:3718`) and `**Refines:**` (`:1706`, `:2381`) are the
   only machine-greppable relationship declarations. The majority of relationship claims instead ride
   inside a prose `**Relationship:**` line (16 of them) or inside the **heading** (`:1170`, `:1341`,
   `:2076`, `:2133`, `:2454`, `:3308`, `:3460`), where the verb is in a parenthetical.
5. **Consequence, which is the reason the brief asked.** There is **no single grep that finds the edge
   set.** Building the 28-row table above needed a verb-alternation regex, the structured block-verbs,
   the heading parentheticals *and* a full read of every `**Relationship:**` line — four passes. That
   is precisely why the one-way edges accumulated: the vocabulary is not checkable, so nobody checked
   it. Recorded as an observation; **no taxonomy is proposed here** (per the brief), and the
   restructure question is Z4's.

---

## What this shard would recommend

**The headline is not the one-way edges — it is the numbering collision (Z2-1, Z2-2, Z2-20, Z2-21).**
Three ids (134, 135, 138) denote different decisions on `main` and `feature/reservations`, and one
pair (`main` DEC-135 vs `feature` DEC-137) **decides the opposite thing about the same command**.
`feature` already renumbered `main`'s pair to 136/137, which means the collision was noticed from one
side and fixed only there — the classic half-reconciliation this run keeps finding. Every existing
cross-reference to those ids is tree-dependent, including shard A's own fix (Z2-22: `main`'s DEC-107
will inherit a banner pointing at "DEC-134" that resolves to a seed-script decision). **This needs an
operator call before the P12 merge, not after**, and it is cheap now and expensive later — three
renumbers and ~6 citation edits today, versus a hand-reconciliation of a 252-line diff at merge time.

**Four dead or false structural claims, all in the index or in DEC-105 (Z2-3 to Z2-6).** `DEC-100`
does not exist (it's DEC-089). `DEC-099–104` do not exist **on any branch**, yet the index footer and
DEC-105's own scope sentence both assert they do — DEC-105's real mechanism DECs are 106–113 and it
names none of them. "Indexed 124 of 124" is wrong twice over (135 headings, 132 indexed). And DEC-127's
"every new DEC adds a row here" has been broken by **every DEC written since DEC-127** — 133, 134, 135,
and DEC-127 itself. These are five one-line edits with no judgment required; they are the same
"finishing a pass that stopped early" shape as C2.3-1.

**Twenty unmitigated one-way supersede edges (the table above).** The pattern this shard was built to
find, and it is denser than the two prior hits suggested. The three highest-consequence targets are
**DEC-036** (corrected by DEC-040, amended by DEC-043, partly reversed by DEC-124 — and labelled
"**(current)**" in the index), **DEC-020** (revised by DEC-092, refined by DEC-121 — also labelled
"(current)"), and **DEC-105** (its "no migration" leg reversed by DEC-126, unmarked). In all three the
index does not merely omit the pointer — it **asserts currency**. A reader who checks the index before
reading is *more* misled than one who doesn't.

**The five index-struck-but-body-silent edges (Z2-13) are a different, lower-severity call.** The
index does carry them, so the information exists. Whether that's sufficient is an operator judgment
about how this file is actually read — and the evidence from this audit run is that it is read by
`Ctrl-F` and by citation-following, not by browsing the index. Shard A landed on DEC-107 directly;
shard C2.7 landed on DEC-078 directly. Both times the body was the surviving wrong answer.

**Two edges are worth fixing for a reason beyond tidiness.** DEC-079 (Z2-17) still describes a
**magic-link** crew front door that DEC-081 replaced with a 6-digit code — a stale *primary mechanism*,
the same class shard B found three of in `AUTH.md`. And DEC-022 (Z2-10) still reads as though "render
everything UTC" stands, when DEC-032 replaced it; that invariant has now been independently re-derived
from source by three separate shards (C2.1-10, C2.3 AC-1, #557) because the DEC could not be trusted.

**One thing to not do.** DEC-065's unnamed supersede (Z2-12) should not be closed by deleting the
sentence. It is the only record that the board's membership rule changed, and shard C2.5 has already
shown what its absence costs downstream. It needs a target, not a strike.

---

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| **All 711 `DEC-NNN` references in the file resolve to a heading on one tree or the other, except two ids** | whole-file | Set-differenced every referenced id against every `^## DEC-` heading on `main` and on `origin/feature/reservations`. Only **DEC-100** (Z2-3) and the **099–104** range (Z2-4) resolve nowhere. **DEC-122** resolves on `feature` and is self-documented as a forward reference. There is no third dead-link class — the graph is, at token level, in better shape than the finding count suggests |
| DEC-122's five `main`-side references are a **known, labelled** forward reference, not a dead link | `:3357`, `:3531`, `:3533`, `:3537`, `:3886` | `:3357` — "Numbered **123, not 122** — `feature/reservations` already holds DEC-122 (the…"; `:3533` — "*(DEC-122 itself lives on `feature/reservations` until the P12 merge — a forward reference from `main`…)*". The renumber-to-avoid-collision that DEC-123 performed here is **exactly the discipline missing at 134/135/138** (Z2-1) — the file knows how to do this |
| **DEC-063 ↔ DEC-128 is the model reciprocal edge** and should be the template for any fix | `:1701` ↔ `:3718` | DEC-128 declares "**Amends:** … **DEC-063** (reverses its 'Bail/vacate re-asks stay blast-all' clause)"; DEC-063's body carries "**Amended by DEC-128**" at `:1701`, inline, one line under its own Decision paragraph. Both index rows (`:41`, `:40`) also carry it. This is the only edge in the file with all four pointers present |
| **DEC-031 ↔ DEC-038 is reciprocal**, and unusually well-done | `:1079` ↔ `:1236`, `:1242` | DEC-038 `:1242` "**Relationship:** amends DEC-031 (fills-by display/label)"; DEC-031 `:1079` carries a block-quoted banner — "> **Superseded display (DEC-038):** the concept and code symbols … are unchanged, but the **board no longer renders this line**". It scopes *what* was superseded (display, not mechanic), which is the distinction Z2-13's bare index strikes lose. Worth noting because DEC-038's *other* edge (to DEC-039) is one-way — the same DEC got it right once and wrong once |
| DEC-123 ↔ DEC-125 reciprocal | `:3369` ↔ `:3548` | DEC-125 `:3548` "**Corrects** DEC-123's withdrawn 'eager event…'"; DEC-123's body references DEC-125 back at `:3369`. Clean |
| DEC-125 ↔ DEC-126 reciprocal | `:3559` ↔ `:3655` | Both directions present. Notable because DEC-126's *other* reversal (of DEC-105) is one-way (Z2-8) — same DEC, one edge wired and one not |
| DEC-105 ↔ DEC-138 and DEC-138 ↔ DEC-139 reciprocal | `:2720` ↔ `:3876`; `:3887` ↔ `:3897` | The three newest `main` DECs are the best-wired cluster in the file. (The DEC-105→DEC-138 edge is still a **collision** hazard — Z2-21 — but that is a numbering defect, not a graph defect) |
| DEC-107 ↔ DEC-124 reciprocal on `main` | `:2846` ↔ `:3537` | DEC-107's body references DEC-124 and DEC-124's references DEC-107. Distinct from Z2-22, which is about the **DEC-134 reversal banner**, not this pair |
| DEC-116 ↔ DEC-117 and DEC-085 ↔ DEC-086 reciprocal | `:3135` ↔ `:3147`; `:2239` ↔ `:2283` | Both pairs shipped together, which is likely why both are wired. Pairs written weeks apart are the ones that go one-way |
| DEC-015 ↔ DEC-011 and DEC-015 ↔ DEC-012 reciprocal | `:306`, `:318` ↔ `:530` | DEC-015 `:530` "**Resolves the DEC-011/012 M1 verification — but only the *data-availability* half**" and both targets point back. The *earliest* DECs in the file are wired; the discipline decayed over time rather than never existing |
| `DEC-TBD`'s two "RESOLVED by" pointers both resolve | `:3914`, `:3943` | "RESOLVED by DEC-020" (`## DEC-020` @ `:676`) and "RESOLVED by DEC-060" (`## DEC-060` @ `:1683`). Also `:3940` "SETTLED by…" — checked, resolves |
| DEC-085's `:2232` "superseded by DEC-042/026" is **not** a supersede claim | `:2232` | It is a **rebuttal** of a claim someone else made: "…two-pane layout as 'superseded by DEC-042/026' — **no DEC forecloses a server-rendered two-pane**". Excluded from the edge table deliberately; a naive verb-grep counts it as an edge and it is the opposite of one |
| The 5 named DECs (`DEC-MSG-1/2/3`, `DEC-ROLE-1`, `DEC-DATA-1`) participate in no supersede edge in either direction | whole-file | All five are cited (DEC-ROLE-1 heavily — `:1358`, `:2350` and passim) and none is superseded, amended or reversed by anything. The `DEC-131` ↔ `DEC-DATA-1` relationship is a **scoping clarification** carried correctly in the index (`:29–30`, including the "⚠️ ~19 migration headers miscite DEC-DATA-1" note) and in DEC-131's body. No finding |

---

## Coverage — what this shard did and did not read

- **No acceptance criteria exist in this subject.** `docs/DECISIONS.md` contains no `- [ ]` checkbox
  anywhere; it is a decision log, not a spec. The per-AC verdict section that C2.1–C2.6 carry is
  therefore **omitted by design**, not skipped.
- **Read mechanically, in full:** all 3,949 lines were parsed for `^## DEC-` headings and
  `DEC-[0-9]{3}` tokens (711 references → 428 ordered pairs → reciprocity test). The heading set and
  the index-row set were extracted and set-differenced. No line was excluded from the mechanical pass.
- **Read by eye, in context:** the index block (`:1–178`) in full; every line in the verb-adjacency hit
  set (47 lines) plus surrounding context; all 24 structured `**Supersedes/Amends/Refines/
  Relationship:**` lines; all 68 lines containing "SPEC"; the bodies of DEC-011, 013, 016, 017, 019,
  020, 021, 022, 026, 029, 031, 036, 038, 039, 042, 043, 062, 063, 065, 079, 085, 092, 105, 107, 134,
  135, 138 (to confirm the **absence** of each back-pointer — an absence claim needs the body read,
  not grepped).
- **Read on `origin/feature/reservations`:** the heading list in full, DEC-107's opening banner,
  DEC-064's `:1710`, and the DEC-134–138 headings. The feature tree's *bodies* were **not** read —
  this shard audits `main`'s graph and uses `feature` only as a divergence comparand.
- **Not read / not done:** the body prose of any DEC not listed above (content is out of scope by the
  brief — this shard audits edges); **no verification of any "Amends SPEC" claim against `SPEC.md`**
  (Z3's job, and the S1–S23 table is the handoff); no reference audit of `DEC-NNN` citations in
  *other* files (`SPEC.md`, code comments, migration headers) — the index's own "⚠️ ~19 migration
  headers miscite DEC-DATA-1" note at `:30` suggests that outbound graph has its own findings, and it
  is a different subject; **no restructure proposal** (Z4 owns that, per the brief); no edits to any
  file other than this ledger.
- **One limit worth stating.** Reciprocity was tested on *token presence*, so a back-pointer that
  exists but is wrong (points at the right id for the wrong reason) reads as "BOTH" here. Spot-checked
  on all 10 reciprocal pairs in the NOISE table — all 10 are genuine — but the method would not catch
  an eleventh.

## Cost

**~78k subagent tokens** — the cheapest shard in the run, and for a structural reason worth recording.
This subject is the first one that is **mechanically decidable**: the graph is extractable with one
`awk` pass and reciprocity is a set test, so the expensive part of every prior shard — proving a
negative by reading code — collapsed into a `comm` on two sorted files. Almost the entire spend was
the second pass: opening ~27 DEC bodies to confirm that a back-pointer is genuinely *absent* rather
than phrased differently, which a grep cannot settle. **Transferable: any audit subject that is a
graph over ids should be extracted before it is read.** The 384 raw one-way pairs would have been
unreadable as prose; as a table filtered by verb they reduced to 28 rows.
