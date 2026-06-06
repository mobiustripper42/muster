# Muster — Claude Code Project Context

## What We're Building

Muster is a **crew engine** for small-passenger-vessel operators. It turns a week's reservations
into discrete **shifts** (one boat, one day), works out who is legally allowed to crew each shift
(USCG manning, credentials, turnaround), asks them in **reliability order**, and surfaces only the
shifts the automation could not close. It is the half of an eventual Xola replacement that Xola has
no concept of: Xola knows a booking is paid; Muster knows whether anyone will be standing on the
dock to run it. First tenant / worked example: **BrewBoat** — a real fleet of **4 inspected party
boats** (two 12-pax, one 14, one 16), **each manned by 2 crew**; zero-crew rentals are also in scope
(DEC-016). Manning is per-vessel data the deriver loops (0/1/2/N), never a fixed pair. *(The old
"one boat, COI 6, 1 captain + 1 mate" example was a placeholder — corrected per DEC-016.)*

The spine is a **policy/mechanism split** (DEC-001): the rules are tenant-owned data; the engine
that runs them is generic.

Roles:
- **Spink** — the operator (BrewBoat's). Semi-retired; the design goal is **no babysitting**. Runs
  the admin app, leans on crew, makes the 11pm cancel/reschedule call.
- **Drew** — the owner. Owns the money/policy decisions (refunds, deposit-vs-full). Mostly out of
  the 2026 build (payments are parked).
- **Crew** — captains and mates. Their entire world is three crew-app surfaces (the ask, my shifts,
  the shift card). Magic-link auth, no passwords.

## Stack

**Chosen at M4 — see DEC-020.** M0–M3 are a **stack-agnostic domain core** (entities, state machine,
oracle, reliability-event log) behind a **`Repository` port**; that core under `src/` stays
**framework-free** and is never moved. The M4 stack wraps it:

- **Language/runtime:** Node + TypeScript (strict). Vitest (task 0.3).
- **Web framework / host:** **Next.js (App Router) on Vercel** — one app, route groups
  `app/(admin)` / `app/(crew)` / `app/api`. Next imports the core via the `@core/*` alias.
- **Build:** `npm run build` = `next build --webpack`. **Webpack, not Turbopack** — the core's
  NodeNext `.js` import specifiers need `extensionAlias` (`.js`→`.ts`), which Turbopack lacks
  (DEC-020). Two TS profiles: `tsconfig.core.json` (strict NodeNext, the core — `npm run typecheck`)
  and root `tsconfig.json` (Next/bundler, the app — `next build` / `typecheck:app`).
- **Persistence:** **Postgres behind the port**, **local Postgres in dev**; schema is plain Postgres
  DDL (DEC-DATA-1). **Hosted provider deferred to deploy, vendor-agnostic — Supabase is a candidate
  host, not adopted.** In-memory adapter stays as the test substrate.
- **Auth:** **self-rolled magic-link in the service layer** (no auth platform) — same for admin + crew.
- **Channel (crew ask):** one port (DEC-MSG-3) — **fake/log adapter** (permanent test infra) +
  **pilot seam** (web-link or Telegram, operator picks later). **Twilio/SMS** = later swap
  (DEC-MSG-1); **native/Capacitor** = post-slice fast-follow (DEC-MSG-2).
- **`.claude/project-type`** is `webapp` (flipped at M4); `@ui-reviewer` re-enabled via `/pull-seeds`.

## Commands

The per-task gate (run by `/kill-this`, `/pause-this`) is **`npm run verify`** — it chains the full
check so a core-only regression can't ship behind a green app build:

| Command | Covers |
|---------|--------|
| `npm run verify` | **the gate** — `typecheck` + `typecheck:app` + `test` + `build`, in order |
| `npm run typecheck` | domain core only (`tsconfig.core.json`, strict NodeNext) |
| `npm run typecheck:app` | Next app only (`tsconfig.json`, bundler) |
| `npm run test` | Vitest (domain core) |
| `npm run build` | `next build --webpack` (app; **webpack required** — DEC-020) |
| `npm run dev` | `next dev --webpack` |

`build` alone is **not** the gate — it validates the app, not the core. Use `verify`.

## Key Docs
| File | Purpose |
|------|-------|
| `docs/SPEC.md` | 🔒 **LOCKED v1.0** — the buildable source of truth. Scope, surfaces, substrate. Edits are corrections only (DEC-014). |
| `docs/FUTURE_IDEAS.md` | The shiny-object parking lot. New ideas land here, not in the locked spec (DEC-014). |
| `docs/DECISIONS.md` | Architectural decisions (DEC-NNN). DEC-001–012 extracted from the spec; 013–014 from setup. |
| `docs/PROJECT_PLAN.md` | Phases, tasks, velocity. **Phase-boundary doc** — read at planning, written at retro. Current-phase tasks live in GitHub Issues. |
| `docs/RETROSPECTIVES.md` | Phase-end retrospectives — written by `/retro` |
| `docs/AGENTS.md` | Agent and skill specs (canonical) |
| `docs/USER_STORIES.md` | What each role does |
| `docs/BRAND.md` | Voice, visual direction, philosophy |
| `docs/design/DESIGN-REFERENCE.md` | How to consume the UI mockups: spec wins on *what*, mockups inform *how*; **read JSX, never import**. Read before building any surface (M4). |
| `docs/design/mockups/` | Claude Design export (HTML + JSX) per surface §2.1–2.6.3. **Visual-direction reference, not spec** — staged for M4 UI build. |
| `docs/VELOCITY_AND_POKER_GUIDE.md` | Estimation methodology |
| `docs/CHEATSHEET.md` | One-page printable skill reference |
| `sessions/*.md` (orphan `sessions` branch via `.sessions-worktree/`) | Per-session files — `YYYY-MM-DD-HHMM-<dev>-<slug>.md` |
| `.claude/seeds-version` | Schema version this project was installed at (`4`). Gates `/pull-seeds`. |
| `.claude/project-type` | `webapp` (flipped from `tool` at M4 — DEC-020). Gates template files via `@sync-config` (DEC-011). |

## Core Data Model

From SPEC §2.1–2.6 / build plan §2. Stack-agnostic entities; fields marked **(log day one)** must
be real from the first commit even if nothing reads them yet (DEC-008).

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

⏳ = reserved-but-not-implemented field for Pass D (progressive commitment). Add the column now;
default it inert. See DEC-004/DEC-005.

## Micro Workflow (every task, no exceptions)

1. **Spec it** — poker estimate, acceptance criteria. Issue exists from `/start-phase`.
2. **Plan it** — summarize the approach. Wait for explicit approval before writing code or running
   commands (see Approval Before Action).
3. **Cut the branch** — once approved: `git checkout -b task/X.Y-short-description`.
4. **Build it.**
5. **Write the test** — against the chosen test runner (set at 0.3). Test-first when behavior
   changes. The domain core (oracle, state machine, reliability log) is heavily unit/integration
   tested; UI tests arrive with the stack at M4.
6. **Run targeted tests** — the relevant file/suite, not the whole thing.
7. **Ship the task** — `/kill-this` commits, pushes, opens a PR with `closes #<issue>`, runs
   @code-review, appends a `## Task <N>` block to the session file. Run per task.
8. **Pick up another task or close out** — new branch, or `/its-dead` once at the end of the window.

**No test, no push.** Full suites are never run automatically — ask first.

> Webapp specifics — Supabase migration protocol, pgTAP/Playwright/375px screenshots, the
> `<VersionTag />` component — **land at M4** with the stack. Don't import them into the
> domain-core phases. (Seeds' webapp CLAUDE.md sections were intentionally not copied here per
> DEC-013; pull them in via `/pull-seeds` or by hand when the stack is chosen.)

## Session Skills

| Skill | When | What |
|-------|------|------|
| `/its-alive` | Session start | Open per-session file on orphan `sessions` branch, capture transcript, read context, recommend task |
| `/pause-this` | Mid-session break | Build check, commit WIP on task branch, note pause |
| `/restart-this` | Resume from pause | Reload context, continue same session |
| `/kill-this` | **Per task** | Build check, commit, push, open PR, @code-review, append `## Task <N>` block. N× per session |
| `/its-dead` | Session end (once per window) | Stamp `ended:`, tally points, display wall_clock, close session file |
| `/start-phase` | Phase boundary (start) | Materialize phase as Issues with `phase:N`, `points:X` labels |
| `/retro` | Phase boundary (end) | Per-session time math, phase velocity, mark `[x]`, write retro, version bumps |
| `/bump-major` | Breaking change | Major bump + CHANGELOG + tag on `main`. Needs `package.json` |
| `/promote-production` | Ship to prod | ff-merge `main` → `production`. **M4+ only** (no `production` branch yet) |
| `/push-seeds` | After workflow improvements | Backport to seeds via @sync-config |
| `/pull-seeds` | After seeds improves | Pull template changes — schema-version-gated |
| `/read-the-tape` | After a notable session | Audit JSONL for anti-patterns |
| `/doc-consistency-check` | Docs drift / phase boundary | Cross-reference claims across docs. Report-only |

**Dev identity:** `~/.claude/devname` (one-line handle, e.g. `eric`). Set once per machine.

**Task model:** PROJECT_PLAN.md read at planning, written at retro. Current-phase tasks are GitHub
Issues. A phase ends when its issues close.

## Agents

| Agent | Model | When | Purpose |
|-------|-------|------|-------|
| @architect | Opus | Before design decisions, new deps, scope creep, **any DEC-TBD** | Coherence vs SPEC + DECISIONS |
| @code-review | Sonnet | After every commit (wired into `/kill-this`) | Catch issues early |
| @pm | Sonnet | Start/end of sessions | Track progress, flag risks |
| @sync-config | Sonnet | `/push-seeds`, `/pull-seeds` | Classify template-vs-project diffs |
| @tape-reader | Sonnet | `/read-the-tape` | Audit session JSONL for anti-patterns |
| @doc-consistency | Sonnet | `/doc-consistency-check` | Cross-reference doc claims. Report-only |
| @ui-reviewer | Sonnet | After UI work, phase boundaries | Design-quality review (webapp) |

> `@ui-reviewer` is **installed** (M4, `/pull-seeds`) but **inert until `.claude/ui-context.md`
> exists** — it hard-stops without it. That context file (brand tokens, surfaces, viewports, the
> review checklist) is authored with the first crew/admin surface (1.5b/#12); the reviewer earns its
> keep once there's UI to review.

## Model Selection
- Main session: Sonnet by default; switch to Opus when stuck or doing architecture (the oracle).
- Agents: model per frontmatter. New agents default to Sonnet; `model: opus` only for
  architecture-level agents.

## PR Workflow
- Each task gets a branch: `task/X.Y-short-description`.
- Issues carry `phase:N` labels (from `/start-phase`); PR title references `closes #N`.
- `/kill-this` opens the PR. Keep ≤3 open PRs; prefer 1.
- Stacking PRs is preferred when tasks depend on each other — branch the next task off the previous
  task branch.
- **Never rebase a task branch that already has commits on origin** — use GitHub's "Update branch".
- `production` branch + `/promote-production` are **M4+** (DEC-013/DEC-022). **Adopt** when the first
  hosted deploy lands: branch `production` off `main` at the release commit, push, then
  `/promote-production` ff-merges `main`→`production` per release. **Remove** (delete the branch) if
  the deploy model changes — `main` is always the active trunk (DEC-022); `production` is only a
  downstream deploy pointer, never a PR base.

## Versioning
SemVer in `package.json` (created at task 0.3), mirrored to a git tag (`vX.Y.Z`) on `main`. `/retro`
is the sole place bumps happen: patch per merged PR + minor at phase close; `/bump-major` is manual.

**CHANGELOG.md** — `/retro` and `/bump-major` append entries (Keep-a-Changelog style: Added /
Changed / Fixed under each version). The human-readable companion to the git tags.

The `<VersionTag />` component (Next/Vercel build-stamp) is **available but not yet wired** — pull
`templates/VersionTag.tsx` from seeds and add it to a layout when a deployed build needs the stamp.
Until then the tag lives only in `package.json` + git. Skills no-op silently until `package.json`
exists.

## Scope Discipline
Check `docs/SPEC.md` §4 *Parked* + the 2027 line before adding anything — that's the "Not V1"
guardrail. New ideas go to `docs/FUTURE_IDEAS.md`, **not** the locked spec (DEC-014).

If a task feels bigger than its estimate: stop, re-estimate, update PROJECT_PLAN at the next phase
boundary (or via Issue mid-phase). If it's now a 13, break it down.

## Approval Before Action (all tasks)
For every task — explain the plan and wait for approval before doing anything:
1. State what files you'll create or modify and why.
2. List commands you'll run — especially commits, pushes, installs, anything touching production.
3. Wait for "go", "do it", or equivalent.
4. Do not edit files or run commands until approved.

## Bug Reports & Questions
1. Explain the cause and your proposed fix.
2. Wait for approval before changing anything.

## Tone
Occasional dry humor and sarcasm welcome. One good line beats three forced ones.

## Response Length
Default to the shortest response that fully answers — usually 2–5 sentences. No preamble, no
restating the question, no reflexive offers to help further. Offer concrete follow-ups only when
they'd save a round-trip. Be meticulous; skip disclaimers.

## Verbosity

End-of-turn summaries: one or two sentences. What changed, what's next. Stop there.

Do not recap work I just watched you do. Do not restate the task. Do not explain why an obvious step was obvious. The summary exists so I can re-enter context next session — not so you can demonstrate effort.

If a turn ends with a tidy bullet list followed by three paragraphs of prose, the prose is wrong. Delete it.

Mid-session updates: one sentence per state change. "Found X." "Switching to Y." "Build green." Not a paragraph.

This rule applies double at session end. The session-summary block is the first thing I read next session — make it dense, not voluminous. Five bullets of work and a wall of text means I cannot actually use the summary. Cut the wall.

## Cost and Waste

Never minimize cost. Banned phrasings include but are not limited to:
- "essentially zero"
- "negligible"
- "only a few cents"
- "just X dollars"
- "a rounding error"
- "not a big deal"
- "don't worry about it"

If you find yourself reaching for one, stop. Any synonym counts. If the function of the phrase is to minimize, it's banned.

It's my money. Willing-to-spend is not the same as willing-to-spend-flippantly. Treat every cost as real, including small ones. Same rule for compute, API calls, third-party services, and dependencies — anything that consumes resources I'm paying for.

Waste of any kind — food thrown out, hours lost, a bad batch, a bricked migration, an over-provisioned instance, a wrong dependency pulled — is a fact, not a problem to console me about. When I tell you something had to be discarded, do not reassure me it's fine. Acknowledge it and move on.

If you catch yourself about to write a reassurance, just don't. The fact is the fact.
