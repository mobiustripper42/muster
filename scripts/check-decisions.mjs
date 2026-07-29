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
import { DIR, OUT, RELATIONS, TOPICS, compareDecisionIds, generate, load, reverseGraph } from './gen-decisions-index.mjs'

/**
 * The backwards-amendment rule, as a pure function so its failure paths are testable
 * without a fixture directory. Returns the failure message, or null if the edge is fine.
 *
 * A decision cannot amend one that did not exist when it was written. This is the check
 * that catches an id typo'd into a real-but-wrong decision, which a bare existence check
 * waves through.
 *
 * The third outcome is the point of #589. This used to bail out whenever either id failed
 * `^DEC-(\d+)$` — silently, no error, no warning — so it never once ran for `DEC-DATA-1`
 * (the 4th-most-cited id in the repo), the three `DEC-MSG-*`, `DEC-ROLE-1`, or `DEC-TBD`.
 * A guard that abstains without saying so is indistinguishable from a guard that passed,
 * which is the same failure as an integrity scan covering 12 tables of 38. Where the
 * record genuinely cannot order two ids, that is now a red build asking for a human, not
 * a shrug.
 * @param {string} from the amending decision's id
 * @param {string} to the amended decision's id
 */
export function checkAmendmentEdge(from, to) {
  const order = compareDecisionIds(to, from)
  if (order === null) {
    return `amends ${to}, whose position in the record cannot be compared with ${from} — the backwards-amendment check cannot run on this pair, so it needs a human (see rank() in gen-decisions-index.mjs)`
  }
  if (order >= 0) return `amends ${to}, which is not earlier than ${from} — an amendment points backwards`
  return null
}

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

  // `load()` only looks at files shaped `DEC-*.md`. Anything else in the directory —
  // a lowercase `dec-014-...`, a missing hyphen, a stray draft carrying a duplicate id —
  // would be invisible to both the generator and every check below, which is the silent
  // rot this whole record was split to eliminate. A shape it does not look at is worse
  // than a shape it cannot parse.
  const loaded = new Set([...decisions.values()].map((d) => d.file))
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== '_preamble.md')) {
    if (!loaded.has(f)) {
      fail(`${DIR}/${f}`, 'is not a recognized decision file — the name must be `DEC-<id>-<slug>.md`')
    }
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
      const backwards = checkAmendmentEdge(id, a.id)
      if (backwards) fail(at, backwards)
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
