# Shard C2.7 — Crew Self-Serve ("Pick your shifts")

**Subject:** `docs/SPEC.md` lines **1023–1061** — all of `## 2.7 Crew Self-Serve — "Pick your shifts"
(the crew pull surface)`: the **Stance** block-quote, and subsections **2.7.1 The list**, **2.7.2 The
claim**, **2.7.3 Release**, **2.7.4 What this surface is NOT**, **2.7.5 Relationship to the cascade**.

**Audited tree:** `main` @ `f401e9c` (branch `task/audit-c2-4-to-c2-7`).

> **Which-tree check (lesson 4) — run, not assumed. Result: §2.7 is byte-identical on both trees.**
> `git diff main origin/feature/reservations -- docs/SPEC.md` = **13 hunks**, `main`-side ranges
> `116`, `236–320`, `498`, `516–524`, `540–545`, `566–573`, `606–616`, `644–669`, `684–706`,
> `720–737`, `744–758`, `1177–1186`, `1215–1225`. **None intersects 1023–1061** — the nearest are
> `744–758` (§2.3 tail) and `1177–1186` (§4 Parked), and 1023–1061 sits in the ~420-line gap between
> them. Cross-checked structurally: the section header sits at `main:1023` and
> `feature/reservations:1040` (+17 lines of net insertion upstream), and the `main` body
> `1023–1053` hashes `039c8c4d…`. A `main` sweep is therefore complete for this subject, and nothing
> in the other tree would change a row below.

> **Reconcile-banner check (lesson 11): §2.7 carries no `⚠️ Reconciled` banner.** Its only header is
> the **Stance** block-quote at `:1025–1028`, which makes three checkable promises rather than
> declaring anything dead — "a fourth crew surface (DEC-074)", "pull, opt-in, anti-anxiety (DEC-042
> guardrails)", "**not** the parked positive-availability calendar (§4)". All three were checked
> against the blocks beneath them; two hold outright and one (the DEC-042 guardrail list) is the
> subject of C2.7-4. No block below the banner contradicts it.

**Live-symbol check (lesson 12) — one grep per cited component.** Everything this ledger cites as
shipped UI was grepped for callers, not merely found on disk:

| cited symbol | mounted? | evidence |
|---|---|---|
| `app/(crew)/crew/open/page.tsx` default export | **yes** | a Next.js App Router `page.tsx` (the route *is* the caller); exercised end-to-end by `e2e/crew-open.spec.ts` (7 tests) |
| `ClaimRow`, `Filters`, `confirmLead`, `confirmFacts` | **yes** | module-local to that `page.tsx`, called at `:116`, `:91`, `:261`, `:224` |
| the `/crew/open` entry point on the crew hub | **yes, flag-gated** | `app/(crew)/crew/page.tsx:487–497` inside `{selfServe && …}`; `selfServe` ← `selfServeEnabled()` at `:154` |
| `claimSeat` server action | **yes** | `app/(crew)/crew/open/actions.ts:25` ← `<form action={claimSeat}>` at `page.tsx:268` |
| `buildClaimableView` | **yes** | one production caller, `page.tsx:64` |
| `claimableSeatsFor` | **yes** | one production caller, `claimable-view.ts:56` |
| `claimSeat` (service, `src/asks/claim.ts:74`) | **yes** | `open/actions.ts:38` |
| **`releaseSelfClaim`** (`src/asks/claim.ts:190`) | **NO — zero production callers** | grep over `app/`, `src/`, `components/`: only `claim.test.ts` and `cascade-coexistence.test.ts`. See C2.7-2 |

**Evidence read.** `src/oracle/claimable.ts` (full), `src/asks/claim.ts` (full),
`src/crewapp/claimable-view.ts` (full), `src/oracle/eligibility.ts` (full), `src/asks/suppression.ts`
(full), `app/(crew)/crew/open/page.tsx` (full), `app/(crew)/crew/open/actions.ts` (full),
`app/(crew)/crew/shift/[shiftId]/actions.ts` (full), `app/lib/flags.ts` (full),
`app/(crew)/crew/page.tsx:475–500`. The `it(...)` inventory of `claim.test.ts`, `claimable.test.ts`,
`claimable-view.test.ts`, `cascade-coexistence.test.ts`; `claimable.test.ts:116–160` read line by
line; `e2e/crew-open.spec.ts` header + all 7 test names + the claim-flow body. `docs/DECISIONS.md` —
DEC-074, DEC-075, DEC-076, DEC-077, DEC-078, DEC-079, DEC-119, DEC-128, DEC-129, DEC-130 (bodies),
plus the ACTIVE index lines for DEC-019/041/042/059/081. `docs/SPEC.md` §1.3 (`239–318`), §2.1
`:430–460`, §2.6 ACs `:1011–1019`, §4. `docs/PROJECT_PLAN.md` Phase 7 (`274–326`, `610`).

