# Shard Z4 — DECISIONS.md internal contradictions + the ACTIVE/archive question

**Subject:** `docs/DECISIONS.md` read as a **body of reasoning**, not as a structure. Two halves:
**(A)** two DECs that disagree on the same subject where neither supersedes the other, so the answer a
reader gets depends on which one they find first; **(B)** the evidence an ACTIVE/archive decision needs.
Part B **gathers and does not conclude** — no option is recommended, and nothing in the file was moved,
renumbered, reordered or archived.

**Audited tree:** `main` @ `362fe5f` (branch `task/audit-shard-z`). `docs/DECISIONS.md` = **3,949 lines,
135 numbered DECs + `DEC-TBD`** (`grep -c '^## DEC'` = 136).

> **Which-tree check (lesson 4) — and here it is the subject, not a formality.**
> `git diff main origin/feature/reservations -- docs/DECISIONS.md` = **252 lines changed
> (206 insertions / 46 deletions) across 11 hunks.** Unlike §2.x, the divergence is *not* confined to a
> region this shard can route around: it includes an **83-line DEC that exists only on the feature
> branch**, a **renumbering of `main`'s DEC-134/135 into 136/137**, and a **head-on collision on the
> number DEC-138**, which names two unrelated decisions depending on the branch. The full hunk inventory
> and its consequences for a restructure are Part B, table **B3**.

