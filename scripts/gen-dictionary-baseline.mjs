#!/usr/bin/env node
// Writes `docs/dictionary-baseline.txt` — the corpus as it stood when the gate shipped.
//
// Run ONCE, at adoption. Not wired into the build and not run again: re-running it would
// grandfather whatever unregistered vocabulary had crept in since, which is the gate quietly
// disarming itself. It lives here so the snapshot is reproducible and reviewable rather than
// pasted in by hand.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { ACRONYM, BASELINE, prose, excluded, gatedFiles, loadDictionary } from './check-dictionary.mjs'

const CONFIG = 'docs/decisions/_config.json'
const families = existsSync(CONFIG) ? Object.keys(JSON.parse(readFileSync(CONFIG, 'utf8')).families ?? {}) : []
const texts = gatedFiles().map((f) => prose(readFileSync(f, 'utf8')))
const lowercaseCorpus = new Set(texts.join('\n').match(/\b[a-z]{2,}\b/g) ?? [])

const terms = new Set()
for (const t of texts) {
  for (const m of t.matchAll(ACRONYM)) if (!excluded(m[0], families, lowercaseCorpus)) terms.add(m[0])
}

// Forbidden alternates that ALREADY appear. These are warned rather than failed, so registering
// a term can never turn six old documents into a red build — the warning list is the drift.
const alts = []
for (const e of loadDictionary().entries) {
  for (const alt of e.not ?? []) {
    const re = new RegExp(`\\b${alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (texts.some((t) => re.test(t))) alts.push(alt.toLowerCase())
  }
}

const out = [
  '# Grandfathered vocabulary — the corpus as it stood when the dictionary gate shipped.',
  '#',
  '# Generated ONCE by scripts/gen-dictionary-baseline.mjs and committed. Terms listed here do',
  '# not have to be registered; new vocabulary from this point forward does. Registering a',
  '# grandfathered term is always welcome — it is how that term\'s alternates start being caught.',
  '#',
  '# Re-running the generator would grandfather whatever crept in since, which is the gate',
  '# disarming itself. Add a term to docs/dictionary.yml instead.',
  '#',
  '# An `alt:` line is a forbidden alternate already present in the corpus. Those are WARNED,',
  '# never failed, so registering a term cannot turn old documents into a red build.',
  '',
  ...[...terms].sort(),
  '',
  ...[...new Set(alts)].sort().map((a) => `alt:${a}`),
  '',
]
writeFileSync(BASELINE, out.join('\n'))
console.log(`✓ ${BASELINE} — ${terms.size} grandfathered terms, ${new Set(alts).size} pre-existing alternates`)
for (const a of new Set(alts)) console.log(`  alt already in corpus: ${a}`)
