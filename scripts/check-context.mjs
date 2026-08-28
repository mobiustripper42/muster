#!/usr/bin/env node
// Validates that the always-loaded context docs point at things that exist.
//
// Install to the project's own `scripts/` and add it to the verify chain:
//   "check:context": "node scripts/check-context.mjs"
// It needs no dependencies and runs in about 0.2s. `check-context.test.mjs` is a vitest suite;
// drop it if the project has no test runner — the script stands alone.
//
// THE FAILURE THIS EXISTS FOR (muster, 2026-07-28). `.claude/CLAUDE-context.md` described the crew
// ask channel as "fake/log adapter + pilot seam · Twilio/SMS = later swap" for weeks after the
// Twilio adapter shipped and became the live production transport. A session read that line,
// believed it, and filed an issue asserting a feature was blocked on an adapter that had existed
// since June — then explained the blockage at length.
//
// A five-day doc-consistency audit had just finished and could not have caught it. That audit
// compared docs to DOCS; this claim was false against CODE, the one corpus doc sweeps never read.
// The audit's own dominant finding says exactly that: a change that lands in code updates the code
// and never the doc.
//
// So the rule these files follow is: **carry decisions, rationale and pointers — not inventory.**
// Rationale doesn't rot. A pointer (`ls src/adapters/*-channel.ts`) sends the reader to the truth
// instead of copying it, and it is checkable, which is what this script does. A prose snapshot of
// current state is stale the day the code moves and nothing anywhere notices.
//
// What it cannot do is judge a CHARACTERIZATION. "X is the live transport" is a sentence no script
// can validate; only a reader can. This closes the existence half — most of the volume once
// inventory has become pointers — and leaves the rest to review. Saying so out loud matters more
// than the code below: a guard whose blind spot is undocumented gets trusted for things it never
// checked.

import { existsSync, globSync, readFileSync, readdirSync, statSync } from 'node:fs'

/** Every `.md` under a directory, recursively. Absent directory yields nothing. */
const walkMd = (d) =>
  !existsSync(d)
    ? []
    : readdirSync(d).flatMap((e) => {
        const p = `${d}/${e}`
        return statSync(p).isDirectory() ? walkMd(p) : p.endsWith('.md') ? [p] : []
      })

/**
 * The two always-loaded files are REQUIRED and are never filtered by existence — their absence is
 * the finding, reported below. Discovered files are a different case: `.claude/skills` holding no
 * skills is a repo that ships none, not a defect.
 *
 * A blanket `.filter(existsSync)` over the whole list was here for one commit and made the
 * missing-document report unreachable: deleting `.claude/CLAUDE-context.md` produced
 * `✓ every path … resolves` and exit 0, with the file quietly absent from the list of what had
 * been checked. The one file every session loads could vanish behind five green gates.
 */
export const DOCS = ['CLAUDE.md', '.claude/CLAUDE-context.md', ...walkMd('.claude/skills'), ...walkMd('.claude/agents')]

