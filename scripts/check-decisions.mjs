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
import { createHash } from 'node:crypto'
// Named import, not default: js-yaml is CommonJS, and `import yaml from 'js-yaml'` resolves
// under vitest's transform but throws under plain node — which is how this script actually
// runs. The test suite passing is not evidence the gate runs.
import { load as parseYaml } from 'js-yaml'
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

// ── Schema v1 ────────────────────────────────────────────────────────────────
//
// Two parsers, on purpose. Legacy records keep going through `parseFrontmatter`, which is a
// hand-rolled reader for one flat block. Records carrying `schema: 1` go through js-yaml,
// because their frontmatter has nested lists of objects and a hand-rolled reader is how the
// original record ended up with `dumb:` and `boat:` as keys — a colon in prose parsing as a
// mapping and nobody noticing.
//
// The gate is the `schema: 1` key itself. A record without it is grandfathered and skipped.
// In jig that path should stay dead: the corpus started empty on 2026-08-27 and every record
// here is v1, so a record without the key is a mistake rather than history.
//
// THE COMMENT THAT USED TO BE HERE IS THE REASON THIS ONE IS. It declared a one-line blocker
// — `LISTS` knowing only `amends_spec`, so a `claims:` list threw and broke every downstream
// check — and closed with "convert nothing until the generator's parser is widened." The
// generator was widened in the very next commit; `LISTS` has held `claims` and `supersedes`
// since. The instruction outlived its condition by weeks and was still being obeyed when jig
// read it, because nothing retires a comment. This is the corpus-rot argument arriving one
// level down, and the reason `revisit_if` is required in jig's schema and optional in
// muster's: prose about the state of the code cannot be trusted to notice it changed.
//
// Claim TARGETS are deliberately not resolved. `kind` is checked against the enum and the
// shape is checked; whether `src/foo.ts` exists is a resolver's job, and resolvers get built
// once the rewritten records show which kinds actually appear.

const SCHEMA_PATH = `${DIR}/decision-record.schema.json`

/** A `**Bold:**` / `**Bold.**` lead-in — the drift that put `Decision:`, `Tradeoff:` and
 *  `Status:` in prose. All structure lives in frontmatter now. Anchored to the line start so
 *  ordinary mid-sentence bold is untouched. */
const BOLD_LEAD_IN = /^\*\*([A-Z][^*\n]{0,40})[:.]\*\*/m

const MAX_BYTES = 2000

/**
 * The two frontmatter predicates the sweep runs on, exported so tests assert the real thing.
 *
 * Three tests used to define their own copy of each and assert against the copy, so changing the
 * implementation left all three green — a test that cannot fail is worse than no test, because it
 * reads as coverage. `hasSchemaKey` in particular guards the opt-in gate, and that gate was
 * already broken when the review found it.
 *
 * `hasSchemaKey` matches the KEY, not a formatting of its value: `/^schema: *1 *$/m` is stricter
 * than YAML, so `schema: 1  # v1 draft` and `schema: "1"` both read as "never opted in" and the
 * record got zero enforcement with nothing saying so.
 */
export const hasSchemaKey = (block) => /^schema:/m.test(block)
export const idOf = (block) => block.match(/^id: *(\S+)/m)?.[1]

/**
 * Bytes of the whole record.
 *
 * IT USED TO SUBTRACT `## Amendment` SECTIONS, and that carve-out is gone with the convention it
 * served (DEC-J003). A change of mind is a new record with `supersedes:`, not a section appended
 * to an old one, so there is nothing left for the cap to forgive.
 *
 * The carve-out was never free. It needed a fence-aware scanner, because a bare
 * `/^## Amendment\b/m` truncated at the first such line anywhere — and a record that merely
 * QUOTED the convention measured 21 bytes, escaping both this cap and the bold-lead-in rule. A
 * decision about how to write amendments is exactly the kind this repo writes. Whole-file
 * measurement has no such hole to guard.
 */
export const sizeOf = (text) => Buffer.byteLength(text, 'utf8')

