# Claude Code — Workflow Shell

> **Read `.claude/CLAUDE-context.md` first.** It holds this project's name, stack, data model, commands, and any project-specific overrides to the workflow below. Treat it as authoritative for every project-specific fact. If it does not exist, stop and tell the user to create it from jig's `scaffold/claude/CLAUDE-context.md`.
>
> Nothing project-specific goes in this file — it is replaced wholesale on the next update, and anything added here is lost.

## Key Docs

| File | Purpose |
|------|---------|
| `docs/SPEC.md` | What we're building — scope, V1 vs V2 vs V3 |
| `docs/decisions/` | Why each choice was made — one decision, one file |
| `docs/DECISIONS.md` | **Generated** index. Never edit by hand |
| `docs/PROJECT_PLAN.md` | Phases and scope. Read at planning, written at retro; current tasks are GitHub Issues |
| `docs/RETROSPECTIVES.md` | Written by `/retro` |
| `docs/AGENTS.md` | Agent and skill specs |
| `docs/VELOCITY_AND_POKER_GUIDE.md` | Estimation methodology |
| `sessions/*.md` | Per-session files, `YYYY-MM-DD-HHMM-<slug>.md`, on the orphan `sessions` branch via `.sessions-worktree/` |
| `.claude/jig-version` | Which generation this project was installed at. Compare against jig's `jig-version` to see what migrations are owed |

Project-specific docs are listed in `.claude/CLAUDE-context.md` under `## Additional Docs`. The shell names only docs every project has; naming one a whole project type lacks is a dead reference in every one of them.

## Micro Workflow (every task, no exceptions)

1. **Spec it** — poker estimate + acceptance criteria. Pin what "done" looks like before writing code: enumerate the concrete set from source and confirm it. Live words override prior docs. **Get the whole spec down before step 4** — the model does its best work on a complete brief in one turn, not one assembled across a dozen exchanges.
2. **Plan it** — summarize what you're going to do. Wait for explicit approval.
3. **Cut the branch** — `git checkout -b task/X.Y-short-description`.
4. **Prove it first** — when behaviour changes, the check comes before the change: write it, run it, watch it fail *for the reason you expect*. That failure is what proves the check bites; one written afterwards has never been observed failing, so it may assert nothing. The check must exercise the thing in its own title — a test named for one thing that calls another turns an unverified claim into an apparently-verified one. **What counts as a check: the `Proof` slot in `.claude/CLAUDE-context.md` § Workflow Mechanisms.**
5. **Build it** — until it passes. Writing code first and then reconstructing the proof by deleting it to watch the test fail is step 4 the long way round.
6. **Run the proof** — the checks covering what you touched, not the whole suite. **The test is coverage, not confidence:** if the checks you ran exercise the files you changed, that is the whole proof. Running everything again *because you are about to hand back* is the banned case, and the one that actually happens — "I'm finishing" feels like a reason and isn't. If a change plausibly reaches code you can't name, say so and ask. **Command: the `Proof command` slot.**
7. **Check the surface** — confirm the change is right where a person meets it, which a passing check does not tell you. **How: the `Surface check` slot.**
8. **Stop. The task is built, not shipped.** Report what changed and what passes, then **stop and wait**. Do not commit, push, open a pull request, or start the next task. This is where the work gets looked at. Waiting is the correct end of a build turn — including when everything is green and the next task is obvious. Handing back *is* the finished state.
9. **`/kill-this` — the user invokes it, you don't.** It commits, pushes, runs `@code-review`, opens the pull request with `closes #<issue>`, and appends a `## Task <N>` block to the session file. **Reaching the same end state by hand is never acceptable** — a hand-typed `git push` + `gh pr create` produces a pull request that looks identical and has never been read by `@code-review`, and that absence announces itself to nobody. If you believe a task is ready, say so and stop.
10. **Pick up another task or close out** — step 1 with a new branch, or `/its-dead` once at the end of the window. Merge pull requests whenever.

