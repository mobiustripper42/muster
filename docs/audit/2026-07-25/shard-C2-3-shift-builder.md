# Shard C2.3 — Shift Builder

**Subject:** `docs/SPEC.md` lines **606–717** — all of `## 2.3 Shift Builder`: the two block-quote
headers, Purpose, the fork-resolved note, Auto-grouping rule, What a shift carries, States to render,
Actions, Lock semantics, Data read, Edge cases, the 5 acceptance criteria, and Open questions.

**Audited tree:** `main` @ `d6f78d5` (branch `task/audit-c2-3-shift-builder`).

> **Which-tree check (lesson 4) — re-verified for §2.3, and it is not a formality.**
> `docs/SPEC.md` **does** diverge between the trees: `git diff main origin/feature/reservations --
> docs/SPEC.md` = 150 insertions / 89 deletions across 10 hunks. **None of them touch 606–717.** The
> hunks bracket the section (`main` lines 119, 239–317, 501, 519–521, 542, 569–570, then 1177–1181) and
> land in §0.2, §1.3, §1.4, §2.2's tail and §4. So §2.3 is byte-identical on both trees and a `main`
> sweep is complete for this subject — but the "SPEC §2.x is byte-identical" shorthand from C2.1/C2.2
> is now **false at file granularity** and should not be reused unchecked for §2.4–§2.7.

**Evidence read.** `src/builder/` — `form-shifts.ts` (full), `derive.ts` (full), `split.ts`, `merge.ts`,
`manning.ts` (full), plus the `it(...)` inventory of `form-shifts.test.ts`, `split.test.ts`,
`merge.test.ts`, `manning.test.ts`, `derive.test.ts`, `tick.test.ts`, `split-suggestion.test.ts`, and
the headers of `cascade-coexistence.test.ts`, `doorbell-tick.ts`, `form-notices.ts`, `form-audit.ts`,
`ring-relay.test.ts`. `src/admin/all-shifts.ts` (full). `app/(admin)/admin/shifts/page.tsx` +
`actions.ts`. `components/admin/shift-row.tsx`, `components/assignment/{shift-cockpit,manning-section,
shift-manifest}.tsx` (targeted). `src/import/{xola-client,xola-pull,resource-map}.ts` (date/vessel
resolution). `src/reservations/availability.ts`. `src/domain/{entities,states}.ts` (seat/shift half).
`db/migrations/0001_init.sql`, `0022_drop_shifts_locked_at.sql`. `docs/DECISIONS.md` — DEC-005, DEC-016,
DEC-022, DEC-029, DEC-032, DEC-042, DEC-043, DEC-062, DEC-063, DEC-082, DEC-083, DEC-084, DEC-085/086,
DEC-087, DEC-105, DEC-114, DEC-126, DEC-ROLE-1. `docs/design/BUILDER-RECONCILIATION.md`,
`docs/design/DESIGN-REFERENCE.md:108–140`, `docs/USER_STORIES.md` §Shift Builder,
`docs/PROJECT_PLAN.md` Phase 9, `docs/SPEC.md` §0.3 / §3.5 / §4.

**What this shard did *not* have to do.** No speculative whole-tree zero-caller greps. §2.3's machinery
is shipped and reachable end-to-end: `formShifts` ← `xola-pull.ts:182`; `splitShift`/`mergeShift` ←
`app/(admin)/admin/shifts/actions.ts:34,83`; `addOverrideSeat`/`staffTraineeSeat` ←
`app/(admin)/admin/shift/[shiftId]/actions.ts:13–16`. **This is the first C2 sub-shard whose surface
exists.** Two greps proved genuine absences (lock scaffolding; any pax↔seat arithmetic) and both are
cited inline with the search terms.

