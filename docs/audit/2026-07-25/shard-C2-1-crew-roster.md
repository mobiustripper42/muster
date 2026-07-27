# Shard C2.1 — Crew Roster / People

**Subject:** `docs/SPEC.md` lines **400–493** — all of `## 2.1 Crew Roster / People`: Purpose, The
record (fields), States to render, Actions, Data read, Edge cases, and the 7 acceptance criteria.

**Audited tree:** `main` @ `7842566`.

> **Which-tree check (lesson 4).** Already settled by the orchestrator: SPEC §2.x is byte-identical
> on `main` and `feature/reservations`. The feature branch was not swept.

**Evidence read.** `src/admin/roster.ts` + `.test.ts`, `src/admin/crew-admin.ts` + `.test.ts`,
`src/admin/credential-health.ts` + `.test.ts`, `src/admin/admin-cli.ts`, `src/admin/index.ts`,
`src/admin/seed-brewboat.ts`, `src/admin/at-risk-board.ts` (reason derivation, lines 119, 150–290),
`src/crew/crew-cli.ts` + `.test.ts`, `src/crew/time-off.ts` + `.test.ts`, `src/domain/entities.ts`
(RoleType / Vessel / CrewMember / Credential / PtoWindow), `src/oracle/eligibility.ts` + `.test.ts`,
`src/oracle/reliability-score.ts` + `.test.ts`, `src/crewapp/crew-view.ts` (nudge call site),
`src/asks/ask-loop.ts` (`resolveProtocol`), `src/adapters/{postgres,in-memory}-repository.ts` +
`repository-contract.ts`, `db/migrations/0001_init.sql`, `package.json` scripts, the whole of
`app/(admin)/`, `docs/DECISIONS.md` (DEC-009 / DEC-044 / DEC-064 / DEC-092 / DEC-094 / DEC-096 /
DEC-119 / DEC-134 / DEC-ROLE-1), `docs/USER_STORIES.md` §Roster, `docs/PROJECT_PLAN.md` (1.1, 2.1,
3.3, 4.5), `docs/design/DESIGN-REFERENCE.md` (mockup index, lines 108–132), and head-skims of the
roster mockups.