---

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| C2.7-1 | `SPEC.md:1038-1039` | "Guarded against races **and the one-shift-per-date conflict** (DEC-078)." | **Half true, and the false half is a known integrity hole recorded only in a code comment.** The single-seat race *is* closed — a guarded CAS pinned to the read state (`claim.ts:157-166`, `saveSeatIfState`), loser gets `just_taken`, tested at `claim.test.ts:250` *"two concurrent claims on one seat → exactly one Confirmed, the other just_taken"*. The **one-shift-per-date** guard is a read-then-CAS over `committedDatesByCrew` (`claim.ts:120-138`) and is **not concurrency-safe across seats**. `claim.ts:111-119` states the gap in its own words: *"KNOWN GAP (pilot-accepted, not a closed hole) … Two **concurrent** claims by the same crew for **different** same-date shifts both read an empty `committedDates`, both pass `notDoubleBooked`, and each per-seat CAS wins → **confirmed to two boats the same day**"* — the no-FK store can't enforce a crew+date uniqueness (DEC-DATA-1). DEC-078's own text (`DECISIONS.md:1971-1976`) asserts both guards in one breath with no caveat, and its Tradeoff paragraph discusses **only** the single-seat optimistic case. `gh issue list --search "double-book concurrent claim"` returns **`[]`** — nothing filed. So the *only* record of a reachable double-confirm is a comment in a file nobody reads to check a spec | CODE-CONTRADICTS | **decision** |
| C2.7-2 | `SPEC.md:1041-1042` (§2.7.3) | "**Release.** Releasing a self-claimed seat is **as easy as claiming it** (§2.6 principle 2): seat returns to `Open` and **re-asks**" | Three separate drifts in two sentences. **(a) The function written for this subsection is dead.** `releaseSelfClaim` (`claim.ts:190-197`) has **zero production callers** — grep over `app/`+`src/`+`components/` returns only `claim.test.ts:322,337,350,361,376` and `cascade-coexistence.test.ts:113`. **(b) Its *function* moved (lesson 6), so the behavior ships — via §2.6, not §2.7.** `app/(crew)/crew/shift/[shiftId]/actions.ts:26-76` (`bailFromSeat`, "I can't make it") calls `bailWithDerivedLateness` **directly** with the same occupant pin (`:44`, `:51-56`), so release is real and authorized. **(c) "re-asks" is stale.** DEC-128 / #483 (closed) removed the inline re-ask: `bailFromSeat:63-64` — *"the bail rests the seat Open and leaves re-crewing to the **tick**"*; pinned by `claim.test.ts:316` *"re-opens the seat and fires **NO** asks — re-crewing deferred to the tick (DEC-128 #483)"* and `cascade-coexistence.test.ts:103`. **And "as easy as claiming it" is not true of the shipped geometry:** claiming is one tap on `/crew/open`; releasing is `/crew` → `/crew/shift/[id]` → bail, on a different surface | CODE-CONTRADICTS | doc-wrong (+ **code-wrong**, low: dead export) |
| C2.7-3 | `SPEC.md:1032-1033` | "Default filter **today**; presets **this weekend** / from–to range." | Superseded by **#414 (closed)** and contradicted by an e2e assertion. Shipped: default **7 Days**, presets **7 Days / 2 Weeks / 30 Days**, plus the from–to GET form (`open/page.tsx:318-330` `resolveRange`, `:147-155` the three chips). The page docstring states the reversal and the reason — *"The default filter is **7 Days** (#414 — not today, not just the weekend; this is a pull surface, so crew browse a week ahead)"* (`:30-32`). `e2e/crew-open.spec.ts:22-37` asserts all three chips visible **and** `getByRole("link", { name: "This weekend" })` `.toHaveCount(0)` — i.e. the suite actively pins the *absence* of the preset the spec still lists | CODE-CONTRADICTS | doc-wrong |
| C2.7-4 | `SPEC.md:1030-1032` | "**Open required** seats … on shifts in **`Pending`/`Filling`**" | Both halves widened by **#440 (closed, "Pick My Shift hides uncrewed seats")** and never back-ported to the spec. Shifts: `CLAIMABLE_SHIFT_STATES = {Pending, Filling, **AtRisk**}` (`claimable.ts:28-29`) — *"`AtRisk` is deliberately IN: … the shift that most needs a body is the last one that should be hidden."* Seats: `CLAIMABLE_SEAT_STATES` is the **derived complement** of `COMMITTED_SEAT_STATES`, resolving to `{Open, **Asked**, **Bailed**}` (`:31-42`) — *"an outstanding ask is not a reservation."* Enforced identically on the write door (`claim.ts:94-99`). Tested at `claimable.test.ts:134,150`, `claim.test.ts:175,184,195,204`, and at the surface by `e2e/crew-open.spec.ts:133-170` (*"a seat the engine has already asked on still lists"*). **The same drift then propagates into §2.7.2** (`:1037`, "seat `Open → Confirmed`") **and into DEC-078's "MVP claimable set"** (`DECISIONS.md:1979-1983`, "Open **required** seats on shifts in **`Pending` or `Filling`**") — the DEC is the origin of the stale wording, so this row's fix has a `decisions-internal` tail | CODE-CONTRADICTS | doc-wrong (+ `decisions-internal`) |
| C2.7-5 | `SPEC.md:1023-1053` (whole section) | — *(absence)* | **§2.7 is the only §2.x section in the SPEC with no `### Acceptance criteria` block.** `grep -n '^### Acceptance criteria' docs/SPEC.md` → `479, 579, 720, 828, 920, 1011` — §2.1 through §2.6, then nothing before `## 3.` at `:1056`. §2.7 also carries no `### Open questions`. So the audit's per-checkbox method has **zero boxes to tick** here, and the shard's own AC verdicts below are on the five numbered sub-clauses instead. This is not a judgment call about whether §2.7 *should* have ACs — it is the observation that six sections established a format and the seventh silently dropped it, in the section whose behavior is the most concurrency-sensitive in the crew app. Phase 7 shipped anyway (`PROJECT_PLAN.md:315-316`, 7.3/7.4 both `[x]`), so no checklist was blocked — the cost is retrospective, i.e. this shard | MISMATCH (structural) | **decision** |
| C2.7-6 | `SPEC.md:1023-1053` (whole section) | — *(absence)* | **Nothing in §2.7 says the surface is dark by default.** `/crew/open` calls `notFound()` unless `CREW_SELF_SERVE=1` (`open/page.tsx:53`), the claim action redirects away on the same gate (`open/actions.ts:26`), and the hub entry point doesn't render (`crew/page.tsx:487`). `app/lib/flags.ts:1-13`: *"OFF by default so `main` stays promotable to production at all times — until **7.0b** wires real email delivery (Resend on a DKIM-verified `crew.brewcle.com`)."* **The coupling is the finding, not the flag:** one env var gates **both** the DEC-081/DEC-079 crew code-login front door **and** this entire pull surface, so they cannot be shipped independently — a fact stated in neither §2.7 nor §3.2. Whether the var is set in production is **not answerable from the repo**; shard E's E1 established that prod carries variables absent from `DEPLOY.md`, and E1's headline consequence was specifically *"crew unable to sign in (`CREW_SELF_SERVE` gates the login door and is OFF by default)"* | UNVERIFIABLE | **decision** |
| C2.7-7 | `SPEC.md:1033-1034` | "One row per claimable seat: date · vessel · role · **committed window (call → back)** · Claim. … **no live counts**" | Two small letter-vs-shipped gaps in one sentence. **(a)** The collapsed row shows date · vessel-hue dot + vessel · role · **first departure** + **trip count**; the **call → back window is not on the row** — it lives in the `<details>` confirm sheet (`open/page.tsx:221-257` vs `:290-294` `confirmFacts`). Deliberate and reasoned in place — *"end time is left to the confirm sheet (too busy collapsed)"* (`:242-243`) — and pinned by `e2e/crew-open.spec.ts:73` (*"row leads with a vessel dot + right-justified departure time; confirm reads 'Currently:'"*). Neither the hue dot (DEC-086) nor the trip count appears in the spec's field list. **(b)** "no live counts" is contradicted in letter by the rendered `{rows.length} open` (`:99-101`) and the per-day `{day.rows.length} open` (`:111-113`). The code reinterprets the guardrail rather than breaking it — *"NO auto-refresh / NO polling / NO live per-state counts (**a bare row count for orientation is fine**)"* (`:28-30`) — which is a reasonable reading of DEC-042, just not the one §2.7.1 wrote down | MISMATCH | doc-wrong |
| C2.7-8 | `src/oracle/claimable.test.ts:125` | test name: `it("only Pending/Filling shifts — **not Crewed/AtRisk**")` | **A test name that asserts the opposite of the tested behavior**, 25 lines above the test that proves it wrong. The body constructs only a `Filling` and a `Crewed` shift (`:126-131`) — it never builds an `AtRisk` shift, so the "not AtRisk" half is unexercised — while `:150` *"an AtRisk shift **is** claimable — the shift that most needs a body (#440)"* asserts exactly the opposite and passes. Same failure class as C2.1's expiry row (a comment *and* a test name both asserting a false agreement): the name survived #440's widening because renaming a green test is optional. A reader grepping test names for the claimable-shift rule finds the pre-#440 answer first. Sibling, lower stakes: `claimable-view.test.ts:114` still names the presets *"the surface's **today / weekend** / from–to filter"*, retired by #414 (C2.7-3) | CODE-CONTRADICTS | code-wrong (low, test hygiene) |
| C2.7-9 | `SPEC.md:1031` | "the viewer is **eligible** for (credentials valid on the trip date + native role per DEC-076 + **not suppressed, §1.3**)" | The pointer resolves, but to a list that is **two rules short of what runs**, and to a word that now means two different things. `evaluateCandidate` (`eligibility.ts:259-278`) applies **six** rules: `is_active`, `has_rating`, `mmc_valid_on_date`, `not_double_booked`, `not_on_pto`, **`not_recurring_off`**. §1.3's "Rule list (verdicts)" (`SPEC.md:309-312`) names five crew rules and **omits `not_recurring_off`** (#411 / DEC-119, `eligibility.ts:233-241`) entirely; §2.1's suppression paragraph (`:433-435`) says suppressions are *"**PTO / blackout** windows only"*. So a reader following §2.7.1's pointer cannot enumerate the gate that actually decides what they see. Separately, "suppressed" in §2.7.1 unambiguously means **PTO** (the §1.3 sense) and **not** the DEC-129/130 `working`/`declinedOnDay` ask-suppression — a collision the spec never disambiguates because DEC-129/130 postdate §2.7. *(The §1.3 half of this is shard-C/§1.3 territory, logged here only because §2.7 is the doc that points at it.)* | MISMATCH (partial) | doc-wrong |