/**
 * ── The legacy freeze ────────────────────────────────────────────────────────
 *
 * A record with no `schema:` key used to be skipped outright — past the schema, past the byte
 * cap, past the lead-in rule. That is how a repo adopts this gate with a corpus written before
 * it existed, and it is also how a record written yesterday dodges every rule by omitting one
 * line. Nothing told the two apart. Muster still cannot.
 *
 * `docs/decisions-baseline.txt` is that distinction: id and fingerprint, one line per record,
 * generated ONCE at adoption by `gen-decisions-baseline.mjs`. Three consequences, all deliberate:
 *
 *   not listed        → fails. Omission stopped being an opt-out; getting on the list is a diff
 *                       a reviewer sees.
 *   listed, unchanged → skipped. Genuinely old, and left alone.
 *   listed, edited    → fails. Legacy records are frozen. Needing to change one is the signal to
 *                       convert it to v1 — splitting it if it turns out to be several decisions.
 *
 * jig's baseline is empty, so it grandfathers nothing. That is where its strictness comes from
 * now: a fact about its corpus rather than a branch hardcoded to one repo's history.
 */
export const BASELINE_PATH = 'docs/decisions-baseline.txt'

/**
 * Every directory holding records. BOTH scripts read this, and that is the point.
 *
 * The checker swept `docs/decisions/` and `docs/decisions/archive/`; the generator read only the
 * first. So an archived legacy record — untouched, genuinely historical — got no baseline line
 * and then failed as `not-listed`, permanently, on a file nobody had opened. Exactly the corpus
 * this gate exists to let a project adopt.
 */
export const RECORD_DIRS = [DIR, `${DIR}/archive`]

/**
 * The frontmatter block, or `''` if there is none.
 *
 * ALSO SHARED BECAUSE THE TWO SCRIPTS DISAGREED. The checker required `---\n` at byte 0, so a
 * CRLF file or a leading BOM produced an empty block: `idOf` returned undefined and the record
 * failed as `not-listed` forever — while the generator's lenient split had written a correct
 * baseline line for the very same file. The same strict guard also made `hasSchemaKey` false on a
 * CRLF v1 record, routing something modern into the legacy path.
 *
 * Line endings are normalized before anything looks at the text, so a corpus written on Windows
 * reads the same as one written here.
 */
const normalize = (text) => text.replace(/^﻿/, '').replace(/\r\n/g, '\n')

export function frontmatterBlock(text) {
  const t = normalize(text)
  if (!t.startsWith('---\n')) return ''
  const end = t.indexOf('\n---\n', 3)
  return end === -1 ? '' : t.slice(4, end)
}

/** Everything after the frontmatter, off the SAME normalized text the block came from.
 *
 *  Half-normalizing was the first bug one layer down: `frontmatterBlock` normalized while the
 *  body slice still ran on raw bytes, so a CRLF record's `indexOf('\n---\n')` missed and the
 *  "body" handed to the prose rules was very nearly the whole file, frontmatter included. */
export function recordBody(text) {
  const t = normalize(text)
  const end = t.indexOf('\n---\n', 3)
  return end === -1 ? t : t.slice(end + 5)
}

export const fingerprint = (text) => createHash('md5').update(text, 'utf8').digest('hex')

/** `Map<id, fingerprint>`. A missing file is an empty baseline, which is the correct reading for
 *  a repo that never had legacy records — not an error. */
export function loadBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) return new Map()
  return new Map(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => l.replace(/#.*/, '').trim())
      .filter(Boolean)
      .map((l) => l.split(/\s+/))
      .filter(([id, hash]) => id && hash)
      .map(([id, hash]) => [id, hash]),
  )
}

/** `frozen` — leave it alone. `not-listed` / `edited` — fail, with different advice. */
export function legacyVerdict(id, text, baseline) {
  const known = baseline.get(id)
  if (!known) return 'not-listed'
  return known === fingerprint(text) ? 'frozen' : 'edited'
}

/** The subset of draft 2020-12 the schema actually uses. Written out rather than pulled in
 *  because it is ~70 lines against a dependency, and because every message here has to name
 *  the key and the limit — a validator that says "does not match schema" is a validator
 *  nobody can act on. */
