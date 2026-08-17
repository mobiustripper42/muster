#!/usr/bin/env node
// Validates the decision record (DEC-S036, from muster DEC-141). Text-only, no deps —
// runs first in `npm run verify` so it fails in milliseconds rather than behind
// typecheck/test/build. CI needs no workflow step of its own; the existing verify job
// already runs `verify`.
//
// The check that matters most is FRESHNESS: the generator is a manual step, and this is
// what makes forgetting it a red build instead of an invisible defect. That — not
// discipline — is the actual fix for a hand-maintained index's decay.
//
// It does not stop a DEC-number collision happening; two branches can still both pick 142.
// It stops one being silent. The second to merge goes red, where the originating project's
// collision sat unnoticed across two branches until an audit swept all 134 decisions.
//
// Like its generator, this file is byte-identical across projects — every project-specific
// knob is in `docs/decisions/_config.json`.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import {
  DIR,
  OUT,
  SPEC,
  TOPICS,
  generate,
  load,
  referencePattern,
  sectionNumber,
  specSections,
} from './gen-decisions-index.mjs'

/** Exported because `check-docs.mjs` applies the same rule to the rest of the doc set.
 *  This script's scan stops at `docs/decisions/` + the index, which was never a statement
 *  that references elsewhere are safe — only that this script's subject is the record. */
export const REFERENCE = referencePattern()

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
  const hasSpec = existsSync(SPEC)
  const sections = hasSpec ? specSections(readFileSync(SPEC, 'utf8')) : new Map()
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
      fail(at, `unknown topic ${JSON.stringify(d.topic)} — add it to topics in ${DIR}/_config.json if it is real`)
    }

    // A declared spec amendment must land on a section that exists. The originating
    // audit's largest finding class was the opposite direction — a decision claiming to
    // change SPEC and the change never landing — and an anchor nobody validates is how a
    // claim goes quiet: the section gets renumbered, the pointer stops resolving, and
    // prose says nothing.
    for (const a of d.amends_spec ?? []) {
      const sec = sectionNumber(a.section)
      if (!hasSpec) {
        fail(at, `amends_spec §${sec}, but ${SPEC} does not exist`)
        continue
      }
      if (!sections.has(sec)) {
        fail(at, `amends_spec §${sec}, which is not a numbered section of ${SPEC}`)
      }
      if (!a.scope?.trim()) {
        fail(at, `amends_spec §${sec} with no scope — the scope is what tells a reader of that section what changed`)
      }
    }

    // Every scope is rendered inside a bold span, so `**` in the text nests and the
    // banner renders as garbage — silently, since nothing about the build notices how
    // markdown looks. Caught the first time anyone wrote one.
    for (const a of d.amends_spec ?? []) {
      if (a.scope?.includes('**')) {
        fail(
          at,
          `scope for §${sectionNumber(a.section)} contains \`**\` — it renders inside a bold span, so the emphasis nests and breaks`,
        )
      }
    }
  }

  // Every decision id mentioned in a decision file or the index resolves to a real decision.
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

  // Freshness. Everything above can pass on a record whose index was never regenerated,
  // which is the exact defect this replaces.
  const { index, files, spec } = generate()
  if (readFileSync(OUT, 'utf8') !== index) {
    fail(OUT, 'index is stale — run `npm run gen:decisions`')
  }
  for (const [file, text] of files) {
    if (readFileSync(`${DIR}/${file}`, 'utf8') !== text) {
      fail(`${DIR}/${file}`, 'frontmatter is stale — run `npm run gen:decisions`')
    }
  }
  // This is what makes a declared amendment LAND: the pointer in the amended section is
  // regenerated from the declaration, so a claim that never reached the spec is a red
  // build rather than a line of prose nobody cross-read.
  if (spec !== null && readFileSync(SPEC, 'utf8') !== spec) {
    fail(SPEC, 'declared spec amendments have not landed in the section — run `npm run gen:decisions`')
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

  const specEdges = [...decisions.values()].reduce((n, d) => n + (d.amends_spec?.length ?? 0), 0)
  console.log(
    `✓ decision record — ${decisions.size} decisions in ${DIR}/, ` +
      `${specEdges} spec amendments landed, index fresh, all references resolve`,
  )
}
