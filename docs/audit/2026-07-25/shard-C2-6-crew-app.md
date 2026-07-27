# Shard C2.6 — Crew App

**Subject:** `docs/SPEC.md` lines **933–1022** — all of `## 2.6 Crew App`: the stance block-quote,
`### 2.6.1 The ask`, `### 2.6.2 My shifts`, `### 2.6.3 The shift card — single source of truth`,
the three bulletproofing principles, States to render, Actions, Data read, Edge cases, and the
7 acceptance criteria.

**Audited tree:** `main` @ `f401e9c` (branch `task/audit-c2-4-to-c2-7`).

> **Which-tree check (lesson 4) — re-run for §2.6, and the answer is clean.**
> `git diff main origin/feature/reservations -- docs/SPEC.md` = **13 hunks**. Their `main`-side
> ranges are 116–124, 236–320, 498–504, 516–524, 540–545, 566–573, 606–616, 644–669, 684–706,
> 720–737, 744–758, 1177–1186, 1215–1225. **None touch 933–1022** — the nearest are 744–758 (§2.3's
> tail) and 1177–1186 (§4 Parked), with a 400-line clean gap over §2.4–§2.7. §2.6 is byte-identical
> on both trees and a `main` sweep is complete for this subject. (Note the shorthand is still false
> at file granularity — the file *does* diverge, by 10+ hunks; only this range doesn't.)

**Evidence read.** `src/crewapp/` — `shift-card.ts` (full), `crew-view.ts` (full), `standing.ts`
(full), `calendar-feed.ts:60–190`, `claimable-view.ts` + `other-shifts.ts` + `answered-code.ts` +
`intro-text.ts` (targeted), plus the full `it(...)` inventory of all 8 sibling `.test.ts` files
(~70 test names). `app/(crew)/crew/page.tsx` (full, 636 lines), `app/(crew)/crew/shift/[shiftId]/
page.tsx` (full) + its `actions.ts`. `src/adapters/forward-asks.ts` (full), `twilio-channel.ts:100–160`,
`web-link-channel.ts:1–40`, `sms-deep-link.ts` (full). `app/lib/channel.ts:1–60`.
`src/builder/form-notices.ts` (full), `form-shifts.ts:75–150, 430–447`, `derive.ts:240–276, 448–457`.
`src/admin/credential-health.ts` (full), `src/oracle/eligibility.ts:172–277`,
`src/config/tenant.ts:1–60`. `src/domain/entities.ts:171–230`. `components/assignment/shift-manifest.tsx`
(targeted). `docs/DECISIONS.md` — DEC-009, DEC-012, DEC-019, DEC-028, DEC-030, DEC-032, DEC-041,
DEC-063, DEC-074, DEC-081, DEC-084, DEC-086, DEC-087, DEC-091, DEC-098, DEC-128, DEC-129, DEC-130,
DEC-MSG-1/2/3, REQ-CLAIM-1. `docs/SPEC.md` §0.4, §3.1, §3.2, §3.5, §4. `docs/BRAND.md:20`,
`.claude/ui-context.md:42`.

**Live-evidence greps (lesson 12) — one per cited component, all mounted.** `ShiftManifest` ←
`crew/shift/[shiftId]/page.tsx:7,255` *and* `components/assignment/shift-cockpit.tsx` (shared, #319).
`OtherShiftsToday` ← same page `:8,259`. `RoleGlyph` ← same page `:11,215` (+ `seat-card`, `seat-pips`).
`CredentialLine` / `AskCard` / `DockPin` are file-local functions in their own rendering page
(`crew/page.tsx:385,593`, `shift/[shiftId]/page.tsx:122`), each rendered unconditionally in the
returned tree. `GuestTextButton` ← `shift-manifest.tsx:6,113`. **No orphan of the `ManningSection`
shape was cited in this ledger.** Per the brief, no speculative whole-tree zero-caller sweep was run.

**Reconcile-banner check (lesson 11).** §2.6 carries **no** `⚠️ Reconciled` header — unlike §2.2/§2.3
it has never had a reconciliation pass. That is itself the finding shape here: five DECs
(DEC-030, DEC-074, DEC-098, DEC-128, DEC-091) each moved something §2.6 still describes in its
original 2026-05 words, and nothing in the section says so.

---

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| C2.6-1 | `SPEC.md:941`, `:945-946`, AC-1 `:1012` | "Arrives as **push / SMS**, answerable **without opening anything**" · "**Two buttons. ~3 seconds. No login, no navigate-to-respond.** If accepting is harder than replying to a text, it has already failed (the Xola lesson)." · AC-1: "An ask is fully answerable (in/out) from the push/SMS **without opening** or logging into the app." | **The shipped ask is exactly navigate-to-respond, and that is the accepted design, not a miss.** DEC-030 (`DECISIONS.md:1009-1016`) rules the pilot channel is an operator-relayed web link whose `sms:` body carries a magic link: "The crew member taps → lands authenticated → answers through the existing `recordResponse`. **No inbound webhook.**" The Twilio adapter, now the live path when configured (`app/lib/channel.ts:17-20`, `makeTwilioChannel(...) ?? new WebLinkChannel(...)`), does the same and says so: *"the crew member taps, lands authenticated on In/Out, and answers through `recordResponseAndConfirm`. **No inbound SMS parsing**"* (`twilio-channel.ts:131-137`). There is **no inbound route** — `find app -name route.ts` returns 10 routes, none of them a Twilio/SMS webhook. The In/Out buttons live on `/crew` (`crew/page.tsx:616-632`), reached only by opening the app. **The "no login" half IS met** (the link auto-authenticates, 24h TTL, prefetch-safe consume — DEC-030 §2/§4); the "without opening / no navigate-to-respond" half is not, and §3.1 `:1067` repeats the unreconciled claim a third time | CODE-CONTRADICTS | **decision** |
| C2.6-2 | `SPEC.md:943` (the quoted ask body) | "*Sat Jul 18 · BrewBoat · mate · **call 12:30, back ~6**. In or out?*" | **The shipped SMS carries no time at all.** `singleAskBody` = `` `Muster: ${fmtDate(shift.date)} - ${vessel} - ${role}. In or out?` `` (`forward-asks.ts:45-55`) — date, boat, role, nothing else; a **batched** recipient gets even less: `"Muster: N shifts need you. Tap to answer."` (`:107`). The omission has a stated reason: *"GSM-7 only — no · or — — so the SMS stays a 1-segment 160-char message"* (`:40-42`). Meanwhile the **in-app** ask card does render the window: `` `${date} · ${fmt12(callTime)}–${fmt12(shiftEndTime)} · ${vessel} · ${role}. In or out?` `` (`crew/page.tsx:598-603`), fed by `committedWindowFor` (`crew-view.ts:120-135`, pinned by `crew-view.test.ts:130` *"ask card carries the call→end window (call time, not raw departure — #419)"*). So the two ask surfaces genuinely disagree — **the text tells you less than the card**, which is the exact shape §2.6.3's "single source of truth" invariant exists to forbid. No DEC records dropping the time from the SMS body; the constraint (1-segment GSM-7) is real but is a code comment, not a decision | MISMATCH | **decision** |
| C2.6-3 | `SPEC.md:974-977` (principle 2) + `:1006-1007` (edge case) | "A frictionless decline that ***immediately* re-asks the next person** beats a hard one that produces no-shows" · "**Bail** → seat reopens and re-asks next candidate **immediately** (§1.1)" | **Reversed by DEC-128 (#483), which says so in its own words.** `bail()` "no longer re-ask inline at all — they rest the seat `Open` and defer re-crewing to the tick … **The re-crew latency is operator-accepted**" (`DECISIONS.md:3707`). The shipped action agrees: *"the domain logs `shift_bailed`, clears the seat, and rests it `Open` — re-crewing is the tick's job now (#483), not an inline re-ask"* (`crew/shift/[shiftId]/actions.ts:10-15`). Three concrete consequences the spec's "immediately" hides: **pre-horizon** a bail is re-crewed **silently, never** (shift falls back to `Pending`, nobody asked — DEC-128 calls this "the fix"); **in-horizon** the next tick drips **one** candidate (DEC-063), not "the next person" now; inside `fillsBy` the urgent blast lands within ~15 min. DEC-019's index line already carries the amendment stamp (`:36`) — SPEC §2.6 does not | CODE-CONTRADICTS | doc-wrong |
| C2.6-4 | `SPEC.md:936-938` | "Design stance: **insultingly small.** … Every screen added is a place for bullshit to hide. **The crew member's entire world is three surfaces.**" | **Seven crew routes ship, and the home screen renders four navigation entries.** Routes: `/crew`, `/crew/shift/[shiftId]`, `/crew/open`, `/crew/calendar`, `/crew/threads` (+`/[threadId]`), `/crew/time-off`, `/crew/help`. Hub links on `crew/page.tsx`: **Messages** `:433-454` (§7.6, flag-gated), **Time off** `:459-469` (DEC-009/#332), **Calendar sync** `:473-483` (DEC-098), **Pick up a shift** `:487-497` (DEC-074), plus **How Muster works** `:567-573` in the footer. Each has a DEC; **none amends the surface count.** §2.7's block-quote (`:1025`) still frames self-serve as "a **fourth** crew surface … a knowing exception", which was true at DEC-074 and has been overtaken three times since. DEC-091 (`:2423-2427`) even ratifies `/crew` as "the single hub" of a spoke set without touching the number. Same stale claim in `BRAND.md:20` ("The crew member's whole world is three surfaces") — the doc shard G called the healthiest in the audit | MISMATCH | doc-wrong |
| C2.6-5 | AC-4 `:1016` + principle 1 `:971-973` | "Changing a shift's departure updates every assigned crew member's card and **pushes a ping**" · "**The card is authoritative and live.** Departure changes → card changes → crew gets a ping (§3.1)." | **Half met, and the failing half is already filed as #548 (open, `bug`).** The *card* half is structurally true — `buildShiftCard` re-reads `repo.getEvent` on every render (`shift-card.ts:227-251`), so a retimed event shows the new departure and a re-derived `callTime` immediately, no cache. The *ping* half is gated on **event-id set equality**: `!idSetEq(existing.eventIds.map(String), shift.eventIds.map(String))` (`form-shifts.ts:434-435`) → `changedCrew` → `formNoticeChanges` → `"changed"` notice (`form-notices.ts:38-44`). A Xola **retime that keeps its event id** changes neither set, so **nobody is told their call time moved**. This is not a suspicion: it is pinned by a characterization test whose own name states it — `form-shifts.test.ts:290` *"a retime that keeps the event id tells NOBODY (open question — see the comment)"*, with the DEC-029→DEC-043 identity history at `:277-288`. Issue **#548**, filed by shard C2.1, is the same defect reached from the import side; **AC-4 is its crew-facing consequence and #548 does not mention the AC** | CODE-CONTRADICTS | **known (#548)** |
| C2.6-6 | `credential-health.ts:39-41` (code comment) vs AC-7 `:1019` | comment: "Compare DATES, not instants … which is **exactly what the oracle's gate does** … The two must agree, and until the C2.1 audit they didn't … **Same rule, one boundary.**" | **The C2.1-10 fix (PR #549) narrowed the disagreement from a full day to a ~4-hour evening window; it did not close it, and the comment now asserts an agreement that still doesn't hold.** `healthOf` derives its reference day as `now.toISOString().slice(0,10)` — the **UTC** date (`credential-health.ts:41`). The oracle compares against `tripDate`, a **vessel-local** calendar date (`eligibility.ts:179`, `c.expiry >= tripDate`; trip dates are vessel-local by DEC-032/`Event.date`). Every *other* clock read in the crew app converts first — `crew-view.ts:152`, `const today = vesselDateOf(now, tz)`, with the reason spelled out at `:150-151` ("not the UTC date, which runs a day ahead in the evening Eastern hours"). **Failure window:** 20:00–23:59 ET on a credential's expiry date, UTC has rolled over, so `expiry < today` → the crew app renders "Your MMC **expired** Jul 26 — you won't be asked for shifts until it's renewed" (`crew/page.tsx:388-389`) while the oracle still passes that person for a Jul 26 trip. The same 4-hour skew shifts the 60-day `expiring_soon` boundary one day early. **Low consequence, wrong claim:** one `vesselDateOf(now, tz)` call at `:41`, but the function is shared with the §2.1 roster flag, so it is a §2.1 edit with a §2.6 symptom | CODE-CONTRADICTS | code-wrong (low) |
| C2.6-7 | `SPEC.md:986-987` (States to render) | "**Shift card** with all fields above, a **live-updated indicator when something changed since last viewed**, and the per-event manifest." | Not built, and the code says so rather than pretending otherwise: `shift-card.ts:8-9` — *"Deferred to follow-ups (not this card yet): bail action, credential nudge, the **'changed since last viewed' live indicator**"* (the first two have since shipped; the third hasn't). `page.tsx:31` repeats *"The live-changed indicator is a deferred follow-up."* Grep for `since last viewed|lastViewed|live-updated|changedSince` across `src/`+`app/`+`components/` returns **only those two docstrings** — no read-state, no last-viewed timestamp, no per-crew-member view ledger anywhere. Nothing in `DECISIONS.md` cuts it. The **operator** board has the analogous cue (`splitDaysChanged` → "changed in the last pull", C2.3 NOISE); the crew card has no equivalent. Note this is the *quiet* half of principle 1 — the loud half (the ping) is C2.6-5, and both halves of "the card is authoritative and live" are therefore incomplete | CODE-CONTRADICTS | **decision** |
| C2.6-8 | `SPEC.md:961`, `:967` | "Boat, **trip type**, pax count." · "**Notes.**" | **Neither field exists in the model, the schema, or any surface.** `Event` carries `id, vesselId, date, time, capacity, status, source, price?, dock?` and nothing else (`entities.ts:171-196`). `grep -niE '\bnotes\b|tripType|trip_type|productName|offering'` over `src/domain/entities.ts` + every `db/migrations/*.sql` returns **three comment lines and zero fields** (`0001_init.sql:3` "Design notes:", `0023:18` + `entities.ts:186`, both about the Offering price cascade). The only "notes" a crew member sees is messaging: `crew/help/page.tsx:112` — "**Messages** is where notes from the office land." The card's header line is `{viewerRole} · {paxTotal} guests` (`shift/[shiftId]/page.tsx:161`) — boat and pax, no trip type. Xola's product/offering name is not carried through `xola-client`'s event mapping either. **Escalate as a question, not a defect** (lesson 7): at a one-boat-four-hull fleet running one product, "trip type" may be a distinction without a difference, and per-shift notes may be deliberately routed to Messages by DEC-091's hub-and-spoke IA. But three spec'd card fields are two more than the section admits | CODE-CONTRADICTS | **decision** |
| C2.6-9 | `SPEC.md:1157-1159` (§3.5 — outside the range, reciprocal to `:965-966`) | "**This is explicitly temporary.** The day the crew-facing **manifest on the shift card** (§2.6.3) is live, crew stop needing Xola and this sheet retires. That manifest is the **hinge** that ends the split — which is why §2.6.3 says **pull it early**." | **The manifest is live and has been for phases; the sheet it was supposed to retire was never built.** Manifest: `buildShiftManifest` (`shift-card.ts:212-267`) → `ShiftManifest` mounted at `shift/[shiftId]/page.tsx:255`, per-event, booked-only, pax-totalled, tested five ways (`shift-card.test.ts:99,152,169,187,194`). The sheet: `grep -rln 'xola-sheet|guide sheet|enter these in Xola|weekend sheet'` over `src/`+`app/` returns **nothing**. So §3.5's "In scope for 2026: Muster generating that sheet" is unbuilt, and its retirement trigger has already fired. §2.6.3's "pull it early" (`:966`) is spent advice — the pull happened. Neither sentence has been updated | MISMATCH | doc-wrong |
| C2.6-10 | `SPEC.md:951-952` | "a short list of **confirmed upcoming** shifts, one card each, past stuff hidden" | Shipped list is **Confirmed *or* Claimed**: `held = allSeats.filter(s => (s.state === "Confirmed" \|\| s.state === "Claimed") && …)` (`crew-view.ts:189-193`), with the reason at `:69-72` — *"#4: a fresh 'In' lands visibly in My shifts instead of vanishing into nothing"* — surfaced as a non-link row badged **"Awaiting confirmation"** (`crew/page.tsx:526-537`), pinned by `crew-view.test.ts:175`. A deliberate improvement over the spec'd behavior, and the *"past stuff hidden"* half is exactly right (`crew-view.ts:197`, `shift.date < today` with a **vessel-local** `today`). One-word doc drift on a correct design | MISMATCH (partial) | doc-wrong |
| C2.6-11 | `SPEC.md:963-965` | "Each shows **name + count/phone**; **waivers are not shown**" | Understates a shipped capability by two features. The manifest row also carries a **guest Text button** that deep-links to Messages with a composed intro body (`shift-manifest.tsx:6,113-116` → `buildIntroText`, `src/crewapp/intro-text.ts`, #345 Part A) and a **guest-contact ledger** — "✓ Texted by {firstName} · {time}" (`shift-manifest.tsx:97`), fed by `repo.listGuestContactsForShift` (`shift-card.ts:219-224`, #345 Part B, pinned by `shift-card.test.ts:169`). So a crew member can text a guest *from the card* and see who already did. The waiver half is **correct and structural** — see NOISE. Doc-behind-code, not drift: nothing here contradicts the spec, it just isn't in it | MISMATCH | doc-wrong |
| C2.6-12 | `SPEC.md:958-959` + `.claude/ui-context.md:42` | "**Call time, distinct from departure time** — crew need when to *show up* … Show both, **labeled clearly**." | The constraint is **met** (see AC-2) but the shipped labels use different words than every doc: the card renders **"Shift Start"** / **"First departure"** / **"Shift End · off the clock"** (`shift/[shiftId]/page.tsx:170,179,189`), while the spec, `ui-context.md:42` ("**Call time** vs departure time"), the view model (`ShiftCardView.callTime`, `shift-card.ts:69`) and DEC-041's whole vocabulary say **call time**. The crew hear "call time" on the dock — the term the doc calls "the #1 source of dock confusion" is the one word the UI doesn't use. Low stakes, but the binding spec constraint is stated in vocabulary the surface doesn't share, which makes the constraint hard to *check* on the rendered page | MISMATCH | doc-wrong (or a one-word UI change) |
| C2.6-13 | `shift-card.ts:114-121` vs `calendar-feed.ts:93-96` | §2.6.3 "single source of truth" applied to the two shipped renderings of the same window | Two independent implementations of the DEC-041 window, and **they agree on arithmetic but not across midnight.** The card/ask/claimable path is `committedWindow` — `"HH:mm"` string math that **wraps mod 1440** (`plusMinutes`, `:117-121`); the calendar feed is real instants via `earliestScheduledStart − CALL_LEAD` and `shiftEndFromEvents` (`derive.ts:448-457`), same `TRIP_DURATION_MINUTES + TEARDOWN_MINUTES` constants. For a shift whose end rolls past midnight, the card shows a bare wrapped clock (e.g. `00:45`) with **no day indicator**, while the subscribed calendar shows the true next-day instant. DEC-129 names the wrap deliberately — *"an `"HH:mm"` display helper that wraps within a day and loses the date — deliberately **not** reused"* (`DECISIONS.md:3722`) — so this is a known property, but its *display* consequence is not covered by any DEC and no test pins a past-midnight card. Unreachable at BrewBoat's daytime schedule today | CODE-CONTRADICTS (low) | code-wrong (low) |

---

## Per-acceptance-criterion verdicts

The seven `- [ ]` boxes at `SPEC.md:1011–1019`, ticked against source for the first time.

### AC-1 — "An ask is fully answerable (in/out) from the push/SMS without opening or logging into the app." — **NOT MET (on the "without opening" clause), by accepted design**
See C2.6-1. **The "without logging in" half is fully met and well-built:** the relay link is a magic
link minted at enqueue with a 24h TTL, prefetch-safe (`/crew/auth` GET peeks, POST consumes —
DEC-030 §2/§4), landing the crew member authenticated on the In/Out screen. No password, no code
entry on that path (DEC-081's 6-digit code is the *self-initiated* door only, `SPEC.md:1101-1105`).
**The "without opening" half has no implementation and no path to one:** there is no inbound SMS
webhook route, no keyword parser, and `twilio-channel.ts:134` states "No inbound SMS parsing" as a
property of the design, not a TODO. Answering is `crew/page.tsx:616-632` — a two-button form on the
opened app (`respondToAsk`, DEC-089 per-button spinner, no-JS-safe).
*Implementing function:* `forwardAsks` → `WebLinkChannel.send` / `TwilioChannel.send` → `/crew/auth`
→ `respondToAsk` → `recordResponseAndConfirm`. *Tests that pin the shipped behavior:*
`forward-asks.test.ts`, `web-link-channel.test.ts`, `twilio-channel.test.ts` (all exercise the
link-bearing body; none asserts an inbound reply, because there is none).
*What makes this a decision rather than a defect:* the shipped model is **two taps** (open the text,
tap the link, tap In) against the spec's **one**, and the spec's own success test — "if accepting is
harder than replying to a text, it has already failed" — is a judgment call the operator has to make
against a real pilot. Inbound Twilio parsing is buildable (a webhook route + `recordReply`, and
REQ-CLAIM-1 `:1086-1096` already specifies that every adapter funnels into one inbound path), so
this is "not chosen yet", not "not possible".

### AC-2 — "The shift card shows call time and departure time as distinct, labeled fields." — **MET**
`buildShiftCard` returns `callTime` (derived: earliest **scheduled** departure − `CALL_LEAD_MINUTES`,
`shift-card.ts:303-305` via `committedWindow`) alongside the per-event `departureTime` verbatim from
`Event.time` (`:244-250`). The card renders them as **two side-by-side tiles** with distinct
treatment — the call tile in `ok` tokens, the departure tile in neutral `line`/`card` — each with its
own uppercase label and a mono 2xl figure (`shift/[shiftId]/page.tsx:167-183`), plus a third
full-width **Shift End** tile (`:187-194`, DEC-041/#275). The comment above it names the invariant:
*"The load-bearing distinction: shift start (call/report time, = first departure − the lead) vs the
first departure itself, distinct + labeled."* Satisfies `.claude/ui-context.md:42` verbatim.
*Tests:* `shift-card.test.ts:72` *"call time = earliest departure minus the flat lead"*, `:81`
*"shift end = latest departure + trip length + teardown (DEC-041, #275)"*, `:87` *"a cancelled later
trip moves neither the window's start nor end (DEC-041)"*.
*Caveat, not a defect:* the label vocabulary drifts from the spec's ("Shift Start", not "Call time" —
C2.6-12), and the same window computed two ways disagrees past midnight (C2.6-13).

### AC-3 — "The shift card shows the manifest grouped per event (separate 1/3/5pm lists), name + count, no waiver field." — **MET, and the waiver half is structural rather than merely obeyed**
`buildShiftManifest` walks `shift.eventIds`, filters reservations to `status === "booked"`, and emits
one `EventManifestView` per event — `{eventId, departureTime, dock?, pax, guests[]}` — sorted by
departure (`shift-card.ts:212-267`). `ShiftManifest` renders one collapsible group per event with its
own departure, pax and guest rows (`shift-manifest.tsx:19-120`, header comment: "different guests each
trip"), mounted at `shift/[shiftId]/page.tsx:255`. Each guest row is `{name, party, phone?}`.
**No waiver field exists to be shown:** `Reservation` has none — `entities.ts:228` is the literal
comment `// No waiver field — DEC-012.` — so the criterion is met at the type level, not by a render
choice. Restated in three more places (`shift-card.ts:29,199`, `shift-cockpit.tsx:120`).
*Tests:* `shift-card.test.ts:99` *"manifest is per-event, soonest first, booked-only with pax"*,
`:152` *"assembles booked guests per event, sorted, pax totalled, cancelled excluded"*.
*Dependency that could hollow this:* the manifest is only as good as what Xola's pull carries — but
that is §2.2's surface, and `Reservation.customerName`/`partySize`/`phone` are populated on the live
import path. *Beyond the AC:* the card also ships guest texting + a contact ledger (C2.6-11).

### AC-4 — "Changing a shift's departure updates every assigned crew member's card and pushes a ping." — **PARTIALLY MET (card yes; ping only when the event-id *set* changes)**
**Card half, MET and structurally so.** Nothing is cached: `buildShiftCard` re-reads every event per
render and re-derives `callTime`/`shiftEndTime` from the live `Event.time` values
(`shift-card.ts:227-251, 303-305`). A retime therefore shows correctly the next time the crew member
opens the card.
**Ping half, NOT MET for the exact case the criterion names.** `changedCrew` — the only producer of
the "your shift changed" notice — fires on `!idSetEq(existing.eventIds, shift.eventIds)`
(`form-shifts.ts:433-442`), i.e. a **trip added or removed**, never a trip *retimed in place*. The
docstring at `:75-79` describes the intent correctly ("their committed day moved (call time / trips /
manifest)") and the guard does not implement it. Filed as **#548** (open, `bug`) and pinned by a
characterization test that states the gap in its own name: `form-shifts.test.ts:290` *"a retime that
keeps the event id tells NOBODY"*, with the DEC-029 → DEC-043 identity history at `:277-288`.
*Tests for what does work:* `form-notices.test.ts:60` *"maps changedCrew → changed, excluding the
operator (#350)"*, `:44` (operator exclusion, DEC-072/084), `:75` (diff-gated: no set change → no entry).
*The dependency that makes even the working half conditional:* the relay is opt-in per command —
`formShifts(repo, {notifyTripChanges})` (`form-shifts.ts:91`) — so a caller that omits the flag
suppresses the notice entirely. And per **#548**'s own framing, whether the gap is *reachable*
depends on whether Xola retimes an occurrence in place or cancels-and-recreates, which this repo
cannot answer. **The AC is the crew-facing statement of #548 and #548 does not cite it.**
*Also incomplete:* the quiet half of principle 1, the "changed since last viewed" indicator (C2.6-7).

### AC-5 — "Bailing reopens the seat and re-asks the next candidate with no operator action." — **PARTIALLY MET (reopens ✓, no operator action ✓, "re-asks the next candidate" is now tick-deferred and sometimes never)**
**Reopen, MET.** `bailFromSeat` (`crew/shift/[shiftId]/actions.ts:26-60`) gates on the session subject
BEING the confirmed occupant (mirrors `respondToAsk` — no bailing someone else by forging ids), then
calls `bailWithDerivedLateness`, which logs `shift_bailed` with server-derived lateness (DEC-028 —
never client-supplied), drops the occupant, clears provenance (#196), rests the seat **`Open`**, and
refreshes shift state horizon-aware via `refreshShiftStateHorizon` (DEC-128, `DECISIONS.md:3707-3709`).
**No operator action, MET.** The whole path is crew-initiated; the operator is never in it.
**"Re-asks the next candidate", NOT as written.** DEC-128 deleted the inline re-ask: pre-horizon the
shift falls back to `Pending` and **nobody is asked at all** until the horizon (DEC-128 calls this
"the fix" — the bug was a bail weeks out texting the entire role pool); in-horizon the next tick
drips **one** candidate (DEC-063); inside `fillsBy` the tick blasts within ~15 min. Two further
accepted regressions are listed in the DEC itself (`:3714-3715`): a bail during a DEC-054 engine pause
doesn't re-crew until resume, and the board `regression` re-ping is gone for new bails.
**Frictionless, MET in the spirit principle 2 asks for and *deliberately* not frictionless in one
respect:** the bail sits behind a two-step disclosure — a `<details>` "I can't make it…" then a nested
confirm "Drop this shift" → "Yes, drop this shift" (`shift/[shiftId]/page.tsx:269-302`, #271) — but the
copy is neutral, not a guilt-trip, and turns *firmer* only when `bailLate` (`shift-card.ts:307-310`,
DEC-028), which is the spec's own "lateness is the signal" reading. A **trainee ride has no bail at
all** (DEC-087, `:263-267`) — correct, and a case §2.6 doesn't contemplate.
*Tests:* `shift-card.test.ts:125,131,138` (the three `bailLate` boundaries incl. the event-less shift).

### AC-6 — "A crew member sees only their own standing and reasons — never a ranking against other crew." — **MET, and defended by a test written for exactly this criterion**
`summarizeStanding` (`standing.ts:56-133`) is a pure fold over the crew member's **own** windowed
reliability events into self-ratios — "answered fast · showed 8/8 · one late bail". No other crew
member's data enters the function; `crew-view.ts:258-261` feeds it only
`repo.reliabilityEventsFor(crewMemberId)`. Derived **live from the log, not the stored
`reliabilityScore` field** (DEC-008/§1.4), and no numeric score, rank, percentile or grade is exposed
to the surface at all — `CrewStandingView` is `{hasHistory, line, reasons[]}`. Cold start reads
"New — no track record yet" (`:63`), never a low. The render is deliberately quiet: muted text, and
the comment forbids coloring it — *"do NOT color the negative facts; that would turn a neutral fact
into the anxiety dashboard BRAND forbids"* (`crew/page.tsx:419-427`).
*Tests, including one that is literally this AC:* `standing.test.ts:150` ***"never uses leaderboard /
grade / scolding language"***, plus `:39` (cold start neutral), `:76` *"declining is not held against
standing"* (DEC-124), `:116` *"missed asks are stated as a neutral fact"*, `:121` (stepping up is a
positive reason), `:142` (history with no notable signal still reads neutral, never blank).

### AC-7 — "A credential nearing expiry triggers a crew-facing nudge before the person drops from the pool." — **MET, with a ~4-hour-per-day boundary skew (C2.6-6)**
`buildCrewAppView` calls `worstCredential(await repo.listCredentialsForCrew(crewMemberId), now)`
(`crew-view.ts:265-268`) — the **same** function, **same** `EXPIRING_SOON_DAYS = 60` constant, and
**same** `healthOf` boundary as the §2.1 roster flag (`credential-health.ts:21,88-106`). **There is no
third variant** — the brief's specific question: `grep` for `EXPIRING_SOON_DAYS`/`worstCredential`
finds one definition and two readers (roster, crew app). Renders as `CredentialLine`
(`crew/page.tsx:384-396`), warn tokens only, individual voice, with distinct expired vs expiring copy
that names the credential and the date, and tells the crew member what happens next ("you won't be
asked for shifts until it's renewed"). 60 days is comfortably "before the person drops" against the
oracle's hard gate (`eligibility.ts:172-186`, `mmcValidOnDate`).
*Tests:* `crew-view.test.ts:244` *"credentialNudge names the expiring credential — **same 60d window as
the roster flag** (#57)"*, `:260` (expired flags expired), `:231` (healthy → null → no line, no noise).
*The nuance that keeps this from being a clean MET:* the C2.1-10 fix shipped in PR #549 moved
`healthOf` from an instant compare to a **UTC-date** compare, while the oracle's gate compares against
a **vessel-local** trip date and the rest of `crew-view.ts` converts via `vesselDateOf` (`:152`). The
two still disagree for the ~4 evening-ET hours after UTC midnight on the expiry day, and the code
comment at `:39-41` asserts they agree ("Same rule, one boundary"). Narrow, but it is the *same
class* of bug the C2.1 fix was written to close.

---

## What this shard would recommend

**§2.6 has never had a reconciliation pass, and it is the only §2.x section swept so far that
hasn't.** §2.2 and §2.3 both carry `⚠️ Reconciled` block-quote headers; §2.6 reads exactly as written
in 2026-05, while **five accepted DECs have moved the ground under it**: DEC-030 (the ask is a
tap-a-link, not a reply-to-text — C2.6-1), DEC-128 (bail defers re-crewing to the tick — C2.6-3),
DEC-074 + DEC-098 + DEC-009/#332 + §7 messaging (the "three surfaces" are seven — C2.6-4), and
DEC-041/#419 (the committed window, which the section never mentions and which is now the crew's
actual contract). The section is not *wrong* about what the product is for; it is out of date about
what it does. **The cheapest high-value fix is a banner** in the §2.2/§2.3 house style, naming those
five and striking the four clauses they superseded. That is a doc edit with a DEC to cite per line
and zero judgment required — except for C2.6-1, below.

**One operator decision, and it is the shard's headline (C2.6-1 / AC-1).** *Is "open the text, tap the
link, tap In" the ask, or is inbound SMS reply parsing still wanted?* §2.6.1 states the success test
itself — "if accepting is harder than replying to a text, it has already failed (the Xola lesson)" —
and the shipped flow is two taps and an app load against the spec's one tap in the messages thread.
DEC-030 chose this knowingly for the pilot and DEC-MSG-1 always framed Twilio as "the eventual
production adapter", but **nothing anywhere records whether the *inbound* half was deferred or
dropped.** The machinery to close it is specified and half-built: REQ-CLAIM-1 (`SPEC.md:1086-1096`)
already mandates that every adapter funnel into one inbound `recordReply` in the domain, so the
missing piece is a webhook route and a keyword parser, not a design. **Ask before filing** (lesson 7).
Three coherent answers: (a) *"the link is the ask"* → strike "without opening anything" and "no
navigate-to-respond" from `:941`/`:945`, retitle AC-1 to "answerable in two taps with no login", and
fix §3.1 `:1067` to match; (b) *"inbound Y/N is still wanted"* → file it as a task and leave the AC
unticked, which is honest; (c) *"native push with action buttons"* → that is DEC-MSG-2, still parked.
**Do not close this by quietly editing the AC** — the "3 seconds, two buttons" claim is the product's
founding comparison against Xola, and rewording it is a positioning decision, not a doc tidy.

**Two more decisions, both small (C2.6-2, C2.6-7, C2.6-8).** The SMS body drops the call→back window
that the in-app card shows and the spec's example includes — a real cross-surface disagreement under
§2.6.3's own invariant, with a real constraint behind it (1-segment GSM-7 at 160 chars) that no DEC
records. Adding `call 12:30-18:00` costs ~16 GSM-7 characters against a body currently around 55;
it fits, and it is the single most useful fact for an In/Out decision. Separately: the "changed since
last viewed" indicator (C2.6-7) is named as deferred in two docstrings and cut by nothing — decide it
or strike it. And "trip type" + "Notes" (C2.6-8) are two card fields with no field, no column and no
UI: at one product on one fleet they may be genuinely unnecessary, which is a one-sentence operator
answer, not a build.

**Four doc-only edits with a DEC or a `file:line` to cite (C2.6-3, -4, -9, -10).** "Immediately
re-asks the next person" is reversed by DEC-128 in DEC-128's own words; "three surfaces" is off by
four and stale in `BRAND.md:20` too; §3.5's "the day the manifest is live, this sheet retires" has
had its trigger fire (the manifest shipped; the sheet never existed); "confirmed upcoming" understates
a deliberate #4 improvement by one word. None needs a judgment call.

**One low code item and one one-word UI question (C2.6-6, C2.6-12).** `healthOf` should take the
vessel-local date — one `vesselDateOf(now, tz)` at `credential-health.ts:41`, in a function shared
with §2.1, closing the last ~4 hours of the C2.1-10 skew and making its own comment true again.
Separately, the card says "Shift Start" where every doc, the view model and DEC-041 say "call time";
if the operator's crew say "call time" on the dock, the label should too.

---

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| "**Magic-link auth, no passwords** (§3.2) — casual crew won't manage credentials" | `SPEC.md:947-948` | Shipped and refined, not contradicted. Relay links are magic links (DEC-030, 24h TTL, single-use, prefetch-safe); self-initiated sign-in is DEC-081's 6-digit emailed code (`crew/page.tsx:310-381`, two-step with an httpOnly email cookie, no-enumeration copy at `:348-350`). §3.2 `:1101-1105` already states the DEC-081 refinement correctly — **§2.6.1 does not need to**, since "no passwords" remains true of both doors |
| "**Empty state** (no upcoming shifts) is normal, not an error" | `SPEC.md:953` | Exactly the shipped copy: "Nothing booked right now — that's normal. You'll get a ping when there's a trip for you." (`crew/page.tsx:516-520`), rendered as a `Notice`, no error tone, no empty-state illustration or CTA |
| "**Dock as a tappable map pin**, not a copy-paste address" | `SPEC.md:960` | `DockPin` → `https://maps.google.com/?q=<encoded>` in a 44px-min tap target (`shift/[shiftId]/page.tsx:41,122-136,198`). `Event.dock` is **per-event, not per-vessel** — `entities.ts:189-195` gives the reason ("the same boat can leave different docks on different events") — and the view model promotes it to a single prominent `sharedDock` only when every event agrees (`shift-card.ts:254-259`), else the per-event pins stand. Tested at `shift-card.test.ts:112,187,194` |
| "**Who else is crewing, with one-tap contact** — kills 'I'm running late, who do I call'" | `SPEC.md:962` | `coCrew` carries `{crewMemberId, name, phone, role}` for every other **Confirmed** seat, viewer excluded (`shift-card.ts:316-328`), rendered with a DEC-086 role glyph and three buttons — Call (`tel:`), Text (`sms:`), and the in-app Message DM (flag-gated, #389) — each 44px (`shift/[shiftId]/page.tsx:200-253`). Test `shift-card.test.ts:120`. The role resolution is memoized per call (`roleResolver`, `:182-191`) so co-crew lookups don't re-hit the port per member |
| "**'Seat already filled'** acknowledgement (a contested yes that lost — first-yes-wins)" | `SPEC.md:990` | Built, and split into **three** distinct outcomes rather than one, because conflating them was a real bug: `answeredNoticeCode` maps a non-claiming accept to `filled` (lost CAS race), `booked` (already on another seat that day, DEC-003) or `already` (a re-tap of a settled ask, #145) — `answered-code.ts:13-27`, five tests at `answered-code.test.ts:5-33`. Copy at `crew/page.tsx:26-33`: "That seat was already filled — nothing more needed from you." Calm, no error state, as the edge case at `:1004-1005` requires |
| Edge case: "**Magic link** expired/reused → graceful re-request, not a dead end (§3.2)" | `SPEC.md:1009` | `SignedOut` branches on the reason: flag-off → "That link didn't work — it may have expired or already been used. Ask your operator for a fresh one." (`crew/page.tsx:230-241`); flag-on → straight into the code-login door, with `err === "expired"` / `"locked"` each getting their own re-request notice (`:314-319`). No dead end on either path |
| "Reads the crew member's **own reliability standing** (§1.4) and **credential expiries** (§2.1)" (Data read) | `SPEC.md:1001` | Both, through the port, in one assembly: `repo.reliabilityEventsFor` → `summarizeStanding` and `repo.listCredentialsForCrew` → `worstCredential` (`crew-view.ts:258-268`). Standing is derived live from the log, **never** the stored `reliabilityScore` field — DEC-008/§1.4, pinned by `crew-view.test.ts:218` *"standing is derived live from the reliability log, not a stored field"* |
| "Shift card reads **shift/seat state** (§1.1), the **manifest** … (§2.2), and **co-crew contact** from the roster (§2.1)" (Data read) | `SPEC.md:999-1000` | All three, and the manifest assembly is **shared with the operator cockpit** rather than duplicated — `buildShiftManifest` is documented as "Shared by the crew shift card … and the operator cockpit (#319), so both read ONE assembly, never a parallel query" (`shift-card.ts:193-200`), consumed by `shift-cockpit.tsx` and `crew/shift/[shiftId]/page.tsx` alike. That is the §2.6.3 invariant working as intended |
| The **committed window is one computation**, not three (the brief's call-vs-departure cross-check) | §2.6.3 invariant | **Verified across four surfaces.** `committedWindow` (`shift-card.ts:132-151`) is documented as "THE committed-window computation (DEC-041) — one home, shared by the shift card, the crew-view ask card, and the /crew/open claimable view so all three agree", and all three import it: `shift-card.ts:303`, `crew-view.ts:130` (via `committedWindowFor`), `claimable-view.ts:69`. The fourth (the ICS feed) uses instant math with the **same constants** (`calendar-feed.ts:93-96` + `derive.ts:448-457`: `CALL_LEAD_MINUTES` / `TRIP_DURATION_MINUTES + TEARDOWN_MINUTES`). #419 is the record of an earlier disagreement being closed — the ask card "used to return the raw earliest DEPARTURE as the start while pairing it with the teardown-inclusive end — a mismatched window" (`crew-view.ts:114-117`). **The only residual divergence is the past-midnight wrap (C2.6-13).** Payroll reuses the same boundaries via `committedMinutes` (`shift-card.ts:163-172`, #347) |
| **Timezone: crew-facing renders honor `TENANT_TIMEZONE`, with one exception** | brief item 3 | `TENANT_TIMEZONE` (env `TENANT_TZ`, default `America/New_York`) governs the vessel-local interpretation of stored wall-clock times (DEC-032, `tenant.ts:8-24`). Crew paths convert correctly: `vesselDateOf(now, tz)` bounds "upcoming" (`crew-view.ts:150-152`, with the evening-Eastern hazard named in the comment) and the calendar feed's retention floor (`calendar-feed.ts:74`); `zonedWallClockToInstant` via `eventStart` anchors every horizon/bail instant (`derive.ts:240-242`); `bailLatenessMs(earliestScheduledStart(rawEvents, TENANT_TIMEZONE), now)` (`shift-card.ts:310`). Date **labels** are deliberately parsed and formatted in UTC so a stored vessel-local date renders verbatim regardless of server zone — `crew/page.tsx:160-169`, `shift/[shiftId]/page.tsx:43-52`, `forward-asks.ts:30-38`, each with the DEC-032 reason in a comment. **The one bypass is `credential-health.ts:41`** (C2.6-6) |
| "Past stuff hidden" and the phantom guards | `SPEC.md:952` | `shift.date < today` with a vessel-local `today` (`crew-view.ts:197`), plus the **#415 family** of guards that §2.6 never contemplated: a live ask whose shift was Cancelled since it went out is dropped (`:171`), and a Confirmed/Claimed seat orphaned on a Cancelled/Completed shift is dropped from My shifts (`:202`) — a Xola re-import can Cancel a shift without vacating the seat (DEC-084). The comment at `:198-201` names all four surfaces that need the same guard (here, the calendar feed, the thread list, the availability scan) and all four carry it. Tested at `crew-view.test.ts:150`, `calendar-feed.test.ts:102` |
| "**Bail action + confirmation**" (States to render) | `SPEC.md:988` | Both halves shipped, and the confirmation is a *deliberate* second step (#271) rather than the accidental friction principle 2 warns about — see AC-5. The success path redirects to `/crew` (the card is no longer theirs) with a shift-id param resolved to calm copy, guarded so a crafted `?bailed=<foreign-shift>` renders nothing (`crew/page.tsx:116-121`, DEC-026 codes/ids only) |
| The **`addedByOperator` / "Added for you"** badge | not in §2.6 | Shipped and *additive* to the spec, not contradicting it: a Confirmed seat the holder never opted into is badged so a force-placed shift isn't a silent surprise (#161/#196). Provenance-based (`seat.acquiredVia === "operator"`) with a documented legacy fallback for pre-#196 rows (`crew-view.ts:205-216`), rendered at `crew/page.tsx:551-555`. Three tests: `crew-view.test.ts:89,97,115` |
| "**The app watches their credentials for them.** Quietly nudge … *before* it drops them from the eligible pool" (principle 3) | `SPEC.md:978-981` | See AC-7 — met, one function, one constant, two readers, tested. "Quietly" is honored: warn tokens, muted, one line, and **null when there is nothing to say** so the common case renders nothing at all (`crew-view.ts:92-97`, `crew/page.tsx:502`) |
| "the day-cohort message thread hangs off this card (**parked, §4**)" | `SPEC.md:968` | Correctly marked *(Later)* and correctly parked **as stated** — the thread does not hang off the shift card. What shipped instead is the §7 messaging hub at `/crew/threads` with a per-co-crew DM button on the card (`shift/[shiftId]/page.tsx:238-248`, flag-gated #389). Different feature, different DEC family (DEC-052/073); the §2.6.3 parenthetical is not falsified by it. (The *surface count* it adds to is C2.6-4) |
| "one card each" / My-shifts row content | `SPEC.md:951` | Richer than spec'd and coherently so (#216): date + committed window in mono, then one quiet line of vessel-hue dot (DEC-086, `aria-hidden`) + vessel · role · co-crew, truncated as "with Jamie & Sam" / "with Jamie +2" (`crew/page.tsx:180-213`). Co-crew is name-sorted for stable ordering (`crew-view.ts:237-240`, a code-review fix against display flicker). Test `crew-view.test.ts:186` |
| The calendar feed's **PII boundary** | not in §2.6 | Checked because it is a crew-facing rendering of shift facts: the ICS carries co-crew **first names only, no phones, no manifest** (`calendar-feed.ts:98-114`, DEC-098 PII boundary), Confirmed seats only (a tentative Claimed isn't a calendar commitment), with supernumerary rides flagged `training`. So the feed showing *less* than the card is deliberate, not a "single source of truth" violation. Tests: `calendar-feed.test.ts:96,102,121` |

---

## Coverage — what this shard did and did not read

- **Read in full:** `SPEC.md:933–1022`; `src/crewapp/shift-card.ts`, `crew-view.ts`, `standing.ts`,
  `answered-code.ts`; `src/adapters/forward-asks.ts`, `sms-deep-link.ts`; `src/builder/form-notices.ts`;
  `src/admin/credential-health.ts`; `app/(crew)/crew/page.tsx`, `app/(crew)/crew/shift/[shiftId]/page.tsx`;
  DEC-030, DEC-074, DEC-128, DEC-129 in full.
- **Read in part / targeted:** `calendar-feed.ts:60–190`, `claimable-view.ts` + `other-shifts.ts` +
  `intro-text.ts` (headers + the window/time paths), `twilio-channel.ts:100–160`,
  `web-link-channel.ts:1–40`, `app/lib/channel.ts:1–60`, `crew/shift/[shiftId]/actions.ts:1–60`,
  `form-shifts.ts:75–150, 430–447`, `derive.ts:240–276, 448–457`, `eligibility.ts:172–277`,
  `tenant.ts:1–60`, `entities.ts:171–230`, `shift-manifest.tsx` (grep-targeted),
  `SPEC.md:1062–1109, 1150–1160`, `DECISIONS.md` DEC-009/012/019/028/041/063/081/084/087/091/098/130.
- **Test-name-verified, not read line by line:** the full `it(...)` inventory of all 8
  `src/crewapp/*.test.ts` (~70 names) plus `form-notices.test.ts` and `form-shifts.test.ts:277–290`.
  Assertions were not read; every "tested at" citation names the test whose *name* states the behavior.
- **Not read:** `thread-list.ts` / `thread-view.ts` bodies (§7 messaging — evidence for the
  surface-count row only, via the routes and the hub link), `ask-loop.ts` beyond its bail/vacate
  contract (DEC-128 is the authority for what it no longer does), `crew/threads/`, `crew/time-off/`,
  `crew/calendar/`, `crew/help/` page bodies (route existence + hub links were what §2.6's claims
  needed), `crew/open/page.tsx` (that is **§2.7's** subject, deliberately left for C2.7),
  `app/api/calendar/[token]/route.ts`, the crew mockups in `docs/design/`, and the
  `feature/reservations` tree (§2.6 confirmed byte-identical — see the which-tree check).
- **Deliberately out of scope:** the `/crew/open` claimable list and its claim path — §2.7. Where
  `claimable-view.ts` is cited here it is only as the third consumer of `committedWindow`.
- **Coverage is complete for the stated range.** Every `- [ ]` is verdicted, every bullet under
  §2.6.1/2.6.2/2.6.3, the three principles, States to render, Actions, Data read and all four Edge
  cases are accounted for in either Findings or NOISE. No block of the subject went unread.

## Cost

**~110k subagent tokens** — between C2.3's ~95k and the 150k budget, and the reason is that §2.6's
surface is not one screen but **seven routes plus a channel adapter chain**. The C2.3 prediction held
in shape (a shipped surface is cheap to verify) but §2.6 required following the ask *out* of the app
— `forwardAsks` → `WebLinkChannel`/`TwilioChannel` → magic link → `/crew/auth` → `respondToAsk` — to
settle AC-1, which is where a third of the budget went. **The transferable note for C2.4/C2.5/C2.7:**
cost tracks the number of *distinct surfaces a claim spans*, not the section's line count nor the
existence of a route. A claim about one page is cheap; a claim about "the same fact shown in four
places" (which is what a "single source of truth" section is made of) costs one read per place. No
speculative whole-tree zero-caller sweep was run, per the brief; the **per-citation** component greps
(lesson 12) cost seven greps total and confirmed all seven cited components are mounted.
