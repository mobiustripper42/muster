# Muster — Decisions

Architectural decisions, each with an ID (DEC-NNN). DEC-001 through DEC-012 are **extracted from
the locked spec** (`docs/SPEC.md` v1.0) — the forks it already resolved, captured here as decisions
so the *why* survives. DEC-013 and DEC-014 were made during project setup (2026-06-03). Open
questions live at the bottom as DEC-TBD.

> The spec is the contract. Where a decision below compresses spec reasoning, the spec section is
> cited — read it for the full argument.

**One decision, one file** (DEC-141). Each lives at `docs/decisions/DEC-<id>-<slug>.md`; this file
is the generated index. Read one decision by reading its file — `grep -rl DEC-042 docs/decisions/`
resolves any id — rather than loading all 138. To add or change a decision, edit its file and run
`npm run gen:decisions`; `npm run check:decisions` fails the build if this index is stale.

**A change to a decision goes IN that decision's file** (DEC-141, amended 2026-08-17), appended as a
dated `## Amendment, YYYY-MM-DD (who)` section. It is not a new decision and gets no id of its own.
A new id is for a subject the record has no decision about yet — one worth writing even if nothing
before it existed. Two decisions that merely relate name each other in a plain **see also**.

**So every row here is one subject, and the file behind it holds the current answer.** There are no
strike-throughs and no "amended by" annotations: a decision amended last week still shows its
original title on its row, because the amendment is inside it. The row tells you a subject exists;
the file tells you what is true. Open the file.

The retired model did the opposite — a change meant a NEW decision whose `amends:` frontmatter
pointed back, and a generated banner in the target. An audit of 138 found **zero fully superseded**,
so nearly every change was partial, and a subject accumulated files: the payment posture needed
DEC-107, 151, 153 and 155 read in order before any of them answered it. The 51 pointers that model
produced are now plain **see also** prose inside the files, and the frontmatter is gone.

A decision that changes the spec declares that in frontmatter — `amends_spec: [{section, scope}]` —
and the pointer under that spec section's heading is generated from the declaration. A claim that
never reached the spec is a red build rather than prose nobody cross-read. This is the one generated
cross-reference left, and it points at the spec, never at another decision.

## Index