---

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| C2.1-1 | `SPEC.md:438` | "**Status:** active / inactive." | `entities.ts:84` — `CrewStatus = "active" \| "inactive" \| "archived"`. **DEC-096** (#323) added the third status: off every list *including* the manual override picker. `db:crew archive\|unarchive` (`crew-cli.ts:281–303`); contract-tested `repository-contract.ts:354`. DEC-096's own "revisit if" says "a web roster surface lands (grey the archived rows there too)" | CODE-CONTRADICTS | doc-wrong |
| C2.1-2 | `SPEC.md:438-439` | "Inactive removes them from future eligible pools without rewriting history." | Half-true, and the missing half is deliberate. `isActive` (`eligibility.ts`) drops inactive from every **automated** path — but **DEC-064/DEC-096** keep inactive crew manually placeable via the cockpit override ("a temporary bench", `entities.ts:76–78`). SPEC reads as if inactive were total removal; `archived` is the status that actually is | MISMATCH | doc-wrong |
| C2.1-3 | `SPEC.md:433-435` | "**Availability suppressions:** **PTO / blackout** windows **only**." | There are **two** suppression mechanisms, not one. `CrewMember.weekdaysOff` (`entities.ts:127–134`, **DEC-119**/#411) is a recurring weekday blackout read by the `not_recurring_off` eligibility rule (`eligibility.ts`), set via `db:crew days-off`. It is subtractive and DEC-119 explicitly argues it clears DEC-009 — so it is *in* the spirit of §2.1, just absent from the record, the Actions list, and the acceptance criteria | CODE-CONTRADICTS | doc-wrong |
| C2.1-4 | `SPEC.md:441-445` | "**Roster list** — all crew, each row showing name, ratings, reliability standing … and a **credential-health flag**" | The deriver exists and is correct (`roster.ts:57–101`, tested) but **`buildRoster` / `renderRoster` have zero callers** anywhere in the repo outside `roster.test.ts` (grep, whole tree). There is **no roster page** under `app/(admin)/` (nav hub `app/(admin)/admin/page.tsx` lists At-Risk, Outbox, Import, All-shifts, Messages, Payroll, Integrity, Time-off — no roster). The only operator-reachable list is `db:crew list` (`crew-cli.ts:110–125`), which prints status glyph / id / name / phone / email — **no ratings, no standing, no credential health**. The module docstring calls this "what the M4 web surface will consume"; M4 has not landed | UNVERIFIABLE→CODE-CONTRADICTS | **decision** |
| C2.1-5 | `SPEC.md:429-430`, `:442` | "**Reliability standing (read-only here):** the computed score/ordering … Displayed, not edited" / roster row shows "high/med/low or ordering" | `CrewMember.reliabilityScore` is written **`null` at every write site in the repo** (`crew-cli.ts:234`, `seed-brewboat.ts:97`, all four `db/seed-*.ts`) and nothing ever updates it. So `standingOf` (`roster.ts:39–46`) returns `neutral / "no history yet"` for **every** crew member and the `high`/`medium`/`low` bands are unreachable. `entities.ts:145–152` names this: the field is DISPLAY-ONLY, real ranking is derived live from the log by `rankByReliability`, and reconciling the two **is issue #32** | CODE-CONTRADICTS | **known** (#32) |
| C2.1-6 | `SPEC.md:453-455`, `:461` | Actions: "Add / update / remove a credential row (type + expiry)" | The use-cases exist (`crew-admin.ts:79–112`, tested at `crew-admin.test.ts:115`) but their **only non-test caller is `seed-brewboat.ts`**. On a live DB the sole credential path is `db:crew add --mmc=<date>`, which writes *one* MMC at create time (`crew-cli.ts:237–248`); there is no `db:crew` command to update an expiry, add a medical/TWIC row, or remove one, and no UI. DEC-044 accepts a far-future placeholder MMC precisely because real credential tracking hasn't landed. **This is what AC-2 and AC-3 ultimately rest on** — both are only as real as the expiry dates someone can enter | CODE-CONTRADICTS | **decision** |
| C2.1-7 | `SPEC.md:456`, `:458`, `:454` | Actions: "Set or clear the **manual boost / floor**" · "Set the per-person protocol override" · "Set ratings (captain / mate / both)" | All three fields exist, persist (`0001_init.sql:40–42`) and are **read** by shipped code (`effectiveRankScore` `reliability-score.ts:204–208`; `resolveProtocol` `ask-loop.ts:776`; `hasRating`). None has an operator **write** path: `db:crew set` accepts only `--email/--phone/--name` (`KNOWN_SET_FLAGS`, `crew-cli.ts:41`), ratings are settable only at `add` time, and `updateCrewMember` (`crew-admin.ts:66`) has no caller outside tests. Tally for §2.1's 7 Actions: **2 fully reachable** (PTO via `/admin/time-off`; activate/deactivate via `db:crew`), 1 partial (add/edit — contact fields only), **4 with no operator path** | CODE-CONTRADICTS | **decision** |
| C2.1-8 | `SPEC.md:473-474` + AC-7 (`:490-491`) | "**Deactivation while assigned to a future shift.** Deactivating must surface the affected future assignments (don't silently strand a shift); those seats reopen." | Genuinely absent. `setCrewStatus` is a bare status flip in both adapters (`postgres-repository.ts:476`, `in-memory-repository.ts:177`); `db:crew disable\|archive` (`crew-cli.ts:262–303`) does not scan seats and its success line makes no mention of assignments. `AtRiskReason` is `"core" \| "regression" \| "credential_lapse"` (`at-risk-board.ts:119`) — there is a credential-lapse-on-committed-body scan (`:273–286`) but **no status-lapse equivalent**, and a Confirmed seat held by a now-inactive person is not a gap by any current definition, so the shift never boards. Per lesson 7 this is filed as a **question**, not a defect: *does deactivation need to surface and reopen future seats, or is "the operator knows who he just benched" sufficient at one-boat scale?* | CODE-CONTRADICTS | **decision** |
| C2.1-9 | `SPEC.md:431-432` | "**Manual thumb (Spink-set):** a **boost** or a **floor** per person" | Three shapes, all different. SPEC says *or* (exclusive). Code allows **both at once** and composes them — `effectiveRankScore` floors first, then adds the boost (`reliability-score.ts:204–208`), and `reliability-score.test.ts:322` sets floor + boost together on purpose ("vouchedNewHire"). The mockup models it as an **exclusive radio** (`detail.jsx` `ManualThumb`, `{kind: 'none'\|'boost'\|'floor'}`). Whichever is right, two of the three are wrong | MISMATCH | **decision** |
| C2.1-10 | `credential-health.ts:36-38` (code comment asserting a doc-level invariant) | "The oracle's date-valid gate (§1.3) must adopt the same boundary so the two never disagree." | They disagree by one day. `healthOf` parses the ISO date to **midnight UTC** and returns `expired` once `daysLeft < 0` (`:39–43`); `mmcValidOnDate` compares **date strings** and passes when `expiry >= tripDate` (`eligibility.ts`, tested "treats expiry == trip date as still valid (**boundary matches credential-health**)", `eligibility.test.ts:91`). On the expiry day itself, any `now` past 00:00Z makes the roster read **EXPIRED** while the oracle still puts the person **in the pool**. The eligibility test's own name asserts the opposite of what holds. Low blast radius (the roster flag is conservative-by-design, per its own comment), but the invariant is stated and false | CODE-CONTRADICTS | code-wrong |
| C2.1-11 | `DESIGN-REFERENCE.md:126` | "**Shared** — `atoms.jsx`, `forms.jsx`, `data.jsx`, `detail.jsx`, `app.jsx`, `tweaks-panel.jsx`" | Five of the six are **roster-specific**, by their own first lines: `data.jsx` "Muster Crew Roster seed substrate"; `detail.jsx` "right pane: the full per-person record"; `forms.jsx` "Add-crew modal"; `atoms.jsx` "shared primitives **for the Crew Roster**"; `app.jsx` top-level over `people`/`selectedId`. Only `tweaks-panel.jsx` (and `ios-frame.jsx`, filed under Crew app) is genuinely cross-surface. The **Roster** row therefore lists 1 file where it should list 6. Introduced by shard G's own replacement list | MISMATCH | doc-wrong |
| C2.1-12 | `DESIGN-REFERENCE.md:120-132` | "**What is actually in `docs/design/mockups/` (~50 files)**" | The list covers the `.jsx` prototypes and the Phase-12 `.html` set but **omits all 11 rendered HTML mockups of the §2.x surfaces**: `Crew Roster.html`, `Crew Roster Mobile.html`, `Assignment View{,  Mobile,-print}.html`, `At-Risk Board{, Mobile}.html`, `Crew App.html`, `Event Admin.html`, `Shift Builder.html`, `index.html`. Same failure mode shard G fixed — a reader hunting the roster mockup by surface name finds nothing | MISMATCH | doc-wrong |

---

## Per-acceptance-criterion verdicts

The seven `- [ ]` boxes at `SPEC.md:479–491`, ticked against source for the first time.

### AC-1 — "Spink can create a crew member with name, phone, and at least one rating." — **MET**
`db:crew add` (`crew-cli.ts:158–260`) requires `--name`, an E.164 `--phone`, and at least one
`--ratings` token resolved against live `RoleType` rows; it derives a `crew-<slug>` id and writes the
member **atomically with a placeholder MMC** (`addCrewMemberWithCredential`) so a "successful" add is
actually askable (DEC-044/DEC-094). Test: `crew-cli.test.ts:29` *"add creates an ASKABLE crew member:
record + placeholder MMC + derived id"*, plus `:96` for the validation set.
*Caveat, not a failure:* the core use-case `createCrewMember` (`crew-admin.ts:56–64`) validates name
and phone only — **zero ratings is legal there**, deliberately (a trainee is unrated, `SPEC.md:419–420`).
The CLI is the stricter door.

### AC-2 — "A crew member with an MMC expiring before a trip date does **not** appear in that trip's eligible pool, with no manual action." — **MET**
`mmcValidOnDate` (`eligibility.ts`) filters to `HARD_CREDENTIAL_TYPES = ["MMC"]` and passes only on
`expiry >= tripDate` — a pure date-string comparison, timezone-invariant by construction (DEC-032).
It runs in every `evaluateCandidate` and `evaluateTraineeCandidate`. Tests:
`eligibility.test.ts:88/91/94/99` — including *"fails when no MMC is held — soft creds (medical) don't
gate in v1"*. MMC is applied to **every** role, not just captains, matching `SPEC.md:424` "MMC is
universal"; the module comment argues that case explicitly.
*Dependency:* only as true as the expiry dates on file — see C2.1-6 (DEC-044 placeholder `2099-12-31`
means in production today, nobody ever fails this rule).

### AC-3 — "The roster list visibly flags every crew member with an expired or expiring-soon credential." — **PARTIALLY MET (derived, never rendered)**
The derivation is done and tested: `credentialHealth` takes worst-of across a person's rows
(`credential-health.ts:58–67`), `buildRoster` attaches it per row (`roster.ts:79`), `renderRoster`
prints `EXPIRED` / `expiring-soon` (`roster.ts:86–101`). Test: `roster.test.ts:81` *"renders the
credential-health flag at the list level"*.
**But nothing calls it** (C2.1-4). No `app/(admin)` roster page exists, and `db:crew list` shows no
credential column. As of `7842566` there is no surface on which Spink can see this flag.

### AC-4 — "Setting a floor of X guarantees the person never ranks below X in any eligible pool, regardless of recent score dips." — **PARTIALLY MET (mechanism yes; wording and write-path no)**
`effectiveRankScore(score, crew)` = `max(score, manualFloor) + manualBoost` (`reliability-score.ts:
204–208`), and it is the **same** function the ask loop and `db:crew rank` order on — not a parallel
metric (`crew-cli.ts:127–155`). Tests: `reliability-score.test.ts:311` (floor lifts, doesn't cap),
`:316` (a floor below the score is inert), `:371` *"manualFloor lifts a flaky veteran back into
contention"*.
Two gaps: (a) the criterion says "never **ranks** below X", which reads as a guarantee about *position*;
the code floors the **score**, which is the sane reading but not the written one. (b) There is **no
operator path to set a floor** (C2.1-7) — the guarantee is unreachable in production.

### AC-5 — "Adding a PTO window removes the person from eligible pools overlapping that window; removing it restores them. No positive-availability entry is ever required." — **MET**
`notOnPto` (`eligibility.ts`) fails on an inclusive date-span hit; `addTimeOff` / `removeTimeOff`
(`time-off.ts:36–63`) are the validated write door, and `/admin/time-off` (`app/(admin)/admin/time-off/
page.tsx` + `actions.ts`) is a **real, shipped operator surface** — the one §2.1 Action with a UI.
Tests: `eligibility.test.ts:118` *"fails on the inclusive boundary of a window (DEC-009)"*, `:122`,
`:125` *"passes with no windows (absence = available)"*; `time-off.test.ts:42/51/57/64/79`.
The no-positive-calendar half is architecturally enforced, not merely unbuilt (DEC-009; `time-off.ts`
header: "There is deliberately no positive 'set your availability'"). **This is the healthiest
criterion in the section.**

### AC-6 — "A newly added crew member shows neutral/mid-pool standing labeled 'no history,' not a low score." — **MET (trivially, and for the wrong reason)**
`standingOf(null)` → `{ band: "neutral", note: "no history yet" }` (`roster.ts:39–40`); test
`roster.test.ts:58` *"reads cold-start (null score) as neutral with no-history note"*. Also
`crew-admin.test.ts:76` *"creates and reads back a crew member at cold-start standing"*.
It passes for **everyone forever**, because `reliabilityScore` is never written non-null (C2.1-5,
issue #32) — and it passes on a surface nobody can open (AC-3). The criterion is satisfied by the
deriver; it has never been exercised against a real score.

> **CLOSED 2026-07-27 — operator called it a non-issue.** Not a defect and not wanted at this scale;
> parked at lowest priority in `FUTURE_IDEAS.md`. The verdict below stands as the *finding*; the
> *disposition* is closed. Do not re-open as a bug.

### AC-7 — "Deactivating a crew member assigned to future shifts surfaces those shifts and reopens the seats rather than failing silently." — **NOT MET**
No code implements either half. `setCrewStatus` flips a column (`postgres-repository.ts:476`,
`in-memory-repository.ts:177`); `db:crew disable` / `archive` return a one-line confirmation naming
nothing (`crew-cli.ts:274–279`, `:298–302`); no seat is reopened; the At-Risk board has no
status-lapse reason (`at-risk-board.ts:119`) and a Confirmed seat held by an inactive person is not a
gap under `gapSeats` (`:250–253`), so the shift never boards. There is no test asserting this
behavior in `crew-cli.test.ts` or `at-risk-board.test.ts`.
The nearest shipped analogue is the **credential**-lapse scan (`at-risk-board.ts:273–286`), which does
exactly what AC-7 asks for — for a different lapse. **This is the shard's headline.**

---

## What this shard would recommend

**Clear-cut doc edits (4).** C2.1-1 (`archived` is missing from the Status field — DEC-096 exists and
its own "revisit if" anticipates the roster surface), C2.1-3 (`weekdaysOff` is a second suppression
mechanism and "only" is now false — DEC-119), C2.1-11 and C2.1-12 (the `DESIGN-REFERENCE.md` mockup
list mis-files five roster files as Shared and omits all 11 rendered HTML mockups). C2.1-2 is a
one-clause clarification in the same family — "inactive = benched, archived = gone".

**One operator decision, wearing four hats (C2.1-4, -6, -7, -8).** §2.1 specifies a maintained
reference-data surface: a roster list with health flags, a person detail pane, seven actions. What
exists is a **complete, well-tested derivation layer with no surface on top of it** — `buildRoster`
has zero callers, credential rows can only be created (never edited), and ratings, manual thumb and
protocol override have no write path at all. DEC-094 decided CLI-over-UI for **break-glass contact
fixes**, and explicitly said building `db:crew` "is what *lets* the UI keep being deferred" — it did
not decide that the §2.1 roster surface is cancelled, and its "revisit if" names "a real roster UI" as
the trigger. So the question is not "why is this unbuilt" but **"is §2.1 a forward spec, and if so
where does it sit in the plan?"** Do **not** close these by trimming the Actions list — that would
bury a scoping decision under a doc tidy (the shard-C lesson on C4–C6).

**One genuinely-absent behavior, phrased as a question (C2.1-8 / AC-7).** Deactivating a crew member
assigned to future shifts is silent today. The credential-lapse machinery next to it does exactly the
right thing for a different lapse, so this is a ~2-point symmetry fix, *if* it's wanted. It may well
not be: at one boat and ~six crew, Spink benched the person himself thirty seconds ago and the shift
still shows a body in the seat. **Ask before filing.** If the answer is no, record it in a DEC so the
next sweep doesn't re-derive it (the DEC-138 pattern).

**One small code defect (C2.1-10).** The roster's expired boundary and the oracle's differ by one day
on the expiry date itself, and both a code comment and a test name assert they don't. Cheap to fix
(compare date strings in `healthOf` too); worth doing because the two are supposed to be one rule.

**One known issue to cite, not re-derive (C2.1-5).** `reliabilityScore` is permanently `null`; the
roster's standing bands are dead code until #32 reconciles the display read to the log-derived score.

---

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| "MMC is universal (captain gating, 5-yr renewal — 'ages out' = expires, not retires)" | `SPEC.md:424-425` | `entities.ts:86-97` carries the same sentence; `eligibility.ts` `HARD_CREDENTIAL_TYPES = ["MMC"]` with a comment citing §2.1 verbatim and arguing *against* a captain-only reading |
| Credential row shape `{ type, identifier?, expiry }` | `SPEC.md:424` | `entities.ts:99-105` — exact match, `expiry` an ISO-8601 date string |
| DEC-ROLE-1 correction: roles are per-tenant `{id, tenantId, name}` data; `ratings` is a set of `roleTypeId`; `Seat.role` references one | `SPEC.md:421-423` | `entities.ts:37-49` (`RoleType`), `:120-126` (`ratings: RoleTypeId[]`), `ManningRequirement`. The SPEC correction is accurate and current |
| medical / TWIC / drug-consortium are tenant-configurable, **not** hard gates in v1 | `SPEC.md:425-428` | `CredentialType` is an open string union (`entities.ts:88-94`); medical is stored and flagged by `credentialHealth` but absent from `HARD_CREDENTIAL_TYPES`; `eligibility.test.ts:99` pins it. Seed gives Pibb an expiring medical to exercise worst-of (`seed-brewboat.ts:122-128`) — "ship MMC + medical" is honored as *tracked*, not *gating*, which matches §1.3's soft/"M" reading |
| "Suppression-only by design — there is no positive 'set your recurring availability' calendar (the Xola trap)" | `SPEC.md:433-435` | DEC-009; `time-off.ts:9-12` states the same rule as the module's one line to hold. No positive-availability write path exists anywhere in `src/` |
| Phone is the SMS/push target **and** the magic-link destination | `SPEC.md:416` | `crew-cli.ts:38` E.164 gate with "a wrong phone means no SMS" rationale; DEC-079 crew front door is phone-entry → roster lookup (`PROJECT_PLAN.md:312`) |
| Protocol override "lives on the person because it's a per-person trait", overriding the per-role default (§1.2) | `SPEC.md:436-437` | `resolveProtocol` (`ask-loop.ts:776`) = `crew.protocolOverride ?? roleDefault` — precisely the stated precedence. Tested `ask-loop.test.ts:808`. (Only the *write* path is missing — C2.1-7) |
| Cold-start: "neutral / mid-pool … with an explicit 'no history yet' indication rather than a misleading low score" | `SPEC.md:448-450` | `roster.ts:24-46` reproduces the rationale in its docstring; `entities.ts:145-152` repeats it on the field. Consistent doc↔code↔test |
| Edge case: credential expiring mid-window drops the person from later pools automatically, **and** an already-assigned person surfaces on the At-Risk board as a credential lapse (§2.5) | `SPEC.md:467-470` | Both halves shipped: `mmcValidOnDate` for the pool; `at-risk-board.ts:273-286` scans Claimed/Confirmed required seats with the *same* date-string boundary and pushes `credential_lapse`, carrying `credentialLapsed: CrewMemberId[]` so the row can name the person (`:161-167`). `PROJECT_PLAN.md:132` (task 3.3) confirms it shipped |
| Edge case: expiring-soon nudges the crew member in the crew app (§2.6) | `SPEC.md:471-472` | `worstCredential` (`credential-health.ts:83-101`) is consumed by `crew-view.ts:265`; `PROJECT_PLAN.md:159` task 4.5 `[x]`. The 60-day window is one named constant (`EXPIRING_SOON_DAYS`) with a comment acknowledging it belongs in tenant config later |
| Edge case: trainee → rated transition; "a trainee is simply someone not yet rated, riding a supernumerary seat" | `SPEC.md:419-420`, `:475-477` | `evaluateTraineeCandidate` (`eligibility.ts`) = the full rule set **minus** `hasRating`, with DEC-087 rationale; ratings are a plain set, so adding one makes the person appear in that pool with no other state change. Tests `eligibility.test.ts:200-205` |
| "Data read" — this record is what the oracle (§1.3), eligible pool (§1.1), reliability score (§1.4) and crew-app nudge (§2.6) all read; standing is read back for display | `SPEC.md:461-464` | Accurate in all four directions: `eligibility.ts` (crew, credentials, PTO, weekdaysOff), `reliability-score.ts` (`effectiveRankScore` reads the thumb), `crew-view.ts:265` (nudge), `roster.ts:78` (standing read back) |
| `USER_STORIES.md:14-22` SP-1…SP-4 | `docs/USER_STORIES.md` §Roster | All four match §2.1 and none describe cut machinery (contrast SP-6/SP-7, shard C). SP-2 "record MMC (and medical/TWIC if needed) with its expiry" carries the same unbuilt-write-path caveat as C2.1-6, but the *story* is not wrong |
| "Purpose — reference data the rest of Muster reads; it is not a workflow. Crew do not self-register in 2026" | `SPEC.md:408-413` | `crew-admin.ts:1-13` restates it verbatim as the reason those use-cases stay thin. No self-registration path exists; DEC-134 additionally forbids seeding real people, making `db:crew add` the sole roster-bootstrap door |

---

## Mockup mapping (for the deferred `DESIGN-REFERENCE.md` index rebuild)

Filename-match + head-of-file skim only, per the ~10-minute cap. **Not** written into
`DESIGN-REFERENCE.md` — shard G's index rebuild owns that.

**Belongs to §2.1 Crew Roster / People:**

- `Crew Roster.html` → rendered desktop roster: two-pane (list + person detail), IBM Plex, the shared
  `--accent:#2f5d86` token set. Currently **absent from the index entirely** (C2.1-12).
- `Crew Roster Mobile.html` → rendered mobile variant, title "Muster · Crew (mobile)". Also absent.
- `roster.jsx` → left pane: pool-health summary strip (counts of expired / expiring-soon / captains /
  mates / on-PTO among active crew), filters, and the crew list. The literal §2.1 "pool-health view
  Spink currently keeps in his head".
- `detail.jsx` → right pane: full per-person record + editing controls, incl. the `ManualThumb`
  control (None / ▲ Boost / ▼ Floor) and `poolBlockReason`. **Currently mis-filed as Shared.**
- `forms.jsx` → modal/inline editors: `AddCrewModal` ("name + phone + ratings (matches acceptance
  criterion)" — i.e. AC-1), credential and PTO editors. **Mis-filed as Shared.**
- `data.jsx` → "Muster Crew Roster seed substrate + derivations": pinned `TODAY`, credential-health
  helpers, `personHealth` / `poolEligible` / `effectiveScore` / `BANDS`. **Mis-filed as Shared.**
- `app.jsx` → roster top-level: layout, `people` state, `selectedId` (defaults to Will Stearns, "shows
  the deactivation case" — i.e. AC-7), search, filters, tweaks. **Mis-filed as Shared.**
- `atoms.jsx` → "shared primitives **for the Crew Roster**": `Mono`, `RatingChip`, `TraineeChip`,
  `Standing` band pill. **Mis-filed as Shared** — shared *within* the roster prototype, not across
  surfaces.

**Genuinely shared, not §2.1-owned:** `tweaks-panel.jsx` (the prototype-host edit-mode shell,
`@ds-adherence-ignore`), `ios-frame.jsx` (currently filed under Crew app).

**Ambiguous:** `index.html` — the mockup gallery landing page; belongs to no surface. Not indexed today.

Two observations for the rebuild, both worth carrying: the roster mockup's deactivation case is the
default selection in `app.jsx`, so the design already answers AC-7 (C2.1-8) — and its exclusive
boost/floor radio contradicts the code's additive model (C2.1-9).

---

## Coverage — what this shard did and did not read

- **Read in full:** `SPEC.md:400–493`; `roster.ts`, `credential-health.ts`, `crew-admin.ts`,
  `crew-cli.ts`, `time-off.ts` (write door), `eligibility.ts`, `entities.ts` (crew half),
  `admin-cli.ts`; the `app/(admin)` tree listing and hub nav; `DESIGN-REFERENCE.md:95–140`;
  `USER_STORIES.md` §Roster; DEC-094 and DEC-096 in full.
- **Grep- / test-name-verified, not read line by line:** `reliability-score.ts`, `at-risk-board.ts`
  (reason derivation only), `ask-loop.ts` (`resolveProtocol` only), the two repository adapters,
  `crew-view.ts`, the four `db/seed-*.ts` scripts, `0001_init.sql`.
- **Skimmed head-of-file only:** the nine roster mockups (per the ~10-minute cap).
- **Not read:** `SPEC.md` §2.2–§2.7 (the rest of C2 — Event Admin, Shift Builder, Assignment View,
  At-Risk Board, Crew App), `src/builder/**`, `src/crewapp/**` beyond the one nudge call site, and the
  `feature/reservations` tree (byte-identical §2.x, per the orchestrator's lesson-4 check).

## Cost

One sweep agent, ledger-on-disk. Cheaper than shard F: §2.1's corpus is 94 doc lines against a
source tree where the roster modules are small and heavily commented — several claims were settled by
reading a docstring that cited §2.1 back at itself. The expensive part was proving absences
(zero callers for `buildRoster`, no write path for four of seven Actions, no status-lapse board
reason), which needs whole-tree greps rather than targeted reads.
