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

## DEC-012: Manifest is grouped per event on the shift card; no waivers for crew
**Decision:** The guest manifest is grouped **by event** on the shift card (a Saturday shift shows
separate 1pm/3pm/5pm lists), each showing **name + count/phone**. **Waivers are not shown to crew.**
Pull this onto the card **early** — it is the **hinge** that ends the Xola dependency.
**Why:** Different customers are on each event; crew need per-event lists. The moment the card is
authoritative, crew stop needing Xola and the 2026 write-back sheet retires (SPEC §0.4, §2.6.3).
**Tradeoff:** Requires the CSV export to carry guest name+phone per reservation (verify at M1).
**Revisit if:** Export lacks guest detail → fall back to the write-back sheet (DEC-011) as a stopgap.

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

## DEC-TBD: Open questions (carried from the spec; not Claude's to set alone)

These are deferred by design. Each names an owner and a trigger. **Consult @architect (and the named
human owner) before building past the trigger.**

- **Stack / framework / DB / host @ M4** — the DEC-013 decision itself. *Trigger: task 1.5a.*
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
  SPEC §4.*
- **Reliability weights** — bail-lateness curve, ack weight, decay. *Flat v1; tune in Pass A. SPEC §1.4.*
- **Event-Admin merge rule** — manual entries vs CSV re-import reconciliation. *Default "manual wins,
  flag conflicts"; refine against a real export. SPEC §2.2.*
- **"Exhausted" threshold** (when a shift lands on the At-Risk board) and the **split-suggestion gap
  threshold** — *keep the bar high; tune later. SPEC §2.5, §2.3.*
- **Historical Xola data** — migrate vs read-only archive. *Leaning archive. SPEC §4.*