**Pre-flight adopted from lesson 11 (C2.4's proposal).** Before reading any DEC body, the file was swept
for every self-declared amendment — `Supersedes` / `Superseded by` / `Amends` / `Reversed by` / `Refines`
/ `Evolves` — **63 hits**. Each hit names a doc edit that may never have happened. Six of the eleven findings
below came straight off that list; it is the cheapest move in this shard and should be standing practice.

**Evidence read.** `DECISIONS.md`: the Index in full (`:13–177`), and in full DEC-002, DEC-003, DEC-004,
DEC-006, DEC-007, DEC-010, DEC-DATA-1, DEC-061, DEC-063, DEC-077, DEC-078, DEC-081, DEC-082, DEC-105,
DEC-126, DEC-127, DEC-131, DEC-134, DEC-135, DEC-138, DEC-139; targeted reads of DEC-011, DEC-013,
DEC-016, DEC-017, DEC-029, DEC-036, DEC-043, DEC-064, DEC-079, DEC-087, DEC-092, DEC-097, DEC-098,
DEC-125. `origin/feature/reservations:docs/DECISIONS.md` — DEC-134–138 heads + the DEC-138 body head.
Code: `src/asks/claim.ts` (full), `src/oracle/claimable.ts:20–110`, `src/oracle/oracle.ts:1–30`,
`src/asks/ask-loop.ts` (grep-targeted), `src/domain/entities.ts:110–150`, `src/asks/escalate.ts:12–25`.
`docs/SPEC.md:239–260`, `:1240–1295`. `docs/RETROSPECTIVES.md:188`. `db/migrations/` headers (grep only).
GitHub: #440 (closed), #554, #560, #561 (open), PR #540.

---

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| Z4-1 | `DECISIONS.md:3874` (`main`) vs `DECISIONS.md:4040` (`origin/feature/reservations`) | `main`: "## **DEC-138**: The customer booking flow ships as an **embeddable widget** — the BrewBoat rollout path and the multi-tenant seam" · feature: "## **DEC-138**: **SPEC §1.3 rewritten to the DEC-125 model** — availability is two mechanisms, not one rule engine; COI-expiry and lead-time cutoff closed as out of scope" | **The same number names two unrelated, both-live decisions on two branches that must merge.** Not a stale pointer — a collision. Feature's DEC-138 landed via **PR #540** (`gh pr view 540`: `baseRefName: feature/reservations`, MERGED), authored by shard C of this same audit; `main`'s DEC-138 was authored 2026-07-20 under DEC-105. `main`'s own numbering note (`:3891`) shows the number space was *already* known to be contested — *"Authored as DEC-126, renumbered to DEC-131, and landed as DEC-138 — each earlier number was taken by an unrelated DEC on `main` while this branch sat unmerged. Numbers 136/137 are reserved for `feature/reservations`, which renumbered `main`'s DEC-134/135 into them."* The reservation held 136/137 and **left 138 unguarded**, and the next DEC written on the branch took it. Compounding: `main` also has a **DEC-139**; the feature branch has none, so post-merge the sequence has one number meaning two things and a gap-free tail that hides it. Blast radius today: `main` cites DEC-138 at `:156` (index) and `:2720` (DEC-105's mechanism list); feature cites its own DEC-138 in `shard-C-asks-shifts.md`. **Neither citation survives the merge unqualified** | MISMATCH | **decision** |
| Z4-2 | `DECISIONS.md:1973-1975` (DEC-078 "Conflict guard") | "a crew member may hold **at most one shift per date** via self-claim (whole-day commitment = can't be on two boats the same day). Reject a self-claim for date *D* if they already hold a Confirmed seat on a different shift on *D*." | **Asserted without caveat; the code says in its own words that it is not closed, and every other document has already been corrected.** `src/asks/claim.ts:111-119`: *"**KNOWN GAP (pilot-accepted, not a closed hole)**: this read-then-CAS guards one seat, not the cross-seat invariant. Two *concurrent* claims by the same crew for *different* same-date shifts both read an empty `committedDates`, both pass `notDoubleBooked`, and each per-seat CAS wins → **confirmed to two boats the same day**."* `SPEC.md:1264-1265` now **strikes** the clause (`Guarded against races ~~and the one-shift-per-date conflict~~`) and carries a five-line #554 banner at `:1267-1272` that ends *"**DEC-078 asserts both guards in one breath with no caveat and needs the same correction.**"* DEC-078's own **Tradeoff** paragraph (`:1990-1994`) discusses only the single-seat optimistic race — the cross-record hole is nowhere in the DEC. **The record already knew:** `RETROSPECTIVES.md:188` (Phase 7 close) — *"the cross-seat double-confirm race may want a **DEC-078 amendment** (decide at a seam, not a comment)"*. It was never made, and the comment is what the amendment was supposed to replace. **No other DEC states the guard as complete** — checked: DEC-087 `:2346-2348` mentions `committedDatesByCrew` only for the trainee-kind side effect, and correctly. DEC-078 is the sole surviving assertion | CODE-CONTRADICTS | **known (#554)** → doc-wrong |
| Z4-3 | `DECISIONS.md:1983-1988` (DEC-078 "MVP claimable set") | "Open **required** seats on shifts in **`Pending` or `Filling`**" | **Both halves were widened by #440 (CLOSED) and the DEC is now the surviving wrong answer — SPEC says so by name.** Shipped: `CLAIMABLE_SHIFT_STATES = {Pending, Filling, **AtRisk**}` (`src/oracle/claimable.ts:28-29`, comment: *"`AtRisk` is deliberately IN … the shift that most needs a body is the last one that should be hidden"*), and `CLAIMABLE_SEAT_STATES` is derived as **the complement of `COMMITTED_SEAT_STATES`** — `Open`, **`Asked`**, **`Bailed`** (`:40-42`, *"an outstanding ask is not a reservation"*). Both constants are shared by the read door (`claimableSeatsFor`) and the write door (`claim.ts:94-97`) so they cannot drift. `SPEC.md:1240-1246` was corrected on 2026-07-27 and closes with: *"The same stale wording is the **origin text in DEC-078's 'MVP claimable set'**, so fixing it here alone leaves **the DEC as the surviving wrong answer** — routed to shard Z."* This row is that routing arriving. **Still accurate in the same paragraph** and not to be touched: `seat.kind !== "required"` (`claimable.ts:103`) — supernumerary self-claim really is still out of scope | CODE-CONTRADICTS | doc-wrong |
| Z4-4 | `DECISIONS.md:249-259` (DEC-007) vs `:1686` (DEC-061) + `:1700-1708` (DEC-063) | DEC-007: "Two protocols ride the same seat machine: **ask-then-assign** (mates: **broadcast** → yeses accrue → **confirm down the list**) and **assign-then-confirm** (captains: name a person → they confirm/decline). Default is per-role, with a **per-person override** toggle" | **Collapsed from both ends by two later DECs, neither of which says the model is dead, and DEC-007 carries no forward pointer at all.** DEC-061 `:1686` removes the second half of ask-then-assign — *"Amends SPEC §2.4 (**the 'confirm down the list' step**) … Applies to **both** protocols (DEC-007)"* — i.e. it names DEC-007 while treating both branches as live. DEC-063 `:1700` removes the first half — the "broadcast" is now **one ask per interval to the top-ranked candidate**, and its own `**Refines:**` line (`:1708`) says *"SPEC §1.2, **DEC-007 (fan-out timing)**"*. Neither says the *distinction* no longer exists, so DEC-007's body stands verbatim and the index lists it unstruck as the current answer for its topic (`:48`). Downstream, the operator has now **confirmed neither protocol is wanted** and removal is **#561** (OPEN, *"Remove the two-protocol fork (resolveProtocol / protocolOverride) — dead and not wanted"*). Code agrees it is already dead: `resolveProtocol` (`ask-loop.ts:772-777`) has zero production callers and its `roleDefault` argument has no source; `protocolOverride` persists (`entities.ts:117,142`; `postgres-repository.ts:130,445,514`) with no reader and no editor. SPEC has been struck in three places (`:819`, `:847-848`, `:853`); **DECISIONS is now the only document still describing the two-protocol model as current** | MISMATCH | **known (#561)** |
| Z4-5 | `DECISIONS.md:1971` (DEC-078), `:2460` (DEC-092), `:2688` (DEC-097), `:2705` + `:2713` (DEC-098) | "(domain-owned optimistic check, **no FK, per DEC-DATA-1**)" · "text PK, **no FK**, dates-as-text **per DEC-DATA-1**" · "denormalized contacter name (**no-FK read, DEC-DATA-1**)" · "**no FK**, text/ISO columns **per DEC-DATA-1**" · "reuses … **DEC-DATA-1 (no-FK)**" | **Five DECs cite DEC-DATA-1 for a rule DEC-DATA-1's own text says it never contained, and which DEC-131 exists to stop.** `DEC-DATA-1:448-456` opens with a banner: *"⚠️ **This DEC has never said anything about foreign keys.** … Roughly nineteen migration headers cite 'no foreign keys — DEC-DATA-1' as though the rule were decided here. **It is not, and never was.** … **Cite DEC-131, not this DEC, for anything about constraints.**"* `DEC-131:3746-3748`: *"New migration headers **must not** cite DEC-DATA-1 for constraint choices; cite this DEC."* The index warning (`:26`) scopes the problem to *migration headers* — **it is also inside `DECISIONS.md` itself, five times**, and those five are DECs, i.e. the authority layer. A reader following DEC-078's parenthetical lands on a banner telling them the citation is invalid. *Measured, not asserted:* **19 migration files** cite `DEC-DATA-1`, **27 citations**, of which 12 lines are explicitly FK-framed; **zero migrations cite DEC-131** — though no migration has been added since DEC-131 was written (2026-07-22, latest migration `20260720…`), so the corrective has not yet had a chance to fail. `DEC-DATA-1` is the **6th most-cited DEC in the whole codebase (44 code citations)**, so this is the highest-traffic miscitation in the project | MISMATCH | doc-wrong |
| Z4-6 | `DECISIONS.md:2717` + `:2728-2730` + `:2741-2743` (DEC-105) vs `:3646` + `:3676-3681` (DEC-126) | DEC-105 title: "…Muster-native parallel-run — **permanent coexistence, not a cutover**"; body: "The model is **permanent coexistence**, not a transition to a cutover"; "**No historical Xola migration** … **no forced cutover**, no de-listing sweep." | **Reversed by DEC-126 in DEC-126's own words, with no forward pointer on the DEC-105 side.** `DEC-126:3646`: *"The flip **is a cutover**"*; `:3676-3681`: *"DEC-105 said 'permanent coexistence, **no cutover, no migration**, Xola drains.' That was the **pilot** model … DEC-126 **does reverse DEC-105's 'no migration' leg** — there *is* a one-time migration, by design."* DEC-126 does the reconciliation properly (it also spells out the consequence for DEC-125's ownership mask, `:3683-3686`). **DEC-105 does not carry one word of it** — no banner, no "evolved by", nothing — and it is a **top-of-file umbrella DEC** for all of Phase 11–12, so it is the one a reader reaches first. It is not stale-by-neglect either: its `**Status:**` line was **edited on 2026-07-20** to add DEC-138 to its mechanism list, three days *after* DEC-126, and still no pointer went in. Partially mitigated in one place only: the index row (`:142`) reads "…parallel-run **(pilot)**". **Same shape as shard A's DEC-107 finding** (no forward pointer to the DEC-134 reversal), one DEC upstream | MISMATCH | doc-wrong |
| Z4-7 | `DECISIONS.md:191-202` (DEC-002) + `:216-226` (DEC-004) | DEC-002: "One authoritative function … a **rule engine** … Every rule reads a slice of state and returns `{ passed, severity, reason, ruleId }`. `severity` is `hard` … or `soft` … Two evaluation modes share one code path: `first-fail` … and `collect-all` … Verdict vocabulary is **pass / fail / deferred**." DEC-004: "A rule outside its horizon **abstains** (`deferred`), making a booking *provisional* … **`deferred` is first-class**." | **The DEC that killed this model names neither of them, and it lives on the other branch.** `origin/feature/reservations:DECISIONS.md:4046-4051` (its DEC-138): *"SPEC §1.3 specified a single **rule engine** … a `Verdict` object (`{ bookable, status, failures, deferred, recheckBy }`), per-rule `hard \| soft` severity … and `first-fail` / `collect-all` evaluation modes. **The audit found none of that exists.**"* That DEC contains **no `Amends` / `Supersedes` / `Relationship` line and no reference to DEC-002, DEC-003 or DEC-004** (grepped its full body) — it rewrote the *spec section* and left the *decisions* that authorize it untouched. Code confirms the gap independently on `main`: `src/oracle/oracle.ts:18-19` — *"**Still out of scope: the two-horizon `deferred` machinery (§1.3).**"* **Precision matters here — DEC-003 survives and must not be swept up with its neighbours:** the composite-satisfiability rule is the one piece that *was* built, and `oracle.ts:9` cites it as *"THE composite point (DEC-003)"*. So the cluster splits 2-against-1, and on `main` SPEC §1.3 (`:239-260`) still describes the rule engine too, because the rewrite is on the feature branch | CODE-CONTRADICTS | **decision** |
| Z4-8 | `DECISIONS.md:284-286` (DEC-010) vs `:2076` + `:2085-2090` (DEC-081) | DEC-010: "Crew **authenticate via magic-link, no passwords**; the link drops them straight onto the relevant ask/card." | DEC-081's title is *"Crew sign-in is a 6-digit email code, **not a magic link** — and it's the one login primitive"*, and its rule is categorical: *"**One login primitive; links are only ever deep-links.** 'All login is a code' — there is never a second login path … Rule: **a login is always a code; a link is never a bare 'log in'.**"* DEC-081's refines-chain names **DEC-079 and DEC-057 — not DEC-010**, and the index lists both DEC-010 and DEC-081 as current rows in the same cluster (`:127`, `:134`) with no relation between them. A reader asking "how does crew log in" gets opposite answers depending on which row they click. **Deliberately scoped narrow:** DEC-010's *other* two holdings are untouched — passwordless, and "crew records are operator-created, no self-registration" (still cited at `ports/channel.ts:36`) — and the magic-link **mechanism** is genuinely alive as the ask-relay deep link (`app/(crew)/crew/auth/route.ts`, `src/auth/magic-link.ts`), which DEC-081 explicitly preserves. Only the *login* clause is contradicted | MISMATCH | doc-wrong |
| Z4-9 | `DECISIONS.md:177` (index footer) + `:3701` (DEC-127) | Footer: "_Indexed **124 of 124** DECs. Feature-branch DECs (099–104, 122) fold in when they merge._" DEC-127: "every new DEC adds its row to the index … **Treat a missing index row as a defect in review.**" | **The file's own maintenance rule, violated by the three most recent `main` DECs, and the footer's count is off by eleven.** Counted mechanically: **135 numbered DEC bodies**; the index carries rows for **132**. Missing: **DEC-133, DEC-134, DEC-135** — i.e. the rule went unenforced for the three newest, exactly where DEC-127 predicts the failure. (DEC-138/139 *are* indexed at `:156-157`, so this is not a simple "the tail is unmaintained" — it is skipped in the middle of the tail.) No index row points at a non-existent DEC — the error is one-directional. DEC-127 makes this self-indicting rather than merely untidy: the file states the standard and then misses it, which means the index cannot be trusted as a completeness check, which is the one job DEC-127 gave it (*"Past ~120 DECs, 'what's our current call on X' was a grep; the index makes it a lookup"*) | MISMATCH | doc-wrong |
| Z4-10 | `DECISIONS.md:85` (~~DEC-011~~), `:87` (~~DEC-016~~), `:89` (~~DEC-029~~), `:171` (~~DEC-013~~) | "~~DEC-011~~ → **superseded** by DEC-036" · "~~DEC-016~~ → **superseded** by DEC-043" · "~~DEC-029~~ → **superseded** by DEC-082" · "~~DEC-013~~ → **superseded** by DEC-020" | **All four are struck as wholly superseded and all four have legs that later DECs, the SPEC and the code still stand on.** DEC-011: `DEC-036:1186` — *"DEC-011's **other leg** (the ~18-month kill date / disposability) **stands, and is what licenses this**"*; and `DEC-105:2751` cites it as live authority — *"**Explicitly NOT reopened:** the **killed Xola API write-back** (§4 / DEC-011)."* DEC-016: `DEC-043:1358` — *"the **durable DEC-016 / DEC-ROLE-1 principle** — manning is data the deriver loops — **stands**; only the invented fleet dies"*; `SPEC.md:113`, `:117`, `:645` all carry live *"(Correction, DEC-016: …)"* parentheticals, and shard C2.3 verified the `:645` one as accurate. DEC-029: superseded only in its **lock-anchored** leg; its **materiality** rule is live production machinery — `app/api/cron/xola-pull/route.ts:18`, `src/import/import-reservations.ts:104,263`, `src/domain/entities.ts:222`, `src/adapters/repository-contract.ts:465`. DEC-013: cited **as the current architecture** in six core files — `src/domain/entities.ts:2`, `src/domain/index.ts:1`, `src/ports/repository.ts:2,378,390`, `src/adapters/in-memory-repository.ts:2`. **This is the direct feeder for Part B:** "superseded" in this file means *one holding of this DEC was replaced*, never *this DEC is finished* — which is why the archive count in **B1** is zero | MISMATCH | doc-wrong → **feeds Part B** |
| Z4-11 | `DECISIONS.md:1927-1963` (DEC-077) | "The commitment unit is the **whole vessel-day shift** … Claiming a seat = committing to crew **every trip on that boat that day** … **Sub-day blocks ('watches') are deferred** … **NON-GOAL for Phase 7.**" · "**Why:** … The operator **confirmed day-granularity is the right MVP**" | **Verified as internally consistent — and logged anyway, because the pointer is missing in one direction only.** No later DEC qualifies DEC-077 (`grep DEC-077` returns exactly two hits in this file: its own header and its index row `:31`), and DEC-077 is unusually well-built for revision: it pre-scopes the refinement in mechanism detail (*"change the grouping key `vessel\|date` → `vessel\|date\|block` … everything downstream keys off `shiftId` and is untouched"*) and its **Revisit if** is the exact trigger that has now fired. **#560** (OPEN) is that trigger: *"Same-day eligibility: whole-day block excludes crew who could work two short trips on different boats."* `SPEC.md:1274-1278` already carries the pointer — *"The operator has questioned whether the whole-day rule is right at all … **Neither this clause nor DEC-077/078 should be rewritten further until #560 is decided**, or they get rewritten twice."* DEC-077 carries no such note. The finding is **not** that DEC-077 is wrong (its stated rationale — day-first is the minimum coherent build, operator-confirmed for MVP — is intact); it is that the DEC does not know a decision is pending against it, and #560's scope is **wider than the DEC** — it is a change to the *oracle's eligible pool* (`not_double_booked`), so today those crew are never even asked, not merely blocked from claiming | MISMATCH (pointer only) | **known (#560)** |

---

## Part B — archive evidence

**Gathered, not concluded.** No option below is recommended, and B4 is deliberately unranked.

### B1 — How many DECs are fully superseded (their holding governs nothing)?

**Zero.** Every DEC the file itself marks superseded retains a leg that a later DEC, the SPEC, or shipped
code stands on. The five struck index rows are the complete candidate set; all five fail.

| Struck as | Index row | Replacement | Live leg that survives | Cited by |
|---|---|---|---|---|
| DEC-011 | `:85` | DEC-036 | The ~18-month kill date / disposability, **and** the killed Xola API write-back | `DEC-036:1186`, `DEC-105:2751`, `SPEC.md:71`, `FUTURE_IDEAS.md`, `PROJECT_PLAN.md` |
| DEC-013 | `:171` | DEC-020 | The **stack-agnostic core** boundary (domain + ports are stack-free) | `entities.ts:2`, `domain/index.ts:1`, `ports/repository.ts:2,378,390`, `in-memory-repository.ts:2` |
| DEC-016 | `:87` | DEC-043 | "Manning is per-vessel **data the deriver loops**, not a fixed captain/mate pair"; the real-fleet correction | `DEC-043:1358`, `SPEC.md:113,117,645`, `resource-map.ts:2`, `xola-client.ts:9`, `import-reservations.ts:138` |
| DEC-017 | `:88` | DEC-040 | **Email is the manifest spine; phone is nullable** — still the schema | `entities.ts:208,214`, `0001_init.sql:78`, `shift-card.test.ts:164`, `browse.test.ts:43` |
| DEC-029 | `:89` | DEC-082 | The **materiality** rule (`updatedAt` stamped on material change only) — DEC-082 killed only the *lock anchor* | `xola-pull/route.ts:18`, `import-reservations.ts:104,263`, `entities.ts:222`, `repository-contract.ts:465`, `form-shifts.test.ts:274` |

**Consequence for the archive question, stated plainly:** an ACTIVE/archive split has **no archive to
move**. "Superseded" in this file has always meant *a holding of this DEC was replaced* — never *this DEC
is finished*. Archiving any of the five would take live authority out of the active section. This is
finding **Z4-10** viewed from the other side.

### B2 — How many are still load-bearing?

**Method: mechanical, not sampled.** Every DEC id was extracted from the file headers (`^## DEC-…`, n=135)
and counted against a whole-tree grep of `src/ app/ components/ db/ e2e/` on `main`, then the residue was
re-checked against `docs/*.md`, `.claude/`, and `origin/feature/reservations`'s code. Nothing here is an
estimate.

| Measure | Count |
|---|---|
| Numbered DECs in the file (`main`) | **135** (+ `DEC-TBD`) |
| Cited by **id** somewhere in `main`'s code | **113 / 135 (84%)** |
| Total DEC citations in `main`'s code | **1,821** |
| Of the 22 uncited-in-`main`-code: cited in `feature/reservations` code | **11** (DEC-107 ×53, DEC-110 ×19, DEC-123 ×31, DEC-124 ×79, DEC-125 ×62, DEC-126 ×2, DEC-132 ×27, DEC-133 ×4, DEC-090 ×1, +2) |
| Of the rest: cited in `SPEC.md` / another doc / `.claude/` | **5** (DEC-011, DEC-014, DEC-035, DEC-038, DEC-039, DEC-091, DEC-MSG-2, DEC-113 — overlapping) |
| **Cited nowhere outside `DECISIONS.md`, on either tree** | **6** — DEC-006, DEC-053, DEC-117, DEC-127, DEC-138, DEC-139 |
| Migration headers citing a DEC | **27 citations of `DEC-DATA-1` across 19 files**; next-highest DEC-030 (5), DEC-ROLE-1 / DEC-106 / DEC-081 / DEC-073 / DEC-069 / DEC-058 (4 each) |

**The six uncited DECs are not archive candidates either, and each fails for its own reason** — worth
recording so the next sweep doesn't re-derive it:

| DEC | Why it is uncited | Archive-safe? |
|---|---|---|
| DEC-006 (Tiers 1–3 = degrees of automation) | Spec-extracted **vocabulary**, not a mechanism — the thing it names is implemented and commented, just not by number (`escalate.ts:21`: *"horizon to At-Risk (**Tier 3**)"*) | No — it defines terms used across the engine |
| DEC-053 (two sender numbers) | Twilio not adopted; the decision is pre-committed for the SMS swap | No — unbuilt ≠ superseded |
| DEC-117 (weekend-batch ask distribution) | The shipped weekend machinery cites its **sibling** DEC-116 (`derive.ts:154,167,176`); DEC-117's distribution half is the unbuilt part | No — unbuilt |
| DEC-127 (the index rule) | Self-referential by construction — its subject *is* this file | No — and Z4-9 shows it is under-enforced, not over |
| DEC-138 / DEC-139 (widget embed / card-only) | Written 2026-07-20; the code they govern isn't built | No — newest decisions in the file |

### B3 — What a restructure would cost against the 252-line divergence

Every hunk below is `git diff main origin/feature/reservations -- docs/DECISIONS.md`, anchored to
**`main`** line numbers.

| # | `main` anchor | Size | What diverges |
|---|---|---|---|
| 1 | `:153-156` | −2 | The **index rows for DEC-138/139** exist only on `main` |
| 2 | `:1352-1359` | −2/+1 | DEC-043's operator-trust bullet — `main` carries the **shard-C2.2 auto-import amendment**; feature still says "auto-import stays" |
| 3 | `:1363-1369` | −1/+1 | DEC-044: "Since **DEC-134**" → "Since **DEC-136**" (the renumber) |
| 4 | `:1710-1716` | −1/+1 | DEC-064: same renumber, mid-paragraph |
| 5 | `:2717-2723` | −1/+1 | DEC-105's mechanism list: `main` adds "and DEC-138 — embed-first rollout" |
| 6 | `:2795-2800` | +5 | Feature-only: DEC-107's **⚠️ reversed-by-DEC-134** banner (shard A's fix) |
| 7 | `:3012-3018` | +7 | Feature-only: DEC-112 "its own revisit-if has since fired" |
| 8 | `:3041-3053` | +11/−1 | Feature-only: DEC-113's two 2026-07-25 corrections |
| 9 | `:3351-3356` | **+83** | Feature-only: **an entire DEC** — "DEC-107 amendment (11.2b) — on-demand balance collection" |
| 10 | `:3846-3910` | **−65/+49** | **The collision zone.** `main`'s DEC-134/135/138/139 vs feature's DEC-134/135/136/137. Git is already pairing *unrelated* DEC bodies line-for-line |
| 11 | `:3947-3949` | **+76** | Feature appends **76 lines at EOF**, after `main`'s `DEC-TBD` |

