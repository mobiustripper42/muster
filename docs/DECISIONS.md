# Muster — Decisions

Architectural decisions, each with an ID (DEC-NNN). DEC-001 through DEC-012 are **extracted from
the locked spec** (`docs/SPEC.md` v1.0) — the forks it already resolved, captured here as decisions
so the *why* survives. DEC-013 and DEC-014 were made during project setup (2026-06-03). Open
questions live at the bottom as DEC-TBD.

> The spec is the contract. Where a decision below compresses spec reasoning, the spec section is
> cited — read it for the full argument.

---

## DEC-001: Policy/mechanism split
**Decision:** The rules (USCG manning, credentials, turnaround, seasons) are **tenant-owned data**;
the engine that evaluates them is **generic**. Muster is built perfect for one niche (BrewBoat) on
top of a tenant-agnostic mechanism.
**Why:** It is what lets Muster be hard-tuned for the first tenant and still be sellable later
without a fork. The spine of the whole product (SPEC §0.1, §1.3).
**Tradeoff:** Every rule must be expressed as data + a generic evaluator, never as a hardcoded
`if`. More upfront discipline than a bespoke BrewBoat app.
**Revisit if:** Never for v1 — this is the foundational bet.

## DEC-002: The availability oracle is a synchronous rule engine
**Decision:** One authoritative function answers "can this trip run — yes/no, and if no, why?" It
is a **rule engine** (synchronous "may I?" evaluator), explicitly **not** an event engine. Every
rule reads a slice of state and returns `{ passed, severity, reason, ruleId }`. `severity` is
`hard` (blocks) or `soft` (warns). `reason` is a **structured payload, not a sentence**. Two
evaluation modes share one code path: `first-fail` (booking flow) and `collect-all` (admin
reschedule). Verdict vocabulary is **pass / fail / deferred** — never pass/fail/maybe.
**Why:** Admin views need structured failure detail (per-candidate reasons); a single evaluator
with a mode flag avoids two divergent code paths (SPEC §1.3).
**Tradeoff:** Callers must supply the mode and interpret structured reasons rather than reading a
prose string.
**Revisit if:** A rule genuinely needs async/external I/O mid-evaluation (none in v1).

## DEC-003: Crew rules collapse into one composite satisfiability rule
**Decision:** Crew rules are **not** independent booleans. Evaluated separately they lie (Captain A
is free but lapsed; Captain B is current but booked — every rule passes about a *different* person).
The crew cluster is **one composite rule** solving a satisfiability problem over a shared human
pool: *is there an assignment of real people to every required seat such that each is simultaneously
available, not double-booked, and credential-valid on the trip date?* Returns a valid assignment or
per-candidate failure reasons. Property rules stay clean independent booleans.
**Why:** The single most important architectural point in the spec (SPEC §1.3). The naive
independent-boolean shape returns false yeses.
**Tradeoff:** A small constraint solve (greedy-by-score to start) instead of a boolean AND.
**Revisit if:** Never — getting this wrong is the core failure mode.

## DEC-004: Two horizons; `deferred` is first-class
**Decision:** Each rule has a horizon. **Booking horizon** rules (property: vessel, COI, pax, season)
gate the sale far out. **Staffing horizon** rules (crew) vote N days before the trip when humans get
committed. A rule outside its horizon **abstains** (`deferred`), making a booking *provisional* and
feeding the admin worklist. The full crew solve runs **only inside the staffing horizon**; outside
it the crew group does at most a cheap "could this ever plausibly be crewed" check. **Model the
staffing horizon as a list-of-one, not a scalar** (room for staged checkpoints — DEC-TBD / Pass D).
**Why:** Crew availability isn't knowable months out; forcing it to vote early produces noise
(SPEC §1.3).
**Tradeoff:** Bookings carry a provisional state and a `recheckBy` date.
**Revisit if:** Progressive commitment (Pass D) generalizes the single horizon to ordered checkpoints.

## DEC-005: Shift state is derived from seat state; reserve a `Held` tier
**Decision:** Two nested machines. Model the **seat** machine (`Open → Asked → Claimed → Confirmed`,
plus `Bailed`) and **derive** the shift state (`Pending / Filling / Crewed / At-Risk / Completed /
Cancelled`) from its seats. Required seats gate `Crewed`; supernumerary seats do not.
**Reserve room for a `Held` seat tier between `Claimed` and `Confirmed`** — modeled so it can be
inserted without restructuring, **not implemented in v1**.
**Why:** Seat sub-states already distinguish "no progress" from "some" (Open+Filling merged); a
derived shift state can't drift out of sync with its seats (SPEC §1.1).
**Tradeoff:** Shift state is computed, never set directly.
**Revisit if:** Pass D adds the `Held` tier for progressive commitment.

## DEC-006: Escalation Tiers 1–3 are degrees of automation, not states
**Decision:** The carrot/stick lives in *how the system works a seat*, not in state names. Tier 1
(autonomous fill), Tier 2 (semi-autonomous escalation — widen pool, nudge) both happen **within
`Filling`**. Only Tier 3 (human) corresponds to a state: the shift goes `At-Risk` and surfaces to
the operator.
**Why:** Keeps the state machine small and the autonomous last-minute booking emergent rather than
a special feature (SPEC §1.2).
**Tradeoff:** Tier activity is tracked alongside `Filling`, not encoded as distinct shift states.
**Revisit if:** Never for v1.

## DEC-007: Per-role assignment protocol + first-acceptable-yes-wins
**Decision:** Two protocols ride the same seat machine: **ask-then-assign** (mates: broadcast →
yeses accrue → confirm down the list) and **assign-then-confirm** (captains: name a person → they
confirm/decline). Default is per-role, with a **per-person override** toggle (lives on the roster
record). Contested-seat winner is **first-acceptable-yes-wins** for rollout; **best-by-score** is a
knob to flip once reliability data is trusted.
**Why:** Matches Spink's instinct, feels fair, and is simple; the two policies only diverge when a
flake answers first (SPEC §1.2, §2.4).
**Tradeoff:** First-yes can occasionally seat a lower-reliability person ahead of a better one.
**Revisit if:** Reliability data matures (flip to best-by-score).

## DEC-008: Reliability score is a ranking, not a grade or gate — log events day one
**Decision:** A per-crew number that sets **ask priority** within the already-eligible pool.
Credentials gate; the score only orders who-gets-asked-first. One blended number for v1 (deliberately
dumb, rolling window). **Declining is neutral; ignoring is the sin** (only `ask_ignored` penalized).
**Lateness of a bail is the signal, not the bail.** Visible **to self only, individual not
comparative**. Spink gets a manual **boost/floor** thumb per person (also resolves cold-start:
unknowns start neutral/mid-pool). **The full reliability-event vocabulary is logged from the first
commit even though v1's formula ignores some** — you cannot recompute history you didn't record.
**Why:** The single lever for carrot and stick without inventing punishment; logging-day-one is the
build plan's one hard technical rule (SPEC §1.4, build plan §4).
**Tradeoff:** Event log carries fields nothing reads yet in v1.
**Revisit if:** Pass A scores the events; weights/decay tuned against real data.

## DEC-009: Availability is suppression-only — never a positive-availability calendar
**Decision:** Crew availability is modeled as **PTO / blackout suppressions only**. Absence of a
suppression means available. There is **no** "set your recurring availability" calendar the crew
maintain.
**Why:** The positive-availability calendar is the exact Xola trap the product exists to kill —
crew won't maintain it, so it goes stale and lies. This guardrail also binds the future soft-hold
feature (SPEC §2.1, §4 guardrail).
**Tradeoff:** The system can't pre-know a crew member is generally free; it asks and learns.
**Revisit if:** Never. If a crew-tended "set your availability" screen ever appears, the feature
has failed.

## DEC-010: Crew auth is magic-link passwordless; crew don't self-register
**Decision:** Crew authenticate via **magic-link, no passwords**; the link drops them straight onto
the relevant ask/card. Crew records are **operator-created** (no self-registration). Admin (Spink)
gets a real authenticated login; exact admin mechanism is a build-phase detail.
**Why:** A forgotten password is a ghosted shift; casual crew won't manage credentials (SPEC §2.6.1,
§3.2).
**Tradeoff:** Magic-link delivery depends on the notification channel's reliability (ties to the
native-vs-PWA question, DEC-TBD).
**Revisit if:** Channel reliability proves insufficient at the infrastructure stage.

## DEC-011: 2026 coexistence — CSV bridge is disposable; Xola API bolt-on killed
**Decision:** In 2026 Xola owns bookings/money/waivers. A **one-way CSV export** from Xola is
imported into Event Admin and auto-formed into shifts. Crew are written back as guides in Xola
**manually** (a Muster-emitted "enter these in Xola" sheet) — **only if** the export lacks guest
detail (decide at M1). The **live Xola API integration is killed** — it's a maintained dependency on
a system with a ~18-month kill date. The CSV reader is the only throwaway; everything it feeds is
permanent.
**Why:** De-risks the scary assumption (does autonomous grouping work on real bookings?) in week one
without coupling to a doomed API (SPEC §0.3, §3.5, build plan §5).
**Tradeoff:** Manual write-back costs ~10 min/week at BrewBoat volume until the manifest moves onto
the card (DEC-012).
**Revisit if:** Never revive the API. CSV retires in 2027 when Muster takes bookings directly.
**M1 verification (DEC-015):** the real per-reservation export *does* carry guest detail, so the
manual write-back sheet is **not** needed to populate the manifest. Its §3.5 lifecycle (retire when
the card is live to crew) is unchanged.

## DEC-012: Manifest is grouped per event on the shift card; no waivers for crew
**Decision:** The guest manifest is grouped **by event** on the shift card (a Saturday shift shows
separate 1pm/3pm/5pm lists), each showing **name + count/phone**. **Waivers are not shown to crew.**
Pull this onto the card **early** — it is the **hinge** that ends the Xola dependency.
**Why:** Different customers are on each event; crew need per-event lists. The moment the card is
authoritative, crew stop needing Xola and the 2026 write-back sheet retires (SPEC §0.4, §2.6.3).
**Tradeoff:** Requires the CSV export to carry guest name+phone per reservation (verify at M1).
**Revisit if:** Export lacks guest detail → fall back to the write-back sheet (DEC-011) as a stopgap.
**M1 verification (DEC-015 / DEC-017):** guest name + party are inline and phone joins via the
customers export → the manifest is fed from the import; the "export lacks detail" fallback did **not**
fire. Manifest contact fields are name + party + (nullable) phone.

