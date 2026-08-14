# Muster — Project Context

Everything specific to **this** project. The seeds-managed `CLAUDE.md` shell reads this file at session start and treats it as authoritative for project-specific facts (DEC-S019). Nothing here syncs from seeds — it's yours to edit freely.

## What We're Building

Muster is a **crew engine** for small-passenger-vessel operators. It takes imported reservations, groups them into **shifts**, works out who is legally allowed to crew each shift (USCG manning, credentials, turnaround), asks them in **reliability order**, and surfaces only the shifts the automation could not close.

**A shift is the unit of crewing:** all of one vessel's trips on one vessel-local day, worked as a single assignment — taking it means taking the whole day, not a trip. That grouping is the *default*, not an invariant: a day with a long midday gap can be **split** into two shifts (8.3) and merged back (8.4), so **vessel+date does not uniquely identify a shift**.

**Two windows, deliberately decoupled (DEC-080)** — conflating them is a recurring source of wrong reasoning. `XOLA_PULL_LEAD_DAYS` is how far ahead the importer fetches reservations; `STAFFING_HORIZON_LEAD_DAYS` is how far ahead the engine starts *working* a shift, and therefore asking (fractional is supported so the ask can be timed off the trip's clock hour). The pull window defaults to the horizon and is raised so a month of bookings is visible without the engine asking crew that far out. Both are **env-overridable, tuned per deploy without a code change** (DEC-062) — never hardcode either. **Repo defaults live in `src/builder/derive.ts:148,192`; the deployed values live in Vercel env and are not answerable from the repo** (audit shard E found 22 prod env vars absent from `DEPLOY.md`). Do not quote a number for these from memory or from this file — read the constant, or ask. A separate weekend-cohort policy (DEC-116) can collapse Fri/Sat/Sun asks onto one shared send instant. It is the half of an eventual Xola replacement that Xola has no concept of: Xola knows a booking is paid; Muster knows whether anyone will be standing on the dock to run it. First tenant / worked example: **BrewBoat** — a real fleet of **4 inspected party boats** (two 12-pax, one 14, one 16), **each manned by 2 crew**; zero-crew rentals are also in scope (DEC-016). Manning is per-vessel data the deriver loops (0/1/2/N), never a fixed pair. *(The old "one boat, COI 6, 1 captain + 1 mate" example was a placeholder — corrected per DEC-016.)*

The spine is a **policy/mechanism split** (DEC-001): the rules are tenant-owned data; the engine that runs them is generic.

Roles:
- **Spink** — the operator (BrewBoat's). Semi-retired; the design goal is **no babysitting**. Runs the admin app, leans on crew, makes the 11pm cancel/reschedule call.
- **Drew** — the owner. Owns the money/policy decisions (refunds, deposit-vs-full). Mostly out of the 2026 build (payments are parked).
- **Crew** — captains and mates. Magic-link auth, no passwords. The crew app is deliberately small but it is **not** three screens — as of this writing: the ask (the core Yes/No card; everything else is secondary), my shifts, the shift card, pick up a shift, messages, calendar, time off, help. **Two are feature-flagged** (`/crew/open` behind `selfServeEnabled()`, `/crew/threads` behind `messagingEnabled()`), so "the crew app" means different things per deploy. Authoritative list: `ls app/\(crew\)/crew/`. The standing pressure isn't a screen count — it's whether a new thing earns a screen, because every extra screen is somewhere stale information can hide.

## Stack

**Chosen at M4 — see DEC-020.** M0–M3 are a **stack-agnostic domain core** (entities, state machine, oracle, reliability-event log) behind a **`Repository` port**; that core under `src/` stays **framework-free** and is never moved. The M4 stack wraps it:

- **Language/runtime:** Node + TypeScript (strict). Vitest (task 0.3).
- **Web framework / host:** **Next.js (App Router) on Vercel** — one app, route groups `app/(admin)` / `app/(crew)` / `app/api`. Next imports the core via the `@core/*` alias.
- **Build:** `npm run build` = `next build --webpack`. **Webpack, not Turbopack** — the core's NodeNext `.js` import specifiers need `extensionAlias` (`.js`→`.ts`), which Turbopack lacks (DEC-020). Two TS profiles: `tsconfig.core.json` (strict NodeNext, the core — `npm run typecheck`) and root `tsconfig.json` (Next/bundler, the app — `typecheck:app`).
- **Persistence:** **Postgres behind the `Repository` port**, **local Postgres in dev**; schema is plain Postgres DDL (DEC-DATA-1). **Hosted Postgres = Neon** (deployed on Vercel + Neon, DEC-033 — see `docs/DEPLOY.md`); the port keeps it vendor-swappable. The in-memory adapter stays as the test substrate.
- **Auth:** **self-rolled magic-link in the service layer** (no auth platform) — same for admin + crew.
- **Channel (crew ask):** one port (DEC-MSG-3), many adapters — **authoritative list: `ls src/adapters/*-channel.ts`**. **SMS is live in production**: `twilio-channel.ts` shipped at 9.4/#225 (the DEC-MSG-1 swap) and one class serves all three relay ports — ask `ChannelPort`, doorbell `NotificationPort`, notice `NoticePort`. `app/lib/channel.ts` selects it whenever Twilio is configured and falls back to web-link. The fakes are permanent test infra. **native/Capacitor** = post-slice fast-follow (DEC-MSG-2), still unbuilt.
- **`.claude/project-type`** is `webapp` (flipped from `tool` at M4 — DEC-020); `@ui-reviewer` re-enabled via `/pull-seeds`.

## Core Data Model

From SPEC §2.1–2.6 / build plan §2. Stack-agnostic entities; fields marked **(log day one)** must be real from the first commit even if nothing reads them yet (DEC-008).

```
Reservation → Event (n:1) → Shift (n:1, by vessel+day) → Seat (1:n) → CrewMember (n:1, via assignment)
CrewMember → Credential / PtoWindow / ReliabilityEvent (1:n)
Vessel → Event / Shift

Vessel            coiMaxPax, manning [{roleTypeId,count}]   (per-vessel data, N lines — DEC-016/ROLE-1)
CrewMember        name, phone, ratings[captain|mate], status, manualBoost?, manualFloor?,
                  protocolOverride?, reliabilityScore (MVP-thin: null/flat)
Credential        type (MMC universal; medical/TWIC/drug-consortium tenant-config), expiry
PtoWindow         start, end                                (suppression-only — DEC-009)
Event             vesselId, date, time, capacity, status
Reservation       eventId, customerName, partySize, phone, status   (no waiver — DEC-012)
Shift             vesselId, date, state, lockedAt?, eventIds[]
                  state ∈ Pending/Filling/Crewed/AtRisk/Completed/Cancelled (derived — DEC-005)
Seat              shiftId, role, kind (required|supernumerary), state, assignedCrewMemberId?
                  state ∈ Open/Asked/Claimed/Confirmed/Bailed   (⏳ reserve a Held tier — DEC-005)
Ask               seatId, crewMemberId, channel, sentAt, respondedAt?, response,
                  type(confirm|hold)⏳, decisionBy?⏳          (doubles as a reliability event)
ReliabilityEvent  crewMemberId, type, timestamp, metadata{latency?,lateness?,seatId?,shiftId?}
                  (log day one — DEC-008; ⏳ room for hold_released)
```

⏳ = reserved-but-not-implemented field for Pass D (progressive commitment). Add the column now; default it inert. See DEC-004/DEC-005.

## Commands

The per-task gate (run by `/kill-this`, `/pause-this`) is **`npm run verify`** — it chains the full check so a core-only regression can't ship behind a green app build:

| Command | Covers |
|---------|--------|
| `npm run verify` | **the gate** — `check:decisions` + `check:context` + `check:docs` + `typecheck` + `typecheck:app` + `lint` + `test` + `build`, in order |
| `npm run check:context` | every repo path this file and `CLAUDE.md` cite still resolves. **These docs carry decisions, rationale and pointers — never inventory.** A prose snapshot of current state is stale the day the code moves; a pointer (`ls src/adapters/*-channel.ts`) sends the reader to the truth and is checkable. Cite a full path and it gets checked; a bare filename does not. `<angle brackets>` mark a deliberate placeholder |
| `npm run check:docs` | the same discipline over every top-level `docs/*.md` (DEC-144). DEC ids, `npm run` commands, issue-link text vs its own URL, skill/agent rosters vs `.claude/` in **both** directions, and repo paths. Historical ledgers (`SPEC`, `PROJECT_PLAN`, `RETROSPECTIVES`, `FUTURE_IDEAS`, `SECURITY_AUDIT`) are exempt from the path class **by name and with a reason** — they cite deleted files correctly. Reads structure, never prose: `@doc-consistency` still owns characterization |
| `npm run typecheck` | domain core only (`tsconfig.core.json`, strict NodeNext) |
| `npm run typecheck:app` | Next app only (`tsconfig.json`, bundler) |
| `npm run test` | Vitest (domain core) |
| `npm run build` | `next build --webpack` (app; **webpack required** — DEC-020) |
| `npm run dev` | `next dev --webpack` |

`build` alone is **not** the gate — it validates the app, not the core. Use `verify`.

## Additional Docs

Project-specific docs beyond the baseline `## Key Docs` table in the `CLAUDE.md` shell:

| File | Purpose |
|------|---------|
| `docs/BRAND.md` | Voice, visual direction, philosophy. Webapp-shaped, so it lives here rather than in the shell's Key Docs — a CLI or firmware project has no use for it. |
| `docs/FUTURE_IDEAS.md` | The shiny-object parking lot. New ideas land here, not in the locked spec (DEC-014). |
| `docs/RUNNING.md` | How to run the app locally, see the UI (Tailscale host, magic-link dev flow), check a change. PRs link here for setup. |
| `docs/DEPLOY.md` | Go-live runbook — Vercel + Neon Postgres (Phase 5.1, DEC-033). |
| `docs/design/DESIGN-REFERENCE.md` | How to consume the UI mockups: spec wins on *what*, mockups inform *how*; **read JSX, never import**. Read before building any surface (M4). |
| `docs/design/mockups/` | Claude Design export (HTML + JSX) per surface §2.1–2.6.3. **Visual-direction reference, not spec.** |

Notes on the baseline docs: `docs/SPEC.md` is the buildable source of truth. It is **not** locked — it carried a "🔒 LOCKED v1.0" stamp for months while DEC-105, DEC-140 and others rewrote whole sections, and the stamp was removed rather than kept as a fiction. What survives is DEC-014's scope rule: new ideas go to `docs/FUTURE_IDEAS.md`, and a change to a section is a **declared amendment** — `amends_spec: [{section, scope}]` in the amending decision's frontmatter, with the pointer under that section's heading generated (DEC-143). **Decisions live one per file in `docs/decisions/DEC-*.md`** (141 of them, DEC-001–143 plus the `DATA` / `MSG` / `ROLE` / `TBD` families); `docs/DECISIONS.md` is the **generated** topic index over them (DEC-141). Read a decision by reading its file — `grep -rl DEC-042 docs/decisions/` resolves any id. To add or change one, edit its file and run `npm run gen:decisions`; `npm run check:decisions` runs first in `verify` and fails on a stale index, a duplicate id, a dangling reference, or a spec amendment that never landed.

## Workflow Mechanisms

The shell's `## Micro Workflow` states what three steps must achieve and names a slot for how (DEC-S042). Filled below. **Slots, not overrides** — the shell states no default to correct, and nothing here cites a step *number*, because numbers move and a stale cross-reference in an always-loaded file fails silently. This section previously said "Step 5 (Write the test)" for two months after the shell renumbered.

Muster is Next.js over a framework-free domain core — not the shell's old Supabase/Playwright default.

| Slot | This project |
|---|---|
| **Proof** | Vitest against the domain core (oracle, state machine, reliability log), which is heavily unit- and integration-tested. Test-first when behaviour changes. **No pgTAP** — there is no Supabase and no RLS; persistence sits behind the `Repository` port with an in-memory adapter as the test substrate. |
| **Proof command** | The relevant Vitest file or suite, not the whole thing. The full suite is my call, never automatic. |
| **Surface check** | **Every page works at 375px — eyeball it at `mill-dev:3000`** per `docs/RUNNING.md`. Playwright screenshots land when that tooling does (M4 fast-follow); until then this step is done by looking, which is exactly why it is a separate step from the proof. |

**The gate** is `npm run verify` (`check:decisions` + `check:context` + `check:docs` + typecheck + typecheck:app + lint + test + build). `/kill-this` and `/pause-this` run it. Named here rather than under Commands because it chains the whole check.

## PR Workflow Overrides

- **Feature branches for multi-PR features (DEC-059 — overrides the shell's `## PR Workflow`):** `main` must stay **promotable to `production` at all times**. A feature shipping across multiple PRs that isn't independently releasable lands on a long-lived `feature/<name>` branch off `main` — its task PRs target *that* branch — and merges to `main` only when the whole feature is prod-ready **or** dark behind a flag. Independently-shippable tasks still PR straight to `main`. The shell's "stack PRs onto `main`" guidance applies only to independently-shippable work; do **not** land partial features on `main`.

## Blast-Radius Triggers

Read by `/kill-this` Step 3.5 and matched against the branch diff. On a hit the skill runs `/security-review` locally and surfaces `/code-review ultra` as the optional deeper pass. Paths, not categories — "the money path" can't be matched against a diff.

| Trigger | Paths |
|---|---|
| **Money moving** | `app/api/webhooks/stripe/`, `src/adapters/stripe-payment.ts`, `src/ports/payment.ts`, `src/reservations/create-departure-payment-intent.ts`, `src/reservations/payment-config.ts`, `src/reservations/refund-payment.ts` |
| **Money computed** | `app/(admin)/admin/payroll/**` (incl. the `gusto.csv` and `tips.csv` exports), `app/(admin)/admin/time-clock/**`, `app/(admin)/admin/shift/[shiftId]/**`, `app/(admin)/admin/shifts/**`, `app/(crew)/crew/shift/[shiftId]/**` |
| **Auth / capability URL** | `app/lib/auth.ts`, `app/lib/auth-delivery.ts`, `app/(crew)/crew/auth/`, `app/api/calendar/[token]/**` |
| **Data-changing migration** | a file under `db/migrations/` containing `drop`, `alter … type`, `update`, or `delete`. An additive `add column` does **not** trigger |

**`refund-payment.ts` was missing until #726** — the one module in the repo that hands real money *back*, absent from a list defined as "money moving". It was caught by asking the skill's own fallback question (does a number this produces reach someone's statement?) rather than by the table, which is the failure mode a path list has: it can only name what someone thought of. When a money change doesn't match a row, add the row in the same PR.

**Why the payroll exports are listed by name.** `gusto.csv` is the file that becomes a paycheck. Nothing in it looks like a payment — no provider, no charge, no amount in cents — so a trigger defined by *where money moves* would never match it. A mis-bucketed pay period or a double-counted punch upstream in `time-clock` or `shift` reaches a person's pay with no payment code anywhere in the diff.

**Not triggers:** `src/oracle/`, `src/domain/reliability.ts` (reliability scoring isn't money), messaging, UI-only work, docs, mockups, and anything under `.claude/`.

## Migration Protocol (project)

**No Supabase** — the shell's Supabase toolchain, `safe-supabase.sh` prod-write guard (DEC-S009), and Supabase↔Vercel env-var sync are all **N/A**.

Persistence is **Postgres behind the `Repository` port**: **local Postgres in dev**, **Neon in production** (Vercel + Neon, DEC-033 — `docs/DEPLOY.md`), schema as **plain Postgres DDL** (DEC-DATA-1). The in-memory adapter is the test substrate and never goes away. The shell's universal migration *discipline* still holds: schema changes go through migration files (plain DDL here), migrations are the source of truth, never hand-patch an applied migration, and check for open PRs touching the same tables before adding one.

**Migration filenames are timestamped (DEC-121).** New migrations are `YYYYMMDDHHMMSS_name.sql` (UTC) — **never** a new `00NN_` number. Generate with `npm run db:new-migration <name>` (never hand-name one). The runner (`db/migrate.ts`) orders by filename sort and keys on the filename, so timestamps sort chronologically after every legacy `00NN_` and can't collide across branches (the fix for the long-lived `feature/reservations` vs `main` clash). One-time trap: renaming an already-applied migration re-runs its DDL — reconcile that dev DB's `_migrations` before the next `db:migrate`.

**Prod migrations are applied by hand, out-of-band** — they are *not* part of the Vercel deploy. So code on `production` can outrun the prod schema. Apply the migration to prod *before* promoting the code that needs it.

**Pre-promote checks** (run by `/promote-production` before the ff-merge — the generic skill's project-checks hook honors whatever's listed here; #282):
- **Migration-ledger drift.** Confirm prod has applied every migration in the repo. Read prod's applied set via the **Neon MCP** — `run_sql` against project **`delicate-art-65084110`** (neon-red-pendant, org `org-spring-feather-31353161`, in the Vercel-managed Neon org), **default branch = the prod DB**: `select filename from _migrations order by filename;`. Diff against `db/migrations/*.sql` basenames.
  - **Repo has a file prod's `_migrations` lacks → STOP.** List the unapplied migration(s); apply them to prod first, then re-run `/promote-production`. Promoting now would ship code ahead of the schema.
  - **Prod ahead of repo** (an applied migration not in the repo) → warn and ask promote/abort. Unusual; means a hand-applied migration was never committed.
  - **Neon MCP unavailable** (headless/cron) → have the operator paste `select filename from _migrations order by filename;` output from prod, and diff against that.
  - Naming trap: Neon's own **default branch = the prod DB** (Neon calls its root branch "main" in its dashboard — unrelated to git `main`, which never deploys here per `vercel.json` `git.deploymentEnabled.main:false`).

## Conventions

### Components
- Server Components by default. Add `'use client'` only when needed.
- No component library yet (DEC-021) — components are hand-built from Tailwind v4 utilities.
- Feature components in `components/<feature>/`. **Guideline, not a rule: keep a component under ~300 lines of code** (the doc-comment block doesn't count — this repo comments heavily). Split when it's genuinely two responsibilities or the diff is hard to review, **not to hit a number** — same posture as the Scope Discipline "don't split a coherent 8" rule. Route orchestrators (`page.tsx`/`layout.tsx`) do auth + data + layout + composition and run larger by nature; judge them by coherence, not line count.

### Error Handling
- Form actions: return `string | null`. `null` = success, string = error message.
- Button actions: return `{ error: string | null }`.
- Never `throw` in server actions — return errors for inline feedback.
- Forward guidance for *new* actions — `app/(crew)/crew/actions.ts` predates it; retrofit when touched.
- **No-client-JS surfaces** (admin board pattern, DEC-026): an action may return `void` and surface feedback via redirect search params — params carry **codes/ids only, never prose** (the page maps them to copy), so a crafted URL can't inject text into a trusted surface. Wrap the domain call in try/catch (a repo outage → a mapped notice, not a 500); `redirect()` throws by design, keep it outside the try.

### Naming
- Files: `kebab-case.tsx`
- Components: `PascalCase`
- Server Actions: `camelCase` in `actions/` files
- DB columns: `snake_case`

### UI / Brand
- Tokens are harvested from the mockups into `@theme` in `app/globals.css` (DEC-021) — colors, one card radius (`--radius-card: 14px` — deliberately a single value, not a scale; see `BRAND.md`). No color for color's sake. Binding constraints live in `.claude/ui-context.md`.
- Font: IBM Plex Sans/Mono, loaded via next/font in `app/layout.tsx`.
- Layout padding in `layout.tsx` only.
- Every page works at 375px — eyeball at `mill-dev:3000` per `docs/RUNNING.md` (Playwright screenshots when that tooling lands).

### Testing
- The domain core (oracle, state machine, reliability log) is heavily unit/integration tested with Vitest. UI tests arrive with the stack tooling (M4). No pgTAP (no RLS).
- **e2e: interact with a `"use client"` island via `clickHydrated` / `selectOptionHydrated`** (`e2e/fixtures.ts`), never a bare `.click()` / `.selectOption()`. An island is server-rendered, so its controls pass every Playwright actionability check *before* React attaches a handler — the bare call then succeeds and does nothing, and the next locator waits out its full timeout (#642). A controlled `<select>` fails a second way: React reverts the selection on hydration. Plain server-form controls (`SubmitButton`, `<a>`, `<details>/<summary>`) work without JS by design and need neither.

## PR Workflow (project)

The shell's `## PR Workflow` is the baseline. Muster adds:

- **Small docs / idea-parking PRs ship standalone** off `main` (own branch + PR) and are **not** logged in the session file — `## Task` blocks + `pr_numbers` are reserved for substantive, issue-closing task PRs.
- **PR / task test plans split two things:** *Verified (automated)* — what was already run (`npm run verify`, tests, CI, smoke) — from a short *Eyeball-it-yourself (human)* list of what the reviewer still needs to look at (UI surfaces, anything no test covers). The stable local-run recipe lives in `docs/RUNNING.md` — link it, don't re-explain setup each PR.
- **Eyeball steps must be executable and observable.** Each step is a copy-pasteable command that exists in the repo **today** (a step needing missing tooling → build the tooling in the same PR or cut the step) or a tap on what a prior step produced, ending with the literal expected sight ("green success card", not "verify it works"). Numbered, one line each. Claude verifies what it can before the PR; what's visually unverified is **labeled, not dressed up as a step**.
- **`production` branch + `/promote-production` are live as of the Neon deploy** (DEC-033/DEC-S022). `main` is always the active trunk; `production` is only the downstream deploy pointer, never a PR base.
- The shell's *PR Review on Mobile* notes apply, with muster's substitutions: the eyeball path is the Vercel preview URL once deployed (else `mill-dev:3000`); the PR checklist asks "schema/DDL change?" rather than "migration/RLS change?".

### Reservations (`phase:12b`) — every PR ships a state the operator can actually test

**Standing requirement, operator 2026-08-05.** The reservation system has had almost no hands-on
testing: the operator deliberately held it back to do one big pass once the polish landed. That
pass will happen **long after** each PR is written, by someone who does not have the diff in their
head. So a `phase:12b` PR that merges without a reproducible starting state is a PR that silently
opts out of the only testing this subsystem will get.

On top of the eyeball rules above, every `phase:12b` PR must carry:

1. **A named seed that produces the state under test** — an `npm run db:seed:*` that exists in the
   repo *after this PR*. `db/seed-reservation-dev.ts` is the base world (a LIVE Offering, a
   Location, the owned-day mask, two materialized bookings, dates relative to today so it never
   expires). If no seed reaches the state, **extend one or add one in the same PR** — "click
   through the booking flow first" is not a starting state.
2. **Seeds that compose and re-run.** The pass runs several in one sitting. A seed that assumes an
   empty database, or that collides with another seed's ids, breaks the step after it. State the
   composition explicitly: which seeds, in which order.
3. **Steps that name the literal expected sight**, starting from a URL and a seeded fact — "`/admin/purchases` → the Aug 12 Hops row reads **Refunded**", not "verify the refund worked".
4. **The reset.** How to get back to the starting state after a destructive step, so the pass can
   be repeated or resumed. `npm run db:reset:test` is e2e-only; say what the human runs.
5. **For money paths, what to check in Stripe** — which test-mode object (PaymentIntent, Refund,
   webhook delivery) and what it should read. Muster's own screen agreeing with itself is not
   evidence the ledger reconciled.

**Why it is written here rather than remembered:** the operator offered to repeat it every session.
That would work and it should not be necessary — this file is read at the start of every session,
and the requirement outlives whoever is at the keyboard.

### When to run `/code-review ultra`

`@code-review` runs on every task (wired into `/kill-this`) and hunts Muster's known invariants. `/code-review ultra` is the other thing: multiple agents auditing the branch independently from different angles, filtered by confidence. It is **user-triggered and billed — Claude cannot launch it** and must not try.

**Default: don't.** The trigger is **blast radius and reversibility**, not diff size or phase. Run it once, on the PR, before merge — it's branch-scoped, so per-commit runs pay repeatedly for the same answer.

Run it when a PR meets **any one** of:

1. **Touches money** — PaymentIntent creation, webhook handling, refunds, fee/tip/balance math. A defect is a real charge against a real card, discovered by a customer.
2. **Touches auth or a capability URL** — `login-code.ts`, session/subject handling, token minting, the `/reservations/manage` bearer path. These fail *silently* and don't self-correct.
3. **Contains a data-changing migration** — a rewrite or drop, not an additive column. In prod that's a restore, not a revert.
4. **The diff is too big to review well yourself** — the same signal that triggers splitting, pointed at a different remedy. When a change is coherent enough not to split but too large to hold in your head, independent auditors are the point.

**Never** for docs, seeds, agent/skill files, dev tooling, or single-surface UI — blast radius stops at the dev DB.

It's billed and launches many agents in parallel, so it's worth it exactly where a missed defect costs more than the review — criteria 1–3, and nothing else.

`/kill-this` Step 3.5 checks the diff against these triggers and prints a recommendation when one hits. It never runs it and never blocks. The check lives in the skill because the trigger is a property of the diff, and the moment you'd need to recall the rule is the moment you're least likely to.

## Versioning (project)

Follows the shell (DEC-S022). SemVer in `package.json` (created at task 0.3), tag on `main`. This project has a `production` branch, so **`/promote-production` patch-bumps + tags on each ship** (one release = one patch); **`/retro` minor-bumps at phase close**; `/bump-major` for breaking changes. (The earlier "bumps only at `/retro`" note predated adopting the `production` branch.) The `<VersionTag />` component lives at `components/ui/version-tag.tsx` and is **wired** into the crew and admin surfaces (`app/(crew)/crew/{,open,calendar,time-off}/page.tsx`, `app/(admin)/admin/{,time-off}/page.tsx`); the build-time stamp is injected via `next.config.ts`.

## MCP fast-fix loop (9.0/#230)

Project-scoped MCP servers in `.mcp.json` (checked in): **Neon** (`https://mcp.neon.tech/mcp`) and
**Vercel** (`https://mcp.vercel.com`), both remote/OAuth. One-time per machine: run `/mcp` in a
session and authenticate each (browser OAuth). After that any session can read prod state directly —
Neon: query/diagnose the production DB; Vercel: build logs, deploy status, env vars, preview URLs.

**Write discipline (the DEC-S009 posture, MCP edition):** Neon MCP can execute arbitrary SQL — treat
it as **read/diagnose only**. Schema changes STILL go through `db/migrations/*.sql` applied by the
operator (see Migration Protocol); ad-hoc prod data fixes are the operator's explicit call, never a
silent Claude action. If a provider URL ever 404s, check that provider's MCP docs — the endpoints are
theirs to move.

## Workflow Notes (project)

- **Webpack, not Turbopack** (DEC-020) — `next build --webpack` / `next dev --webpack`. The core's NodeNext `.js`→`.ts` `extensionAlias` is unsupported by Turbopack.
- **Two TS profiles:** `tsconfig.core.json` (the framework-free core) vs root `tsconfig.json` (the Next app). `npm run verify` checks both.
- **`git push` exception to the shell's "environment-changing commands":** the `/kill-this` ritual owns commit + push + PR — that's its job, no separate approval needed for the push inside it.
- **`@ui-reviewer` is live** — `.claude/ui-context.md` exists and carries the brand tokens, surfaces, viewports and review checklist it hard-stops without. That file (brand tokens, surfaces, viewports, checklist) is authored with the first crew/admin surface.

## Scope Discipline (project)

Check `docs/SPEC.md` §4 *Parked* + the 2027 line before adding anything — that's the "Not V1" guardrail. New ideas go to `docs/FUTURE_IDEAS.md`, **not** the locked spec (DEC-014).

## Tone (project)

The shell's `## Tone` (dry humor) applies. Muster adds two standing principles:

- **Push back and suggest — don't just execute.** Flag landmines (security, data-integrity, scope), propose the safer option, surface real forks rather than guessing. The goal is a collaborator that keeps the calls honest, *while* holding the vertical slice and not chasing tangents (new ideas → `docs/FUTURE_IDEAS.md`, DEC-014). Pushback and slice-focus together — don't trade one for the other.
- **The repo is the system of record.** Anything load-bearing lives in `CLAUDE.md` / `.claude/CLAUDE-context.md` / `docs/` / the session files — version-controlled and visible. Auto-memory is a best-effort convenience hint, never the only home of something that matters.