**Analysis (labelled as analysis, not measurement).** Conflict counts depend on the restructure's shape,
and they are not proportional to its ambition — the cheap-sounding option is the one that collides:

- **Move only the five struck DECs into an appended archive section.** The five bodies sit at
  `:294-321`, `:322-336`, `:560-583`, `:584-612`, `:974-1008`. **None intersects any divergent hunk**, so
  the *moves* are conflict-free. But the **destination** is not: hunk 11 has the feature branch appending
  76 lines at EOF, so an archive section appended at EOF is **two branches writing the same tail** — one
  guaranteed conflict, in the region that is already the worst (hunk 10 sits directly above it). Cost:
  **~1 conflict, in the hardest place.**
- **Add a status marker under each `## DEC-NNN` header, no moves.** 135 single-line insertions. Four of
  them land inside hunks 10–11 (DEC-134/135/138/139 at `:3849/3859/3874/3895`); the rest miss every hunk.
  Cost: **~2 conflicts**, both inside the collision zone that has to be hand-reconciled anyway.
- **Full ACTIVE/archive reorganisation of the file.** Every body moves relative to its neighbours, so all
  11 hunks land on relocated text and git's 3-way merge degrades to "206 inserted feature lines against a
  file whose structure moved." Cost: **up to 11 conflicts and 252 lines of hand-placement**, plus the
  judgement calls B1 says have no correct answer anyway.