**No proof, no push.**

**Steps 4, 6 and 7 name a slot, not a tool.** The shell says what the step must achieve; the context file says how it's done here. Slots are filled, not overridden. Nothing cites a step *number* — numbers move, and a stale cross-reference in an always-loaded file fails silently.

**An unfilled slot is a real answer and must be written as one.** `Surface check: none — no human-facing surface` is checkable. Blank is not.

## Migration Protocol

- **All schema changes go through migrations.** Migrations are the source of truth — never edit schema through a dashboard, never hand-patch an applied migration.
- **Before creating one:** check for open pull requests touching the same tables (`gh pr list`). If they overlap, merge first or rename to a later timestamp.

Toolchain specifics live in `.claude/CLAUDE-context.md` under `## Migration Protocol (project)`. Projects without a database mark it `N/A` there.

## Conventions

Project coding conventions — typing, structure, data fetching, auth, error handling, naming, testing layout — are stack-specific and live in `.claude/CLAUDE-context.md` under `## Conventions`.

## Decision Record

**One decision, one file**, at `docs/decisions/DEC-<id>-<slug>.md`. `docs/DECISIONS.md` is generated. `npm run check:decisions` fails on a stale index, duplicate id, unknown topic, dangling reference, oversized record, missing `revisit_if`, or a declared spec amendment that never landed — so the shape of a record is enforced, not remembered, and this section does not restate it.

Two things the gate cannot check, which is why they are here:

**Search before you write, every time.** Name the subject, run `grep -rli "<subject>" docs/decisions/`, and **say what came back** in the pull request — *"returned DEC-<id>; this supersedes it"*, or *"nothing on rate limiting; new id."* That sentence is the whole control: a session that would have to write "DEC-<id> covers deposits and this is not that" cannot do it when it's false.

**A change of mind is a new record, not an edit to the old one** (DEC-J004). The new record carries `supersedes: [DEC-<id>]`; the old one flips to `status: superseded`. Amending in place is retired — records grow, the cap is 2,000 bytes, and the carve-out that let amendments escape it also let a record quoting the convention escape every other rule. Two decisions that merely relate carry a plain **see also**.

**Records written before schema v1 are frozen**, listed by fingerprint in `docs/decisions-baseline.txt`. Editing one fails the build; the fix is to convert it to v1, splitting it if it turns out to be several decisions. The list is generated once at adoption by `scripts/gen-decisions-baseline.mjs` and never regenerated.

**Don't cite a decision you only saw in the index.** The index carries titles, not holdings.

## Session Skills

| Skill | When | What |
|-------|------|------|
| `/its-alive` | Session start | Open the per-session file, read context, recommend a task |
| `/kill-this` | **Per task** | Build check, commit, open a pull request, append `## Task <N>`. Run once per task |
| `/its-dead` | Session end (once) | Stamp `ended:`, tally points, close the session file |
| `/start-phase` | Phase start | Materialize the phase as Issues with `phase:N`, `points:X` |
| `/retro` | Phase end | Throughput (points per calendar week) + estimate calibration from GitHub issue dates and `points:N` labels. No transcript is read. Marks `[x]`, writes the retro, runs version bumps |
| `/bump-major` | Breaking change | Major bump, CHANGELOG entry, tag on `main` |
| `/promote-production` | Ship | ff-merge `main` → `production`, push. Projects with that branch only |

**Task model:** PROJECT_PLAN.md is read at planning and written at retro, untouched mid-phase. Current tasks are GitHub Issues. The phase ends when its issues close.

**Workflow fixes don't get made here.** A skill or shared agent that misbehaves in this project is not fixed in this project — those files are canonical in jig, nothing syncs in either direction, and a local fix becomes invisible drift in a file meant to be identical everywhere. Say what broke; fixing it is a deliberate act in jig.

## Agents

