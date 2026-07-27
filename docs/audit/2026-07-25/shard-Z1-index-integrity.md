# Shard Z1 — DECISIONS.md index integrity

**Subject:** `docs/DECISIONS.md` lines **13–178** — the `## Index` block only (its contract line, 13
`###` topic headings, 131 rows, and the footer tally) — checked against the **136 `^## DEC-` bodies**
below it. Nothing else in the file is in scope; internal contradictions *inside* DEC bodies, dead
cross-refs, and the ACTIVE/archive question belong to Z2–Z4.

**Audited tree:** `main` @ `71e4a18` (branch `task/audit-shard-z`). File is 3,949 lines.

> **Which-tree check (lesson 4) — and it is the largest divergence any shard in this run has faced.**
> `git diff main origin/feature/reservations -- docs/DECISIONS.md` = **252 lines, 206+/46−, across 10
> hunks.** Exactly **one** hunk touches the index block: `@@ -153,8 +153,6 @@` removes the `DEC-138`
> and `DEC-139` rows (lines 156–157 on `main`), which exist on `main` only. Every other hunk lands in
> DEC bodies at or below line 1350.
>
> **The divergence is not additive — the two trees assign the same numbers to different decisions.**
>
> | id | `main` body | `origin/feature/reservations` body |
> |---|---|---|
> | DEC-122 | *absent* | Customer booking link — stateless HMAC capability URL (`:3414`) |
> | DEC-134 | Real crew never live in a seed script (`:3849`) | Customer checkout is inline Stripe Elements over a deferred PaymentIntent (`:3952`) |
> | DEC-135 | `db:all` — one always-destructive command (`:3859`) | The "Your booking" manage page (`:3962`) |
> | DEC-136 | *absent* | Real crew never live in a seed script (`:3972`) |
> | DEC-137 | *absent* | `db:all` is retired in favor of `db:reset:dev` (`:3984`) |
> | DEC-138 | Booking flow ships as an embeddable widget (`:3874`) | SPEC §1.3 rewritten to the DEC-125 model (`:4040`) |
> | DEC-139 | Stripe card checkout only; no wallets (`:3895`) | *absent* |
>
> **Per-finding divergence is stated in the "checked against" column of every row below.** Rows
> Z1-1, -2, -3, -4, -9, -10 all land in or bear on divergent regions; the rest are in text byte-identical
> on both trees.

**Method.** Index rows extracted mechanically (`awk` over `:17–178`, leading id per `- ` row, strike
markers stripped) and set-diffed against `grep '^## DEC-'`. Both orphan classes are therefore
*complete*, not sampled. Supersession candidates came from a single grep for
`supersed|reverses|revises|refines|replaced by|obsolete|retired by|overturn` across all 3,949 lines,
then each hit read in its body. The DEC-131 migration count was re-derived from `db/migrations/` on both
trees, citation line by citation line.