## DEC-013: Stack & infrastructure deferred to ~M4
**Decision:** The web framework, database, host, auth provider, and SMS/push provider are **not
chosen now**. M0–M3 are built as a **stack-agnostic domain core** (the entities, state machine,
oracle, reliability-event log) behind a **repository port**, with throwaway-thin local persistence
(in-memory / SQLite) and rendering. The durable stack is chosen at **M4 (task 1.5a)**, the first
point the crew app genuinely forces it (magic-link, push/SMS, deployment, two real UIs).
`.claude/project-type` is `tool` until then, flipping to `webapp` at M4 (keeps the webapp-only
`@ui-reviewer` correctly dormant).
**Why:** The build plan leaves the stack to us and the spec's spine doesn't change as it thickens;
choosing infra only when necessary keeps the early work portable and the scary assumptions
(grouping, oracle) de-risked without framework noise. (Project-setup decision, 2026-06-03.)
**Tradeoff:** The thin M0–M3 rendering is throwaway; some seeds tooling (VersionTag, safe-supabase,
production branch, Vercel) stays dormant until M4.
**Revisit if:** M4 — make the durable framework/DB/host/auth/SMS+push call then (see DEC-TBD).

## DEC-014: Locked-spec + future-ideas discipline
**Decision:** `docs/SPEC.md` is **frozen at v1.0**. No new features or scope go into it. New ideas —
however good — land in `docs/FUTURE_IDEAS.md` and wait. The only edits permitted to the locked spec
are *corrections* and downstream feedback about existing behavior. Unlock only with a deliberate
version bump (v1.1) when a batch is genuinely ready.
**Why:** Stops the baseline drifting one shiny idea at a time at 11pm; lets a new idea be caught
without derailing the build (SPEC lock rule; FUTURE_IDEAS preamble). (Project-setup decision,
2026-06-03; muster-local — not backported to seeds this round.)
**Tradeoff:** Genuinely good ideas wait for a batched v1.1 rather than landing immediately.
**Revisit if:** The vertical slice has run a real BrewBoat weekend and a batch is ready to fold in.