### Core architecture & engine mechanics
- DEC-001 — Policy/mechanism split
- DEC-002 — The availability oracle is a synchronous rule engine
- DEC-003 — Crew rules collapse into one composite satisfiability rule
- DEC-014 — Locked-spec + future-ideas discipline
- DEC-DATA-1 — Muster keeps a service layer; Supabase (if used) is managed Postgres, not the architecture
- DEC-023 — The engine advances via an explicit `tick(repo, now)` operation; no scheduler in v1
- DEC-054 — Operator engine pause/resume — edge-gated, typed-port-backed, default-running (#124)
- DEC-118 — Crew audit log — dedicated append-only `audit_events`, edge-emitted actor, unioned read, out of the scoring path (#400)
- DEC-127 — DECISIONS.md carries a topic index at the top; every new DEC updates it
- DEC-131 — Constraint posture — DEC-DATA-1 governs *logic placement*, not structural constraints; FK/UNIQUE/NOT NULL are storage and are allowed
- DEC-141 — One decision, one file, behind a generated index
- DEC-143 — A decision that changes SPEC declares it, and the reciprocal pointer in SPEC is generated
- DEC-144 — Doc consistency is a ratchet in `verify`, not an audit
- DEC-159 — Lint encodes invariants, at error, inside the one gate — and every rule is measured before it is admitted (#757)

### Availability & commitment rules
- DEC-009 — Availability is suppression-only — never a positive-availability calendar
- DEC-077 — Day-granularity commitment; elastic absorption is already built; sub-day "watches" are deferred
- DEC-119 — Recurring weekday-off is a suppression column on the crew record (#411)
- DEC-149 — Ownership is not a real concept — the offering says when, blocks say what's off

### Seats, shifts & state machine
- DEC-005 — Shift state is derived from seat state; reserve a `Held` tier
- DEC-019 — `Bailed` is a seat *transition*, not a resting state
- DEC-028 — Bail `latenessMs` is the notice shortfall vs the staffing horizon, clamped to it
- DEC-039 — Confirmed-seat vacate splits into Remove (no penalty) vs Bailed (logs lateness) (#87)
- DEC-041 — Trip length → shift end, from a flat constant (#92)
- DEC-061 — A winning "in" auto-confirms — `Claimed` is momentary on the happy path
- DEC-078 — Concurrency, conflict, and crew self-release
- DEC-128 — `bail()` and `vacateSeat()` fire no asks — re-crewing is deferred to the tick (#483)
- DEC-129 — On-shift ask suppression — the engine never auto-asks crew mid-shift (hard, no valve) (#341)
- DEC-130 — Same-day decline cooldown — a "no" quiets that date's cross-shift auto-asks (soft, valved) (#341→#342)
- DEC-145 — Completion is swept by the tick, and a self-claim scores
- DEC-146 — A filled seat retires its outstanding asks

### Staffing engine — asks, escalation, At-Risk board & cockpit
- DEC-006 — Escalation Tiers 1–3 are degrees of automation, not states
- DEC-007 — Per-role assignment protocol + first-acceptable-yes-wins
- DEC-024 — Tier-2 escalation is a *nudge* over a *derived* escalation trail; "widen the pool" is a logged stub, not a soft-constraint engine
- DEC-025 — At-Risk urgency encodes "captain > mate" as pool-thinness, not a role-name check
- DEC-026 — Board ping = detection-now / delivery-later; lean = a manual nudge in the one log; reschedule/cancel render disabled
- DEC-027 — Cockpit v1 — four manual actions over existing rails; implicit automation-pause confirmed as emergent; warming = board-complement derive; "fills by" deferred to the fill-deadline decision
- DEC-031 — "Fills by" = the fill deadline — `tripStart − FILL_DEADLINE_HOURS`, derived, bound to the escalation threshold
- DEC-042 — "All shifts" full-visibility view — a deliberate, opt-in pull surface (#100)
- DEC-063 — Tier-1 ask fan-out is a staged "drip" — ranked, one candidate per interval, accumulating
- DEC-064 — The manual override honors the role-competency floor — no mate as captain
- DEC-065 — The At-Risk board shows every uncrewed shift within the fill deadline — no hide-while-working
- DEC-066 — Captains are never *asked* for mate seats — over-ranked crew drop from the askable pool
- DEC-067 — Silent-ask sweep wired into the tick — ghosted asks time out, seats reopen
- DEC-087 — Trainee seats are staffable — DEC-064's rating floor is scoped to required manning
- DEC-088 — Civil send window — automated ask sends gated on vessel-local wall-clock; state advance is not
- DEC-116 — Weekend-batch staffing trigger — Fri/Sat/Sun shifts go live together on one weekday + time (#392)
- DEC-117 — Weekend-batch ask distribution — one text per person, one boat per day (#393)

### Reliability scoring
- DEC-008 — Reliability score is a ranking, not a grade or gate — log events day one
- DEC-120 — Reliability retune — reward responsiveness; bail floor lowered, ramp rescaled (#425)

### Timing — horizons, deadlines & vessel clock
- DEC-004 — Two horizons; `deferred` is first-class
- DEC-022 — Staffing horizon is *derived* config, not a stored field; shift time-state is a composition layer over seat-derivation
- DEC-032 — Vessel-local time — wall-clock storage + one tenant timezone, NOT stored instants
- DEC-062 — The engine never works a departed shift; staffing horizon is env-tunable
- DEC-080 — The Xola pull window is decoupled from the staffing horizon
- DEC-115 — `FILL_DEADLINE_HOURS` is env-tunable (plumbing only — value stays 48h)

### Crew, vessels & manning model
- DEC-012 — Manifest is grouped per event on the shift card; no waivers for crew
- DEC-ROLE-1 — Crew roles and vessel manning are tenant data, not a hardcoded enum
- DEC-018 — Product string → vessel + manning map — auto-suggest, operator confirms
- DEC-044 — Crew seed carries a placeholder MMC until BrewBoat tracks real credentials
- DEC-096 — `archived` crew status — off every list, the one status the override honors (#323)
- DEC-097 — Guest-contact tracking is a progressive-enhancement client island (#345 Part B)
- DEC-157 — Hours round at the edge rather than truncate, through one shared rule (#758)

### Xola ingest & import
- DEC-011 — 2026 coexistence — CSV bridge is disposable; Xola API bolt-on killed
- DEC-015 — Xola import — verified source, grain, identity keys, and quarantined Land→Map→Reconcile architecture
- DEC-016 — BrewBoat worked example corrected — real fleet; scope ≠ current holdings; test data invented
- DEC-017 — Manifest contact — email is the spine, phone via email-join, phone nullable
- DEC-029 — "Changed since you reviewed it" is a pure derivation — `max(reservation.updatedAt) > shift.lockedAt`
- DEC-035 — Xola import surface — import→formShifts chaining, re-import idempotency, upload security
- DEC-036 — Live Xola API import — Land adapter behind existing Map/Reconcile; supersedes DEC-011's API kill
- DEC-037 — Task #73 (5.4) splits — xlsx import surface first (5.4a), Xola API Land adapter fast-follow (5.4b); review surface stays deferred
- DEC-040 — Xola live-API import — build resolution + sync strategy (5.4b; resolves DEC-036)
- DEC-043 — Ingest is events-driven — the boat is the event's assigned Resource, not a vessel invented from the product string (supersedes DEC-016's collapse)
- DEC-056 — Import runs are audited to the DB — edge-assembled, two-table, identity-level (#128)
- DEC-082 — Locking cut — Xola is the source of truth (supersedes SPEC §2.3 Lock; reframes DEC-029)
- DEC-083 — Manual Split — cut-time partition on the canonical row, re-derived each pull; import-diff cue over the existing audit

### Messaging, presence & doorbell
- DEC-MSG-1 — SMS is the eventual production channel — via the port, not in the slice
- DEC-MSG-2 — App form factor — native iOS + Android (Capacitor), de-prioritized
- DEC-MSG-3 — Channel adapters — one port, build in this order
- DEC-045 — Messaging & the Smart Doorbell — a deliberate SPEC v1.1 unlock
- DEC-046 — Presence is observed-only, never crew-curated (the DEC-009 guard for messaging)
- DEC-047 — No realtime vendor for v1 — presence via an activity signal behind a `PresencePort`
- DEC-048 — The doorbell is a pure core decider; presence-state and delivery-I/O live at the edge
- DEC-049 — The doorbell tick — a clock-driven sweep on a separate cron
- DEC-050 — The channel port widens with a `sendNotification` sibling to `sendAsk`
- DEC-051 — Messaging membership is derived, not snapshotted
- DEC-052 — Crew-to-crew DMs are operator-visible for v1
- DEC-053 — Two sender numbers — scheduling vs doorbell — on the crew 10DLC campaign
- DEC-058 — Canonical messaging subject = the existing `AuthSubject` kind, widened; doorbell rings on membership, not visibility
- DEC-060 — Doorbell window defaults — batch/cancel 90 s, presence-staleness 5 min (the 6.3 spike)
- DEC-068 — Presence enters the doorbell decider as a per-(subject,thread) three-state verdict; v1 fills it coarsely
- DEC-069 — Doorbell read/notify state — two single-writer tables, not one consolidated row
- DEC-070 — The doorbell tick — a separate cron that sweeps threads-with-messages and records-on-decide
- DEC-071 — Crew messaging UI — read + presence are one edge signal on real view; DM list is a participant index; view-auth is the DEC-052 predicate
- DEC-072 — Operator messaging surface — cross-visibility via the DEC-052 predicate ORed into `buildThreadView`; the operator is excluded from doorbell rings
- DEC-073 — Real doorbell-ring relay — the operator-outbox `NotificationPort` adapter, on its own table

### Outbound notifications & operator relay
- DEC-030 — Pilot channel = operator-relayed web link; the outbox is adapter state, never domain state
- DEC-084 — Crew assignment-change notice — a third operator-relay sibling
- DEC-095 — Operator At-Risk alert — the deferred delivery half of DEC-026, NOT a fourth outbound lane
- DEC-158 — A change notice names what moved — the SMS carries a subset, the app carries all of it

### Crew self-serve, auth & admin identity
- DEC-010 — Crew auth is magic-link passwordless; crew don't self-register
- DEC-034 — Production auth path — operator link mint, dev-link stays 404, NO email provider
- DEC-057 — The dev-link minter is gated by `VERCEL_ENV`, not `NODE_ENV` — live on previews, off in prod
- DEC-074 — Crew self-serve is a fourth crew surface — a knowing, recorded exception to "insultingly small"
- DEC-075 — Self-claim is auto-lock (`Open → Confirmed`), bypassing `Asked`; operator-confirm-required is a built-in seam, not built
- DEC-076 — Two eligibility doors — self-claim is native-role-only; operator-assign is ratings-inclusive (the dual-rating escape hatch)
- DEC-079 — Crew-initiated sign-in + sign-out — the self-serve front door (a small addition, not a re-architecture)
- DEC-081 — Crew sign-in is a 6-digit email code, not a magic link — and it's the one login primitive (refines DEC-079)
- DEC-092 — Admin becomes a first-class auth identity — per-person revoke (10.2, #283; revises DEC-020)
- DEC-093 — Crew ↔ admin view switcher — same-identity session re-mint (builds on DEC-092)
- DEC-094 — Operator break-glass is CLI + runbook, not an admin UI (10.5; extends DEC-092)
- DEC-098 — Crew calendar feed — the first persistent bearer capability URL; hash-only, guest-PII-free, UTC-instant ICS
- DEC-142 — Login brute force is bounded per subject, not per code — and every verify failure is one generic response
- DEC-150 — An already-authenticated crew member skips the tap-to-sign-in interstitial

### Reservations & payments
- DEC-105 — Reservations go live in 2026 as a Muster-native parallel-run — permanent coexistence, not a cutover
- DEC-106 — Every departure and booking records which system sold it
- DEC-107 — Sales tax is read live, not frozen onto the booking
- DEC-108 — Public surface `app/(public)` + single-flip "Book Now" entry (instant Xola rollback)
- DEC-109 — Atomic capacity claim on public booking (the customer-side REQ-CLAIM-1)
- DEC-110 — Waiver — Muster-sold side only; integrate a provider (deferred pre-flip); pilot uses minimal consent
- DEC-111 — `feature/reservations` dark behind a `RESERVATIONS` flag until the first real paid booking
- DEC-112 — A departure's price comes from the offering, with a per-departure override
- DEC-113 — Flex-insurance is a boolean selector on the reservation, not a priced add-on product
- DEC-122 — Customer booking link — stateless HMAC capability-URL + guest confirmation emit (renumbered from DEC-119 at the feature→main merge — main's DEC-119 is recurring weekday-off #411; 11.4, #370; extends DEC-020/098/108)
- DEC-123 — Reservations gets its own calendar — customer-centric, beside the crew-centric shift view; plus a net-new catalog and purchases/customers area
- DEC-124 — Muster reports its own tips; joining them to Xola's stays in the operator's tool
- DEC-125 — Virtual availability — the schedule is a rule, `Event` rows materialize on state; blackout is scoped blocks, not per-event toggles
- DEC-126 — The flip from Xola is a cutover, not a natural drain
- DEC-132 — `Customer` is a contact record keyed by phone — surrogate PK, UNIQUE canonical E.164, readable short code
- DEC-133 — The customer availability screen is server-rendered; the guest stepper is the one client island (12.4, #457)
- DEC-134 — Customer checkout is inline Stripe Elements over a deferred PaymentIntent; hosted Checkout remains for balance + post-gratuity (12.5, #458; revisits DEC-107/108 as DEC-108 anticipated)
- DEC-135 — Cancelling is a request to the operator, not self-service
- DEC-138 — The booking flow reaches customers as an embed, not a rebuilt website
- DEC-139 — Payments — Stripe card checkout only; no Apple Pay / wallets (foreseeable future)
- DEC-140 — SPEC §1.3 rewritten to the DEC-125 model — availability is two mechanisms, not one rule engine; COI-expiry and lead-time cutoff closed as out of scope
- DEC-151 — Retire the legacy booking write path rather than guard it — one write path, or the unguarded one outlives the guarded one
- DEC-153 — Cancel and refund from Muster — the operator keeps the discretion, both routes reconcile, and cancelling releases the event not just the reservation
- DEC-154 — The booking link is a stored code, so it can be revoked
- DEC-155 — Full payment is the default and the launch posture — deposit mode becomes opt-in (#617)
- DEC-156 — Never show a customer a departure they cannot buy
- DEC-161 — Occupancy is measured in hold minutes, not trip time

### UI, brand & frontend patterns
- DEC-021 — Frontend styling = Tailwind v4; component library deferred
- DEC-038 — Pilot-walkthrough UX/copy revisions (operator review of the slice-1 surfaces)
- DEC-055 — Transient feedback params are stripped post-render by a contained client island (#121)
- DEC-085 — Shift Builder — responsive dual-form-factor over one no-JS core
- DEC-086 — Vessel + role identity palette — color that encodes information
- DEC-089 — `<SubmitButton>` — standing pending-state client island for async form submits (#202/#250, Layer 2)
- DEC-090 — Click & loading feedback — the standing rule (`<SubmitButton>` for submits, `<AppLink>` for links; lint-enforced)
- DEC-091 — Crew navigation is hub-and-spoke — no persistent nav chrome (9.12, #238)
- DEC-114 — `<RevealSelectedRow>` — scroll-position keeping on the two-pane board, an imperative island scoped to `board-col`
- DEC-147 — Server-rendering is the default; a client island is earned, and feedback params carry codes not prose
- DEC-148 — Crew navigation moves into a drawer — the hub carries work, not a menu (#644)
- DEC-152 — Two clock buttons that never move, one disabled — a control that vanishes moves its neighbour under the thumb
- DEC-160 — An unsaved form asks before you leave, and "dirty" is a comparison against the server's defaults

### Deployment, infra & versioning
- DEC-013 — Stack & infrastructure deferred to ~M4
- DEC-020 — M4 stack — Next.js (App Router) / Vercel; persistence is Postgres-behind-the-port with the hosted provider deferred; magic-link is self-rolled. No platform adopted.
- DEC-033 — Hosted deploy — provider pick (OPEN), Vercel topology, `tick` cron, `production` branch
- DEC-059 — `main` stays promotable — multi-PR features land on a feature branch, not piecemeal on `main`
- DEC-121 — Timestamp-prefixed migration filenames — cross-branch collision made structurally impossible (refines DEC-020)

### Open questions
- DEC-TBD — Open questions (carried from the spec; not Claude's to set alone)

_**This file is GENERATED** by `npm run gen:decisions` —
edit `docs/decisions/DEC-*.md`, not this file. `npm run check:decisions` fails on a stale index, a
duplicate id, an unknown topic, an unlanded SPEC amendment, or a reference to a decision
that does not exist._
