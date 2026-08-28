#!/usr/bin/env node
// The dictionary gate. Makes invented vocabulary impossible rather than discouraged.
//
// The failure it exists to stop: one cron job called the reconciler, the sweeper, and a third
// name, in a system where nobody could say what the job did. Synonym drift is not a style
// problem — when a model has one concept it uses one name, so three names means there is no
// fixed thing behind the word, and that is the shape fabrication takes in prose.
//
// Telling anyone to stop inventing terms has been tried. Only things that fail a build hold.
//
// SCOPE is prose in `docs/SPEC.md`, `docs/decisions/*.md` and `CLAUDE.md`. Not code, not commit
// messages, not session logs, not the worksheets — those are noisy, and noise is what kills
// gates. Fenced blocks, inline code spans and URLs are stripped before anything is read: a
// backticked `payment_method_types` is code that happens to live in a markdown file.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { load as parseYaml } from 'js-yaml'

export const DICT = 'docs/dictionary.yml'
export const BASELINE = 'docs/dictionary-baseline.txt'
export const OUT = 'docs/DICTIONARY.md'
const DECISIONS = 'docs/decisions'
const CONFIG = `${DECISIONS}/_config.json`

/** Rule 1's shape. Deliberately narrow — see `EXCLUDED` for why it cannot stand alone. */
export const ACRONYM = /\b(?:[A-Z]{2,6}(?:-[A-Z0-9])?|[0-9][A-Z]{2,})\b/g

/** Prose only. Everything here is code or a link wearing markdown. */
export const prose = (s) =>
  s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\bhttps?:\/\/\S+/g, ' ')

/**
 * Three exclusions, measured before they were written rather than guessed at. Without them the
 * rule fires 3,006 times on a corpus that is entirely grandfathered — 2,026 of those (67%) on
 * things that are not vocabulary at all.
 *
 *  1. RECORD IDS — `DEC` matched inside every `DEC-107`, 1,713 times, because `(-[A-Z0-9])?`
 *     eats the first digit of the number. Requirement ids (`REQ-CLAIM-1`) are the same class and
 *     are worse: the pattern cannot even see them whole, splitting them into `REQ` and `CLAIM-1`.
 *  2. DOC FILENAMES — `SPEC`, `CLAUDE`, `BRAND`. A filename is not a term.
 *  3. ORDINARY WORDS SHOUTED FOR EMPHASIS — `**NOT**`, `**NEVER**`, `GET`, `DEAD`. House style
 *     in this repo, 160 matches, and every one of them is English.
 *
 * The third one is FROZEN AT BASELINE, not computed live, and that is a correctness fix rather
 * than an optimization. Deriving it from the current corpus meant writing `zqx` once in any
 * prose file permanently exempted `ZQX` everywhere — the gate quietly widening its own
 * exemption every time anyone wrote a lowercase word, with no record that it had. Frozen, the
 * exemption is a committed list a person can read.
 */
export function excluded(token, families, shouted) {
  if (/^(?:DEC|REQ)$/.test(token)) return true
  if (families.some((f) => new RegExp(`^${f}(?:-[A-Z0-9])?$`).test(token))) return true
  if (/^(?:SPEC|CLAUDE|BRAND|DECISIONS|README|AGENTS|DICTIONARY|CHANGELOG)$/.test(token)) return true
  return shouted.has(token.toUpperCase())
}

/** Multi-word alternates have to survive a hard wrap. This repo's prose wraps around 95 chars,
 *  so `basis\npoints` is not hypothetical — and an alternate that goes dark at a line break is
 *  an alternate that stops being enforced by the act of editing a paragraph. */