- **Independent of any restructure, the merge is already a hand-reconciliation.** Hunks 3, 4, 10 and 11
  are the DEC-134/135→136/137 renumber plus the DEC-138 collision (Z4-1). On `main` today, **8 files
  cite DEC-134 or DEC-135** by number — `db/seed-fleet.ts:12,41`, `db/reset-test.ts:29`, `db/all-dev.ts:3`,
  `db/seed-crewapp-dev.ts:10,56`, `e2e/db-all.spec.ts:2`, `e2e/fixtures.ts:9`, `src/crew/crew-cli.ts:68`,
  `docs/RUNNING.md:16,28`, `docs/USER_STORIES.md:93`, plus `DECISIONS.md:1366,1713,3871` — and the feature
  branch has already renumbered its copies of two of them. **The number space is forked, and the fork is
  load-bearing in code comments.** Any restructure adds to a reconciliation that is owed regardless.

### B4 — Cheaper interventions than a file reorganisation

Presented with costs. **No recommendation, and no ranking implied by order.**

| Option | What it is | Cost | Notes |
|---|---|---|---|
| **Do nothing structural; fix the 11 rows above** | Treat Part A as the whole job | ~11 targeted edits, 1 operator call (Z4-1), 2 tracked by open issues | Leaves the 3,949-line file intact; B1 says there is no archive to build anyway |
| **Status marker per DEC** (`**Status:** current / partially superseded → DEC-NNN / historical`) | One line under each header | 135 insertions; ~2 merge conflicts (B3); needs a **judgement per DEC** and B1 shows the common case is *partially* superseded, which is the hardest label to write | Encodes what Z4-10 found: the binary "superseded" strike-through is the thing that is actually wrong |
| **Fix the index instead of the file** | Add the 3 missing rows (Z4-9), correct the footer count, replace the 5 blanket strike-throughs with "partially superseded — *X* stands" | ~10 line edits, **zero** merge conflicts (index hunk 1 is 2 lines and additive) | The index is already the intended lookup surface (DEC-127); this makes it honest without moving a single body |
| **Appended archive section** | `## Archive` at EOF, superseded bodies moved under it | ~1 conflict, in the EOF region both branches are writing (B3); **and B1 gives it zero occupants** | The only option that is cheap to *do* and has nothing to put in it |
| **Split into multiple files** (e.g. `DECISIONS.md` + `DECISIONS-ARCHIVE.md`) | File-level split | All 11 hunks conflict; every one of **1,821 code citations** keeps working (they cite ids, not paths), but the ~30 in-file cross-references (`:1186`, `:1358`, `:2751`, …) cross a file boundary | Cost is the merge, not the citations |
| **Defer everything until `feature/reservations` merges** | Sequencing, not a structure | Zero now; the 252-line reconciliation happens once instead of twice | Z4-1 (the DEC-138 collision) must be resolved *at* that merge regardless — it is not deferrable past it |

