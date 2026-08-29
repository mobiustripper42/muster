# Muster — Project Context

Everything specific to **this** project. The jig-managed `CLAUDE.md` shell reads this file at session start and treats it as authoritative for project-specific facts (DEC-S019). Nothing here syncs from jig — it's yours to edit freely.

## What We're Building

Muster is a reservation and operations system for small-passenger-vessel operators — a Xola replacement. Customers book and pay for departures. Muster groups the resulting trips into shifts, works out who is legally allowed to crew each one (USCG manning, credentials, turnaround), asks them in reliability order, and surfaces only the shifts the automation could not close.

Crewing is the half Xola has no concept of. Xola knows a booking is paid; Muster knows whether anyone will be standing on the dock to run it.

**A shift is the unit of crewing:** all of one vessel's trips on one vessel-local day, worked as a single assignment — taking it means taking the whole day, not a trip. That grouping is the *default*, not an invariant: a day with a long midday gap can be **split** into two shifts and merged back, so **vessel+date does not uniquely identify a shift**.

**Two windows, deliberately decoupled (DEC-080)** — conflating them is a recurring source of wrong reasoning. `XOLA_PULL_LEAD_DAYS` is how far ahead the importer fetches reservations; `STAFFING_HORIZON_LEAD_DAYS` is how far ahead the engine starts *working* a shift, and therefore asking (fractional is supported so the ask can be timed off the trip's clock hour). The pull window defaults to the horizon and is raised so a month of bookings is visible without the engine asking crew that far out. Both are **env-overridable, tuned per deploy without a code change** (DEC-062) — never hardcode either. **Repo defaults live in `src/builder/derive.ts:148,192`; the deployed values live in Vercel env and are not answerable from the repo** (audit shard E found 22 prod env vars absent from `DEPLOY.md`). Do not quote a number for these from memory or from this file — read the constant, or ask. A separate weekend-cohort policy (DEC-116) can collapse Fri/Sat/Sun asks onto one shared send instant.

First tenant / worked example: **BrewBoat**. The fleet, its manning and the DEC-016 correction to the old single-boat placeholder are in `docs/SPEC.md`. The rule that outlives the numbers: **manning is per-vessel data the deriver loops (0/1/2/N), never a fixed pair**, and zero-crew rentals are in scope.

Roles:
- **Eric** — the operator (BrewBoat's). Semi-retired; the design goal is **no babysitting**. Runs the admin app, leans on crew, makes the 11pm cancel/reschedule call.
- **Drew** — the owner. Owns the money/policy decisions (refunds, deposit-vs-full). Payments shipped; the money path is live and carries its own blast-radius rows below.
- **Crew** — captains and mates. Magic-link auth, no passwords. The crew app is deliberately small but it is **not** three screens, and some are feature-flagged, so "the crew app" means different things per deploy. Authoritative list: `ls app/\(crew\)/crew/`. The standing pressure isn't a screen count — it's whether a new thing earns a screen, because every extra screen is somewhere stale information can hide.

## Stack

**Chosen at M4 — see DEC-020.** M0–M3 are a **stack-agnostic domain core** (entities, state machine, oracle, reliability-event log) behind a **`Repository` port**; that core under `src/` stays **framework-free** and is never moved. The M4 stack wraps it:

- **Language/runtime:** Node + TypeScript (strict). Vitest (task 0.3).
- **Web framework / host:** **Next.js (App Router) on Vercel**. Next imports the core via the `@core/*` alias.
- **Build:** `npm run build` = `next build --webpack`. **Webpack, not Turbopack** — the core's NodeNext `.js` import specifiers need `extensionAlias` (`.js`→`.ts`), which Turbopack lacks (DEC-020). Two TS profiles: `tsconfig.core.json` (strict NodeNext, the core — `npm run typecheck`) and root `tsconfig.json` (Next/bundler, the app — `typecheck:app`).
- **Persistence:** **Postgres behind the `Repository` port**, **local Postgres in dev**; schema is plain Postgres DDL (DEC-DATA-1). **Hosted Postgres = Neon** (DEC-033 — see `docs/DEPLOY.md`); the port keeps it vendor-swappable. The in-memory adapter stays as the test substrate.
- **Auth:** **self-rolled magic-link in the service layer** (no auth platform) — same for admin + crew.
- **Channel (crew ask):** one port (DEC-MSG-3), many adapters — `ls src/adapters/*-channel.ts`. SMS is live in production (DEC-MSG-1); the fakes are permanent test infra.

## Core Data Model

The entities are specified in `docs/SPEC.md §2.1` onward. The types are in `src/domain/entities.ts`.

Two rules the types cannot carry: fields marked *log day one* must be real from the first commit even if nothing reads them yet (DEC-008), and a `⏳` marker is a reserved-but-inert column for Pass D (DEC-004/DEC-005) — add it now, default it dead.

## Commands

`npm run verify` is **the gate**. It chains the doc checks, both typecheck profiles, lint, test and build, so a core-only regression cannot ship behind a green app build.

**`build` alone is not the gate** — it validates the app, not the core. The rest are in `package.json`.

## Environment variables

**`env.example` is the list.** It is committed, it is the only env file that is, and it carries every variable with its default and its trap — which flag values are silently wrong, which secret dead-links customer URLs when rotated, which one is build-inlined. Read it. **Do not ask where an environment variable lives, propose creating a template, or offer to audit the environment. All three are done.**

It is the output of an audit that swept the codebase for every variable and wrote down what each one does and how it fails. That work is finished and this file is what it produced — but it was never announced anywhere a session reads, so sessions kept rediscovering the absence and offering to redo it. This paragraph is the announcement.

Two reasons a session concludes otherwise, both observed:

- **`.gitignore` treats `.env*` as secret with no exceptions (DEC-S043)**, so the template is named `env.example` with no leading dot, deliberately outside that namespace. A `ls .env*` or a grep anchored on `^\.env` cannot match it and reads as "there is no template."
- **Not every variable is read as `process.env.X`.** Helpers — `envPositiveNumber`, `envWallClock`, `flagOn` — take the name as a string argument, so a grep for the direct pattern under-reports the set by roughly a dozen.

The deployed values are in Vercel env and are **not answerable from the repo**. `env.example` tells you a variable exists and what it does; only the dashboard tells you what production is running.

## Additional Docs

Project-specific docs beyond the baseline `## Key Docs` table in the `CLAUDE.md` shell:

| File | Purpose |
|------|---------|
| `docs/BRAND.md` | Voice, visual direction, philosophy. Webapp-shaped, so it lives here rather than in the shell's Key Docs — a CLI or firmware project has no use for it. |
| `docs/USER_STORIES.md` | What each role does. Left the shell's Key Docs in seeds PR #206 for the same reason as BRAND.md. |
| `docs/DEV_REFERENCE.md` | Deploy + review reference — `<VersionTag />` wiring, the `NEXT_PUBLIC_` gotcha that silently renders `v0.0.0`, CHANGELOG format, phone PR-review notes. Also left the shell in seeds PR #206. |
| `docs/FUTURE_IDEAS.md` | The shiny-object parking lot. New ideas land here, not in the locked spec (DEC-014). |
| `docs/RUNNING.md` | How to run the app locally, see the UI (Tailscale host, magic-link dev flow), check a change. PRs link here for setup. |
| `docs/DEPLOY.md` | Go-live runbook — Vercel + Neon Postgres (Phase 5.1, DEC-033). |
| `docs/design/DESIGN-REFERENCE.md` | How to consume the UI mockups: spec wins on *what*, mockups inform *how*; **read JSX, never import**. Read before building any surface (M4). |
| `docs/design/mockups/` | Claude Design export (HTML + JSX) per surface §2.1–2.6.3. **Visual-direction reference, not spec.** |

Notes on the baseline docs: `docs/SPEC.md` is the buildable source of truth. It is **not** locked — it carried a "🔒 LOCKED v1.0" stamp for months while DEC-105, DEC-140 and others rewrote whole sections, and the stamp was removed rather than kept as a fiction. What survives is DEC-014's scope rule: new ideas go to `docs/FUTURE_IDEAS.md`, and a change to a section is a **declared amendment** — `amends_spec: [{section, scope}]` in the amending decision's frontmatter, with the pointer under that section's heading generated (DEC-143). **Decisions live one per file in `docs/decisions/DEC-*.md`** (`ls docs/decisions/DEC-*.md | wc -l` for the count — a number written here is stale the next time one lands, and this line claimed 141 for months while the tree held 157); `docs/DECISIONS.md` is the **generated** topic index over them (DEC-141). Read a decision by reading its file — `grep -rl DEC-042 docs/decisions/` resolves any id. To add or change one, edit its file and run `npm run gen:decisions`; `npm run check:decisions` runs first in `verify` and fails on a stale index, a duplicate id, a dangling reference, or a spec amendment that never landed.

## Decision Record (project) — the record shrinks; the spec grows

The shell's `## Decision Record (DEC-S036)` is the mechanism. This is the standing rule about **what belongs in which file**, added 2026-08-23 after §2.8 was written.

- **`docs/SPEC.md` holds what we are building.** `docs/decisions/` holds **why this and not the other thing**. A decision that describes how the thing works is doing the spec's job badly, in fifteen pieces, and the spec should absorb it.
- **A new decision needs a reason the spec cannot hold it.** "We made a choice" is not that reason — every line of the spec is a choice. Write one for a fork that stays live: an alternative rejected for a reason that could change, a constraint someone will otherwise re-litigate.
- **Decisions get shorter over time, not longer.** When a decision's subject is settled in the spec, cut the body and leave a signpost pointing at the section — do not append an amendment beneath text that is now wrong, because the wrong text stays greppable and gets believed. **Git holds the history**; `git log -p docs/decisions/DEC-NNN-*.md` is a better archive than an in-file one, with dates and diffs the file does not carry.
- **A file cannot simply be deleted** — `check:decisions` fails on a reference to a missing decision and every reservations decision has inbound citations from code or other decisions. The three-line signpost is how a decision dies.
- **A decision may not contain a number the customer sees.** Price, percentage, deadline, refund window, tier — if a customer could be told it, it is spec, and a decision holding it is a fact nobody maintains and everybody cites. This one is checkable, which is why it is the rule rather than a principle. It would have caught the service fee (3% of fare, inside a decision about metadata), the tip tiers, the $50 cancellation deduction, and Flex insurance's $30 / 72-hour term — every one of them a promise made to a customer, recorded where only a developer would look.

**Why this exists:** the record reached 157 files by only ever growing, because there was no §2.8 and decisions had to carry the *what* as well. That is the condition issue #565 named — reservations was structurally unauditable with no spec text to check code against. Adding to the spec is how the record gets smaller.

## Workflow Mechanisms

The shell's `## Micro Workflow` states what three steps must achieve and names a slot for how (DEC-S042). Filled below. **Slots, not overrides** — the shell states no default to correct, and nothing here cites a step *number*, because numbers move and a stale cross-reference in an always-loaded file fails silently. This section previously said "Step 5 (Write the test)" for two months after the shell renumbered.

Muster is Next.js over a framework-free domain core.

| Slot | This project |
|---|---|
| **Proof** | Vitest against the domain core (oracle, state machine, reliability log), which is heavily unit- and integration-tested. Test-first when behaviour changes. **No pgTAP** — there is no Supabase and no RLS; persistence sits behind the `Repository` port with an in-memory adapter as the test substrate. |
| **Proof command** | The relevant Vitest file or suite, not the whole thing. The full suite is my call, never automatic. |
| **Surface check** | **Every page works at 375px — eyeball it at `mill-dev:3000`** per `docs/RUNNING.md`. Playwright screenshots land when that tooling does (M4 fast-follow); until then this step is done by looking, which is exactly why it is a separate step from the proof. |

**The gate** is `npm run verify`, run by `/kill-this`.

## PR Workflow Overrides

- **Feature branches for multi-PR features (DEC-059 — overrides the shell's `## Pull Request Workflow`):** `main` must stay **promotable to `production` at all times**. A feature shipping across multiple PRs that isn't independently releasable lands on a long-lived `feature/<name>` branch off `main` — its task PRs target *that* branch — and merges to `main` only when the whole feature is prod-ready **or** dark behind a flag. Independently-shippable tasks still PR straight to `main`. The shell's "stack PRs onto `main`" guidance applies only to independently-shippable work; do **not** land partial features on `main`.

- **No open-PR ceiling (operator, 2026-08-14 — overrides the shell's "Keep ≤3 open PRs. Prefer 1.").** There is no number. Sometimes one is right, sometimes eight is, and it depends on the nature of the PRs and on what the operator is doing at the time — which is not something a constant can know. A stated cap gets quoted back as a reason to stop working, which is the opposite of useful on a day given over to building rather than reviewing. **Do not propose stopping, splitting, or sequencing work on open-PR count**; if PRs are piling up in a way that actually matters — two migrations on one table, a stack whose base keeps moving — say *that specific thing*, because that is the real constraint the number was standing in for.

## Blast-Radius Triggers

Read by `/kill-this` Step 3.5 and matched against the branch diff. On a hit the skill runs `/security-review` locally and surfaces `/code-review ultra` as the optional deeper pass. Paths, not categories — "the money path" can't be matched against a diff.

| Trigger | Paths |
|---|---|
| **Money moving** | `app/api/webhooks/stripe/`, `src/adapters/stripe-payment.ts`, `src/ports/payment.ts`, `src/reservations/create-departure-payment-intent.ts`, `src/reservations/payment-config.ts`, `src/reservations/refund-payment.ts`, `src/reservations/refund-terms.ts`, `src/reservations/cancel-reservation.ts` |
| **Money computed** | `app/(admin)/admin/payroll/**` (incl. the `gusto.csv` and `tips.csv` exports), `app/(admin)/admin/time-clock/**`, `app/(admin)/admin/shift/[shiftId]/**`, `app/(admin)/admin/shifts/**`, `app/(crew)/crew/shift/[shiftId]/**` |
| **Auth / capability URL** | `app/lib/auth.ts`, `app/lib/auth-delivery.ts`, `app/(crew)/crew/auth/`, `app/api/calendar/[token]/**`, `app/b/**`, `src/auth/**`, `src/reservations/booking-code.ts`, `src/reservations/ensure-booking-code.ts` |
| **Data-changing migration** | a file under `db/migrations/` containing `drop`, `alter … type`, `update`, or `delete`. An additive `add column` does **not** trigger |

**`refund-payment.ts` was missing until #726** — the one module in the repo that hands real money *back*, absent from a list defined as "money moving". It was caught by asking the skill's own fallback question (does a number this produces reach someone's statement?) rather than by the table, which is the failure mode a path list has: it can only name what someone thought of. When a money change doesn't match a row, add the row in the same PR.

**`refund-terms.ts` and `cancel-reservation.ts` joined at #797**, for the same reason one row up and with the same lesson: `refund-payment.ts` *moves* the money, but these two *decide the number*, and #797 was a defect entirely inside the deciding half — the moving half was correct throughout. A diff that changed only these two would have matched no row while changing what every cancelled customer is paid.

**Why the payroll exports are listed by name.** `gusto.csv` is the file that becomes a paycheck. Nothing in it looks like a payment — no provider, no charge, no amount in cents — so a trigger defined by *where money moves* would never match it. A mis-bucketed pay period or a double-counted punch upstream in `time-clock` or `shift` reaches a person's pay with no payment code anywhere in the diff.

**Not triggers:** `src/oracle/`, `src/domain/reliability.ts` (reliability scoring isn't money), messaging, UI-only work, docs, mockups, and anything under `.claude/`.

## Migration Protocol (project)

Persistence is **Postgres behind the `Repository` port**: **local Postgres in dev**, **Neon in production** (Vercel + Neon, DEC-033 — `docs/DEPLOY.md`), schema as **plain Postgres DDL** (DEC-DATA-1). The in-memory adapter is the test substrate and never goes away. The shell's universal migration *discipline* still holds: schema changes go through migration files (plain DDL here), migrations are the source of truth, never hand-patch an applied migration, and check for open PRs touching the same tables before adding one.

**Migration filenames are timestamped (DEC-121).** New migrations are `YYYYMMDDHHMMSS_name.sql` (UTC) — **never** a new `00NN_` number. Generate with `npm run db:new-migration <name>` (never hand-name one). The runner (`db/migrate.ts`) orders by filename sort and keys on the filename, so timestamps sort chronologically after every legacy `00NN_` and can't collide across branches (the fix for the long-lived `feature/reservations` vs `main` clash). One-time trap: renaming an already-applied migration re-runs its DDL — reconcile that dev DB's `_migrations` before the next `db:migrate`.

**Prod migrations are applied by hand, out-of-band** — they are *not* part of the Vercel deploy. So code on `production` can outrun the prod schema. Apply the migration to prod *before* promoting the code that needs it.

**Pre-promote check: migration-ledger drift.** `/promote-production` Step 0.5 reads this section and runs what it finds. Before any ff-merge, confirm prod has applied every migration in the repo — the procedure, the Neon project identifiers and the two failure branches are the runbook in `docs/DEPLOY.md`.

**A repo migration prod has not applied means STOP**, not "promote and apply after." That ordering is the whole point: promoting first ships code ahead of the schema, and this project applies prod migrations by hand.

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

### Docs

- **These docs carry decisions, rationale and pointers — never inventory.** A prose snapshot of current state is stale the day the code moves; a pointer (`ls src/adapters/*-channel.ts`) sends the reader to the truth and is checkable. `check:context` enforces the checkable half: cite a full path and it gets verified, a bare filename does not, and `<angle brackets>` mark a deliberate placeholder.
- **`check:docs` reads structure, never prose** (DEC-144) — DEC ids, `npm run` commands, issue-link text against its own URL, skill and agent rosters against `.claude/` in both directions, and repo paths. Historical ledgers are exempt from the path class by name and with a reason, because they cite deleted files correctly.
- **Neither gate can judge a characterization.** A sentence that is false about the code passes both. That is the failure mode these conventions exist against, and it is why a pointer beats a description.

### UI / Brand
- Tokens are harvested from the mockups into `@theme` in `app/globals.css` (DEC-021) — colors, one card radius (`--radius-card: 14px` — deliberately a single value, not a scale; see `BRAND.md`). No color for color's sake. Binding constraints live in `.claude/ui-context.md`.
- Font: IBM Plex Sans/Mono, loaded via next/font in `app/layout.tsx`.
- Layout padding in `layout.tsx` only.
- Every page works at 375px — eyeball at `mill-dev:3000` per `docs/RUNNING.md` (Playwright screenshots when that tooling lands).

### Testing
- The domain core (oracle, state machine, reliability log) is heavily unit/integration tested with Vitest. UI tests arrive with the stack tooling (M4). No pgTAP (no RLS).
- **e2e: interact with a `"use client"` island via `clickHydrated` / `selectOptionHydrated`** (`e2e/fixtures.ts`), never a bare `.click()` / `.selectOption()`. An island is server-rendered, so its controls pass every Playwright actionability check *before* React attaches a handler — the bare call then succeeds and does nothing, and the next locator waits out its full timeout (#642). A controlled `<select>` fails a second way: React reverts the selection on hydration. Plain server-form controls (`SubmitButton`, `<a>`, `<details>/<summary>`) work without JS by design and need neither.

## PR Workflow (project)

The shell's `## Pull Request Workflow` is the baseline. Muster adds:

- **Small docs / idea-parking PRs ship standalone** off `main` (own branch + PR) and are **not** logged in the session file — `## Task` blocks and `pr_numbers` are reserved for substantive, issue-closing task PRs.
- **The eyeball path** is the Vercel preview URL once deployed, else `mill-dev:3000` per `docs/RUNNING.md`. Link that file rather than re-explaining setup each PR.
- **`production` is a deploy pointer, never a PR base.** It went live with the Neon deploy (DEC-033/DEC-S022); `main` is always the active trunk.

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

The `## Blast-Radius Triggers` table above is the trigger, matched against the diff by `/kill-this` Step 3.5. Two things that table cannot say:

- **Run it once, on the PR, before merge.** It is branch-scoped, so per-commit runs pay repeatedly for the same answer.
- **A row hit is not an instruction to spend.** It is billed and launches many agents; it earns its cost where a missed defect costs more than the review — money, auth, a destructive migration. A diff you cannot hold in your head qualifies too, and that is a judgment nothing can match against a path.

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

## Median gaps

Where a competent default does the wrong thing in this repo.

| Gap | Why the default is wrong here |
|---|---|
| A green gate says nothing about whether a sentence is true | `check:context` and `check:docs` verify that cited paths and ids resolve. Neither can judge a characterization, so a doc describing code that has since changed passes both. Prefer a pointer — `ls src/adapters/*-channel.ts` — over a description, because only one of them is checkable |
| The two lead-time windows look interchangeable and are not | `XOLA_PULL_LEAD_DAYS` is how far ahead reservations are fetched; `STAFFING_HORIZON_LEAD_DAYS` is how far ahead the engine works a shift and therefore asks. Conflating them is the recurring wrong-reasoning here (DEC-080). Both are env-overridable per deploy (DEC-062) — read the constant, never quote a number from memory |
| "Money" instinct fires on payment code and misses payroll | A wrong timestamp in `time-clock`, a mis-bucketed pay period, a double-counted punch — none touch a payment provider, and all reach a person's pay. The blast-radius table lists the payroll exports by name for this reason |
| `vessel+date` does not identify a shift | Shifts split and merge, so the obvious key is not unique. A UNIQUE index or a lookup keyed that way is a defect, and it will be right until the first split day |
| Looking for the env template with `ls .env*` finds nothing | The template is `env.example`, with no leading dot, because `.gitignore` treats `.env*` as secret with no exceptions (DEC-S043). A session that greps the dotted namespace concludes there is no template and offers to write one that already exists. This happened |
| Formatting is not chained to typecheck | `npm run typecheck` is `tsc` against one profile and nothing else, and there is no `format` script at all. Chaining a formatter is the common pattern elsewhere and was added here once, unasked |
| `main` is not always PR-able here | A multi-PR feature that is not independently releasable lands on a long-lived `feature/` branch, because `main` must stay promotable to `production` at all times (DEC-059). The shell's stack-onto-`main` guidance covers independently-shippable work only |

## Workflow Notes (project)

- **`git push` exception to the shell's "environment-changing commands":** the `/kill-this` ritual owns commit + push + PR — that's its job, no separate approval needed for the push inside it.
- **`@ui-reviewer` is live** — `.claude/ui-context.md` exists and carries the brand tokens, surfaces, viewports and review checklist it hard-stops without. That file (brand tokens, surfaces, viewports, checklist) is authored with the first crew/admin surface.

## Scope Discipline (project)

Check `docs/SPEC.md` §4 *Parked* + the 2027 line before adding anything — that's the "Not V1" guardrail. New ideas go to `docs/FUTURE_IDEAS.md`, **not** the locked spec (DEC-014).

## Tone (project)

The shell's `## Tone` (dry humor) applies. Muster adds two standing principles:

- **Push back and suggest — don't just execute.** Flag landmines (security, data-integrity, scope), propose the safer option, surface real forks rather than guessing. The goal is a collaborator that keeps the calls honest, *while* holding the vertical slice and not chasing tangents (new ideas → `docs/FUTURE_IDEAS.md`, DEC-014). Pushback and slice-focus together — don't trade one for the other.
- **The repo is the system of record.** Anything load-bearing lives in `CLAUDE.md` / `.claude/CLAUDE-context.md` / `docs/` / the session files — version-controlled and visible. Auto-memory is a best-effort convenience hint, never the only home of something that matters.
