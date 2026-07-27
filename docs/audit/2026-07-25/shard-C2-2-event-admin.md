# Shard C2.2 — Event Admin

**Subject:** `docs/SPEC.md` lines **495–605** — all of `## 2.2 Event Admin`: the S54 reconciliation
header, Purpose, States to render, Actions, Data read, Edge cases, the 7 acceptance criteria, and the
2 open questions.

**Audited trees:** `main` @ `7842566` (primary — the Xola-sourced import code §2.2 is scoped to) and
`origin/feature/reservations` @ `a6250ba` (for every coexistence / `source` / Muster-native claim).
Every row below names its tree.

> **Which-tree note (lesson 4).** SPEC §2.x is byte-identical on both branches, per the orchestrator's
> check, so the *subject* was read on `main` only. The *evidence* is genuinely split: `src/import/**`
> and `app/(admin)/admin/import/**` are on `main`; `src/reservations/**`, `src/admin/{offering,block,
> vessel,location}-admin.ts`, `/admin/{calendar,purchases,offerings,blocks,customers,vessels,
> locations,add-ons}` and DEC-134–138 exist **only** on `origin/feature/reservations`.
> **DEC-134–138 are not in `main`'s `DECISIONS.md` at all** — `grep DEC-136 docs/DECISIONS.md` on
> `main` returns nothing; they live at `origin/feature/reservations:docs/DECISIONS.md:3952–4040`.

**Evidence read.** *(`main` unless marked)* `src/import/import-reservations.ts` + `.test.ts`,
`xola-pull.ts`, `xola-client.ts`, `browse.ts` + `.test.ts`, `own-cli.ts` + `.test.ts`,
`import-audit.ts`, `resource-map.ts`; `app/(admin)/admin/import/{page.tsx,actions.ts}` and
`run/[id]/page.tsx`; `app/api/cron/xola-pull/route.ts`; `vercel.json` (+ its whole git history);
`src/builder/form-shifts.ts` (seat/shift reconcile + `#350` notify) and `form-shifts.test.ts:217–268`;
`src/builder/derive.ts` (`earliestScheduledStart`, `CALL_LEAD_MINUTES`); `src/admin/all-shifts.ts` and
`app/(admin)/admin/shifts/page.tsx`; `src/crewapp/shift-card.ts` (manifest assembly);
`src/domain/entities.ts:156–230` (`Source`, `Event`, `Reservation`); `docs/DECISIONS.md`
DEC-043 / DEC-105 / DEC-106 / DEC-126 / DEC-127 in full, DEC-029/036/037/040/056/082/112/123 by grep;
`docs/PROJECT_PLAN.md` (1.2, 5.4, 8.x notes, 11.0, 12.9, 12.11, 12.12a, 12.14, 12.15);
`docs/USER_STORIES.md` (whole file, grep for events/import); `docs/SECURITY_AUDIT.md:71`;
`docs/RETROSPECTIVES.md:50`; `docs/DEPLOY.md:14–48`; `docs/design/DESIGN-REFERENCE.md:100–144`;
heads of the six Event-Admin mockups.
**Feature branch:** `app/(admin)/admin/calendar/{page.tsx,calendar-view.tsx}`,
`app/(admin)/admin/purchases/page.tsx`, `src/reservations/availability.ts:47–59`,
`src/domain/entities.ts:525–560`, `src/import/import-reservations.ts`, `src/import/browse.ts`,
the `src/reservations/**` and `src/admin/**` file listings, `vercel.json`.