| Agent | Model | When | Purpose |
|-------|-------|------|---------|
| @architect | Opus 5 | Before design decisions, new dependencies, scope creep | Coherence vs SPEC + decisions |
| @code-review | Sonnet | After every commit (wired into `/kill-this`) | Catch issues early |
| @pm | Sonnet | Session start/end via skills | Progress, risks |
| @ui-reviewer | Sonnet | After interface work, phase boundaries | Design quality |

## Model Selection

Default to the cheapest model that does the job. **Opus 5 is the standing model** for development and architecture; **Sonnet** handles cheap, scoped work. **Fable is rarely worth it** — on agentic coding at `max` effort Opus 5 lands within half a percent of Fable's peak at half the cost, so the frontier tier is a narrow exception, not an escalation path.

| Tier | Model | $/MTok (in/out) | Use for |
|------|-------|-----------------|---------|
| Cheap | `claude-sonnet-5` | $3 / $15 | Trivial or scoped agents and reviews |
| Default | `claude-opus-5` | $5 / $25 | Development and architecture. Most work |
| Frontier (rare) | `claude-fable-5` | $10 / $50 | Only after Opus 5 at `max` has actually failed |

- **Spec it fully, then let it run.** Opus 5's edge is largest on long, coherent, multi-file work handed the complete specification in one turn. Assembling it across turns costs quality and tokens both. This is what makes step 1 load-bearing rather than ceremonial.
- **`effort` is the primary lever, and it sweeps down.** It buys quality more cheaply than a model jump. Start at `xhigh` for coding and `high` elsewhere, then **try lower** — `low` and `medium` are unusually strong on Opus 5, and effort is what spends the allowance. `max` only when correctness must beat cost.
- **Fast mode** runs ~2.5× faster at 2× the price. A deliberate choice for a specific impatience, never a default.
- **Agents:** model in frontmatter. `@architect` is Opus 5; reviewers stay Sonnet. New agents default to Sonnet.

## Pull Request Workflow

- One branch per task: `task/X.Y-short-description`. Pull request title references the issue: `closes #N`.
- `/kill-this` opens the pull request. Self-merge after review unless a stakeholder needs to look.
- Keep ≤3 open pull requests. Prefer 1.
- Never two open pull requests with migrations on the same table.
- **Stacking is preferred** when tasks depend on each other — branch the next task off the previous task branch, not off `main`. Only wait for a merge when there's a migration conflict.
- **Never rebase a task branch that already has commits on origin.** If `main` advanced, leave it — GitHub's "Update branch" handles it at merge. Rebasing rewrites remote history and needs a force-push.

### Production branch

`main` is the always-active trunk; every task PRs into it. Deployable projects add a `production` branch — a deploy pointer the host watches, never a pull request base. Ship with `/promote-production`, which ff-merges and pushes.

Adopting one: `git checkout -b production main && git push -u origin production`, then repoint the host **before** `main` takes active work, or unfinished work auto-deploys to production.

## Versioning

Every dev project carries a SemVer version in `package.json`, mirrored to a git tag on `main`.

- **Patch** — `/promote-production` on each ship, or `/retro` per merged pull request on projects that deploy straight off `main`.
- **Minor** — `/retro` at phase close.
- **Major** — `/bump-major`, with a rationale supplied.

All tags land on `main` at bump time; `production` only ever receives an already-tagged commit. The skills gate on `package.json` having a `version` field and no-op silently without one — the field rather than the file, because "has a `package.json`" was only ever a proxy for "is a versioned thing", and the two came apart the first time a repo wanted a test runner without a version.

## Workflow Notes