---

## Per-acceptance-criterion verdicts

**§2.7 has no `- [ ]` acceptance criteria** (C2.7-5). In their place, the five numbered sub-clauses are
verdicted on the same standard: implementing function *and* the test that pins it, plus any dependency
that makes a "MET" hollow.

### 2.7.1 The list — **PARTIALLY MET** (the *pool* is exactly right; three of the row/filter details drifted)

**The claimable set is correct and doubly pinned.** `claimableSeatsFor` (`claimable.ts:70-123`) layers,
in order: native role (`seat.role !== role` → skip, `:105`), shift state (`:96`), seat uncommitted +
`required` (`:103-104`), the `[today, today+windowDays]` window (`:84-85, 96`), and the full §1.3
`evaluateCandidate` gate (`:106-111`). The window is **45 days** (`CLAIMABLE_WINDOW_DAYS = 45`, `:45`),
matching `SPEC.md:1032` exactly, boundary-tested at `claimable.test.ts:188` *"today and today+45d are
in; today+46d is out"*. `today` is `vesselDateOf(now)` — vessel-local, never a UTC slice — with the
reason in place (`:81-83`) and pinned by `claimable.test.ts:200` *"uses the VESSEL-local date, not UTC
— evening-Eastern shifts don't slip (DEC-032)"*. This is the DEC-032 discipline C2.3 verified for the
builder, applied here independently.