---

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| Z1-1 | `DECISIONS.md:15` | "Keep current: **every new DEC adds a row here (DEC-127)**." | **Five bodies have no index row, and the rule's own DEC is one of them.** Complete list, each with its body anchor: **DEC-127** (`:3697`, "DECISIONS.md carries a topic index at the top; every new DEC updates it"), **DEC-133** (`:3841`, customer availability screen server-rendered), **DEC-134** (`:3849`, real crew never live in a seed script), **DEC-135** (`:3859`, `db:all` always-destructive), **DEC-TBD** (`:3909`, open questions). Set-diff of 136 body ids against 131 row ids; zero rows resolve to a missing body, so the failure is **one-directional**. DEC-127's own body states the enforcement standard it is in breach of: *"Treat a missing index row as a defect in review"* (`:3701`). **DEC-TBD is arguably deliberate** — the file preamble at `:6` says "Open questions live at the bottom as DEC-TBD" — so the real unindexed count is **4**. Two of the four (134, 135) are inside the renumber collision zone; see Z1-4 | MISMATCH | doc-wrong |
| Z1-2 | `DECISIONS.md:177` | "_**Indexed 124 of 124 DECs.**_" | Both numbers are wrong and they were never equal. Actual: **131 index rows** (`awk` over `:17–178`) against **136 body headings** (`grep -c '^## DEC-'`). The tally has not been touched since at least DEC-127's own era — twelve DECs have landed on `main` since (128–135, 138, 139, plus 131/132) and seven of them *did* get rows, so the footer was left stale by edits that otherwise complied with DEC-127. On `origin/feature/reservations` the same footer sits above **129 rows / 138 bodies** | MISMATCH | doc-wrong |
| Z1-3 | `DECISIONS.md:177` | "Feature-branch DECs (**099–104, 122**) fold in when they merge." | **099–104 folded in nine index rows above this sentence and were renumbered doing it.** Commit `fc9ce08` (2026-07-11) authored `## DEC-098` … `## DEC-104`; at merge they became **DEC-105–111**, which are indexed at `:142–148`. No `## DEC-099`–`## DEC-104` heading exists on **either** tree (`comm` over both heading sets). DEC-105's body still carries the dead numbering too — "the mechanism DECs (**099–104**, and DEC-138…) sit under it" (`:2721`) — so the note has a second live copy. **The `122` half is correct** (`origin/feature/reservations:3414`), but the sentence now under-states the outstanding set: **136 and 137** are also feature-only (`:3972`, `:3984`) | MISMATCH | doc-wrong |
| Z1-4 | `DECISIONS.md:156-157` + `:177` | index rows `DEC-138 — the booking flow ships as an embeddable iframe widget` / `DEC-139 — payments = Stripe card checkout only` | **The index is the one surface that maps id → topic, and three of its ids mean different things on the two trees.** `main`'s DEC-138 (`:3874`) is the embed widget; `origin/feature/reservations`'s DEC-138 (`:4040`) is "SPEC §1.3 rewritten to the DEC-125 model" — the DEC the audit README cites at four separate places as the resolution of shard C's three operator decisions. Same for DEC-134/135 (see the which-tree table). **The collision is documented in a body and nowhere in the index:** `DECISIONS.md:3888` — *"Authored as DEC-126, renumbered to DEC-131, and landed as DEC-138 … Numbers 136/137 are reserved for `feature/reservations`, which renumbered `main`'s DEC-134/135 into them."* A reader consulting the index on either tree gets a confident wrong answer for the other. **This is the finding most likely to survive as a defect after the merge**, because the merge will silently resolve the two DEC-138 bodies into adjacent sections while the index carries one row | MISMATCH | **decision** |
| Z1-5 | `DECISIONS.md:90` | "- DEC-035 — Xola import surface — import → formShifts chaining" *(unstruck, filed as current)* | The DEC is **`Status: Proposed`** and was explicitly shelved by its successor. Body `:1164`: *"**Status:** Proposed (Phase 5 / 5.4, #73) … confirm at build"*; its content is an xlsx upload → preview → confirm surface. DEC-037 closes it out by name — *"**DEC-035's full preview/validate/quarantine-review surface** stays deferred"* (`:1222`) and *"DEC-035 deferred"* in its Relationship line (`:1224`). Then DEC-043 (`:1358`) retires the substrate: *"the xlsx upload is retired — it can't resolve a boat."* Nothing in DEC-035 survives as a current call; the index shows it beside three `(current)`-tagged siblings with no marker of any kind | MISMATCH | doc-wrong |
| Z1-6 | `DECISIONS.md:92` | "- DEC-037 — task #73 split — **xlsx surface first**, API Land adapter fast-follow" *(unstruck)* | The row's entire subject is the build-order call "xlsx first, API second", and the xlsx leg is dead. DEC-043 (`:1358`) — *"**Amends:** DEC-036/DEC-037 (the planned `fetchEvents` half is now the primary adapter; **the xlsx upload is retired** — it can't resolve a boat)"*. The rationale DEC-037 rested on is also void: it kept xlsx because *"DEC-036 already retains the xlsx reader as the permanent downtime fallback, so 5.4a builds a kept path, not a throwaway"* (`:1211`) — DEC-040 restates the same fallback (`:1279`), and DEC-043 removes it. Nothing struck, no replacement named. Contrast the four rows at `:85–89` that *did* get the treatment | MISMATCH | doc-wrong |
| Z1-7 | `DECISIONS.md:85` | "- ~~DEC-011~~ → **superseded by DEC-036** — 2026 coexistence; Xola API bolt-on killed" | **A partial supersession rendered as a total one, and the row's own text names the surviving half.** DEC-036's body is explicit that only one of DEC-011's two legs died: *"Supersedes DEC-011's API kill … **DEC-011's *other* leg (the ~18-month kill date / disposability) stands, and is what licenses this**"* (`:1186`). The strikethrough covers "2026 coexistence" — the leg that stands and that DEC-105/DEC-126 are still arguing with (`:2717`, `:3646`). A reader following DEC-127's convention reads the whole row as dead | MISMATCH | doc-wrong |
| Z1-8 | `DECISIONS.md:87` | "- ~~DEC-016~~ → **superseded by DEC-043** — BrewBoat worked example / vessel-from-product collapse" | Same shape as Z1-7, and this one has a live citation depending on it. DEC-043 (`:1358`): *"**Supersedes:** DEC-016's single-vessel-per-product collapse + its 5 invented vessels (**the durable DEC-016 / DEC-ROLE-1 principle — manning is data the deriver loops — stands**; only the invented fleet dies)"*. `SPEC.md:642-643` cites DEC-016 as **current authority** — *"(Correction, DEC-016: … zero-crew rentals are in scope; the count is per-vessel data, 0/1/2/N.)"* — a citation shard C2.3 verdicted as accurate against the deriver (`shard-C2-3-shift-builder.md`, C2.3-9 and its DEC-016 NOISE row, verified against `resource-map.ts:54-59`). The index says that authority is dead. **Cross-doc consequence, not a tidy** | MISMATCH | doc-wrong |
| Z1-9 | `DECISIONS.md:142` | "- DEC-105 — reservations go live 2026 as a Muster-native parallel-run **(pilot)**" *(unstruck)* | The index title drops the load-bearing half of the body title and thereby hides a reversal that happened two rows below it. Body: *"## DEC-105: Reservations go live in 2026 as a Muster-native parallel-run — **permanent coexistence, not a cutover**"* (`:2717`). DEC-126 (`:3646`, indexed at `:154`) reverses precisely that: *"The flip from Xola to Muster is a **cutover**, not the '**Xola drains naturally, no migration**' picture DEC-105 first painted"*, and DEC-126's own status line says *"**Evolves DEC-105**"* (`:3648`). The DEC-105 row carries neither a strike, an "amended by", nor the word the reversal turned on. **Prior art:** shard A found the same omission one DEC over — "DEC-107 had no forward pointer to the DEC-134 reversal" (README resume state); that fix landed in PR #538 on `feature/reservations` only, so DEC-105's row was never covered | MISMATCH | doc-wrong |
| Z1-10 | `DECISIONS.md:144` | "- DEC-107 — payments = **Stripe hosted Checkout** (deposit + balance, webhook-driven)" *(unstruck)* | Two forward references missing, one of them on this tree. **(a) On `main`:** DEC-139 (`:3895`, indexed at `:157`) decides *"card payment via Stripe and nothing else — no Apple Pay, no Google Pay"*, while DEC-107's stated rationale for hosted Checkout is that it *"handles 3DS/SCA **+ wallets** free"* (`:2804`). The two rows sit 13 lines apart in the same topic section with no relation marked either way; DEC-139's own status line points only at DEC-138 (`:3897`). **(b) Across the merge:** `origin/feature/reservations:3952` is *"DEC-134: Customer checkout is **inline Stripe Elements over a deferred PaymentIntent**; hosted Checkout remains for balance + post-gratuity … **revisits DEC-107/108**"* — i.e. the index row's headline mechanism is no longer the primary one on the tree that will merge. **A fix applied to `main`'s DEC-107 row must survive that merge**, and `main`'s DEC-134 is a different decision entirely (Z1-4) | MISMATCH | doc-wrong |
| Z1-11 | `DECISIONS.md:89` | "- ~~DEC-029~~ → **superseded by DEC-082** — 'changed since you reviewed it' derivation" | The named replacement is right for the *nudge*; it is not the only DEC that changed DEC-029, and the omitted one is the origin of a filed bug. DEC-082 covers the lock anchor (`:2143`, *"DEC-029's 'changed since reviewed' nudge loses its lock anchor"*). **DEC-043 separately amended DEC-029's identity model** — *"**Amends:** … DEC-029 (`vesselId` joins the material set; **event identity is the real `event.id`**)"* (`:1358`). That amendment is exactly the mechanism behind **#548** (README: *"a retime that keeps its event id notifies nobody — DEC-029 caught it for free when event identity encoded the time, DEC-043 changed identity to Xola's real `event.id`, and nobody re-checked"*). The index points a reader at DEC-082, which says nothing about identity | MISMATCH | doc-wrong |
| Z1-12 | `DECISIONS.md:84` | topic heading "### Xola ingest, import & **lock**" | The topic name survives the feature it names. Lock was cut by **DEC-082**, which is filed *inside this very section* at `:96` — *"locking cut — Xola is the source of truth **(current)**"*. Nothing under the heading is about lock any more: `db/migrations/0022_drop_shifts_locked_at.sql` drops the column, `src/builder/lock.ts` is gone, `USER_STORIES.md` SP-6/SP-7 struck (shard C), `SPEC.md` §2.3 struck (shard C2.3, PR #549). The index heading is now the **last live use of "lock" as a current topic** in the corpus | MISMATCH | doc-wrong |
| Z1-13 | `DECISIONS.md:141` | "- DEC-097 — guest-contact tracking = progressive-enhancement client island" *filed under `### Reservations & payments`* | Wrong section: the DEC is about the **crew manifest**, not reservations or payments. Body context (`:2673-2675`): *"**The manifest's** guest Text button preloads an intro SMS (Part A). Part B needs the tap to record who texted which guest, so **every crew member on the shift** sees who's been contacted."* Its neighbours in that section (DEC-105–139) are the Phase 11–12 booking/money stack; DEC-097 predates all of them (#345) and belongs with the manifest/UI rows. It is also the only pre-DEC-105 row in the section, which is how it reads as filed-by-keyword ("guest") rather than by subject | MISMATCH | doc-wrong |
| Z1-14 | `DECISIONS.md:26` | "(⚠️ **~19 migration headers** miscite DEC-DATA-1 for a no-FK rule it never contained)" | **Verified and the number is right — the audit note is the one that isn't stale.** On `main`: **19 files, 27 citation lines**, and every one of the 19 attributes a no-FK / referential-integrity claim to DEC-DATA-1 (`0001, 0002, 0003, 0005, 0006, 0007, 0008, 0009, 0010, 0011, 0012, 0015, 0017, 0018, 0020, 0021, 0023, 0024, 0025`). None carries a DEC-131 correction. **One off-by-one between the two places that state it:** DEC-131 says *"Roughly **nineteen later** migration headers **then** cited"* (`:3745`) — later than `0001_init.sql`, which it names as where the rule was minted — while DEC-DATA-1's banner says *"Roughly nineteen migration headers (**from `db/migrations/0001_init.sql` onward**)"* (`:449`). Those two sentences cannot both be true: **19 including `0001`, 18 excluding it.** The index row inherits the ambiguity. **Merge-back count differs:** `origin/feature/reservations` has 40 migrations, **31** citing DEC-DATA-1 — but the 12 extra are timestamped post-DEC-131 files and **none newly miscites**; 5 explicitly correct the attribution (3 carry a `⚠️ SUPERSEDED (DEC-131)` banner: `20260715024322_payments`, `20260718045012_reservation_catalog_tables`, `20260718235345_gratuity`), the rest cite it for CHECK/vocabulary choices, which is DEC-DATA-1's real subject. **So "~19" survives the merge as the uncorrected-legacy count; a naive re-grep after merge will read 31 and look like decay that isn't there.** | MISMATCH (minor — internal off-by-one only) | doc-wrong |

---

## What this shard would recommend

**The index's completeness contract holds in one direction and has decayed in the other, exactly at the
tail — which is what the brief predicted.** Every one of the 131 rows resolves to a real body: there are
**zero dangling rows**, and that is worth stating plainly because it means the index has never been
edited carelessly, only *not* edited. The failure is entirely non-additions, and **all four real ones are
in the last nine DECs** (127, 133, 134, 135 out of 127–139). DEC-127 compliance is not eroding gradually;
it broke at a specific point and stayed broken. **DEC-127 itself has no row**, which is the shard's one
genuinely funny result and also the most diagnostic one — the rule was written, the row was never added,
and no reviewer applying the rule's own standard ("treat a missing index row as a defect in review")
caught it in twelve subsequent DECs.

**The strike-through promise is where the judgment lives, and it fails in two opposite directions.**
Under-striking: DEC-035 and DEC-037 (Z1-5, -6) are filed as current decisions whose subject — the xlsx
upload surface — was retired by DEC-043 in so many words. Over-striking: DEC-011 and DEC-016 (Z1-7, -8)
are struck *whole* when their successors explicitly preserve a leg, and DEC-016's preserved leg is
**cited as live authority by `SPEC.md:642`** and was verdicted accurate by shard C2.3 last night. The
convention DEC-127 defines has only two states — struck-with-replacement, or current — and roughly a
fifth of the supersession relationships in this file are **partial**. That is a real gap in the
convention, not just in its application; **naming it is in scope, fixing it by inventing a third marker
is a Z4 restructure call and is deliberately not proposed here.**

**Two rows are wrong in a way a reader cannot detect (Z1-9, Z1-10), and both are in Reservations.**
DEC-105's row says "(pilot)" where the body says "permanent coexistence, **not a cutover**" — the exact
five words DEC-126 exists to reverse, two rows below it, with no pointer. DEC-107's row still headlines
hosted Checkout against DEC-139's no-wallets call on this tree and `feature/reservations`' inline-Elements
reversal on the other. Shard A fixed this shape once already, on the other tree; it recurred here because
the fix was applied to a body, not to the index.

**Z1-4 is the one to triage first because it is the only finding that gets *worse* by waiting.** The
same three numbers (134, 135, 138) denote different decisions on the two trees. `main`'s DEC-138 is the
embed widget; the feature branch's DEC-138 is the SPEC §1.3 rewrite that this audit's own README cites
four times as the resolution of shard C. The collision is documented at `:3888` and invisible from the
index. Whatever the merge does, **the index has to be rebuilt across the seam by hand**, and doing it
before the merge means reconciling 7 ids instead of discovering them as conflicts.

**Z1-14 is the rare case of an audit note that checked out.** "~19 migration headers" is exactly right
for `main` — 19 files, 27 lines, zero corrected. Two smaller things fall out of verifying it: the two
places that state the count disagree by one over whether `0001_init.sql` counts (it is where the rule was
minted, so it is the origin, not a miscite), and the merge-back count is 31 files of which 12 are
post-DEC-131 and clean. **Anyone re-deriving this after the merge will read 31 and file a regression that
isn't one** — the row should say what it counts.

---

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| **Every index row resolves to a real body heading — zero orphaned rows** | brief item 1, reverse direction | Mechanical set-diff: 131 row ids (`awk` over `:17–178`, leading token per `- ` row, `~~` stripped) minus 136 body ids (`grep '^## DEC-'`) = **empty**. Also **zero duplicate rows** (`uniq -d` on the row ids is empty). Non-numeric ids all resolve: `DEC-MSG-1/2/3` (`:348, 365, 388`), `DEC-ROLE-1` (`:411`), `DEC-DATA-1` (`:446`). This is the half of the completeness contract that has never broken |
| Title fidelity across all 131 rows — no *material* misdescription beyond Z1-9 | brief item 2 | Every row's title compared against its body's `## DEC-NNN:` heading. The overwhelmingly common pattern is faithful abbreviation of a long heading — e.g. DEC-024 `:49` drops the body's `"widen the pool" is a logged stub` clause (`:784`); DEC-026 `:51` drops `lean = a manual nudge … reschedule/cancel render disabled` (`:859`); DEC-071 `:117` drops `DM list is a participant index` (`:1778`). In each case the retained phrase is the DEC's actual holding. **Per the brief, logged as checked-and-fine rather than omitted.** The one row where the dropped clause *is* the holding is DEC-105 (Z1-9) |
| The four struck rows all name a **real** replacement DEC, and the replacement is the right one for the struck subject | brief item 3 | `~~DEC-011~~ → DEC-036` (`:85` vs `:1186` "Supersedes DEC-011's API kill"); `~~DEC-013~~ → DEC-020` (`:171` vs `:322/:676`); `~~DEC-016~~ → DEC-043` (`:87` vs `:1358` "Supersedes: DEC-016's single-vessel-per-product collapse"); `~~DEC-017~~ → DEC-040` (`:88` vs `:1270` "**DEC-017's customers-export email-join is retired**" and `:1287` "retires DEC-017's email-join"). **No row names a wrong or non-existent replacement.** The defect in two of them is scope (Z1-7, Z1-8), not identity |
| DEC-019's row uses an *italic amendment note* rather than a strikethrough | `:36` — "`Bailed` is a seat transition, not a resting state _(bail/vacate re-crewing now deferred to the tick — DEC-128)_" | **Correct as written, and arguably the best row in the index.** DEC-128 *amends* DEC-019, it does not supersede it: `:3718` — *"**Amends:** DEC-019 (`Bailed` no longer the AtRisk source — the seat-fold branch is legacy-only)"*, and DEC-128 retains the `Bailed` branch for legacy seats with no migration (`:3717`). The row's headline claim ("a transition, not a resting state") is *more* true after DEC-128, not less. This is the third marker form the convention lacks (see recommendations) being used correctly by instinct |
| DEC-022, DEC-020, DEC-031, DEC-036, DEC-063, DEC-123 rows unstruck despite carrying "revises/refines/reverses" traffic | `:71, :172, :53, :91, :55, :151` | All **partial refinements that leave the indexed holding intact**, checked one by one: DEC-032 "Revises DEC-022" touches only its render-everything-UTC v1 simplification (`:1136`); DEC-092 "revises DEC-020" only its *"admin is a free-form non-identity"* clause (`:2485`); DEC-121 "refines DEC-020" the migration runner (`:3348`); DEC-038's "Superseded display" note on DEC-031 changes rendering, *"the mechanic below … still holds"* (`:1079`); DEC-065 supersedes only *"the membership half of the board's willingness-exhaustion rule"* (`:1724`); DEC-124 reverses only DEC-036's *tip parking* (`:3460`); DEC-128 reverses one DEC-063 clause (`:3718`); DEC-125 corrects a DEC-123 claim about availability (`:3563`). **Unstruck is right for all eight** — recorded so the next sweep doesn't re-derive the grep |
| Topic-section placement of the other 130 rows | brief item 4 | Read section-by-section. Defensible throughout, including the arguable ones: DEC-041 (trip length → shift end) under *Seats, shifts & state machine* rather than *Timing* — it is a shift-shape derivation, not a horizon; DEC-078 (concurrency + crew self-release) under *Seats* rather than *Crew self-serve* — its subject is the CAS on the seat; DEC-118 (crew audit log) and DEC-131 (constraint posture) under *Core architecture* — both are storage-boundary calls. DEC-098 (crew calendar feed) under *auth* is right: it is a bearer capability URL. **Only DEC-097 is filed by keyword rather than subject (Z1-13)** |
| Row ordering inside topic sections | structural | Non-monotonic in one section — *Seats, shifts & state machine* runs 005, 019, **128, 129, 130**, 028, 039, 041, 061, 078 (`:35–44`), i.e. the three newest DECs were inserted next to the DEC they amend rather than appended. **This is the convention working**, not decay: DEC-128 sits under DEC-019 because it amends it. Cosmetic either way; not a finding |
| DEC-TBD has no index row | `:3909` vs the index | **Probably deliberate.** The file preamble states the placement rule itself: *"Open questions live at the bottom as DEC-TBD"* (`:6`). DEC-TBD is not a decision and has no topic. Counted in Z1-1's raw orphan set for mechanical completeness, then discounted — the real unindexed-decision count is **4** |
| DEC-033's row drops the body's `(provider pick OPEN)` and its `Status: Proposed` | `:173` vs `:1140`, `:1142` | **Out of scope here, and the index is the *more* current of the two.** The body still says *"Hosted deploy — provider pick (**OPEN**)"* and *"**Status:** Proposed … Provider sub-decision **OPEN** (owner/Eric)"* — but Vercel shipped and DEC-020's own title still says *"hosted provider deferred"*. That is a **DEC-body** staleness (three of them), not an index defect; the row summarizes what actually happened. **Routes to Z2**, logged here so Z2 gets the pointer |
| DEC-131's cited evidence file is absent from the audited tree | `:3752` | DEC-131 cites `20260718142705_claim_hold_mutex.sql` as proof the schema had already broken its own no-constraints story. That file exists **only on `origin/feature/reservations`** (`main`'s `db/migrations/` is `0001`–`0025`, all sequential). The DEC is correct about the artifact; it is describing a tree it doesn't live on. **Body-level, routes to Z2** — the index row (`:25`) makes no claim about it |

---

## Coverage — what this shard did and did not read

- **No acceptance-criteria section in this ledger.** The subject is an index block; it contains no
  `- [ ]` boxes and no acceptance criteria of any kind. The C2.x per-AC verdict section is therefore
  omitted deliberately, not overlooked.
- **Read in full:** `DECISIONS.md:1–190` (preamble, contract line, all 13 topic headings, all 131 rows,
  the footer); the complete `^## DEC-` heading inventory of **both** trees (136 / 138); DEC-DATA-1
  (`:446–498`), DEC-131 (`:3734–3792`), DEC-127 (`:3697–3704`), DEC-138 (`:3874–3894`), DEC-139
  (`:3895–3908`), DEC-037 (`:1201–1225`), DEC-040 (`:1261–1288`), DEC-035 (`:1162–1169`), DEC-017
  (`:584–600`), DEC-097 (`:2671–2680`) in full.
- **Read in part / targeted:** DEC-105 (`:2717–2725`), DEC-126 (`:3646–3660`), DEC-107 (`:2795–2864`,
  grepped for amendments), DEC-036 (`:1186`), DEC-043 (`:1358`), DEC-082 (`:2143`), DEC-128
  (`:3705–3719`), DEC-011/013/016 heading + supersession lines. All 41 hits of the supersession grep
  were read in their surrounding paragraph.
- **Derived mechanically, not read:** the 131-row / 136-heading set-diff, the duplicate check, and the
  index-vs-body id resolution — these are the shard's completeness claim and are reproducible from the
  awk/comm pipeline described under **Method**.
- **Code read:** all 27 `DEC-DATA-1` citation lines across `main`'s 19 migration files, each with two
  lines of surrounding context; all 12 timestamped `feature/reservations` migrations that cite it. No
  application source was read — the subject makes no claim about `src/`.
- **Not read:** the ~120 DEC bodies not implicated by a supersession-grep hit or an index-title
  comparison — their *headings* were compared against their rows, their bodies were not audited for
  internal contradictions (that is **Z2/Z3**). The ACTIVE/archive split question (**Z4**) was not
  considered and no restructure is proposed. `docs/SPEC.md`, `USER_STORIES.md` and the other consumer
  docs were touched only where a specific row's correctness depended on them (Z1-8, Z1-12).

## Cost

~93k subagent tokens. **The mechanical half was cheap and the judgment half was not** — the complete
both-directions orphan inventory, the duplicate check, and the cross-tree heading diff cost four bash
calls, and they produced 4 of the 14 findings. The other 10 came from reading bodies to answer
*"is this supersession partial?"*, which no grep decides: eight of the fifteen supersession
relationships turned out partial-but-correctly-unstruck (logged as one NOISE row) and two turned out
partial-but-wrongly-struck (Z1-7, Z1-8). **Transferable to Z2/Z3: budget the grep at nothing and the
adjudication at ~5k per relationship.** The cross-tree divergence roughly doubled the cost of every
Reservations-section row, because each one had to be checked against two different bodies wearing the
same number.