export const altPattern = (alt) =>
  new RegExp(`\\b${alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'gi')

export function loadDictionary(path = DICT) {
  if (!existsSync(path)) return { entries: [], errors: [`${path} does not exist`] }
  let raw
  try {
    raw = parseYaml(readFileSync(path, 'utf8'))
  } catch (e) {
    // Without this, malformed YAML exits through a js-yaml stack trace rather than the
    // per-entry messages every other failure in this file produces.
    return { entries: [], errors: [`${path} is not valid YAML — ${String(e.message).split('\n')[0]}`] }
  }
  const errors = []
  if (!Array.isArray(raw)) return { entries: [], errors: [`${path} must be a list of entries`] }

  const seen = new Set()
  for (const [i, e] of raw.entries()) {
    const at = `${path} entry ${i + 1}${e?.term ? ` (${e.term})` : ''}`
    if (!e || typeof e !== 'object') {
      errors.push(`${at} — is not a block of keys`)
      continue
    }
    for (const k of Object.keys(e)) {
      if (!['term', 'says', 'not'].includes(k)) errors.push(`${at} — unknown key \`${k}\`. Three keys, no others`)
    }
    if (!e.term) errors.push(`${at} — no \`term\``)
    if (!e.says) errors.push(`${at} — no \`says\`. A term with no definition registers nothing`)
    else if (e.says.length > 160) errors.push(`${at} — \`says\` is ${e.says.length} characters, the limit is 160`)
    if (e.not !== undefined && !Array.isArray(e.not)) errors.push(`${at} — \`not\` must be a list, even an empty one`)
    if (e.term && seen.has(e.term.toLowerCase())) errors.push(`${at} — \`${e.term}\` is registered twice`)
    if (e.term) seen.add(e.term.toLowerCase())
  }
  return { entries: raw.filter((e) => e?.term), errors }
}

/** Files the gate reads, in a stable order. */
export function gatedFiles() {
  const files = ['docs/SPEC.md', 'CLAUDE.md'].filter(existsSync)
  if (existsSync(DECISIONS)) {
    for (const f of readdirSync(DECISIONS).filter((f) => f.endsWith('.md')).sort()) files.push(`${DECISIONS}/${f}`)
  }
  return files
}

/** `docs/DICTIONARY.md` as the YAML says it should be. Lives here rather than in the generator
 *  so `check` can compare without importing it — the generator depends on this file, never the
 *  other way round. */
export function render(entries) {
  const sorted = [...entries].sort((a, b) => a.term.toLowerCase().localeCompare(b.term.toLowerCase()))
  const out = [
    '# Dictionary',
    '',
    `**Generated from \`${DICT}\` by \`npm run gen:dictionary\` — do not edit this file.**`,
    '',
    'One name per concept. A term listed under **not** fails the build, naming its replacement.',
    'Vocabulary already in the docs when the gate shipped is grandfathered and does not have to',
    'be registered — but registering it is always welcome, and registering one is how its',
    'alternates start being caught.',
    '',
    `${sorted.length} terms.`,
    '',
    '| Term | Says | Not |',
    '|---|---|---|',
  ]
  for (const e of sorted) {
    const not = (e.not ?? []).length ? (e.not ?? []).map((n) => `\`${n}\``).join(', ') : '—'
    out.push(`| **${e.term}** | ${e.says} | ${not} |`)
  }
  out.push('')
  return out.join('\n')
}

/**
 * @param {object} [inject] test seam — a dictionary path and an explicit file list. Without it,
 *   `check()` reads the live corpus, which is what the gate does. With it, a test can state a
 *   behaviour that this repo's corpus happens not to exhibit: jig registers no forbidden
 *   alternates, so "an alternate warns rather than fails" was unobservable and the test asserting
 *   it had been quietly failing against a corpus it was never written for.
 */
