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

> **Superseded display (DEC-038):** the concept and code symbols (`fillsBy`, `FILL_DEADLINE_HOURS`) are unchanged, but the **board no longer renders this line** (moot once a shift boards) and the **cockpit relabels it "deadline."** The mechanic below — displayed instant == willingness-exhaustion boarding instant — still holds.

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

**Decision:** Times stay stored as **vessel-local wall-clock** (`Event.date`/`Event.time` already are — the vessel-day shift grouping depends on it) and are interpreted + rendered in the **vessel's** timezone — **never the viewer's** (confirmed: crew on the dock and the operator on the phone, even from another zone, both read the same boat-time). One tenant IANA tz in **`src/config/tenant.ts`**: `TENANT_TIMEZONE = process.env.TENANT_TZ ?? "America/New_York"` — **env-overridable** per deploy; code-constant/tenant-config-later (DEC-001 posture, like `STAFFING_HORIZON_LEAD_DAYS`). BrewBoat is **Eastern** — the fleet runs out of **Cleveland** (East Bank of the Flats at Canal Basin Park, on the Cuyahoga); the Seattle seed dock was placeholder. The mechanics:

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

**Status:** Accepted (Phase 5 / 5.2, #76) — @architect 2026-06-12; confirmed at build 2026-06-15.

**Decision:** The operator signs in to the deployed app via a **prod-minted magic link** — `db/mint-link.ts` (`npm run db:mint -- --admin=<handle>`), a bootstrap script run against the prod DB exactly like `db:migrate`. `/crew/dev-link` keeps its hard `NODE_ENV==='production'` **404**. **Crew** links need no new work: they already flow through the DEC-030 outbox relay (the script's `--crew=<id>` is a manual escape, not the normal path). Resolves the "no production auth path" tell of #70 (the Twilio swap + single-operator constant tells stay deferred — this is a *hosted pilot*, not production).

**Build specifics (confirmed 2026-06-15):** link TTL defaults to **60 min** (`--ttl-min` override) — longer than dev-link's 15 because the operator copy-pastes the URL out-of-band; still single-use. The script **requires `APP_BASE_URL`** and refuses to mint without it: a CLI has no request Host header to fall back on, and a link on the wrong origin is host-spoofable / unopenable (the footgun `app/lib/base-url.ts` documents). No new test — ops tooling alongside `db/tick-dev.ts` / `db/seed-*.ts`; the minted core (`issueMagicLink`/`randomSecret`) is covered in `src/auth/magic-link.test.ts`.

**Rejected:** an email/magic-link **delivery provider** — fails the dependency bar (the relay + a mint script get there with what we have) and it's a vendor pick the pilot doesn't need.

---

## DEC-035: Xola import surface — import→formShifts chaining, re-import idempotency, upload security

**Status:** Proposed (Phase 5 / 5.4, #73) — @architect 2026-06-12; confirm at build (@architect + security pass in-PR).

**Decision (proposed):** Operator-facing `/admin/import` (admin-session-gated, 375px): upload `.xlsx` → **preview + validate** (unmapped products quarantined via `product-map.ts`, bad dates/missing fields surfaced) → confirm → `importReservations` (events + reservations) **then `formShifts`** (shifts + seats) so the board is live immediately. **Open at build:** re-import semantics for an overlapping week (upsert vs dupe — needs a rule); upload security posture (first file-upload surface — size/sheet/scope limits, no formula eval). Gated on DEC-032 (real Pacific times must render correctly before real data reaches crew). #73.

---

## DEC-036: Live Xola API import — Land adapter behind existing Map/Reconcile; supersedes DEC-011's API kill

**Status:** Proposed (Phase 5 / reframes 5.4, #73) — @architect 2026-06-15 (Opus; Fable unavailable). Confirm at build; **two field-shape confirmations deferred to build (below).**

**Decision (proposed):** The 2026 coexistence import gains a **live Xola API Land adapter** as the primary ingest, replacing the manual `.xlsx` export+upload. **Everything downstream of the Land seam is unchanged** — `importReservations`'s Map+Reconcile (event upsert by `evt-${vesselId}-${date}-${time}`, identity on `Reservation ID`, `updatedAt` materiality per DEC-029, `resolveProduct` quarantine per DEC-018) stays as-is. The client (`X-API-Key`/`X-API-Version` auth, skip-pagination, 429/5xx retry, DST-aware date windows) is **ported from the sibling `xola-tip-extractor` (`netlify/functions/lib/xola.js`) into strict TS/NodeNext** — **`fetchOrders` + `fetchEvents` only**; the gratuity / tip-split / guide machinery is left behind (not Muster's job — payments parked, SPEC §4).

**Scope (operator's call, 2026-06-15) — bare pull, review surface deferred:** pull → `importRecords` → `formShifts` → board live, with minimal preview. The full preview / validate / quarantine **review surface of DEC-035 is deferred** (commits closer to blind — an accepted tradeoff for the fastest path to a working pilot). The **xlsx reader is retained** as the Xola-downtime fallback (an API pull can 503 on a crew Saturday; a file upload can't).

**Land seam — build (B):** split `importReservations` into `decodeXlsxRows()` + `importRecords(repo, records, now)`; the API adapter maps JSON straight to a `RawReservationRecord[]` intermediate and calls `importRecords`. Chosen over the fake-header shim (A) because the API returns true instants — re-stringifying them into `"03:30 PM"` for re-parse would throw away DEC-032's vessel-local correctness at the seam.

**Field mapping (spike, 2026-06-15 — Xola Purchase `expand`):**
- contact (`customerName` / `email` / `phone`) ← `expand=organizer` (the booking account — *not* `travelers`, who are the participants).
- event link / arrival date+time / per-item status ← `expand=items` (`items[].event`, `items[].arrival`, `items[].status`; codes 200–203 booked, 700 cancelled).
- `partySize` ← `expand=travelers` (count) **or** `items[].quantity` — **confirm which at build.**
- **Confirm at build** (one live `?expand[]=organizer&expand[]=items&expand[]=travelers` response settles both): (1) is `organizer.phone` actually *populated*, not just present in the schema? (2) the party-size source. The list endpoint (the extractor's `/orders`) takes the same `expand`.

**Supersedes DEC-011's API kill** — and corrects SPEC §4 "Explicitly killed · The Xola API bolt-on" (a DEC-014 correction). DEC-011 killed the API believing it unreliable / hard to extract from (traced to faulty "crewbook" info) — **falsified** by a working, tested client proven live 2026-06-15. DEC-011's *other* leg (the ~18-month kill date / disposability) **stands, and is what licenses this**: a finished, quarantined adapter is as disposable as the xlsx reader it replaces, dying in 2027 with the rest of the import path (SPEC §0.3). The **manual guide write-back sheet (§3.5) is unaffected** — this is read-only ingest, no writes to Xola.

**Relationship to DEC-015 / 017 / 018 / 032 / 035:**
- **DEC-015 holds** — Land→Map→Reconcile quarantine is the architecture; this is a second Land adapter, exactly the case it anticipated.
- **DEC-017 (phone email-join): revision unblocked, pending confirm.** If `organizer.phone` comes back populated inline, the separate customers-export email-join dies. Until confirmed, phone stays nullable (DEC-017's existing model) — a missing phone degrades, never blocks.
- **DEC-018 (product map): holds.** Its "stable vessel/product ID" revisit trigger is now *reachable* via the API's `event.id` / listing ids → parked to FUTURE_IDEAS, **not** done in the pilot. Quarantine-unconfirmed-products stays mandatory.
- **DEC-032 (vessel-local time): preserved** by seam (B) — true instants flow through rather than being laundered into ambiguous wall-clock strings.
- **DEC-035: reframed, not deleted** — its `/admin/import` review surface is deferred per scope above; the `import → formShifts` chaining it specified is reused.

**Credentials:** `XOLA_API_KEY` / `XOLA_API_BASE` / `XOLA_SELLER_ID` — server-only env (never `NEXT_PUBLIC`), read-scoped key, admin-gated route. The I/O-bearing fetch lives at the Next edge, not the framework-free core (DEC-020).

**Open at build:** the two field confirmations above; placement of the client (Next edge vs `src/import/`); re-import idempotency for an overlapping week (carried from DEC-035). (@architect pass — 2026-06-15, Opus.)

---

## DEC-037: Task #73 (5.4) splits — xlsx import surface first (5.4a), Xola API Land adapter fast-follow (5.4b); review surface stays deferred

**Status:** Accepted (Phase 5 / 5.4) — @architect 2026-06-16 (Opus; Fable unavailable). Confirmed at build, single-step result + Vercel-safe reader folded in (operator's call, 2026-06-16).

**Decision:** Task #73 splits in two.
- **5.4a (xlsx surface, build first):** split `importReservations` → `decodeXlsxRows(rows): { records, warnings, skipped }` + `importRecords(repo, records, now): ImportResult` (the DEC-036 (B) seam, on a `RawReservationRecord` intermediate with **already-normalized** ISO date + clock-time). Build admin-gated `/admin/import` (Server Component + `readSubject` gate + DEC-026 redirect-param feedback) — **single-step**: upload `.xlsx` → `importRecords` → `formShifts` → result summary. Includes the first upload-security pass.
- **5.4b (fast-follow, creds in hand 2026-06-16):** port `fetchOrders`/`fetchEvents` from `xola-tip-extractor` into strict TS **at the Next edge** (I/O-bearing, not the framework-free core — DEC-020), map JSON → `RawReservationRecord[]` → the **same** `importRecords`; resolve DEC-036's two field confirmations against a live response.

**Sequencing rationale (a change from DEC-036's "API primary," NOT a scope reversal):** the xlsx core is built + tested and needs no new dependency or credential; the API path is greenfield (PR #81 was docs-only) and was gated on live Xola creds. xlsx-first unblocks the real-crew weekend off the critical path of an external credential. DEC-036 already **retains the xlsx reader as the permanent downtime fallback**, so 5.4a builds a kept path, not a throwaway. The seam (`RawReservationRecord` + `importRecords`) is built once in 5.4a and reused in 5.4b — each Land adapter normalizes before the seam (xlsx parses strings; the API maps instants → vessel-local per DEC-032), so neither launders instants through wall-clock strings.

**Build decisions (2026-06-16):**
- **Single-step, not two-phase preview→confirm.** No-client-JS makes a true pre-commit file preview awkward; import is idempotent (upsert by `evt-`/`resv-` identity, DEC-029 materiality) and unmapped-product rows are **skipped, never mis-imported**, so committing "closer to blind" is safe and re-import is the undo. DEC-036 already licensed minimal-preview / commits-closer-to-blind.
- **Result surface carries counts only** (DEC-026: codes/ids in redirect params, never prose). Quarantined product **names** go to **server logs** (`console.warn`) for the dev — there is no product-mapping UI (the map is code), so the operator can't self-fix an unmapped product anyway; the visible count ("P rows skipped") + the dev's log read is the pilot answer. A richer in-surface quarantine list is a noted follow-up.
- **Vercel-safe xlsx reader (folded into 5.4a).** `xlsx-extract.ts` shelled out to the system `unzip` binary (absent on Vercel's Node runtime → an import green locally would ENOENT in prod, i.e. fail during the crew test). Rewritten to **pure-Node** (`node:zlib` `inflateRaw` + a minimal ZIP central-directory parse — no new dependency, stays core-framework-free) and **buffer-based** (parses the upload in memory, no temp file). Upload security: magic-byte type check (`PK\x03\x04`, not extension), hard size cap, per-entry decompressed-size cap (zip-bomb guard via `maxOutputLength`), Reservations-sheet only, no formula/macro eval (the regex reader never evaluated — kept that way).
- **Event-cancellation propagation (architect landmine #1, fixed not deferred).** Nothing in the codebase ever set `event.status = "cancelled"` — the import always wrote `"scheduled"` — so `formShifts`' all-cancelled→Cancelled path never fired from the import chain, and a re-import that cancelled out an event left a live "ghost" shift (crew asked for a dead trip). `importRecords` now derives `event.status` per upsert: an event with ≥1 booked reservation is `scheduled`, an event whose every reservation is cancelled is `cancelled` → `formShifts` cancels its shift. (An event that *disappears* from a later export — vs appearing with cancelled rows — is still not reconciled; noted, out of pilot scope.)

**Open / deferred:**
- **Capacity-stomp on re-import** noted, not fixed (import overwrites `event.capacity` each run; no COI-correction UI yet — DEC-016).
- **DEC-035's full preview/validate/quarantine-review surface** stays deferred.
- The two DEC-036 field confirmations + the API client → **5.4b** (creds in hand).

**Relationship:** DEC-036 holds (API is the eventual primary; this only sequences it second). DEC-035 deferred. DEC-015 Land→Map→Reconcile is the architecture; both Land adapters feed one Reconcile.

---

## DEC-038: Pilot-walkthrough UX/copy revisions (operator review of the slice-1 surfaces)

**Context.** A click-through of `E2E-PILOT-WALKTHROUGH.md` with the operator surfaced ~17 findings. Most are copy (operator vocabulary over dev/brand jargon); four are design-bearing and recorded here. The copy set is applied as-is (label-only, no logic).

**Decisions:**

1. **My-shifts shows `Claimed`, not just `Confirmed` (#4).** A crew "In" lands the seat at `Claimed` (awaiting operator confirm), and the old my-shifts list was `Confirmed`-only — so a fresh "In" vanished with no feedback. My-shifts now includes `Claimed` seats, rendered as a **non-link** row badged *"Awaiting confirmation"* (the shift card + bail remain `Confirmed`-gated, so a claimed seat has no card to open yet). The full claimed-shift card + claim-rescind is a deferred follow-up.

2. **Bail copy is horizon-aware (#6/#7).** The "can't make it" text branches on whether a bail *now* falls inside the staffing horizon — reusing **DEC-028**'s `bailLatenessMs > 0`, no new constant. Graceful (notice ≥ horizon): *"…the sooner you tell us, the easier it is to refill…"*. Late (inside horizon): *"This shift is soon — …call your operator right away…"*. Still **no time gate** — the drop always goes through (DEC-019); the copy only adjusts tone. The old line asked crew to judge "if there's still plenty of time" — information they can't see — and is removed.

3. **"Fills by" leaves the At-Risk board; stays in the cockpit, relabeled "crew by" (#12/#15).** Amends **DEC-031** (which put the deadline on *both* surfaces for consistency). Operator rationale: once a shift is **on the board, the automation has already given up and a human must act** — the deadline is moot there, and "· overdue" is tautological (a willingness-exhausted row boards *because* the deadline passed; an eligibility-exhausted row boards regardless of it). The trip countdown already carries the only urgency acted on. The deadline remains meaningful in the **cockpit**, where a still-`Filling` shift is worked *before* it boards; there the label changes from "fills by" (read as a promise) to **"deadline"** (plainest — chosen over "crew by" when seen live next to "staffing: started"). DEC-031's mechanic — the displayed instant IS the willingness-exhaustion boarding instant — is unchanged; only board *display* and the cockpit *label* move.

**Copy set (applied, label-only):** board header "Needs you"→"Needs attention" (the board is the one surface that legitimately summons — the anti-anxiety-dashboard principle is about *other* surfaces); "need a call"→"need attention"; "all asks dry"→"no takers"; "not yet worked — flagged by the oracle"→"no one eligible to ask"; shift-card "Be there (call)"→"Shift Start"; bail "seat"→"shift"; drop the static "Muster · now" ask eyebrow; trim the reschedule/cancel note (why → button title); board departures move under the date (all trip times); the whole app renders **12-hour** clock times (crew card + cockpit; a 12h↔24h preference is parked); cockpit header "fills by"/"crew by"→**"deadline"** + "**staffing** started:"; drop the cockpit's "automation works this shift…" intro paragraph; drop the misleading ✕ on the Bailed-seat banner. **Deferred:** the board "Assignment ↗" link label (revisit after the cockpit is worked in Part 3).

4. **Bailer shown in the seat's pool as `bailed` (#3.3, clarifies DEC-019).** A Bailed seat's cockpit pool now **lists its own bailer** as a non-actionable `bailed`-status row (named, no Ask/Nudge), instead of a "(the bailer isn't offered)" banner aside. DEC-019's exclusion is about the **re-ask** (never auto-offer a fresh bailer), not about hiding them — so showing them as context, with no action, honors it while being more transparent (and consistent with the asked/declined/silent status pattern). Manual override still places anyone (authority backstop), unchanged.

**Relationship:** amends DEC-031 (fills-by display/label); builds on DEC-028 (bail lateness) and DEC-019/DEC-007 (claim vs confirm). No change to seat/shift state machines or the scoring.

---

## DEC-039: Confirmed-seat vacate splits into Remove (no penalty) vs Bailed (logs lateness) (#87)

**Context.** Vacating a confirmed seat carried one control (the DEC-038 "Remove from shift…" disclosure → "Remove"), and it *always* logged a reliability bail (DEC-028). But two genuinely different operator actions hide behind it, differing only in whether a bail is logged: a **misassignment** (Spink placed the wrong person — clear and re-ask, *no* penalty) vs a real **bail** (the crew member backed out — clear, re-ask, *log* the lateness). With one always-penalizing button, an accidental misassignment couldn't be undone without wrongly dinging the crew member. (Manual override already displaces a *replacement* silently with no bail; the gap was specifically remove-with-no-replacement, no penalty.)

**Decision.** Two buttons on the confirmed-seat card, an **explicit operator choice — never a default checkbox** (a wrong default either starves the reliability log or wrongly penalizes):

1. **Remove** (no penalty) — new core `vacateSeat()`: the `bail()` body **minus `logShiftBailed`**. Drops the occupant, re-asks the next candidates (the removed person excluded from the immediate re-ask, as in bail; override can still place them back), writes **no** reliability event. **Exhausted pool rests at `Open`, not `Bailed`** — no one bailed, so the seat is honestly open again and `resolveShiftState`'s horizon clock decides AtRisk, rather than `deriveShiftState` flagging an immediate bail-driven AtRisk with "crew bailed" copy.
2. **Bailed** — unchanged `reportBail`/`bailWithDerivedLateness` (DEC-028): logs `shift_bailed` with lateness from now, clears, re-asks. Exhausted pool rests at `Bailed` → AtRisk, as before.

Both share the **occupant-pin race guard** (a swap between reads → `raced`, reload — never act on a different person than Spink saw). The card's intro text names the distinction in a line.

**Relationship:** supersedes the DEC-038 single always-bailing "Remove" button; builds on DEC-028 (the bail it deliberately does *not* fire) and DEC-019 (re-ask exclusion). `bail()` stays the sole home of the penalized path; `vacateSeat()` is the no-log sibling. No change to the seat/shift state machines beyond the new Open-resting vacate path.

---

## DEC-040: Xola live-API import — build resolution + sync strategy (5.4b; resolves DEC-036)

**Status:** Built (task 5.4b). Resolves DEC-036's "confirm at build" items against a live sandbox `GET /orders` (2026-06-18) and sets the ongoing-sync strategy DEC-036 left open. DEC-036's architecture (a second Land adapter behind the DEC-015 seam) stands unchanged; this corrects its field-mapping guesses and adds the "how it stays current" leg.

**Field mapping — confirmed from live data (corrects DEC-036's `expand` spike):**
- **No `expand` needed.** `items[]`, item `name`, `arrival*`, and `quantity` are inline on the order; `event`/`experience`/`organizer`/`travelers` are `{id}` refs we don't need to form shifts.
- **Contact is order-level, inline:** `order.phone` + `order.phoneCanonical` (NOT `organizer.phone`). → **DEC-017's customers-export email-join is retired**; phone threads straight through. A new optional `phone` on `RawReservationRecord` carries it (xlsx leaves it undefined); **excluded from DEC-029 materiality** — a phone correction isn't shift-material and must not cry wolf on a locked shift.
- **Reservation identity = `items[].id`** (one record per item — a Xola order holds N bookable items).
- **Party size = `items[].quantity`** (agrees with `guests.length`).
- **Time:** `items[].arrivalDatetime` ("…T18:00:00−04:00") carries the vessel offset, so the wall-clock slices out tz-free (DEC-032) — DEC-036 seam-B's instant-laundering worry is **moot** (Xola hands us vessel-local components directly). Falls back to `arrival` + `arrivalTime` (HHMM).
- **Status:** `items[].status` int — 200/201/202/203 booked, **700 cancelled**. The pull's `items.status[in]` filter **includes 700** (unlike the tip extractor) so a booked→cancelled transition reconciles (sync job #3); the mapper turns it into a `cancelled` record exactly as the xlsx Status column does.

**Sync strategy (the leg DEC-036 left open) — three jobs, one client:**
- **Backfill + primary live sync = hourly poll (Architecture B).** A dedicated cron `/api/cron/xola-pull` (`0 * * * *`), **separate from `/api/cron/tick`** so a Xola 5xx can't disrupt the ask loop. Pulls a [today−1, today+horizon+1] vessel-local window → `importRecords` → `formShifts`. Idempotent (identity + materiality), so an overlapping re-pull is a cheap no-op.
- **CSV (5.4a) stays the manual Xola-downtime fallback** — a pull can 503 on a crew Saturday; a file upload can't.
- **Webhooks (`order.create`/`order.update`/`order.cancel`) are ABANDONED for the pilot — there is no 5.4c.** Investigation (2026-06-19) established they're not a per-key feature but an **approved-App** one, configured in the App Store Console (event checkboxes + API version; the seller API key 403s on the hooks endpoint). The BrewBoat sandbox app is approved, but **production** webhooks would need that app approved + installed in production (kickoff/review) — a gate the operator has and is unlikely to clear. Net cost ≈ nil: the hourly poll already does all three ingest jobs; webhooks would only add latency, immaterial against a days-long horizon. **If same-day freshness ever matters, the lever is poll cadence** (hourly → 15m/5m in `vercel.json`), never webhooks. The 5.4b client would be reused if a production app ever lands. *(Independently corroborated: the sibling `crewbook` reached the same poll-primary conclusion.)*

**Layering (DEC-020):** the client splits into pure, unit-tested pieces (`mapXolaOrders`, the `fetchOrders` skip-pagination loop, `pullXola` orchestration, window math) that take an injected `fetcher`, and a single edge module (`app/lib/xola.ts`) that reads the server-only `XOLA_*` env and binds global `fetch` + retry (3× backoff, 429 `Retry-After`). `vercel.json`'s second cron is fail-closed on `CRON_SECRET` like the first.

**Open / verify-at-pilot:**
- **Sandbox product names ≠ production export names.** The sandbox's "Brewboat Tour - captained" isn't in `PRODUCT_MAP` (seeded from the real 2026 export), so a *sandbox* pull quarantines everything (DEC-018 working as intended). Live BrewBoat data carries the mapped names; confirm at first prod pull, or add sandbox names to the map for end-to-end sandbox exercises.
- **Cancellation visibility.** The default list query carries `status=committed`; whether a fully-cancelled *order* (vs a 700 *item* on a committed order) still appears needs a real cancelled sandbox order to confirm — the operator can create one. Booked path is validated live; cancel path is built to best understanding.
- **Multi-guest party size** (`quantity` vs `guests.length`) verified equal on a 1-guest order; confirm on a 2+ order.

**Relationship:** resolves DEC-036; retires DEC-017's email-join; preserves DEC-015/018/029/032; adds no new domain state.

---

## DEC-041: Trip length → shift end, from a flat constant (#92)

**Status:** Built (task 92). Surfaced while adding trip times to the outbox/crew cards: an `Event` carries only a departure `time` (no length, no end), so neither the operator-as-crew In/Out decision nor the crew card could show "how long am I committed." This adds the **end** of the window; the start (call time = first departure − `CALL_LEAD_MINUTES`) already existed.

**Source of truth — (c) flat constant, deliberately:**
- `TRIP_DURATION_MINUTES = 100` in `builder/derive.ts`, sibling to `CALL_LEAD_MINUTES`. Every trip is assumed this long.
- (a) **Xola product duration** was rejected for now: the live wire shape (`XolaOrderItem`) carries only `arrival*` (the start) — no length field — and it's unverified the API exposes a product duration at all. Nothing to map.
- (b) **Operator-configured** per-product/vessel length is the right long-term home but a settings surface — out of scope for a display unblock.

**No migration / no `Event.durationMinutes` column — yet.** The issue floated landing the field now as forward-provisioning. Rejected on YAGNI: with a flat constant the column would store no information, and the migration is additive and cheap to add *whenever* a real per-event source (a/b) lands. So the column is a **deliberate omission**, not an oversight — add it together with its source, not before.

**Shift-end formula:** `shiftEnd = latestScheduledStart + TRIP_DURATION_MINUTES + CALL_LEAD_MINUTES`. The operator's "report time" at the end is the **same call lead reused symmetrically** (report 45m before the first departure; off 45m after the last trip ends) — not a new teardown constant. With a flat length the latest *departure* yields the latest *end*; when per-event durations land this generalizes to `max(start + duration)`.

**Where the math lives (DEC-020):** `CALL_LEAD_MINUTES` moved from `crewapp/shift-card.ts` down to `builder/derive.ts` (re-exported from the card for back-compat), joining the other scheduling leads — because the shift *end* is cross-cutting: the crew card, the crew-app ask card, **and** the outbox all need it, and the outbox reads it as an instant. `derive.ts` gains `latestScheduledStart` + `shiftEndFromEvents` (instant-returning, DST-correct per DEC-032). The two clock-string surfaces (crew card, ask card) compute the end with the shared `plusMinutes` + the same constants, so no surface can disagree on the window — the same naive-clock vs instant split `callTime`/`tripStart` already live with.

**Display:** outbox card facts line → start–end window; crew shift card → a "Shift End" tile beside Start/First-departure; crew-app ask card → departure becomes a start–end range. Customer-facing trip duration is portal-era — the *data* (the derivation) lands now, no customer surface.

**Relationship:** extends DEC-021 (call lead) and DEC-032 (vessel-local); reuses DEC-031's "derived, never stored" discipline; adds no new domain state or schema. Supersedes the `Event.durationMinutes` line of #92 with a documented deferral.

---

## DEC-042: "All shifts" full-visibility view — a deliberate, opt-in pull surface (#100)

**Status:** Built (#100). A read-only `/admin/shifts` listing every *current* shift (Pending/Filling/Crewed/At-Risk; not Cancelled/Completed), day-filterable, click-through to the cockpit. Shift-centric — pax/booking counts per shift, not a reservation list (decided with operator; the reservation lens is the parked Living Link). Pure read over existing derivations (`resolveShiftStateOnRead`, `listShifts`/events/reservations) in `src/admin/all-shifts.ts`; no migration. Ships with the complete `/admin` nav (Part B).

**Why this is not the anxiety dashboard (BRAND, SPEC §2.5):** the anti-pattern is a surface that *invites monitoring* — auto-refreshing, everything glowing, summoning by ambient presence. This is the opposite shape: opt-in **pull** (operator's words: *"for now I'm going to want to see everything… perhaps after this runs for a while I'll stop looking"*), deliberately opened, no pings, no auto-refresh. Same precedent as the warming view (DEC-027 §3) — off-board, never-pings, conservatively scoped — with a wider membership predicate. The operator named it a knowing exception; recorded as one. (@architect-gated per #100, 2026-06-19.)

**Guardrails (binding — they live in the surface, not the derivation):**
- Default filter = **the next 7 days** (widened from *today* — see the amendment below). Presets: today · next 7 days · this weekend · a from/to range. Window clamped to `[today−30d, today+45d]` so "everything" can't render an unbounded wall.
- **No auto-refresh, no polling, no live counts.** `force-dynamic` server render on navigation only. A bare row count for orientation is fine; a per-state scoreboard/badge is not.
- **State renders as neutral ink, not colour.** Warm/bad tokens stay reserved for the At-Risk board; an At-Risk row here shows a quiet *"needs attention ↗"* pointer to the board, never a red block.
- `/admin` ranks the At-Risk board **first and heavier**; All-shifts is a plainer link with **no count badge**. "Needs attention" framing belongs to the board alone.
- **Empty ≠ success here.** The At-Risk board's ✓ "empty = the system did its job" must stay uncontaminated, so All-shifts renders a plain *"No shifts …"* line and does **not** reuse the board's `EmptySuccess` component.

**Amendment (#205, Phase 8.2a, @architect-gated 2026-07-01):** Default filter widened **today → next 7 days**. Rationale: live-pilot operator needs a bounded upcoming-shift look-ahead while trust in the engine builds — the exact "for now I want to see everything" case this DEC quotes; 7 days is strictly inside the existing `[today−30d, today+45d]` clamp. **Shape unchanged:** the default's *width* moved, not the surface's shape. Guardrails 2–5 (no auto-refresh/no live counts, neutral ink, board-first/no badge, empty≠success) stand verbatim; the clamp is unchanged. Surface becomes the Shift Builder's **View mode** (read-only; Edit mode lands 8.2b) and renders 8.1's advisory "split this?" as a muted, actionless line — no badge, count, or colour. **Watch:** the wider default must not grow a per-day/per-state scoreboard — the no-live-counts guardrail governs the new width too.

**Deprecation:** a trust-building crutch, expected to be deprecated once the operator trusts the engine. Nothing routes *to* it (no ping; no root redirect — #97 lands on the board), so removal is a single-route, no-migration delete. **Sunset trigger:** operator reports he's stopped opening it.

**Relationship:** reuses DEC-023 (resolve-on-read), DEC-032 (vessel-local dates), DEC-026 (no-client-JS, codes-in-params); the off-board pull precedent is DEC-027 §3 (warming view); the nav dovetails with #97 (session-aware root). Adds no domain state or schema.

---

## DEC-043: Ingest is events-driven — the boat is the event's assigned Resource, not a vessel invented from the product string (supersedes DEC-016's collapse)

**Status:** Built (Session 22, PR #110). @architect-gated. The Xola Land adapter pulls **`/events`** alongside `/orders` and joins them on the real `event.id`; everything downstream of the DEC-015 seam is unchanged.

**The bug it fixes:** `importRecords` keyed events as `vessel+date+time`, resolving the vessel from the free-text product via `PRODUCT_MAP` (DEC-016). BrewBoat is ONE experience run across 4 boats, so every boat-trip at the same slot collapsed into one event/shift — under-counting crews. Both the xlsx and the orders pull shared this collapse. Verified in production (Session 22): the assigned boat is a **Resource on the event** (`event.resourceUsages[].resource.id`), which the orders feed drops.

**Decision:**
- **Events-driven join.** `fetchEvents` (a bare-array, now-forward feed) → `eventVesselMap` resolves each boated event to a real vessel; `mapXolaOrders` stamps the resolved `vesselId` + the real `eventId` onto each booked record. Orders carry the bookings + the `item.event.id` join key; the windowed orders pull bounds the import.
- **Key the event on the real `event.id`.** Four boats at one slot → four events → four shifts. A reassigned boat (Drew moves a >12-pax trip) reconciles **in place** — same `event.id`, new vessel — and `formShifts` now cancels the old vessel+day shift instead of orphaning it (the one builder change).
- **The fleet is seeded by resource id**, not invented: Brew 1/2/3/4 (cap 14/16/12/12, all captain+mate); the 2 self-captained Duffy resources are excluded; an unknown resource id is quarantined (fulfilling DEC-018's "key off a stable id" revisit). `product-map.ts` → `resource-map.ts`.
- **Time = wall-clock string-slice off `event.start`** (DEC-032) — never `new Date()`, which would shift every departure by the offset (`start` carries the local wall-clock under a `Z` suffix; verified against `arrivalDatetime`'s offset).
- **Cancels are explicit status-700 rows, not absences** (verified) — matched by `items[].id`, status `200→700`. A fully-cancelled trip de-boats; its 700 row reconciles against the **stored** event (which kept its vessel) → event `cancelled` → shift cancelled. No vanish/absence-detection (DEC-037 punt holds).
- **Boat-less events are skipped + counted**; the next pull picks them up once a boat is assigned.
- **Crew is seeded manually, not imported** (the guide roster is 403 for the seller key); Xola guide *assignments* are **not** imported as seats (DEC-009 — Muster owns crewing).
- **Operator trust model:** auto-import stays, Xola is the single source of truth; a bad boat assignment is fixed **in Xola + "Pull now"** (no Muster-side staging/override). `XolaPullResult.assignments` (per-day boat→times) + `unmappedResources` (an unknown boat id) are the operator's review surface to catch a bad assignment.

**Supersedes:** DEC-016's single-vessel-per-product collapse + its 5 invented vessels (the durable DEC-016 / DEC-ROLE-1 principle — manning is data the deriver loops — **stands**; only the invented fleet dies). **Amends:** DEC-036/DEC-037 (the planned `fetchEvents` half is now the primary adapter; the xlsx upload is retired — it can't resolve a boat), DEC-018 (quarantine keys off `resource.id`), DEC-029 (`vesselId` joins the material set; event identity is the real `event.id`). **Untouched:** DEC-015 (seam), DEC-032 (vessel-local), DEC-022/DEC-031 (horizon / fills-by), DEC-009.

**Relationship:** the second Land adapter DEC-015 anticipated, and simpler than the orders adapter (boat + crew inline). G1–G9 reconcile harness in `xola-pull.test.ts` pins the behavior — it caught the reassignment-orphan bug before ship.

---

## DEC-044: Crew seed carries a placeholder MMC until BrewBoat tracks real credentials

**Status:** Built (Session 22). `db/seed-pilot-crew.ts` seeds every crew member a far-future sentinel MMC expiry (`2099-12-31`); a real `mmcExpiry` overrides it per person as records are collected.

**Why:** MMC is a **universal** hard credential gate (`src/oracle/eligibility.ts` → `HARD_CREDENTIAL_TYPES = ["MMC"]`) — no valid MMC → eligible for *no* seat, captain or mate. BrewBoat keeps **no MMC records today** (the operator has never had a tool; Muster will become that tool). Without a placeholder the eligible pool is empty and the board crews nobody. This is an **operator-authorized stopgap, not invented data** — the distinction that matters after DEC-016: the operator named the gap and chose the placeholder, and a real (or lapsed) date replaces the sentinel the moment it exists.

**How to apply:** do not treat the `2099-12-31` MMC as a bug. When MMC tracking lands in Muster, replace the sentinel with captured expiries; a lapsed date then correctly drops that person from the eligible pool.

---

## DEC-045: Messaging & the Smart Doorbell — a deliberate SPEC v1.1 unlock
**Status:** Proposed (Phase 6) — @architect 2026-06-21 (Opus; Fable unavailable). Confirm at build.
**Decision:** The 13th design artifact (`messaging-smart-doorbell.md`) — full-mesh in-app group
messaging (cohort / shift / all-staff / DM) + the Smart Doorbell notification engine — folds into a
deliberate **SPEC v1.1 unlock** under DEC-014, **not** a correction to the frozen v1.0 baseline. It
*builds* the day-cohort thread the locked spec already named-and-parked (SPEC §2.6.3 → §4); it does
not relitigate a deferral or modify the locked crew engine (it *may* enhance it per artifact §13 —
parked, not bolted into the locked spec). Supersedes the 12th artifact (`cohort-messaging.md`,
broadcast-only). **Absorbs** two FUTURE_IDEAS entries: "Two-way / multi-party messaging"
(2026-06-11, Drew) wholesale, and the messaging substrate half of "Periodic crew keep-warm touch"
(2026-06-17, Eric).
**Why:** Additive scope beyond a LOCKED doc; DEC-014 routes that through a batched v1.1 unlock, not a
drip into the baseline. The cohort thread was parked-with-a-pointer, so this is the deliberate moment
to fold it in.
**Tradeoff:** A v1.1 spec-edit ceremony is owed (the SPEC stays untouched until that batch lands —
this phase does not edit `docs/SPEC.md`). **Phase:** Phase 6.

---

## DEC-046: Presence is observed-only, never crew-curated (the DEC-009 guard for messaging)
**Decision:** The doorbell's presence signal is **observed** (the app reports activity / focus),
never **maintained** by crew. There is no "set your notification preferences / quiet hours /
availability" surface for crew. The doorbell's windows and priorities are **operator** tenant-config,
never crew-set.
**Why:** DEC-009 forbids a crew-maintained positive-availability calendar (the Xola trap — it goes
stale and lies). Observing live activity is the right side of that line; a crew-tended
notification-settings screen would re-introduce the exact failure. Naming the guard now stops scope
drift toward it.
**Tradeoff:** Crew can't tune their own notification behavior in v1 (operator config only).
**Revisit if:** never for observed-only; any future per-crew notification preference must not become a
stale self-maintained calendar. **Phase:** Phase 6.

---

## DEC-047: No realtime vendor for v1 — presence via an activity signal behind a `PresencePort`
**Status:** Proposed (Phase 6) — operator-confirmed 2026-06-21.
**Decision:** v1 ships **no managed-realtime dependency** (no Ably / Pusher / Supabase Realtime) and
**no self-hosted socket server**. Presence — the doorbell's "is this person looking right now" input —
is a **coarse activity signal**: natural app activity (loading a thread, sending) plus an occasional
lightweight check, read behind an injected **`PresencePort`**. Instant live chat is **deferred**;
v1's crew chat is **refresh-to-see-new**. A hosted realtime service (or a self-hosted socket process)
is a **later, additive adapter swap** behind the same `PresencePort`, adopted only if/when instant
chat is wanted — with **zero change to the doorbell decider**.
**Why:** Vercel's serverless runtime (DEC-020) can't host a long-lived socket, and the doorbell's
value (suppress, batch, first-only-until-read, priority) is fully expressible over a coarse signal —
the batch window absorbs the signal's staleness, and "fail toward ringing" makes a missed-present
harmless. Crew is 20–25 → no scale forcing. Holds the dependency-minimal posture (DEC-020/033/034 all
rejected premature vendors).
**Tradeoff:** Live chat lags a few seconds (refresh/poll) until a realtime adapter lands — accepted;
instant chat isn't needed day one. **Rejected:** managed realtime *in* the slice (a vendor + cost the
doorbell doesn't need); a self-hosted socket server (breaks the single-app-on-Vercel topology — two
always-on deploy targets for one operator). **Revisit if:** crew want instant chat → drop a realtime
adapter behind `PresencePort`. **Phase:** Phase 6 (6.2).

---

## DEC-048: The doorbell is a pure core decider; presence-state and delivery-I/O live at the edge
**Decision:** The doorbell decision logic — presence-suppression, batch / cancel window,
first-only-until-read, priority, short-notice-as-text, in-app-toast-vs-SMS — is a **pure function in
the framework-free core** (`src/`): over injected (pending messages, presence, read-state, rules,
`now`) → notification decisions. Same shape as the oracle / refund engine (DEC-001/002). The doorbell
**never opens a connection and never sends**: presence capture (stateful / I/O) and delivery (I/O)
stay at the **Next edge**, behind ports. Doorbell logic **never** lives in RLS policies, DB triggers,
`NOTIFY`, or a realtime subscription.
**Why:** DEC-DATA-1 — procedural / stateful decisioning belongs in the service/domain layer, not
smeared across the database. A pure decider is the only way the timing/attention logic is
unit-testable with injected `now`, the way every Muster engine is.
**Tradeoff:** One indirection (the decider emits decisions; a separate edge adapter delivers them).
**Rejected:** trigger / `NOTIFY`-driven notification or RLS-gated presence — the stored-procedure
trap DEC-DATA-1 exists to prevent. **Phase:** Phase 6 (6.4).

---

## DEC-049: The doorbell tick — a clock-driven sweep on a separate cron
**Decision:** The batch / cancel window is realized by a **`tick`-style sweep**: a clock-driven job
reads the pending-notification / cancel-window queue, runs the pure decider against current presence
+ read-state, and emits "ring now" decisions to the delivery adapter. It reuses the **explicit-tick
pattern** (DEC-023) and runs as a **separate cron** from the engine `tick` and the Xola pull — so a
doorbell failure can't disturb the ask loop (the DEC-040 precedent: `/api/cron/xola-pull` is separate
from `/api/cron/tick`).
**Why:** The decider is pure, but something must fire it on a clock; a separate cron isolates fault
domains (a messaging bug must not stall crewing). **Tradeoff:** A third cron to operate.
**Phase:** Phase 6 (6.6).

---

## DEC-050: The channel port widens with a `sendNotification` sibling to `sendAsk`
**Decision:** Doorbell delivery rides the existing channel seam (DEC-MSG-1/3) but as a **new outbound
method `sendNotification`**, *not* by overloading `sendAsk`. The ask is a structured yes/no with
atomic-claim semantics (REQ-CLAIM-1) and an inbound `recordReply`; the doorbell ring is a **different
payload** — "new message, tap to open" (or a content-carrying short-notice text) with **no claim
logic and no inbound reply to record**. Both methods share the adapter family (fake / relay / Twilio)
and the outbox/relay machinery (DEC-030); the SMS doorbell adapter is the **final swap**
(DEC-MSG-1 posture).
**Why:** Overloading `sendAsk` with a no-claim payload would muddy the claim guarantees and break the
"zero domain change to swap Twilio" property for both. Distinct methods keep each clean.
**Tradeoff:** A second port method. **Rejected:** reusing `sendAsk` for rings. **Phase:** Phase 6
(6.6 / 6.9).
**Realized (6.6a, 2026-06-27):** as a **separate `NotificationPort` interface** (`send(NotificationMessage): Promise<SendResult>`), not a second method on `ChannelPort`. DEC-050 predates the seam becoming `send(OutboundMessage)`+`MessageKind`; a separate interface realizes "sibling to the ask path" most cleanly today and keeps the just-hardened ask `send`/`WebLinkChannel`/outbox (#158/#160) literally untouched, while preserving convergence — one future Twilio class implements **both** interfaces (DEC-MSG-1). Payload is **ring-only**: `{to, threadId, mode:"summary"|"content", body, messageIds}` — a toast (`in_app_toast`) is a 6.7 in-app read-model (DEC-068), never a port send, so there is no `channel` discriminator and no `mode:null`. 6.6a ships the port + `FakeNotificationChannel` recorder; the operator relay-of-rings adapter is **6.8** (#118, DEC-030 machinery).

---

## DEC-051: Messaging membership is derived, not snapshotted
**Decision:** Thread membership is **computed from existing aggregates at read time**, not copied into
participant rows: **cohort** = everyone crewing a **day**, gathered across *every* shift that day (the
assigned crew on that day's seats, all vessels — artifact §2, corrected at 6.1 build); **shift** = the
assigned crew on one shift's seats; **all-staff** = the roster (`listCrewMembers`). Only the **DM**
participant set — the one truly ad-hoc membership — is **persisted**. Thread `kind` is **data, not a
hardcoded enum branch** (the DEC-ROLE-1 discipline applied to threads — membership dispatch is a
registry keyed by kind).
**Correction (6.1, 2026-06-24):** the original wording "cohort = the same vessel+day grouping" was
wrong — that's a *shift*, collapsing two of the three standing kinds into one. The artifact §2 is
authoritative: a cohort is **day-wide across vessels** ("Saturday's cohort = all six"). Issue #111 AC
copied the wrong wording and is corrected with it.
**Why:** A snapshotted cohort/shift membership goes stale exactly when the schedule changes — the same
anti-pattern as the Xola-trap calendar (DEC-009 spirit). Derive what's derivable; persist only the
irreducible. **Tradeoff:** Membership is recomputed per read (cheap; the inputs are already in hand).
**Phase:** Phase 6 (6.1).

---

## DEC-052: Crew-to-crew DMs are operator-visible for v1
**Status:** Proposed (Phase 6) — operator-confirmed 2026-06-21.
**Decision:** Resolves the artifact's §14 open question (DM private-to-two vs operator-visible) to
**operator-visible** for v1. A DM thread is readable by the operator (matches the "office-overseen"
framing of the absorbed FUTURE_IDEAS multi-party item, defensible for a 20–25-person ops crew). A
**private-DM** model is a documented later path, not v1.
**Why:** DM visibility is a **DEC-DATA-1 authorization decision** (who reads which rows) — a
"decide-before-building" gate, not a tune-later knob. Operator-visible is the simplest correct model
and fits the ops context. **Tradeoff:** No truly private crew channel in v1. **Revisit if:** a genuine
need for private crew DMs appears (then a per-thread visibility model). **Phase:** Phase 6 (6.1).

---

## DEC-053: Two sender numbers — scheduling vs doorbell — on the crew 10DLC campaign
**Decision:** Per artifact §5, scheduling SMS (the crew ask; call-time / dock changes) and
message-notification SMS (the doorbell ring) must land as **separate phone threads on the handset**.
Since phones thread by number, that requires **two sender numbers**, both registered under the crew
A2P / 10DLC campaign. Plain Programmable Messaging carries both (Twilio Conversations not required,
artifact §4). The real SMS doorbell number is gated to **10DLC** (registration in motion,
owner-driven) and stays **off the critical path** — the slice runs on the fake / relay adapter; the
SMS number is the final swap (DEC-MSG-1).
**Why:** Spink's explicit requirement that scheduling and chat pings not collapse into one
undifferentiated phone stream. **Tradeoff:** A second number to provision + carry on the campaign.
**Phase:** Phase 6 (6.9), gated to 10DLC.

---

## DEC-054: Operator engine pause/resume — edge-gated, typed-port-backed, default-running (#124)

**Status:** Built (Session 23). @architect-gated 2026-06-23.

**Decision:** A `/admin` pause/resume toggle arms/disarms the autonomous engine without a redeploy.
Persistence: `app_settings(key text pk, value text not null, updated_at text not null)` — DEC-DATA-1
house style (text PK, ISO-text dates, no FK). The port exposes typed `isEnginePaused()` /
`setEnginePaused(paused, at)`; the adapter maps the `engine_paused` key and parses `"true"`/`"false"`
↔ `boolean` internally, so the domain/edge never touches stringly-typed KV (DEC-013). The pause check
lives in the **cron edge route** (`app/api/cron/tick/route.ts`): if paused, return `{ok, paused:true}`
without calling `tick()`. `tick()` stays pure (DEC-023/DEC-001) — pause is an ops concern, not engine
logic. The cron still fires every 15 min; a paused tick is a cheap no-op. Manual surfaces (the
per-shift cockpit asks) are a separate path and keep working while paused.

**Default = running** (row absent ⇒ engine on). The go-live "import and look around first" posture is
achieved by **explicitly** flipping to paused as a deliberate step in the pilot runbook, not by
inferring pause from an absent row — an autonomous "no babysitting" engine must never silently stop
because state was cleared by a restore/migration (the worst failure for this system, and invisible
since an empty board reads as success). Paused status surfaces on `/admin` **and** `/admin/at-risk`
(an empty board while paused is a muted engine, not success — guards the "empty board = success"
signal, the operator-confusion guard from #68).

**Why KV over a dedicated `engine_state` table:** same migration cost; the generality is confined to
one table whose shape the domain never sees (the port stays specific). **Not** justified by speculative
future flags.

**Seam guard:** `tick()` carries a comment that pause is enforced at the cron edge; any new autonomous
`tick()` caller must check `isEnginePaused` itself. The dev CLI (`db/tick-dev.ts`) and manual cockpit
asks intentionally bypass.

**Tradeoff:** A mutable singleton in persistence (the first non-aggregate setting). **Rejected:** an
`ENGINE_PAUSED` env var (a Vercel env change needs a redeploy — not instant); gating inside `tick()`
(couples engine logic to an ops toggle, breaks the pure-decider testability).

---

## DEC-055: Transient feedback params are stripped post-render by a contained client island (#121)

**Status:** Built (Session 23).

**Decision:** No-JS admin surfaces surface one-shot feedback via redirect search params (DEC-026 —
codes/ids only, mapped to copy server-side). On the import surface, a lingering error code in the URL
re-rendered on reload and read alarmingly (#121). A **contained `'use client'` island**
(`ClearFeedbackParams`) now strips the feedback params after first render via `history.replaceState`.
The server still renders the result/error from the params, so DEC-026's no-prose-in-the-URL security is
unchanged — the island only cleans the address bar (gone immediately, and on reload).

**Why a client island (a deliberate DEC-026 carve-out):** the App Router can't modify cookies or the
URL during a Server Component render, and the project runs no middleware — so clearing a param
post-render with zero client JS isn't possible. A ~12-line island is the smallest fix; a flash cookie
can't be cleared on reload without the same constraint, and middleware is heavier and absent. This is
the sanctioned "a real UX win earns a contained island" exception, not a retreat from the no-JS default.

**Scope:** import feedback only (its sole params are one-shot). Reusable for at-risk/outbox if their
stale-param notices ever warrant it — but only where **every** param is feedback; navigational params
(e.g. `/admin/shifts`'s date filter) must be preserved, so don't blanket-strip there.

**Tradeoff:** the import page is no longer strictly zero-JS. **Rejected:** flash cookie (racy TTL /
can't clear on reload), middleware (heavier, none exists), leaving the param (the #121 complaint).

---

## DEC-056: Import runs are audited to the DB — edge-assembled, two-table, identity-level (#128)

**Status:** Built (Session 23, Part A).

**Decision:** Every Xola import (the manual button **and** the hourly cron) persists one durable audit
record. Two tables (migration 0007), house style — text PK, ISO-text dates, JSONB, **no FK**
(DEC-DATA-1): `import_runs` holds the run-level **summary** (counts + join diagnostics —
`unmappedResources`, `mapSkipped`, per-day assignments, stranded/pruned seats) as one JSONB blob;
`import_run_items` holds the **identity rows** (which reservations by name, which shift ids), one per
`{kind, ref_id, label}`. Adapter-side like the outbox (DEC-030): persisted through the port
(`saveImportRun`/`getImportRun`), **never read by the domain**. The core importer stays pure — it
returns the envelope (`ImportResult`/`FormResult` gained identity lists, `XolaPullResult` already
embeds them); the **edge** (`persistImportRun`) mints the run id (`crypto.randomUUID`) + timestamp +
source and saves. Item ids are zero-padded (`<run>-item-NNNN`) so the DB's `order by id` matches the
in-memory adapter's insertion order (the contract-suite parity).

**Why:** counts-in-redirect-params + diagnostics-in-Vercel-logs meant an unattended overnight **cron**
pull left no reviewable trace — "what did that run do?" was unanswerable, and the single most
actionable signal (`unmappedResources` = a new/renamed boat needing a `resource-map.ts` fix) was
`console.warn`-only. The audit gives both ingest paths a home off the logs.

**Surface (DEC-026):** the manual pull now redirects to the run's detail view
(`/admin/import/run/<id>`) — the same surface a cron run is reviewed on — replacing the one-line count
notice. The view reads **server-persisted, server-generated** data, so the codes-only-in-params rule
doesn't apply (no crafted-URL prose-injection risk).

**Scope:** Part A — audit table + persist the full envelope per run + the detailed single-run view.
**Part B (deferred):** the history-browse + drill-in list (a `listImportRuns` port method).

**Tradeoff:** identity-level capture is *new collection* in two core fns (not promoted counts) + a
child table. **Rejected:** counts-only (the status quo's blind spot); one flat table (loses per-row
identity); writing the audit in the core (would drag clock + randomness into the clock-free domain).

---

## DEC-057: The dev-link minter is gated by `VERCEL_ENV`, not `NODE_ENV` — live on previews, off in prod

**Status:** Built (Session 24).

**Decision:** `/crew/dev-link` (the hand-driven magic-link minter for **both** crew `?crew=<id>` and
operator `?admin=<handle>`) gates on `VERCEL_ENV` instead of `NODE_ENV`, with a `NODE_ENV` fallback so
the prod-404 holds **host-agnostically**:
`VERCEL_ENV === "production" || (!VERCEL_ENV && NODE_ENV === "production")`. So it is **404 on every
production deploy** — Vercel prod (`VERCEL_ENV="production"`) *and* a self-hosted prod (`next start` /
Docker, where `VERCEL_ENV` is absent but `NODE_ENV="production"`) — and **live on Vercel previews**
(`VERCEL_ENV="preview"`) and **local dev** (`VERCEL_ENV` unset, `NODE_ENV!=="production"`). Pairs with
`APP_BASE_URL` **scoped to the Production env only** in Vercel — left unset for Preview, `base-url.ts`
falls back to the request `Host`, so a minted link's origin resolves to the preview's own domain
(DEC-034 host-spoof guard intact: prod still has the trusted origin set).

**Why:** Vercel sets `NODE_ENV=production` on **preview** builds too, so the old `NODE_ENV` gate 404'd
previews — killing the only sign-in path (crew or admin) and making a preview impossible to smoke-test
before `/promote-production`. Previews are exactly where the Vercel-only failure modes (cold starts,
pool limits, cron, host/`APP_BASE_URL` bugs) surface; a preview you can't log into can't catch them.
`VERCEL_ENV` distinguishes prod-vs-preview where `NODE_ENV` can't.

**Tradeoff:** the unauthenticated minter is now reachable on preview URLs — anyone with the (obscure,
non-secret) preview link can mint a crew/operator session. **Contained two ways:** (1) a preview's
`DATABASE_URL` is its own **isolated Neon branch** (a clone, never prod), so a minted preview session
touches branch data only; and (2) minting requires `SESSION_SECRET` set on the Preview env — on a
preview `NODE_ENV="production"`, so `auth.ts`'s `secret()` **throws** rather than signing with the
repo-public dev default, meaning a bare preview URL can't forge a valid session without that secret.
The prod deploy itself stays hard-404 on every host. **Rejected:** a preview-only shared secret on the
route (ceremony the contained blast radius doesn't warrant); leaving it `NODE_ENV`-gated + minting
admin links out-of-band via `db:mint` against each preview branch (the friction this fix exists to
remove). **Revisit if:** previews ever stop being isolated branches, or carry sensitive data — then re-gate.
**Phase:** out-of-phase pilot-infra (#135).

---

## DEC-058: Canonical messaging subject = the existing `AuthSubject` kind, widened; doorbell rings on membership, not visibility
**Status:** Proposed (Phase 6 / 6.1b + 6.2) — @architect 2026-06-25 (Opus). Confirm at build.
**Decision:** Messaging/notification identity reuses the core's existing subject kind as the ONE canonical identity: a `Subject { kind: AuthSubjectKind; id: string }` in `src/domain/entities.ts`, where `AuthSubjectKind = "admin" | "crew"`. **No new `SubjectKind` type, no `"operator"` synonym for `"admin"`.** Auth's `AuthSubject` becomes an alias of `Subject`. `Message.senderKind` converges from its shipped `"crew" | "operator"` (#111) onto `AuthSubjectKind` (`"crew" | "admin"`). The **operator participates in v1 messaging as a crew subject via `OPERATOR_CREW_MEMBER_ID`** (`crew-spink`, DEC-030 §7) — a real `CrewMemberId`, `senderKind: "admin"` for "from the office" display. A durable operator *entity* is **not** minted here (that's the parked admin-roles revision of DEC-020, FUTURE_IDEAS 2026-06-25). The `PresencePort` (#112) keys on the subject as composite `(kind, id)` — stored two-column (house style, no FK); `${kind}:${id}` is an in-memory `Map` key only, never the stored shape.
**Doorbell scope (the anti-anxiety bound):** the ring *mechanism* is kind-agnostic (no per-kind branch in presence or the decider — DEC-048), but the decider rings a subject only for threads where they are a **member** (`deriveMembers`), **never** for threads they can merely *read* under DEC-052's operator-visibility. Authorization (who may read — DEC-052) and attention (who gets rung — the doorbell) are separate questions; conflating them rebuilds the anxiety dashboard SPEC §2.5 / BRAND forbid. The operator gets the same tenant-config doorbell defaults as crew (DEC-046) — **no per-operator self-tuning surface** (the DEC-009/046 self-maintained-settings trap, held for one user).
**Customer (portal-era) is type- and schema-free, not edit-free:** widening `AuthSubjectKind` to add `"customer"` is a one-line type edit with no migration (`subject_kind`/`sender_kind` are already `text`). The bounded, known edits it then forces — a reservations-based `membership.ts` resolver, the `CrewMemberId` typing of `Participant`, the integrity scan's subject spaces — are isolated behind the membership registry + ports and land in 6.6/6.7 + the portal, **not** in Phase 6. Claimed as cheap-and-isolated, not "structurally free."
**Note:** Migration `0008_messaging.sql`'s column comments still read `crew | operator` — they predate this rename and the applied migration is not hand-patched (migration protocol). The column is plain `text` with no CHECK, so it's a stale *comment*, not a live constraint; a later messaging migration corrects it in passing.
**Why:** Two identity types for the same humans (the core's `AuthSubject` vs a new `Subject`) is the lock-in this model exists to prevent; reusing the canon avoids an `admin`↔`operator` translation layer at every auth→messaging boundary. Ringing on membership-not-visibility keeps the operator-ring coherent without smuggling back the monitoring anti-pattern.
**Tradeoff:** The operator posts/rings as `crew-spink` rather than a first-class operator identity until the admin-entity revision lands. **Rejected:** a new `SubjectKind`/`"operator"` vocabulary (collides with `AuthSubjectKind`); a flat `"${kind}:${id}"` subject-ref (un-indexable kind, delimiter footgun); ringing the operator on read-visibility (anxiety dashboard).
**Phase:** Phase 6 (6.1b subject model; 6.2 presence; doorbell scope binds 6.4).

---

## DEC-059: `main` stays promotable — multi-PR features land on a feature branch, not piecemeal on `main`
**Decision:** Amends DEC-S022. `main` must be **promotable to `production` at any moment** — every commit on it production-safe. A feature that ships across **multiple PRs and isn't independently releasable** (e.g. Phase 6 messaging) does **not** land on `main` in pieces. It lands on a long-lived `feature/<name>` branch off `main`; its task PRs target *that* branch; it merges to `main` only when the whole feature is prod-ready **or** is dark behind a flag (the `app_settings` engine-pause and `VERCEL_ENV` dev-link gate are the in-repo precedents). Independently-shippable tasks still PR straight to `main` as before.
**Why:** DEC-S022 made `main` the always-active trunk and `production` a fast-forward-only deploy pointer — but never stated the precondition that *makes* an always-active trunk safe to deploy: that it stays releasable. Without it, incomplete features accumulate on `main` and a promote is forced to choose between shipping WIP or freezing prod. Hit for real 2026-06-25: `production` had drifted 16 commits behind `main` with Phase 6 messaging half-built on it, and a one-line horizon-constant change couldn't reach prod without dragging the messaging substrate along. The ff-only model has no cherry-pick escape hatch by design, so the discipline must live upstream of `main`.
**Tradeoff:** Long-lived feature branches reintroduce the big-merge / rebase cost the shell's small-PRs-to-`main` default deliberately avoided — accepted, because the alternatives are worse: flag-everything is more per-feature plumbing, and cherry-pick-to-prod breaks the ff-only invariant. Mitigate drift by merging `main` *into* the feature branch periodically, never rebasing a shared base.
**Revisit if:** the project moves to genuine continuous deployment with feature flags as the standing norm (dark-on-`main` then replaces the feature branch), or `production` is retired.
**Backport:** this is a gap in the shared seeds workflow, not Muster-specific — backport to the DEC-S series + the shell `## PR Workflow` via `/push-seeds`.

---

## DEC-060: Doorbell window defaults — batch/cancel 90 s, presence-staleness 5 min (the 6.3 spike)
**Decision:** Resolve the two tune-later doorbell windows deferred to task 6.3. **Batch / cancel window** (hold-before-ring, §7.2) = **90 s**; **presence-staleness window** (the param `isPresent` takes, §7.1) = **5 min**. Both land as **env-overridable consts** in `src/config/tenant.ts` (`DOORBELL_BATCH_WINDOW_MS` / `DOORBELL_PRESENCE_WINDOW_MS`) — not hardcoded constants — feeding the 6.4 decider; tenant-config data later (DEC-046 posture). Tune-on-real-use stays. Invariant: presence window **>** batch window.
**Why:** Two different jobs → two numbers, each defended by peer norms rather than guessed. **90 s batch/cancel:** Slack's explicit-leave mobile-push delay is ~1 min, SMS response cadence is ~90 s and read-time under 5 s, and the debounce-to-digest norm is 1–2 min; priority bypasses the hold (§7.4) so urgency isn't penalized, and the +30 s over the artifact's "~1 min" placeholder buys batching + cancel-on-read headroom — every cancel suppresses a real SMS send. **5 min presence:** pulled *under* the ~10 min passive-idle peers (Slack cursor-idle push trigger, Discord idle) because Muster presence is narrow (in-*that*-thread) and fails toward ringing, but kept well *above* the batch window because the coarse observed signal (DEC-046, no websocket yet) emits nothing while a crew member *reads* a thread without tapping — a shorter window would text someone staring at the message and break the keystone (§7.1).
**Tradeoff:** Both numbers are coarse-era defaults defended by peer norms, not measured against real BrewBoat crew behavior — accepted because they're env-tunable and explicitly tune-on-real-use, and priority-bypass caps the cost of a too-long batch hold. The 5-min presence default biases toward suppression (a crew member gone 3–4 min could get an in-app toast rather than an SMS); first-only-until-read plus the re-ring on the next message bound that miss.
**Revisit if:** real pilot use shows missed rings or annoyance; or DEC-047's websocket lands — presence becomes continuous and the staleness window collapses toward "connected + focused now" (a short socket-drop tolerance, not 5 min).

---

## DEC-061: A winning "in" auto-confirms — `Claimed` is momentary on the happy path
**Decision:** A winning accept advances `Asked → Claimed → Confirmed` in one operation. New core composition `recordResponseAndConfirm(repo, askId, response, now)` calls `recordResponse` (unchanged: CAS claim, reliability log, double-book/contested handling) and, **only when `outcome.claimed === true`**, calls the existing `confirmSeat`. Both answer surfaces route through it: crew `respondToAsk` and the operator-as-crew path (`recordResponseAs` → composition, ownership gate preserved). `recordResponse` and `confirmSeat` stay untouched (channel adapters, tests, and the manual cockpit confirm — now a vestigial backstop — depend on them). Applies to **both** protocols (DEC-007): the mate broadcast's first-yes and the named-captain's accept.
**Why:** The manual confirm ratified an already-decided CAS winner, never selected among yeses; for assign-then-confirm it was a redundant second confirmation of the person's own yes. Auto-confirm matches the operator's actual workflow (triage is nowhere near the per-shift cockpit confirm button) and the loop's documented intent ("the autonomous Tier-1 confirm of the first acceptable yes," `ask-loop.ts confirmSeat`). Operator-requested for the pilot (Eric, 2026-06-25): "in = they're on the boat."
**Tradeoff / supersedes:** Amends SPEC §2.4 (the "confirm down the list" step) and the §2.6 acceptance ("…and Spink confirming moves the seat"), now auto. `Claimed` becomes non-resting on the happy path; the crew "awaiting confirmation" affordance goes dark. **"In" now means committed** — a retraction is a penalized `bail()` (a `shift_bailed` reliability hit), not a free pre-confirm backout. The soft-commitment buffer, if ever wanted, remains the reserved `Held` tier (DEC-005), **not** a resting `Claimed`. Hard-codes first-acceptable-yes (DEC-007) — but does not worsen a future best-by-score flip, because the CAS claim already locks the first yes *before* any confirm step; the claim policy, not the confirm step, is the knob to change.
**Gotcha (M4):** the inbound SMS-reply adapter must funnel to `recordResponseAndConfirm`, **not** raw `recordResponse` — else real "in" texts strand at `Claimed` and silently reintroduce this bug. The channel-port comments (`ports/channel.ts`, `adapters/web-link-channel.ts`, `adapters/fake-channel.ts`) now say so.
**Revisit if:** Pass D adds the `Held` soft-hold tier, or DEC-007 flips to best-by-score.

---

## DEC-062: The engine never works a departed shift; staffing horizon is env-tunable
**Decision:** Two pilot fixes to the engine tick. **(1) Past-trip guard (#147):** `tick()` skips any shift whose earliest scheduled start is `<= now` — no broadcast, no escalate, no auto-crew. `resolveShiftState` already gates the *near* side of the staffing window (before-horizon → `Pending`); this gates the *far* side (trip already departed). A shift with no scheduled event has no departure and falls through unchanged. **(2) Horizon env-tunable:** `STAFFING_HORIZON_LEAD_DAYS` (`src/builder/derive.ts`) now reads `process.env.STAFFING_HORIZON_LEAD_DAYS` (positive integer days), default **7** — the operator tunes the value per deploy without a code change. Refines DEC-022 (which fixed only that the lead lives in *one* place) and partially resolves the DEC-TBD "concrete horizon values" (the *value* stays Eric's; the *plumbing* is now an env knob).
**Why:** The armed tick cron (#130, `*/15`) was working **all** non-terminal shifts, so departed trips got asked and — post-DEC-061 auto-confirm — **crewed** (operator saw past shifts crew themselves). A trip that has left the dock cannot be crewed; working it is pure noise + bad state. Separately, the 7-day default is a guess the operator needs to dial against real pilot behavior, and a redeploy-per-tweak loop is the wrong ergonomics for a tune-later knob.
**Tradeoff / scope:** The guard *skips* past shifts, it does not re-state them — a past unfilled shift keeps its last-persisted badge (stale, harmless) rather than transitioning to a "missed/expired" terminal state (deferred; would need a new shift state). **Both** the engine tick's work loop AND the at-risk board (`deriveAtRiskBoard`) apply the same `tripStart <= now` skip, so a departed shift neither gets worked nor pings Spink — board membership and engine work share one definition of "past." Env (not a DB-backed `/admin` setting) means a horizon change needs a Vercel redeploy — a change-it-from-the-cockpit setting is a larger follow-up. The guard uses the *earliest* scheduled trip: a multi-trip day where trip 1 departed but a later trip is upcoming is treated as past (BrewBoat is single-trip; revisit if multi-trip days become common).
**Revisit if:** multi-trip days need per-trip crewing; or the operator wants the horizon (or a "missed" state) controllable from `/admin` without a redeploy.

---

## DEC-063: Tier-1 ask fan-out is a staged "drip" — ranked, one candidate per interval, accumulating
**Decision:** Tier-1's birth fan-out stages over time instead of blasting the whole ranked pool at once. On a `Filling` shift, `tick` seeds **one** ask to the top-ranked eligible candidate per required seat (`widenAsk`, `src/asks/ask-loop.ts`); each tick thereafter a seat with un-asked ranked candidates is **widened by one** when `now − max(sentAt) ≥ ASK_DRIP_INTERVAL_MINUTES` (or **immediately** when the outstanding set empties via decline/timeout and the seat reopens). Earlier asks **stay open and accumulate** — first-acceptable-yes-wins among them is unchanged (CAS, REQ-CLAIM-1 / DEC-007). Per-seat "last ask time" is derived as `max(sentAt)` over `listAsksForSeat` — **no new field, table, port method, entity, DDL, or dependency.** The interval is an **env knob** (`ASK_DRIP_INTERVAL_MINUTES`, `src/builder/derive.ts`, `envNonNegativeInt` sibling of DEC-062's helper), default **15 min** (aligned to the `*/15` tick — the floor on widen granularity); **`0` ⇒ blast-all** (the prior behavior, the pilot rollback). **Urgent override:** once `now ≥ fillsBy` (DEC-031) the remaining pool is blasted — drip must not pace an emergent same-day booking. **Escalate (DEC-024) is orthogonal and unchanged** — it fires only after drip has walked the entire ranked list and the seat sits `Open` again; it touches only `Open` seats, so a sibling mid-drip `Asked` seat is undisturbed. **Bail/vacate re-asks stay blast-all** (urgency-justified); drip governs the Tier-1 birth only.
**Why:** Gives the most-reliable crew first dibs and stops every eligible phone lighting up at once — finally making the reliability ranking matter in *time*, the literal intent of DEC-008 (operator-reported: the blast felt like spam, and the rating "did nothing" he could see). Reuses every existing primitive; the seat machine, CAS, auto-confirm (DEC-061), and escalate are untouched. `interval=0` keeps the old blast one keystroke away.
**Tradeoff:** Slower fills (a reliable-but-slow top candidate delays the next by one interval) vs gentler, ranked asking — bounded by the urgent-blast guard, and it yields cleaner reliability signal (you learn whether #1 answers before #2 is in the mix). The `*/15` cron is the effective granularity floor: a sub-15-min interval collapses to "every tick," a 20-min interval rounds up to 30. Escalation is now triggered **per seat** (a walked-`Open` seat escalates even while a sibling seat still drips — old `isStalled` gated on the whole shift); safe because `escalate` only touches `Open` seats, but it logs the widen-stub more often on a 2-seat vessel. `rankedEligible` is computed twice per seat per widening tick (once for the un-asked count, once inside `widenAsk`) — accepted at BrewBoat scale.
**Known gap (pre-existing, surfaced by this):** `expireAsks` (the silent-timeout sweep) has **no production caller** — the cron `tick` never sweeps timeouts — so a *ghosted* (never-answered) ask never closes, the seat never reopens to `Open`, and the `seatStalled → escalate` path is unreachable for silent crew in prod. Blast-all had the identical dependency; drip does **not** worsen it (it improves the *decline*-driven reopen — fewer simultaneous asks reach `allAsksClosed` sooner). Filed separately; wiring `expireAsks` into the tick needs an operator call on the silent-timeout duration.
**Not this:** **Not** the Pass-D staged *horizons* / soft-hold reservation (SPEC §1.3/§4, Phase 7). That banks willingness across *multiple horizons*; this paces hard asks across *wall-clock intervals at the single hard horizon*. Soft-hold / `Held` stay reserved.
**Refines:** SPEC §1.2, DEC-007 (fan-out timing), DEC-008 (ranking drives timing); reuses DEC-062 (env knob + `envNonNegativeInt`), DEC-031 (fills-by urgent boundary), DEC-023 (tick clock). **Untouched:** DEC-005, DEC-019, DEC-020 REQ-CLAIM-1, DEC-024, DEC-026, DEC-061.
**Revisit if:** the operator tunes the interval more than ~twice per deploy (promote to a typed `app_settings` setting like `isEnginePaused`); or the flat fills-by urgent boundary proves too eager (switch to a `remaining_slack < remaining_pool × interval` test). Built on the #149/#147 base (DEC-062); stacked PR.

---

## DEC-064: The manual override honors the role-competency floor — no mate as captain
**Decision:** The cockpit's manual override (`overrideSeat`, `src/asks/ask-loop.ts`) still bypasses pool, rank, and current state — but **not** the seat's role rating. A crew member is placeable only if `isRatedFor(crew.ratings, seat.role)` (`src/oracle/eligibility.ts`). Enforced in **two** places: the shift-view override picker lists only crew rated for that seat's role (`page.tsx` scopes the roster per seat via `ratingsById`), and the `overrideTo` action re-checks server-side so a crafted form post can't seat a mate as captain (→ `act_error=not_rated`). `manualOverride` (the pure, unguarded primitive) is unchanged; `overrideSeat` composes the rating gate in front of it.
**Why:** Operator-reported (Eric): the override for a captain seat offered **mates**, which is a no-go — a mate can't hold a captain's license. The asymmetry "captains can sub for mates, not the other way" is already encoded in the **ratings**: on the pilot roster captains are rated `[captain, mate]` and mates `[mate]` (`db/seed-pilot-crew.ts`), so the exact-match `isRatedFor` passes a captain into a mate seat (the legit downward sub) while never passing a mate into a captain seat. No role hierarchy needed (DEC-ROLE-1 stays intact — roles remain a flat, tenant-defined set). The auto-ask / assign paths were already correct (they use eligibility); only the override bypassed it.
**Tradeoff:** The override is no longer *literally* "place anyone" — the role floor is the one thing it won't skip. Accepted: seating an unlicensed person as captain is a legal/safety floor, not a policy knob, so even the authority backstop shouldn't cross it. If a genuine "the rating data is wrong" case ever needs a true bypass, that's a data fix (correct the crew's ratings), not an override.
**Distinct from #148:** #148 (don't *auto-ask* dual-rated captains for mate seats) is the **downward** direction and needs a primary-role/precedence model the ratings don't carry. This DEC is the **upward** block (mate→captain), which the flat ratings already express — so it ships now without #148's model.
**Revisit if:** a tenant defines more than two roles with partial overlaps where exact-match rating is too coarse (then a precedence/rank model — the #148 work — would subsume this).

---

## DEC-065: The At-Risk board shows every uncrewed shift within the fill deadline — no hide-while-working
**Decision:** Route (b) of `deriveAtRiskBoard` (`src/admin/at-risk-board.ts`) boards a still-`Filling` shift whenever a required seat is uncrewed (`gapSeats.length > 0`) and the trip is within `EXHAUSTED_THRESHOLD_HOURS` (= `FILL_DEADLINE_HOURS`, 48h, DEC-031) — **regardless of ask state**. The old willingness-exhaustion gate (`trail.asked > 0 && trail.pending === 0`) is deleted: a shift no longer waits until every ask is answered to appear. Route (a) (eligibility-exhaustion / rested-`Bailed`) is unchanged — it still boards however far out. Regression and credential-lapse reasons unchanged.
**Why:** Operator-reported (Eric, pilot): a 2-days-out shift with no crew was invisible because asks were in flight, and **nudging a candidate removed the shift from the board** — the engine flipped it back to "actively working" and the hide rule swallowed it. The hide-while-working assumption ("on the board" == "the automation gave up") fails exactly when the operator most needs sight: a near-term uncrewed shift mid-ask. Compounded by ghosting + unwired `expireAsks` (#151), `pending` never drained, so willingness-exhaustion could never fire. Within 48h the operator wants to see every uncrewed shift, full stop.
**Tradeoff:** The board shifts from a pure "automation exhausted" surface toward a "near-term uncrewed" surface within the deadline — a small move toward the anxiety-dashboard BRAND/SPEC §2.5 guard against. Bounded deliberately: only inside `EXHAUSTED_THRESHOLD_HOURS` (48h), only for genuinely uncrewed seats; beyond 48h a `Filling` shift the engine is working still stays off (route (a) catches the truly-unfillable early). The urgency sort already orders within the board, so a still-working row doesn't bury a confirmed problem at similar time-to-trip.
**Supersedes:** the membership half of the board's willingness-exhaustion rule. DEC-031's "displayed instant IS the boarding instant" mechanic still holds — the instant is unchanged; what's removed is the *additional* all-asks-answered precondition. The "on the board = automation gave up" framing (the §2.5 board copy rationale) no longer holds for route (b). DEC-025 (urgency = pool-thinness) untouched.
**Relationship:** decouples the board from #151 (wire `expireAsks`) — visibility no longer depends on `pending` draining, though #151 still matters for the silent/ghost reliability signal and seat-reopen. Distinct from #148 (captain-for-mate auto-ask). No new state, schema, port, or constant — one boolean expression removed.
**Revisit if:** the board gets noisy at real pilot volume (many uncrewed-but-actively-dripping rows) — then split into sections (working vs exhausted) or tighten the imminence window below 48h. Tune `EXHAUSTED_THRESHOLD_HOURS` per pilot feel. The `board_landed` ping (DEC-026) now fires earlier (at the 48h crossing) and for more shifts — still one per (shift, reason), deduped, not repeat-spam; if DEC-MSG-3 delivery *volume* becomes the constraint rather than board density, revisit the ping trigger separately from board membership.

---

## DEC-066: Captains are never *asked* for mate seats — over-ranked crew drop from the askable pool
**Decision:** `rankedEligible` (`src/asks/ask-loop.ts`) — the one "who do we ask, ranked" pool that auto-ask, the drip (DEC-063), bail/remove re-asks, lean, the guarded assign (`assignFromPool`), the assignment-view seat-card pool, escalate, and the At-Risk board's `available` lean list all read — now also drops crew **over-ranked** for the seat: anyone holding a role ranked above the seat's role in `ROLE_PRECEDENCE` (`src/config/tenant.ts`, most-senior-first tenant data, `[captain, mate]`) is excluded. The pure gate is `isAskableFor(ratings, role)` in `src/oracle/eligibility.ts`, layered on top of `isRatedFor`. So a pilot captain (rated `[captain, mate]`) is never auto-asked or leaned for a mate seat — but stays **manually assignable** via the cockpit override (DEC-064, which seats by `isRatedFor` and does not read this pool).
**Why:** Operator-reported (Eric, pilot): the engine kept asking him — a captain — for mate shifts. Spending scarce captains on mate seats (and spamming them) is exactly backwards; he wanted them simply never asked, with manual placement as the escape hatch ("really easy: they don't ever get asked, but they are manually assignable"). #148 had been deferred pending a "role-rank model"; this is the minimal version — one tenant precedence list, no schema, no per-crew primary-role field.
**Tradeoff / scope:** Introduces a *role precedence* where DEC-ROLE-1 declared roles a **flat** set. Bounded deliberately: precedence is an **ask-routing preference**, not a domain hierarchy and not an eligibility gate — the oracle (`solveShift`/`eligiblePool`) still counts a captain as able to crew a mate seat, so satisfiability/exhaustion and manual assignment are unchanged. A mate seat with *only* captains left gets no auto-ask and shows no lean targets; it surfaces on the board within 48h (DEC-065) for the operator to override a captain in — acceptable and rare. The precedence hardcodes the pilot's two role ids in tenant config (tune-later, DEC-001), not a migration.
**Distinct from DEC-064:** DEC-064 was the **upward** block (a mate can't be *placed* as captain — `isRatedFor`, honored even by the override). This is the **downward** ask-suppression (a captain isn't *asked* for a mate seat) that DEC-064 explicitly deferred to #148. Together: mate→captain impossible; captain→mate manual-only.
**Revisit if:** a tenant defines 3+ roles with partial/overlapping competencies where a single linear precedence is too coarse (then a per-role capability model, perhaps a `role_types.rank` column, subsumes this); or operators want captains *asked* for mate seats once the mate pool is walked (a fallback this hard rule omits by design).

---

## DEC-067: Silent-ask sweep wired into the tick — ghosted asks time out, seats reopen
**Decision:** The engine tick (`src/builder/tick.ts`) now sweeps each **`Asked`** required seat's asks through `expireAsks` (the clockless `ask_ignored` sweep, DEC-MSG-3) **before** resolving shift state and running the drip, using a new env-tunable timeout `ASK_SILENT_TIMEOUT_MINUTES` (`src/builder/derive.ts`, `envPositiveInt`, default **120** = 2h). An ask unanswered past that age is stamped `respondedAt` with no `response` (→ "silent") and logs `ask_ignored` (the negative reliability signal, DEC-008); if it was the seat's last live ask, the seat reopens to `Open`, so the same tick's drip widens to the next ranked candidate (DEC-063) and a walked-then-`Open` seat escalates to Tier-2 (DEC-024). Closes #151.
**Why:** `expireAsks` shipped clockless (DEC-MSG-3: "no timer, the caller decides when to sweep") but **no caller existed in prod** — so a ghosted ask sat `pending` forever: the seat never reopened, the drip couldn't move past a non-responder, Tier-2 couldn't escalate the silent ones, and the reliability score never saw the ghost. In a real pilot where crew ignore texts, the engine stalled on the first ghoster. DEC-065 decoupled *board visibility* from this; engine *progression* still needed it.
**Placement (before state-resolution):** the sweep runs at the top of each shift's per-tick processing so the reopen is visible to `resolveShiftState`, the drip, and escalate **this** tick, not next — no dead 15-minute gap where a just-expired seat sits idle. `expireAsks` is idempotent (skips already-stamped asks) and clock-injected (`now`), so re-running a tick is safe.
**`Asked`-only gate (review catch):** the sweep skips filled (`Claimed`/`Confirmed`) and `Open`/`Bailed` seats. A broadcast/blast leaves the losing recipients' sibling asks **live** on a now-filled seat (`recordResponse` doesn't close siblings); sweeping those would log `ask_ignored` against crew who never ghosted a fillable seat and poison the ranker (DEC-008) — worst on the within-48h blast path where the whole pool is asked at once. Only `Asked` seats — where a live ask whose timeout actually means "no answer to a still-open seat" — are swept.
**Timeout default:** 2h is a tune-later pilot guess (same posture as `STAFFING_HORIZON_LEAD_DAYS` / `ASK_DRIP_INTERVAL_MINUTES`), env-overridable per deploy with no code change. Positive-int only — a 0 timeout would expire every ask the instant it's sent — so it uses `envPositiveInt`, not the drip's non-negative helper.
**Co-shipped (#145):** `recordResponse` now no-ops on an already-answered ask (guards on `respondedAt`), so a re-tap can't re-log `ask_accepted`/`ask_declined` or re-stamp. Independent correctness fix in the same path; adds the `already_answered` outcome reason.
**Revisit if:** ghosting timeouts want to vary by lead time (a same-day trip might want 30 min, a week-out one 12h) — then the flat minutes becomes a function of time-to-trip; or `expireAsks`' per-seat sweep cost matters at DB scale (same indexed-read revisit as DEC-022/DEC-024).

---

## DEC-068: Presence enters the doorbell decider as a per-(subject,thread) three-state verdict; v1 fills it coarsely
**Status:** Accepted (Phase 6 / 6.4) — @architect 2026-06-26 (Opus). Numbered past `main`'s DEC-061–067 (the feature/messaging branch is behind on DECs) so the eventual merge carries no duplicate number.
**Decision:** The pure doorbell decider (#114, DEC-048) takes presence as a per-`(subject,thread)` verdict with **three** states — `present_here | present_elsewhere | absent` — and maps them to **suppress-entirely** (§7.1) / **in-app toast** (§7.6) / **SMS-eligible** (§7.2–7.5). All three branches are written in 6.4. The **edge** produces the verdict: the v1 edge, fed only the global `lastActiveFor` signal + presence window (DEC-047/060), can never emit `present_here`, so it emits `present_elsewhere | absent` — the v1 observable is "present-anywhere → toast, absent → SMS" (a crew member reading the very thread gets a harmless redundant in-app toast, not silence). The `isPresent`/window classification lives **at the edge, not in the decider** — `here` vs `elsewhere` is socket knowledge, not derivable from a global timestamp.
**Why:** DEC-047 promises the realtime swap lands "with zero change to the doorbell decider" but doesn't specify the mechanism that keeps the promise. A per-subject *two*-state presence input would force adding a `present_here → suppress` branch — a decider + heavy-test + 6.5-harness rewrite — when per-thread presence arrives. Pre-shaping the input per-`(subject,thread)` makes the realtime adapter a pure edge change. The `(subject,thread)` key is natural — the decider already iterates recipient×thread to address rings — so this is **one enum variant**, not new structure. The swarm-fear / anti-anxiety property (§7.1, SPEC §2.5, BRAND) is preserved by the coarse v1 mapping: present crew get no SMS regardless of which state.
**Tradeoff:** v1 cannot fully suppress (§7.1's strongest form) — a crew member staring at a thread gets a redundant in-app toast rather than nothing. Accepted: it's an in-app badge, not a phone ring, and cancel-on-read + the live message cover it. `present_here` is dead code until realtime.
**Rejected:** two-state `present | absent` inside the decider (breaks DEC-047's zero-decider-change promise); decider-side timestamp classification (the here/elsewhere upgrade isn't expressible from a global timestamp).
**Revisit if:** DEC-047's realtime adapter lands — the edge begins emitting `present_here` and v1's full-suppression gap closes with **no decider change**.
**Phase:** Phase 6 (6.4).

---

## DEC-069: Doorbell read/notify state — two single-writer tables, not one consolidated row
**Status:** Accepted (Phase 6 / 6.6a) — @architect 2026-06-27 (Opus).
**Decision:** The decider's injected `readState` / `notifyState` (DEC-068) persist as **two** tables (migration `0010`): `message_reads(thread_id, subject_kind, subject_id, last_read_at)` and `doorbell_notifications(thread_id, subject_kind, subject_id, last_notified_at)`, PK on the triple with `thread_id` leading; plus `messages.priority boolean not null default false` (the decider's `PendingMessage.priority` source, §7.4). Repository methods are thread-scoped + `subjectKey`-keyed (`readStateForThread` / `notifyStateForThread` / `recordRead` / `recordNotification`), symmetric with `PresencePort.lastActiveFor` — a never-recorded subject is omitted (decider reads null → fail toward ringing).
**Why:** Separate because the two have **different owners and lifecycles**, not because of lock contention (a single-column `ON CONFLICT DO UPDATE` has none, and a 20–25-crew pilot has no write volume): `message_reads` is the **crew-app's** unread substrate (written by the read path, 6.7, useful beyond the doorbell); `doorbell_notifications` is **doorbell-private** last-rang state (written by the tick, 6.6b). One concern per table — the instinct that gave `presence` / `outbox_entries` / `app_settings` their own tables. Keying reuses DEC-058's composite `(subject_kind, subject_id)` (the 0009_presence precedent). `priority` is a 1:1 message column (not a per-(subject,thread) relation), a **native boolean** (the schema's first — not text-encoded, which is a KV-store artifact).
**Tradeoff:** A consolidated `thread_member_state(last_read_at, last_notified_at)` would return both columns in one fetch, but it mis-homes general read-tracking inside a doorbell-flavored table and couples the 6.7 read-path migration to the 6.6b write-path. **Rejected:** the consolidated row; a partial index on `messages.priority` (no SQL filters by priority — the tick fetches all pending per thread and the decider filters in-memory); text-encoding the boolean. **Phase:** Phase 6 (6.6a). Substrate now — `recordRead`'s call-site is 6.7, `recordNotification`'s is 6.6b; the adapter-parity contract + a decider-boundary fixture pin the semantics before either consumer exists.

---

## DEC-070: The doorbell tick — a separate cron that sweeps threads-with-messages and records-on-decide
**Status:** Accepted (Phase 6 / 6.6b).
**Decision:** The doorbell runs on its **own** cron `/api/cron/doorbell-tick` (DEC-040 precedent — separate from the engine `tick` and the Xola pull, CRON_SECRET-guarded, `*/2`), the time-driven trigger for the irreducible outbound ring (DEC-049). Each sweep covers **every thread that has messages** (`listThreadsWithMessages`), **not** a `createdAt`-bounded slice — §7.4 priority can be flipped on an *old* message whose timestamp predates any window, so a slice would silently miss it; a quiet thread instead costs the decider one cheap `all_read` pass. The tick assembles the decider's inputs from the store + `PresencePort`, classifies presence at the **edge** (coarse signal → `present_elsewhere | absent`, never `present_here` — DEC-068), runs the pure decider, and **records notify-state on decide** (the ring is the source of truth; first-only-until-read must hold even if delivery later fails — delivery is best-effort/swappable). It shares the engine pause gate (DEC-054): a paused operator means a quiet doorbell.
**Why:** A separate cron isolates a doorbell hiccup from staffing and lets cadence tune independently (DEC-040: cadence is the latency lever). Record-on-decide mirrors the engine tick's record-then-relay split — the decider/tick own the decision (pure + idempotent on stored state), the edge owns delivery. Sweep-all-threads-with-messages is the only enumeration safe against the priority-on-old-message trap the 6.6a architect flagged; at a 20–25-crew pilot the per-thread cost is trivial.
**Tradeoff:** A growing message history grows the sweep set (every ever-messaged thread, swept every 2 min) — acceptable at pilot scale; a "threads with un-rung unread" index is the optimization if it ever bites. Record-on-decide means a ring recorded but undelivered (a fake/relay failure) is suppressed until the recipient reads — accepted because delivery is best-effort and a re-ask isn't the doorbell's job.
**Pilot delivery is the fake/log adapter** (DEC-050): the loop is closed end-to-end and proven, but the real ring relay is 6.8 (operator outbox) / 6.9 (Twilio). Vercel crons run **only on the production deploy**, and Phase 6 isn't promoted until 6.8's real relay lands — so the fake delivery never runs against live traffic. **Revisit if:** the sweep set grows costly (add the un-rung-unread index); or a dedicated doorbell pause (independent of the engine pause) is wanted. **Phase:** Phase 6 (6.6b).

---

## DEC-071: Crew messaging UI — read + presence are one edge signal on real view; DM list is a participant index; view-auth is the DEC-052 predicate
**Status:** Accepted (Phase 6 / 6.7) — @architect-reviewed 2026-06-27 (Opus).
**Decision:** The crew chat surface (artifact §10) ships per the crew-app ethos — pure server components, no realtime (DEC-047): thread list, thread view + compose, start-a-DM off the shift card, refresh-to-see-new, 375px. Five resolutions:
- **§7.6 "in-app toast" v1 = an unread BADGE, not a live pop.** Already settled by DEC-050/068 (the toast is a 6.7 read-model, never a port send) + DEC-047 (no live pipe) — so this is not a fresh call, just its realization. Computed server-side from raw read + message state on navigation (the doorbell *decision* is a delivery output, never UI-readable); rendered in a calm accent token, never an alarm color (the §2.5 / BRAND anti-anxiety discipline — an unread count is not a risk glow). The popping toast lands with the socket (DEC-047).
- **Read-state AND presence are recorded together on real human view, via a contained client-beacon island (the DEC-055 carve-out), not on the server GET render.** 6.7 is the first production call-site for BOTH `recordRead` (DEC-069) and `recordActivity` (DEC-047) — without the latter every member classifies `absent` and the doorbell's §7.1/§7.6 present-suppression / in-app-toast branches stay dark, gutting the whole anti-swarm property. A GET-render write is rejected: prefetch / bfcache / link-unfurl / bot false-positives all *silence a real ring* (the wrong direction under "fail toward ringing"), and the doorbell SMS's own tap-to-open link, unfurled by a carrier, would mark a thread read before the human taps and cancel its follow-ups (the 6.9 trap). The beacon (`/crew/activity`, mounted in the `(crew)` layout, keyed on pathname; threadId via `useParams`) fires only on a real browser view.
- **The DM list is a participant-keyed `listDmThreadsForCrew(crewMemberId)` port method**, NOT a scan of `listThreadsWithMessages` (the doorbell's all-subject sweep — DEC-070) filtered to my rows. Standing-thread membership stays *derived* (DEC-051): the list computes deterministic `standingThreadId`s from the viewer's seats / roster / today, so an unposted cohort/shift/all-staff thread needs no row — it's find-or-created by the first post. Only DMs (no derivable membership) need the index. No migration (threads / participants / message_reads exist from #111 / 6.6a).
- **View authorization = the DEC-052 predicate `member OR operator`**, distinct from the doorbell's membership-only *attention* line (DEC-058). 6.7 enforces only the crew-member branch (no operator routes yet); 6.8 ORs in its operator cross-visibility against the same predicate — the gate is not written as crew-only "membership == authorization." The crew-member half authorizes a *persisted* thread via the **same `deriveMembers` the doorbell rings on** — **date-agnostic**, so a thread that can ring a member always opens for them (no "rung-but-can't-read" at the vessel-day rollover; the date filter lives only in the list's *display*, not the auth predicate). An unposted standing thread (never rung — no messages) authorizes via the date-filtered list, its only reachable path.
- **Crew may compose in any thread they're a member of** (cohort / shift / all-staff / DM) — the lean v1, matching artifact §9 (crew reply into the cohort thread) and §7.1's swarm guard living in the doorbell, not a per-kind write lock. The operator's §10 extra is *visibility-across-everything* + originating broadcasts (6.8), not an exclusive write to all-staff. **Watch item:** if a crew member blasting all-staff proves noisy at pilot, an operator thread-lock is the 6.8 refinement; crew never set `priority` (operator-only, §7.4 / 6.8).
**Why:** Presence-recording is the keystone the anti-swarm property rests on (§7.1) — shipping read-tracking without it leaves the doorbell half-built. Recording both on observed real view (not a prefetchable GET) is the only shape immune to the ring-silencing false-positives an attention engine must avoid. The DM index is the inverse of persisted-only-DM membership (DEC-051); authorization-as-predicate keeps 6.8's operator visibility (DEC-052) from forcing a gate rewrite.
**Tradeoff:** A client-beacon island (re-using the DEC-055 import-feedback precedent) on an otherwise pure-server surface; one new read-only port method + adapters; N+1 per-thread reads in the list (trivial at pilot scale, consistent with DEC-070). Built as **one PR** (not split along the issue's "static threads vs badge" seam — a capable model holds the coherent 5, and the badge/read/presence half shares the view-model the list needs). **Rejected:** read-on-GET-render (unfurl/prefetch false-reads, harmful direction); scanning `listThreadsWithMessages` for DMs (cross-subject sweep mis-use); a crew-only membership gate 6.8 must widen; re-deciding badge-vs-live-toast (settled by DEC-047/050/068). **Revisit if:** the socket lands (toast goes live, DEC-047); or crew-to-all-staff proves noisy (operator thread-lock). **Phase:** Phase 6 (6.7).

---

## DEC-072: Operator messaging surface — cross-visibility via the DEC-052 predicate ORed into `buildThreadView`; the operator is excluded from doorbell rings
**Status:** Accepted (Phase 6 / 6.8) — @architect-reviewed 2026-06-27 (Opus). Stacked on 6.7 (#171); max DEC on `feature/messaging`.
**Decision:** The operator messaging surface (`/admin/messages`, artifact §10) ships as the **admin branch of the existing 6.7 view layer**, not a parallel one — one read-authorization site for DEC-052 / 6.9+ (the DEC-071 seam, realized). Five resolutions:
- **One authorization site.** `buildThreadView` branches on `viewer.kind`: a **crew** viewer must be a member (the date-agnostic `threadMembership`); the **operator** (admin) reads ANY thread (DEC-052 cross-visibility) — resolving a real row, or a synth of the two **post-targets** (all-staff / today's cohort, via `standingThreadId`) so an unposted broadcast is still openable. The ~10-line message-shaping is shared (`shapeMessages`); only `mine`, auth, and resolution branch. A separate `buildOperatorThreadView` was rejected — it would fork the DEC-052 predicate into two sites 6.9 must keep in sync.
- **The office is one voice.** `mine = (senderKind === "admin")` for the operator viewer — never keyed on the session handle (a non-identity, DEC-020) nor `OPERATOR_CREW_MEMBER_ID`. Matches `senderLabel`'s existing "Operator"-on-`senderKind` (DEC-030 §7 / DEC-058). The operator posts `senderKind:"admin"` / `senderId:OPERATOR_CREW_MEMBER_ID`.
- **Cross-visibility list.** `buildOperatorThreads` = the post-targets ∪ `listThreadsWithMessages()` (the all-subject sweep, DEC-070), deduped by id with the **real row preferred over synth** (true `createdAt`); post-targets pinned, the rest by recency. **No unread badge, no read/presence recording** — a deliberate PULL surface (DEC-042 ethos) and a deliberate asymmetry with crew `postMessage`. Operator DM titles name **both** participants (`threadTitle` gains `viewerCrewId: CrewMemberId | null`; null → join names). The operator **posts only to the two broadcast doors** — all-staff + today's cohort (`ThreadView.canPost`, enforced in the post action too); every other thread they can *see* (shift threads, crew DMs) is **read-only**, so the office never injects into a private 2-person DM. Future-cohort posting and type-derived priority are deferred. An **optional manual priority flag** rides the compose (§7.4 / DEC-069 — the operator's only; crew hardcode false).
- **The operator is EXCLUDED from doorbell ring-membership (the load-bearing fix).** The operator participates as `OPERATOR_CREW_MEMBER_ID` (`crew-eric-stoffer` in this deployment), who **IS a real, active roster crew member holding seats** — the operator-as-crew clause (DEC-030): the engine asks them for shifts. So `deriveMembers` returns them for **all-staff + every thread they're seated on** — they are a member of *many* threads, not (as first assumed) of none. Without intervention, the operator's own `admin` broadcast can't be self-filtered against their `crew`-addressed membership (the decider keys `authoredBy` on `senderKind`, `doorbell-decider.ts:313`; members are addressed `kind:"crew"`, `:214`), so **every operator post would ring the operator about their own message** — guaranteed on any all-staff broadcast (they're on the roster). Fix: the doorbell tick takes `operatorCrewMemberId` and drops it from ring-membership alongside the inactive-crew gate (`doorbell-tick.ts`). The operator monitors every thread via `/admin/messages` (DEC-052) — they are never a doorbell recipient. Asks still reach them (the outbox path is separate, DEC-030). This is *why* the surface records no operator read-state: there is no ring to cancel.
**Why:** Keeps the DEC-052 visibility predicate single-sited (DEC-071); makes operator posting the natural home for §7.4 priority; and turns the operator-as-doorbell-member hazard from a latent landmine into an explicit, tested exclusion. The first design assumed the operator was "a member of nothing" (true only if unseeded); the operator-as-crew reality (DEC-030) makes the exclusion mandatory, not cosmetic.
**Tradeoff:** All crew DMs are operator-visible with **no crew-side disclosure** in v1 — a real §6 trust gap (crew read "DM" as private; §6 promises only number-privacy, not content-privacy). Surfaced, not silently shipped: a one-line crew disclosure is a thin fast-follow to raise with the operator. The ring-exclusion couples the tick to one operator id (a `string` param, defaulted off).
**Invariant:** operator correctness now rests on the tick being **passed** `OPERATOR_CREW_MEMBER_ID` (it is, from `app/lib/doorbell.ts`). If the operator id ever changes without the env propagating, or a second operator identity is added, revisit the exclusion. **Rejected:** a separate operator view-model; keying `mine` on the handle/operator-id; relying on the operator being unseeded; future-cohort posting and type-derived priority (deferred). **Revisit if:** crew-DM-visibility disclosure is requested; the live socket lands; a second sender number / the ring relay (next stack) ships — the relay makes the (now-excluded) operator ring path moot but must keep the exclusion. **No migration.** **Phase:** Phase 6 (6.8).

**Amendment (#317, 2026-07-10):** the future-cohort deferral above is **lifted** — the operator may now post to any **today-or-future** cohort, not just today's. `operatorStandingTarget` (the authorization) accepts any well-formed cohort thread whose date `>= today`; `operatorPostTargets` (the two default doors in the list) is unchanged, so the *authorization* is now broader than the *shown* doors. The trigger is the cockpit's **Cohort button** (message a shift's whole-day cohort), but the widened predicate also makes any today/future cohort the operator can already *see* (cross-visibility) postable — intended. The ring-on-future-membership interaction that motivated the deferral resolves as **advance notice**: a future-day cohort post rings that day's crew now (the doorbell has no date filter), surfaces in their thread list on the day, and links them in via the ring meanwhile. **PAST cohorts stay refused** (ringing crew about a day that already ran is a footgun; the cockpit hides the button there). A cohort post auto-leads its body with "Cohort" so it's distinguishable from an all-staff broadcast.

---

## DEC-073: Real doorbell-ring relay — the operator-outbox `NotificationPort` adapter, on its own table
**Status:** Accepted (Phase 6 / 6.8) — @architect-reviewed 2026-06-27 (Opus). The promotion gate (DEC-070): Phase 6 does not promote until rings reach a real recipient. No migration conflict — a *new* table.
**Decision:** `OutboxNotificationChannel implements NotificationPort` (sibling to `WebLinkChannel`) replaces `FakeNotificationChannel` at the one swap point (`app/lib/doorbell.ts`). `send` mints a fresh thread-deep-link magic link and enqueues a **`RingOutboxEntry`** the operator relays by text from `/admin/outbox` — the DEC-030 web-link model, mirroring asks. Five bindings:
- **Own table `ring_outbox`** + own entity + own repo methods + own `buildRingOutboxView` — NOT a union on `outbox_entries`. The same call DEC-050 made (separate port, don't overload the ask path) and DEC-069 made (separate tables for different owners/lifecycles): ask-outbox (owner `WebLinkChannel`, settle-on-answer) vs ring-outbox (owner `OutboxNotificationChannel`, ring-cycle + drop-on-read). Keeps the ask outbox's NOT NULL invariant + flat `OutboxEntry` untouched, drops cleanly at the 6.9 Twilio swap. Shares only the `/admin/outbox` page + the (now generic) `RelaySend` island (+ a thin `recordRingSent`).
- **Thread deep-link via a validated `thread` query param + server-built `/crew/threads/{id}` redirect** — never the param as a raw URL (a fixed prefix + `encodeURIComponent`; bad shape → `/crew`). threadId stays OUT of the `MagicToken` (no schema change). Safe because the thread page independently membership-gates (DEC-052/071) — the param is a nav hint, not authz — and it relies on DEC-071's **beacon-only** read-marking so a carrier unfurl of the link can't mark-read-and-cancel the ring (GET peeks, never POSTs/consumes, never fires the beacon).
- **Id `ring-{threadId}-{crewMemberId}`, upsert, fresh link per cycle** — first-only-until-read makes each enqueue a genuinely new cycle; the freeze rule (DEC-030 §2) is per-render and holds; an overwritten prior token orphans harmlessly until reaped (bounded by 24h TTL + single-use). Overwriting a `sent` entry back to `pending` is correct: a new cycle means text again.
- **Drop-on-read terminal rule:** the ring view drops an entry once `message_reads.last_read_at >= createdAt` for (thread, crew) — reuses DEC-069 read-state, no new state; the ring analog of the ask's drop-on-settled. The human taps the deep-link → the crew `ActivityBeacon` marks read → the decider stops re-ringing → the entry self-clears. Without it the worklist would rot (a ring has no `respondedAt`).
- **One page, two sections** (`/admin/outbox`: "Asks need you" by trip-tightness, "New messages" by recency — rings carry no trip). The ring card is **always relay** (the operator is excluded from rings, DEC-072 — no inline `self` mode), reuses the no-phone notice, and derives crew name/phone at render (only the relay text is frozen).
**Why:** Keeps the ask path literally untouched while delivering the promotion gate; the drop-on-read rule makes the worklist self-clearing off existing read-state; the deep-link is the artifact-§9 "tap → land in the thread" with no token-schema cost and no open-redirect.
**Tradeoff:** A second adapter-side table + view (vs a union) — accepted for the DEC-069 reasons. Best-effort relay + record-on-decide (DEC-070): a failed enqueue silently drops that cycle's ring until read / re-ring — inherited, no retry (re-ask isn't the doorbell's job). `content`-mode ring bodies pass the inlined message text through the operator's phone — consistent with DEC-052's operator-visible DMs for v1 (a recorded choice, not an accident). **Rejected:** discriminated-union on `outbox_entries` (erodes the ask NOT NULL invariant, shares no derivation); threadId in the token (schema change for no authz gain); a separate rings page (babysitting risk). **Revisit if:** sent rings need history beyond drop-on-read; or the Twilio doorbell number lands (6.9) and the manual relay retires (the exclusion + deep-link stay). **Phase:** Phase 6 (6.8).

---

## DEC-074: Crew self-serve is a fourth crew surface — a knowing, recorded exception to "insultingly small"

**Status:** Accepted (Phase 7). Reverses BRAND "insultingly small (crew app) — the crew member's
entire world is three surfaces." A crew member named the exception (asked for shift-picking back);
recorded as one, the same way DEC-042's all-shifts view was an operator-named pull exception.

**Decision:**
- A **crew-facing pull surface** (`/crew/open` or similar) lists **Open required seats the viewer is
  eligible for** and lets them claim one. This is the 4th crew surface (alongside ask / my-shifts /
  shift-card). Recorded as a deliberate exception, not a drift.
- **It is NOT a positive-availability calendar** (BRAND §"No positive-availability calendar … suppression
  only"). The crew member claims a **specific, already-formed shift** that exists because trips are
  booked — they are not declaring abstract future availability. The suppression-only oracle (§1.3,
  PTO windows) is untouched; this surface reads *through* it (a suppressed person sees nothing in their
  PTO window). State this distinction explicitly so the surface isn't mistaken for the parked
  availability calendar.
- **Inherits DEC-042's anti-anxiety guardrails verbatim:** default filter = today (+ "this weekend" /
  range presets), forward window clamped to `[today, today+45d]`, **no auto-refresh / no polling / no
  live counts**, `force-dynamic` render on navigation only, **neutral ink not colour** (warm/bad tokens
  stay reserved for the At-Risk board). A bare row count for orientation is fine; a per-state scoreboard
  is not.

**Why:** The "three surfaces" rule guards against friction and stale info, not against a surface crew
actively want. Restoring a loved workflow that *removes* operator toil (mates self-fill; the Sunday
text-blast dies) is squarely on-mission. Framing it as a DEC-042-style recorded exception keeps the
brand discipline honest rather than silently eroded.

**Tradeoff:** A 4th crew surface (the thing BRAND warns against) — accepted because it's pull, opt-in,
and inherits the proven guardrails. Crew can now cherry-pick the good shifts, leaving dregs to the
cascade — *desired* here (the eager people self-serving is the win; the cascade was always the tool for
the rest). **Rejected:** an availability calendar (the parked §4 feature — wrong shape, declares
abstract availability not concrete claims); leaving crewing push-only (ignores explicit crew demand +
keeps the mate toil that never needed to exist). **Revisit if:** cherry-picking strands hard shifts such
that the cascade's captain-fill gets *worse*, not just unchanged. **Phase:** 7.

## DEC-075: Self-claim is auto-lock (`Open → Confirmed`), bypassing `Asked`; operator-confirm-required is a built-in seam, not built

**Status:** Accepted (Phase 7).

**Decision:**
- A self-claim transitions the seat **`Open → Confirmed`** directly (auto-lock), skipping `Asked`. This
  reuses the existing **assign-then-confirm** path (§1.1: `Claimed` already means "accepted *or a named
  person was assigned*") — a self-claim is the crew member assigning themselves — collapsed straight to
  `Confirmed`. No invariant requires a preceding `Ask`.
- **The operator retains full confirm/override capability** post-hoc: a self-Confirmed seat is visible
  in the cockpit and can be reassigned/released by the operator like any other Confirmed seat.
- **Seam for operator-confirm-required (not built):** the claim service reads an `app_settings` flag
  `self_claim_requires_confirmation` (absent ⇒ false ⇒ auto-lock, mirroring DEC-054's `engine_paused`
  absent-⇒-running). When true (future), a self-claim lands in **the reserved `Held`/`Claimed` tier**
  (§1.1 "⏳ RESERVED … a tentative `Held`") pending operator confirm — i.e. the parked **Progressive
  crew commitment** primitive (§4). Write the service to branch on the flag now; do **not** build the
  Held tier or the confirm queue in Phase 7.

**Why:** Mates loved the *finality* of grabbing a shift — an operator-confirm gate kills that snap.
Auto-lock is the right MVP. But the operator explicitly wants the confirm capability to exist; the
cheapest honest version is a flag-guarded branch toward the tier the design already reserved, so flipping
it later is config + a queue, not a re-architecture.

**Tradeoff:** A self-Confirmed seat with no operator gate means a flaky self-claimer can lock a real
seat — mitigated by reliability tracking (DEC-078) and the operator override. **Rejected:**
`Open → Claimed` (tentative) as the MVP default (kills the finality crew asked for); building the full
Held tier now (premature — it's parked §4); a bespoke "self-claim pending" state outside the reserved
tier (forks the state machine the §1.1 reserve already anticipated). **Revisit if:** auto-lock produces
material no-shows from low-reliability self-claimers → flip the flag. **Phase:** 7.

## DEC-076: Two eligibility doors — self-claim is native-role-only; operator-assign is ratings-inclusive (the dual-rating escape hatch)

**Status:** Accepted (Phase 7).

**Decision:**
- **Self-claim door = native role only.** The browse list shows a viewer only the Open seats whose role
  is their **native role**, layered on top of the existing eligible-pool filter (§1.1: credentials valid
  on the trip date + holds the rating; §1.3 not-suppressed). A captain never sees mate seats.
- **`nativeRole(crew)` is derived, no migration for MVP.** With the captain+mate fleet (DEC-043), native
  role = the most senior role the member holds, precedence **captain > mate** (concretely: `captain` if
  `"captain" ∈ ratings`, else the sole role). The precedence is hardcoded *for the two-role world* and
  is the one acknowledged wart.
- **Operator-assign door = ratings-inclusive.** Operator manual assignment (the existing assign path)
  uses full `ratings`, so the operator can drop a captain-rated member into an Open **mate** seat
  last-minute to fill a shift. This door is admin-only and bypasses the browse surface entirely.
- Same seat, same state machine; **two different gatekeepers**. The dual-rating stopgap stays in the
  operator's hands and never enters the crew mental model.

**Why:** "No captain will ever self-assign to a mate shift" (operator). Dual-rating is purely a
last-minute operator fill hack, not a crew-facing concept; modelling it as two eligibility predicates
keeps the crew UX single-role-simple while preserving the hack.

**Tradeoff:** Hardcoded captain>mate precedence in `nativeRole` violates DEC-ROLE-1's "manning is data
the deriver loops" purity — accepted as scoped debt for a two-role fleet, with the graduation path
named. **Rejected:** adding a `primary_role` column now (premature for two roles; the derived rule
suffices); showing dual-rated crew both seat types with a role-picker (the confusion the operator
explicitly wants to avoid); a `role_types.rank` column now (the principled fix, but scope creep for
MVP). **Revisit if / graduation:** when **genuine multi-role work** lands (a person who actually *works*
more than one role, not pinch-hits) — promote native role to stored data (`crew_members.primary_role`
or `role_types.rank`) and design role-selection as a real crew-facing feature. *Until then, multi-role
is an explicit NON-GOAL (see SPEC §2.7 / §4).*
**Forward-planning — reliability floor on self-claim (post-MVP, additive, no re-architecture):** gate the
self-claim door on a tunable `reliability_score >= floor` — one more predicate on `claimableSeatsFor`, not
a new layer (the score is already on the crew row, §1.4 / DEC-008). It gates the *privilege*, not the
work: below-floor crew lose **self-serve only** and are still crewed normally via the cascade (operator
has eyes on it). It's the trust-tier cousin of the DEC-075 confirm-required seam — likely **one or the
other, not both**. Build-time decisions: a `null`-score **cold-start rule** (DEC-008 "no history yet" —
provisional pass / N training claims / neutral start; the real call, since a naive floor locks out exactly
the newcomers who need reps); a tunable threshold (`app_settings`/env like the horizon lead-days; `floor =
0` disables); `manual_floor`/`manual_boost`/`protocol_override` as the per-person exception hatch. **No
"not trusted enough" wall** — the surface just quietly appears once earned (§1.4 non-comparative ethos).
**Phase:** 7.

## DEC-077: Day-granularity commitment; elastic absorption is already built; sub-day "watches" are deferred

**Status:** Accepted (Phase 7).

**Decision:**
- The commitment unit is the **whole vessel-day shift** (current `shift-{vessel}-{date}`). Claiming a
  seat = committing to crew **every trip on that boat that day, including trips booked later.** No schema
  or grouping change.
- **Elastic absorption needs no new code** — it's the existing idempotent `formShifts` (`src/builder/
  form-shifts.ts`): a later reservation → event on that vessel-day → folds into the same shift's
  `eventIds`; the Confirmed seat (the self-claimer) is preserved.
- **The affordance lives in the claim confirm sheet** and must state the elastic scope in words, mirroring
  the ask format (§2.6.1 `… call 12:30, back ~6 …`):
  > *Claim Sat Jul 18 on Brew 2 as **captain**? That's the **whole day** — every trip booked, including
  > any added later. Right now: **2 trips** (1:00 & 4:00 PM), call 12:30, back ~6.*
  The **live trip count** makes "whole day" concrete; the **"incl. added later"** clause sets the elastic
  expectation so a Thursday-booked 7 PM trip isn't a betrayal. Use the §2.6.3 DEC-041 committed-window
  computation (latest departure + trip length + call lead) for "back ~6".
- **The "a trip was added to your Saturday" nudge is not new** — it's the §2.6 principle 1 live-card
  behavior ("departure changes → card changes → crew gets a ping", §3.1) applied to the
  event-added-to-a-held-shift case. Reuse it; do not invent a parallel nudge.
- **Sub-day blocks ("watches") are deferred.** When whole-day proves too coarse, the refinement is small
  and known: change the grouping key `vessel|date` → `vessel|date|block` and the id mint to
  `shift-{vessel}-{date}-{block}`, deriving `block` from `event.time`; everything downstream keys off
  `shiftId` and is untouched. Fixed named windows (admin-set boundaries), **not** crew-defined windows.
  **NON-GOAL for Phase 7.**

**Why:** Day-first is the minimum coherent build and reuses the strongest existing machinery. The
operator confirmed day-granularity is the right MVP; "afternoon/evening" is a real future need but not a
day-one blocker.

**Tradeoff:** Whole-day commitment may deter crew who only want evenings — accepted for MVP; the
sub-day path is pre-scoped so it's a fast refinement, not a rewrite. **Rejected:** a new
`Block`/`Watch` entity above shifts (fights the model — the shift *is* the day-container); crew-defined
availability windows (needs an availability entity, breaks the deterministic shift id, and is really the
parked calendar). **Revisit if:** crew decline whole-day claims they'd take as evening-only → ship the
grouping-key refinement. **Phase:** 7 (day); sub-day deferred.

## DEC-078: Concurrency, conflict, and crew self-release

**Status:** Accepted (Phase 7).

**Decision:**
- **Concurrency:** the claim is a **guarded transition** in the claim service — write `Confirmed` **only
  if the seat is still `Open`** (domain-owned optimistic check, no FK, per DEC-DATA-1). Loser of a race
  gets a clean "just taken" and a refreshed list. No locking.
- **Conflict guard:** a crew member may hold **at most one shift per date** via self-claim (whole-day
  commitment = can't be on two boats the same day). Reject a self-claim for date *D* if they already hold
  a Confirmed seat on a different shift on *D*. The operator-assign door may override (it owns edge cases).
- **Self-release reuses the existing bail edge** (§2.6 principle 2 "bailing is as easy as accepting"):
  crew can release a self-claimed seat → seat returns to `Open` via the `Confirmed → Bailed → Open` /
  graceful `Crewed → Filling` edge (§1.1), which **re-opens and re-asks** automatically. A self-release
  **emits a reliability event** (§1.4 / DEC-008); the existing score machinery weights it by lead time
  (a release weeks out barely registers; a near-departure release is effectively a bail and is weighted
  as one). No new cutoff logic — lean on §1.4 weighting. A **claim itself emits no reliability event**
  (it's an assignment, like an operator assign; reliability is earned at `Completed`).
- **MVP claimable set:** Open **required** seats on shifts in **`Pending` or `Filling`** (claiming during
  `Pending`, *before* the cascade fires, is the point — it front-loads commitment and the later horizon
  crossing finds the seat already Confirmed and skips it). Supernumerary seats are **out of scope** for
  Phase 7. Self-claim during `Pending` does not violate "crew rules abstain" (§1.1) — the *system* still
  abstains from asking; a crew member pulling is orthogonal.

**Why:** Reuses the seat machine's existing re-open/re-ask edges and the reliability model rather than
inventing release rules; the guarded transition is the minimal correct concurrency story for the
no-FK/domain-owns-integrity substrate.

**Tradeoff:** Optimistic-only (no reservation/hold during the confirm tap) can briefly show a
since-taken seat — accepted at pilot scale; the guard makes the failure clean. **Rejected:** pessimistic
seat locking (overkill at this scale); a fixed release-cutoff constant (the §1.4 lead-time weighting
already encodes "later = worse"); reliability-dinging the claim (wrong signal — showing up is what
counts). **Revisit if:** race "just taken" rejections become common enough to annoy → add a brief
client-side optimistic hold. **Phase:** 7.

## DEC-079: Crew-initiated sign-in + sign-out — the self-serve front door (a small addition, not a re-architecture)

**Status:** Accepted (Phase 7, issue **7.0** — sequenced *before* the 7.3 browse surface, which is
unreachable without it). Surfaced while reviewing this handoff: self-serve breaks the assumption that
every crew entry is an operator-relayed, action-scoped link (DEC-030/073). A crew member opening the app
*on their own initiative* to browse open shifts has **no link source**.

**What already exists (do not rebuild):** `app/lib/auth.ts` runs a real **14-day sliding session
cookie** (httpOnly, `sameSite=lax`, renewed inside the last 3 days) minted on magic-link consumption
(`/crew/auth` POST, prefetch-safe GET-peek / POST-consume). **`endSession()` — sign-out — already
exists** as a function. The `magic_tokens` mint/verify core (single-use CAS, hashed secret) is built. The
gap is purely the *self-initiated entry point* and a *button* for the existing sign-out.

**Decision:**
- **Sign-out button** — wire the existing `endSession()` to a tap in the crew shell. Trivial; matters now
  (shared/family phones; a standing 14-day session worth being able to drop).
- **Signed-out crew landing with self-service sign-in** — phone entry → mint a magic link → deliver →
  the existing POST-consume path mints the session. **Crew do NOT self-register** (§3.2): the phone must
  match a roster `crew_members.phone`; an unknown phone returns a **generic** "if you're on the crew, a
  link is on its way — otherwise check with the operator" (no enumeration leak of roster membership).
  **Rate-limit** the mint endpoint (anti-spam/enumeration).
- **Delivery channel — MVP = lean on the 14-day session, automated SMS deferred.** The whole current
  model deliberately avoids automated outbound SMS (operator hand-relays every link — the web-link model,
  DEC-030/073). A crew-initiated "text me a link" button *is* automated outbound SMS = the A2P **10DLC**
  trigger (the Sailbook thread; BrewBoat on Sole-Proprietor/Telegram fallback). MVP avoids forcing that:
  crew tap one operator-relayed link, **install the PWA / bookmark**, and stay signed in for 14 days
  (renewed every visit), so a fresh self-service link is needed only on expiry / new device / cleared
  cookies — rare. **Email the link** (`crew_members.email`, nullable) where on file as the non-SMS
  fallback. Automated SMS sign-in links ride the eventual Twilio/10DLC cutover, not this phase.
- **Admin auth is separate and unchanged** (§3.2 "a real authenticated login"); this DEC is crew-side only.

**Why:** The session/auth core is already correctly shaped — this is additive UI + one mint-and-deliver
path, not a re-architecture. Deferring automated SMS keeps Phase 7 from being held hostage by the 10DLC
timeline while still giving crew a working front door (relayed-link-once + long session + email fallback).

**Tradeoff:** Until automated SMS lands, a crew member with an expired session and no email on file needs
an operator-relayed link to get back in — acceptable at pilot scale; the 14-day sliding window makes it
infrequent. **Rejected:** automated SMS sign-in links in MVP (forces the 10DLC decision prematurely);
crew self-registration (violates §3.2 — roster is operator-created); revealing whether a phone matched
(roster-membership enumeration leak); building sign-in as a per-action link only (the very gap self-serve
exposes). **Revisit if:** the relayed-link-once + long-session path proves too leaky (crew locked out too
often) → promote to automated SMS as the forcing function for the Twilio/10DLC cutover. **Phase:** 7 (7.0).

---

## DEC-080: The Xola pull window is decoupled from the staffing horizon

**Status:** Accepted (pilot tuning, 2026-06-29).

**Decision:**
- The importer's `/orders` fetch window now reads its own env knob **`XOLA_PULL_LEAD_DAYS`**
  (`src/builder/derive.ts`, `envPositiveInt`), **defaulting to `STAFFING_HORIZON_LEAD_DAYS`** so an
  unset value reproduces the prior behaviour exactly. `pullWindow` and `pullXola`
  (`src/import/xola-pull.ts`) size the fetch window from the **pull** lead.
- **Shift formation is unchanged.** Inside `pullXola`, `formShifts` keeps keying off
  `STAFFING_HORIZON_LEAD_DAYS` (the staffing horizon, `opts.leadDays`), so a wider pull imports more
  bookings for the operator to *see* without the engine starting to *ask* crew that far out
  (Pending→Filling, and therefore the Tier-1 asks, are unaffected).

**Why:** The operator wanted to pull ~a month of bookings ahead, but the import window and the
staffing horizon were the **same constant** — bumping it to 30 would have made the engine ask crew a
month out, against the anti-anxiety design (DEC-042 ethos, the §2.6 "no stale far-future" stance). The
two leads answer different questions ("how much do I want to *see*?" vs "how early do I *ask*?") and
now have independent knobs.

**Tradeoff:** A second days-ahead knob the operator can set inconsistently (e.g. a pull *narrower*
than the horizon would starve the engine of far-horizon shifts) — accepted; the default-to-horizon
fallback makes "unset" safe, and a too-narrow pull is an obvious misconfiguration, not a silent
corruption. **Rejected:** bumping the shared `STAFFING_HORIZON_LEAD_DAYS` (couples seeing to asking —
the bug); a fixed wider pull constant (un-tunable; the pilot wants to dial it); deriving the pull lead
as `horizon × k` (a magic multiplier hides intent vs an explicit days value). **Revisit if:** the pull
and horizon want to diverge per-rule or per-tenant → fold both into the tenant-config layer the
DEC-022 "constant now, config later" note already anticipates. **Phase:** pilot tuning (between 6 and 7).

---

## DEC-081: Crew sign-in is a 6-digit email code, not a magic link — and it's the one login primitive (refines DEC-079)

**Status:** Accepted (Phase 7, issue **7.0**). Built in two PRs: **7.0a** (the flow, dark behind a flag,
fake delivery) and **7.0b** (real email). Refines DEC-079's mechanism after building it surfaced four
things that change the shape; the goal (a self-serve front door) is unchanged.

**Decision:**
- **Code, not link.** Sign-in emails a **6-digit numeric code** the crew member pastes back, instead of a
  click-through magic link. The link's failure mode on mobile is the killer: it opens in the *email app's*
  in-app browser, not the installed PWA, so the session cookie lands in a context the crew member isn't
  using. A code never leaves the app they started in. It also deletes the prefetch-burn problem (the
  GET-peek/POST-consume dance exists only because preview bots fetch URLs) and the link-host coupling
  (`APP_BASE_URL`, DEC-057).
- **One login primitive; links are only ever deep-links.** "All login is a code" — there is never a second
  login path. The ask-relay and doorbell-ring **links stay links** because they are *addressed deep-links*
  (auth **plus** a target — answer *this* ask, open *this* thread), not bare logins; recoding them would
  regress the Phase 6 one-tap flow. Rule: **a login is always a code; a link is never a bare "log in".**
  The code primitive is built once (7.0) and reused as other logins (admin) are built — not a rip-replace.
- **Email entry, not phone entry** (changes DEC-079). Delivery is email and email is universal on the
  roster; **phone is not** (operator-managed crew like Henry have none). So the identifier you type is your
  **email** — "type your email → code in that email," what-you-type-is-where-it-goes, no phone dependency.
  Phone entry returns when SMS/Twilio gives a second channel to justify a second entry field.
- **Its own `login_codes` table, NOT `magic_tokens`.** A 6-digit code is not globally unique, and
  `magic_tokens.token_hash` is `unique` + hash-keyed — so codes are keyed by **subject** (one live code per
  subject; re-request upserts), which is also what makes attempt-capping possible (find the row by *who*,
  not by a wrong guess that hashes to nothing). Only `sha256(code)` is stored.
- **Security is the cap, not the entropy.** 6 digits + a **5-attempt ceiling** + a **10-min TTL** + a
  60s re-mint cooldown. The throttle does the work, so the code stays short and number-pad-friendly
  (`inputmode=numeric`, `autocomplete=one-time-code`). Letters/symbols were rejected: they buy entropy the
  cap makes unnecessary and cost typeability.
- **Email delivery = Resend over `fetch`, on the ChannelPort seam (7.0b).** No SDK (the env-key+`fetch`
  shape the Xola adapter already uses — no new dependency), `EMAIL_FROM` on a DKIM-verified
  **`crew.brewcle.com`** subdomain (isolates sending reputation). 7.0a delivers through `FakeChannel`
  (logs) + a dev-only `/crew/dev-code` echo (hash-only store, gated 404-in-prod like `dev-link`).
- **Flag-gated OFF in prod until 7.0b** (`CREW_SELF_SERVE`, DEC-059). `main` must stay promotable at all
  times; a login that says "check your email" and emails nothing (7.0a's fake channel) would be a broken
  prod login, so the self-serve landing ships **dark**, flipped on when real email is verified. **Sign-out
  ships live** (unflagged — it only clears the caller's own cookie).
- **Email stays nullable** (does NOT take DEC-079's "email where on file; otherwise relay" *or* a
  required-email migration). The repository contract treats crew-without-email as a supported shape, and a
  system-wide required-email change is its own task. The flow is safe regardless: an email-less crew member
  simply doesn't match → the identical generic response, no leak, no false "check your email." "Everyone
  has email" is **operator data discipline** (a candidate add-crew-form constraint), not a DB constraint
  here — which also dissolves DEC-079's email-less dead-end.

**Why:** the click-to-wrong-browser problem is magic links' #1 real-world failure for an installed-PWA crew
audience; the operator confirmed it's exactly the friction they disliked. Everything else (own table,
attempt cap, email entry, flag gate) falls out of choosing a short human secret delivered by email.

**Tradeoff / rejected:** reusing `magic_tokens` for codes (unique-hash collision); making `crew_members.email`
NOT NULL in 7.0 (breaks the contract's optional-email shape, system-wide blast radius); alphanumeric codes
(typeability cost, no security gain under the cap); phone-entry now (no SMS channel yet); recoding the
deep-links as codes (regresses the one-tap ask/ring flow). **Revisit if:** SMS lands (re-add phone entry +
SMS code channel) or the email-less gap bites (promote to a required-email task or operator-relay). **Phase:** 7 (7.0a/7.0b).

---

## DEC-082: Locking cut — Xola is the source of truth (supersedes SPEC §2.3 Lock; reframes DEC-029)

**Status:** Decided 2026-07-01 (operator). Phase 8 drops **8.2b** (Edit mode = per-shift lock) and **8.6** (bulk "lock the weekend"). The lock scaffolding shipped **unwired** in 4.6/DEC-029 — `lockShift`, `Shift.lockedAt`, `changedSinceReviewed` + the cockpit "changed since reviewed" nudge — but **no UI ever called `lockShift`**, so nothing was ever locked in production (only `seed-atrisk-dev` scenario G sets one, to demo the nudge). Formally cut, not completed.

**Why:** a "reviewed / locked" stamp is meaningless when **Xola owns the truth**. Bookings *and their changes* arrive from the **Xola importer** (DEC-036/040/043) on its own cadence — a "reviewed" flag would be re-reconciled against a system that re-imports. And lock never gated crewing: the engine asks crew **autonomously** off the staffing horizon (DEC-022/023), independent of any lock. So lock had no teeth beyond enabling a review-checkpoint nudge — the very human-review-everything ritual the **no-babysitting** thesis (BRAND §Philosophy) is built to eliminate.

**Vision it records:** Muster **sits next to Xola** as the operator's real scheduling companion — *Xola knows the booking is paid; Muster knows who's running it.* Muster does not re-own Xola's truth; it owns **crew**. The eventual loop is **write-back** (crew assignments → Xola — parked HIGH idea, 2026-07-01), not a lock-and-review gate inside Muster.

**Still Muster-native (NOT cut):** split/merge of *crew*-shifts + seat/manning overrides (Phase 8: 8.3–8.5). Xola has no crew concept, so these are Muster's to own. Their live question is **re-derivation survival** — a manual crew-split must survive the importer re-forming that vessel-day from Xola (the 8.3 @architect/DEC gate, sharpened by this framing).

**Supersedes / reframes:** SPEC §2.3's **Lock** action + **Lock semantics** section (not built). **DEC-029's** "changed since reviewed" nudge loses its lock anchor — if change-detection is wanted later, anchor it to **Xola import diffs** ("changed in the last pull") or a *view*-based "changed since you last looked," never a lock.

**Cleanup (follow-up issue):** retire the dead scaffolding — `lockShift` / `changedSinceReviewed` (`src/builder/lock.ts`), the cockpit nudge (`app/(admin)/admin/shift/[shiftId]/page.tsx`), the seed's scenario-G lock; `Shift.lockedAt` may linger inert until a migration prunes it. Not ripped out here.

---

## DEC-083: Manual Split — cut-time partition on the canonical row, re-derived each pull; import-diff cue over the existing audit

**Status:** Decided 2026-07-01 (@architect, Phase 8.3, #206). Two passes: the first set the shift-rows-as-override model; this refines it — cut-time replaces the event-id list, `splitId` is dropped, and the change-cue mechanism is pinned. Sharpens DEC-082's "split/merge must survive re-derivation."

**Decision.** A manual split is TWO shift rows sharing `vesselId|date`:
- **Side A keeps the canonical `shift-{vessel}-{date}` id** — its seats and confirmed/live-ask crew are preserved for free (seat ids are namespaced `seat-{shiftId}-{role}-{n}`; `formShifts` preserves seat state by id). **Side B is `…-b`**, born fresh.
- **The split is stored as ONE nullable field, `Shift.splitCutTime` (vessel-local "HH:MM"), on the canonical row only.** Its presence is the split marker and the sole authoritative partition fact. **No `splitId`** — side B's id is deterministic (`…-b`, a keyed get) and merge tears it down explicitly, so a link field buys nothing (DEC-005 single-source-of-truth).

**Re-derivation survival (the 8.3 gate, sharpened by DEC-082).** `formShifts` becomes split-aware via an additive branch gated on `splitCutTime`:
- **Un-split path is byte-identical** (the branch only runs when the field is set) — the xola-pull reconcile harness stays green. Enforced structurally by extracting the per-shift form/reconcile body into `formOneShift(...)`, called once (un-split) or twice (split).
- **Split partition:** side A = scheduled trips with `e.time < cut`, side B = `e.time >= cut` (half-open `[cut, …)` → a boundary trip goes to B). Both `e.time` and `cut` are vessel-local zero-padded "HH:MM" on the same day → a chronologically-correct string compare, no instant conversion, DST-immune (DEC-032). Deterministic + idempotent: a new Xola trip in a later pull auto-lands on the correct side by its own departure time (the operator's morning/afternoon intent), not a nearest-neighbor guess.
- **A side empties** (all its trips cancelled) → that side derives to `Cancelled` (per-side, existing lifecycle); **the split marker PERSISTS. The importer never auto-dissolves a split** — that would silently undo the operator's decision (the DEC-082 wrinkle). The Cancelled husk is honest; the cue fires; **Merge (8.4) is the operator's only inverse.** A side resurrects on the correct side if its trips reappear (cut-time survives collapse-and-return; an event-id list could not — a replacement trip has a new id).

**Contiguity is structural, by design.** Cut-time expresses a single time partition only — SPEC §2.3's definition ("two shifts whose trips partition the original's"; `suggestSplit` is gap/span only). Interleaved / 3-way / multi-cut splits are out of scope.

**"Changed in the last pull" cue (DEC-082-compliant, no lock/review baseline).** `formOneShift` already holds old vs new eventIds per side, so the composition delta is free: a split day whose side gained or lost a trip (or one retimed *across* the cut — a within-side retime doesn't move the partition, so it doesn't fire) is recorded into `FormResult.splitDaysChanged` and snapshotted in the `ImportRunSummary` JSONB (no DDL — the #128/DEC-056 audit is already persisted). The Builder View (8.2a read surface) renders a quiet "changed in the last pull — check the split" cue by pure derivation over the LATEST `ImportRun`. No per-shift stored flag, no baseline timestamp, no snapshot — baseline is "the last pull," exactly DEC-082's sanctioned framing. Scoped to trip-composition deltas (not party-size/booking churn — the Builder's normal pax/seat surface), keeping it quiet (BRAND anti-anxiety). Accepted V1 limitation: latest-run-transient, not a durable unread queue.

**Emergent-safe (DEC-027 §2) — no `automationPaused`.** The ask engine sees two ordinary shifts; per-side re-derivation preserves seat state by id, so live asks/confirmed crew ride through every pull. Adding a trip to a side changes events, not seat count (manning is per-vessel), so asks are untouched. Forbidden op: re-cutting/merging in a way that strands an occupied seat — surfaced via the existing `seatsStranded` channel, guarded in the 8.3b UI.

**Merge (8.4) inverse, pinned here:** clear `splitCutTime` AND explicitly remove the `…-b` shift + its seats, then re-run `formShifts`. Clearing the cut alone orphans `…-b` (the un-split machinery is vessel|date-keyed and never emits/revisits a `…-b` id).

**Scope seam:** 8.3a = migration (one column `split_cut_time`) + `formOneShift` extraction + split branch + `splitDaysChanged` detection + engine tests. 8.3b = View/Edit toggle shell + split UI + cue render.

**Don't-build:** `splitId`; auto-dissolve on collapse; `splitCreatedAt`/expected-event snapshots (DEC-082 lock in disguise); durable unread change queue; interleaved/multi-cut splits; reservation-churn in the split cue.

**Relationship:** implements SPEC §2.3 Split action + AC; reuses DEC-005 (derived state, seat-id preservation), DEC-032 (vessel-local wall-clock), DEC-056/#128 (import audit), DEC-082 (Xola is truth; change-detection anchored to import diffs, never a lock), DEC-043 (events-driven ingest). Supersedes the prior draft's `splitId` + event-id-list partition.

**Amendment — freshly-spawned-shift cue (9.10/#236, 2026-07-04).** SPEC §2.3's "new block needing
review" text is realized as a second muted row cue in this DEC's idiom: a shift the LATEST pull
minted reads **"new in the last pull"** on the Builder View (fed by the run's `shift_created` audit
items, #128 — best-effort like the changed-cue). This formally supersedes the mockup/SPEC amber
"new · review" treatment DEC-082 already killed: a fresh shift is a calm fact, not an approval
demand — the engine is already working it (empty board = success). Operator-made splits don't fire
it (run items exist only for imports); a resurrected side reads as new only when the pull re-creates
it.

---

## DEC-084: Crew assignment-change notice — a third operator-relay sibling

**Status:** Decided 2026-07-02 (@architect, Phase 8.4, #207). Operator principle (Eric): when a crew member is put ON or taken OFF a shift, they **always get a message** — SMS in production, and in the pilot (no SMS yet) still a generated notice the operator relays. "No matter how it gets to them during what phase."

**Decision.** A crew "you're on / you're off" notice is a **third outbound primitive**, sibling to the ask outbox (DEC-030/050) and the ring outbox (DEC-073) — its own port + entity + table + adapter, never overloaded onto either. The codebase already made this exact call twice; a no-claim, non-thread outbound gets its own lane so neither hardened subsystem reopens.

- **New `NoticePort`** (`src/ports/notice.ts`): `send(AssignmentNotice)`. `AssignmentNotice = { to: Recipient; action: "added" | "removed"; shiftId }` — **no** `askId`/`seatId` (no ask, no claim) and **no** `threadId`. Reuses `Recipient`/`SendResult` from `channel.ts`.
- **New entity `NoticeOutboxEntry`** + table `notice_outbox` (migration 0015): `{ id; crewMemberId; action; body; link; status; createdAt; sentAt? }`. Mirrors `RingOutboxEntry`/`ring_outbox` **minus** `threadId`, minus drop-on-read. **Terminal-on-sent** (unlike ask = settle-on-answer, ring = drop-on-read): it doesn't auto-clear, leaving a standing "we told them" record — the durable audit, no separate table.
- **`OutboxNoticeChannel implements NoticePort`** mints a `/crew` (my-shifts) magic link + enqueues the entry (body + link, **no** accept/decline). `FakeNoticeChannel` recorder for tests. Renders as a **third `/admin/outbox` section** ("Assignment changes"), reusing the generic relay-send island + no-phone notice.

**Why not the existing lanes.** Overloading the ask `ChannelPort` breaks its NOT-NULL `askId`/`seatId` correlation invariant (DEC-073 already refused this). Riding `NotificationPort` forces a nullable `threadId` and breaks its drop-on-read terminal rule — a release notice has no thread and no read-state to drop on. A third port keeps both hardened subsystems closed; the eventual Twilio class simply implements all three interfaces (DEC-050 convergence note; DEC-MSG-1 swap, zero domain change).

**Emission locus.** Core returns the intent, the edge delivers — exactly the ask pattern (`fireAsk` → return → `forwardToOutbox`). `mergeShift` (8.4) returns the dropped side-B crew as facts; a new edge `forwardNotices(repo, noticeChannel, notices)` (mirror of `forward-asks.ts`) does the lookups, formats the body, mints the link, enqueues. Core stays clock-free + text-free (DEC-030 ruling holds).

**Idempotency.** `formShifts` is idempotent-by-re-derivation and runs on every pull, so notices are emitted **only from the explicit merge command**, once — **never** from the `formShifts` re-derive path. Belt-and-suspenders: deterministic entry id `notice-{shiftId}-{crewMemberId}-{action}`, upsert.

**Operator-as-crew guard.** The operator holds seats (DEC-030 §7), so a merge could "drop" the operator from side B and notify them of their own action. Exclude `OPERATOR_CREW_MEMBER_ID` in `forwardNotices` (mirrors the ring path's DEC-072 exclusion).

**Scope seam.** 8.4 wires **merge-release only** (`action:"removed"` for freed side-B confirmed crew). Fast-follow (NOT now): the other add/drop sites — `formShifts` cancel path (import-cancellation), `vacateSeat`/`bail` (removed person), `overrideSeat` (`action:"added"`), and the Twilio adapter. Those run inside `formShifts`-on-pull, where the re-pull dedup actually bites — solved in their own task, not here. This closes a pre-existing gap: today NOTHING notifies a confirmed crew member when their seat/shift disappears.

**Not the messaging/threads rail (DEC-051).** That's derived-membership broadcast chat; a transactional assignment notice is neither, and the office is barred from originating a DM anyway.

**Relationship:** implements the SPEC §2.3 Merge action's crew-facing half; reuses DEC-030/050 (operator-relay outbox pattern), DEC-073 (own-lane-per-outbound precedent), DEC-MSG-1 (SMS swap seam), DEC-083 (merge mechanics), DEC-072 (operator ring-exclusion). Supersedes nothing.

---

## DEC-085: Shift Builder — responsive dual-form-factor over one no-JS core

**Status:** Decided 2026-07-03 (Eric, Phase 9). Architecture detailed at the 9.5 @architect gate; this
records the *decision + why*.

**Decision.** The Shift Builder — and admin surfaces generally — present **two co-equal, first-class
experiences**: a real **desktop app** (multi-pane master-detail: the board on the left, the selected
shift's cockpit/detail on the right) and a real **mobile app** (drill-in, thumb-native, full-screen
detail). **Same functions, equal priority** — not one layout squished into the other's viewport. Both
ride **one server-rendered no-JS core** (DEC-026):
- Selection is a URL param (`?sel=<shiftId>`), exactly the idiom the page already uses for mode/filters
  — a plain `<Link>`, no client JS.
- The cockpit/detail body is **extracted into a shared server component** rendered in two places: the
  standalone `/admin/shift/[shiftId]` route (mobile drill-in, deep-links) **and** the desktop right pane.
- CSS decides which panes show per form factor; mobile shows the board OR (when `?sel` is set) the
  full-screen detail; desktop shows both.

**Why.** The operator works from a desktop *and* a phone and does the same work on each; a breakpoint
squish serves neither. Corrects the reconciliation punch-list, which mis-classified the mockup's
two-pane layout as "superseded by DEC-042/026" — **no DEC forecloses a server-rendered two-pane**; a
URL-param selection is the sanctioned no-JS pattern. DEC-042's guardrails (neutral ink, no scoreboard,
no auto-refresh, a distinct empty state) are **held** in the merged surface.

**Day-grouping blessed (supersedes SPEC §2.3 "grouped by boat then day").** The board groups **day →
time** (#122) — a weekend scans day-by-day, within-day time order preserved. This was shipped in Phase
8 without a decision line against the binding SPEC text; recorded here as decided, not drift. Vessel
identity returns as an information-encoding hue (DEC-086), not as the primary grouping axis.

**Relationship:** builds on DEC-042 (pull-surface guardrails), DEC-026 (no-JS forms + server render),
the Phase 8 Builder. Companion to DEC-086 (the identity palette the board uses). Detailed component
extraction + pane mechanics land at the Phase 9.5 @architect gate. Supersedes nothing; reframes the
reconciliation's two-pane "superseded" call.

**Amendment — pane mechanics (9.5 @architect gate, 2026-07-03).** The cockpit body extracts to
`components/assignment/shift-cockpit.tsx` — an async server component owning its own data loads,
rendering no Shell, returning error states as bare Notices; heading level is host-supplied (h1
standalone, h2 in-pane). Hosts: the thin standalone route (deep links, mobile) and the board's right
pane (`?sel=<shiftId>`). Mobile detail = the board route with the list `display:none`-hidden (one link
per row; the dual-link variant rejected for duplicated interactive DOM). Cockpit action returns ride a
hidden `ctx` **query-string** (never a form-supplied path — the split/merge idiom): `ctx` present →
redirect to the fixed board path + `sel` + feedback code; absent → standalone. `sel` joins the board's
filter-param set so mode/filter/split navigation preserves the open pane. Shell gains a literal `6xl`
width used only when `sel` is set. Board and cockpit param namespaces stay disjoint by convention.
Perf revisit trigger: board-pane renders stack cockpit reads on `deriveAllShifts`'s per-shift N+1 —
fine at pilot scale, index before the window or fleet grows.

---

## DEC-086: Vessel + role identity palette — color that encodes information

**Status:** Decided 2026-07-03 (Eric, Phase 9). Hue values set when the 9.6 board bundle lands.

**Decision.** Add a small **identity** palette to the DEC-021 locked token set: a distinct **calm hue
per vessel** (rendered as a per-vessel dot on board rows so a same-brand fleet is legible at a glance)
and the existing **role hues** (`captain`/`mate`, defined in `globals.css` but currently unused in
shipped TSX) put to work. The rule: **color that encodes information is permitted; decorative color is
not.**

**Why (the rule this refines).** DEC-021 locks the palette and DEC-042 mandates neutral ink precisely to
bar two failure modes — color added "to make it look good," and the risk-scoreboard where every row
glows. Identity color is **neither**: a vessel hue answers *which boat*, a role hue answers *which
role* — each carries a value. Eric's framing: *"the rule is so color isn't added for dumb reasons; it
needs to carry a value. vessel hue, role hue — that's value, so we add it."* Identity ≠ risk, so
DEC-042 is untouched (warm/bad tokens stay reserved for the At-Risk board).

**Guardrails.** Hues are calm/desaturated, **one deliberate hue per vessel** (not a rainbow), chosen —
not auto-generated garishly. They encode **identity only**, never state/risk. Each hue's meaning is
recorded when the values are set. A ~4-boat fleet needs ~4 identity tokens beyond `captain`/`mate`.

**Relationship:** refines DEC-021 (adds *informational* tokens to the locked palette), compatible with
DEC-042 (identity color ≠ risk color). Companion to DEC-085 (the board that renders them). Supersedes
nothing.

**Amendment — hue values set (9.6, 2026-07-03).** Six `--color-vessel-N` tokens land in `@theme`
(`app/globals.css`): 1 indigo `#5b64a8`, 2 plum `#8a5f93`, 3 olive `#6e7f46`, 4 clay `#9c6b4e`,
5 lagoon `#4f7f8b`, 6 driftwood `#7c6a54` — all calm/desaturated, deliberately distant from
accent/captain/mate and every status hue so a dot never reads as a badge. The real fleet is **pinned**
(the "chosen, not auto-generated" guardrail) in `app/lib/vessel-hue.ts`: Brew 1→indigo, Brew 2→plum,
Brew 3→olive, Brew 4→clay; unpinned vessels (dev seeds, a future boat before someone pins it) fall to
a stable hash over the pool, so an id always keeps its hue. Rendered as a 10px dot before the vessel
name on board rows — identity only, `aria-hidden`, the name stays the accessible answer.
**Role hues:** first surface = the 9.8 seat-card role glyph; extended (operator call, 2026-07-04)
to the board's FILLED pips so both surfaces speak one language — a captain-blue/mate-teal square
means "a person of that role, aboard." Identity, not state: fill-vs-outline still carries the state
(open pips stay light outline grey so gaps jump), filled trainees stay faint, and warm/bad tones
never appear on the board.

**Amendment — identity color reaches the crew surfaces (9.11, 2026-07-05, #237, @architect GO).**
Two render sites added on the crew app, both direct reuse of the pinned system, no new token:
- **Vessel dot on `/crew` My-shifts rows** (`app/(crew)/crew/page.tsx`) — a 10px `vesselHueClass`
  dot before the vessel name, so a mixed-vessel list is legible at a glance (the same disambiguation
  value the board earns). `aria-hidden`; the vessel name stays the accessible answer. The single-vessel
  shift-card **header** carries **no** dot — the 2xl boat name already fully answers "which boat," so
  a dot there would be decoration, not information (the architect's one cut).
- **Co-crew role glyph on the shift card** (`app/(crew)/crew/shift/[shiftId]`) — each "Crewing with
  you" row shows the captain/mate C/M role glyph (shared `RoleGlyph`, `components/ui/role-glyph.tsx`,
  same `roleHueClass` as the seat-card + board), from the seat's role — the identical resolution as
  `viewerRole`, now memoized per build. Identity, not state. The visible role label beside the glyph
  is the accessible answer (glyph is `aria-hidden`).

---

## DEC-087: Trainee seats are staffable — DEC-064's rating floor is scoped to required manning

**Status:** Decided 2026-07-03 (@architect gate, Phase 9.3, #224).

**Decision.** `staffTraineeSeat` / `unstaffTraineeSeat` (`src/builder/manning.ts`, siblings of the
8.5 add/remove pair) place a named person into / out of a `kind:"supernumerary"` seat.

- **Staff** guards (seat is supernumerary + `Open`; candidate passes `evaluateTraineeCandidate`)
  then composes `manualOverride` — straight to `Confirmed`, `acquiredVia:"operator"`, no
  reliability event, no ask round-trip. Server-side re-check + picker scope, the DEC-064 posture.
- **Trainee eligibility = `evaluateCandidate` minus `hasRating`** (`evaluateTraineeCandidate`,
  `src/oracle/eligibility.ts`): isActive + mmcValidOnDate (DEC-044 sentinel keeps BrewBoat open) +
  notOnPto + notDoubleBooked over `committedDatesByCrew(repo)` with NO shift exclusion — so crew
  already committed anywhere that date, including this shift's own required seats, are excluded by
  the existing rule, no bespoke same-shift check. No rating requirement: trainees are unrated by
  definition.
- **DEC-064 scoping, not bypass:** the rating floor protects role-holding on REQUIRED manning (a
  license floor). A supernumerary seat holds no role in that sense — its `role` is the track being
  trained toward. DEC-064 is untouched for `kind:"required"`.
- **Unstaff is bespoke, never `vacateSeat`:** `vacateSeat` re-asks via the kind-blind
  `rankedEligible` and would fire real asks for a trainee seat. `unstaffTraineeSeat` is the
  vacate-exhausted branch only: clear occupant + provenance, rest `Open`, no penalty, no re-ask.
  After unstaff, 8.5's Remove reappears (seat is `Open` again).
- **Comms verified kind-blind, zero changes:** my-shifts (`crew-view.ts`), thread membership
  (`membership.ts` `assignedOn`), doorbell (`doorbell-tick` via `deriveMembers`) all derive from
  seat assignment without a kind filter. DEC-084 notices wired at the edge via the existing
  `notify()` ("added" on staff, "removed" on unstaff; operator excluded per DEC-072).
- **Edge:** picker excludes `OPERATOR_CREW_MEMBER_ID` (UI scope, not an engine rule). Occupied
  supernumerary line in `ManningSection` shows occupant + unstaff (it has no seat card); occupied
  required override lines keep the vacate-first text.

**Documented side effect:** `committedDatesByCrew` is kind-blind, so a staffed trainee is
double-booking-excluded from required-seat auto-asks and claims on that date. Correct (they're
aboard) — not a pool bug.

**Relationship:** builds on 8.5 seat add/remove (manning.ts), DEC-064/066 (rating gates),
DEC-084/072 (notices), DEC-044 (MMC sentinel), #196 (provenance badge).
**Revisit if:** trainees should remain askable/claimable for required seats on their trainee day
(drop the kind-blind committed-date, add a kind filter); or trainee hours want tracking (a log,
not seat state).

---

## DEC-088: Civil send window — automated ask sends gated on vessel-local wall-clock; state advance is not

**Status:** Decided 2026-07-04 (@architect gate, Phase 9.9, #235).

**Decision:** New tenant constants `CIVIL_SEND_START`/`CIVIL_SEND_END` (`src/config/tenant.ts`,
env-overridable "HH:MM", defaults 08:00/20:00, half-open [start,end) per DEC-083; bad format or
inverted pair degrades to defaults per the envMs posture — never throws, never silences the engine).
`withinCivilWindow(now, tz)` compares vessel-local wall-clock (DEC-032, Intl-based, DST-immune).
Outside the window the engine's OWN initiative defers: `tick()` skips its entire ask-firing block
(drip, blast, Tier-2 escalate) while still advancing state, sweeping DEC-067 timeouts, and detecting
board landings; `bail()`/`vacateSeat()` skip the inline re-ask and rest a non-exhausted seat at
**`Open`** (occupant cleared, `shift_bailed` still logged), which the next in-window tick's drip
picks up naturally (`widenDue(Open)` → immediate) — no queue; the idempotent tick IS the retry.
Exhausted-pool bails rest `Bailed` → AtRisk unchanged. **Gate the initiative, not the primitive:**
operator-explicit sends (cockpit ask, lean, `assignFromPool`, override) and crew-initiated responses
stay ungated. The gate sits at ask MINTING, never the transport — an `Ask` row implies a send, or
DEC-067 logs `ask_ignored` against messages never delivered (DEC-008 poisoning).

**Scope:** asks only. DEC-084 notices + DEC-068/073 rings still fire at any hour (incl. the 3am Xola
pull's cancel notices) — tracked as **#247, a blocker for production Twilio credentials**; notices
need an urgency-aware rule (a 23:00 cancel of an 08:00-call trip must not wait for the window), not
this gate.

**Refines:** DEC-022/062 (runway = existing horizon, untouched; the window gates sends only), DEC-063
(drip resumes in-window; a deferred bail re-crew now rides the drip instead of the inline pool blast),
DEC-067 (silent clock runs through the close — latest expiry ~21:45 with defaults), DEC-023 (tick
stays pure; window passed via opts). Supersedes #157's parked "civil window" note. Test suites hold
the window WIDE OPEN via env (vitest + playwright configs) — their clocks are arbitrary instants; the
gate is tested with explicitly injected windows.

**Revisit if:** urgency should override civility (a pre-call-time bail waits for 08:00 — the board
still pings and every operator path stays ungated, so the human handles the emergency); the silent
clock should pause overnight or sends should buffer before close; a tenant needs an overnight window
(night fleet).

---

## DEC-089: `<SubmitButton>` — standing pending-state client island for async form submits (#202/#250, Layer 2)

**Decision:** A single contained `'use client'` island `components/ui/submit-button.tsx` using `useFormStatus()` gives every server-action form an inline pending state: a calm `animate-spin` spinner (currentColor, ≤1em) **and** `disabled` while the enclosing form is pending. The spinner overlays the label (label kept in-flow but `opacity-0` — **not** `visibility:hidden`, which would strip the button's accessible name while busy — reserving its width) so the button never grows or jitters when pending flips — no layout shift. Renders a real `type="submit"`, so no-JS still posts (progressive enhancement); pending auto-clears on the action's `redirect()`. `MiniButton` folds into it. Wired at ~10 sites: In/Out ask, confirm-into-seat, place-X override, remove/bailed, nudge, self-claim, sign-in (request/verify/resend), sign-out. Excluded: plain `<Link>` nav + `<details>` toggles (press-only, Layer 1 / DEC-089's sibling in #262); RelaySend/CopyButton (own their optimistic "Sent ✓"/"Copied ✓").

**Two-button ask:** the crew In/Out ask is one `<form>` with two `name="response"` submits — each spins only when its own serializable `name`/`value` matches `useFormStatus().data`; both disabled in flight. Scoping is derived from props, **not** a function prop — `AskCard` is a Server Component and a function can't cross the Server→Client boundary (this bit in CI: an original `spinsWhen` callback crashed `/crew` at render). `useFormStatus` must render as a **child** of the form (it reads the nearest parent form context), which every folded-in button already is.

**Why an exception to DEC-026:** the no-client-JS beat (domain + Neon round-trip over Tailscale) reads as dead → re-tap → double-fire. `disabled`-on-pending is the real double-tap guard; the spinner is the honest "working" signal. Joins the DEC-026 island family (DEC-030 RelaySend, CopyButton) — a contained, progressively-enhanced exception, not a drift toward client-rendered surfaces.

**Tradeoff:** ~10 forms gain a client boundary (hydration cost). Accepted — bounded, one reused primitive, no data-layer change. **Strand-safe:** handled failures redirect (codes-in-params, DEC-026) so pending always clears on navigation; an unhandled throw unmounts the form via the error boundary; a resolve-without-redirect re-renders the server tree and clears pending. **Calm posture (DEC-042):** currentColor only (palette lock DEC-021/042), no overlay beyond the button's own box, no layout shift. **Phase:** 9. (@architect-gated.)

---

## DEC-090: Click & loading feedback — the standing rule (`<SubmitButton>` for submits, `<AppLink>` for links; lint-enforced)

**Decision:** Every interactive control gives feedback, by construction. Three layers:

1. **Press feedback** (instant, zero-JS, automatic) — a global `@layer base` rule in `app/globals.css` darkens/shrinks any `button`/`[role=button]` and dips the opacity of any `a` on `:active`. Applies to every control forever, no wiring.
2. **In-flight spinner for form submits** — `<SubmitButton>` (DEC-089). A raw `<button type="submit">` in a server-action form must be a `<SubmitButton>`.
3. **In-flight spinner for navigations** — `<AppLink>` (`components/ui/app-link.tsx`): a `next/link` with `<NavSpinner>` (`useLinkStatus`) built in. **Every internal link is an `<AppLink>`**; raw `next/link` is reserved for the wrapper itself. `tel:`/`mailto:`/external/`#` targets are plain `<a>` (no page load, no spinner — AppLink also auto-suppresses). `spinner="overlay"` for card/row links (scrim + centered spinner over a `relative` box); `spinner="inline"` (default) for text/nav links.

**Why every internal link gets one:** every page is `force-dynamic` — there are no "fast" internal navigations, so every one deserves feedback.

**Minimum display time (`useHeld`, ~600ms):** both spinners are held for a floor duration so a fast round-trip still shows a *visible* spinner rather than a sub-frame flash (the earlier bug — the spinner rendered but for ~15ms, so it effectively wasn't there). The hold is a floor, not an addition; it can't outlive an unmount (a redirecting button), but same-surface cases (a row opening a pane, a non-redirecting submit) get the full floor.

**Enforcement (lint):** ESLint (`eslint.config.mjs`, the project's first — minimal, via the typescript-eslint parser) enforces it: `no-restricted-imports` bans the raw `next/link` default import (use `<AppLink>`); `no-restricted-syntax` flags raw `<button type="submit">` (use `<SubmitButton>` or `<GetFormSubmit>`). Wired into `verify` + CI, so a raw link/button fails the build. Exempt: the wrapper components, and `outbox-card.tsx` (owns its optimistic "Sent ✓"/"Copied ✓" feedback). **Phase:** 9.

---

## DEC-091: Crew navigation is hub-and-spoke — no persistent nav chrome (9.12, #238)

**Status:** Decided 2026-07-06 (Eric, Phase 9). @architect-gated.

**Decision.** The crew app keeps its hub-and-spoke IA: `/crew` (home) is the single hub containing
every entry point — open asks, my-shifts, the Messages card, the flag-gated pick-up surface (DEC-074),
own standing, sign-out. Drill-in surfaces (shift card, `/crew/open`, threads) return to the hub via the
shared 44px `BackLink` primitive (`components/ui/back-link.tsx`). There is **no** persistent crew nav.

**Rejected: a bottom tab bar and an admin-style top nav.** Admin's persistent nav (#174,
`admin-nav.tsx`) does **not** port — admin has 4 co-equal destinations and *no hub*, so it needs
lateral wayfinding; crew's home *is* the hub (every destination one tap away), so persistent chrome
adds nothing but the app-frame the "insultingly small" ethos (BRAND) resists. A persistent, always-on
unread badge would be an ambient-pull anxiety vector against BRAND "push, not pull" and DEC-042 — the
Messages unread count stays on the deliberately-**opened** home card (DEC-071), never floating. The
flag-gated pick-up surface (DEC-074) is a recorded exception, not a destination to promote into
permanent nav.

**Scope of 9.12:** consistency only — uniform `BackLink` across all drill-in surfaces (done); no new
tokens (DEC-021 holds). The admin nav's other half of 9.12 is unrelated: add the now-built
`/admin/messages` link to `admin-nav.tsx`.

**Relationship:** refines the crew-app IA under BRAND ("insultingly small, no dashboard"); compatible
with DEC-085 (dual form factor — crew is a native mobile hub, not a squished admin), DEC-074 (pick-up
as a knowing exception), DEC-071/042 (calm, opened-not-monitored unread). Companion-contrast to #174
(admin's persistent nav). Supersedes nothing.

**Revisit if:** crew surfaces grow past ~5 and home stops being a genuine single-tap hub.

---

## DEC-092: Admin becomes a first-class auth identity — per-person revoke (10.2, #283; revises DEC-020)

**Status:** Decided 2026-07-06 (Eric, Phase 10). @architect-gated.

**Decision.** Admin `subject_id` stops being a free-form operator handle (DEC-020's "admin is a
non-identity") and becomes a real id in a new `admins` table (`id, handle, name, active, created_at,
deactivated_at`; text PK, no FK, dates-as-text per DEC-DATA-1 — `db/migrations/0018_admins.sql`).
**Every admin is also crew, so `admins.id` IS that person's crew id** — an admin session is
`{kind:"admin", id:<crewId>}`, that person's crew session is `{kind:"crew", id:<crewId>}`; `kind`
disambiguates, the same string is fine (no collision). `handle` is a short mint key
(`db:mint --admin=<handle>` / `dev-link?admin=<handle>` both resolve handle→id and refuse an
unknown/inactive handle).

**Per-person revoke.** Sessions are stateless HMAC (`src/auth/session.ts`) — which is *why* the only
prior revoke lever was rotating the shared `SESSION_SECRET` (logs everyone out). `readSubject`
(`app/lib/auth.ts`) now does **one stateful lookup for admin subjects only** — `getAdmin(id)`, require
`active` — so a deprovisioned admin (flip `active=false`) dies on their next request, immediately, while
every other admin's session is untouched. **Crew subjects skip the lookup entirely**, so the magic-link
hot path (20–25 crew) stays fully stateless. Deprovision = `update admins set active=false,
deactivated_at=… where handle=$1` (documented in `docs/DEPLOY.md`); `SESSION_SECRET` rotation remains the
global break-glass. Launch admins (Eric/Brendan/Drew) are seeded in the migration; add/remove is
seed + CLI/SQL — **no admin-management UI**.

**Scope (deliberately minimal — architect-bounded).** NO roles/RBAC (all admins equal; a `role` column
is the clean seam), NO admin-management screen, NO per-admin session-version/epoch (terminal deprovision
only needs the `active` flag), NO passwords/2FA (magic-link unchanged), NO admin audit log. Each is a
future add with a seam left open. **Rejected:** a per-admin session-version column (over-builds terminal
revoke), a revocation-list table (a second source of truth for `active`), a stateful check on crew reads
(needless hot-path DB hits), an admin UI (deferred at ~3 admins), and bushel's eventual-revoke shape
(its `is_active` only blocks *new* logins — muster's readSubject check is immediate, the point of 10.2).

**Relationship.** Revises **DEC-020** (only its "admin is a free-form non-identity" clause; the "no auth
*platform*" decision still holds — nothing here adopts one). Keeps **DEC-058**'s `AuthSubjectKind`
(`admin|crew`) canon unchanged. This is the *auth* identity only — deliberately NOT unified with the
DEC-030/058 messaging "operator-as-crew" path (`OPERATOR_CREW_MEMBER_ID`), which stands until the
follow-up. **Supersedes** the "no admin entity" framing in `app/lib/operator.ts`.

**Follow-up (not this PR).** Retire the `OPERATOR_CREW_MEMBER_ID` singleton: the "from the office" /
inline-answer-in-outbox sender should key off "is this crew member an admin" against the `admins` set, so
*any* admin is the office — a DEC-030/058 messaging refactor, kept out of the auth change for reviewability.
Also parked: a crew↔admin identity switcher (FUTURE_IDEAS, 2026-07-06 — every admin is also crew).

**Revisit if:** admin roles or per-admin session-rotation (revoke-live-sessions-but-keep-the-admin) are
actually needed.

---

## DEC-093: Crew ↔ admin view switcher — same-identity session re-mint (builds on DEC-092)

**Status:** Decided 2026-07-06 (Eric, Phase 10). Realizes the parked switcher idea (FUTURE_IDEAS
2026-07-06); builds directly on DEC-092's identity model.

**Decision.** A dual-role person (every admin is also crew — DEC-092) moves between the crew app and the
admin cockpit **without re-authenticating**: because `admins.id` IS the crew id, switching is just
re-minting the *other-kind* session for the *same* id. Two server actions (`app/lib/switch-actions.ts`),
both reusing `startSession` — **no new session crypto**:
- **`switchToCrew()`** — admin → crew. **De-escalation, always allowed** (an admin is definitionally that
  crew person). Surfaced in the AdminNav header beside "Muster · date" as **"Crew view"**.
- **`switchToAdmin()`** — crew → admin. **Privilege escalation — gated on `getAdmin(id).active`** (the
  exact DEC-092 revoke check). A non-admin or revoked crew member is bounced to `/crew`, no session
  change. Surfaced on the crew home (DEC-091 hub) beside **Sign out**, shown only when the viewer is an
  active admin.

**Why this is the front door now.** With email wired in prod, crew self-serve **code login** (DEC-081)
is live — so *everyone* signs in once as crew with a code, and active admins switch up. This retires the
`db:mint --admin` magic-link dance as the normal admin path (mint stays as the out-of-band bootstrap).

**Security (flagged for the 10.3 audit).** `switchToAdmin` is the app's **one privilege-escalation seam**.
It is server-side and gated by the same `getAdmin(active)` that `readSubject` enforces on every admin
request — so a revoked admin can neither hold nor re-mint an admin session, and the crew-home control's
visibility is a convenience, not the gate (the action re-checks). No client-trusted role state.

**Rejected.** A **dual-kind session** (hold admin+crew at once) — one subject per cookie keeps the model
simple and every gate unambiguous; switching is cheap. A **client-side view toggle** — role must be
server-gated, never a client flag. Auto-escalating an admin straight to `/admin` on login — the crew code
login is the deliberate single front door; the switch is an explicit, auditable step.

**Relationship.** Builds on **DEC-092** (identity + revoke gate, reused verbatim). Compatible with
**DEC-091** (the switch is a crew-home hub entry, not new nav chrome), **DEC-081** (crew code login = the
single front door), **DEC-058** (`AuthSubjectKind` canon unchanged). Anticipates the **#293** operator-
singleton retirement (a dual-role person as "the office").

**Revisit if:** a true simultaneous dual-session (act as both at once, not switch) is ever needed.

---

## DEC-094: Operator break-glass is CLI + runbook, not an admin UI (10.5; extends DEC-092)

**Context.** Phase 10.5 was scoped as a crew-facing "support channel," but the real pre-launch need is the
*operator's* one: fast levers to fix a wedged state mid-pilot ("Speedy Gonzalez"). A survey found the
toolkit is already deep (engine pause, `db:admin` revoke, `SESSION_SECRET` rotation, Xola re-pull,
`reset-pilot`, seat overrides) — with one real gap: **no way to fix a crew member's phone/email** short of
raw SQL. A wrong phone means no SMS; a wrong email means the login code never matches — the two most likely
pilot fires. That gap also blocked `db:admin add --email` (which resolves an admin against the crew roster).

**Decision.** Close the gap with a **`db:crew` CLI** and **document the whole break-glass kit** as a runbook
in `DEPLOY.md` — no admin UI. `db:crew` mirrors `db:admin`: framework-free over the Repository port,
unit-tested on the in-memory double, run against the direct prod `DATABASE_URL`, prints the DB host it hit.

**Commands (extended past the initial `list`+`set`):** `list` / `add` / `set` / `enable` / `disable` — the
operator's whole crew-roster surface **short of delete**. A real crew record is never destroyed, only
deactivated (`disable` → `status=inactive`, reversible and audit-friendly). `add` exists because there was
otherwise **no operator path to onboard a new hire** — the seed is a hardcoded dev script and Xola import
makes reservations, not crew (the original "crew come from seed/import" assumption didn't survive the first
real hire).

**`add` must produce an *askable* crew member.** MMC is the universal hard eligibility gate (`eligibility.ts`
HARD_CREDENTIAL_TYPES); a hire with no MMC is asked for nothing. Since BrewBoat keeps no real MMC dates yet
(**DEC-044**), `add` seeds the same far-future placeholder credential the roster seed does (or a real
`--mmc` date) — otherwise a "successful" add would silently never get asked. `add` also validates ratings
against the live role types, derives `crew-<slug>` ids, and reuses `set`'s E.164 + duplicate-email guards.
`enable`/`disable` flip status through a targeted `setCrewStatus` (same lost-update safety as `set`).

**Concurrency-safe by construction.** Unlike the `admins` table (mutated only by `db:admin`), `crew_members`
is written live by the engine/cockpit (reliability, status, ratings). So `set` uses a **targeted
`updateCrewContact`** — a narrow `UPDATE` of only the touched columns via a new port method — never a
whole-row read-modify-write, which would silently revert a concurrent engine write. And it **refuses a
duplicate email** (another crew already holds it): two crew on one email makes login resolve to just one of
them — the exact failure the tool exists to prevent.

**Why no UI.** DEC-092 already deferred an admin-management UI at ~3 admins; the same logic holds for crew
contact fixes at pilot scale. A CLI + runbook is the cheaper, more auditable lever now — every command
prints the DB host it hit. Building `db:crew` is what *lets* the UI keep being deferred, rather than forcing
it.

**Scope held / seams left.** No `db:crew` **delete** (deactivate instead — a destroyed crew id would orphan
their seats/history). No per-crew session revoke — crew sessions are stateless by design (#300); the global
`SESSION_SECRET` rotation remains
the only crew-session hammer. Rollback stays "redeploy a previous Vercel build" — the DB-restore ceremony
is meaningless pre-data and is deferred to whenever live attendance data exists (the reliability loop /
Phase 11).

**Relationship.** Extends **DEC-092** (same CLI-over-UI rationale; `db:crew set --email` is the prerequisite
for `db:admin add --email`). Documents levers from **DEC-037** (Xola re-import), the engine-pause kill
switch, and the `SESSION_SECRET` global revoke. Leaves **#300** (crew-session revocation) and **#189**
(login-code per-IP throttle) as filed follow-ups.

**Revisit if:** admin/crew count outgrows a CLI (then a real roster UI), or real MMC-credential tracking
lands (then `add` takes a required expiry instead of the DEC-044 placeholder).

---

## DEC-095: Operator At-Risk alert — the deferred delivery half of DEC-026, NOT a fourth outbound lane

**Status:** Decided 2026-07-07 (@architect, Phase 10). Realizes DEC-026's deferred delivery ("the admin
ping ships the same moment crew-ask delivery does — one line at the send site") now that Twilio is live
(9.4/DEC-MSG-1).

**Context.** The tick already **detects + dedupes** board landings — one `board_landed` event per
(shift, reason) on the system log, re-pinging only on regression (`tick.ts`) — but the operator was never
actually notified; the delivery half was deferred to "the pilot adapter later" and, with SMS now live,
"later" is now. A pull-only board is a gap at go-time: the operator can't watch a board they aren't looking
at.

**Decision.** When a shift lands on the At-Risk board, alert **all active admins** by SMS. Delivered
**light** — NO own port/entity/table/adapter like asks (DEC-030), notices (DEC-084), or rings (DEC-073).
The rationale that justified those own-lanes (a hardened outbox with NOT-NULL correlation invariants + a
distinct durable lifecycle + an operator-relay worklist) **doesn't reach this feature**: the durable record
already exists (`board_landed`), the recipient IS the operator (no relay worklist — a relay-to-self outbox
is nonsensical), and the payload is a plain body + static `/admin/at-risk` link that rides `ChannelPort` as
a new `MessageKind` (`admin_alert`) through the Twilio adapter's **existing generic branch — zero adapter
change**. An own lane here would be a table with no distinct lifecycle: pure ceremony. Rejected.

- **Seam:** `tick` returns `boardLandings: {shiftId, reason}[]` (sibling to `firedAsks`), populated ONLY
  inside the dedup branch — the newly-recorded landings, never full board membership. Core stays clock-free
  + transport-free (DEC-023/030): it returns facts, the edge delivers via an injected channel.
- **Delivery** is core-but-transport-free (`src/adapters/forward-board-alerts.ts`, FakeChannel-tested):
  `listActiveAdminRecipients(repo)` (listAdmins → active → crew phone) + compose + best-effort per-recipient
  send. The edge (`app/lib/alert.ts`, sibling to `channel.ts`/`doorbell.ts`) picks the Twilio channel + the
  host-safe board link and calls it; the cron adds one line after `forwardToOutbox`.
- **Recipients = the active-admins set, NOT `OPERATOR_CREW_MEMBER_ID`.** The alert deliberately bypasses the
  operator singleton (its retirement is #293); `listActiveAdminRecipients` is authored as the reusable
  "the office = any active admin" helper #293 will consume.
- **No relay fallback, by design:** Twilio unset ⇒ no send (the `/admin/at-risk` board is the standing
  fallback). Unlike asks/notices/rings, an engine→operator alert has no one to relay to.
- **No civil-hours gating** (DEC-088 N/A) — a Tier-3 human-needed signal is inherently urgent; send any
  hour. **No migration.**

**Anti-blast (the one real trap).** Ride the existing per-(shift, reason) `board_landed` dedup: a
steady-state board fires **zero** alerts; only the tick that first records a landing sends, and a regression
(rescued → re-lands) re-pings. AC: a second tick on an unchanged board sends nothing.

**Scope held.** Trigger is At-Risk **only** (not Tier-2/earlier — that's the "anxiety dashboard" the board
design fights). An admin with no phone is skipped, not thrown on. Delivery is best-effort per recipient.

**Rejected:** an own outbox lane (a table with no distinct lifecycle); routing through
`OPERATOR_CREW_MEMBER_ID` (builds the exact thing #293 removes). **Relationship:** completes **DEC-026**
(delivery half); reuses **DEC-MSG-1** (Twilio swap) + **DEC-092** (admins entity + `active`); seeds the
**#293** helper. **Revisit if:** admins want per-person alert opt-in/subscribe (the eventual #293 model), or
alert volume warrants batching across ticks.

---

## DEC-096: `archived` crew status — off every list, the one status the override honors (#323)

**Context.** `disable`/`inactive` (DEC-094 CLI) removes a crew member from the *automated* paths
(asks, pools, leans, escalation — the `isActive` gate), but the cockpit manual override picker
deliberately ignores status (DEC-064's "place anyone rated" backstop), so a disabled member still
appeared there. The operator needed a way to remove someone who no longer works here from **every**
list, including the manual picker — without a hard delete (history must survive; no-FK model).

**Decision.** A third `CrewStatus`, **`archived`**, distinct from `inactive`:
- `inactive` stays a **bench** — not auto-asked, but still manually placeable (unchanged; wanted).
- `archived` is **off every list** — it fails `isActive` (so out of all automated paths, like inactive)
  AND is filtered from the override picker AND rejected by `overrideSeat` (the action-layer guard,
  new `code: "archived"`), so a crafted post can't re-seat a removed member. This is the ONE status the
  override backstop honors — DEC-064's role floor still stands alongside it.
- **Not a delete:** reliability/ask/seat history is untouched; `db:crew unarchive` restores to `active`.
- Managed via `db:crew archive|unarchive` (siblings to enable/disable); `db:crew list` marks archived
  `✗` (vs `●` active / `○` inactive) so the operator sees + can restore them.

**No migration:** `crew_members.status` is a plain `text` column, so the new value round-trips with no
schema change (contract-tested on both adapters). **Revisit if:** a web roster surface lands (grey the
archived rows there too), or archived members should auto-hide from the roster after some retention.

---

## DEC-097: Guest-contact tracking is a progressive-enhancement client island (#345 Part B)

**Context.** The manifest's guest Text button preloads an intro SMS (Part A). Part B needs the tap to
**record who texted which guest**, so every crew member on the shift sees who's been contacted. A plain
`<a href="sms:…">` navigates straight to the phone's Messages app — there's no server round-trip to
hang a record on, and the DEC-026 default is *no client JS required*.

**Decision.** A contained **client island** (`GuestTextButton`, `"use client"`) that, on tap, fires a
best-effort `keepalive` POST to `/api/guest-contact` **and then lets the `<a>` navigate as normal**. The
server resolves *who* from the session (can't be forged) and upserts a latest-contact row per booking;
`buildShiftManifest` reads them so each guest shows "✓ Texted by <name> · <time>", shared across every
viewer of that shift.

**Why this is within the no-JS posture, not a break from it.** The tap is **never gated on JS**: with
scripting off, the same `<a>` still opens Messages with the intro preloaded — the recording is purely
additive enhancement. This is the same family as the existing `GetFormSubmit`/spinner client components
(DEC-026 allows client JS for *enhancement*, forbids it as a *requirement*). Data model: `guest_contacts`
(0020), upsert-latest by `reservation_id`, denormalized contacter name (no-FK read, DEC-DATA-1),
edge-written best-effort — never the domain.

**Known gap (accepted for v1).** The *sender* navigates away to Messages, so they see their own ✓ only
on returning + a reload; *other* crew see it on their next load (the cross-crew visibility that's the
point). An optimistic instant-✓ would need client state — deferred. **Revisit if:** the record needs to
be tamper-checked per-shift (currently any signed-in subject can post), or an append-only contact *history*
(who texted, how many times) is wanted over the latest-only state.

---

## DEC-098: Crew calendar feed — the first persistent bearer capability URL; hash-only, guest-PII-free, UTC-instant ICS

**Status:** Accepted (#355, @architect-gated 2026-07-11). Muster's first *persistent* bearer credential — magic tokens (DEC-020) and login codes (DEC-081) are both ephemeral. Establishes the model the parked "living link" family will inherit. **Correction:** the issue cited `docs/the-living-link.md §6` as a precedent to mirror — that doc was never committed (PR #98 only parked prose into FUTURE_IDEAS), so there is no prior accepted persistent-URL model; this DEC sets it.

**Decision.** Each crew member can mint a subscribable iCal URL (`GET /api/calendar/{token}.ics`, unauthenticated, the token IS the credential, **404 on miss** — no oracle, the DEC-081 posture). Their confirmed shifts then appear in Google/Apple Calendar automatically (push, not pull), re-synced on each client poll.

**Token model.** Stored as **`sha256(token)` only** in a new `calendar_feeds` table (looked up BY hash of the presented token, the `magic_tokens` shape — but persistent, no expiry, and **one live feed per crew**, `crew_member_id` PK; no FK, text/ISO columns per DEC-DATA-1). The plaintext URL is shown **exactly once** at mint (carried to the page via a short-lived flash cookie); "lost it" == **regenerate**, which replaces the row and kills the old hash — the same single lever that revokes/rotates. Token = 32 crypto-random bytes base64url (~256-bit) → enumeration is infeasible, so **no rate-limiter** (and no new dependency). Reuses `magic-link`'s `randomSecret`/`hashSecret`.

**Content.** Confirmed seats only (a tentative Claimed isn't a calendar commitment); confirmed supernumerary rides included, labelled "(training)". VEVENT `DTSTART`/`DTEND` = the DEC-041 committed window (call time = earliest departure − call lead; end via `shiftEndFromEvents`), emitted as **UTC instants via the instant-returning `derive` helpers, NO VTIMEZONE** — a documented DEC-032 *render* exception (DEC-032 governs display; a VEVENT is an absolute instant each client renders in its own zone, and hand-rolled VTIMEZONE blocks are the classic ICS footgun). Stable `UID` per shift id → re-polls **update** rather than duplicate. Live regen (a bailed/removed shift simply isn't emitted → the client drops it); window today−7d forward, self-bounding on the far end. **ICS is hand-rolled** (RFC-5545 TEXT escaping + 75-octet line folding) — no `ics`/`ical-generator` dependency (fails DEC-020's "could we do it with what we have?").

**PII boundary (load-bearing).** The feed lives on third-party calendar servers behind a forwardable bearer URL, so it carries only the *skeleton*: vessel, the viewer's own role, call/end times, dock (`LOCATION`), and **co-crew FIRST names**. It **NEVER** carries the guest manifest (customer names/phones) or co-crew phone numbers — those stay behind the authenticated app; the `DESCRIPTION` ends with a deep link back. *(Operator judgment call, flagged in the PR: pax count was omitted from V1 to keep the feed lean; trivial to add.)*

**Not a login.** A read-only data capability adjacent to the addressed-deep-link family; it mints **no session** and grants only `text/calendar` read of one person's schedule — so it does **not** reopen DEC-081 ("all login is a code"). Pre-empts the "is this a backdoor login?" reading.

**Relationship:** first persistent flavor of the parked capability-URL idea (FUTURE_IDEAS 2026-06-19); reuses DEC-041 (committed window), DEC-032 (instant seam + a recorded render exception), DEC-DATA-1 (no-FK), the `magic_tokens` hash-lookup shape (DEC-020); distinct from DEC-081.

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
  SPEC §4.* **(Where the value lives is fixed by DEC-022 — a single `leadDays` constant — and now
  **env-tunable** per DEC-062 (`STAFFING_HORIZON_LEAD_DAYS`, default 7d). Only the operator's chosen
  number remains open; the plumbing is done.)*
- **Reliability weights** — bail-lateness curve, ack weight, decay. *Flat v1; tune in Pass A. SPEC §1.4.*
- **Event-Admin merge rule** — manual entries vs CSV re-import reconciliation. *Default "manual wins,
  flag conflicts"; refine against a real export. SPEC §2.2.*
- **"Exhausted" threshold** (when a shift lands on the At-Risk board) and the **split-suggestion gap
  threshold** — *keep the bar high; tune later. SPEC §2.5, §2.3.* **(Where the value lives is now
  fixed by task 3.3 — `EXHAUSTED_THRESHOLD_HOURS` in `at-risk-board.ts`, gating route-(b) imminence
  (any uncrewed required seat within the window, **DEC-065** — no longer the willingness-exhaustion
  gate); eligibility-exhaustion boards immediately. Default ships at 48h; only the number remains
  tune-later. Split-suggestion gap still open.)*
- **Historical Xola data** — migrate vs read-only archive. *Leaning archive. SPEC §4.*
- ~~**Doorbell batch / cancel-window interval** (Phase 6)~~ — **RESOLVED by DEC-060** (task 6.3):
  batch/cancel **90 s** (`DOORBELL_BATCH_WINDOW_MS`), presence-staleness **5 min**
  (`DOORBELL_PRESENCE_WINDOW_MS`); env-overridable, ratified by Eric, tune-on-real-use stays.
- **Short-notice-as-text content posture** (Phase 6, artifact §7.5) — the SMS body carrying message
  *content* (vs a bare "tap to open" ping) is a different TCPA / content posture than the
  strictly-transactional ask (DEC-MSG-1). *Owner: Drew + the 10DLC registration — confirm which
  message types / lengths qualify before the SMS doorbell adapter ships.*