// A backticked span, optionally written as the `ls <path>` command a reader would actually run.
// That prefix is the docs' own convention for a pointer — "authoritative list: `ls
// src/adapters/*-channel.ts`" — and the first version's no-whitespace rule made every one of them
// invisible: the two highest-value pointers in the file, including the one written as this
// script's worked example, were never checked. A guard blind to exactly the pattern it exists to
// encourage is worse than no guard, because the doc claims it is covered.
export const PATHISH = /`(?:ls\s+)?([^`\s]+)`/g

// Only a span rooted in a real top-level directory of THIS repo counts as a claim about this
// repo's contents. The first draft checked anything path-shaped and produced 16 findings, 15 of
// them noise: bare filenames used as shorthand (`layout.tsx`), git refs (`origin/production`,
// `feature/reservations`), format placeholders (`YYYYMMDDHHMMSS_name.sql`, `kebab-case.tsx`), the
// `@core/*` tsconfig alias, and seeds-repo paths (`dev/claude/...`) that correctly don't exist
// here. A check that cries wolf 15 times gets muted, and then it is worse than no check — so the
// rule is narrow on purpose and the misses are the price.
//
// The corollary is a doc-writing habit: cite a full path (`src/adapters/twilio-channel.ts`) and it
// gets checked; write a bare filename and it does not.
const ROOTS = new Set(
  readdirSync('.').filter((f) => {
    try {
      return statSync(f).isDirectory() && !f.startsWith('.') && f !== 'node_modules'
    } catch {
      return false
    }
  }),
)
// `<…>` marks a deliberate placeholder — `components/<feature>/` describes a shape, not a file.
// An explicit marker beats guessing: Next.js route params are real directories (`shift/[shiftId]`),
// so brackets cannot be treated as placeholder syntax.
export const isClaim = (s) => s.includes('/') && ROOTS.has(s.split('/')[0]) && !s.includes('<')

/**
 * A shell pattern — glob or brace expansion — is a claim that it matches something. The docs
 * write both (`src/adapters/*-channel.ts`, `app/(crew)/crew/{,open,calendar}/page.tsx`), so both
 * go through the shell rather than `existsSync`, which would read them literally and fail.
 */