function validateAgainstSchema(schema, value, path, root, errs) {
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/')
    return validateAgainstSchema(target.reduce((o, k) => o[k], root), value, path, root, errs)
  }
  const at = path || 'frontmatter'

  if (schema.const !== undefined && value !== schema.const) {
    errs.push(`${at} must be ${JSON.stringify(schema.const)}, not ${JSON.stringify(value)}`)
    return errs
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errs.push(`${at} is ${JSON.stringify(value)} — allowed: ${schema.enum.join(', ')}`)
    return errs
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errs.push(`${at} must be a list`)
      return errs
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errs.push(`${at} needs at least ${schema.minItems} entry — it has ${value.length}`)
    }
    if (schema.items) value.forEach((v, i) => validateAgainstSchema(schema.items, v, `${at}[${i}]`, root, errs))
    return errs
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      errs.push(`${at} must be text, not ${value === null ? 'empty' : typeof value}`)
      return errs
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errs.push(`${at} is ${value.length} characters — the limit is ${schema.maxLength}`)
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errs.push(`${at} is ${value.length} characters — the minimum is ${schema.minLength}`)
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errs.push(`${at} is ${JSON.stringify(value)}, which does not match ${schema.pattern}`)
    }
    if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      errs.push(`${at} is ${JSON.stringify(value)} — a date must be YYYY-MM-DD`)
    }
    return errs
  }
  if (schema.type === 'object' || schema.properties) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errs.push(`${at} must be a block of keys`)
      return errs
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) errs.push(`${at === 'frontmatter' ? '' : `${at}: `}missing required key \`${key}\``)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in (schema.properties ?? {}))) {
          errs.push(`${at === 'frontmatter' ? '' : `${at}: `}unknown key \`${key}\``)
        }
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) validateAgainstSchema(sub, value[key], at === 'frontmatter' ? key : `${at}.${key}`, root, errs)
    }
  }
  return errs
}

/**
 * Validate one `schema: 1` record. Returns a list of readable problems, empty when clean.
 *
 * @param {object} meta   parsed frontmatter
 * @param {string} body   everything after the frontmatter block
 * @param {number} bytes  size of the whole file on disk
 */
export function validateSchemaRecord(meta, body, bytes, schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))) {
  // The topic enum is injected here rather than baked into the schema: the list is a
  // project fact and the schema file is not project-specific.
  const withTopics = {
    ...schema,
    properties: { ...schema.properties, topic: { ...schema.properties.topic, enum: TOPICS } },
  }
  const errs = validateAgainstSchema(withTopics, meta, '', withTopics, [])

  if (bytes > MAX_BYTES) {
    errs.push(`is ${bytes} bytes — the cap is ${MAX_BYTES}. A decision that will not fit is more than one decision`)
  }
  /**
   * Scoped to the decision for the same reason the byte cap is, and it collided the same way.
   *
   * This rule exists because `**Decision:**`, `**Tradeoff:**` and `**Status:**` used to be prose
   * lead-ins standing in for structure that now lives in frontmatter. An amendment has no
   * frontmatter and never will — it is dated prose appended under a heading — and the preamble
   * prescribes the very phrasing this caught: *"appended as a dated `## Amendment` section saying
   * what still stands."* Seeds wrote that as `**What this changes, and what still stands.**` in
   * every one of its amendments.
   *
   * So the first amendment written under this schema failed the gate for following the
   * instruction the gate's own repo gives. Both halves were right; the scope was wrong.
   */
  const lead = body.match(BOLD_LEAD_IN)
  if (lead) {
    errs.push(`body opens a paragraph with \`**${lead[1]}:**\` — structure lives in frontmatter now, not in bold prose`)
  }
  return errs
}

/**
 * SUPERSESSION IS A PAIR, AND ONLY ONE HALF WAS ENFORCED.
 *
 * `CLAUDE.md` states the convention: the new record carries `supersedes: [DEC-<id>]`, the old one
 * flips to `status: superseded` with `superseded_by`. Writing the new record is the half you are
 * already doing. Going back to the old one is the half nothing checked, and skipping it leaves a
 * full, confident, retired argument that still greps and still reads live.
 *
 * Muster's DEC-107 is that record. It rules that sales tax is read fresh RATHER than frozen onto a
 * booking; it is retired; it names no successor; and `create-departure-payment-intent.ts` cites it
 * by id as "the DEC-107 freeze rule" — the opposite of its holding, from a record that is not even
 * current. Nothing in the toolchain could see any of that, because the citation resolves: the gate
 * verified the id existed, never that it was alive or that the claim matched.
 *
 * `rewritten` is id → frontmatter for every schema-v1 record; `seenIds` is every id on disk,
 * legacy files included. The difference between them is load-bearing and is what makes these rules
 * safe to ship onto an adopted corpus: a frozen or legacy record is on disk and NOT in the map, so
 * "you pointed at nothing" stays distinguishable from "you pointed at something this gate may not
 * ask anything of". Demanding an edit to a file the build forbids editing is a rule with no
 * compliant action — the trap the dictionary baseline already walked into, at 149 records.
 */