---

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| C2.3-1 | `SPEC.md:674-678` | "### Lock semantics — **Before lock:** the shift quietly absorbs incoming bookings … **After lock:** … each change raises a **review nudge** … Lock = 'the system was assembling this' → 'I've reviewed it and crewing may proceed.'" | **Live, unstruck, and specifying exactly what the section's own header declares dead.** `SPEC.md:612-620`: "Everything below that specs a lock state, a lock action, a 'changed since you reviewed it' nudge … is **superseded and not built**." Its neighbours at `:652-657` and `:665-668` *are* struck; this three-bullet section is not. Nothing survives in code or schema: `grep -rn 'lockShift\|lockedAt\|locked_at\|changedSinceReviewed'` over the whole tree returns **only** `db/migrations/0001_init.sql:88` (the original column), `db/migrations/0022_drop_shifts_locked_at.sql:14` (`alter table shifts drop column if exists locked_at`), and one `0004` comment. `src/builder/lock.ts` no longer exists. `entities.ts:225` — "the lock-anchored nudge was retired with locking, DEC-082/#215". Cleanup shipped as **9.1 `[x]`** (`PROJECT_PLAN.md:412`). `USER_STORIES.md:26-31` already struck SP-6/SP-7 (shard C). SPEC §2.3 is the **last live description of lock anywhere in the corpus** | MISMATCH | doc-wrong |
| C2.3-2 | `SPEC.md:714-715` | "Lock granularity — per-shift confirmed; **bulk weekend-lock** likely also. *(Build per-shift first.)*" | Live guidance for a cut feature. DEC-082 (`DECISIONS.md:2135`) drops **8.2b** (per-shift lock) *and* **8.6** (bulk "lock the weekend") by name — not deferred, "**formally cut, not completed**". The *adjacent* open question at `:710-713` is correctly struck + RESOLVED-stamped; this one was missed in the same pass | MISMATCH | doc-wrong |
| C2.3-3 | `SPEC.md:1141-1142` *(§4 Parked — outside the line range, same claim)* | "**Bulk actions** — weekend-lock (builder), cross-shift broadcast (assignment/board). Build the single-item versions first." | Parks as future work the thing DEC-082 cut outright. "Build the single-item version first" is unreachable advice — there is no single-item version to build first. The cross-shift-broadcast half is untouched by DEC-082 and stays | MISMATCH | doc-wrong |
| C2.3-4 | `SPEC.md:608-610` | "The 2026 import-mode and the 2027 live-mode are the **same surface** — only the input source differs (coexistence §4)." | The **durable half is true** (see NOISE) — the builder is genuinely source-agnostic. The **framing is superseded**: `SPEC.md:97-103` strikes the 2027-switch picture in its own words — "**corrected (DEC-105/126): this is 2026, via coexistence → cutover, not a dated switch** … the import path dies at the **cutover**, not on a calendar date." DEC-126 §3: "**The ongoing Xola API pull STOPS.**" So there is no "2027 live-mode"; there is a cutover after which the import mode ceases to exist. Reconciled in §0.3 and §2.2 (PR #550), missed in §2.3 | MISMATCH | doc-wrong |
| C2.3-5 | `SPEC.md:670-672` | "(The **CSV import** action itself lives in Event Admin §2.2 … In 2026 the builder simply shows shifts auto-formed from imported events — same as it will from the **live feed in 2027**.)" | Both halves stale. CSV retired by **DEC-043** (`DECISIONS.md:1358`, "the xlsx upload is retired — it can't resolve a boat"); the ingest is `xola-pull.ts`. "Live feed in 2027" is the same superseded arc as C2.3-4 | MISMATCH | doc-wrong |
| C2.3-6 | `SPEC.md:644-646` + AC-3 `:700-701` | supernumerary seat "**consumes a passenger slot** vs COI max-pax" / "**decrements** available pax against COI max" | **Nothing anywhere computes this.** `grep -rniE 'max[_ ]?pax\|capacity\|remaining\|seatsLeft'` across `src/`+`app/`+`db/`: `Vessel.coiMaxPax` is written by the seed (`resource-map.ts:115`) and read by exactly one validator (`crew-admin.ts:33`, `< 1` throws). The board's `paxTotal` is `Σ` booked party sizes with **no seat term** (`all-shifts.ts:171-174, 220`). The one capacity gate in the repo is `canBook` (`availability.ts:82`, `partySize > event.capacity`) — a **customer-booking** check on Muster-native whole-boat charters that never sees a Seat; and per its own header the model is a **mutex, not a seat count** (DEC-105/108/109), so there is no "available pax" quantity for a trainee to decrement. Xola-sourced bookings are never capacity-checked by Muster at all. ~~Meanwhile the operator UI **asserts the rule in prose with no number**: `manning-section.tsx:72` — "rides along — takes a pax slot, doesn't gate."~~ **CORRECTED 2026-07-27 (orchestrator + operator):** that copy is **dead code, not shipped UI**. `ManningSection` has **zero callers** anywhere in `app/` or `components/` (grep for both the symbol and the module path), and the file is byte-identical on `main` and `feature/reservations`; its caller dropped out at `cc581f8` (Phase 9.5, the two-pane cockpit rebuild). Supernumerary seats were **removed from the UI**; the seat machinery (`manning.ts`, the `supernumerary` seat kind, `ask-loop`'s `trainee_seat` guard, payroll's unpaid-ride rule) is retained but currently unreachable. The rule is therefore asserted in **two** places, both docs, not three. This row was mis-evidenced because the shard brief suppressed zero-caller greps — see README lesson 12. `BUILDER-RECONCILIATION.md:44-45` already named this exact gap ("Manning says a trainee 'takes a pax slot' but the number never appears", scheduled 9.6/9.8 "*if cheap*"); **both bundles shipped `[x]`** (`PROJECT_PLAN.md:417,419) without it | CODE-CONTRADICTS | **decision** |
| C2.3-7 | `SPEC.md:649` | "Date-range / weekend view, **grouped by boat then day**." | Shipped surface groups **day then boat**: `groupByDay(rows)` renders one `<section>` per date with a full-weekday header (`shifts/page.tsx:464-478`, `fmtDayHeader`), and `deriveAllShifts` sorts date → earliest departure (`all-shifts.ts:230-234`). Deliberate, reviewed, and blessed by a DEC — `BUILDER-RECONCILIATION.md:19-20` "add a per-vessel identity hue + **bless day-grouping with a DEC** → **DEC-086** + DEC-085"; the weekend rhythm is #122. Boat identity is carried by hue + vessel name per row, not by grouping. The doc is the stale party | CODE-CONTRADICTS | doc-wrong |
| C2.3-8 | `app/(admin)/admin/shifts/actions.ts:34`, `:83` vs `SPEC.md:683-684` | "forming a shift is how it is *born* — into `Pending`, or straight into `Filling` if already inside the staffing horizon." | The **import** path does this correctly (`xola-pull.ts:182-186` passes `now` + `leadDays`; `form-shifts.ts:395-404` then uses `resolveShiftState`). The **split/merge** server actions call `splitShift(getRepo(), shiftId, cut)` and `mergeShift(getRepo(), shiftId)` **with no `now`** — both service functions accept an optional `now` (`split.ts:27`, `merge.ts:40`) and pass it through, but the edge never supplies one. So a split performed inside the staffing horizon persists a freshly-born side B as `Pending` via the pure seat-fold, not `Filling`. **Self-healing, not user-visible:** `resolveShiftStateOnRead` re-resolves on every board and cockpit read (`all-shifts.ts:157-160`, the DEC-023 corollary "never trust the persisted badge") and the next `tick` advances the row. Cost of the fix is one argument at two call sites. **FIXED 2026-07-27:** both actions now build one `now` above the `try` and pass it into `splitShift`/`mergeShift`; `mergeAction`'s audit clock was hoisted rather than re-minted, so state resolution and the audit row share one instant. Pinned by four tests (`split.test.ts`, `merge.test.ts`) asserting **both** halves of the contract — `Filling` with a clock inside the horizon, `Pending` without — so dropping the argument at a call site fails a test instead of silently persisting a stale badge. Tested at this layer deliberately: `resolveShiftStateOnRead` masks the defect from any e2e assertion | CODE-CONTRADICTS | code-wrong (low) → **FIXED** |
| C2.3-9 | `SPEC.md:642-643` | "*(Correction, DEC-016: … **zero-crew rentals are in scope**; the count is per-vessel data, 0/1/2/N.)*" | True of the **deriver**, false of the shipped **ingest**, and the sentence doesn't say which. Deriver: `deriveSeats` on `manning: []` yields zero seats (`derive.ts:32-42`), `deriveShiftState` returns `Crewed` vacuously (`:63-65`), tested at `derive.test.ts:66` / `:72` and end-to-end at `form-shifts.test.ts:50` *"forms a zero-crew rental into a vacuously-Crewed shift with no seats"*. Ingest: both self-captained Duffy resources sit in `EXCLUDED_RESOURCES` (`resource-map.ts:65-68`) — "a known exclusion, not a quarantine" — so **no zero-crew vessel-day can form in production**. Consistent with DEC-016's own framing (zero-crew boats are "required *test cases* regardless of ownership"), so this is a scope-of-claim ambiguity, not a defect. Also checked per the brief: **nothing divides by seat count** anywhere (`required.length` is used only for `=== 0`, `.filter().length` and display counts — `derive.ts:64-65`, `all-shifts.ts:221-222`), so the zero-seat shift breaks no arithmetic | MISMATCH (partial) | doc-wrong |
| C2.3-10 | `SPEC.md:716` | Open question: "The 'suggest a split' gap threshold — **tune later, don't agonize**." | Resolved and shipped, and by **more** than the question asked. `suggestSplit` (`derive.ts:494-561`) has **two** independent triggers — `large-gap` (dead time between one trip's teardown and the next's prep, accounting for `CALL_LEAD`/`TRIP_DURATION`/`TEARDOWN`) and `long-span` (a long day with no single big gap) — each with its own env knob in the DEC-062 pattern (`SPLIT_SUGGEST_GAP_MINUTES` 120, `SPLIT_SUGGEST_SPAN_MINUTES` 600, `:467-480`). 14 tests including both strict-threshold boundaries (`split-suggestion.test.ts:94-113`). Surfaced per-row plus a `?split=1` "split candidates only" board filter (`all-shifts.ts:225`, `shifts/page.tsx:322-327`). The open question reads as unfinished business; it is finished | MISMATCH | doc-wrong |
| C2.3-11 | `SPEC.md:698-699` (AC-2) | "Splitting a shift produces two shifts whose trips **partition the original's**" | Near-miss wording on a correct design. The partition is re-derived **every pull from the vessel-day's live scheduled trips**, not from a snapshot of the original's `eventIds`: `formShifts` re-splits `scheduled` by `e.time < cut` on each run (`form-shifts.ts:144-175`), and `splitShift` validates the cut against live events, not `shift.eventIds` (`split.ts:57-73`, comment: "what `formShifts` will actually partition, not a stale `eventIds`"). This is the whole point of DEC-083 (a new Xola trip auto-lands on the right side; a cancelled trip lands on neither). So after any booking change the two sides' union is **not** the original's trip set, by design. The criterion is met in spirit and mis-worded in letter | MISMATCH | doc-wrong |

---

## Per-acceptance-criterion verdicts

The five `- [ ]` boxes at `SPEC.md:695–706`, ticked against source for the first time.

### AC-1 — "Importing/refreshing events produces proposed shifts grouped one-boat-one-day, with required seats derived from COI — no manual grouping step." — **MET**
`formShifts` groups every event by `${e.vesselId}|${e.date}` (`form-shifts.ts:97-103`) into the
deterministic canonical id `shift-{vesselId}-{date}` (`:130`), and seats come from
`deriveSeats(vessel, shiftId)` iterating `vessel.manning` — N roles × count, never a captain/mate
assumption (`derive.ts:32-42`, DEC-ROLE-1). Manning is seeded from the real COI capacities
(`resource-map.ts:33-37, 111-119`). Wired to the live ingest at `xola-pull.ts:182`; there is no manual
grouping control anywhere on the surface. Tests: `form-shifts.test.ts:38` *"groups same-vessel-same-day
events into one shift and derives seats"*, `:59` *"is idempotent — re-form preserves a Confirmed seat
and does not duplicate"*, `derive.test.ts:50` *"iterates an N-role manning list (3 roles, 4 seats)"*.

**The day-boundary check the brief asked for: clean, and structurally so.** The grouping key's `date`
is a **vessel-local calendar date that is never derived from an instant.** `itemDateTime` and
`eventDateTime` take a *string slice* of Xola's offset-bearing local wall-clock rather than parsing a
`Date` (`xola-client.ts:141-167`), with the reason spelled out at `:156-159` — Xola's `start` carries
the local wall-clock under a `Z` suffix that is **not** the real zone, so a parse would shift it.
Downstream, weekday classification uses `vesselDateOf`, never `getUTCDay` (`derive.ts:298-302`, pinned
by `derive.test.ts:196` *"classifies the weekday from the VESSEL-LOCAL date, not the UTC instant"*), and
the pull window is built from `vesselLocalDate` (`xola-pull.ts:38-46`). **There is no UTC-vs-local fork
of the C2.1-10 shape here** — no second code path re-derives the day from an instant, so there is
nothing for the string path to disagree with.

### AC-2 — "Splitting a shift produces two shifts whose trips partition the original's; merging is the inverse." — **MET** (wording aside, C2.3-11)
`splitShift` stores one field — `splitCutTime` on the canonical row — and re-forms (`split.ts:75-80`);
`formShifts` then materializes side A (`e.time < cut`, canonical id, crew preserved by stable seat id)
and side B (`>= cut`, `{id}-b`, born fresh) on every subsequent pull (`form-shifts.ts:144-175`).
`mergeShift` clears the cut, explicitly removes `…-b` + its seats, and re-forms to one shift
(`merge.ts:1-11, 97`). Both are guarded: malformed cut, already-split, side-B target, non-canonical id,
and a cut leaving one side empty all throw (`split.ts:32-73`).
Operator path is real — builder Edit mode (`?mode=edit`, `shifts/page.tsx:34-38`) → `splitAction` /
`mergeAction` (`actions.ts:25,75`). Tests: `split.test.ts:45,60,92,105,111,133,140,145,152,159` (incl.
*"survives re-import: a new Xola trip auto-lands on the correct side by its time"* and *"a trip exactly
at the cut goes to side B (half-open)"*), `merge.test.ts:45,60,95,109,130`, plus 10 more pinning the
collapse/resurrection notice netting (`split.test.ts:206-339`).
*Caveats:* the letter-vs-spirit wording of "partition the original's" (C2.3-11), and the missing `now`
at both action call sites (C2.3-8).

### AC-3 — "Overriding to add a required hand changes the gate for `Crewed`; adding a supernumerary seat does **not** gate `Crewed` and **decrements** available pax against COI max." — **PARTIALLY MET (first clause yes; second clause has no implementation anywhere)**
**First half, MET.** `addOverrideSeat` mints an additive `override:true` seat of either kind and
re-derives (`manning.ts:28-59`); `deriveShiftState` folds **required** seats only, ignoring
supernumeraries (`derive.ts:63-70`, DEC-005). Override seats are prune-exempt so they survive Xola
re-import (`form-shifts.ts:380-381`). Tests: `manning.test.ts:42` *"adds a required hand + it SURVIVES a
re-form (prune-exempt)"*, `:57` *"a required override drops a fully-crewed shift out of Crewed
(gates)"*, `:73` *"adds a supernumerary seat (non-gating) that survives a re-form"*.
~~Reachable UI: `components/assignment/manning-section.tsx:163,172`.~~ **CORRECTED 2026-07-27: not
reachable.** `ManningSection` has zero callers; its caller dropped out at `cc581f8` (Phase 9.5). The
first half is MET **in the domain layer only** — there is no operator path to add either seat kind today.
**Second half, NOT MET — but not a defect.** See C2.3-6. No code subtracts a supernumerary seat from
`coiMaxPax` or `Event.capacity`; the only capacity predicate in the repo is the customer-side `canBook`,
whose model is a **whole-boat mutex, not a seat count** (`availability.ts:5-17`), and Xola-sourced
bookings are never capacity-checked by Muster at all.
**RESOLVED on operator input, 2026-07-27.** Two answers, and together they close this without code:
1. **The domain rule is confirmed and is stricter than the spec implies.** COI max-pax counts *people*.
   A trainee, a guest and a working hand are the same to it — "if they have a heartbeat they count."
   So "consumes a passenger slot" is **correct**, and correct for reasons that have nothing to do with
   the seat being supernumerary. The spec's framing — a special rule attached to trainee seats — is the
   part that's off.
2. **Supernumerary seats are removed from the UI; the code is retained but dead.** There is nothing to
   decrement against because there is no operator path to create the seat. This is a deliberate state,
   not an oversight.
So AC-3's second clause is **unreachable rather than unmet**, and the AC as a whole is verdicted
**PARTIALLY MET (domain layer only, no operator path)**. `BUILDER-RECONCILIATION.md:44-45` flagged the
missing number a year of phases ago; it did not ship because the feature it belonged to was withdrawn.

### AC-4 — ~~"Locking a shift inside the staffing horizon fires Tier-1 asks; locking one outside does not."~~ — struck (DEC-082). **Replacement clause: "a shift crossing the staffing horizon moves `Pending → Filling` and fires Tier-1 asks (DEC-022/062)." — MET**
`resolveShiftState` overlays the horizon on the pure seat-fold: before the horizon → `Pending`; after
it, an all-Open shift → `Filling` (`derive.ts:622-633`). The horizon itself is derived, never stored —
earliest scheduled departure − `STAFFING_HORIZON_LEAD_DAYS` (`:290-308`, DEC-022), env-tunable
(DEC-062), with a weekend-cohort variant (DEC-116). The tick then fires Tier-1 on the `Filling` shift.
Tests, three of them and directly on point: `tick.test.ts:99` *"births a past-horizon shift into Filling
and **fires Tier-1 asks**"*, `:136` *"leaves a pre-horizon shift Pending and asks no one"*, `:118`
*"never works a shift whose trip has already departed (#147, DEC-062)"*. Birth-time horizon awareness is
also exercised at `form-shifts.test.ts:337`.
*Dependency that keeps this from being hollow:* the criterion is carried by the **tick**, which reads a
live clock every sweep — not by every `formShifts` call, two of which omit `now` (C2.3-8). Since the
tick and `resolveShiftStateOnRead` both re-resolve, the omission delays a persisted badge, never an ask.

### AC-5 — "A booking landing on an existing shift joins it silently; a booking for a boat/day with no shift spawns a new proposed shift." — **MET, with one live nuance the criterion predates**
Join: the vessel-day key already exists, so the event folds into the same shift and seat states are
preserved by id (`form-shifts.ts:97-111`, `:364-390`). Spawn: an unseen key mints the canonical shift and
records it in `createdShiftIds` (`:443-446`), which the board renders as a **new-shift cue** on the row
(`shifts/page.tsx:331-333` reading the latest import run, `shift-row.tsx:154`) — i.e. §2.3's "appears as
a new block needing review" (`SPEC.md:658-659`) is shipped, sourced from the import run rather than a
lock. Tests: `form-shifts.test.ts:38,59,352`, `split.test.ts:92`.
**Nuance:** "silently" is now true **operator-side only**. Since #350, a trip *added to a surviving
shift* relays "your shift changed" to that shift's assigned **crew** (`form-shifts.ts:431-442` →
`form-notices.ts` → the import edge), diff-gated and opt-in per command
(`form-shifts.test.ts:217`, `:253`). That is a crew notice, not the DEC-082-cut operator review nudge,
so it doesn't violate the criterion — but the word "silently" no longer describes the whole system
behavior, and a reader checking this box would not learn that a booking change texts people.

---

## What this shard would recommend

**The section's reconciliation is 80% done and the missing 20% is the part that specs a dead feature
(C2.3-1, -2, -3).** The DEC-082 pass of 2026-07-15 struck the Lock bullet under "States to render", the
Lock action, the locked-shift edge case, and one of three open questions — then left the **entire
`### Lock semantics` subsection** and the **bulk-weekend-lock open question** standing, both of which the
header two hundred lines above declares superseded in so many words. Everywhere else in the corpus lock
is dead: the column is dropped by migration `0022`, `src/builder/lock.ts` is deleted, `USER_STORIES.md`
SP-6/SP-7 are struck (shard C), `DESIGN-REFERENCE.md:115` calls out its own stale lock row. **SPEC §2.3
is the last live description of shift lock in the project.** The fix is the same strike-in-place
treatment its neighbours already got — three bullets and one open-question line — plus the `§4 Parked`
row at `:1141`. Zero judgment required; this is finishing a pass that stopped early.

**Four stale-arc / stale-mechanism clauses (C2.3-4, -5, -7, -10).** The "2026 import-mode vs 2027
live-mode" framing (twice) is the pre-DEC-126 picture that §0.3 and §2.2 have already been rewritten
away from; "CSV import" is DEC-043-retired; "grouped by boat then day" describes the opposite of the
shipped board; and the split-threshold open question was answered by two env knobs and 14 tests. All
four are one-clause edits with a DEC or a `file:line` to cite.

**One operator decision, and it is the shard's headline (C2.3-6 / AC-3).** *Does a supernumerary seat
need to actually decrement bookable pax, or is "the operator knows he put a trainee aboard" sufficient
at one-boat scale?* The claim is currently asserted in **three** places — the spec restatement, an
acceptance criterion, and operator-facing UI copy — and implemented in **none**. Two things make it
non-obvious rather than a simple bug: (a) COI max-pax is a **legal** limit, so an unenforced claim in
the UI is the kind that matters if it's ever wrong; and (b) the shipped booking model is a **whole-boat
mutex** (DEC-105/108/109), so there is no per-seat availability number for a trainee to decrement —
implementing this would mean either surfacing `pax / effective-COI-max` as a *displayed fact* on the
cockpit trip line (which is precisely what `BUILDER-RECONCILIATION.md:44-45` proposed and 9.6/9.8 shipped
without) or teaching `canBook` about seats, which cuts across DEC-108's whole-boat premise. **Ask before
filing** (lesson 7). If the answer is "display only, never enforce", say so in a DEC and trim the AC's
"decrements" to "is displayed against"; if it's "not wanted", strike the clause in all three places
including the UI copy. Do **not** close it by quietly deleting the AC clause — that buries a
COI-compliance question under a doc tidy.

**Two small code items, both cheap (C2.3-8, and the AC-5 nuance).** Passing `now` into `splitShift` /
`mergeShift` at `actions.ts:34,83` is a one-argument fix at two call sites that makes the persisted badge
match the spec immediately instead of at the next tick. The AC-5 wording nuance ("silently" is now
operator-side only) is a doc clause, not a defect.

**One scope-of-claim clarification (C2.3-9).** "Zero-crew rentals are in scope" is true of the deriver
(tested twice) and false of the ingest (both Duffy resources are explicitly excluded). One parenthetical
saying which — "in scope for the deriver; excluded at ingest until a zero-crew boat is crewed" —
prevents the next reader concluding the exclusion is a bug.

---

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| **"The builder is the same surface regardless of input source"** — the durable half of the superseded 2027 framing | `SPEC.md:608-610` | **True and structural.** `formShifts` reads `repo.listEvents()` and never inspects `Event.source` (`form-shifts.ts:98`); `deriveAllShifts` likewise (`all-shifts.ts:122-236`). The `source` discriminator (DEC-106) lives on reservations/events for the money path, not the crewing path. `SPEC.md:102-103` states the same conclusion correctly ("The shift builder was always source-agnostic, which is what makes the drain a non-event for it") |
| `cascade-coexistence.test.ts` proves import/live **coexistence** is a live tested concept | orchestrator's suspicion #2 | **Refuted — wrong coexistence.** The file's header is explicit: *"7.4 (#184) — **pull and push** coexist (SPEC §2.7.5, DEC-078). **Self-claim** front-loads fills during Pending/early Filling; whatever's still Open at the staffing horizon flows into the existing **ask cascade**"* (`cascade-coexistence.test.ts:1-9`). It is about crew self-claim vs the ask engine, not Xola-vs-Muster ingest. It is **not** evidence for or against `SPEC.md:610` |
| "Fork resolved: continuous auto-grouping, not manual build. There is **no blank-slate 'build' flow**." | `SPEC.md:628-631` | Exactly what shipped. `form-shifts.ts:4-8` restates it ("There is no blank-slate build step (builder fork resolved): shifts form continuously; this is the mechanism"). No create-shift control exists on any surface; the only writes are split, merge and seat override |
| "Same vessel + same day → one candidate shift" | `SPEC.md:634` | Grouping key is literally `` `${e.vesselId}|${e.date}` `` (`form-shifts.ts:99`) with the canonical id `shift-{vesselId}-{date}` (`:130`). The **only** exception is an operator-driven split (DEC-083), which §2.3 itself specifies as the judgment override. Idempotency is contract-pinned — `derive.ts:496-498` notes `formShifts` never auto-splits precisely because the deterministic id depends on one-shift-per-vessel-day |
| Manning is a `{roleTypeId, count}` **list** the seat builder iterates — N lines, not a captain/mate pair (DEC-ROLE-1) | `SPEC.md:640-641` | `ManningRequirement[]` flat-mapped with no role branching (`derive.ts:33-41`); `resource-map.ts:19-21` states the same rule. Test `derive.test.ts:50` runs 3 roles / 4 seats |
| DEC-016 correction: "the real fleet is 4 boats needing 2 crew each" | `SPEC.md:642-643` | `resource-map.ts:54-59` — Brew 1–4, each `crew2 = [captain×1, mate×1]`, capacities 14/16/12/12, "operator-confirmed, Session 22". Accurate and current |
| "Large mid-day gaps *may* raise a 'split this?' suggestion, but the default is one-boat-one-day" | `SPEC.md:635-636` | `suggestSplit` is documented **PURE + ADVISORY — never auto-splits** (`derive.ts:495-498`) and returns a suggestion the Builder renders; `formShifts` is untouched by it. Exactly the spec'd relationship |
| "A freshly spawned proposed shift … appears as a new block needing review" | `SPEC.md:658-659` | Shipped, sourced from the import run rather than a lock: `createdShiftIds` (`form-shifts.ts:48-51, 443-446`) → `repo.listImportRuns(1)` → `newShifts` → `isNew` on the row (`shifts/page.tsx:328-334`, `shift-row.tsx:154`). The sibling `splitDaysChanged` cue renders "changed in the last pull" (`shift-row.tsx:147-153`) — DEC-082's sanctioned replacement for the lock-anchored nudge ("anchor it to Xola import diffs … never a lock", `DECISIONS.md:2141`) |
| Each shift block shows "boat · date · the trips inside (1/3/5pm) with pax totals · required seats (derived) · current crewing-state badge (Pending / Filling / Crewed / At-Risk)" | `SPEC.md:649-651` | Every field is on `AllShiftsRow`: `vesselName`, `date`, `trips[{time,pax}]`, `paxTotal`, `requiredSeats`, `confirmedSeats`, `state` (`all-shifts.ts:42-77`). The four state names match `ShiftState` exactly. State renders as **neutral ink, never colour** — a DEC-042 guardrail, not a miss (`shifts/page.tsx:29-31`) |
| Edge case: "Late booking, shift exists → slots in automatically, silently" | `SPEC.md:687-688` | `form-shifts.ts:97-111` + `:364-390` — the event joins the existing vessel-day key and seat states are preserved by deterministic id. Operator-side silence is real (no nudge exists to fire). Crew-side, see the AC-5 nuance |
| Edge case: "Event edited upstream after a shift formed → propagates unconditionally" | `SPEC.md:690-691` | Unconditional by construction: every pull re-derives the whole vessel-day from `listEvents()`, including a manning shrink (prune `Open`, surface `seatsStranded` — `:378-390`), an all-cancelled day → `Cancelled` (`:304-337`), a relocated boat (`:104-111`, DEC-043) and a resurrection (`:352-363`). Tested at `form-shifts.test.ts:105,122,146,311,322,352` |
| Edge case: "Unlocked shift already inside the staffing horizon → **moot** (DEC-082)" | `SPEC.md:692-693` | Correctly struck; the surviving behaviour is `resolveShiftState`'s horizon overlay (`derive.ts:622-633`). This is one of the four bullets the DEC-082 pass *did* finish — the contrast with C2.3-1 is what makes the omission legible as an oversight rather than a stance |
| "Writes shifts into the state machine (§1.1): forming a shift is how it is born" | `SPEC.md:683-684` | `formShifts` is the only minting path (`:406-414, 443-446`); `deriveShiftState`/`resolveShiftState` are the only state authors, per DEC-005 "shift state is derived, never set directly" (`derive.ts:9-11`). `Cancelled`/`Completed` are explicit lifecycle exceptions, documented as such (`:50-51`, `form-shifts.ts:18-20`) |
| "Derives required seats from COI / vessel manning (policy data the oracle also uses, §1.3)" | `SPEC.md:682` | Same `Vessel.manning` rows feed the seat deriver and the oracle's satisfiability check (`oracle.ts:213` "Can this shift's remaining seats NOT be crewed"). One source, two readers — as spec'd |
| The **Override seat requirements** action (`SPEC.md:664`) is reachable from the builder | `SPEC.md:661-668` | Yes, though it physically lives on the §2.4 cockpit (`components/assignment/manning-section.tsx`, actions at `app/(admin)/admin/shift/[shiftId]/actions.ts:13-16`), which the builder embeds in its two-pane via `?sel=<shiftId>` (DEC-085, `shifts/page.tsx:44-49`). A surface-boundary the §2.3/§2.4 split doesn't state, not a gap |
| "Split/merge is live and is the judgment override (DEC-083/114)" | `SPEC.md:618-619` | Both live (AC-2). DEC-114's `<RevealSelectedRow>` scroll-keeping island is wired at `shifts/page.tsx:12` + the `board-col` testid contract (`:512-517`) |
| The **build → review** reframe survives DEC-082 — "shifts still form continuously and Eric still adjusts them — only the *commit* step is gone" | `SPEC.md:616-618`, `:622-626` | Accurate. Continuous formation (`xola-pull.ts:182`), adjustment (split/merge/override), no commit step anywhere. `USER_STORIES.md:24-25` SP-5 carries the same reframe and is not struck |
| "**Asks fire on the staffing horizon** (DEC-022/062), never on a lock" | `SPEC.md:618` | `tick.test.ts:99`, `:136`; `derive.ts:622-633`. See AC-4 |
| Nothing in §2.3's machinery divides by seat count (the zero-seat state-machine hazard the brief flagged) | brief item 4 | Checked directly: `required.length` appears only as `=== 0` (`derive.ts:64-65`) and as a display count (`all-shifts.ts:221-222`); `lean.ts:52-55` iterates. No ratio, no percentage, no division. A zero-required-seat shift resolves to `Crewed` and is skipped by the engine — the intended behavior, tested twice |

---

## Mockup mapping (for the deferred `DESIGN-REFERENCE.md` index rebuild)

Filename-match + `BUILDER-RECONCILIATION.md` cross-reference, per the ~10-minute cap. **Not** written
into `DESIGN-REFERENCE.md`.

**Belongs to §2.3 Shift Builder:**

- `shiftboard.jsx` → the date-range board (rows, pips, day grouping). Indexed correctly today
  (`DESIGN-REFERENCE.md:122`).
- `shiftapp.jsx` → prototype top-level (window/mode/selection state). Indexed.
- `shiftdata.jsx` → seed substrate + derivations. Indexed.
- `shiftdetail.jsx` → the detail pane. **Indexed under Shift builder, but the reconciliation compares it
  against the §2.4 cockpit** (`app/(admin)/admin/shift/[shiftId]/page.tsx`) — arguably a §2.4 file, or a
  shared one, given DEC-085 made the two panes one surface.
- `Shift Builder.html` → the rendered desktop builder. **Still absent from the index** — already logged
  as C2.1-12 (all 11 rendered `.html` surface mockups are missing); not re-derived here.

**Live reconciliation record.** `docs/design/BUILDER-RECONCILIATION.md` (2026-07-03) is the adopt-vs-
superseded punch-list for these files and is **still accurate** — its High/Med items map to shipped
Phase-9 tasks (`PROJECT_PLAN.md:412-419`). Two items are worth carrying into any index rebuild: it
blesses **day-grouping** (the source of C2.3-7's doc staleness), and its "cockpit trip facts" row is the
open thread behind C2.3-6.

---

## Coverage — what this shard did and did not read

- **Read in full:** `SPEC.md:606–717`; `form-shifts.ts`, `derive.ts`, `manning.ts`, `split.ts`,
  `all-shifts.ts`, `resource-map.ts`; `availability.ts:1–60`; `BUILDER-RECONCILIATION.md:1–45`;
  DEC-082, DEC-083 (decision body), DEC-016, DEC-126, DEC-062 in full.
- **Read in part / targeted:** `shifts/page.tsx` (docstring, window + render, ~250 lines of 550),
  `shifts/actions.ts` (both action bodies), `merge.ts` (header + `formShifts` call),
  `xola-client.ts:125–190`, `xola-pull.ts:30–65, 175–195`, `shift-cockpit.tsx` / `manning-section.tsx`
  (grep-targeted), `SPEC.md:79–108, 1106–1145`, `USER_STORIES.md` §Shift Builder,
  `DESIGN-REFERENCE.md:108–140`, `PROJECT_PLAN.md` Phase 9 rows.
- **Test-name-verified, not read line by line:** the full `it(...)` inventory of all seven
  `src/builder/*.test.ts` files plus `tick.test.ts` (≈120 test names). Assertions were not read; every
  "tested at" citation in this ledger names the test whose *name* states the behavior.
- **Not read:** `tick.ts` body (only its test names + the two exported symbols §2.3 depends on),
  `doorbell-tick.ts` / `ring-relay.test.ts` / `form-audit.ts` beyond their headers (messaging and audit,
  not §2.3), the `shiftboard/shiftapp/shiftdata/shiftdetail.jsx` mockups (filename + reconciliation
  cross-ref only), `SPEC.md` §2.4–§2.7, and the `feature/reservations` tree (§2.3 confirmed
  byte-identical — see the which-tree check above).

## Cost

~95k subagent tokens — **materially under the 150k/sub-shard budget the orchestrator set, and the
reason is the brief's own prediction.** C2.1 and C2.2 spent their windows proving absences across the
whole tree; §2.3's machinery is shipped, so nearly every claim was settled by reading one module that
cites §2.3 back at itself and one test name that states the behavior. The two absences that *did* need
proving — no lock scaffolding, no pax↔seat arithmetic — cost two greps each because both had a small,
well-named search space (`lockShift|lockedAt|locked_at|changedSinceReviewed`;
`max_pax|maxPax|capacity|remaining|seatsLeft`). **The transferable lesson for C2.4–C2.7: budget by
whether the section's code has a surface, not by the section's line count.** A section with a shipped
operator surface is roughly half the cost of one without.