- **Diagnostic commands** (build, lint, typecheck, test): run them directly.
- **Environment-changing commands** (installs, migrations, pushes, deploys): output them for the user to run — **except where a skill owns the action.** Invoking a skill is the approval for the pushes inside its own ritual: `/its-alive` bootstrapping the `sessions` branch, `/kill-this` pushing the task branch and opening the pull request, `/promote-production` pushing the ff-merge. A skill that stops to ask permission for the push it exists to perform has not run. Anything outside a skill's own ritual is still yours.
- **On a surprise or mismatch, reconcile before diagnosing.** Pin the assumption and the environment first — dev vs prod, which database, is the server even up. One environmental check beats a multi-step debug built on an unchecked premise.
- **A denied command is a decision, not a syntax error.** Re-issuing the same intent in a new shell shape is routing around the answer. Once is a fair guess; twice on materially the same command, stop and ask what the denial means.
- **A scripted edit must fail loudly when its anchor doesn't match — and a one-line `sed -i` is a scripted edit.** That clause is not padding: one session wrote a `python3` script with `assert n == 1`, correctly, and ninety minutes later ran a bare `sed -i` with no check at all. The rule reads as being about *scripts*, and a one-liner doesn't feel like one. Assert the match count per file and exit non-zero on zero matches, or "done" means the script ran, not that the change landed — and the file it silently skipped looks reviewed.
- **Read files with the Read tool.** `grep` to *search* across files is fine; the banned shape is extracting a section from one file whose path you already know.
- **Don't guess a third-party service's shapes** from naming or a 403/404 — stop and ask for the docs. Never write code against a guess.
- **Never write a bare `#N`.** Say `issue #699` or `pull request #707`. GitHub draws both from one shared counter, so the sequences interleave and nothing in the number tells you which. The exception is `closes #N` in a pull request body, which is syntax.
- **Context docs carry decisions, rationale and pointers — never inventory.** These files load as ground truth, so a stale sentence is believed rather than checked. Rationale doesn't rot; a snapshot of current state is stale the day the code moves, and no doc audit catches it, because the claim is false against **code** — the corpus doc sweeps never read. Write a pointer instead: `ls <dir>/*-channel.ts` sends the reader to the truth and is checkable. `check:context` asserts every path and glob these files cite still resolves; it cannot judge a characterization.
  - **An env-overridable number is not a fact a repo can state.** Cite where the constant is defined and say the deployed value lives in the host's env.
  - **Before asserting what is built or live, check the code in the same turn.** One session read "text messaging = later swap" from a context file, filed an issue declaring a feature blocked on an adapter that had shipped weeks earlier, and explained the blockage at length.
  - **It binds hardest on anything outside this checkout** — a sibling repo, another project's decisions, a machine's config. That is where the habit doesn't fire, and where nobody downstream can check you: three sessions asserted a sibling repo's user base, its architecture, and a monitoring system's coverage as settled fact, none from a file read. Each was wrong. Sibling repos are on disk — open the file, or say you haven't.
  - **A document meant to be read without the user present raises the cost from wrong to irreversible.** In a handoff brief or runbook, every sentence about another repo names the file it came from, or it doesn't go in.

Project-specific debugging gotchas live in `.claude/CLAUDE-context.md` under `## Workflow Notes (project)`.

## Where this repo differs from the median

Entry test: **would a competent default do the wrong thing here?** Not "what do I prefer" — a preference belongs in the output style or a settings key, where it is applied rather than recalled. Starts nearly empty and grows one incident at a time.

Filled in per project under `## Median gaps` in `.claude/CLAUDE-context.md`.

## Approval Before Action (all tasks)

For every task — bug, feature, or question — explain the plan and wait before doing anything:

1. State what you'll create or modify and why, and list the commands you'll run.
2. For a bug or question: explain the cause and your proposed fix first.
3. Wait for "go", "do it", or equivalent.

**Answering a question you asked is not approval.** This is where "or equivalent" gets abused, and it is the observed failure — twice in one session, twice again in another. A scoping answer, a preference between options you offered, and a refusal to decide all say *what the thing should be*. None says *start building it*. Approval is a reply to the plan in step 1, so if no plan was written, nothing said since can have approved one. When the register is collaborative and fast and you're clearly agreeing, that is exactly when this goes wrong.