export function supersessionProblems(rewritten, seenIds) {
  const out = []
  const fail = (path, problem) => out.push([path, problem])
  const selfPointing = new Set()

  for (const [id, d] of rewritten) {
    /**
     * First, and it stops the record being looked at again. A self-pointer makes three other
     * rules true at once — the target is retired, the target does not list it, the chain never
     * terminates — and every one of them is the same typo wearing a different hat. Three messages
     * for one character is how a gate teaches people to skim its output.
     */
    if (d.superseded_by === id) {
      fail(d.path, `superseded_by itself`)
      selfPointing.add(id)
      continue
    }
    /**
     * The half that was missing. `withdrawn` is deliberately exempt: it means retired with nothing
     * replacing it, and demanding a pointer would force an invented one — worse than the gap.
     */
    if (d.status === 'superseded' && !d.superseded_by) {
      fail(d.path, 'status is `superseded` but no `superseded_by` — name the record that replaced it, or use `withdrawn` if nothing did')
    }
    if (!d.superseded_by) continue
    // `superseded_by` must land on a record that exists and is still the live one. Pointing at
    // a record that is itself superseded is a chain a reader has to walk, and pointing at
    // nothing is the dangling citation the whole gate exists to stop.
    const target = rewritten.get(d.superseded_by)
    if (!target) {
      if (!seenIds.has(d.superseded_by)) {
        fail(d.path, `superseded_by ${d.superseded_by}, which has no decision file`)
      } else {
        fail(d.path, `superseded_by ${d.superseded_by}, which has not been rewritten and so carries no status`)
      }
    } else if (target.status !== 'active') {
      fail(d.path, `superseded_by ${d.superseded_by}, whose status is ${target.status} — point at the live record`)
    } else if (!(target.supersedes ?? []).includes(id)) {
      /**
       * Reported on the SUCCESSOR's path, not the retired record's, because that is the file
       * somebody has to open. A message naming the file that is already correct sends the reader
       * to the wrong place first.
       */
      fail(target.path, `${d.superseded_by} does not list ${id} in \`supersedes\`, but ${id} names it as its successor`)
    }
  }

  // The other direction: A claims it replaced B, and nobody ever told B.
  for (const [id, d] of rewritten) {
    if (selfPointing.has(id)) continue
    // Deduped: `supersedes` declares no `uniqueItems`, so naming a record twice is schema-valid
    // and an ordinary YAML copy/paste slip. It is one claim however many times it is written.
    for (const b of new Set(d.supersedes ?? [])) {
      // The incoming half of the self-pointer short-circuit. Loop 1 stopped looking at that
      // record; without this, an unrelated claim drags it back and prints a second message about
      // the same character.
      if (selfPointing.has(b)) continue
      const target = rewritten.get(b)
      if (!target) {
        // Absent from the map AND absent from disk is a dangling claim. Absent from the map but
        // present on disk is frozen or legacy, and there is nothing to say about it from here.
        if (!seenIds.has(b)) fail(d.path, `supersedes ${b}, which has no decision file`)
        continue
      }
      /**
       * ALREADY SAID BY RULE 1, and this is the likeliest shape of the whole defect: the new
       * record written correctly, the old one never gone back to. Falling through to the
       * reciprocity branch below printed `superseded_by undefined` and called a half that names
       * nothing a disagreement between two named records — two messages for one omission, in the
       * one case that actually happens.
       */
      if (target.status === 'superseded' && !target.superseded_by) continue
      if (target.status !== 'superseded') {
        fail(target.path, `status is \`${target.status}\`, but ${id} declares \`supersedes: [${b}]\` — flip it to \`superseded\` and set \`superseded_by: ${id}\``)
      } else if (target.superseded_by !== id) {
        fail(target.path, `superseded_by ${target.superseded_by}, but ${id} declares \`supersedes: [${b}]\` — the two halves name different records`)
      }
    }
  }
  return out
}

