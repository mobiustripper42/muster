#!/usr/bin/env node
// Validates docs/DECISIONS.md structural integrity (#564).
//
// The record is one 4,000-line file with a hand-maintained topic index (DEC-127).
// Manual steps decay: four of the last nine DECs shipped without an index row, and
// DEC-138 named two unrelated decisions across `main` and `feature/reservations`
// because both branches drew from the same counter and nothing surfaced it (#562).
// This is that surface. Text-only, no deps — runs first in `npm run verify` so it
// fails in milliseconds rather than behind the typecheck/test/build chain.
//
// It does not stop a collision happening — two branches can still both pick 141.
// It stops one being *silent*: the second to merge goes red on `push: main`, where
// the previous one sat unnoticed until an audit swept all 134 decisions.

import { readFileSync } from 'node:fs'

export const FILE = 'docs/DECISIONS.md'

// A decision heading is colon-terminated: `## DEC-107: Payments — ...`.
// An amendment heading is not: `## DEC-107 amendment (11.2b) — ...`. DEC-107 is
// the only one today; the shape is what keeps it from reading as a duplicate id.
const DECISION_HEAD = /^## (DEC-[A-Z0-9-]+):/
const AMENDMENT_HEAD = /^## (DEC-[A-Z0-9-]+) /
const INDEX_ROW = /^- (?:~~)?(DEC-[A-Z0-9-]+)(?:~~)?(?: |$)/
const TALLY = /_Indexed (\d+) of (\d+) DECs/

// Anchored so `DEC-026-family` still resolves (it names a real DEC) while the seeds
// repo's `DEC-S019` series — whose record lives in another repo — does not match at
// all. The five non-numeric ids are enumerated rather than globbed for that reason.
const REFERENCE = /\bDEC-(?:\d{3}|MSG-\d+|ROLE-\d+|DATA-\d+|TBD)\b/g

// DEC-TBD is open questions, deliberately not a decision and deliberately unindexed
// (see the preamble). Everything else owes a row.
const UNINDEXED = new Set(['DEC-TBD'])

/**
 * @param {string} text contents of DECISIONS.md
 * @returns {{ failures: string[], decisions: number, indexRows: number, amendments: number }}
 */
export function checkDecisions(text) {
  const lines = text.split('\n')
  const failures = []
  const fail = (line, msg) => failures.push(`${FILE}:${line} — ${msg}`)

  const decisions = new Map() // id -> line
  const amendments = [] // { id, line }
  const indexRows = new Map() // id -> line
  let tally = null

  // The index region runs from the top to the first decision body. Index rows and
  // `###` headings below that are body prose — DEC-123 has its own sub-headings.
  const firstBody = lines.findIndex((l) => DECISION_HEAD.test(l))
  if (firstBody === -1) {
    fail(1, 'no decision headings found — is the file the right shape?')
    return { failures, decisions: 0, indexRows: 0, amendments: 0 }
  }

  lines.forEach((line, i) => {
    const n = i + 1

    const decision = line.match(DECISION_HEAD)
    if (decision) {
      const [, id] = decision
      if (decisions.has(id)) {
        fail(n, `duplicate id ${id} — already defined at ${FILE}:${decisions.get(id)}`)
      } else {
        decisions.set(id, n)
      }
      return
    }

    const amendment = line.match(AMENDMENT_HEAD)
    if (amendment) {
      amendments.push({ id: amendment[1], line: n })
      return
    }

    if (i < firstBody) {
      const row = line.match(INDEX_ROW)
      if (row) {
        const [, id] = row
        if (indexRows.has(id)) {
          fail(n, `duplicate index row for ${id} — already listed at ${FILE}:${indexRows.get(id)}`)
        } else {
          indexRows.set(id, n)
        }
      }
    }

    const t = line.match(TALLY)
    if (t) tally = { indexed: Number(t[1]), total: Number(t[2]), line: n }
  })

  // An amendment section has to hang off a decision that exists.
  for (const { id, line } of amendments) {
    if (!decisions.has(id)) fail(line, `amendment section for ${id}, which has no decision body`)
  }

  // Index row with no body: the row outlived its decision, or names a typo.
  for (const [id, line] of indexRows) {
    if (!decisions.has(id)) fail(line, `index row for ${id}, which has no decision body`)
  }

  // Body with no index row: the DEC-127 decay mode.
  for (const [id, line] of decisions) {
    if (!indexRows.has(id) && !UNINDEXED.has(id)) {
      fail(line, `${id} has no index row (DEC-127 requires one)`)
    }
  }

  // Every DEC-NNN mentioned anywhere in the file resolves to a real decision. This is
  // what caught DEC-114 citing "DEC-100 submit spinner" for what is actually DEC-089.
  lines.forEach((line, i) => {
    for (const ref of line.matchAll(REFERENCE)) {
      if (!decisions.has(ref[0])) fail(i + 1, `reference to ${ref[0]}, which has no decision body`)
    }
  })

  // The tally is the index's own claim about itself, and it drifts silently — it read
  // "124 of 124" against 137 rows when this check was written.
  const expectedIndexed = indexRows.size
  const expectedTotal = [...decisions.keys()].filter((id) => !UNINDEXED.has(id)).length
  if (!tally) {
    fail(firstBody + 1, 'no `_Indexed N of M DECs` tally found at the end of the index')
  } else if (tally.indexed !== expectedIndexed || tally.total !== expectedTotal) {
    fail(
      tally.line,
      `tally reads "Indexed ${tally.indexed} of ${tally.total}" but the file has ` +
        `${expectedIndexed} index rows and ${expectedTotal} indexable decisions`,
    )
  }

  return {
    failures,
    decisions: decisions.size,
    indexRows: indexRows.size,
    amendments: amendments.length,
  }
}

// CLI entry. Guarded so the test can import the checker without running it.
if (process.argv[1]?.endsWith('check-decisions.mjs')) {
  const result = checkDecisions(readFileSync(FILE, 'utf8'))

  if (result.failures.length) {
    const n = result.failures.length
    console.error(`✗ ${FILE} — ${n} problem${n === 1 ? '' : 's'}:\n`)
    for (const f of result.failures) console.error(`  ${f}`)
    console.error('')
    process.exit(1)
  }

  console.log(
    `✓ ${FILE} — ${result.decisions} decisions, ${result.indexRows} index rows, ` +
      `${result.amendments} amendment section${result.amendments === 1 ? '' : 's'}, ` +
      `all references resolve`,
  )
}
