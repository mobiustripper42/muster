#!/usr/bin/env node
// Validates the decision record (#564, DEC-141). Text-only, no deps — runs first in
// `npm run verify` so it fails in milliseconds rather than behind typecheck/test/build.
// CI needs no workflow step of its own; the existing verify job already runs `verify`.
//
// 564a validated the single 4,161-line file. 564b split it into docs/decisions/*.md with
// docs/DECISIONS.md as the generated index, so the checks moved with it. The one that
// matters most now is FRESHNESS: the generator is still a manual step, and this is what
// makes forgetting it a red build instead of an invisible defect. That — not discipline —
// is the actual fix for DEC-127's decay.
//
// It does not stop a DEC-number collision happening; two branches can still both pick 142.
// It stops one being silent. The second to merge goes red, where DEC-138's collision sat
// unnoticed across two branches until an audit swept all 134 decisions (#562).

import { readFileSync, readdirSync } from 'node:fs'
import { DIR, OUT, RELATIONS, TOPICS, generate, load, reverseGraph } from './gen-decisions-index.mjs'

// Anchored so `DEC-026-family` resolves to a real id while the seeds repo's `DEC-S019`
// series — whose record lives in another repo — never matches. The five non-numeric
// families are enumerated rather than globbed for the same reason.
const REFERENCE = /\bDEC-(?:\d{3}|MSG-\d+|ROLE-\d+|DATA-\d+|TBD)\b/g

export function check() {
  const failures = []
  const fail = (where, msg) => failures.push(`${where} — ${msg}`)

  let decisions
  try {
    decisions = load()
  } catch (e) {
    return [`${DIR} — ${e.message}`]
  }

  for (const [id, d] of decisions) {
    const at = `${DIR}/${d.file}`

    if (!d.file.startsWith(`${id}-`) && d.file !== `${id}.md`) {
      fail(at, `filename does not start with its id (${id})`)
    }
    if (!d.title) fail(at, 'no title')
    if (!TOPICS.includes(d.topic)) {
      fail(at, `unknown topic ${JSON.stringify(d.topic)} — add it to TOPICS in gen-decisions-index.mjs if it is real`)
    }

    for (const a of d.amends ?? []) {
      if (!RELATIONS[a.relation]) {
        fail(at, `unknown relation ${JSON.stringify(a.relation)} — one of: ${Object.keys(RELATIONS).join(', ')}`)
      }
      if (!decisions.has(a.id)) {
        fail(at, `amends ${a.id}, which has no decision file`)
        continue
      }
      // A decision cannot amend one that did not exist when it was written. This is the
      // check that catches an id typo'd into a real-but-wrong decision, which a bare
      // existence check waves through.
      const [from, to] = [id.match(/^DEC-(\d+)$/), a.id.match(/^DEC-(\d+)$/)]
      if (from && to && Number(to[1]) >= Number(from[1])) {
        fail(at, `amends ${a.id}, which is not earlier than ${id} — an amendment points backwards`)
      }
    }
  }

  // Every DEC-NNN mentioned in a decision file or the index resolves to a real decision.
  const sources = [
    ...readdirSync(DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => [`${DIR}/${f}`, readFileSync(`${DIR}/${f}`, 'utf8')]),
    [OUT, readFileSync(OUT, 'utf8')],
  ]
  for (const [path, text] of sources) {
    text.split('\n').forEach((line, i) => {
      for (const ref of line.matchAll(REFERENCE)) {
        if (!decisions.has(ref[0])) fail(`${path}:${i + 1}`, `reference to ${ref[0]}, which has no decision file`)
      }
    })
  }

  if (failures.length) return failures

  // Freshness. Everything above can pass on a record whose index and banners were never
  // regenerated, which is the exact defect this replaces.
  const { index, files } = generate()
  if (readFileSync(OUT, 'utf8') !== index) {
    fail(OUT, 'index is stale — run `npm run gen:decisions`')
  }
  for (const [file, text] of files) {
    if (readFileSync(`${DIR}/${file}`, 'utf8') !== text) {
      fail(`${DIR}/${file}`, 'amended-by banner or frontmatter is stale — run `npm run gen:decisions`')
    }
  }

  return failures
}

if (process.argv[1]?.endsWith('check-decisions.mjs')) {
  const failures = check()
  if (failures.length) {
    console.error(`✗ decision record — ${failures.length} problem${failures.length === 1 ? '' : 's'}:\n`)
    for (const f of failures) console.error(`  ${f}`)
    console.error('')
    process.exit(1)
  }
  const decisions = load()
  const incoming = reverseGraph(decisions)
  const edges = [...incoming.values()].reduce((n, l) => n + l.length, 0)
  console.log(
    `✓ decision record — ${decisions.size} decisions in ${DIR}/, ${edges} amendment edges across ` +
      `${incoming.size} amended decisions, index fresh, all references resolve`,
  )
}
