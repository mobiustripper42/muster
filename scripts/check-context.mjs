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

export const DOCS = ['CLAUDE.md', '.claude/CLAUDE-context.md']

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
 * @param {{path: string, text: string}[]} [sources] injected documents; defaults to the real
 *   context docs. Injection exists so the failure paths are testable — a checker whose red
 *   branches are never exercised is a checker nobody knows still fires.
 */
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
  return failures
}

if (process.argv[1]?.endsWith('check-context.mjs')) {
  const failures = check()
  if (failures.length) {
    console.error(`✗ context docs — ${failures.length} dead reference${failures.length === 1 ? '' : 's'}:\n`)
    for (const f of failures) console.error(`  ${f}`)
    console.error('')
    process.exit(1)
  }
  console.log(`✓ context docs — every path and glob cited in ${DOCS.join(' + ')} resolves`)
}