---

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| C2.2-1 | `SPEC.md:519-521` | "Both source-of-write paths **coexist permanently**: Xola-sourced imports drain as Xola drains, Muster-native reservations arrive alongside them, discriminated by `source` (DEC-106). This layer stays either way" | **`DEC-126` (`DECISIONS.md:3644–3690`, accepted 2026-07-17, S56) reverses exactly this.** "The flip … is a **cutover**, not the 'Xola drains naturally, no migration' picture DEC-105 first painted"; "**The ongoing Xola API pull STOPS** … the cutover import is **one-time**, and after it there is no recurring import. Xola is no longer an input." The S56 pass **did** re-reconcile §0.2/§0.3 (`SPEC.md:62–65`, `:81–88`, `:99–101`) and §4 (`:1215–1217`) — those carry explicit "*revised 2026-07-17 (S56, DEC-126)*" headers that name the S54 wording they replace. **§2.2 was skipped.** So one file now says "permanent coexistence, drains naturally" at `:519` and "coexistence → cutover, the pull stops" at `:83` | MISMATCH | doc-wrong |
| C2.2-2 | `SPEC.md:536-542` | "~~**Manually add / cancel a single reservation**~~ … **STRUCK by DEC-043** … There is **no Muster-side manual write** to a Xola-sourced event or reservation; the odd phone booking is fixed in Xola and re-pulled" | **DEC-126 item 4** (`DECISIONS.md:3661–3668`, operator, 2026-07-18) un-strikes half of this by name: "**Muster can cancel a Xola-originated reservation — IN MUSTER, with no write to Xola** … Today the operator can't cancel an imported reservation from Muster at all; after the import they need a Muster-side cancel action (marks it cancelled, **frees the slot**)." It is a **scheduled task**: `PROJECT_PLAN.md:561` task **12.14** / issue **#467** — "**cancel an imported reservation IN MUSTER** (frees the slot) — the thing you can't do today". §2.2 is the section a builder reads for that surface and it says the action doesn't exist. *(The `add` half of the struck pair is still correctly struck.)* | MISMATCH | doc-wrong |
| C2.2-3 | `SPEC.md:533-535`, `:560-562` | "**Import** … the operator-triggered Xola **API pull** at `/admin/import`" + "**Re-import reconciliation.** A reservation already imported, now changed or cancelled in Xola, must update/cancel in place" | The SPEC sentence is **correct today** (see NOISE) — but it is the *only* correct statement of the cadence in the repo, and **the operator-facing UI contradicts it**. `app/(admin)/admin/import/page.tsx:62-64` tells Spink the pull "**Runs automatically every hour** — this is the 'do it now' button", repeated at `:88-89` ("The live pull also runs every hour on its own"). It does not: commit `13d3fb5` *"Disable the hourly xola-pull cron (manual Pull-now only)"* removed `{ "path": "/api/cron/xola-pull", "schedule": "0 * * * *" }` from `vercel.json`, and it is absent on **both** trees (`vercel.json` carries only `tick` `*/15` and `doorbell-tick` `*/2`). Also still false: `app/api/cron/xola-pull/route.ts:8-9` ("on its OWN cron (`vercel.json`, `0 * * * *`)"), `src/import/xola-pull.ts:5-6` ("Runs hourly off its own cron"), `DEPLOY.md:48` ("the **hourly cron pull** does nothing" — written *by shard E last night*), and `DEC-043`'s trust model at `DECISIONS.md:1355` ("**auto-import stays**"). **Consequence:** an operator who believes the UI never presses the button, and no trip reaches the board. Prior art: `SECURITY_AUDIT.md:71` filed the *route/config* half (INFO, "Filed (Phase 10)"); `RETROSPECTIVES.md:50` records "no xola-pull cron in production" as a Phase-10 lesson. **The shipped UI copy is not covered by either and is the live half** | CODE-CONTRADICTS | **code-wrong** (extends `SECURITY_AUDIT.md:71`) |
| C2.2-4 | `SPEC.md:523-528` | "**States to render** — **Event list** — events grouped by date (and filterable by boat), each showing boat · day · time · capacity, plus reservation count and pax total against capacity." / "**Event detail** — one event with its reservations: each reservation's customer **name, party size, phone**" | The derivation is complete and tested — `buildEventBrowse` / `buildEventDetail` / `renderEventList` (`src/import/browse.ts:25/57/75`), tests `browse.test.ts:23` *"lists events with reservation count and booked-pax vs capacity"* and `:34` *"event detail shows name, party size, and a nullable-phone placeholder"*. **They have zero callers outside `browse.test.ts` on either tree** (whole-tree grep on `main` and `origin/feature/reservations`). There is no `/admin/events` page, no `db:` script (`package.json:12–28` has no browse command), and the module's own docstring says "Structured output for the **future M4 UI**". The closest shipped analogue, `/admin/shifts` (`src/admin/all-shifts.ts:18–60`), is shift-shaped: boat · day · trip times · `paxTotal` — **no capacity, no reservation count, no boat filter, no customer names**. This is the exact C2.1-4 shape (a well-tested derivation layer with nothing on top) for a second surface | CODE-CONTRADICTS | **decision** |
| C2.2-5 | `SPEC.md:569-575` + AC-6 (`:588`) | "**Event edited after shifts formed.** Changing an event's **time**/capacity after its shift was built must **propagate to the shift**. … Propagation is unconditional" | Propagation of the *derived* facts holds (see AC-6) — but the **crew never hear about a retime**. `Shift` stores no time, only `eventIds` (`form-shifts.ts:406–413`), and the `#350` "your shift changed" notice is diff-gated on the **event-id set only**: `!idSetEq(existing.eventIds, shift.eventIds)` (`:435`). A Xola retime keeps the same `event.id`, so the set is unchanged, so `changedCrew` stays empty and no notice fires — while the crew member's **call time** silently moves (`shift-card.ts:145` = earliest departure − `CALL_LEAD_MINUTES`). The comment two lines above at `:418-419` claims the opposite in so many words: "*its assigned crew's committed day moved (**call time** / trips / manifest)*". `form-shifts.test.ts:217–268` covers a trip **added** and a trip **cancelled**; there is **no test for a time change** anywhere in that file. Blast radius: crew show up 45 minutes off a departure Xola moved | CODE-CONTRADICTS | **code-wrong** |
| C2.2-6 | `SPEC.md:570` | "Changing an event's time/**capacity** after its shift was built must propagate to the shift." | For **capacity** this is vacuous: nothing downstream of the event reads it. Seats come from vessel manning — `deriveSeats(vessel, shiftId)` (`form-shifts.ts:366`) takes the `Vessel`, never the `Event`; `Event.capacity` is set once at import from a hardcoded `vesselCapacity(vesselId)` (`import-reservations.ts:249`, `resource-map.ts`) and is read **only** by `buildEventBrowse` (`browse.ts:37`) — the module with no callers (C2.2-4). So an event capacity change propagates to precisely nothing, and can't: the importer re-derives capacity from the boat, not from Xola. The sentence should either drop "capacity" or say what it's supposed to affect | CODE-CONTRADICTS | doc-wrong |
| C2.2-7 | `SPEC.md:592-596` | Open question 1: "~~**Merge rule** for manual entries vs re-import~~ — **RESOLVED by DEC-043** … there are no manual entries to reconcile" | Correct as of DEC-043 and **partly reopened by DEC-126 item 4** (C2.2-2). Once task 12.14 (#467) ships a Muster-side cancel of a `source='xola'` reservation, `importRecords` will happily overwrite it: Pass 3 writes `status: rec.status` straight from the Xola row (`import-reservations.ts:272–289`) with no "operator cancelled this here" guard. DEC-126 item 3 says the pull stops at cutover, which *would* make the collision impossible — **but only if 12.14 lands after the pull is switched off**, and `PROJECT_PLAN.md:561/562` sequences 12.14 **before** 12.15 (the flip). Per lesson 7 this is filed as a question, not a defect: *does the Muster-side cancel ship only post-cutover (no guard needed), or does it need a "cancelled in Muster wins" clause — i.e. the merge rule this open question was closed for lacking?* | MISMATCH | **decision** |
| C2.2-8 | `SPEC.md:501-508` (S54 header) | "**⚠️ Reconciled 2026-07-15 (S54).** … The paragraphs below are corrected in place; where a claim was load-bearing and is now wrong, it says so rather than being quietly deleted." | The method is sound and the three S54 corrections themselves are still true (CSV retired, portal is 2026, lock cut — all NOISE below). What's now wrong is that the header **stops at 2026-07-15** while the rest of the file moved to 2026-07-17: §0.2/§0.3/§4 carry "*Reconciled 2026-07-15 (S54), **revised 2026-07-17 (S56, DEC-126)***" headers (`SPEC.md:81`, `:1215`) and §2.2's does not. A reader who trusts the dated header will read §2.2's "coexist permanently" as the current position (C2.2-1). Two-day-old staleness in a *versioned* header is cheap to fix and expensive to leave | MISMATCH | doc-wrong |
| C2.2-9 | `SPEC.md:511-513`, `:546-550` | "Purpose — Hold the **imported** events and reservations and be **the single data layer** the rest of Muster reads … **This section stays what it always was: the data layer under the crew engine**" | "Single data layer" is true; "under the crew engine" is now only half the story, and §2.2 is the only §2.x section that owns `Event`/`Reservation`. On `origin/feature/reservations` the same two tables are the substrate for the **entire** reservations product — `deriveAvailability(events, reservations)` (`src/reservations/availability.ts:56–59`), `/admin/calendar` (`calendar-view.tsx:138–183`, `repo.listEvents()` + `listAllReservations()`), `/admin/purchases`, `write-booking.ts`, `claim.ts` — while `Event` itself grew `price` (DEC-112, `entities.ts:188`) and `Reservation` grew `waiverConsentAt`/`waiverVersion` (`entities.ts:531–540`). §2.2's Data-read list (`:556-557`) names exactly two readers: the shift builder and the crew manifest. That list is now short by a product. **Lesson 10 read:** §2.2 is still load-bearing, but its *scope claim* has quietly become false — it is no longer the data layer under the crew engine, it is the data layer, full stop | MISMATCH | **decision** |
| C2.2-10 | `SPEC.md:524-528` (Event list / Event detail) + `PROJECT_PLAN.md:342`, `:378` | §2.2 is where the operator sees imported events and their reservations | On `origin/feature/reservations` the operator gains `/admin/calendar` — the closest thing to §2.2's "Event list" ever built — and it **deliberately excludes Xola rows**: `isActiveMusterClaim(r)` = `r.source === "muster" && r.status === "booked"` (`src/reservations/availability.ts:47–49`), used at `calendar-view.tsx:162`. `/admin/purchases` does the same, and says so out loud in its docstring (`page.tsx:30` "Muster-side only: Xola owns its own money (DEC-105), so `xola` reservations never appear") and in its empty state (`:195`). Correct per DEC-105 — but the net effect is that **during the pilot the operator has a calendar of Muster bookings, a purchases list of Muster orders, and no surface at all for the Xola-sourced majority** (C2.2-4). Related dangling scope: `PROJECT_PLAN.md:342` and `:378` park **retime** as "Event-Admin §2.2 territory: retiming re-keys `eventId`" — §2.2 lists no retime action (DEC-043 struck all manual event writes), so the plan is parking work against a section that disowns it | MISMATCH | **decision** |
| C2.2-11 | `SPEC.md:495–605` (whole section) | §2.2 exists as a first-class §2.x surface with 7 acceptance criteria | **`docs/USER_STORIES.md` has no Event Admin stories.** Grepping the whole file for import/Xola/event/reservation returns SP-5 (shifts auto-formed, §2.3), the struck SP-6/SP-7 (lock, cut by DEC-082 — fixed by shard C), SP-14 (the Xola write-back sheet, §2.3) and the §2.6 manifest line. §2.2 is the **only** §2.x surface with acceptance criteria and zero user stories. Defensible — a data layer nobody opens has no story to tell — but combined with C2.2-4 (nothing renders) it is the second independent signal that §2.2 specifies a *surface* that was only ever built as a *pipeline* | MISMATCH | **decision** |
| C2.2-12 | `docs/design/mockups/eventimport.jsx:1`, `eventdetail.jsx:1–15`, `eventapp.jsx:5` | The Event Admin mockup set is the design reference for §2.2 (`DESIGN-REFERENCE.md:124`) | **The entire set models the world §2.2's own header says no longer exists.** `eventimport.jsx:1` — "*CSV import / reconcile modal with result report*" (CSV retired, DEC-043 / `SPEC.md:515-517`). `eventdetail.jsx:7` — an `AddResForm` (customer / pax / phone) that manually adds a reservation, plus per-event edits (struck, `SPEC.md:536-542`). `eventapp.jsx:5` — the default selection is chosen because it "*shows edited-after-shift + **manual** + **conflict***", i.e. it is posed around the manual-entry-vs-re-import merge conflict that `SPEC.md:563-566` declares **MOOT**. `eventapp.jsx:8` carries a `lastSync` stamp. Nothing warns a reader: `DESIGN-REFERENCE.md:124` files all five as the Event-admin reference with no staleness note, and `:139-144` ("If a mockup and the spec disagree, the spec wins") is the only guard. A builder opening these to build §2.2 would rebuild three struck actions | MISMATCH | doc-wrong |

---

## Per-acceptance-criterion verdicts

The seven `- [ ]` boxes at `SPEC.md:580–590`. All source citations are `main` @ `7842566` unless the
row says otherwise.

### AC-1 — "Importing creates events and their reservations, grouped correctly (reservations → events by occurrence; events available to roll up → shifts by boat+day)." — **MET**
Three-pass `importRecords` (`import-reservations.ts:165–303`): Pass 1 groups records by the **real
Xola `event.id`** (DEC-043 — four boats at one slot are four events, superseding DEC-016's collapse),
Pass 2 upserts the `Event` with a **derived** status (`anyBooked ? "scheduled" : "cancelled"`,
`:256`), Pass 3 upserts each reservation against its placed event. The boat+day roll-up is
`formShifts` (`form-shifts.ts`), which `pullXola` calls immediately after the import
(`xola-pull.ts:176–184`). Tests: `import-reservations.test.ts:41` *"keys the event on the real
event.id and resolves the booked vessel"*, `:72` *"one booked among cancelled → event still
scheduled"*, `:78`, `:94` *"a de-boated cancel reconciles against the stored event → cancelled"*,
`:127` *"re-import that cancels the only booking cancels the shift (no ghost)"*. This is the
best-tested criterion in the section.

### AC-2 — "Re-importing with a changed reservation updates it in place; a cancelled one is marked cancelled — neither duplicates." — **MET**
Idempotency is structural, not incidental: the reservation's internal id is derived
(`resv-${rec.reservationId}` from the stable Xola `items[].id`, `import-reservations.ts:267`) and the
event's id **is** the Xola `event.id` (`:266`), so a re-import is an upsert on a primary key — there
is no code path that can insert a second row. Cancels arrive as explicit status-700 rows, never as
absence (`xola-client.ts:23–25`, `:51-52`; DEC-043 verified this against production), so
`reservationsNewlyCancelled` is a transition, not a diff. Materiality per DEC-029
(`reservationMateriallyChanged`, `:108–116`) preserves `updatedAt` on an unchanged re-import — `phone`
is deliberately excluded from the material set. Test: `import-reservations.test.ts:112`
*"materiality (DEC-029): re-import preserves updatedAt; a partySize change bumps it"*.
*Doc nit:* `SPEC.md:562` says identity is on "`Reservation ID`" — DEC-043 amended DEC-029 so that
reservation identity is the Xola **item** id and event identity is the real `event.id`. Close enough
to be NOISE, precise enough to be worth a word if §2.2 is edited anyway.

### AC-3 — "~~A manually-added reservation survives the next import per the merge rule.~~ — **struck**, no manual entries (DEC-043)." — **CORRECTLY STRUCK, WITH A LIVE CAVEAT**
The strike is accurate for `main`: `importRecords` is the only writer of `source: "xola"` rows
(`:257`, `:275` — both hardcoded with a DEC-106 comment) and no CLI or route writes a Xola-sourced
reservation. See **C2.2-7**: DEC-126 item 4 + task 12.14 (#467) reintroduce a Muster-side *cancel* of
an imported reservation, which is a manual write that a still-running pull would clobber at
`:272–289`. The criterion is struck; the question behind it is not fully dead.

### AC-4 — "Event detail shows each reservation's name, party size, and phone; no waiver field is required." — **PARTIALLY MET (derived, never rendered — for admins)**
`buildEventDetail` returns exactly `{customerName, partySize, status, phone, email}` with a
`"(no number on file)"` placeholder for the DEC-017 nullable phone (`browse.ts:57–72`); test
`browse.test.ts:34`. **No caller** (C2.2-4) — there is no admin surface on which Spink can open an
event and read its manifest, on either tree. The **crew** half shipped: `assembleManifest`
(`shift-card.ts:194–245`) builds `ManifestGuest {name, party, phone}` from booked reservations only,
and `shift-card.ts:29` states the no-waiver rule with its DEC-012 citation.
*The no-waiver half is confirmed true and stays true:* `origin/feature/reservations` added
`waiverConsentAt` / `waiverVersion` to `Reservation` (`entities.ts:531–540`) — **Muster-sold side
only**, explicitly "*never on imported Xola reservations*" — and `ManifestGuest` still carries none
(`shift-card.ts:29`, `:199`, `:559` "No waiver field — DEC-012").

### AC-5 — "Unparseable records appear in the import result rather than being silently dropped." — **MET, and the best-shipped criterion in the section**
Three drop paths, all itemized: no event id (`import-reservations.ts:171–180`), no resolvable boat
(`:216–225`), Muster-owned vessel-day (`:233–247`). `SkippedRow` carries `date` + `time` + `product`
(#320) so a skip names **which trip**, not an opaque id. It is **rendered**:
`app/(admin)/admin/import/run/[id]/page.tsx:127–147` reconciles `skipped.length + mapSkipped` into one
count with per-row detail, `:93–103` raises unknown Xola resources, and `:107–119` gives in-window
booked-no-boat rows their own **loud** `tone="bad"` alert (#338). Persisted per run
(`import-audit.ts`), so a cron run leaves a trace. Test: `import-reservations.test.ts:101`
*"missing event id → the record is skipped"*.

### AC-6 — "Editing an event's time propagates to any shift already formed from it." — **PARTIALLY MET (state propagates; the crew notice does not)**
Propagation is met, and met the strong way — by not storing the fact twice. `Shift` has no `time`
field (`form-shifts.ts:406–413`); it holds `eventIds`, and every time-derived fact is computed live
from the events on read: call time = `earliestScheduledStart − CALL_LEAD_MINUTES`
(`derive.ts:245–259`, `:399`; `shift-card.ts:145`), the staffing horizon
(`staffingHorizonFromEvents`, `form-shifts.ts:398`), and `/admin/shifts`' trip times
(`all-shifts.ts:164–173`). A retimed event therefore changes the shift on the next read with no
propagation code at all.
**Not met:** the assigned crew are never told. See **C2.2-5** — the `#350` diff-gate compares event-id
sets, a retime doesn't change the set, and no test covers a time change.

### AC-7 — "A Xola event landing on a Muster-owned vessel-day is skipped and itemized, not imported (DEC-106)." — **MET**
`importRecords` hoists `repo.listMusterOwnedVesselDays()` into a `Set` keyed `${vesselId}|${date}`
once per run (`:197–204`), then per event skips + itemizes every row with
`category: "muster_owned"` and a de-list-in-Xola reason (`:233–247`) — and crucially does **not** add
the event to `placed`, so Pass 3 drops its reservations for free. Whole-vessel-day grain, matching
DEC-106. Tests: `import-reservations.test.ts:49` *"skips + itemizes a Xola event on a Muster-owned
vessel-day (DEC-106)"* and `:64` *"the ownership guard is **inert** for a vessel-day not marked
owned"* — which pins `SPEC.md:577`'s "Inert until a vessel-day is marked owned". The write door is
`db:own` (`package.json:19` → `src/import/own-cli.ts`), whose `mark` warns when a live Xola event
already sits on the day (`own-cli.test.ts:45`) — the DEC-106 sequencing guard. **Present and
identical on `origin/feature/reservations`.** This is §2.2's one criterion that is fully specified,
fully built, fully tested, and reachable by an operator.

**Tally:** 4 MET · 2 PARTIALLY MET · 1 correctly struck. No `NOT MET`. Contrast §2.1 (C2.1), where the
failure mode was missing *behavior*; §2.2's failure mode is missing *surface* — the pipeline is real
and the two "states to render" are not rendered.

---

## Open questions (Event Admin) — `SPEC.md:592–605`

Both questions are struck and both strikes are correct. This subsection is **healthier than the rest
of §2.2** — it is the only part of the section that was closed against a DEC rather than left to age.

**OQ-1 — "~~Merge rule for manual entries vs re-import~~ — RESOLVED by DEC-043, not by Spink/Drew."**
Verified: DEC-043's operator trust model (`DECISIONS.md:1355`) is quoted **verbatim and accurately**
at `SPEC.md:537-539`. The note's stated reason for striking rather than deleting — "*leaving it open
would send someone to ask Drew a dead question*" — is exactly the right instinct and worth keeping as
a house pattern. **Caveat: DEC-126 item 4 partially reopens it** (C2.2-7). Not "still open"; *re*-opened,
under a new mechanism, and §2.2 doesn't know yet.

**OQ-2 — "~~Exact Xola export columns~~ — RESOLVED … settled by DEC-040: no `expand` is needed …
contact is order-level and inline — `order.phone`, NOT `organizer.phone` … status codes are 200–203
booked / 700 cancelled. Boat resolution is DEC-043."**
Verified line by line against `src/import/xola-client.ts`: `BOOKED_STATUS_CODES = [200, 201, 202, 203]`
and `CANCELLED_STATUS_CODE = 700` (`:51-52`) with the code meanings spelled out at `:46`; phone reads
`order.phoneCanonical || order.phone` (`:275`) — order-level, with a deliberate logical-OR so an empty
canonical falls through; no `expand` parameter appears anywhere in `buildOrdersUrl` (`:304–311`); boat
resolution is `event.resourceUsages[].resource.id` (`:122`, `:195`). **Fully accurate, no drift.**
Genuinely closed.

**Neither question is stale-and-unstruck**, so the failure mode this shard was told to hunt for here
does not occur. Note the asymmetry worth carrying: §2.2's *open questions* were maintained against new
DECs; its *body* was not (C2.2-1, C2.2-2, C2.2-8).

---

## What this shard would recommend

**One clear-cut doc edit that is also the headline (C2.2-1, C2.2-8, C2.2-2).** The S56 pass on
2026-07-17 reconciled §0.2, §0.3 and §4 to DEC-126 and **skipped §2.2**. The result is a
self-contradicting SPEC: `:83` says "coexistence → cutover, the pull stops", `:519` says "both paths
coexist permanently". Fixing it is mechanical — copy the §0.3 pattern: extend the header to
"*Reconciled 2026-07-15 (S54), revised … (DEC-126)*", replace "coexist permanently" with
"coexist through the pilot, then Muster takes over at the cutover (DEC-126); the ongoing pull stops
there", and add one line under Actions noting that the Muster-side cancel of an imported reservation
is coming as task 12.14 (#467). **Do this on `origin/feature/reservations`, not `main`** — DEC-126's
downstream DECs and every reservations surface live there, and shard A's precedent (PR #538) is to fix
the branch that owns the decision.

**One live operator-facing defect (C2.2-3).** `/admin/import` tells Spink the pull "runs automatically
every hour". It has not since commit `13d3fb5` (*"Disable the hourly xola-pull cron — operator wants
to control when imports land"*). An operator who believes the page presses nothing and no trip reaches
the board. The config half is already filed (`SECURITY_AUDIT.md:71`, Phase 10) but the **UI copy is
not**, and neither is `DEPLOY.md:48`, written by shard E hours ago. Cheap fix, four files
(`import/page.tsx` ×2 strings, `xola-pull/route.ts:8-9`, `xola-pull.ts:5-6`, `DEPLOY.md:48`), and
worth a one-line DEC amendment to DEC-043 since `DECISIONS.md:1355` still says "auto-import stays".

**One real code defect (C2.2-5).** A Xola retime moves the crew's call time and sends nobody a notice,
because the `#350` gate compares event-id *sets* and a retime preserves the id. The comment three
lines up claims call-time moves are exactly what it catches. Symmetric to the C2.1-8/AC-7 shape: the
machinery next door does the right thing for a neighbouring case. **Ask before filing** — at one boat
Spink may already text people — but unlike C2.1-8 this one has a wrong comment and an absent test
asserting it works, so at minimum the comment is a lie.

**One operator decision wearing four hats (C2.2-4, -9, -10, -11).** §2.2 specs an Event **list** and an
Event **detail**. What exists is a complete, tested `browse.ts` with **zero callers on either tree**,
no user stories, and a Phase-12 calendar that renders the *other* source by design. Same diagnosis as
C2.1's roster: a derivation layer with no surface. But the §2.2 answer may well be *different* — per
DEC-126 the Xola import **dies at the cutover**, so building an admin browser for Xola-sourced events
in 2026 is building a surface with a scheduled end date. **The question is not "why is this unbuilt"
but "is §2.2 a forward spec at all, or is it now the record of a pipeline that gets deleted at the
flip?"** Answer it before anyone builds `/admin/events`.

**Lesson-10 call: keep §2.2, but date it.** It is the only section describing the ingest that still
runs every business day, so deleting it now would be shard D's mistake in reverse. But it is
**draining by design** (DEC-126 item 3) and its scope claim has already gone stale (C2.2-9). Recommend
one sentence at the top: *this section describes the Xola-sourced pipeline, which ends at the DEC-126
cutover; `Event`/`Reservation` themselves outlive it as the reservations substrate.* Then it can be
deleted cleanly on the day the pull stops, rather than rotting into a second §2.1.

**Two stale artifacts to flag, not fix (C2.2-12, C2.2-10 second half).** The five Event-Admin mockups
model CSV import, manual reservation entry, and the merge conflict — all three struck. And
`PROJECT_PLAN.md:342`/`:378` park "retime" as §2.2 territory when §2.2 struck every manual event
write. Both are one-line notes.

---

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| The three S54 corrections themselves: CSV/xlsx retired, portal is 2026 not 2027, lock cut | `SPEC.md:501-508` | All three still true. xlsx: no reader anywhere in `src/import/`, `/admin/import` offers only the pull button; DEC-043's *"the xlsx upload is retired — it can't resolve a boat"* (`DECISIONS.md:1358`). 2026: DEC-105 (`:2716`) + Phases 11/12 shipped on `origin/feature/reservations`. Lock: no `locked` field on `Shift`, DEC-082 confirmed by shard C. **The reconciliation method worked; only its *date* went stale (C2.2-8)** |
| "ingest is the **live Xola API pull** (DEC-036/037), not a CSV bridge … **There is no spreadsheet path at all**" | `SPEC.md:515-517` | `xola-pull.ts` → `xola-client.ts` (`fetchOrders` ⨝ `fetchEvents`) is the sole ingest; `app/(admin)/admin/import/page.tsx:18` states "The xlsx upload is retired (can't resolve a boat)". No `.xlsx`/`xlsx` dependency or reader on either tree |
| "The pull window is `[today−1, today+lead+1]`" | `SPEC.md:535` | `pullWindow()` (`xola-pull.ts:56–63`) — `{ start: addDays(today, -1), end: addDays(today, leadDays + 1) }`, vessel-local via `vesselLocalDate` (DEC-032), with the pull lead decoupled from the staffing horizon per DEC-080 (`:147-148`). Exact match |
| DEC-043's operator trust model, quoted: *"auto-import stays, Xola is the single source of truth; a bad boat assignment is fixed **in Xola + 'Pull now'** — no Muster-side staging/override"* | `SPEC.md:537-539` | `DECISIONS.md:1355` — **verbatim**, no drift. The review surface it promises is real: `XolaPullResult.assignments` (per-day boat→times, `xola-pull.ts:83–105`) rendered at `run/[id]/page.tsx:163–185`, and `unmappedResources` rendered as a warning at `:93–103`. *(The "auto-import stays" clause is the one part now false — C2.2-3)* |
| "discriminated by `source` (DEC-106)" — the mechanism, as distinct from the "permanently" (C2.2-1) | `SPEC.md:520-521` | `Source = "xola" \| "muster"` (`entities.ts:169`), on both `Event` (`:181`) and `Reservation` (`:204`), plain text union never a DB enum (DEC-DATA-1). The importer hardcodes `"xola"` at both write sites with the DEC-106 rationale inline (`import-reservations.ts:257`, `:275`); the native path writes `"muster"` (`origin/feature/reservations:src/adapters/postgres-repository.ts:284`, `repository-contract.ts:438–502`). Migration `0023_reservations_source_partition.sql` on the feature branch |
| "the importer **skips** a Muster-owned vessel-day (DEC-106), so the two sources never write the same event" | `SPEC.md:565-566` | See AC-7. Guard present and identically implemented on both trees; contract-tested; `db:own` is the write door with a sequencing warning |
| "A **Muster-native** reservation … belongs to the reservations purchases surface (DEC-123)" | `SPEC.md:541-542` | `origin/feature/reservations:app/(admin)/admin/purchases/page.tsx` exists (task 12.12a, #465) and its docstring at `:30` states the partition from the other side: *"Muster-side only: Xola owns its own money (DEC-105), so `xola` reservations never appear"*. The two sections' scope boundaries agree exactly |
| "pricing, payment capture, and customer comms … are now **Muster's**, but they live in the **reservations** surfaces (per-event price DEC-112, Stripe DEC-107, the `Offering` catalog DEC-123, tips DEC-124), **not here**" | `SPEC.md:546-550` | All four land where §2.2 says: `Event.price` in integer cents, explicitly source-agnostic and left undefined for Xola events (`entities.ts:183–188`, DEC-112); Stripe under `src/reservations/create-*-checkout.ts`; `offering-admin.ts` + `/admin/offerings`; `src/reservations/gratuity.ts` + task 12.3. **Nothing money-shaped leaked into `src/import/`** — checked |
| "**Import result** — after an import, what was added / updated / skipped, and any records that couldn't be parsed" | `SPEC.md:529-530` | The one "state to render" that is genuinely rendered, and rendered better than specced: `run/[id]/page.tsx` gives counts, the **identity** behind them (#128 — reservations by name, shifts by id, `:153–160`), per-day assignments, and three severity-graded alert classes. `ImportResult` (`import-reservations.ts:80–100`) carries `added`/`updated`/`newlyCancelled` refs alongside the counts. Persisted per run (`import-audit.ts`), sourced `manual` vs `cron` |
| "Read by the **shift builder** (§2.3, reads events) and the **crew manifest** on the shift card (§2.6, reads reservations grouped per event)" | `SPEC.md:556-557` | Both directions accurate. Builder: `formShifts` groups `repo.listEvents()` by vessel+date (`form-shifts.ts:147–150`) and stores `eventIds` (`:411`). Manifest: `assembleManifest` (`shift-card.ts:194–245`) walks `shift.eventIds` → `listReservationsForEvent` → booked-only `ManifestGuest`. *(Incomplete as a list — C2.2-9 — but not wrong)* |
| DEC-040's field findings, as restated in Open question 2 | `SPEC.md:597-602` | Verified line by line against `xola-client.ts` — see the Open-questions section above. No `expand`, order-level phone with a canonical-first OR, 200–203/700, `resourceUsages` for the boat |
| `DESIGN-REFERENCE.md:124` files `eventapp/eventdata/eventdetail/eventlist/eventimport.jsx` under "Event admin / import" | `DESIGN-REFERENCE.md:124` | **Correct filing** — all five are Event-Admin-specific by their own first lines, none is mis-filed as Shared. Shard G's replacement list got this row right, unlike the Roster row (C2.1-11). *(They are stale in **content** — C2.2-12 — which is a different defect from being mis-indexed)* |

---

## Mockup mapping (~10 min cap; filename + head-of-file skim only)

**Belongs to §2.2 Event Admin — all five, correctly indexed already:**

- `eventapp.jsx` → shell: layout, `events` state, `boat` + `query` filters, `lastSync`, import-apply.
  Default selection `e4` chosen to show "*edited-after-shift + manual + conflict*" — i.e. posed around
  two struck behaviors (C2.2-12).
- `eventlist.jsx` → left pane: boat filter, week summary, events grouped by date with a `CapBar`
  (pax/capacity fill bar). **This is the literal §2.2 "Event list" state**, including the
  "filterable by boat" and "pax total against capacity" clauses that no shipped surface has (C2.2-4).
- `eventdetail.jsx` → right pane: per-event reservation manifest (name · pax · phone) + edits, incl.
  `AddResForm`. The manifest half **is** AC-4; the edit half is struck by DEC-043.
- `eventdata.jsx` → substrate: boats (Mash Tun cap 6, Tidewater cap 12 — pre-DEC-043 invented fleet,
  not the Brew 1–4 resource-mapped one), events, reservations, `IMPORT_RESULT` / `IMPORT_FILE` sim.
- `eventimport.jsx` → **CSV** import/reconcile modal with result report. The result-report shape is
  still the right reference for AC-5; the CSV framing is retired (DEC-043).

**Rendered HTML for this surface:** `Event Admin.html` (title "Muster · Event Admin", IBM Plex, the
shared `--accent:#2f5d86` token set) — **absent from the index**, part of the 11-file omission C2.1-12
already logged. Not re-derived; noted so the rebuild's Event-Admin row is complete.

**The Phase-12 `.html` set belongs to the native-reservations design docs, NOT §2.2 — and §2.2 says so
itself.** `SPEC.md:507-508`: *"**'Reservation' here means the imported, Xola-sourced kind.**
Muster-native reservations are a different animal — see `docs/design/reservations-model.md`,
`reservations-admin.md`, and DEC-105–113 / DEC-123 / DEC-124."* `:541-542` routes them to DEC-123's
purchases surface. Code confirms the partition rather than merely restating it: the calendar and
purchases surfaces filter to `source === "muster"` (`availability.ts:47–49`;
`purchases/page.tsx:30`). One line each:

- `offering-catalog.html`, `offerings-list.html` → `Offering` catalog (DEC-123, task 12.x,
  `offering-admin.ts`). Native. **Not §2.2.**
- `reservation-calendar{,-mobile,-scale}.html` → `/admin/calendar` (task 12.11, #464). The closest
  visual analogue to §2.2's Event list, and the **most likely mis-file** in a future rebuild — but it
  renders Muster claims only (C2.2-10). Native. **Not §2.2**, and worth an explicit "not the Event
  Admin list" note in the index so nobody pairs them by resemblance.
- `booking-form.html`, `booking-manage.html`, `booking-recovery.html`, `availability-picker.html` →
  public customer flow (DEC-134/135/138). Native. **Not §2.2.**
- `purchases-customers.html` → `/admin/purchases` + `/admin/customers` (12.12a/b). Native. **Not §2.2.**
- `blocks.html` → the block registry — availability *suppression* (DEC-125/§1.3, `block-admin.ts`),
  not events. **Not §2.2**; belongs to §1.3's family.
- `vessel.html`, `location.html` → task 12.9 vessel + location CRUD (`vessel-admin.ts`,
  `location-admin.ts`). **Ambiguous** — reference-data admin with no §2.x section of its own; §2.1 owns
  crew reference data and §2.2 owns imported events, so these two are homeless in the current §2.x
  numbering. Flag for the operator, don't guess.

**New mis-filing found:** none. `DESIGN-REFERENCE.md:124`'s Event-admin row is correct as far as it
goes (5/6 files; `Event Admin.html` missing per C2.1-12). The Roster mis-filing and the 11 missing
`.html` surfaces are C2.1's rows and are not re-derived here.

---

## Coverage — what this shard did and did not read

- **Read in full:** `SPEC.md:495–605` (the corpus) plus `:60–105` and `:1210–1220` (the §0.x/§4
  DEC-126 reconciliations that C2.2-1 turns on); `src/import/import-reservations.ts`, `xola-pull.ts`,
  `browse.ts`; `app/api/cron/xola-pull/route.ts`; `app/(admin)/admin/import/page.tsx` and
  `run/[id]/page.tsx`; `src/builder/form-shifts.ts:290–445`; `src/domain/entities.ts:155–230`;
  DEC-043, DEC-105, DEC-106, DEC-126, DEC-127 in full; `vercel.json` on both trees + its full git
  history (`git log -p -- vercel.json`).
- **Grep-/test-name-verified, not read line by line:** `xola-client.ts` (the DEC-040 field set,
  status codes, URL params), `import-audit.ts`, `resource-map.ts`, `own-cli.ts`,
  `src/admin/all-shifts.ts`, `src/crewapp/shift-card.ts` (manifest assembly only),
  `src/builder/derive.ts` (call-time constants only), the four `*.test.ts` files in `src/import/`
  (read by `it()` name + the specific assertions cited), `docs/USER_STORIES.md` (whole file by grep),
  `docs/PROJECT_PLAN.md` (import/Xola rows), `docs/DEPLOY.md`, `docs/SECURITY_AUDIT.md`,
  `docs/RETROSPECTIVES.md`.
- **Feature branch, read via `git show`/`git grep`:** `admin/calendar/{page,calendar-view}.tsx`,
  `admin/purchases/page.tsx`, `src/reservations/availability.ts:47–59`, `entities.ts:525–560`,
  `import-reservations.ts` (diffed against `main` — the DEC-106 guard is identical),
  `DECISIONS.md:3952–4040` (DEC-134–138 headings), the `src/reservations/**` file list.
- **Skimmed head-of-file only:** the six Event-Admin mockups (per the ~10-minute cap).
- **Not read:** `docs/design/reservations-model.md` and `reservations-admin.md` in full (grepped for
  §2.2 references — none); `src/reservations/**` implementation beyond `availability.ts`; the Phase-12
  migrations; `SPEC.md` §2.3–§2.7 (the rest of C2); `src/adapters/**` beyond the `source` write sites.
- **Not verifiable here:** whether production's Vercel project has a cron configured outside
  `vercel.json` (it cannot — Vercel crons are `vercel.json`-only — but the running deploy's cron list
  was not inspected; `RETROSPECTIVES.md:50` independently records "no xola-pull cron in production").

## Cost

One sweep agent, ledger-on-disk. §2.2's 111 doc lines are dense with citations, which made most claims
cheap to settle — the corrected paragraphs quote their DECs verbatim and the DECs check out. The
expensive parts were (a) the two-tree evidence split, and (b) proving the *absences*: zero callers for
`browse.ts` on both trees, no `xola-pull` cron in `vercel.json` on either tree or anywhere in its
history since `13d3fb5`, no time-change test in `form-shifts.test.ts`, and no Event Admin user stories.
The single highest-yield move was reading DEC-126 in full early — it is the axis three findings turn on
and it postdates the S54 header by two days.
