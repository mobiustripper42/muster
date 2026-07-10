# Muster — Project Context

Everything specific to **this** project. The seeds-managed `CLAUDE.md` shell reads this file at session start and treats it as authoritative for project-specific facts (DEC-S019). Nothing here syncs from seeds — it's yours to edit freely.

## What We're Building

Muster is a **crew engine** for small-passenger-vessel operators. It turns a week's reservations into discrete **shifts** (one boat, one day), works out who is legally allowed to crew each shift (USCG manning, credentials, turnaround), asks them in **reliability order**, and surfaces only the shifts the automation could not close. It is the half of an eventual Xola replacement that Xola has no concept of: Xola knows a booking is paid; Muster knows whether anyone will be standing on the dock to run it. First tenant / worked example: **BrewBoat** — a real fleet of **4 inspected party boats** (two 12-pax, one 14, one 16), **each manned by 2 crew**; zero-crew rentals are also in scope (DEC-016). Manning is per-vessel data the deriver loops (0/1/2/N), never a fixed pair. *(The old "one boat, COI 6, 1 captain + 1 mate" example was a placeholder — corrected per DEC-016.)*

The spine is a **policy/mechanism split** (DEC-001): the rules are tenant-owned data; the engine that runs them is generic.

Roles:
- **Spink** — the operator (BrewBoat's). Semi-retired; the design goal is **no babysitting**. Runs the admin app, leans on crew, makes the 11pm cancel/reschedule call.
- **Drew** — the owner. Owns the money/policy decisions (refunds, deposit-vs-full). Mostly out of the 2026 build (payments are parked).
- **Crew** — captains and mates. Their entire world is three crew-app surfaces (the ask, my shifts, the shift card). Magic-link auth, no passwords.

## Stack

**Chosen at M4 — see DEC-020.** M0–M3 are a **stack-agnostic domain core** (entities, state machine, oracle, reliability-event log) behind a **`Repository` port**; that core under `src/` stays **framework-free** and is never moved. The M4 stack wraps it:

- **Language/runtime:** Node + TypeScript (strict). Vitest (task 0.3).
- **Web framework / host:** **Next.js (App Router) on Vercel** — one app, route groups `app/(admin)` / `app/(crew)` / `app/api`. Next imports the core via the `@core/*` alias.
- **Build:** `npm run build` = `next build --webpack`. **Webpack, not Turbopack** — the core's NodeNext `.js` import specifiers need `extensionAlias` (`.js`→`.ts`), which Turbopack lacks (DEC-020). Two TS profiles: `tsconfig.core.json` (strict NodeNext, the core — `npm run typecheck`) and root `tsconfig.json` (Next/bundler, the app — `typecheck:app`).
- **Persistence:** **Postgres behind the `Repository` port**, **local Postgres in dev**; schema is plain Postgres DDL (DEC-DATA-1). **Hosted Postgres = Neon** (deployed on Vercel + Neon, DEC-033 — see `docs/DEPLOY.md`); the port keeps it vendor-swappable. The in-memory adapter stays as the test substrate.
- **Auth:** **self-rolled magic-link in the service layer** (no auth platform) — same for admin + crew.
- **Channel (crew ask):** one port (DEC-MSG-3) — **fake/log adapter** (permanent test infra) + **pilot seam** (web-link or Telegram, operator picks later). **Twilio/SMS** = later swap (DEC-MSG-1); **native/Capacitor** = post-slice fast-follow (DEC-MSG-2).
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
| `npm run verify` | **the gate** — `typecheck` + `typecheck:app` + `test` + `build`, in order |
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
| `docs/FUTURE_IDEAS.md` | The shiny-object parking lot. New ideas land here, not in the locked spec (DEC-014). |
| `docs/ask-timing-research.md` | One-page record of the 2026-07 ask-timing deep-research pass — findings, the "did we nail it" scorecard, and the tweaks it produced (horizon 7→5, DEC-097/098). Read before revisiting ask send-timing. |
| `docs/RUNNING.md` | How to run the app locally, see the UI (Tailscale host, magic-link dev flow), check a change. PRs link here for setup. |
| `docs/DEPLOY.md` | Go-live runbook — Vercel + Neon Postgres (Phase 5.1, DEC-033). |
| `docs/E2E-PILOT-WALKTHROUGH.md` | Click-by-click acceptance test of the whole first slice — the crew engine end to end. |
| `docs/OPERATOR_MANUAL.md` | Task-oriented operator (Spink) manual + flow/state diagrams — the human-facing translation of SPEC/DECISIONS. Centerpiece: "empty board = success" (#68). |
| `docs/PILOT_RUNBOOK.md` | One-page operational sequence for running a real crew weekend on the hosted pilot (seed→import→tick→outbox→triage); carries #70's pilot-only-not-production warning (5.R / #78). |
| `docs/design/DESIGN-REFERENCE.md` | How to consume the UI mockups: spec wins on *what*, mockups inform *how*; **read JSX, never import**. Read before building any surface (M4). |
| `docs/design/mockups/` | Claude Design export (HTML + JSX) per surface §2.1–2.6.3. **Visual-direction reference, not spec.** |

Notes on the baseline docs: `docs/SPEC.md` is 🔒 **LOCKED v1.0** — the buildable source of truth; edits are corrections only (DEC-014). `docs/DECISIONS.md` carries DEC-001–012 (extracted from the spec), 013–014 (setup), and the M4 / DATA / MSG / ROLE / 033 series referenced throughout this file.

## Workflow Overrides

Overrides to the shell's `## Micro Workflow`. Muster's stack is Next.js over a framework-free domain core, **not** the shell's default Supabase/Playwright shape:

- **The gate is `npm run verify`** (typecheck + typecheck:app + test + build), not a Playwright run. `/kill-this` and `/pause-this` run it.
- **Step 5 (Write the test):** Vitest against the domain core (oracle, state machine, reliability log) — heavily unit/integration tested. Test-first when behavior changes. **No pgTAP** — there's no Supabase/RLS; persistence is plain Postgres behind the `Repository` port with an in-memory adapter as the test substrate.
- **Step 6 (Run targeted tests):** the relevant Vitest file/suite, not the whole thing. Full suite is the user's call.
- **Step 7 (Mobile screenshot):** Playwright screenshots land when that tooling does (M4 fast-follow). Until then, **every page works at 375px — eyeball at `mill-dev:3000`** per `docs/RUNNING.md`.
- **Feature branches for multi-PR features (DEC-059 — overrides the shell's `## PR Workflow`):** `main` must stay **promotable to `production` at all times**. A feature shipping across multiple PRs that isn't independently releasable lands on a long-lived `feature/<name>` branch off `main` — its task PRs target *that* branch — and merges to `main` only when the whole feature is prod-ready **or** dark behind a flag. Independently-shippable tasks still PR straight to `main`. The shell's "stack PRs onto `main`" guidance applies only to independently-shippable work; do **not** land partial features on `main`.

## Migration Protocol (project)

**No Supabase** — the shell's Supabase toolchain, `safe-supabase.sh` prod-write guard (DEC-S009), and Supabase↔Vercel env-var sync are all **N/A**.

Persistence is **Postgres behind the `Repository` port**: **local Postgres in dev**, **Neon in production** (Vercel + Neon, DEC-033 — `docs/DEPLOY.md`), schema as **plain Postgres DDL** (DEC-DATA-1). The in-memory adapter is the test substrate and never goes away. The shell's universal migration *discipline* still holds: schema changes go through migration files (plain DDL here), migrations are the source of truth, never hand-patch an applied migration, and check for open PRs touching the same tables before adding one.

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
- Feature components in `components/[feature]/`. Keep components under 200 lines; split if larger.

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
- Tokens are harvested from the mockups into `@theme` in `app/globals.css` (DEC-021) — colors, radius scale (`--radius-card: 14px`). No color for color's sake. Binding constraints live in `.claude/ui-context.md`.
- Font: IBM Plex Sans/Mono, loaded via next/font in `app/layout.tsx`.
- Layout padding in `layout.tsx` only.
- Every page works at 375px — eyeball at `mill-dev:3000` per `docs/RUNNING.md` (Playwright screenshots when that tooling lands).

### Testing
- The domain core (oracle, state machine, reliability log) is heavily unit/integration tested with Vitest. UI tests arrive with the stack tooling (M4). No pgTAP (no RLS).

## PR Workflow (project)

The shell's `## PR Workflow` is the baseline. Muster adds:

- **Small docs / idea-parking PRs ship standalone** off `main` (own branch + PR) and are **not** logged in the session file — `## Task` blocks + `pr_numbers` are reserved for substantive, issue-closing task PRs.
- **PR / task test plans split two things:** *Verified (automated)* — what was already run (`npm run verify`, tests, CI, smoke) — from a short *Eyeball-it-yourself (human)* list of what the reviewer still needs to look at (UI surfaces, anything no test covers). The stable local-run recipe lives in `docs/RUNNING.md` — link it, don't re-explain setup each PR.
- **Eyeball steps must be executable and observable.** Each step is a copy-pasteable command that exists in the repo **today** (a step needing missing tooling → build the tooling in the same PR or cut the step) or a tap on what a prior step produced, ending with the literal expected sight ("green success card", not "verify it works"). Numbered, one line each. Claude verifies what it can before the PR; what's visually unverified is **labeled, not dressed up as a step**.
- **`production` branch + `/promote-production` are live as of the Neon deploy** (DEC-033/DEC-S022). `main` is always the active trunk; `production` is only the downstream deploy pointer, never a PR base.
- The shell's *PR Review on Mobile* notes apply, with muster's substitutions: the eyeball path is the Vercel preview URL once deployed (else `mill-dev:3000`); the PR checklist asks "schema/DDL change?" rather than "migration/RLS change?".

## Versioning (project)

Follows the shell. SemVer in `package.json` (created at task 0.3), tag on `main`, bumps only at `/retro`. The `<VersionTag />` component is **available but not yet wired** — pull `templates/VersionTag.tsx` from seeds into a layout when a deployed build needs the stamp; until then the version lives in `package.json` + git tags.

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
- **`@ui-reviewer` is installed but inert until `.claude/ui-context.md` exists** — it hard-stops without it. That file (brand tokens, surfaces, viewports, checklist) is authored with the first crew/admin surface.

## Scope Discipline (project)

Check `docs/SPEC.md` §4 *Parked* + the 2027 line before adding anything — that's the "Not V1" guardrail. New ideas go to `docs/FUTURE_IDEAS.md`, **not** the locked spec (DEC-014).

## Model Selection (project override)

The shell's `## Model Selection` is the standing policy (Opus 4.8 default, Sonnet for cheap/scoped work). **Fable is disabled (seeds DEC-S029)**, so muster's prior "architect on the frontier tier" override collapses to:
- **`@architect` runs `claude-opus-4-8`** (`.claude/agents/architect.md` frontmatter is authoritative) — architecture decisions (the oracle) are where being wrong compounds, so they get the standing top tier. Revisit pinning it back to the frontier if/when Fable is re-enabled.
- **`@ui-reviewer` stays Sonnet** but is worth bumping to Opus 4.8 for vision-heavy mockup-vs-build review (`docs/design/mockups/*.jsx`).

Everything else follows the shell unchanged.

## Tone (project)

The shell's `## Tone` (dry humor) applies. Muster adds two standing principles:

- **Push back and suggest — don't just execute.** Flag landmines (security, data-integrity, scope), propose the safer option, surface real forks rather than guessing. The goal is a collaborator that keeps the calls honest, *while* holding the vertical slice and not chasing tangents (new ideas → `docs/FUTURE_IDEAS.md`, DEC-014). Pushback and slice-focus together — don't trade one for the other.
- **The repo is the system of record.** Anything load-bearing lives in `CLAUDE.md` / `.claude/CLAUDE-context.md` / `docs/` / the session files — version-controlled and visible. Auto-memory is a best-effort convenience hint, never the only home of something that matters.