const isPattern = (p) => /[*?{]/.test(p)

/**
 * `{a,b}` → every combination, left to right. `globSync` handles `*` and `?` but not brace
 * expansion, and the docs use it (`crew/{,open,calendar,time-off}/page.tsx`).
 */
export function expandBraces(pattern) {
  const open = pattern.indexOf('{')
  if (open === -1) return [pattern]
  const close = pattern.indexOf('}', open)
  if (close === -1) return [pattern]
  const [head, tail] = [pattern.slice(0, open), pattern.slice(close + 1)]
  return pattern
    .slice(open + 1, close)
    .split(',')
    .flatMap((alt) => expandBraces(`${head}${alt}${tail}`))
}

/**
 * Does this pattern match anything on disk?
 *
 * Node's own globber, not a shell. The first version ran `bash -lc "ls ${pattern}"` with the
 * pattern interpolated after escaping parentheses, and review demonstrated real command execution
 * from a doc-only payload: a span like `src/*;touch$IFS/tmp/x` roots on a real directory, dodges
 * the no-whitespace filter via `$IFS`, and runs. Reaching that requires commit access to
 * `CLAUDE.md`, so the practical risk was low — but this script runs in `verify` on every dev
 * machine and in CI, and the premise of this whole PR is that docs get *less* scrutiny than code.
 * A docs diff should never be a code-exec path. No shell, no escaping to get right, no risk.
 */
/**
 * `globSync` reads `[token]` as a POSIX bracket expression — one character from t,o,k,e,n — so a
 * citation of a Next.js dynamic route resolves to nothing even when the directory is sitting right
 * there. Every dynamic segment in an App Router project is a `[bracket]` directory, so this made
 * *any* dynamic route uncitable in the two always-loaded context docs, and reported the doc as
 * wrong for being right. Escaping is the fix: `[` → `[[]`, `]` → `[]]`. Backslash escaping does not
 * work here — node's glob ignores it and still matches zero.
 *
 * Done in one pass over both characters, deliberately. Two sequential replaces would feed the `[`
 * of a freshly-written `[[]` back into the `]` pass and corrupt it.
 *
 * A bracket in a cited path is a literal directory name essentially every time; nobody writes a
 * character class into a doc. Treating all of them as literal is the right default, and the cost of
 * being wrong is a pattern that fails to match — the same outcome as today.
 */
function escapeBrackets(pattern) {
  return pattern.replace(/[[\]]/g, (c) => (c === '[' ? '[[]' : '[]]'))
}

function patternMatches(pattern) {
  try {
    return expandBraces(pattern).some((p) => globSync(escapeBrackets(p)).length > 0)
  } catch {
    return false
  }
}

/**
 * Does this backticked span name something that exists? Takes the span as written in the doc and
 * does the normalising a lookup needs.
 *
 * Exported because `check-docs.mjs` runs the same rule over `docs/*.md` and there must be exactly
 * ONE implementation of it. The first version of the resolver executed shell commands out of a
 * markdown file; a second copy is a second chance to reintroduce that, and the copy would be the
 * one nobody reviews. Same reason the brace expander isn't duplicated.
 */
export function resolves(raw) {
  // Strip a trailing line-number citation, and any backslashes the author added to make the span
  // paste-able into a shell (`app/\(crew\)/`) — those are for bash, not for a lookup.
  //
  // Both citation styles the docs use: a list (`src/builder/derive.ts:148,192`) and a RANGE
  // (`app/lib/auth.ts:88-96`). The range form was missed until `check-docs` ran the same resolver
  // over `docs/*.md` and reported three live files as dead — the blind spot nobody would have
  // found from this script's own corpus, because context docs happen to cite only lists.
  const path = raw.replace(/:[\d,-]+$/, '').replace(/\\(?=[()])/g, '')
  return isPattern(path) ? patternMatches(path) : existsSync(path)
}

/**
 * A `§ Section` reference is a claim that the section exists. Nothing checked it, which is how
 * the DEC-S042 shell shipped citing `.claude/CLAUDE-context.md § Workflow Mechanisms` into a
 * project whose context file only had `## Workflow Overrides` — three dead pointers per task, in
 * an always-loaded file, past three green gates (issue #181). A session sent to a section that
 * isn't there improvises the slot rather than reporting the gap, so the failure is silent in the
 * direction that costs most.
 *
 * ONLY a reference with an explicit backticked `.md` file is checked. Two forms:
 *
 *   `.claude/CLAUDE-context.md` § Workflow Mechanisms     file outside the backticks
 *   `dev/claude/CLAUDE.md §Versioning`                    § inside, closing backtick ends it
 *
 * A bare `§ Heading` with no file was implemented first and thrown away: run over the real corpus
 * it produced 12 findings, of which roughly one was real. Historical docs are full of `§` used as
 * ordinary prose about *other* repos' documents — `PROJECT_PLAN.md` alone carries
 * "CLAUDE.md §Commands lookup, skip silently if none)" and "§Versioning, §Tone, §Verbosity, etc.)"
 * inside completed-task cells. Resolving those against the containing file is meaningless, and a
 * gate that reports eleven false findings to catch one gets muted, at which point it is worse than
 * no gate. The backticked form is the one the always-loaded shell actually uses, and it is the
 * form the bushel failure took.
 *
 * Non-`.md` targets are skipped — `.claude/routine-config.yaml` § `file-classes` points into YAML,
 * which has no headings to resolve against. A target that does not exist is also skipped rather
 * than reported: whether a cited path exists is `checkPaths`' job, and a doc describing what a
 * *project* holds legitimately names files this repo does not have.
 */
export function sectionRefs(line) {
  const out = []
  const scan = /§/g
  let m
  while ((m = scan.exec(line))) {
    const before = line.slice(0, m.index)
    const after = line.slice(m.index + 1)
    const closed = before.match(/`([^`\s]+)`\s*$/) // `file` § …
    const open = before.match(/`([^`\s]+)\s+$/) // `file §…` — still inside the backticks
    const file = closed?.[1] ?? open?.[1]
    if (!file) continue // a bare `§ Heading` with no backticked file — see the note above
    // Inside the backticks the closing one delimits the heading. Otherwise it runs to end of line
    // and may carry trailing prose ("§ Communication for the session that prompted it") — but it
    // stops at the next backtick, `§`, or `|`, because a line can hold two citations and without
    // that bound the first one swallows the second's syntax. Observed shapes, both in this fleet:
    // "`dev/claude/CLAUDE.md` § Memory removed (section sat between § Workflow Notes and
    // § Approval Before Action)" — the first citation's text ran to the end and no longer
    // prefix-matched its own heading; and soundings' `docs/SPEC.md:422`, a decision-ledger table
    // whose cell ends "See `docs/HARDWARE_BUILD_PLAN.md` §3. |", where the text ran past the cell
    // boundary and swallowed the rest of the row. A `|` *inside* the backticks is part of the
    // citation, not a boundary, which is why only the unbacktick'd branch is split.
    out.push({ file, section: (open && !closed ? after : after.split(/[`§|]/)[0]).split('`')[0] })
  }
  return out
}

