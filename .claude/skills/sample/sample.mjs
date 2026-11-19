#!/usr/bin/env node
/**
 * The hand-back sample: 2 tests and 1 function picked from the code a branch changed, and the
 * marks the operator gives them in the session file.
 *
 *   node .claude/skills/sample/sample.mjs pick [--base <ref>]
 *   node .claude/skills/sample/sample.mjs list <session-file>
 *   node .claude/skills/sample/sample.mjs mark <session-file> <n> <mark> [pattern]
 *
 * Blocks are found by matching lines, not by a parser: it misses oddly-shaped code and every
 * language but JS/TS, and says so (`format`) rather than printing nothing. The tests live in jig,
 * at scripts/sample.test.mjs, because a project receives this folder and runs the script, never
 * the tests.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

// Revisit these two counts after about 20 samples, not before (issue 130).
export const TESTS = 2
export const FUNCTIONS = 1

export const UNANSWERED = 'unanswered'
export const MARKS = ['real', 'waste', "can't tell"]
export const QUESTIONS = {
  test: "If this test fails, what's broken for a member?",
  function: 'What is this handling that I never asked for?',
}
// - `path:line` — test|function — <unanswered|real|waste|can't tell> — <pattern>|—
export const SAMPLE_LINE = new RegExp(
  '^- `([^`]+):(\\d+)` — (test|function) — (' + [UNANSWERED, ...MARKS].join('|') + ') — (.+)$',
)

const SOURCE = /\.(js|mjs|cjs|ts|tsx|jsx|mts|cts)$/
const TEST_FILE = /(\.(test|spec)\.[^/]+$|(^|\/)__tests__\/)/
const TEST_OPEN = /^\s*(it|test)\(/
const FUNCTION_OPEN = new RegExp(
  '^\\s*(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s*\\*?\\s*[\\w$]+\\s*\\(' +
    '|' +
    '^\\s*(?:export\\s+)?const\\s+[\\w$]+\\s*(?::[^=]+)?=\\s*(?:async\\s+)?' +
    '(?:\\((?:[^()]|\\([^()]*\\))*\\)(?:\\s*:\\s*[^=]+?)?|[\\w$]+)\\s*=>',
)

/** The `+` lines of a unified diff, numbered 1-based in the new file, by repo-relative path. */
export function changedLines(diffText) {
  const out = new Map()
  let current = null
  let oldLeft = 0
  let newLeft = 0
  let next = 0
  for (const l of diffText.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (l.startsWith('+')) {
        if (current) current.add(next)
        next++
        newLeft--
      } else if (l.startsWith('-')) oldLeft--
      else if (l.startsWith('\\')) continue
      else {
        next++
        oldLeft--
        newLeft--
      }
      continue
    }
    if (l.startsWith('diff --git ')) current = null
    else if (l.startsWith('+++ ')) {
      const to = l.slice(4)
      current = null
      if (to.startsWith('b/')) {
        const path = to.slice(2)
        current = out.get(path) ?? new Set()
        out.set(path, current)
      }
    } else {
      const h = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l)
      if (h) {
        oldLeft = h[1] === undefined ? 1 : Number(h[1])
        next = Number(h[2])
        newLeft = h[3] === undefined ? 1 : Number(h[3])
      }
    }
  }
  return out
}

/** Each block runs from its opening line to just before the next one, or to the end of the file. */
export function findBlocks(path, text) {
  if (!SOURCE.test(path)) return []
  const isTest = TEST_FILE.test(path)
  const open = isTest ? TEST_OPEN : FUNCTION_OPEN
  const kind = isTest ? 'test' : 'function'
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const starts = []
  lines.forEach((l, i) => {
    if (open.test(l)) starts.push(i + 1)
  })
  return starts.map((line, i) => ({ kind, line, end: i + 1 < starts.length ? starts[i + 1] - 1 : lines.length }))
}

/** The blocks whose range holds a changed line. */
export function touched(blocks, lines) {
  return blocks.filter((b) => [...lines].some((n) => n >= b.line && n <= b.end))
}

/** n distinct candidates, chosen by a generator seeded from `seed`, kept in their given order. */
export function pick(candidates, n, seed) {
  let s = createHash('sha256').update(String(seed)).digest().readUInt32BE(0)
  const random = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const idx = candidates.map((_, i) => i)
  const count = Math.min(n, idx.length)
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (idx.length - i))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
    .slice(0, count)
    .sort((a, b) => a - b)
    .map((i) => candidates[i])
}

