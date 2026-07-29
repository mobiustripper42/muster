#!/usr/bin/env node
// Validates that the always-loaded context docs point at things that exist (#593 fallout).
//
// The failure this exists for: `.claude/CLAUDE-context.md` described the crew ask channel as
// "fake/log + pilot seam, Twilio/SMS = later swap" for weeks after `src/adapters/twilio-channel.ts`
// shipped and became the live production transport. A session read that line, believed it, and
// filed an issue asserting a feature was blocked on an adapter that had existed since 9.4/#225.
//
// The 2026-07-25 doc-consistency audit could not have caught it. That audit compared docs to
// DOCS; this claim was false against CODE, which was the one corpus never swept — and the audit's
// own dominant finding says exactly that: a change that lands in code updates the code and never
// the doc.
//
// So the rule these files now follow is: **carry decisions, rationale and pointers — not
// inventory.** Rationale doesn't rot. A pointer (`ls src/adapters/*-channel.ts`) sends the reader
// to the truth instead of copying it, and it is checkable, which is what this script does. A prose
// snapshot of current state is stale the day the code moves and nothing anywhere notices.
//
// What it cannot do is judge a CHARACTERIZATION. "Twilio is the live transport" is a sentence no
// script can validate; only a reader can. This closes the existence half, which is most of the
// volume once inventory has become pointers, and leaves the rest to review. Saying so out loud
// matters more than the code below — a guard whose blind spot is undocumented gets trusted for
// things it never checked (#589).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export const DOCS = ['CLAUDE.md', '.claude/CLAUDE-context.md']

// Backticked spans with no whitespace.
const PATHISH = /`([^`\s]+)`/g

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

function globMatches(pattern) {
  try {
    // `ls` is what the docs literally tell a reader to run, so check the same thing they will.
    // Route groups put parentheses in real Next.js paths (`app/(crew)/…`) and bash reads those as
    // a subshell; escape them while leaving braces and stars to expand.
    const escaped = pattern.replace(/([()])/g, '\\$1')
    const out = execFileSync('bash', ['-lc', `ls ${escaped} 2>/dev/null | head -1`], { encoding: 'utf8' })
    return out.trim().length > 0
  } catch {
    return false
  }
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
        // Strip a trailing colon+line-number citation (`src/builder/derive.ts:148,192`).
        const path = raw.replace(/:[\d,]+$/, '')
        const ok = isPattern(path) ? globMatches(path) : existsSync(path)
        if (!ok) failures.push(`${doc}:${i + 1} — cites \`${raw}\`, which does not exist`)
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