/**
 * Split into comparable words. Backticks, bold markers and per-word trailing punctuation are
 * decoration — the citation `§ Seeds' Own Decision Record. There **is** a test suite` has to
 * compare its fourth word as `Record`, not `Record.`, or the heading never matches its own name.
 */
const words = (s) =>
  s
    .replace(/[`*]/g, '')
    .split(/\s+/)
    .map((w) => w.replace(/^[([{]+|[).,;:!?\]}]+$/g, ''))
    .filter(Boolean)

/**
 * Every ATX heading in a markdown document.
 *
 * A trailing parenthetical is dropped: `## Permission settings (DEC-S023)` is cited as
 * `README.md § Permission settings`, because the decision id is provenance rather than part of
 * the section's name. Keeping it would fail a live reference, which is the expensive direction.
 */
export const headings = (text) =>
  text
    .split('\n')
    .map((l) => l.match(/^#{1,6}\s+(.+?)\s*#*\s*$/))
    .filter(Boolean)
    .map((m) => words(m[1].replace(/\s*\([^)]*\)\s*$/, '')))

/**
 * Does the citation name one of these headings?
 *
 * A citation has no closing delimiter, so its text runs into the sentence around it, and it can
 * also be SHORTER than the heading — `README.md § Permission settings` points at
 * `## Permission settings (DEC-S023)`. So a match is: some heading is a word-prefix of the
 * citation, or the citation is a word-prefix of some heading.
 *
 * The comparison is on whole words, not characters, and that is the load-bearing part. A rule
 * that accepted any prefix of the citation would pass `§ Workflow Mechanisms` against a file
 * containing only `## Workflow Overrides` — they share their first word — and that is precisely
 * the bushel failure this check exists for.
 *
 * **The limit, stated because it is real and was raised in review.** A citation that *begins* with
 * a genuine short heading passes whatever follows it: `dev/claude/CLAUDE.md` has `## Tone`,
 * `## Agents` and `## Communication`, so `§ Communication style requirements` resolves even though
 * no such section exists. That is deliberate, not an oversight. A citation has no closing
 * delimiter and legitimately runs into its sentence — seeds' own `CLAUDE.md` writes
 * "`dev/claude/CLAUDE.md` § Communication for the session that prompted it" — so nothing
 * mechanical separates trailing prose from an over-long section name.
 *
 * Given that, the check answers the question that matters: **is there a heading here to land on?**
 * A reader following `§ Communication style requirements` arrives at `## Communication` and is
 * roughly where they meant to be. A reader following `§ Workflow Mechanisms` into a file that has
 * only `## Workflow Overrides` has nowhere to go, silently, on every session — and that is the
 * failure issue #181 was opened for. Tightening the rule to catch the first case would fail the
 * second-listed live reference above, and a gate that reddens on correct docs gets muted.
 */
export function sectionMatches(section, docHeadings) {
  const cited = words(section)
  if (cited.length === 0) return false
  const prefix = (a, b) => b.length <= a.length && b.every((w, i) => w === a[i])
  const hit = (a, b) => prefix(a, b) || prefix(b, a)
  return docHeadings.some((h) => {
    if (h.length === 0) return false
    if (hit(cited, h)) return true
    // Subtitle fallback. BOTH sides must carry a separator of their own — see sectionName.
    const c = sectionName(cited)
    const s = sectionName(h)
    return c !== null && s !== null && hit(c, s)
  })
}

/**
 * A section's NAME — the words before a standalone dash or `+` — or `null` if it has no such
 * separator, or begins with one.
 *
 * The word-prefix rule assumes one side is a prefix of the other, and there is a live shape where
 * neither is: a numbered heading with an em-dash subtitle, cited from inside a sentence. muster's
 * `docs/SPEC.md:1808` is `# 4. Parked — deliberately deferred, not reopened`, cited correctly as
 * `§4 *Parked* + the 2027 line`. Both agree on `4 Parked`, then the heading runs into its subtitle
 * and the citation into its sentence. The check called a correct citation dead — the expensive
 * direction, because a gate that reddens on good docs gets muted rather than fixed.
 *
 * **`null` is why this is a fallback rather than a normalization, and it is load-bearing.** The
 * first version truncated unconditionally, which meant a heading's short name became a landing
 * point for anything starting with it: `## The Routine — OFF, and now unrevivable` collapsed to
 * `The Routine`, so `§ The Routine is active again` — a genuinely dead reference — resolved. That
 * is issue #181's failure with extra steps, and `## Step N — …` is the dominant heading shape in
 * this repo's own skills, so the blast radius was every project's `verify`. Requiring a separator
 * on **both** sides fixes it: a citation that never ran into prose has nothing to truncate, so it
 * is still compared in full. Caught in review, before merge.
 *
 * Returning `null` for a leading separator matters for the same reason — `## — Untitled` would
 * otherwise truncate to nothing and become permanently uncitable, silently.
 *
 * **Dashes and `+` only — not punctuation generally.** `→` is deliberately excluded so that
 * `docs/SCHEMA_VERSIONS.md § v4 → v5` still compares all three words and cannot land on
 * `§ v4 → v6`. Widening this set trades precision for reach; do it only when a real citation
 * demands it, and add the case that demanded it.
 *
 * The limit that remains: two headings whose names agree before the dash are both valid landing
 * points for a citation of either. That is the existing documented limit, not a new one — the
 * check answers "is there a heading here to land on?", and both answers are the right
 * neighbourhood.
 */
function sectionName(ws) {
  const at = ws.findIndex((w) => /^[\p{Pd}+]+$/u.test(w))
  return at <= 0 ? null : ws.slice(0, at)
}

/**
 * @param {{path: string, text: string}[]} [sources] injected documents; defaults to the real
 *   context docs. Injection exists so the failure paths are testable — a checker whose red
 *   branches are never exercised is a checker nobody knows still fires.
 */
export function checkSections(sources) {
  const failures = []
  const headingCache = new Map()
  for (const { path: doc, text } of sources) {
    if (text === null) continue // `check` already reports a missing document
    text.split('\n').forEach((line, i) => {
      for (const { file, section } of sectionRefs(line)) {
        if (!file.endsWith('.md') || !existsSync(file)) continue
        if (!headingCache.has(file)) headingCache.set(file, headings(readFileSync(file, 'utf8')))
        if (!sectionMatches(section, headingCache.get(file)))
          failures.push(
            `${doc}:${i + 1} — cites \`${file}\` § ${words(section).slice(0, 6).join(' ')}, which has no such section`
          )
      }
    })
  }
  return failures
}

export function check(sources) {
  const failures = []
  const docs =
    sources ??
    DOCS.map((path) => {
      if (!existsSync(path)) return { path, text: null }
      return { path, text: readFileSync(path, 'utf8') }
    })

  for (const { path: doc, text } of docs) {
    if (text === null) {
      failures.push(`${doc} — listed in check-context.mjs but does not exist`)
      continue
    }
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(PATHISH)) {
        const raw = m[1]
        if (!isClaim(raw)) continue
        if (!resolves(raw)) failures.push(`${doc}:${i + 1} — cites \`${raw}\`, which does not exist`)
      }
    })
  }
  return [...failures, ...checkSections(docs)]
}

if (process.argv[1]?.endsWith('check-context.mjs')) {
  const failures = check()
  if (failures.length) {
    console.error(`✗ context docs — ${failures.length} dead reference${failures.length === 1 ? '' : 's'}:\n`)
    for (const f of failures) console.error(`  ${f}`)
    console.error('')
    process.exit(1)
  }
  console.log(`✓ context docs — every path, glob and § section cited in ${DOCS.join(' + ')} resolves`)
}