export function sampleLine({ path, line, kind, mark = UNANSWERED, pattern = '—' }) {
  return `- \`${path}:${line}\` — ${kind} — ${mark} — ${pattern}`
}

export function noneLine(reason) {
  return `**Sample:** none — ${reason}`
}

export function format(tests, functions) {
  if (!tests.length && !functions.length) return noneLine('no changed test or function in a JS/TS file')
  return [
    '**Sample:**',
    ...(tests.length ? tests.map(sampleLine) : ['- no changed test']),
    ...(functions.length ? functions.map(sampleLine) : ['- no changed function']),
  ].join('\n')
}

/** The unanswered sample lines, numbered in file order. `line` is the line in `text`. */
export function unanswered(text) {
  const found = []
  let task = ''
  text.split('\n').forEach((l, i) => {
    const heading = /^## (.+)$/.exec(l)
    if (heading) task = heading[1]
    const m = SAMPLE_LINE.exec(l)
    if (m && m[4] === UNANSWERED) found.push({ n: found.length + 1, line: i + 1, task, kind: m[3], path: m[1], at: Number(m[2]) })
  })
  return found
}

/** Rewrites line n of the unanswered list. Throws, changing nothing, on a bad mark or n. */
export function mark(text, n, value, pattern) {
  if (!MARKS.includes(value)) throw new Error(`mark must be one of: ${MARKS.join(', ')}`)
  const list = unanswered(text)
  if (!Number.isInteger(n) || n < 1 || n > list.length) throw new Error(`n must be a number from 1 to ${list.length}`)
  const target = list[n - 1]
  const lines = text.split('\n')
  lines[target.line - 1] = sampleLine({ path: target.path, line: target.at, kind: target.kind, mark: value, pattern: pattern || '—' })
  return lines.join('\n')
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim()

function pickCommand(base) {
  try {
    git('rev-parse', '--verify', '--quiet', `${base}^{commit}`)
  } catch {
    return noneLine(`base ${base} not found`)
  }
  let mergeBase
  try {
    mergeBase = git('merge-base', 'HEAD', base)
  } catch {
    return noneLine(`no merge base with ${base}`)
  }
  const head = git('rev-parse', 'HEAD')
  const diff = execFileSync('git', ['-c', 'core.quotepath=off', 'diff', '--unified=0', '--no-color', '--no-ext-diff', mergeBase, 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1 << 28,
  })
  const candidates = []
  for (const [path, lines] of [...changedLines(diff)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!SOURCE.test(path)) continue
    let text
    try {
      text = execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 })
    } catch {
      continue
    }
    for (const b of touched(findBlocks(path, text), lines)) candidates.push({ path, ...b })
  }
  const of = (kind) => candidates.filter((c) => c.kind === kind)
  return format(pick(of('test'), TESTS, head), pick(of('function'), FUNCTIONS, head))
}

if (process.argv[1]?.endsWith('sample.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2)
  const fail = (message, code = 1) => {
    console.error(message)
    process.exit(code)
  }
  if (cmd === 'pick') {
    const i = rest.indexOf('--base')
    console.log(pickCommand(i >= 0 && rest[i + 1] ? rest[i + 1] : 'origin/main'))
  } else if (cmd === 'list') {
    if (!rest[0]) fail('usage: sample.mjs list <session-file>', 2)
    const list = unanswered(readFileSync(rest[0], 'utf8'))
    console.log(list.length ? list.map((s) => `${s.n}. ${s.task} — \`${s.path}:${s.at}\` — ${QUESTIONS[s.kind]}`).join('\n') : 'no unanswered samples')
  } else if (cmd === 'mark') {
    const [file, n, value, pattern] = rest
    if (!file || n === undefined || value === undefined) fail('usage: sample.mjs mark <session-file> <n> <mark> [pattern]', 2)
    try {
      writeFileSync(file, mark(readFileSync(file, 'utf8'), /^\d+$/.test(n) ? Number(n) : NaN, value, pattern))
    } catch (e) {
      fail(e.message)
    }
  } else fail('usage: sample.mjs pick [--base <ref>] | list <session-file> | mark <session-file> <n> <mark> [pattern]', 2)
}