---

## What this shard would recommend

**The file is in better shape as reasoning than its size suggests, and worse shape as a numbering
system than anyone has noticed.** Eleven contradictions across 135 DECs is a low rate for a
3,949-line document written over three months, and the ones that exist have a single, repeating cause:
**a DEC that changes another DEC updates itself and not its target.** DEC-126 says it reverses DEC-105;
DEC-105 says nothing (Z4-6). DEC-061 and DEC-063 each say they amend DEC-007; DEC-007 says nothing
(Z4-4). DEC-081 replaces DEC-010's login story and names DEC-079 instead (Z4-8). The feature branch's
DEC-138 says the rule engine "does not exist" and names none of the three DECs that specified it (Z4-7).
**This is lesson 11 again — a reconciliation pass that stops early — but one level up: the pass now
stops before it reaches the *decision* it invalidated, having already fixed the spec.** Cheap standing
counter, and it is the pre-flight this shard used: **before writing a DEC, grep the file for every DEC
you are about to amend and add the back-pointer there too.** The forward pointer is written by the author
who has the context; the back-pointer is the one nobody has an incentive to write.

**The single highest-consequence row is Z4-1, and it is not a doc-tidy.** `DEC-138` names two unrelated
live decisions — an embeddable booking widget on `main`, the SPEC §1.3 rewrite on `feature/reservations`
— and the branch that took the number second did so via **this audit's own shard C** (PR #540). The
numbering note at `:3891` shows the collision was foreseen for 136/137 and reserved for them; 138 was
left open and taken. **This needs an operator call before the merge, not at it**, because whichever DEC
is renumbered, its citations move with it, and one of them (`main`'s, at `:156` and `:2720`) is already
written into the index. Related and mechanical: `main`'s DEC-134/135 are already DEC-136/137 on the
feature branch, and **8 `main` files cite 134/135 by number in code comments**.

**Three rows are already-filed issues and need no decision, only the DEC edit their issue implies
(Z4-2, Z4-4, Z4-11).** #554 has SPEC corrected and DEC-078 not — and `RETROSPECTIVES.md:188` shows the
DEC-078 amendment was identified at Phase 7 close and never written, which is the whole gap in one
sentence. #561 has the operator's answer and DECISIONS is the last document still describing the
two-protocol model as current. #560 wants **no rewrite yet** — SPEC says so explicitly — so the only
action there is a pointer so the next reader knows a decision is pending.

**Z4-3 is the row this shard was chartered by SPEC to collect.** `SPEC.md:1246` names DEC-078's "MVP
claimable set" as the origin of the #440 stale wording and routes it here in so many words. It is a
two-clause edit with a closed issue and a shared constant to cite, and it is the last copy.

**Z4-5 and Z4-9 are the file failing its own stated rules**, which makes them cheap to justify and cheap
to fix. DEC-DATA-1's banner and DEC-131's text both say "do not cite this DEC for constraints"; five DECs
in the same file do exactly that. DEC-127 says a missing index row is a review defect; three of the four
most recent `main` DECs have none and the footer count is off by eleven.

**On Part B, the evidence points one way and this shard does not take the step.** There is **no archive
to build** — zero of 135 DECs are fully superseded (B1), 129 are cited outside this file on one tree or
the other (B2), and the six that aren't are unbuilt or self-referential rather than dead. The structural
problem the file actually has is **not length** — it is that "superseded" is recorded as a binary
strike-through when the real pattern is *one holding replaced, the rest still load-bearing* (Z4-10), and
that the number space has forked across two branches (Z4-1, B3). Both are addressable without moving a
line of the body text. **The operator's call, not this shard's.**

---

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| **DEC-131 vs DEC-DATA-1 — the brief's suspicion, refuted.** The two DECs' own texts were checked for mutual consistency | brief item 4 | **They agree completely, and the correction is exemplary.** `DEC-DATA-1:448-456` carries a block-quote banner disclaiming the FK rule and pointing at DEC-131; `DEC-131:3740-3748` gives the full provenance (the rule was minted in `0001_init.sql`'s own header and "acquired this DEC's number as a credential it was never granted"), and `:3790` states the relationship precisely — *"DEC-DATA-1 (**clarified, not amended** — its text was always about logic placement)"*. This is the single best-executed amendment in the file and is the model the Z4-4/-6/-8 rows are missing. The **live** problem is propagation into third parties (Z4-5), not disagreement between these two |
| The index's ⚠️ warning that "~19 migration headers miscite DEC-DATA-1" | `DECISIONS.md:26` | **Accurate to the number.** 19 migration files cite `DEC-DATA-1` (27 citations; 12 lines explicitly FK-framed). Zero migrations cite DEC-131 — but no migration has been written since DEC-131 (2026-07-22; newest migration is `20260720…`), so the corrective is untested rather than ignored |
| DEC-078's self-release + no-reliability-event-on-claim holdings | `DECISIONS.md:1976-1988` | Both shipped and tested. `claim.test.ts:280` *"a claim emits no reliability event (DEC-078 — earned at Completed, not claim)"*; `claim.test.ts:302` `describe("releaseSelfClaim (DEC-078)")`. Only the two clauses in Z4-2 and Z4-3 are stale — the DEC is not broadly rotten |
| DEC-078 says the guard rejects a claim when the crew member "already hold a **Confirmed** seat"; the code checks **Claimed + Confirmed** | `DECISIONS.md:1974` vs `claim.ts:104-108` | **Code is stricter than the DEC, not divergent.** `committedDatesByCrew` folds `COMMITTED_SEAT_STATES` (Claimed ∪ Confirmed), which is the safer set and the same one `claimable.ts:40` complements. A widening in the correct direction is not a contradiction; recorded so it isn't mistaken for one |
| DEC-063's bail/vacate clause is struck in place with its amender named — `~~Bail/vacate re-asks stay blast-all~~` **"Amended by DEC-128 (#483)"** | `DECISIONS.md:1700` | **This is the file doing it right**, inside the very DEC that fails to do it for DEC-007 (Z4-4). Strike-in-place + name the amender + explain the new behaviour, all in one line. Cited here as the existing in-file precedent for how Z4-4/-6/-8 would be fixed |
| DEC-087's *"Documented side effect: `committedDatesByCrew` is kind-blind, so a staffed trainee is double-booking-excluded"* | `DECISIONS.md:2346-2348` | Consistent with DEC-078, and explicitly reasoned rather than accidental (*"Correct (they're aboard) — not a pool bug"*), with a matching **Revisit if**. Checked specifically because it is the only other DEC touching the same-date machinery — it does **not** assert the guard is race-safe, so DEC-078 is the sole source of the Z4-2 claim |
| DEC-126's reconciliation of DEC-125's ownership mask | `DECISIONS.md:3683-3686` | Explicit and complete — *"the `× muster-owned-days` mask … is a **pilot-coexistence** term only. Post-cutover Muster owns every reservation, so the mask is the entire calendar and the term drops out."* DEC-126 reconciles **downward** to DEC-125 thoroughly while failing to reconcile **upward** to DEC-105 (Z4-6); the asymmetry is what makes Z4-6 an oversight rather than a stance |
| DEC-082's handling of DEC-029 | `DECISIONS.md:2143` | Correct and scoped — it supersedes the *lock anchor* only and says what replaces it (*"anchor it to **Xola import diffs** … never a lock"*). The index's blanket strike of DEC-029 (`:89`) is the defective part, not DEC-082 (Z4-10) |
| DEC-036 vs DEC-011, and DEC-043 vs DEC-016 | `DECISIONS.md:1186`, `:1358` | Both name exactly which leg dies and which stands, in their own text. Same pattern as DEC-082/DEC-029: the **DEC** does the reconciliation properly and the **index** flattens it to a strike-through |
| DEC-003 (composite satisfiability rule) survives the §1.3 collapse that takes DEC-002 and DEC-004 with it | `DECISIONS.md:204-214` | Shipped and cited as the governing principle: `oracle.ts:9-14` — *"THE composite point (DEC-003): crew rules are not independent booleans over the pool … `solveShift` solves over a **shared** pool: a person assigned to one required seat is removed before the next seat is considered."* Recorded explicitly so a Z4-7 fix does not sweep DEC-003 in with its neighbours |
| DEC-006's Tier 1–3 vocabulary, despite zero citations by id anywhere | `DECISIONS.md:239-247` | The mechanism it names is built and commented in the same words — `escalate.ts:21`: *"horizon to At-Risk (**Tier 3**)"*; Tiers 1/2 within `Filling` per `ask-loop.ts` / `escalate.ts`. **Zero citations ≠ dead** — the counter-example that keeps B2 from over-reading its own numbers |
| DEC-005's reserved `Held` tier still reserved-and-unbuilt, and DEC-061 respects it | `DECISIONS.md:228-237`, `:1686` | DEC-061: *"The soft-commitment buffer, if ever wanted, remains the reserved `Held` tier (DEC-005), **not** a resting `Claimed`."* A ten-DEC-old reservation honoured by name — no contradiction |
| DEC-075 (self-claim auto-locks `Open → Confirmed`) vs DEC-061 (a winning "in" auto-confirms) | `DECISIONS.md:1854`, `:1683` | Two different doors reaching the same resting state, both deliberate. `claim.ts:148` (*"Guarded first-come transition (DEC-078 / REQ-CLAIM-1)"*) and `recordResponseAndConfirm` are the two paths; SPEC §2.7.2 and §2.4 describe them separately. No contradiction |
| DEC-009 (availability is suppression-only) vs DEC-119 (recurring weekday-off) | `DECISIONS.md:273`, `:3232` | DEC-119 is built **as a suppression column**, which is DEC-009's rule rather than an exception to it; the index groups them under one heading for that reason. `DECISIONS.md:3266` explicitly reasons the edge case (*"an all-7-days-off member is permitted"*) |
| DEC-121 (timestamp-prefixed migrations) vs DEC-020 | `DECISIONS.md:3308` | Self-declared *"refines DEC-020"* in its own title, and DEC-020 is not contradicted — the change is filename policy, not stack. No back-pointer needed because nothing in DEC-020 asserts the old scheme |
| No index row points at a DEC that does not exist | index `:13-177` vs `^## DEC-` | Checked mechanically both ways: 132 indexed ids all resolve to a body; the error is one-directional (3 bodies unindexed, Z4-9). There are **no dead cross-references in the index** — a different Z-shard concern, cleared here for free |

---

## Coverage — what this shard did and did not read

- **No acceptance criteria exist in this subject.** `DECISIONS.md` carries no `- [ ]` boxes (`grep -c
  '^- \[ \]'` = 0) — it is a decision record, not a spec. The per-AC verdict section that every §2.x
  sub-shard carries is **omitted deliberately**, not skipped.
- **Read in full:** the Index (`:13–177`); DEC-002, DEC-003, DEC-004, DEC-006, DEC-007, DEC-010,
  DEC-DATA-1, DEC-061, DEC-063, DEC-077, DEC-078, DEC-081, DEC-082, DEC-105, DEC-126, DEC-127, DEC-131,
  DEC-134, DEC-135, DEC-138, DEC-139. `src/asks/claim.ts`, `src/oracle/claimable.ts:20–110`.
- **Read in part / targeted:** DEC-011, DEC-013, DEC-016, DEC-017, DEC-029, DEC-036, DEC-043, DEC-064,
  DEC-079, DEC-087, DEC-092, DEC-097, DEC-098, DEC-125 (the clause under test only);
  `origin/feature/reservations:DECISIONS.md` DEC-134–138 heads + DEC-138 body head;
  `SPEC.md:239–260`, `:1240–1295`; `oracle.ts:1–30`; `escalate.ts:12–25`; `entities.ts:110–150`.
- **Mechanically swept, not read:** all 135 DEC headers; all 63 `Supersede|Amends|Refines|Reversed|
  Replaced|Evolves` hits; the whole-tree DEC-citation census (1,821 citations, `src/ app/ components/
  db/ e2e/`); `db/migrations/` headers by grep; the index↔body id reconciliation (both directions).
- **Not read:** the ~100 DEC bodies outside the clusters the brief prioritised. Per the brief, coverage
  was by **topic cluster** — asks/escalation, seats/state machine, auth, reservations/money, plus
  core-architecture and constraint posture — and by the amendment-grep, **not** by reading all 136. The
  messaging/doorbell cluster (DEC-045–073, 20 DECs) and the UI/frontend cluster (DEC-021/038/055/085/
  086/089/090/091/114, 9 DECs) were **not** swept for internal contradictions; both are cohesive, recent,
  and single-phase, which is the low-risk profile — but that is a prior, not a finding.
- **Deliberately not done:** nothing was edited except this ledger. No DEC was moved, renumbered,
  reordered, struck, or archived; no fix was applied to any of the 11 rows.

## Cost

~118k subagent tokens. **The expensive half was Part B, and not for the reason budgeted.** Part A's
contradictions were cheap once the amendment-grep gave the candidate list — 30 hits, six of which became
findings, at roughly one targeted read each. Part B cost more because "is this DEC still load-bearing"
is only answerable mechanically: a whole-tree citation census across two branches, then a
per-DEC residue check for the 22 that came back zero — and the residue is where the real answer lived
(B1's zero, B2's six). **Transferable: the citation census is one command and should be run first in any
future DECISIONS-internal shard**, because it simultaneously scores every DEC's load-bearing status,
surfaces the miscitation clusters (Z4-5 fell out of it), and is the only cheap way to prove a negative
about a 136-decision corpus. The DEC-138 collision (Z4-1) was found by the which-tree check, which cost
one `git show | grep` — lesson 4 paying for itself a fourth time.