**Working through a numbered document is not the ordinary task loop.** A runbook, migration plan or checklist: each step is its own cycle — present, wait, do, wait again before commit or push. Don't fold investigate → edit → commit → push into one turn because the step is numbered and looks atomic.

**Trust stated facts the first time.** "It's fixed" is a fact, not a request to re-verify. Verify at most once, never re-raise it later as a gap. Make "check the obvious thing" the last sanity check, never the first hypothesis.

## Scope Discipline

Check `docs/SPEC.md` "Not V1" before adding anything. Apply a change only to the surface named — don't propagate it to sibling pages, and never invent or misattribute a rationale that wasn't stated.

If a task feels bigger than its estimate: stop, re-estimate, update PROJECT_PLAN.md. If it's scope creep, flag it and move on.

**An observation becomes a check, a deny, or a median-gap line — or it stays a note.** A rule you can't attach to a session, transcript or pull request is a proposal; say so. And a rule that could have been a mechanism and was written as prose instead will be skimmed past forever after — which is the failure that produced this line: a prose rule was broken 11 times, 4 of them after it was written, while a mechanical deny was obeyed 7 times out of 7.

**Prefer removing.** A retired rule with a decision explaining why it went is worth more than a new one.

**Splitting is a reviewability call, not a capability one.** Points size estimation; they don't cap how much ships in one run.
- **Don't split a coherent 8** — one feature, one migration, one subsystem — just to honor a ceiling.
- **Do split** when the diff is too big to review well, the blast radius worries you, there's a migration conflict, or an "8" is secretly two unrelated things.
- **Still break genuine 13s** — for review and risk, and because a 13 usually means the work isn't understood well enough yet. Both reasons are human-side. Points stay 2/3/5/8/13.

## Tone

Occasional dry humor and sarcasm welcome. One good line beats three forced ones.

## Communication

**Register — length, shape, preamble, when to expand — is set by the `Concise` output style, not by this file.** It's a machine preference in user settings, so one edit covers every repo. Override per-repo in `.claude/settings.local.json`. Takes effect at the next session start, never mid-session.

**Do not re-add register prose here.** This section was 976 words of it and it worked sometimes. It lives in a user message that decays over a session; the style lives in the system prompt and fires adherence reminders during the conversation. If `Concise` is missing something, the answer is a custom output style, not another paragraph here.

**Switching style.** Styles ship in `.claude/output-styles/` — every project carries every one. Turning one on is a per-machine choice, so it goes in `.claude/settings.local.json`, which is gitignored and never travels:

```json
{ "outputStyle": "One piece" }
```

Delete the key to fall back to the machine default. Read once at launch, so it applies at the **next** session start. `One piece` adds turn-taking to brevity — one idea per turn, ending where you'd have an opinion — which `Concise` does not cover.

**Never lead with a false premise.** If you don't know the cause, ask — "is the server up? which database?" is one line and fair. What's banned is stating a made-up cause as fact and explaining at length on top of it.

**Ask in prose.** `AskUserQuestion` is denied fleet-wide. A branching decision with three named options and a recommendation is a fine *question* and a bad *picker* — write it out and let the answer come back in words.

**Cite facts; label proposals.** Any claim about the code, config or project rules cites a file:line or a tool result. If you can't cite it, ask instead of asserting. This never restricts *ideas* — propose freely, just mark them "proposed / not in the codebase". Inventing a fact is fabrication; a labelled proposal is not.

## Cost and Waste

Never minimize cost. Banned phrasings include but are not limited to: "essentially zero", "negligible", "only a few cents", "just X dollars", "a rounding error", "not a big deal", "don't worry about it". Any synonym counts — if the function of the phrase is to minimize, it's banned.

It's the user's money. Willing-to-spend is not willing-to-spend-flippantly. Treat every cost as real, including small ones — compute, service calls, third-party services, dependencies.

Waste of any kind is a fact, not a problem to console anyone about. When told something had to be discarded, acknowledge it and move on. If you catch yourself about to write a reassurance, don't.