export function check() {
  const failures = []
  const fail = (where, msg) => failures.push(`${where} — ${msg}`)

  // ── Schema v1, and the id sweep ───────────────────────────────────────────
  //
  // Both run BEFORE `load()`, deliberately. `load()`'s reader has no shape for schema v1's
  // nested claim list, so the first rewritten record throws there. Running first means the
  // schema errors still print rather than being swallowed by that throw — but it does NOT
  // rescue the checks below `load()`, which stop for the whole corpus. See the blocker note
  // at the top of this section.
  const schemaFile = existsSync(SCHEMA_PATH) ? JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) : null
  const baseline = loadBaseline()
  const seenIds = new Map()
  const rewritten = new Map()
  const sweep = (dir, label) => {
    if (!existsSync(dir)) return
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.md') && f !== '_preamble.md')) {
      const path = `${dir}/${f}`
      const text = readFileSync(path, 'utf8')
      const block = frontmatterBlock(text)

      // One id may exist in exactly one file. `load()` catches a duplicate within its own
      // directory and stops there; an archived copy alongside the live record is the case it
      // cannot see, and it is the one that makes a citation ambiguous.
      const id = idOf(block)
      if (id) {
        const prior = seenIds.get(id)
        if (prior) fail(path, `id ${id} is already used by ${prior} — one id, one file`)
        else seenIds.set(id, `${label}${f}`)
      }

      // The opt-in gate reads the PARSED value, not the raw line. A regex here is stricter
      // than YAML: `schema: 1  # v1` and `schema: "1"` are both valid and both fail
      // `/^schema: *1 *$/m`, so the record would be silently treated as legacy and get zero
      // enforcement — a rule that looks applied and isn't, which is the exact class this
      // whole gate exists to close. The cheap `^schema:` pre-filter keeps js-yaml off the
      // ~158 legacy blocks that have no such key.
      /**
       * No `schema:` key — so this is either genuine history or a record that forgot the line.
       * The baseline is the only thing that can tell them apart; see `legacyVerdict` above.
       *
       * This used to be an unconditional `fail`, which was right for jig and made the gate
       * un-adoptable by every repo that already had records — and before that an unconditional
       * skip, which is how a 4,188-byte record with a `**Decision:**` lead-in passed clean. Both
       * were the same mistake: one repo's history hardcoded as everyone's.
       */
      if (!hasSchemaKey(block)) {
        const verdict = legacyVerdict(id, text, baseline)
        if (verdict === 'frozen') continue
        if (verdict === 'edited') {
          fail(path, `is frozen as legacy in ${BASELINE_PATH} and has been edited — convert it to schema v1 (splitting it if it is really several decisions) and drop its line from the baseline`)
        } else {
          fail(path, `has no \`schema:\` key and is not listed in ${BASELINE_PATH} — new records are v1, and omitting the key is not a way out of the schema, the byte cap or the lead-in rule`)
        }
        continue
      }
      let meta
      try {
        meta = parseYaml(block)
      } catch (e) {
        fail(path, `frontmatter is not valid YAML — ${e.message.split('\n')[0]}`)
        continue
      }
      if (meta?.schema !== 1) {
        fail(path, `\`schema:\` is ${JSON.stringify(meta?.schema)} — the only version is 1`)
        continue
      }
      if (!schemaFile) {
        fail(path, `declares \`schema: 1\` but ${SCHEMA_PATH} does not exist`)
        continue
      }
      /**
       * THE CAP MEASURES THE WHOLE FILE, and the comment that used to sit here argued the
       * opposite at length — that the cap must exclude amendments, or the 2,000-byte limit and
       * the amendment rule together meant a record could be amended roughly never.
       *
       * That was a fair reading of a real collision, and DEC-J005 resolved it the other way:
       * amendments are retired, so nothing accumulates under a record and there is nothing for
       * the cap to forgive. A change of mind is a new record carrying `supersedes`.
       *
       * The argument is kept here in past tense on purpose. It was correct given its premise,
       * and someone will reach for it again the first time a record won't fit.
       */
      for (const problem of validateSchemaRecord(meta, recordBody(text), sizeOf(text), schemaFile)) fail(path, problem)
      rewritten.set(meta.id, { ...meta, path })
    }
  }
  // Same list the generator baselines. Drifting these apart is the bug that made an archived
  // legacy record fail as `not-listed` on a file nobody had touched.
  for (const dir of RECORD_DIRS) sweep(dir, dir === DIR ? '' : 'archive/')

  for (const [path, problem] of supersessionProblems(rewritten, seenIds)) fail(path, problem)

  let decisions
  try {
    decisions = load()
  } catch (e) {
    return [...failures, `${DIR} — ${e.message}`]
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
