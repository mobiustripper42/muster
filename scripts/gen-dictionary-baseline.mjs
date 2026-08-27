#!/usr/bin/env node
// Writes `docs/dictionary-baseline.txt` — the corpus as it stood when the gate shipped.
//
// Run ONCE, at adoption. Not wired into the build and not run again: re-running it would
// grandfather whatever unregistered vocabulary had crept in since, which is the gate quietly
// disarming itself. It lives here so the snapshot is reproducible and reviewable rather than
// pasted in by hand.
//
// Three kinds of line, and the last two exist because the first version of this gate disarmed
// itself in two different ways that a review caught and reproduced:
//
//   <TERM>                    a grandfathered acronym — does not have to be registered
//   shout:<WORD>              an ordinary English word this repo shouts for emphasis
//   alt:<alternate>@<file>=N  a forbidden alternate already present, N times, in that file

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { ACRONYM, BASELINE, altPattern, prose, gatedFiles, loadDictionary } from './check-dictionary.mjs'

const CONFIG = 'docs/decisions/_config.json'
const families = existsSync(CONFIG) ? Object.keys(JSON.parse(readFileSync(CONFIG, 'utf8')).families ?? {}) : []
const files = gatedFiles()
const texts = new Map(files.map((f) => [f, prose(readFileSync(f, 'utf8'))]))
const all = [...texts.values()].join('\n')

// The shout-list is computed HERE, once, and frozen. Computing it live meant writing `zqx` in
// any prose file permanently exempted `ZQX` everywhere, with nothing recording that it had.
const lowercase = new Set(all.match(/\b[a-z]{2,}\b/g) ?? [])
const idOrFilename = (t) =>
  /^(?:DEC|REQ)$/.test(t) ||
  families.some((f) => new RegExp(`^${f}(?:-[A-Z0-9])?$`).test(t)) ||
  /^(?:SPEC|CLAUDE|BRAND|DECISIONS|README|AGENTS|DICTIONARY|CHANGELOG)$/.test(t)

const shout = new Set()
const terms = new Set()
for (const m of all.matchAll(ACRONYM)) {
  const t = m[0]
  if (idOrFilename(t)) continue
  if (lowercase.has(t.toLowerCase())) shout.add(t.toUpperCase())
  else terms.add(t)
}

// Per-file counts. The count is what makes this a snapshot rather than an amnesty: occurrences
// beyond it fail, so a fourth `Stripe Elements` typed tomorrow is a red build even though the
// three already here are only a cleanup list.
const alts = []
for (const e of loadDictionary().entries) {
  for (const alt of e.not ?? []) {
    for (const [file, text] of texts) {
      const n = [...text.matchAll(altPattern(alt))].length
      if (n) alts.push(`alt:${alt.toLowerCase()}@${file}=${n}`)
    }
  }
}

const out = [
  '# Grandfathered vocabulary — the corpus as it stood when the dictionary gate shipped.',
  '#',
  '# Generated ONCE by scripts/gen-dictionary-baseline.mjs and committed. Terms listed here do',
  '# not have to be registered; new vocabulary from this point forward does. Registering a',
  "# grandfathered term is always welcome — it is how that term's alternates start being caught.",
  '#',
  '# Re-running the generator would grandfather whatever crept in since, which is the gate',
  '# disarming itself. Add a term to docs/dictionary.yml instead.',
  '#',
  '#   <TERM>                    grandfathered acronym',
  '#   shout:<WORD>              ordinary English this repo shouts for emphasis (**NOT**, GET)',
  '#   alt:<alternate>@<file>=N  a forbidden alternate already present N times in that file.',
  '#                             Those N are warned; the N+1th is a failure, wherever it lands.',
  '',
  ...[...terms].sort(),
  '',
  ...[...shout].sort().map((s) => `shout:${s}`),
  '',
  ...alts.sort(),
  '',
]
writeFileSync(BASELINE, out.join('\n'))
console.log(`✓ ${BASELINE} — ${terms.size} terms, ${shout.size} shouted words, ${alts.length} pre-existing alternates`)
for (const a of alts) console.log(`  ${a}`)
