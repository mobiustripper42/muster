# Agents and Skills

Canonical specs for the shared roster. The shell's `## Session Skills` and `## Agents` tables are
the summary a session reads; this is the detail.

This file is installed byte-identical in every project, so it describes the roster and never one
repo's progress through it. What ships is what appears here: a file in `.claude/skills/` with no
entry is an unclassified file, which is the state this workflow keeps finding defects in.

## Skills — seven

| Skill | When | What |
|-------|------|------|
| `/its-alive` | Session start | Open the per-session file on the orphan `sessions` branch, read context, run the drift and permission-policy checks, recommend a task |
| `/kill-this` | Per task | Build check, commit, `@code-review`, open the PR with `closes #<issue>`, append a `## Task <N>` block. Step 3.5 reads Blast-Radius Triggers and runs `/security-review` when the diff hits one |
| `/its-dead` | Session end, once | Stamp `ended:`, tally points, display wall clock, close the session file. No time math, no version bump |
| `/start-phase` | Phase start | Materialize the phase as GitHub Issues with `phase:N` and `points:X` labels |
| `/retro` | Phase end | Throughput + estimate calibration from issue dates and labels. Marks `[x]`, writes `RETROSPECTIVES.md`, runs version bumps |
| `/bump-major` | Breaking change | Major bump with a supplied rationale, CHANGELOG entry, tag on `main` |
| `/promote-production` | Ship | ff-merge `main` → `production`, push. Projects with that branch only |

### Not carried

| Skill | Why |
|-------|-----|
| `read-the-tape` | ~$2 a session and produced little anyone could use. Its input — the `SessionEnd` capture hook — is removed |
| `@workout` | Output was 20k characters nobody read |
| `doc-consistency-check` | **0 invocations** across 60 retained transcripts, 2026-07-26 → 2026-08-26 |
| `pause-this`, `restart-this` | Sat marked "review" through the whole first pass and were never resolved in either direction |

## Agents — four

| Agent | Model | When | Purpose |
|-------|-------|------|---------|
| `@architect` | Opus 5 | Before design decisions, new dependencies, scope creep | Coherence against SPEC and the decision record |
| `@code-review` | Sonnet | After every commit, wired into `/kill-this` | Catch issues early. Advisory — flags, does not block |
| `@pm` | Sonnet | Session start and end, via skills | Progress, timeline risk, scope cuts |
| `@ui-reviewer` | Sonnet | After UI work, phase boundaries | Design quality against the project's design system, read from `.claude/ui-context.md` |

All four are `context` class: they arrive as install-time starting points and each project owns its
copy afterwards. They reason about a project's *substance*, so a good one is necessarily
project-specific and cannot be derived from a template. The accepted cost is that a good idea
emerging in one project's reviewer never auto-surfaces for backporting; harvesting it upstream is a
deliberate act.

**Descriptions are project-agnostic.** An earlier generation carried `[Project]` in the
`description:` frontmatter, filled in per install, which made every agent permanently differ from
its template and forced the drift check to normalize that one line before comparing. There is no
substitution step now, so the placeholder goes: "Post-commit code reviewer for this project."
Nothing is lost, because the agent already reads project facts from the context file.

### Not carried

| Agent | Why |
|-------|-----|
| `@doc-consistency` | 1,450 words shipped into every project. **0 invocations in a month** |
| `@ideas` | 1,138 words. **0 invocations in a month** — and its file was missing from the library's own `.claude/` from the day it was written, so `@ideas` never resolved there either |
| `@tape-reader` | Read the tape, which is gone |

**The test that produced those zeros is mechanical and reusable:** count invocations across
retained transcripts. It beats judgment about what feels useful, and it works anywhere transcripts
are kept. Zero is the meaningful number — `/retro` at 1 and `/promote-production` at 3 are low but
plausible, because they fire at phase boundaries.

## Output styles — one

Styles ship in `.claude/output-styles/`, `logic` class like the skills: every project carries
every one. Which is **on** is a per-machine choice in `.claude/settings.local.json`, gitignored and
never travelling — `{ "outputStyle": "One piece" }`, deleted to fall back to the machine default.
Read once at launch, so a change applies at the next session start.

| Style | What it adds |
|-------|--------------|
| `One piece` | Turn-taking and density, neither of which brevity alone covers. One idea per turn, ending where the reader would have an opinion, naming the next piece and stopping there — and one fact per sentence, because "make it shorter" removes sentences while keeping facts, which is how a short reply becomes an unreadable one. Written after a session stacked four decisions into one reply and the reader lost the thread |

The machine default is set outside this repo and is not listed here — it is a preference, not part
of the roster.

**A style with no entry here is an unclassified file**, same as a skill. Nothing checks that
automatically: `.claude/doc-check.json` defines roster comparisons for `skills` and `agents` only,
and `check-docs.mjs` has no styles concept, so this table and the directory can drift apart
silently. It is written down because the gate cannot.

## Model selection

Agents pin their model in frontmatter. `@architect` is Opus 5; the reviewers stay Sonnet. New
agents default to Sonnet and pin `model: opus` only when the standing job needs it — the alias
resolves forward on its own, so no per-release edit is needed.