## DEC-MSG-1: SMS is the eventual production channel — via the port, not in the slice
**Decision:** SMS is the intended **primary production** channel for the crew ask (research-backed:
~98% read, minute-scale replies, no install/permission/gatekeeper, ~2–3¢ per round trip). But it is
delivered **through the channel port as one adapter** (DEC-MSG-3), and it is **explicitly excluded
from the first vertical slice.** The slice runs on the fake + pilot adapters; Twilio/SMS is the final
swap. Concretizes SPEC §3.1 "push/SMS" → "port-mediated; SMS the eventual production adapter."
**Why:** SMS via Twilio carries a real external dependency with lead time (10DLC). Chaining the slice
to it would gate "get a working app out the door" on carrier approval. The port lets the slice ship
now and adopt SMS later with **zero domain change** — if adding the Twilio adapter forces a domain
change, the port is wrong. (Channel research, 2026-06-03; **supersedes the REV 1 "M4 ships the SMS
loop" framing.**)
**Tradeoff:** Per-message cost and a 10DLC registration dependency with real lead time — now gated to
the Twilio adapter swap, **off the slice's critical path** (see ops checklist); plain-text, strictly
transactional asks to keep the TCPA posture.
**Revisit if:** Volume or cost/latency shifts the math enough to lean harder on push (Phase: Twilio
adapter swap, post-slice).

## DEC-MSG-2: App form factor — native iOS + Android (Capacitor), de-prioritized
**Decision:** The eventual app form factor is **native on both platforms via a Capacitor wrap**, but
it is a **post-slice fast-follow**, not an M4 blocker. M4 ships the **channel port + fake/pilot
adapters** (DEC-MSG-3); the native wrap + push is a separate, later unit of work triggered when push
reliability actually matters (crew habitually in-app, or SMS cost/latency becomes a real constraint).
**Why:** iOS PWA web push is too flaky for a seconds-matter ask; reliable in-app push on iPhone
needs native APNs → Capacitor. But push is an **accelerant**, not the participation path — the
channel port (DEC-MSG-1/3) is, so nothing about crew *answering* depends on the native app existing.
Resolves the build-plan §7 native-vs-PWA question. (Channel research, 2026-06-03.)
**Tradeoff:** Reliable in-app push waits until after the slice proves out.
**Scope guardrail (enforce):** "Two native apps" must **not** inflate M4 into shipping/maintaining
two app-store builds. Until the trigger fires, the port's non-push adapters carry it.
**Revisit if:** Push reliability becomes load-bearing (Phase: post-slice fast-follow). **Rejected:**
RCS — verified RCS Business Messaging sender vetting (weeks–months, real fees) and *still* needs an
SMS fallback; all overhead, no payoff for one operator. Revisit in 12–18 months only if volume
changes the math.

> **Ops checklist (gated to the Twilio adapter swap — later, NOT M4):** 10DLC brand + campaign
> registered and approved before any send · long code provisioned · inbound webhook wired into the
> domain `recordReply` with REQ-CLAIM-1 race-safe claim logic (SPEC §3.1) · asks kept plain-text and
> strictly non-promotional (TCPA) · email path available for magic-link fallback + receipts (SPEC
> §3.2) regardless. Lead time is real, but it **no longer blocks the slice.**

## DEC-MSG-3: Channel adapters — one port, build in this order
**Decision:** The crew ask reaches a person and collects a yes/no through **one outbound port
(`sendAsk`) and one inbound path (`recordReply`)**; concrete transports are **adapters injected at
the edge** — the same ports-&-adapters (hexagonal) shape as the oracle's policy/mechanism split
(DEC-001). The ask *logic* never talks to a transport directly. Three adapters, built in order:

| Adapter | Purpose | When |
|---|---|---|
| **Fake / log adapter** | Deterministic automated testing — `send` logs; replies come from a test helper / dev endpoint. Drives the seat + reliability state machine: timeout → `ask_ignored`, two simultaneous accepts → atomic claim (REQ-CLAIM-1), declines, bails. **Permanent test infra, not a throwaway.** | **M4 — required** |
| **Pilot adapter** | First real crew test weekend, no Twilio. **Option A — web link** (magic-link to the In/Out screen, §2.6.1, delivered manually by the operator) or **Option B — Telegram bot** (free, instant, inline Yes/No, requires crew to install Telegram). **Operator picks A or B later; build the port so either drops in — do not hardcode.** | **M4 — required (option deferred)** |
| **Twilio SMS adapter** | Production. Outbound SMS + inbound webhook → `recordReply`. Adding it must require **zero** change to the ask domain — if it doesn't, the port is wrong. | **Later — final swap, not M4** |

**Why:** "Add real SMS later" becomes *inject one more adapter*, not a refactor. The claim logic
(REQ-CLAIM-1) lives once in the domain behind the port, so it's identical and testable across every
transport without a live carrier. (Channel research Brief 2 + build-sequencing, 2026-06-03.)
**Tradeoff:** One indirection layer up front, before any real transport exists.
**Rejected:** **RCS** — verified-sender gatekeeping, fees, still needs an SMS fallback; revisit
12–18 months. **Twilio/SMS in the first slice** — deferred to the final adapter swap.
**Revisit if:** A transport need appears that the single `sendAsk`/`recordReply` shape can't express
(Phase: M4 for the port + fake + pilot adapters; Twilio swap later).

---

## DEC-ROLE-1: Crew roles and vessel manning are tenant data, not a hardcoded enum
**Decision:** Roles/ratings and per-vessel manning requirements are **data, defined per tenant** —
**not** a language enum or hardcoded constants. The engine must never assume there are exactly two
roles, nor that they are specifically "captain" and "mate." The model:
- **`RoleType`** — a per-tenant row `{ id, tenantId, name }`. BrewBoat seeds two rows (`captain`,
  `mate`); a later tenant adds deckhand / engineer / naturalist by adding rows, no code change.
- **Vessel manning** — a list of `{ roleTypeId, count }`. Seat derivation **iterates the list**; it
  must work for N lines, not assume two. BrewBoat = `[{captain,1}, {mate,1}]`.
- **`CrewMember.ratings`** — a set of `roleTypeId`. **`Seat.role`** — a `roleTypeId` reference.

**Why it's already the spec's intent:** seats declare a `role` and required seats are **derived from
the vessel's COI/manning** (SPEC §1.1, §2.3); the roster stores **ratings as a set** (§2.1); the
eligible pool filters by "holds the **required rating**" (§1.3) — role-agnostic by construction. The
engine is already role-as-config; this decision just forbids the build from collapsing it back into a
hardcode.

**Scope — model general, seed minimal.** The configurability is in the *model*, not yet an
*interface*. BrewBoat's two roles + 1+1 manning are seeded directly (fixture). **Do not** build a
role-admin UI, custom-manning editor, or multi-role config screen in the slice — that arrives with
multi-tenant, well past it.

**Anti-patterns (explicitly do not build):** ❌ `enum Role { CAPTAIN, MATE }` or a `'captain'|'mate'`
union anywhere in the domain · ❌ hardcoded `{ captains:1, mates:1 }` manning or seat-building that
makes "a captain seat and a mate seat" instead of looping a list · ❌ `if (role === 'captain')` in the
pool/rating check — match the required `roleTypeId` generically · ❌ UI assuming exactly two role
columns. These all compile and pass slice tests — that's the danger; the retrofit cost after
`captain`/`mate` is sprinkled through the code is high, the up-front cost (a table + a list vs an enum
+ constants) is near zero.

**Tradeoff:** A `RoleType` table + manning list instead of an enum + two constants, before a second
role type exists. **Rejected:** the enum/constant shortcut — bakes in the exact assumption this
decision exists to prevent. **Revisit if:** never for the model; a role-admin *interface* is revisited
at multi-tenant. **Phase:** applies from M0 (the data model) onward — no new milestone. (Handoff,
2026-06-04.)

## DEC-DATA-1: Muster keeps a service layer; Supabase (if used) is managed Postgres, not the architecture
**Nature:** An architecture-boundary decision, made **before** adopting Supabase so the boundary is on
paper, not improvised against a tempting RLS policy later. No slice work changes; this is a standing
boundary that composes with DEC-013 (stack deferred to M4) — it pre-commits *how* a datastore is used,
not *which* one.

**Decision:** If Supabase is adopted as the datastore, Muster **retains its own service/domain layer.**
The client does **not** talk directly to the database via PostgREST as the primary path. Supabase is
used as **managed Postgres + auth**, behind Muster's API. **RLS is authorization only —
defense-in-depth, never the place domain logic lives.**

**The line (hold it):**
- **RLS / policies** answer one kind of question: *"can this identity see or write this row?"* —
  declarative, per-row, stateless. That's all they're for.
- **The service layer** owns *decisions*: the seat state machine, crew satisfiability, reliability
  scoring, tier escalation, and especially the **atomic first-come claim (REQ-CLAIM-1)** —
  procedural, stateful, transactional. None of this goes in policies or triggers.

**Rationale:**
- Muster is a crew **engine** — almost entirely domain logic of the kind that must not be smeared
  across RLS policies, triggers, and procs. Pushing it into the database recreates the stored-procedure
  trap: logic you can't grep, can't unit-test without a database, can't reason about in one place.
- A service layer in front of Supabase is **not** misusing the tool. "Client talks to PostgREST
  directly" is a default aimed at thin CRUD apps, not engines. Supabase as plain Postgres behind an API
  is a fully supported, normal pattern.
- Composes cleanly with the rest: the schema is just Postgres DDL (drops onto Supabase unchanged); the
  channel port/adapters are orthogonal to where data lives.

**REQ-CLAIM-1 specifically:** the atomic claim stays domain logic. Its home is a **service-layer
method** (transactional conditional update). If a future reason ever pushes parts of the app
Supabase-native, the claim relocates to a **`SECURITY DEFINER` Postgres function / RPC** — *not* to RLS
policies. Either address is fine; RLS is not.

**When going Supabase-native *would* win (the bar — Muster does not clear it):** adopt the
PostgREST-direct + RLS-as-authorization posture only when there is **almost no domain logic to
displace** — thin CRUD, the database genuinely is the app, a backend would be pure ceremony. That is
the opposite of Muster. Re-check against this bar if tempted; expect Muster to keep failing it.

**Tradeoff:** A service layer to build/maintain instead of free PostgREST CRUD. **Rejected:** the
PostgREST-direct + logic-in-RLS posture — it scatters an engine's logic across policies/triggers/procs.
**Revisit if:** never for the boundary; the datastore *identity* is the M4 decision (DEC-013 / DEC-TBD).
**Phase:** standing boundary; binds whenever a datastore is chosen (M4). (Handoff, 2026-06-04.)

---

## DEC-015: Xola import — verified source, grain, identity keys, and quarantined Land→Map→Reconcile architecture
**Source:** verified against two real Xola exports (`purchaseItems`, `customers`), 2026-06-04.
**Supersedes** an earlier informal DEC-015 sketch that assumed only an aggregated revenue report with
no guest detail — that was the wrong export.

**Decision:**
- Import source = the `purchaseItems` export's **`Reservations` sheet** — **per-reservation grain**
  (~99 live rows), not the aggregated revenue report. Inline: customer **Name**, **Email**, party
  size (**Total Demographics**), **Product**, **Arrival Date/Time**, **Status**, and stable Xola IDs.
- **Identity keys (no fragile composite needed):** `Reservation ID` (primary, ~99/99 filled) and
  `Confirmation Code` (~99/99); `Purchase ID` groups multiple reservations in one purchase. These are
  the reconcile keys for insert/update/cancel and for protecting manual entries.
- The `Events` sheet is **event-grained** with a guide-assignment matrix (one column per guide) — a
  cross-check / the guide picture, **not** the reservation source.
- **Architecture — quarantine the mess behind an adapter; Land → Map → Reconcile:**
  - *Land:* ingest raw rows into staging (tagged source-file + import-batch), untouched.
  - *Map:* normalize raw → candidate Events/Reservations against an explicit field mapping; the
    multi-file join (DEC-017) and the Product map (DEC-018) run here; bad rows quarantine with a reason.
  - *Reconcile:* merge candidates into Event Admin by identity key — insert/update/cancel, protect
    manual entries. The domain only ever sees clean Reconcile output; never a CSV or a column.
  - The reader/adapter is the only throwaway piece (coexistence §2); everything it feeds is permanent.

**Thin-path first (the end-to-end steer):** the first end-to-end shift (form → ask → crew tap) may be
driven by the *minimum* importer — a single-file, single-product, no-reconcile happy-path read, or a
seeded fixture (DEC-016 blesses invented fixtures) — **before** Land/Map/Reconcile is fully built. The
three-stage architecture is the durable target, **not a gate on the first tap.** The riskiest unknown
is whether the whole loop works end to end, not whether the parser is perfect.

**Resolves the DEC-011/012 M1 verification — but only the *data-availability* half.** The export
carries name + party inline and phone is reachable via DEC-017, so the §2.6.3 manifest **data** can be
populated **from the import** — no manual write-back is needed to *populate the manifest.* The **§3.5
write-back sheet's retirement is a separate, later event** that still waits on the **card's manifest
being live and authoritative to crew** (the §0.4/§2.6.3 hinge, M4+); until the card is authoritative,
crew still see their guests via Xola. DEC-015 does **not** kill the locked-§3.5 sheet at M1.

**Reconciliation policy stays open.** Reconcile's "protect manual entries" is the *mechanism*; the
*policy* (manual-wins vs reconcile-on-conflict) remains the operator-owned open question (DEC-TBD /
SPEC §2.2), defaulting to "manual wins, flag conflicts."

**Why:** real exports verified the grain and keys the build had been guessing at; the per-reservation
source exists and is authoritative. It is also genuinely messy (multi-row header — real field names
sit in a sub-header row under parent headers; ~70 columns, most of them per-add-on insurance/tip junk)
— exactly why the mess is quarantined in Land/Map and the parser selects the ~10 columns that matter
and skips the sub-header row.
**Tradeoff:** a staged adapter is more than a one-shot script. Accepted — it is the only throwaway
piece and it keeps the domain clean. **Rejected:** parsing CSV columns directly in the domain (recouples
the engine to Xola's schema — the exact thing the adapter exists to prevent).
**Revisit if:** Xola changes its export schema; a per-reservation export adds phone inline (simplifies
DEC-017); or the first end-to-end tap shows the three-stage staging is heavier than the loop needs
(collapse stages — durable target, not dogma).
**Phase:** M1 (task 1.2) onward; the thin-path permits the first tap ahead of full staging. (Verified
handoff, 2026-06-04.)
**Reader format (clarifies DEC-011):** Xola only exports **xlsx**, so the disposable reader parses the
xlsx directly (the `Reservations` sheet) rather than forcing a manual xlsx→CSV step — DEC-011's "CSV
export" was format-shorthand for "the disposable bridge." The slice reader shells out to the system
`unzip` + a light XML scan (no npm dependency in this dep-minimal phase, DEC-013); it gets a real
xlsx library when the stack lands (M4). (Operator-chosen, 2026-06-04.)

## DEC-016: BrewBoat worked example corrected — real fleet; scope ≠ current holdings; test data invented
**Decision:** Corrects the SPEC v1.0 worked example (a DEC-014-permitted *correction*, not new scope).
Real BrewBoat = **4 inspected party boats** (two 12-pax, one 14-pax, one 16-pax), **each needing 2
crew** (role composition is COI **data** — not assumed here). The single-boat / COI-6 / 1-captain-1-mate
example is retired as the canonical picture; it survives only as an illustration, flagged inline.
**Non-inspected rentals** (former Duffy: 12-pax **self-captained = zero crew**, plus a captained
variant) are **IN scope** — replacements are being bought, and zero/varied-crew vessels are required
test cases *regardless of ownership*. **Scope is never limited to the current fleet.** Manning counts
(0/1/2/N) are **data the seat-deriver iterates** (reaffirms DEC-ROLE-1) — never a design input or a
branch.
**Test/fixture data:** inventing test data is encouraged for coverage — deliberate crew-count variety
(a 0-crew rental, a 1-captain boat, a 2-crew party boat) to *prove* the deriver is generic, not a
snapshot of today's fleet. **Any example/seed harness must be flagged to the operator for validation**
before it is trusted as real. (The Task-1.1 BrewBoat seed — invented names + COI-6/1+1 manning — is
exactly such invented-and-now-stale data, flagged for the operator.)
**Owed SPEC correction (lands with this DEC):** the locked SPEC §1 glossary ("Required seat",
"Event") and §2.3 (builder restatement) carry "1 captain + 1 mate / capacity 6" — corrected inline
(same form as the existing DEC-ROLE-1 notes), plus the stale lines in CLAUDE.md.
**Why:** real Xola data contradicts the placeholder; left uncorrected, the placeholder risks
re-seeding the exact hardcode DEC-ROLE-1 forbids.
**Tradeoff:** corrects a LOCKED doc — permitted only because DEC-014 allows corrections (not new
scope). **Revisit if:** never for "scope ≠ holdings"; fleet specifics update as boats come and go.
**Phase:** applies from M0 (data model + fixtures) onward — no new milestone. (2026-06-04.)

## DEC-017: Manifest contact — email is the spine, phone via email-join, phone nullable
**Decision:**
- Manifest fields (operator-confirmed): **name + party size + phone.**
- **Phone is not in the reservation row.** **Email is inline on 100% of reservations** and is the join
  key; **phone lives only in the `customers` export.** The importer ingests **both reports and joins
  `Reservations` → `Customers` on email** (lowercased/trimmed), **in-pipeline (Map stage)** — never a
  hand spreadsheet merge.
- **Phone is modeled nullable.** A missing phone → a "no number on file" manifest state that degrades
  one card; it never fails the import.

**Thin-path first:** phone-nullable already means the loop never blocks on phone, and the **email-join
is not required for the first crew tap** — a fixture phone or single-report import suffices to reach
the first tap. The two-report join is the durable manifest path, not a gate on the loop.

**Why (the data, verified 2026-06-04):** all-time phone fill is sparse (97/497 customers) — but that
497 is years of dead history. Of the **99 forward-looking reservations (May–Sep 2026)** — the bookings
actually crewed — **99/99 join by email to a customer record with a real phone.** So "phone required"
is achievable on the data that matters, via the join; the sparse remainder is customers who will never
sail again.
**Tradeoff:** a two-report import + email-join is more pipeline than one file, and phone coverage
depends on customers keeping phone on file. Accepted — the join is ~1:1 on live data and the nullable
model absorbs any gap. **Rejected:** a hand spreadsheet merge of the two reports — it rebuilds the
manual rot Xola is being left to escape.
**Revisit if:** the 2027 portal collects phone at booking (pushes coverage to 100% and makes the
customers-join legacy-import-only); or the customers export is routinely unavailable at import time
(reconsider whether phone-required holds, or phone stays best-effort).
**Phase:** M1 (slice-aware — the join is durable, not required for the first tap). (Verified handoff,
2026-06-04.)

## DEC-018: Product string → vessel + manning map — auto-suggest, operator confirms
**Decision:**
- Xola encodes the vessel **and** crew model as a **free-text `Product` string**, not a clean vessel
  ID. Observed: `Brew Boat Party Boats with Captain`, `Duffy Boat Rental | Self Captained` (0 crew),
  `Captained Duffy Boat | With Captain`, `BrewBoat Non Cycle | Private 12 Passenger | With Captain`,
  `JAEGER TRIAL Copy of …` (a test listing).
- The importer maintains a **`Product → { vessel, manning }` lookup.** For any **unseen** Product it
  **auto-suggests** a mapping (hints: "Self Captained" → 0 crew; "With Captain" → a captain row; pax
  range parsed from the name) — and the **operator confirms** before it is trusted. **Unconfirmed
  products quarantine their reservations** (never silently guess a boat/crew). Test/copy listings (e.g.
  `JAEGER TRIAL`) are mapped to **ignore/exclude** by the operator.
- **The no-hardcode line (DEC-ROLE-1).** The heuristic maps a parsed string-hint to a manning row
  `{ roleTypeId, count }` where `roleTypeId` is **looked up by name from the tenant's `RoleType`
  table** — a **data → data** mapping the operator confirms. A role name like "captain" lives only in
  the *Xola string being parsed* and in *seed data*, **never** as a hardcoded role constant, enum,
  union, or `if (role === 'captain')` branch in the seat-deriver. The deriver loops the confirmed
  `{roleTypeId, count}` list, blind to which roles exist.

**Thin-path first:** during the first end-to-end slice, an unconfirmed product may map to a **single
seeded vessel/manning** rather than quarantining — so the loop is never blocked on the confirm UI. The
quarantine-until-confirmed gate is the durable behavior, enforced once multiple products are live.

**Why:** the Product string is the only place vessel + crew model lives in the export, and it is
free-text that drifts (copies, trials, renames). Auto-suggest saves typing; operator-confirm prevents
a bad guess from seeding wrong manning. The observed spread (0-crew self-captained, captain-only,
2-crew party boat) **reaffirms DEC-ROLE-1** and **reinforces DEC-016**: manning is data the deriver
loops; the Product map merely supplies the per-vessel counts.
**Tradeoff:** the operator must confirm new products before their reservations import (a gate, not
automatic) — softened to a single-seeded-vessel default during the first slice. Accepted: a few clicks
per new product vs. silently mis-crewing a boat. **Rejected:** auto-trusting a parsed product string (a
rename or typo silently seeds wrong manning).
**Revisit if:** Xola ever exposes a stable vessel/product ID (key the map off the ID instead of the
free-text name).
**Phase:** M1 onward; the thin-path default permits the first tap ahead of the confirm gate. (Verified
handoff, 2026-06-04.)

## DEC-019: `Bailed` is a seat *transition*, not a resting state
**Decision:** A confirmed crew backing out fires one atomic `bail()` operation: log `shift_bailed`
(with `latenessMs`), drop the occupant, and re-ask the next candidates (excluding the bailer) — the
`Confirmed → Bailed → Open` edge of SPEC §1.1 / §2.4 ("auto-reopens & re-asks") / §2.6 principle 2 (a
decline *immediately* re-asks). **If the re-ask finds candidates, the seat advances to `Asked`**
(Bailed cleared in the same operation — never a resting state on the happy path); **if the pool is
exhausted, the seat rests at `Bailed`**, which is the *only* way the loop yields `AtRisk`
(`deriveShiftState` derives `AtRisk` from a Bailed required seat). The durable "a bail happened"
record always lives in the reliability log, independent of the seat's resting state.
**Why:** The spec implies but never names the transient-vs-sticky fork, and `derive.ts` carries a ⚠️
comment pointing here. Making `Bailed` transient **on the happy path** means `deriveShiftState`'s
`AtRisk`-on-`Bailed` branch fires only when the re-ask finds an **exhausted pool** — which is the
legitimate Tier-3 / At-Risk condition (SPEC §1.2), not the horizon bug the comment feared. The
horizon-blind `Bailed → AtRisk` gap therefore does not bite the Tier-1 happy path; `Bailed → AtRisk`
becomes meaningful, not accidental.
**Tradeoff:** `bail()` does two things (drop + re-ask) in one call; a caller can't park a confirmed
seat at `Bailed` by hand. The resting `Bailed` is reserved for the exhausted-pool outcome. Accepted —
that's the spec's edge and the only AtRisk source the clockless loop can honestly produce.
**Scope note:** The Tier-1 ask loop is deliberately **horizon-agnostic** (it operates on demand, like
the oracle — DEC-004/013 clockless core). The *early*-bail (time to refill → `Filling`) vs *late*-bail
(no time → `AtRisk`) distinction needs the staffing-horizon clock and is left to the horizon task; a
clockless loop must not fake it. The `derive.ts` ⚠️ comment is re-homed from "1.4b" to "the
staffing-horizon task."
**Revisit if:** Pass D's `Held` tier or the staffing-horizon task changes how a vacated seat re-enters
the machine.
**Phase:** M3 (task 1.4b). @architect pass, 2026-06-05.

## DEC-020: M4 stack — Next.js (App Router) / Vercel; persistence is Postgres-behind-the-port with the hosted provider deferred; magic-link is self-rolled. No platform adopted.
**Decision:** Resolves the DEC-013 / DEC-TBD stack question at task 1.5a.
- **Web framework = Next.js (App Router)**, a single app with route groups `app/(admin)` / `app/(crew)` / `app/api`. **Host = Vercel.** Both confirmed by the owner.
- **The stack-agnostic `src/` domain core (M0–M3) is untouched** and stays framework-free: its own strict NodeNext + `verbatimModuleSyntax` profile in `tsconfig.core.json`; Next consumes it via the `@core/*` alias and bundles it directly (webpack `extensionAlias` maps the core's `.js` specifiers → `.ts` sources — Turbopack lacks this, so build/dev run `--webpack`; revisit when Turbopack supports extension aliasing).
- **Datastore = Postgres behind the `Repository` port**, run against **local Postgres in dev** (PR 2). Schema is **plain Postgres DDL** (DEC-DATA-1). The **hosted Postgres provider is deferred to deploy time and kept vendor-agnostic** — Supabase is **demoted from "the stack" to one candidate host**, *not adopted now*. The in-memory adapter stays as the test substrate.
- **Auth = self-rolled magic-link in the service layer** (tokens + signed link + verify route, dev-stub email delivery — PR 3). Vendor-neutral, unit-testable. **Same mechanism for admin (Spink) and crew** (DEC-010 left the admin mechanism a build-phase detail). No third-party auth platform.
- **Channel port** (DEC-MSG-3) gets its **fake/log adapter** (required, permanent test infra) + a **pilot-adapter seam** that accepts web-link *or* Telegram without a hardcode (PR 3). Twilio is the later swap (DEC-MSG-1); native/Capacitor a post-slice fast-follow (DEC-MSG-2).
- `.claude/project-type` flips **tool→webapp** here; `@ui-reviewer` re-enabled; webapp seeds tooling pulled via `/pull-seeds` (**review-required, additive — must not clobber the hand-written domain-core docs**).
**REQ-CLAIM-1:** the atomic first-come claim stays a **service-layer transactional conditional update** (DEC-DATA-1). The thin `Repository` port gains a **state-guarded write** (a compare-and-swap, e.g. `saveSeatIfState`, or a transaction) so the Postgres adapter closes the read-then-write race in `recordResponse` (ask-loop.ts) deterministically — **never an RLS policy or trigger**. Built in PR 2 when the claim path goes live.
**Why the owner steered off Supabase-as-platform:** magic-link (self-rolled in an afternoon) is too thin a reason to adopt a platform, and jumping in-memory→hosted-platform is premature. DEC-DATA-1 already designed the DB as a swappable adapter and the schema as portable Postgres DDL — so "local Postgres now, pick a host at deploy" honors that boundary harder and avoids vendor lock + a premature platform.
**Scope (1.5a, IN):** PR1 framework + topology + project-type flip + `/pull-seeds`; PR2 Postgres adapter + DDL + state-guarded write; PR3 self-rolled magic-link + channel fake/pilot adapters. **(OUT):** admin/crew surfaces (1.5b/#12, 1.6/#13), RLS policy suite, Twilio/10DLC, Capacitor/push/app-store builds, real hosted provisioning, real transactional email (dev stub only).
**Owner-deferred (money / lead-time):** hosted Postgres provider + Vercel/Supabase provisioning (deferred to first task needing a real URL); pilot adapter web-link vs Telegram (DEC-MSG-3 keeps deferrable — M4 builds the seam, not the pick); custom domain; transactional-email provider.
**Tradeoff:** a SQL adapter + self-rolled auth is modestly more code than a platform handing them over — accepted for vendor-neutrality + testability + no premature platform (DEC-DATA-1). Build runs webpack, not Turbopack, until Turbopack resolves NodeNext `.js` cores.
**Revisit if:** the pilot outgrows single-app/single-region, the hosted-provider choice is forced, or Turbopack gains `.js`→`.ts` extension aliasing.
**Phase:** M4 / task 1.5a. (@architect pass + owner decisions, 2026-06-05.)

---

## DEC-021: Frontend styling = Tailwind v4; component library deferred
**Decision:** The first real UI (task 1.5b, the crew app) establishes the styling foundation as
**Tailwind v4** (via `@tailwindcss/postcss`, CSS-first `@theme` tokens in `app/globals.css`, no
`tailwind.config.js`). **No component library is adopted yet** — the few crew surfaces are hand-built
from Tailwind utilities. Design tokens (colors, IBM Plex faces, radius) are **harvested from the
Claude Design mockups** per DESIGN-REFERENCE.md (read the CSS values, re-express as `@theme` tokens —
never import the mockups). `.claude/ui-context.md` captures the tokens + voice + binding constraints
for `@ui-reviewer`.
**Why:** Every component library the owner has used branches from Tailwind, so Tailwind is the
substrate regardless; picking the library later costs nothing now. BRAND says "function over form,
polish is post-slice" — a component library is foundation tax that's overkill for two small crew
surfaces and better chosen when the heavier admin surfaces (assignment view, at-risk board, roster)
actually need primitives. DESIGN-REFERENCE explicitly leaves the component library as *reference,
our choice*; `@ui-reviewer`'s shadcn assumption is a generic seed default, not binding on Muster.
**Tradeoff:** Hand-built components are more verbose than a library's primitives — accepted for the
slice; revisited when admin surfaces land. Webpack already required (DEC-020); Tailwind v4's PostCSS
plugin composes with it fine.
**Revisit / trigger:** Choose the component library via an **@architect pass (or chat research)** when
the first heavy admin surface is next on the build — layered on top of Tailwind without rework.
**Phase:** M4 / task 1.5b. (Owner decision, 2026-06-06.)

---

## DEC-022: Staffing horizon is *derived* config, not a stored field; shift time-state is a composition layer over seat-derivation
**Decision:** The staffing horizon is **computed, never stored**: `staffingHorizonFor(shift, events,
leadDays) = (earliest scheduled event date+time) − leadDays`, where `leadDays` is a single
tenant/engine **config constant** (a *days* value — distinct from the same-day 45-min manifest call
lead, DEC-021/FUTURE_IDEAS; two different leads, two different purposes). It is **not** a new entity
field — no `Shift.horizonAt` column, no DDL change, no Repository-port change, no adapter change.
Modeled as a list-of-one per DEC-004 so Pass D's staged horizons slot in without a signature change.
The pure seat-fold **`deriveShiftState(seats)` stays untouched and seat-only** (DEC-005); a new
**`resolveShiftState(seats, {now, horizon, poolExhausted})`** composition layer sits *beside* it and
overlays the time dimension on the seat verdict. *(As shipped, the horizon is **precomputed** and
injected rather than passed as `shift`+`leadDays` — the pure fold takes no `shift` and reads no event
list. `staffingHorizonFor(shift, events, leadDays)` does the resolution upstream.)* The edges it owns:
`Pending`→`Filling` (horizon crossed), `Filling`/`Crewed`-fold→`AtRisk` (exhausted pool past horizon),
and "before the horizon → `Pending`", deferring to the seat-fold otherwise. **There is no explicit
`Crewed`→`Filling` early-bail edge** — DEC-019 makes `Bailed` transient, so the seat-fold never yields
`Crewed` with an open required seat; the early-bail case is already handled at the seat level before
this layer sees it. A `Crewed`/`Cancelled` fold result is returned as-is (a crewed trip doesn't
un-crew because a clock ticked).
**Why:** A stored horizon goes stale exactly when events are rescheduled (the #20 reconciliation
case) — you'd hand-maintain a cache of a subtraction. Deriving it keeps the deliberately-thin port
frozen and the core framework-free. Keeping `deriveShiftState` pure preserves DEC-005 ("state is
derived") and its ~12 seat-only tests; the composed result is *still* a pure function of (seats, time,
pool), just in a clearly-named second function — the same lifecycle-set-elsewhere pattern #20 used for
`Cancelled`. This closes the `derive.ts` ⚠️ horizon-blind KNOWN GAP and lands the early-vs-late bail
split DEC-019 explicitly deferred to this task.
**Tradeoff:** Two derivation functions instead of one, and the horizon is recomputed on each read
rather than cached — accepted; the inputs are already in hand and the subtraction is cheap. The
`poolExhausted` signal must be supplied by the caller (from the oracle's eligible pool), which couples
`resolveShiftState`'s callers to the oracle — acceptable, that's where the pool lives.
**Revisit / trigger:** If a stored horizon is ever forced (e.g. a query needs to sort thousands of
shifts by deadline at the DB), revisit — but that's an At-Risk-board-scale concern, not v1. The
concrete `leadDays` **value** stays the existing DEC-TBD open question ("ship a dumb default, tune");
this DEC fixes only *where the number lives*.
**Phase:** Phase 3 / task 3.1a (#39). (@architect pass, 2026-06-09.)

---

## DEC-023: The engine advances via an explicit `tick(repo, now)` operation; no scheduler in v1
**Decision:** Horizon advances run through an explicit **`tick(repo, now)`** sweep in the core (pure
over injected `now`, never reads a clock — mirrors `scoreCrewMember`/`lock`). `tick` walks shifts,
advances any that crossed their horizon via `resolveShiftState`, persists the change, and **eagerly
fires Tier-1 asks** for newly-`Filling` shifts by reusing `solveShift`/`broadcastAsk` (not a rebuild).
**Who calls `tick` on a timer is deferred to deploy** — a Vercel cron route is one line of config when
there's a deployed app, and there isn't yet (DEC-020 parked hosting). For now its callers are tests
and, optionally, a dev/admin "run the engine" trigger — exactly how `formShifts` already lives (a real
core operation with no production scheduler behind it).
**Why:** The advance **must be eager, not lazy-on-read**: `Pending`→`Filling` *kicks off Tier-1 asks*
(SPEC §1.1, DEC-006), and you cannot lazily "send the ask" only when someone happens to load a page.
A lazy derivation can compute a *display* state but can't drive the ask loop. So the state change that
has side effects has to be an explicit operation. Building the scheduler now would be infra the stack
doesn't have — premature.
**Tradeoff:** Until a scheduler exists, horizons only advance when something calls `tick` (tests, a
manual trigger) — accepted; there's no deployed app to run a cron against yet, and the calling seam is
one config line when there is. **Corollary — the persisted shift badge can lag the true horizon state
between ticks.** The ask loop's `refreshShiftState` persists the *pure* seat-fold (it has no `now`), so
a seat-driven write between ticks can transiently drop the time-overlay (e.g. a late `yes` flips an
`AtRisk` shift back to `Filling`). `tick` is the **sole reconciler** and re-asserts on its next sweep.
Treat the persisted state as eventually-consistent, not authoritative-the-instant-you-read-it; display
surfaces should resolve on read (via `resolveShiftState`) or tolerate the staleness. No asks
double-fire from this — `broadcastAsk` only fires on the `Pending`→`Filling` birth inside `tick`.
**Revisit / trigger:** Wire the cron caller at first hosted deploy (alongside DEC-020's deferred host
pick). If lazy *display*-state is ever needed before then, `resolveShiftState` already gives it for
free on read — `tick` remains the only thing that fires asks.
**Phase:** Phase 3 / task 3.1a (#39). (@architect pass, 2026-06-09.)

---

## DEC-024: Tier-2 escalation is a *nudge* over a *derived* escalation trail; "widen the pool" is a logged stub, not a soft-constraint engine

**Context:** Phase 3.2 (#40) builds Tier 2 (SPEC §1.2, DEC-006): widen the pool, direct-nudge
high-reliability crew, log the trail — all within `Filling`, no Spink. Two forks surfaced at the
@architect pass (2026-06-09) because the acceptance criteria assume levers v1 doesn't have.

**Decision:** Tier-2 escalation is two real mechanisms and one honest stub.
1. **The nudge is the live lever.** A direct assign-then-confirm (`assignPerson`) to the top-ranked
   eligible crew who ghosted the Tier-1 broadcast (went silent), logging a new `nudged` reliability
   event. **No `escalation_accepted` bonus is awarded in v1** (amended at the 3.2b build, 2026-06-10):
   every target `escalate` can reach is, by construction, already on the Tier-1 list — and rewarding
   someone for finally answering a *direct poke* after ignoring the broadcast is backwards. The
   `escalation_accepted` event stays reserved/unused (DEC-008) until `escalate` can reach a body *off*
   the Tier-1 list (a genuinely fresh person stepping into a shift others passed on). A nudged person
   who accepts gets only the ordinary `ask_accepted` — normal machinery, not an escalation reward.
2. **"Widen the pool" is a logged-intent stub.** Every eligibility rule is hard (MMC/rating are legal
   gates, PTO is suppression-only per DEC-009, double-booking is physical), and `broadcastAsk` already
   fans out to the *whole* ranked pool — so there is nothing to relax and no one new to reach. A new
   `pool_widened` event records that the engine re-confirmed full-pool exhaustion (the "I checked
   everyone, twice" rung of the trail); it widens nothing. No soft-constraint engine, no cross-day
   reach, no supernumerary promotion — each is its own later feature.
3. **The escalation log is derived, not a new aggregate.** A pure `escalationTrailFor(repo, shiftId,
   now)` projection (`src/asks/escalation-trail.ts`) reconstructs the trail from existing reads:
   asked/accepted/declined/silent from the seats' asks (`listAsksForSeat`), pool-widened/nudged from
   the one append-only reliability log (DEC-008) filtered by `metadata.shiftId`, exhausted from the
   distinct-pool `solveShift` (DEC-003). No `EscalationEvent` entity, no port method, no DDL, no
   adapter work — it crosses the in-memory→Postgres boundary for free. #41's At-Risk board reads it.
4. **The Tier-1-stall trigger lives in `tick`.** A `Filling` shift is *stalled* when it has unfilled
   required seats, every live ask has resolved declined-or-silent, and the horizon hasn't yet forced
   At-Risk. `tick` (DEC-023) detects it — reusing the `solveShift` exhaustion signal it already
   computes (the DEC-003 fix from 3.1a) — and fires a standalone `escalate(repo, shiftId, now)`. The
   shift stays `Filling`; At-Risk stays horizon/exhaustion-driven Tier 3.

**Why:** A second append-only log parallel to the reliability log is exactly the lock-in DEC-008 was
built to avoid; the transparency string is a read-model, so derive it. Relaxing hard rules is illegal
or physically impossible, so v1 has no soft levers — pretending otherwise means building an engine the
task can't afford.

**Tradeoff:** `pool_widened` is shift-scoped riding in a crew-keyed log, keyed to a `SYSTEM_ACTOR_ID`
sentinel — one wart, accepted over standing up a new aggregate. `escalationTrailFor` re-scans a shift's
seats/asks and the roster's logs per read rather than caching — cheap at BrewBoat's scale; revisit if
the At-Risk board ever sorts at DB scale (same trigger as DEC-022's stored-horizon revisit).

**Split:** #40 is honestly an 8, not a 5 — the unbudgeted stall-trigger design is the reason. Shipped
as **3.2a** (escalation substrate + trail projection — pure, additive, unblocks #41) then **3.2b**
(stall detection + `escalate()` in `tick`).

**Phase:** Phase 3 / task 3.2 (#40). (@architect pass, 2026-06-09.)

---

## DEC-025: At-Risk urgency encodes "captain > mate" as pool-thinness, not a role-name check

**Decision:** The At-Risk board's gap-severity term (SPEC §2.5 urgency model: "missing a **captain** —
small, fickle pool — outranks a **mate**") is expressed as **fillability/pool-thinness**: an unfilled
required seat's urgency scales with how few eligible candidates remain for it (the oracle's
distinct-pool solve, DEC-003), never with the seat's role name. The urgency blend is flat-additive —
time-to-trip + pool-thinness + a large regression constant — with weights as tune-later constants;
tests assert ordinal behavior (the §2.5 acceptance criteria), not exact scores.

**Why:** The spec's own rationale for captain-outranks-mate *is* the small pool — thinness is the
cause, the role name only its BrewBoat-shaped shadow. A role-name check is DEC-ROLE-1's explicit
anti-pattern (`if (role === 'captain')`) and breaks the moment a tenant defines a third role; thinness
ranks N roles generically and stays correct when a mate pool happens to be the thin one.

**Tradeoff:** If a tenant ever wants a role to outrank *despite* a deep pool (pure prestige, not
scarcity), thinness won't express it — that would need a per-RoleType weight (tenant config, DEC-001),
not a hardcode. Accepted: no such case exists in the spec.

**Revisit if:** A real tenant needs role-rank decoupled from pool size (add a RoleType weight then).

**Phase:** Phase 3 / task 3.3 (#41). (@architect pass, 2026-06-10.)

---

## DEC-026: Board ping = detection-now / delivery-later; lean = a manual nudge in the one log; reschedule/cancel render disabled

**Decision:** Three calls for the board surface + decision surface (#42/#43):

1. **"Landing on the board pings Spink" (§2.5) splits into detection + record + delivery.**
   Detection lives in `tick` (DEC-023's one clock op) and asks **the same `deriveAtRiskBoard` the
   page renders** — membership stays single-sourced, never a second hand-rolled check. The record is
   a `board_landed` reliability event, SYSTEM_ACTOR_ID-keyed per DEC-024's accepted wart, **deduped
   per (shift, reason)** so a rescued shift that later *regresses* re-pings while a same-reason
   re-landing stays quiet (accepted v1 wrinkle). Weighted 0 in the scorer. The derive runs AFTER the
   advance/escalate sweep — load-bearing order: a fresh Tier-2 nudge is a live ask, which keeps the
   shift off the board this tick. **Delivery is deferred to the DEC-MSG-3 pilot adapter** — the
   admin ping ships the same moment crew-ask delivery does (one line at the send site); it would be
   incoherent for the ping to get real delivery before the core ask. §2.5's "louder channel for
   regressions" stays open at the adapter.

2. **Lean (§2.5/#43) = `assignPerson` + `nudged{manual: true}`** against the board's `available`
   semantics (rankedEligible minus bailers minus live-ask holders; decliners stay leanable — that's
   Spink's call). No new event type — the `manual` metadata flag keeps "the human had to step in"
   distinguishable in the one log (DEC-008). A resting-`Bailed` seat is reopened on the way in (its
   empty-pool precondition no longer holds if a lean target exists). No bonus on the eventual yes —
   `escalation_accepted`/`at_risk_rescue` stay reserved (DEC-024 amendment); the lean-accept is the
   named future `at_risk_rescue` hook, derivable retroactively from the flagged log.

3. **Reschedule/cancel render disabled** with honest copy. The three-action set is binding
   (DESIGN-REFERENCE), but the cancel-cascade AC (§2.5) is explicitly deferred to the payments phase
   (P3 scoping, Drew) — a *live* cancel without its cascade would violate "cancel is never delete"
   far worse than a disabled button. The board's click-through lands on a **thin read-only §2.4
   render** whose badge is **resolved on read** (DEC-023 corollary — a page reached from a row that
   says At-Risk must not contradict it); the full cockpit is a later task.

**Tradeoffs:** same-reason re-landings don't re-ping (v1); `tick` gains a board derive per sweep
(BrewBoat-cheap; same revisit trigger as DEC-022/024).

**Phase:** Phase 3 / tasks 3.4+3.5 (#42/#43). (@architect pass, 2026-06-10.)

---

## DEC-027: Cockpit v1 — four manual actions over existing rails; implicit automation-pause confirmed as emergent; warming = board-complement derive; "fills by" deferred to the fill-deadline decision

**Decision:**

1. **The §2.4 cockpit ships four actions** — assign (`assignFromPool`, a new guarded wrapper:
   lean's accept set enforced per seat, so a crafted form post can't reach unlabeled override
   semantics), nudge (`lean`), confirm (`confirmSeat`), manual override (`manualOverride`, the
   **only** unguarded path — the label is the authority trail) — codes-in-params per DEC-026.
   Manual broadcast is deferred (the §2.4 broadcast AC is satisfied by the tick-fired path; a
   blanket re-broadcast to decliners is spam, not escalation); "widen" has no rail by DEC-024.

2. **The §2.4 open question on pausing automation is confirmed in build as *emergent*:**
   `escalate` fires only on a stalled shift with no live asks, and every manual assign/nudge
   *creates* a live ask; `broadcastAsk` fires only at the `Pending→Filling` birth inside `tick`
   (DEC-023). The autonomous tier is already incapable of fighting a manual placement — no pause
   flag, no resume action in v1. The explicit toggle is parked in FUTURE_IDEAS with the trigger
   "automation gains a lever that can act on a seat carrying a live manual ask."

3. **Warming (§2.4/#55) is a cross-shift pure derive whose membership is *candidate predicate
   minus `deriveAtRiskBoard` rows*** — board membership stays single-sourced (DEC-026), never
   re-approximated by state checks, so warming inherits the board's deliberate quiet zone
   (willingness-exhausted, trip far out) instead of double-reporting it. Negative-trend signals
   (conservative, anti-anxiety-dashboard): **ghosted** (≥1 silent ask) or **quiet** (asks out,
   none pending, still short). A **live ask is never a signal** — people mid-decision are the
   system working; the @architect draft's raw answered/asked rate was dropped because it reads 0%
   the instant a broadcast fires (instant-warm on every broadcast = the opposite of conservative).
   `responseRate` survives as a display fact over **settled** asks only. Opened deliberately
   (`?warming=1` link), never on the board, never pings.

4. **The cockpit header is honest about time:** the countdown is **"departs in"** (to
   `tripStart`) and the staffing horizon renders as a dated fact. The §2.4 "fills by" AC wording
   is deliberately under-shipped — the staffing horizon is when asks *start*, not a fill
   deadline, and a countdown to it reads "passed" for any shift being worked. The real
   fill-deadline concept is #59's decision (P3 board precedent: don't fake it in UI).

**Tradeoffs:** warming pays one board derive per open (BrewBoat-cheap; derived only when the
panel is opened; same revisit trigger as DEC-022/024/026). The assignment view now also feeds
pools to Asked seats (monitor transparency) and Bailed seats minus bailers (the P3 gap, closed),
and applies the intra-shift distinct-pool exclusion the actions enforce — one accept-set
definition across view, board, lean, and assign (the DEC-026 lesson).

**Phase:** Phase 4 / Unit B (#54/#55). (@architect pre-pass, 2026-06-11.)

**Amendment (Unit C, #56):** the cockpit's action inventory is **five** — "Reports a bail…" on a
Confirmed seat joins assign/nudge/confirm/override. Same `bail()` rail as the crew's own "can't
make it" (DEC-028); it is also the recovery path for a mis-tapped override (the v1 answer to the
@ui-reviewer's no-undo finding).

---

## DEC-028: Bail `latenessMs` is the notice shortfall vs the staffing horizon, clamped to it

**Decision:** `latenessMs = clamp(leadMs − (tripStart − now), 0, leadMs)` where
`leadMs = STAFFING_HORIZON_LEAD_DAYS` (DEC-022's one constant). Helper `bailLatenessMs` lives
beside the horizon functions in `src/builder/derive.ts`. Null trip start → 0 (no anchor, flat
penalty only). The raw signed **`noticeMs`** (`tripStart − now` at bail time) is logged alongside
in the event metadata — the derived value bakes in today's `leadDays`, and DEC-008 forbids
un-recomputable history (a shift's events can be rescheduled after the fact, so notice is not
re-derivable from `shiftId` later).

**Why this shape:** SPEC §1.4's signal is "how far in advance" — a week-out cancel is cheap (flat
`shift_bailed` weight only), the 11pm bail is near-max. Anchoring to the staffing-horizon lead
makes "late" mean *inside the window the system needs to refill* — one knob, already DEC-022's.
**Clamped past departure** because a post-departure report is `no_show` territory (a separate
event with its own weight, no caller yet), and an admin-lagged report must not penalize by report
latency.

**Computed server-side at bail time** from the shift's `earliestScheduledStart` — never
client-supplied (a crafted request must not shrink its own penalty). Accepted v1 caveat: an
admin-reported bail stamps lateness at *report* time, not when the crew member actually called;
the clamp bounds the damage.

**Phase:** Phase 4 / Unit C (#56/#57). (@architect pass, 2026-06-11. Closes the definition gap
DEC-019 left open; the *weight* per hour stays the DEC-TBD tune-later knob.)

---

## DEC-029: "Changed since you reviewed it" is a pure derivation — `max(reservation.updatedAt) > shift.lockedAt`

**Decision:** The SPEC §2.3 builder nudge ("a locked shift that absorbed a new/changed booking shows
this; it is never silently altered") is **derived, never a stored/dismissable flag** (DEC-005 house
style). A shift shows the nudge iff it is locked AND any reservation on its events has an `updatedAt`
strictly after `lockedAt`. Helper `changedSinceReviewed(shift, reservations)` lives in
`src/builder/lock.ts` beside `isLocked`/`lockShift`. **Re-lock advances `lockedAt` → clears** (the
honest "I've re-reviewed it"). Unlocked shifts never nudge — they absorb quietly (§2.3).

**The comparand:** a new `Reservation.updatedAt` (ISO-8601 UTC, optional; `updated_at` nullable text
— migration 0004). Stamped by the import (`importReservations`, the only writer; `now` injected — the
core never reads the clock) on **create + material change only**, guarded by a field-equality check
(`reservationMateriallyChanged`: eventId/customerName/partySize/status/email — phone excluded, it's
joined later per DEC-017). The guard is load-bearing: without it a blind re-import bumps every row and
every locked shift cries wolf, so the operator learns to ignore the nudge. Absent `updatedAt` =
predates tracking → older than any lock → never nudges (no backfill).

**Why `updatedAt`, not `createdAt`:** `createdAt` catches only *new* bookings; SPEC says "new **or
changed**," and the import flips `booked→cancelled` and absorbs party-size edits in place — the
cancellation is the whole "don't blindside Spink at the dock" case. Same column count, honest instead
of half-honest.

**Knowingly excluded in v1:** **capacity-only event edits** (the import overwrites event capacity
silently — already flagged in-code as authoritative-for-now; revisit with DEC-016 capacity
validation). Event **time/date** edits ARE caught for free — event identity is
`evt-${vesselId}-${date}-${time}`, so a time/date change re-keys the event, rewriting each
reservation's `eventId` as a material change. Render is one read-only `Notice tone="warn"` line on
the assignment cockpit header (DEC-026 on-pattern; no new builder surface — the issue's hard scope
caution, since no builder UI exists yet).

**Phase:** Phase 4 / Unit E (#58, task 4.6). (@architect pass — Fable — 2026-06-11. Amended the
original `createdAt` proposal to `updatedAt` + the materiality guard.)

---

## DEC-030: Pilot channel = operator-relayed web link; the outbox is adapter state, never domain state

**Decision:** The DEC-MSG-3 pilot adapter is the **web-link relay**: `ChannelPort.send` does not
transmit — it enqueues an **`OutboxEntry`**, and the operator works a mobile **outbox page**
(`/admin/outbox`) where each pending ask is an **`sms:` deep-link Send button** (RFC 5724;
`buildSmsUrl`/`normalizePhone` ported from Bushel's send-queue) that opens the native Messages app
prefilled with the crew member's number, the ask body, and a magic link to the In/Out screen. The
crew member taps → lands authenticated → answers through the existing `recordResponse`. **No
Twilio, no inbound webhook.** The binding mechanics:

1. **Outbox state is adapter-side.** `OutboxEntry` `{id, askId, seatId, crewMemberId, body, link,
   status: pending|sent, createdAt, sentAt?}` is persisted via the Repository port (the `MagicToken`
   precedent), but the domain `Ask` is UNCHANGED and **nothing in `src/asks`, `src/builder`, or
   `src/oracle` may read outbox state** — only the adapter, the `outbox-view` read-model, and the
   outbox page. That guardrail is what keeps the Twilio swap a zero-domain-change drop-in (DEC-MSG-1).
2. **Mint at enqueue, render verbatim forever.** The magic link (**24h TTL** — the ask's answer
   window; the 15-min TTL stays dev-link-only) is minted inside the adapter's `send` and frozen
   onto the entry with the body — a page refresh must never re-mint and desync from what was
   already texted. Accepted tradeoff: the raw link (secret included) lives in `outbox_entries.link`
   — a DB leak yields live relay links, bounded by the 24h TTL + single-use consume; unavoidable if
   the operator is to re-render exactly what they texted.
3. **`SendResult.deliveredAt` = enqueue time.** The operator's physical text is `sentAt`,
   channel-side bookkeeping the domain never reads.
4. **Prefetch-safe consume.** Relay links travel through iMessage/Android SMS whose link-preview
   bots GET URLs before the human taps. `/crew/auth` GET now **peeks** (`peekMagicLink` — verify
   without consume, pure reads) and renders a "Tap to sign in" button; the **POST** consumes
   (single-use CAS), mints the session, 303-redirects. A bot can render the page forever; only the
   human's tap spends the token.
5. **Single-click Send — the one `'use client'` exception (DEC-026), progressively enhanced.**
   Send is an `<a href="sms:…">`: with NO JS the composer still opens via the native anchor (the
   graceful baseline). When hydrated the `onClick` takes over and **owns the order**:
   (1) `flushSync` the optimistic flip to a white **Resend** + "sent · &lt;time&gt;" (committed to
   the DOM synchronously, else the `window.location` hand-off occasionally wins the race and the
   flip never paints before the app switches to Messages),
   (2) `await recordSent` (no-redirect, no-revalidate server action) so the write FINISHES, then
   (3) open the composer via `window.location`. The order is load-bearing: opening the `sms:`
   composer is a navigation that **aborts an in-flight request** — a fire-and-forget `recordSent`
   got killed mid-flight ("Failed to fetch") and never persisted. The write is one quick local
   query and the flip already painted, so the wait is invisible; if it fails we open the composer
   anyway (the text matters most — Resend is the recovery). `components/outbox/relay-send.tsx` is
   the deliberate lone client island; everything else stays server-rendered. "Sent" means "you
   fired Send," not proof of delivery. No separate un-send (the operator asked for one tap).
   *Two dev-env gotchas, both fixed: (a) the app's first client component needs a `next dev`
   rebuild/restart to hydrate — Fast Refresh won't wire a brand-new client boundary into a running
   server; (b) Next 16 refuses HMR/hydration to non-localhost origins not in `allowedDevOrigins`
   (we reach dev via the Tailscale host `mill-dev` — see `next.config.ts`).*
6. **Channel wiring lives at the EDGE.** The fire paths surface their asks as return values
   (`TickResult.firedAsks`, `EscalateResult.asks`, `LeanResult.ask`, `BailOutcome.reAsks`) and the
   edge callers (app actions, the tick trigger) forward them via `forwardAsks` → the injected
   adapter, one line each. The channel is never threaded through the core ask loop; the forwarding
   glue is the durable part Twilio reuses verbatim. Forwarding is best-effort — the domain action
   already committed; a channel hiccup must not become a 500.
7. **Operator-as-crew.** One tenant-config value, **`OPERATOR_CREW_MEMBER_ID`**
   (`app/lib/operator.ts`, env-overridable constant — NOT a handle-keyed map; admin handles are
   free-form non-identities per DEC-020 and the session stays single-subject). An outbox ask whose
   `crewMemberId` matches renders **inline In/Out** instead of an `sms:` link — inline-or-relayed,
   never both (kills the double-answer race). The inline action is guarded by `recordResponseAs`,
   which refuses any ask not addressed to that identity (reliability-log integrity, DEC-008 —
   mirrors the crew app's ownership gate).

**ACCEPTED:** pilot `latencyMs` (ask `sentAt` → response) includes the **operator's relay delay** —
the clock starts when the ask fires, not when the text goes out. Scores are MVP-flat (DEC-008), so
nothing reads the skew yet, and it dies at the Twilio swap when `send` actually transmits.

**Phase:** Phase 4 / 4.1 (#53). (@architect passes — Fable — 2026-06-11.)

---

## DEC-031: "Fills by" = the fill deadline — `tripStart − FILL_DEADLINE_HOURS`, derived, bound to the escalation threshold

**Decision:** The "fills by" deadline (SPEC §2.4/§2.5; the AtRiskRow's right column + the cockpit
header — both deferred to here by DEC-027 §4) is **`earliestScheduledStart − FILL_DEADLINE_HOURS`**,
computed on read beside `staffingHorizonFor` in `src/builder/derive.ts` (DEC-022's rule verbatim:
**derived, never stored** — a stored deadline goes stale exactly when events reschedule; no new
column, no migration). The binding mechanics:

1. **One constant, not two.** `FILL_DEADLINE_HOURS` (in `derive.ts`) **is** the board's
   willingness-exhaustion threshold — `at-risk-board.ts` re-exports it as `EXHAUSTED_THRESHOLD_HOURS`
   (the identifier kept for the existing suite; the binding is the decision, the name is detail). So
   the rendered "fills by" is **definitionally** the instant a still-short shift escalates to Spink:
   the display and the escalation rule cannot drift. The board threads its `deadlineHours` opt into
   the `fillsBy` it computes, so a test/tuning override moves both together.
2. **NOT the staffing horizon.** The horizon (DEC-022, 3.1a) is `tripStart − 7d` — the window's
   *opening* (`Pending→Filling`), already in the past on every actively-worked shift. "Fills by" is
   the window's *closing* checkpoint. SPEC's "staffing-horizon deadline" reads as the closing item
   of DEC-004's checkpoint **list** (deliberately a list-of-one, room for staged checkpoints); Pass
   D's progressive commitment slots in later as `list.last()`, without generalizing the list now.
3. **Null = absence, past = overdue.** `null` when no scheduled event anchors the shift — rendered
   as absence, never faked (the P3 "don't fake a domain concept in the UI" line, held). A willingness-
   exhausted shift boards only *after* its fills-by passes, so those rows read **overdue** by
   construction — the UI renders that honestly (`· overdue`), never clamped at zero.
4. **Multi-trip times** (the #59 board follow-up): `AtRiskRow.tripStarts` carries **every** scheduled
   departure (earliest first; `tripStart` is `[0]`) so a two-trip day shows both times — P3 rendered
   only the earliest. The fill deadline still anchors to the earliest departure (the first trip is
   the one that must be crewed first). The cockpit already rendered all trips via `view.trips`.
5. **Code constant now, tenant config later** — same posture as `STAFFING_HORIZON_LEAD_DAYS`
   (DEC-001: policy is tenant-owned data eventually). Tenant-level, **not per-vessel, not per-shift**
   — no evidence yet that the lead varies. Default ships at **48h** (inherited from DEC-025's
   tune-later willingness threshold; this DEC fixes the *definition*, not the number).

**Rejected:** *call-time-minus-prep* (needs per-trip call-time/prep data that doesn't exist — the
45-min same-day manifest lead is a different lead for a different purpose; per-vessel prep buffers →
FUTURE_IDEAS). *A standalone tune-later constant* (the operator's first instinct) — correct in shape
but it would mint a twin of the escalation threshold and let the UI and the escalation rule drift;
binding to the existing constant is the same instinct done coherently.

**Revisit if:** Pass D's staged checkpoints land (fills-by becomes the list's last checkpoint); a
tenant needs per-vessel prep buffers or call-time-based deadlines (FUTURE_IDEAS); or the 48h value
needs tuning (the number, not the definition).

**Phase:** Phase 4 / 4.7 (#59). (@architect pass — Fable — 2026-06-12.)

---

## DEC-032: Vessel-local time — wall-clock storage + one tenant timezone, NOT stored instants

**Status:** DECIDED — Phase 5 / 5.3 (#77), 2026-06-12. (@architect design + operator confirm.)

**Decision:** Times stay stored as **vessel-local wall-clock** (`Event.date`/`Event.time` already are — the vessel-day shift grouping depends on it) and are interpreted + rendered in the **vessel's** timezone — **never the viewer's** (confirmed: crew on the dock and the operator on the phone, even from another zone, both read the same boat-time). One tenant IANA tz in **`src/config/tenant.ts`**: `TENANT_TIMEZONE = process.env.TENANT_TZ ?? "America/New_York"` — **env-overridable** per deploy; code-constant/tenant-config-later (DEC-001 posture, like `STAFFING_HORIZON_LEAD_DAYS`). BrewBoat is **Eastern** (the Seattle seed dock was placeholder — updated to NY). The mechanics:

1. **One mint seam.** `zonedWallClockToInstant(date, time, tz)` (`Intl`-based, DST-correct, **no new dependency**) replaces the `eventStart` UTC parse in `src/builder/derive.ts`. Every departure instant is born true, so all downstream math vs a real `now` (hoursToTrip, fills-by, horizon birth, bail lateness, "departed") self-corrects. `tz` threads as an optional param (default `TENANT_TIMEZONE`) through `earliestScheduledStart`/`scheduledStarts`/`staffingHorizon*`/`fillDeadline*` and the read-model entry points (`deriveAtRiskBoard`/`deriveWarming`/`buildOutboxView`/`buildAssignmentView`/`buildCrewAppView`/`tick`/`bailWithDerivedLateness`) — exactly like `leadDays`. Prod gets Eastern by default; the engine tests pin `tz: "UTC"` to keep fixtures deterministic.
2. **Render in vessel tz.** Formatters of an event-derived instant (`app/lib/format.ts` `fmtDeadline`, the board `fmtTime`, the cockpit horizon line) format with `TENANT_TIMEZONE` so the true instant displays the dock wall-clock. Raw `event.time`/`callTime`/`departureTime` strings shown verbatim are **unchanged** — already vessel-local.
3. **Credential date boundary** (`mmcValidOnDate`): a pure **date-only ISO-string comparison** (`expiry >= tripDate`) — `YYYY-MM-DD` sorts lexically = chronologically, so it is **timezone-invariant by construction**, no `new Date`, no day-shift. (Chosen over a `startOfDayInstant` conversion — simpler and unambiguous.)
4. **Crew "today"** (`crew-view`): the past-shift filter uses `vesselDateOf(now, tz)` (the vessel-local calendar date), not `now.toISOString()` (UTC, a day ahead in the evening Eastern hours).

**Rejected:** "store true instants" — breaks the vessel-day grouping model and forces a DDL migration; the one-seam conversion achieves correctness without it. **Viewer-local rendering** — rejected; vessel-local for everyone is simpler and matches the dock. **Why it matters:** DEC-022's "render everything UTC" v1 simplification showed an Eastern 6:50 AM departure as a wrong wall-clock — on the exact surface (the shift card) whose job is call-vs-departure clarity. **Revises DEC-022.** Gate for real Xola data (5.4). No DDL, no port change, no new dependency.

---

## DEC-033: Hosted deploy — provider pick (OPEN), Vercel topology, `tick` cron, `production` branch

**Status:** Proposed (Phase 5 / 5.1) — @architect 2026-06-12. **Provider sub-decision OPEN (owner/Eric — money + account lead time).**

**Decision (proposed):** First hosted deploy — fires the deferred triggers: DEC-020 (host deferred to "first task needing a real URL" — crew phones need one), DEC-023 (wire the `tick` cron caller at first deploy), DEC-S022 (`production` branch adopts here). Next app on **Vercel** (`next build --webpack`, DEC-020); a **CRON_SECRET-guarded cron route** calls `tick` on a schedule (`now` injected) so the engine self-advances unattended — without it a deployed Muster never ticks, failing "no babysitting"; `production` branch + `/promote-production` stand up per DEC-S022.

**OPEN — hosted Postgres provider:** candidates Supabase (CLAUDE.md-named candidate, *not adopted*), Neon, Railway, etc. Owner decision (cost + account lead time) — **the phase's long pole; decide before 5.1 builds.** The in-memory adapter stays as the test substrate (DEC-DATA-1). The schema is plain Postgres DDL — vendor-agnostic behind the port.

---

## DEC-034: Production auth path — operator link mint, dev-link stays 404, NO email provider

**Status:** Proposed (Phase 5 / 5.2) — @architect 2026-06-12; confirm at build.

**Decision (proposed):** The operator signs in to the deployed app via a **prod-minted magic link** (a bootstrap/mint script against the prod DB, or a one-time env-seeded link) — `/crew/dev-link` keeps its hard `NODE_ENV==='production'` **404**. **Crew** links need no new work: they already flow through the DEC-030 outbox relay. Resolves the "no production auth path" tell of #70 (the Twilio swap + single-operator constant tells stay deferred — this is a *hosted pilot*, not production).

**Rejected:** an email/magic-link **delivery provider** — fails the dependency bar (the relay + a mint script get there with what we have) and it's a vendor pick the pilot doesn't need.

---

## DEC-035: Xola import surface — import→formShifts chaining, re-import idempotency, upload security

**Status:** Proposed (Phase 5 / 5.4, #73) — @architect 2026-06-12; confirm at build (@architect + security pass in-PR).

**Decision (proposed):** Operator-facing `/admin/import` (admin-session-gated, 375px): upload `.xlsx` → **preview + validate** (unmapped products quarantined via `product-map.ts`, bad dates/missing fields surfaced) → confirm → `importReservations` (events + reservations) **then `formShifts`** (shifts + seats) so the board is live immediately. **Open at build:** re-import semantics for an overlapping week (upsert vs dupe — needs a rule); upload security posture (first file-upload surface — size/sheet/scope limits, no formula eval). Gated on DEC-032 (real Pacific times must render correctly before real data reaches crew). #73.

---

## DEC-TBD: Open questions (carried from the spec; not Claude's to set alone)

These are deferred by design. Each names an owner and a trigger. **Consult @architect (and the named
human owner) before building past the trigger.**

- ~~**Stack / framework / DB / host @ M4** — the DEC-013 decision itself. *Trigger: task 1.5a.*~~ — **RESOLVED by DEC-020** (Next.js/Vercel; Postgres-behind-the-port, host deferred; self-rolled magic-link; no platform adopted).
- ~~**SMS + push provider, and native vs PWA**~~ — **RESOLVED** by DEC-MSG-1 (SMS = eventual
  production adapter, not in the slice) + DEC-MSG-2 (native Capacitor, de-prioritized) + DEC-MSG-3
  (one port; fake + pilot adapters at M4). Remaining: operator picks the pilot adapter (web-link or
  Telegram) at M4; Twilio + 10DLC confirmed at the later adapter swap.
- **Deposit-vs-full payment & refund-schedule numbers** — *Owner: Drew. Recommendation: full upfront
  for v1. SPEC §4. (Payments are out of the 2026 build entirely — build plan §6.)*
- **Credit-vs-cash default ordering** in the cancel flow — lean credit-first, cash always available.
  *Owner: Drew.*
- **Which "M" (soft) rules ship** for BrewBoat v1 (TWIC, medical, drug consortium, duty-hour,
  weather/tide) — *Owner: Spink/Drew against real operations. SPEC §1.3.*
- **Concrete horizon values** — how many days is the staffing horizon? *Ship a dumb default, tune.
  SPEC §4.* **(Where the value lives is now fixed by DEC-022 — a single `leadDays` config constant;
  only the number remains tune-later. Default ships at 7d in task 3.1a.)*
- **Reliability weights** — bail-lateness curve, ack weight, decay. *Flat v1; tune in Pass A. SPEC §1.4.*
- **Event-Admin merge rule** — manual entries vs CSV re-import reconciliation. *Default "manual wins,
  flag conflicts"; refine against a real export. SPEC §2.2.*
- **"Exhausted" threshold** (when a shift lands on the At-Risk board) and the **split-suggestion gap
  threshold** — *keep the bar high; tune later. SPEC §2.5, §2.3.* **(Where the value lives is now
  fixed by task 3.3 — `EXHAUSTED_THRESHOLD_HOURS` in `at-risk-board.ts`, gating willingness-exhaustion
  only; eligibility-exhaustion boards immediately. Default ships at 48h; only the number remains
  tune-later. Split-suggestion gap still open.)*
- **Historical Xola data** — migrate vs read-only archive. *Leaning archive. SPEC §4.*