**View decoration is thin and correct.** `buildClaimableView` (`claimable-view.ts:50-88`) *only*
decorates + narrows — *"The claimable SET … stays owned by `claimableSeatsFor`; this only decorates +
range-filters, so the read door and the write door keep one definition"* (`:9-11`) — and the range
`only narrows, never widens` (`:47-48, 59`). Trip times count **scheduled** departures only (`:66`),
tested at `claimable-view.test.ts:106`. Sort is date → earliest departure (`:82-86`), tested at `:129`.

**Not met, in the details:** the default filter and presets (C2.7-3), the shift/seat state widening
(C2.7-4), the row's field list and the "no live counts" clause (C2.7-7).

*Dependency that keeps this from being hollow:* none at the domain layer — `claimableSeatsFor` has one
production caller and it is the shipped route. But the **whole surface is `CREW_SELF_SERVE`-gated**
(C2.7-6), so "MET" here means "correct when the flag is on," which the repo cannot confirm for prod.

### 2.7.2 The claim — **MET**

`claimSeat` (`claim.ts:74-169`) re-validates the **entire** claimable predicate server-side before any
write — *"The passed `seatId` is never trusted (DEC-076): the browse list could be stale or forged"*
(`:16-19`) — reusing `claimableSeatsFor`'s exported constants so read and write doors cannot drift
(`:26-29, 89-90`). Confirm-sheet copy carries the DEC-077 elements verbatim in structure: whole-day
scope + "including any trips added or cancelled later" (`open/page.tsx:284`), live trip count and times
(`:293`), call and back (`:293`, `backAt`/`approxBack` `:311-313, 353-359`). E2E-pinned at
`crew-open.spec.ts:39-71` (confirm sheet → Claim → lands in My shifts) and `:73`.

