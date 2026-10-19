#!/usr/bin/env node
/**
 * What a /build-task run spent, read from the session's own transcripts, for the receipt.
 *
 *   node .claude/skills/build-task/cost.mjs --since <ISO time the run started>
 *
 * The session's transcript is `~/.claude/projects/<cwd, / as ->/<CLAUDE_CODE_SESSION_ID>.jsonl`,
 * as /its-alive records it, and each subagent's is beside it under `<id>/subagents/`, with its
 * type in a `.meta.json`. Every assistant reply carries its token usage. A streamed reply is
 * logged more than once with the same message id, and the last copy carries the final count.
 *
 * Active time is the sum of the gaps under five minutes between log entries, across the lead's
 * transcript and every subagent's, so a lead waiting on a background agent is still counted. It
 * includes the operator's time answering readback questions.
 *
 * It never fails a run: when the transcript cannot be found, or nothing was logged since the
 * start, it says why, and exits 0.
 *
 * Why it exists: most of a /build-task run's cost is in its subagents, which the session's own
 * view of its usage does not show. Without this line in the receipt, what the workflow spends is
 * known only to whoever goes back and counts by hand.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const IDLE = 5 * 60e3

const parse = (text) =>
  text.split('\n').flatMap((l) => {
    if (!l.trim()) return []
    try {
      return [JSON.parse(l)]
    } catch {
      return []
    }
  })

/** The family name, not the version — the receipt compares runs across releases. */
const family = (model) => (String(model).match(/opus|sonnet|haiku|fable/) ?? [String(model)])[0]

/**
 * @param {object[]} main the lead's transcript entries
 * @param {{type: string, entries: object[]}[]} subagents one per subagent transcript
 * @param {number} since epoch ms; nothing logged before it counts
 */
export function tally(main, subagents, since) {
  const stamps = []
  const roles = new Map()
  const add = (role, entries) => {
    const usage = new Map()
    const models = new Map()
    for (const e of entries) {
      const t = Date.parse(e.timestamp ?? '')
      if (!(t >= since)) continue
      stamps.push(t)
      const m = e.message
      if (e.type !== 'assistant' || !m?.usage) continue
      usage.set(m.id ?? e.uuid ?? usage.size, m.usage)
      // `<synthetic>` entries are the harness's own, with zero usage; they never name the model.
      if (!String(m.model).startsWith('<')) models.set(family(m.model), (models.get(family(m.model)) ?? 0) + 1)
    }
    if (!usage.size) return
    const r = roles.get(role) ?? { role, models: new Map(), output: 0, input: 0, cacheRead: 0, cacheWrite: 0, runs: 0 }
    r.runs++
    for (const u of usage.values()) {
      r.output += u.output_tokens ?? 0
      r.input += u.input_tokens ?? 0
      r.cacheRead += u.cache_read_input_tokens ?? 0
      r.cacheWrite += u.cache_creation_input_tokens ?? 0
    }
    for (const [k, n] of models) r.models.set(k, (r.models.get(k) ?? 0) + n)
    roles.set(role, r)
  }
  add('lead', main)
  for (const s of subagents) add(s.type, s.entries)

  stamps.sort((a, b) => a - b)
  let active = 0
  for (let i = 1; i < stamps.length; i++) if (stamps[i] - stamps[i - 1] < IDLE) active += stamps[i] - stamps[i - 1]

  // `runs` counts transcript files: a subagent resumed by message is one file, so one run.
  const list = [...roles.values()].map(({ models, ...r }) => ({ ...r, model: [...models].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '?' }))
  const total = { output: 0, input: 0, cacheRead: 0, cacheWrite: 0 }
  for (const r of list) for (const k of Object.keys(total)) total[k] += r[k]
  return { roles: list, total, activeMin: Math.round(active / 60e3) }
}

/** At most five characters, so the columns hold: 42.4k, 634k, 12.8M. */
const scaled = (v, unit) => `${v >= 100 ? Math.round(v) : v.toFixed(1)}${unit}`
const short = (n) => (n >= 1e6 ? scaled(n / 1e6, 'M') : n >= 1e3 ? scaled(n / 1e3, 'k') : String(n))

/** The receipt's lines: a total, then one per role, lead first. */
export function format(t) {
  const width = Math.max(14, ...t.roles.map((r) => r.role.length + 2))
  return [
    `${short(t.total.output)} output tokens, ${t.activeMin} active min`,
    ...t.roles.map(
      (r) =>
        `  ${r.role.padEnd(width)}${r.model.padEnd(9)}${short(r.output).padStart(5)} out   ${short(r.cacheRead).padStart(5)} cache read${r.runs > 1 ? `   (${r.runs} runs)` : ''}`,
    ),
  ]
}

/** The session's transcript and its subagents', by session id. Throws with a reason it can print. */
export function load({ home = homedir(), cwd = process.cwd(), sessionId = process.env.CLAUDE_CODE_SESSION_ID } = {}) {
  if (!sessionId) throw new Error('no CLAUDE_CODE_SESSION_ID in this shell')
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), 'projects')
  let dir = join(projects, cwd.replaceAll('/', '-'))
  // The directory name is derived from the path; if the derivation ever differs, the id is still unique.
  if (!existsSync(join(dir, `${sessionId}.jsonl`)) && existsSync(projects)) {
    const hit = readdirSync(projects).find((d) => existsSync(join(projects, d, `${sessionId}.jsonl`)))
    if (hit) dir = join(projects, hit)
  }
  const file = join(dir, `${sessionId}.jsonl`)
  if (!existsSync(file)) throw new Error(`no transcript for session ${sessionId} under ${projects}`)
  const subDir = join(dir, sessionId, 'subagents')
  const subagents = existsSync(subDir)
    ? readdirSync(subDir)
        .filter((f) => f.endsWith('.jsonl'))
        .sort()
        .map((f) => {
          const meta = join(subDir, f.replace(/\.jsonl$/, '.meta.json'))
          let type = 'unknown'
          try {
            type = JSON.parse(readFileSync(meta, 'utf8')).agentType ?? type
          } catch {}
          return { type, entries: parse(readFileSync(join(subDir, f), 'utf8')) }
        })
    : []
  return { main: parse(readFileSync(file, 'utf8')), subagents }
}

if (process.argv[1]?.endsWith('cost.mjs')) {
  const argv = process.argv.slice(2)
  const arg = (name) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const since = Date.parse(arg('--since') ?? '')
  try {
    if (Number.isNaN(since)) throw new Error('pass --since <ISO time the run started>')
    const { main, subagents } = load({ cwd: arg('--cwd') ?? process.cwd() })
    const t = tally(main, subagents, since)
    // A mistyped or future start would otherwise read as a run that cost nothing.
    if (!t.roles.length) throw new Error(`nothing logged since ${arg('--since')}; check the start time`)
    console.log(format(t).join('\n'))
  } catch (e) {
    console.log(`unavailable — ${e.message}`)
  }
}