export function check(inject) {
  const failures = []
  const warnings = []
  const fail = (where, msg) => failures.push(`${where} — ${msg}`)

  const { entries, errors } = loadDictionary(inject?.dict ?? DICT)
  for (const e of errors) failures.push(e)

  const families = existsSync(CONFIG) ? Object.keys(JSON.parse(readFileSync(CONFIG, 'utf8')).families ?? {}) : []
  const files = inject?.files ?? gatedFiles()
  const texts = new Map(files.map((f) => [f, prose(readFileSync(f, 'utf8'))]))

  // Grandfathered vocabulary — what was already in these files the day this shipped. The point
  // of the gate is NEW words, so the backlog is suppressed. Registration stays available: a
  // grandfathered term may be registered at any time, and doing so is always welcome.
  const lines = existsSync(BASELINE)
    ? readFileSync(BASELINE, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    : []
  const baseline = new Set(lines.filter((l) => !l.includes(':')))
  const shouted = new Set(lines.filter((l) => l.startsWith('shout:')).map((l) => l.slice(6).toUpperCase()))
  // `alt:<alternate>@<file>=<count>` — the count is what makes grandfathering a SNAPSHOT rather
  // than an amnesty. Warning on the bare alternate meant `not: [Stripe Elements]` never enforced
  // again anywhere, including in a document written tomorrow, which is half the feature gone.
  const altBaseline = new Map()
  for (const l of lines) {
    const m = l.match(/^alt:(.+)@(.+)=(\d+)$/)
    if (m) altBaseline.set(`${m[1]}@${m[2]}`, Number(m[3]))
  }

  const registered = new Map(entries.map((e) => [e.term.toLowerCase(), e]))

  // ── `says` bottoms out in ordinary English ──────────────────────────────────
  // A definition may not lean on another piece of jargon unless that jargon is itself
  // registered. This is the recursion that stops a dictionary defining one unknown with another.
  for (const e of entries) {
    for (const m of (e.says ?? '').matchAll(ACRONYM)) {
      const t = m[0]
      if (excluded(t, families, shouted)) continue
      if (registered.has(t.toLowerCase())) continue
      // EXACT, not substring. `"mmc".includes("mc")` forgave an unrelated `MC` inside MMC's own
      // definition — a hole in the one guard whose job is stopping a definition leaning on jargon.
      if (t.toLowerCase() === e.term.toLowerCase()) continue // a term may say its own name
      fail(DICT, `\`${e.term}\`'s definition leans on \`${t}\`, which is not registered`)
    }
  }

  for (const [file, text] of texts) {
    // ── Rule 2: forbidden alternates ──────────────────────────────────────────
    // Occurrences up to the baseline COUNT for this file are warned; anything beyond it fails.
    // So the three that were already here stay a cleanup list, and the fourth — typed today,
    // in this file or any other — is a red build.
    for (const e of entries) {
      for (const alt of e.not ?? []) {
        const allowed = altBaseline.get(`${alt.toLowerCase()}@${file}`) ?? 0
        let seen = 0
        for (const m of text.matchAll(altPattern(alt))) {
          seen++
          const line = text.slice(0, m.index).split('\n').length
          const msg = `\`${m[0].replace(/\s+/g, ' ')}\` is a forbidden alternate — the registered term is \`${e.term}\``
          if (seen <= allowed) warnings.push(`${file}:${line} — ${msg}`)
          else fail(`${file}:${line}`, msg)
        }
      }
    }

    // ── Rule 1: acronyms must be registered ───────────────────────────────────
    for (const m of text.matchAll(ACRONYM)) {
      const t = m[0]
      if (excluded(t, families, shouted)) continue
      if (registered.has(t.toLowerCase())) continue
      if (baseline.has(t)) continue // grandfathered
      const line = text.slice(0, m.index).split('\n').length
      fail(`${file}:${line}`, `\`${t}\` is not registered — add it to ${DICT} or use ordinary English`)
    }
  }

  // ── Freshness ───────────────────────────────────────────────────────────────
  // The same posture `check:decisions` takes with its index: the generator is a manual step,
  // and this is what makes forgetting it a red build rather than a markdown file that quietly
  // stops describing the YAML underneath it.
  if (!errors.length) {
    const want = render(entries)
    const have = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null
    if (have === null) fail(OUT, 'does not exist — run `npm run gen:dictionary`')
    else if (have !== want) fail(OUT, 'is stale — run `npm run gen:dictionary`')
  }

  return { failures, warnings }
}

// `endsWith` on argv[1], matching the five sibling gates. The URL comparison this replaces
// failed whenever the checkout path needed escaping — in a directory with a space, the script
// printed nothing and exited 0, which `npm run verify` reads as a pass. jig installs into
// arbitrary project checkouts, so that is a realistic path, not a hypothetical one.
if (process.argv[1]?.endsWith('check-dictionary.mjs')) {
  const { failures, warnings } = check()
  for (const w of warnings) console.log(`  ⚠ ${w}`)
  if (warnings.length) {
    console.log(`\n⚠ dictionary — ${warnings.length} grandfathered alternate${warnings.length === 1 ? '' : 's'} to clean up when convenient\n`)
  }
  if (failures.length) {
    console.error(`✗ dictionary — ${failures.length} problem${failures.length === 1 ? '' : 's'}:\n`)
    for (const f of failures) console.error(`  ${f}`)
    console.error('')
    process.exit(1)
  }
  const { entries } = loadDictionary()
  console.log(`✓ dictionary — ${entries.length} terms registered, ${gatedFiles().length} files gated, no unregistered vocabulary`)
}