**Auto-lock (DEC-075) is exact:** `Open → Confirmed` in one write, `acquiredVia: "self_claim"`
(`:157-164`) — provenance that suppresses the "Added for you" badge in My shifts
(`crew-view.ts:215-216`, #196). The dormant confirm-required seam branches before the write with no
mutation (`:144-146`), tested at `claim.test.ts:267`. "The seat now appears in **My shifts**" is
literal: `open/actions.ts:65-66` revalidates `/crew` and redirects to `/crew?claimed=…`.

**Races: guarded, honest, and the spec describes them** — the one thing this brief flagged as
potentially spec-silent, and it is not. The loser of a per-seat race gets `just_taken` → *"Someone
grabbed that one first — here's what's still open."* (`open/page.tsx:41`), e2e-pinned at
`crew-open.spec.ts:116`. The same-date conflict gets *"You already have a shift that day — one boat per
day is the rule."* (`:42`), e2e-pinned at `:124`. Both messages name the cause and hand back a refreshed
list — no silent failure, no optimistic UI to reconcile.

*Dependency that makes this MET **narrower than it reads**:* the same-date guard is a read-then-CAS over
a cross-record invariant the store cannot enforce, so it holds against *sequential* claims and not
against *concurrent* ones (C2.7-1). The sub-clause as written promises more than the code delivers; the
code says so in a comment and the spec does not.

### 2.7.3 Release — **PARTIALLY MET** (the behavior ships; the surface, the mechanism and the named function all differ from the text)

Release works, is authorized, and is reliability-weighted — but through the §2.6 bail edge, not the
§2.7 wrapper. `bailFromSeat` (`crew/shift/[shiftId]/actions.ts:26-76`) pins the occupant to the session
subject (`:44`) and calls `bailWithDerivedLateness` (`:51-56`), which logs exactly one `shift_bailed`
event weighted by lead time (DEC-028/DEC-008). Pinned by `claim.test.ts:332` *"emits exactly one
`shift_bailed` reliability event for the releaser"*, `:344` *"lead-time weighted: a near-departure
release outweighs a far-out one (DEC-008)"*, `:370` *"pins the occupant: releasing a seat you don't
hold → raced, no event"*, and end-to-end at `cascade-coexistence.test.ts:103` *"a self-released seat
re-enters the cascade: re-opens Open, then the **tick** re-crews it (DEC-128 #483)"*.

Three deltas from the text, all in C2.7-2: **"re-asks"** is DEC-128-stale; **`releaseSelfClaim`** — the
function written for this sub-clause, complete with its own docstring and five tests — is **dead**;
and **"as easy as claiming it"** is a one-tap-vs-two-navigations asymmetry the shipped geometry does not
honour. The domain wrapper is not wrong (its provenance-agnostic behavior is deliberate and documented,
`claim.ts:171-189`) — it is simply not the path any user takes.

### 2.7.4 What this surface is NOT — **MET, all five non-goals verified in code**

The brief's named constraint is at **`SPEC.md:1046`** (not `:1034` — corrected), and it holds.

| non-goal | verified |
|---|---|
| No sub-day blocks / "watches" (DEC-077) | The unit is the vessel-day `Shift`; nothing in the claim path addresses a sub-day interval. Confirm copy states whole-day scope explicitly (`open/page.tsx:284`) |
| No multi-role / role-picker (DEC-076) | `nativeRole(crew)` — highest-precedence rating only (`eligibility.ts:153-158`) — filters the read door (`claimable.ts:105`) *and* the write door (`claim.ts:99`). No role parameter reaches either from the surface. `claimable.test.ts:108`, `:212`; `claim.test.ts:129`, `:137` |
| **No supernumerary self-claim** | `seat.kind !== "required"` on both doors (`claimable.ts:103`, `claim.ts:98`). `claim.test.ts:159` *"a supernumerary seat is not claimable (Phase 7 scope)"*; `claimable.test.ts:134,146` includes a supernumerary seat in the fixture and asserts it out. **Holds** |
| No operator-confirm gate (dormant seam) | `repo.selfClaimRequiresConfirmation()` branches before the write, returns `requires_confirmation`, writes nothing (`claim.ts:144-146`); `claim.test.ts:267`. The surface maps it to the generic "unavailable" banner (`open/actions.ts:69-72`) — correct while dormant, and the code says so |
| No availability calendar (§4) | No positive-availability write path exists on `/crew/open`; the only write is `claimSeat`. Consistent with `SPEC.md:434` ("no positive 'set your recurring availability' calendar") |

### 2.7.5 Relationship to the cascade — **MET**

`cascade-coexistence.test.ts:76-133` is the dedicated proof (Phase 7.4, `PROJECT_PLAN.md:316`, `[x]`,
#184/PR #199), and its three test names are the sub-clause restated: *"a seat self-claimed during
`Pending` is skipped by the cascade at the horizon crossing"* (`:77`), *"a self-released seat re-enters
the cascade"* (`:103`), *"the system abstains during `Pending`, but a crew pull is orthogonal and still
works"* (`:131`). "Both end at a `Confirmed` seat via the same state machine" is structurally true —
`claimSeat` writes `Confirmed` and calls the shared `refreshShiftState` (`claim.ts:167`), the same
function the ask path uses.

**Eligibility symmetry, checked as the brief asked rather than assumed — and it is clean, with one
deliberate asymmetry in each direction, both DEC-blessed:**

- **Shared core.** Both doors call the *same* `evaluateCandidate` on the same six rules
  (`claimable.ts:106`, `claim.ts:126`, `eligibility.ts:264-271`). There is no rule the ask path applies
  that the claim path skips at the eligibility layer, so **nobody can claim a seat the §1.3 gate would
  have refused them.**
- **Asymmetry 1 (self-claim is stricter):** the ask path uses `isAskableFor`/`isRatedFor` — a
  dual-rated `[captain, mate]` member is rated for a mate seat and manually assignable to one (DEC-064)
  — while self-claim shows them captain seats only (`nativeRole`). **Deliberate, DEC-076**, and the
  precise pair is tested: `claimable.test.ts:212` *"both doors, dual-rated: self-claim hides the mate
  seat the operator can still assign"*.
- **Asymmetry 2 (self-claim is looser):** the tick applies `buildAskSuppression` — `working` (hard,
  DEC-129/#341) and `declinedOnDay` (soft, DEC-130/#342) — which self-claim never reads. **Deliberate
  and load-bearing**, stated in DEC-129 itself (`DECISIONS.md:3724`): *"suppression is a **send-time
  filter**, deliberately in `asks/` not `oracle/` … `rankedEligible` is untouched wholesale; **self-claim,
  manual lean, and `overrideSeat` never read the suppression**."* Benign in practice: `working` overlaps
  a same-date commitment, which `not_double_booked` already blocks; and bypassing `declinedOnDay` is the
  correct reading of an opt-in pull ("I said no to being texted, not no to volunteering").

*Dependency that keeps this from being hollow:* the coexistence rests on the tick skipping non-`Open`
seats, which is the ask engine's own invariant, not §2.7's. If that changed, §2.7.5 would break with no
§2.7 test catching it — `cascade-coexistence.test.ts` lives in `src/builder/`, next to the tick, which
is the right place for exactly this reason.

---

## What this shard would recommend

**The headline is C2.7-1, and it is a question, not a bug report (lesson 7).** §2.7.2 and DEC-078 both
assert the one-shift-per-date guard flatly. The implementation is a read-then-CAS that cannot enforce a
cross-record invariant on a no-FK store, and `claim.ts:111-119` says so at length, calls itself
"pilot-accepted, not a closed hole," and names the reachable outcome: **a crew member confirmed to two
boats the same day.** Nothing is filed (`gh issue list --search "double-book concurrent claim"` → `[]`).
Three things make this the shard's most consequential row rather than a routine caveat: the failure is
**silent** (two Confirmed seats, no error, discovered on the dock); it is the **one invariant §2.7 leans
on hardest**, since whole-day commitment is the entire reason DEC-077 chose day granularity; and the
window needs only two in-flight taps by **one person**, which is a plausible double-tap, not just a
two-actor race. **Ask the operator: is a same-day double-confirm worth guarding, or is "he'd notice"
sufficient at four boats?** If sufficient, say so in DEC-078 and add the caveat to `SPEC.md:1038` — do
**not** leave the docs asserting a guard the code disclaims. If not, the cheap fix is a post-write
re-read of `committedDates` that self-reverts the second confirm, not a lock.

**Four back-port-the-issue rows (C2.7-2c, -3, -4, -8).** #414, #440 and #483 all shipped, all closed,
and all changed behavior §2.7 still describes the old way: the filter presets, the claimable shift/seat
states (twice — §2.7.1 *and* §2.7.2), and the re-ask. Each is a one-clause edit with a closed issue
number to cite. **C2.7-4 has a `decisions-internal` tail**: DEC-078's "MVP claimable set" paragraph is
the origin of the stale `Pending`/`Filling` + `Open` wording, so fixing only the SPEC leaves the DEC as
the surviving wrong answer — route it to shard Z rather than editing DECISIONS in this run. **C2.7-8 is
the cheapest fix in the shard**: rename one test at `claimable.test.ts:125` (and, while there,
`claimable-view.test.ts:114`). A green test with a lying name is the exact failure mode that produced
C2.1's expiry bug.

**One genuine absence, escalated as a question (C2.7-5).** §2.7 is the only §2.x section with no
acceptance criteria. It may simply not need them — Phase 7 shipped, 7.3 and 7.4 are `[x]`, and the
coexistence tests are more rigorous than a checkbox. But the audit's whole method for §2.x is "verdict
every box," and this section — the most concurrency-sensitive surface in the crew app — is the one that
opted out. **Worth five criteria** if any get written; the five sub-clauses above are already in that
shape.

**One operator-facing unknown (C2.7-6).** §2.7 never mentions that the surface is dark unless
`CREW_SELF_SERVE=1`, and that the same variable gates the crew login door — so the two features ship
together or not at all. Whether it is on in production is not answerable from the repo, and shard E
established that prod carries variables `DEPLOY.md` omits. **One sentence in §2.7's Stance block**
("flag-gated behind `CREW_SELF_SERVE` together with the crew login front door, DEC-059/081") closes it,
plus an operator confirmation of the current prod value.

**One dead export (C2.7-2a).** `releaseSelfClaim` is 8 lines and 5 tests describing a path nobody walks.
It is not harmful — it is the documented §2.7.3 authorization wrapper, and its behavior is real via
`bailFromSeat` — but it is exactly the shape lesson 12 warns about: a next reader will cite it as the
shipped release path. Either wire `bailFromSeat` through it (one call-site change, zero behavior
change, and the tests stop being fiction) or mark it dead-not-deleted the way `manning.ts` is.

**One clarification (C2.7-9).** §2.7.1's "not suppressed, §1.3" points at a §1.3 rule list that omits
`not_recurring_off` (DEC-119), and "suppressed" now collides with the DEC-129/130 ask-suppression that
postdates it. The §2.7 half is one word; the §1.3 half belongs to whoever revisits §1.3.

---

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| **The 45-day browse window** | `SPEC.md:1032` "within `[today, today+45d]`" | `CLAIMABLE_WINDOW_DAYS = 45` (`claimable.ts:45`), applied in both doors (`:74, 85`; `claim.ts:79, 92`), boundary-tested (`claimable.test.ts:188`), and clamped again at the surface's `to` input `max={addDays(today, 45)}` (`open/page.tsx:176`). Exact |
| **"a fourth crew surface … knowing exception to §2.6's 'three surfaces' (DEC-074)"** | `SPEC.md:1025-1026` | Held, and the exception is honoured as an exception, not promoted: `DECISIONS.md:2438` — *"flag-gated pick-up surface (DEC-074) is a recorded exception, **not a destination to promote into**"*. The hub entry is one calm accent card, no badge, no count (`crew/page.tsx:484-497`) |
| **"pull, opt-in, anti-anxiety (DEC-042 guardrails)"** — no auto-refresh | `SPEC.md:1026-1027`, `:1034` | `export const dynamic = "force-dynamic"` with the reason inline — *"DEC-042: dynamic on navigation, **never polled**"* (`open/page.tsx:38`). No `setInterval`, no `revalidate`, no client component on the page. *(The "no live counts" half is C2.7-7)* |
| **"neutral ink (DEC-042)"** | `SPEC.md:1034` | Row and header ink are `text-ink`/`text-muted`/`text-faint`; the only saturated element is the Claim button (`border-accent bg-accent`) and the vessel identity dot (DEC-086, `aria-hidden`). No warm/bad tokens — those stay reserved for the At-Risk board, per the page docstring `:29-31` |
| **"is *not* the parked positive-availability calendar (§4): crew claim concrete, already-formed shifts"** | `SPEC.md:1027-1028` | Structurally true: the only rows are decorated `ClaimableSeat`s derived from `repo.listShifts()` (`claimable.ts:94`), and the only write is `claimSeat` on an existing `SeatId`. There is no abstract-availability write path anywhere on the surface. Matches `SPEC.md:434` and `PROJECT_PLAN.md:610` (soft-hold deferred, survives only as the DEC-075 seam) |
| **"One tap → confirm sheet"** with the DEC-077 copy elements | `SPEC.md:1036-1037` | Whole-day scope + elastic clause (`open/page.tsx:284`), live trip count + times (`:293`, `joinTimes` `:305-309`), call + back (`:293`). Matches DEC-077's specimen copy (`DECISIONS.md:1940-1944`) element-for-element; the one deviation is dropping "as **captain**" because the role is already in the row header, reasoned in place (`:228-229, 283`). No-JS: the sheet is a native `<details>`, the presets are GET links, Claim is a `<form action>` (`:34-35`) |
| **"Confirm → seat `Open → Confirmed` (auto-lock, DEC-075)"** — the auto-lock half | `SPEC.md:1037` | One write, no intermediate `Asked` (`claim.ts:157-166`), `claim.test.ts:102` *"Open native-role seat in window → Confirmed and assigned"*, `:119` *"a filled native-role seat confirms the shift → Crewed"*. *(The `Open →` half is C2.7-4)* |
| **"The seat now appears in My shifts (§2.6.2)"** | `SPEC.md:1038` | `revalidatePath("/crew")` + `redirect("/crew?claimed=…")` (`open/actions.ts:65-66`); e2e `crew-open.spec.ts:39` asserts the round trip. Provenance keeps it un-badged as "Added for you" (`crew-view.ts:215-216`, #196) |
| **"a reliability event is recorded, lead-time-weighted (§1.4)"** | `SPEC.md:1042` | Exactly one `shift_bailed`, DEC-008-weighted — `claim.test.ts:332`, `:344`. And the **inverse** is also correct and spec-consistent: a *claim* emits **no** reliability event (`claim.ts:70-72`, tested `:280` *"a claim emits no reliability event (DEC-078 — earned at Completed, not claim)"*), matching DEC-078's rationale *"showing up is what counts"* |
| **"Self-claim front-loads fills … during `Pending`/early `Filling`"** — the `Pending` half specifically | `SPEC.md:1049-1051` | `Pending` is in `CLAIMABLE_SHIFT_STATES` (`claimable.ts:29`), and DEC-078 explains why this doesn't violate §1.1's "crew rules abstain": *"the **system** still abstains from asking; a crew member pulling is orthogonal"* (`DECISIONS.md:1982-1983`). Pinned by `cascade-coexistence.test.ts:131` |
| **`cascade-coexistence.test.ts` is about §2.7.5** | this shard vs C2.3's NOISE row | **Both are right, and C2.3's correction stands.** C2.3 refuted the file as evidence for §2.3's import-vs-live coexistence and identified its real subject: *"pull and push coexist (SPEC §2.7.5, DEC-078)"* (`:1-9`). That subject is **this** shard's, and the file is §2.7.5's primary evidence. No conflict — C2.3 handed it forward correctly |
| **The claim never trusts client input** | not claimed in §2.7; checked anyway | `claim.ts:16-19` + the full re-validation at `:93-138`; the action additionally gates flag + crew session and rewrites `back` to a `/crew/open` prefix before redirecting (`open/actions.ts:26-31`) — no open-redirect via the `back` field |
| **Vessel-local date discipline throughout** | DEC-032 | `vesselDateOf(now)` in both doors (`claimable.ts:84`, `claim.ts:91`); the surface's `today` likewise (`open/page.tsx:58`); date *display* parses `iso + "T00:00:00Z"` with `timeZone: "UTC"` so the stored vessel-local date renders verbatim (`:191-198, 342-350`). Tested `claimable.test.ts:200`. No instant-vs-date fork of the C2.1-10 shape here |
| **Empty state is calm** | `SPEC.md:1034` "Empty = normal, not an error" | `<Notice>Nothing open in this window. Check back, or widen the dates above.</Notice>` (`open/page.tsx:96`) — no error styling, no alarm. *(But see the trainee note below — the copy blames the window even when the window is not the cause)* |
| **Trainees / unrated crew see an empty list, and that is the designed behavior** | brief item 4 | `nativeRole` returns `null` when ratings are empty, and `claimableSeatsFor` returns `[]` immediately (`claimable.ts:78-79`), tested at `claimable.test.ts:95` *"null when there is no determinable role"*. Correct and consistent with §2.7.4's "No supernumerary self-claim" — a trainee's seat kind is `supernumerary`, which is excluded independently (`:103`), so **there are two locks on the same door**. Recorded as consistent rather than a finding: the copy is imperfect (an unrated viewer is told to "widen the dates", which will never help) but §2.7 specifies neither a trainee case nor differentiated empty-state copy, so there is no doc claim to contradict. Worth a UX note if anyone revisits: `rows.length === 0 && !nativeRole(crew)` is a distinguishable state |
| **`AtRisk` inclusion does not leak At-Risk anxiety into the calm surface** | DEC-042 vs #440 | The row renders identically regardless of shift state — there is no state badge on `ClaimableSeatView` at all (`claimable-view.ts:19-37`), so an `AtRisk` shift is indistinguishable from a `Pending` one on `/crew/open`. The two DECs are reconciled by *omission*, which is the right answer, and nobody wrote it down |
| **Error copy is honest and cause-naming** | DEC-042 anti-anxiety | Three codes, three messages, none of them "something went wrong" for a knowable cause (`open/page.tsx:40-44`); `requires_confirmation` correctly falls to the generic banner while the tier is dormant, and the code says so (`open/actions.ts:69-70`) |
| **Audit trail on self-claim** | not claimed in §2.7 | `logCrewAdded(..., { via: "self_claim" })`, best-effort post-mutation so an audit hiccup can't fail a confirmed claim (`open/actions.ts:50-63`, #400/DEC-118). Mirrors `seat.acquiredVia` (`domain/audit.ts:44`) |

---

## Coverage — what this shard did and did not read

- **Read in full:** `SPEC.md:1023–1061`; `src/oracle/claimable.ts`, `src/asks/claim.ts`,
  `src/crewapp/claimable-view.ts`, `src/oracle/eligibility.ts`, `src/asks/suppression.ts`,
  `app/(crew)/crew/open/page.tsx`, `app/(crew)/crew/open/actions.ts`,
  `app/(crew)/crew/shift/[shiftId]/actions.ts`, `app/lib/flags.ts`; DEC-074, DEC-075, DEC-076,
  DEC-077, DEC-078, DEC-128, DEC-129 (decision bodies); `SPEC.md` §1.3 (`239–318`).
- **Read in part / targeted:** `app/(crew)/crew/page.tsx:475–500` (the entry point),
  `src/crewapp/crew-view.ts:210–220` (provenance badge), `e2e/crew-open.spec.ts` (header + all 7
  test names + the claim-flow body `:39–71`), `src/oracle/claimable.test.ts:116–160` (line by line),
  `SPEC.md:430–460` (§2.1 suppression), `:1011–1019` (§2.6 ACs), `PROJECT_PLAN.md:274–326, 610`,
  DEC-079/DEC-119/DEC-130 (index lines + the paragraphs cited).
- **Test-name-verified, not read line by line:** the full `it(...)` inventory of `claim.test.ts` (24),
  `claimable.test.ts` (13), `claimable-view.test.ts` (7), `cascade-coexistence.test.ts` (3). Every
  "tested at" citation names a test whose *name* states the behavior; assertion bodies were read only
  for `claimable.test.ts:116–155`, where the name and the behavior disagree (C2.7-8).
- **Greps run (4, all narrow):** `releaseSelfClaim`; `claimableSeatsFor|buildClaimableView`;
  `crew/open` across `app/` + `components/`; `bailWithDerivedLateness|acquiredVia` across
  `app/`+`src/`+`components/`. **No speculative whole-tree zero-caller sweep** — but every component
  and function cited as live evidence was individually caller-checked (see the table above), which is
  how C2.7-2's dead `releaseSelfClaim` surfaced.
- **Not read:** `src/asks/ask-loop.ts` body (only the two symbols §2.7 depends on plus its
  `acquiredVia` handling), `src/oracle/oracle.ts` body (`committedDatesByCrew`/`COMMITTED_SEAT_STATES`
  signatures only), the tick, `src/crewapp/shift-card.ts` beyond `committedWindow`'s contract,
  `SPEC.md` §2.4–§2.6, and the `feature/reservations` tree (§2.7 confirmed untouched by all 13 hunks —
  see the which-tree check).

## Cost

**~105k subagent tokens** — inside the ~95–120k band the orchestrator set for a section with a shipped
surface, on the **shortest** section in the sweep (31 body lines vs §2.3's 112). The line count bought
nothing: §2.7's 31 lines produced 9 findings, because a pull surface's claims are *behavioral* — a
window, a state set, a guard, a race — and each one costs a module read plus a test-name check
regardless of how tersely it was written. **The transferable refinement to lesson 12:** budget by the
number of *checkable behavioral assertions*, not by line count and not only by whether a surface
exists. The one place the budget went further than expected was eligibility symmetry, which the brief
flagged as a likely defect and which cost two file reads to clear — `claimableSeatsFor` and `claimSeat`
share exported constants *and* the same `evaluateCandidate` call precisely so this check would be
cheap. Somebody built that on purpose; it saved this shard about 15k.
