#!/usr/bin/env node
// Generates docs/DECISIONS.md from docs/decisions/*.md, and writes the pointer under each
// amended SPEC section's heading (DEC-S036, from muster DEC-141).
//
// Run: `npm run gen:decisions`. `npm run check:decisions` fails if the output is stale,
// so forgetting to run it is a red build rather than an invisible defect — which is the
// actual fix for a hand-maintained index's decay. There is still a step; it just can't be
// skipped quietly.
//
// THE DEC→DEC LEG IS GONE (DEC-S036, amended 2026-08-16). `amends:` frontmatter, its
// relation vocabulary, and the reciprocal "amended by" banner this used to stamp into the
// amended decision's file are all retired. A change to what a decision decided is now
// appended inside that decision's own file as a dated `## Amendment` section, so there is
// no second file to point at and nothing to keep in sync. The 25 banners this had written
// were converted to plain hand-owned `**See also**` lines in the same change — prose the
// generator neither writes nor strips.
//
// The DEC→SPEC leg SURVIVES and is not the same mechanism. It points from a decision into
// a numbered SPEC section and fails the build when a claimed spec change never landed —
// the largest single finding class in the audit behind DEC-S036, and it creates no second
// decision file, so none of the scattering argument applies to it.
//
// EVERYTHING PROJECT-SPECIFIC LIVES IN `docs/decisions/_config.json` — the topic order, the
// non-numeric id families, and the spec path. This file is byte-identical across every
// project that installs it, which is what lets it be classified `logic` and copied
// between repos without a per-project merge.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'

export const DIR = 'docs/decisions'
export const OUT = 'docs/DECISIONS.md'
const PREAMBLE = `${DIR}/_preamble.md`
const CONFIG = `${DIR}/_config.json`

/**
 * The editorial knobs, read from `docs/decisions/_config.json`.
 *
 * A missing config is an error, not a defaulted one. Every knob here is a statement about
 * a specific project's record — the topic order is its reading order, the families are its
 * history — and inventing a default for either would put a plausible-looking wrong answer
 * in a generated file that people then trust.
 */
export function config(path = CONFIG) {
  if (!existsSync(path)) {
    throw new Error(`${path} is missing — the decision record needs its topic order and id families declared`)
  }
  const c = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(c.topics) || !c.topics.length) throw new Error(`${path}: topics must be a non-empty array`)
  if (c.families && typeof c.families !== 'object') throw new Error(`${path}: families must be an object`)
  return { spec: 'docs/SPEC.md', families: {}, ...c }
}

// Resolved once at import so the constants below read like the constants they replaced.
// Tests inject their own via the optional trailing parameters rather than mutating these.
const CFG = config()

/** Topic order is the index's reading order and is not derivable from the files — it is
 *  editorial. An unknown topic in frontmatter fails the check rather than appending
 *  silently to the bottom, where nobody would see it. */
export const TOPICS = CFG.topics

/** Where each non-numeric id family sits in the record's chronology, as a fractional rank
 *  between the numeric ids that bracket it. See `rank()` for why this has to exist. */
export const FAMILIES = CFG.families

export const SPEC = CFG.spec

/**
 * Does this record have a bare-numeric main line (`DEC-001`), or is every id prefixed?
 *
 * Set false for a record built entirely on one family, and the citation scan stops treating
 * `DEC-001` as one of ours. That is not a nicety: seeds' own record is all `DEC-S###`, and it
 * cites plain numeric ids *on purpose* — DEC-S025 exists to say that a project's own decisions
 * stay unprefixed. Matching those would report another repo's record as this one's dangling
 * references, and a check that reddens a doc for being right is the fastest way to get the check
 * disabled.
 */
export const NUMERIC_IDS = CFG.numericIds ?? true

// The DEC→SPEC leg, and the only leg left. It catches the pattern the originating audit
// named as its largest finding class — a change that lands in a decision and never in the
// spec it claims to change.
//
// Frontmatter keys whose value is a list of entries rather than a scalar. Enumerated
// because the parser has to know a list is open before it reads the first `- ` under it.
// `claims` and `supersedes` joined for schema v1 (issue #816). Until they did, `load()` threw
// on the first converted record — and because every check downstream of `load()` runs off its
// map, converting ONE record stopped reference, topic and freshness checking for ALL of them.
// The grandfathering was real; the incremental part was not, until this line.
const LISTS = new Set(['amends_spec', 'claims', 'supersedes'])
const SPEC_OPEN = '<!-- amended-by-dec: generated by `npm run gen:decisions` — do not edit by hand -->'
const SPEC_CLOSE = '<!-- /amended-by-dec -->'

/**
 * Section number → the index of its heading line, for every numbered heading in SPEC.
 *
 * Deliberately strict about what counts as a section: `## 2.4 Assignment View` and
 * `# 4. Parked …` both resolve, `### Booking availability` does not. A decision may only
 * anchor to a numbered section, because an unnumbered heading's text is prose that gets
 * reworded, and an anchor that silently stops resolving is the failure this check exists
 * to prevent.
 * @param {string} text
 */
export function specSections(text) {
  const sections = new Map()
  text.split('\n').forEach((line, i) => {
    const m = line.match(/^#{1,4} (\d+(?:\.\d+)*)\.? /)
    if (m && !sections.has(m[1])) sections.set(m[1], i)
  })
  return sections
}

/** `§2.4` / `2.4` → `2.4`. Tolerates the section sign the record writes in prose. */
export const sectionNumber = (s) => String(s).replace(/^§/, '').replace(/\.$/, '')

/**
 * Minimal frontmatter reader for exactly the shape this record writes — no YAML
 * dependency for one flat block plus lists of three scalars. A shape it can't parse is an
 * error, not a silent skip.
 * @param {string} text
 */
export function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) throw new Error('no frontmatter')
  const end = text.indexOf('\n---\n', 3)
  if (end === -1) throw new Error('unterminated frontmatter')
  const block = text.slice(4, end)
  const body = text.slice(end + 5)

  const unquote = (s) =>
    s.startsWith('"') && s.endsWith('"')
      ? s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      : s

  const meta = { amends_spec: [] }
  let list = null
  let entry = null
  for (const raw of block.split('\n')) {
    if (!raw.trim()) continue
    // A list item opens a new entry under whichever list key is currently open. Keyed on
    // the indent and the dash rather than on a specific first field — `amends_spec` is the
    // only list left, but keying on shape keeps a future one from needing this reworked.
    const item = raw.match(/^ {2}- (\w+): (.*)$/)
    if (item) {
      if (!list) throw new Error(`list item outside any list: ${JSON.stringify(raw)}`)
      entry = { [item[1]]: unquote(item[2]) }
      meta[list].push(entry)
      continue
    }
    const nested = raw.match(/^ {4}(\w+): (.*)$/)
    if (nested && entry) {
      entry[nested[1]] = unquote(nested[2])
      continue
    }
    // A BARE list item — `- DEC-107` — which `supersedes` uses and no list did before. It has
    // to be tried after the `key: value` form, not before: `- kind: file` would otherwise read
    // as the string "kind: file" and a claim would silently become prose. Ordering is the
    // whole correctness argument here.
    const scalar = raw.match(/^ {2}- (.+)$/)
    if (scalar) {
      if (!list) throw new Error(`list item outside any list: ${JSON.stringify(raw)}`)
      meta[list].push(unquote(scalar[1].trim()))
      entry = null
      continue
    }
    const top = raw.match(/^(\w+): ?(.*)$/)
    if (top) {
      if (LISTS.has(top[1])) {
        list = top[1]
        // Initialize ON OPEN rather than seeding every known list up front. `amends_spec`
        // keeps its seed below so an absent one still reads as `[]` — but an absent `claims`
        // must stay UNDEFINED, or the schema's `required` check passes and the reader gets
        // "needs at least 1 entry" for a key that was never written at all.
        meta[list] ??= []
        entry = null
        continue
      }
      /**
       * A NON-LIST KEY CLOSES ANY OPEN LIST. Without this, `list` stayed pointing at the last
       * list key seen, so every `  - ` line after an unrelated key attached to THAT list.
       *
       * Reproduced: a mis-keyed `notes:` list written under `claims:` made `check:decisions`
       * report `unknown key notes` — correctly — and then `gen:decisions` "repaired" the file by
       * dropping the unknown key and writing its items into `claims:`. The failure disappeared
       * and the record carried a claim its author never wrote. A gate finding laundered into a
       * fabrication is worse than either half alone.
       */
      list = null
      meta[top[1]] = unquote(top[2])
      continue
    }
    throw new Error(`unparseable frontmatter line: ${JSON.stringify(raw)}`)
  }
  return { meta, body }
}

/**
 * A decision's position in the record, or null if it has none.
 *
 * The id is usually the ONLY time proxy the record carries — decision files have no
 * `decided:` field — and the backwards-amendment guard in check-decisions.mjs is exactly
 * the assertion that id order tracks time. A family with no declared position makes that
 * guard unrunnable, which is how it came to be silently inert for five ids in the
 * originating project. So an unrecognized family is null, not a guess.
 *
 * `DEC-TBD` is null on purpose: it is the open-questions container, not a decision taken
 * at a point in time, so there is no honest answer. Anything new and unrecognized is null
 * for the same reason — null is what makes the next non-uniform id visible instead of
 * silent.
 * @param {string} id
 * @param {Record<string, number>} [families] injected in tests
 */
export function rank(id, families = FAMILIES) {
  const n = id.match(/^DEC-(\d+)$/)
  if (n) return { n: Number(n[1]), family: '', seq: 0 }
  // The hyphen is optional so both spellings in use resolve: `DEC-MSG-1` (a side family
  // alongside a numeric main line) and `DEC-S001` (a repo whose whole record is one
  // prefixed family). A family still has to be declared in `_config.json` either way.
  const f = id.match(/^DEC-([A-Z]+)-?(\d+)$/)
  if (f && f[1] in families) return { n: families[f[1]], family: f[1], seq: Number(f[2]) }
  return null
}

/**
 * The regex that finds decision citations in prose, built from the declared families.
 *
 * Anchored so `DEC-026-family` resolves to a real id, and so a sibling project's series —
 * whose record lives in another repo — never matches. Families are enumerated from config
 * rather than globbed for the same reason: an id shape nobody declared should read as
 * someone else's, not as a dangling reference in this record.
 * @param {Record<string, number>} [families] injected in tests
 */
export function referencePattern(families = FAMILIES, numeric = NUMERIC_IDS) {
  const alts = [...(numeric ? ['\\d{3}'] : []), ...Object.keys(families).map((f) => `${f}-?\\d+`), 'TBD']
  return new RegExp(`\\bDEC-(?:${alts.join('|')})\\b`, 'g')
}

/**
 * Negative if `a` comes before `b`, positive if after, 0 if the same position — and
 * **null when the record cannot say**, which callers must handle rather than treat as
 * equal.
 *
 * Cross-family is null even when the pre-split file listed one family before another:
 * that is document order within one sitting, not evidence about when each was decided.
 * Ranking them off it would manufacture a fact the record does not have.
 * @param {string} a
 * @param {string} b
 * @param {Record<string, number>} [families] injected in tests
 */
export function compareDecisionIds(a, b, families = FAMILIES) {
  const [x, y] = [rank(a, families), rank(b, families)]
  if (!x || !y) return null
  if (x.n !== y.n) return x.n - y.n
  if (x.family !== y.family) return null
  return x.seq - y.seq
}

// Sort order for the index and the SPEC pointer lists: the same ranking, so display order and
// the guard can never drift apart. Unrankable ids sort to the tail alphabetically —
// arbitrary, but sorting must be total where comparison is allowed to abstain.
const sortKey = (id) => {
  const r = rank(id)
  return r ? [0, r.n, r.family, r.seq, ''] : [1, 0, '', 0, id]
}
const byId = (a, b) => {
  const [x, y] = [sortKey(a), sortKey(b)]
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]) || x[3] - y[3] || x[4].localeCompare(y[4])
}

export function load(dir = DIR) {
  const files = readdirSync(dir).filter((f) => f.startsWith('DEC-') && f.endsWith('.md'))
  const decisions = new Map()
  for (const file of files) {
    const text = readFileSync(`${dir}/${file}`, 'utf8')
    let parsed
    try {
      parsed = parseFrontmatter(text)
    } catch (e) {
      throw new Error(`${dir}/${file}: ${e.message}`)
    }
    const { meta, body } = parsed
    if (!meta.id) throw new Error(`${dir}/${file}: no id`)
    if (decisions.has(meta.id)) throw new Error(`${dir}/${file}: duplicate id ${meta.id}`)
    decisions.set(meta.id, { ...meta, file, body, text })
  }
  return decisions
}

/** section number -> [{ from, scope }] — the DEC→SPEC edges, inverted onto the spec. */
export function specGraph(decisions) {
  const incoming = new Map()
  for (const [id, d] of decisions) {
    for (const a of d.amends_spec ?? []) {
      const sec = sectionNumber(a.section)
      if (!incoming.has(sec)) incoming.set(sec, [])
      incoming.get(sec).push({ from: id, scope: a.scope })
    }
  }
  for (const list of incoming.values()) list.sort((p, q) => byId(p.from, q.from))
  return incoming
}

/**
 * The block that goes under an amended SPEC section's heading.
 *
 * One fixed verb, and no vocabulary to choose from. Against the spec a reader has exactly
 * one question — *is what I am reading still true?* — and the scope answers it. The
 * retired DEC→DEC leg needed ten relations because it was answering a different question,
 * which decision is now authoritative; that question no longer arises, because a decision's
 * amendments live inside it.
 */
export function specBanner(edges) {
  const lines = edges.map((e) => (e.scope ? `> **Amended by ${e.from} — ${e.scope}**` : `> **Amended by ${e.from}**`))
  return [SPEC_OPEN, ...lines, SPEC_CLOSE].join('\n')
}

/**
 * SPEC text with every generated block removed — the exact inverse of the insertion in
 * `renderSpec`, so `strip(render(x)) === x` for a pristine spec.
 */
export function stripSpecBlocks(text) {
  const out = []
  let skipping = false
  for (const line of text.split('\n')) {
    if (line === SPEC_OPEN) {
      skipping = true
      // Exactly one blank line was inserted ahead of the block; take back exactly one.
      if (out[out.length - 1] === '') out.pop()
      continue
    }
    if (skipping) {
      if (line === SPEC_CLOSE) skipping = false
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

/**
 * SPEC with a generated block under each amended section's heading.
 *
 * An unresolvable section is skipped rather than thrown on: `check()` reports it as an
 * author error with the section number in the message, which is a better failure than the
 * generator dying halfway through a write.
 */
export function renderSpec(text, incoming) {
  const base = stripSpecBlocks(text)
  const sections = specSections(base)
  const at = new Map()
  for (const [sec, edges] of incoming) {
    const line = sections.get(sec)
    if (line !== undefined) at.set(line, edges)
  }
  const out = []
  base.split('\n').forEach((line, i) => {
    out.push(line)
    if (at.has(i)) out.push('', specBanner(at.get(i)))
  })
  return out.join('\n')
}

/**
 * Full file text for a decision.
 *
 * The body is passed through untouched. It used to have a generated banner spliced under
 * the heading; with the DEC→DEC leg retired there is nothing to splice, and an
 * `## Amendment` section inside the body is ordinary prose this must never rewrite.
 */
export function renderDecision(d) {
  // A schema-v1 record round-trips EVERY key. The writer used to emit four, so the first
  // `gen:decisions` after a conversion deleted `status`, `date`, `ruling`, `claims` and the
  // rest — and because `schema:` went with them the record read as legacy on the next run, so
  // the gate reported GREEN on a file whose entire decision it had just destroyed. Worse than
  // silent: `check:decisions` is the thing that tells you to run the generator.
  //
  // Key order follows `decision-record.schema.json`'s properties, so a converted record and a
  // hand-written one are byte-identical and neither churns the other.
  /**
   * TRIMMED, because one trailing space silently destroyed a record.
   *
   * `parseFrontmatter` does not trim values, so `schema: 1 ` parses as the string `'1 '`, missed
   * this comparison, and the record took the legacy render branch — which writes only id, title
   * and topic. Reproduced end to end: `ruling`, `claims`, `revisit_if`, `status` and `date` were
   * deleted from a valid record, exit 0, "1 file rewritten". The gate's own remediation is what
   * ate it.
   *
   * `hasSchemaKey` in check-decisions.mjs matches the KEY and is deliberately tolerant of the
   * value's formatting, so the two halves disagreed: the checker said "opted in", the generator
   * said "legacy", and the disagreement was a data loss rather than an error.
   */
  const v1 = String(d.schema).trim() === '1'
  const fm = ['---']
  if (v1) fm.push('schema: 1') // unquoted: the gate compares against the NUMBER 1
  fm.push(`id: ${d.id}`, `title: ${quote(d.title)}`, `topic: ${quote(d.topic)}`)
  if (v1) {
    fm.push(`status: ${quote(d.status)}`)
    // Quoted, deliberately. Bare `2026-08-26` is a YAML timestamp, and js-yaml hands back a
    // Date — which fails the schema's `type: string` on a record that is perfectly correct.
    fm.push(`date: ${quote(d.date)}`, `ruling: ${quote(d.ruling)}`)
    if (d.claims?.length) {
      fm.push('claims:')
      for (const c of d.claims) {
        fm.push(`  - kind: ${quote(c.kind)}`, `    target: ${quote(c.target)}`)
        if (c.note !== undefined) fm.push(`    note: ${quote(c.note)}`)
      }
    }
    if (d.supersedes?.length) {
      fm.push('supersedes:')
      for (const s of d.supersedes) fm.push(`  - ${s}`) // bare strings, not `key: value`
    }
    if (d.superseded_by) fm.push(`superseded_by: ${d.superseded_by}`)
    if (d.revisit_if) fm.push(`revisit_if: ${quote(d.revisit_if)}`)
  }
  if (d.amends_spec?.length) {
    fm.push('amends_spec:')
    for (const a of d.amends_spec) {
      fm.push(`  - section: ${quote(sectionNumber(a.section))}`, `    scope: ${quote(a.scope ?? '')}`)
    }
  }
  fm.push('---')

  const clean = d.body.replace(/^\n+/, '').replace(/\s+$/, '')
  return `${fm.join('\n')}\n\n${clean}\n`
}

const quote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export function renderIndex(decisions, preamble, topics = TOPICS) {
  const out = [preamble.replace(/\s+$/, ''), '', '## Index', '']

  const byTopic = new Map(topics.map((t) => [t, []]))
  for (const [id, d] of decisions) {
    if (!byTopic.has(d.topic)) throw new Error(`${d.file}: unknown topic ${JSON.stringify(d.topic)}`)
    byTopic.get(d.topic).push(id)
  }

  let indexed = 0
  for (const topic of topics) {
    const ids = byTopic.get(topic).sort(byId)
    if (!ids.length) continue
    out.push(`### ${topic}`)
    for (const id of ids) {
      const d = decisions.get(id)
      // One row, one subject, no annotation. Rows used to carry strike-throughs and
      // "amended by" clauses derived from the DEC→DEC graph; with amendments living inside
      // the decision they amend, there is no second decision to annotate a row with. The
      // index is a list of subjects — the current answer is in the file (DEC-S036, amended).
      out.push(`- ${id} — ${d.title}`)
      indexed++
    }
    out.push('')
  }

  // Completeness is ASSERTED, not printed. It used to be rendered as "Indexed N of M
  // DECs" — which an audit found had drifted to "124 of 124" against a real 131 rows /
  // 136 bodies, i.e. the number that claimed completeness was itself the thing that was
  // wrong.
  //
  // Generating it fixed the drift and created a worse problem: it is the ONLY
  // per-branch-varying line in a generated, committed file. Two branches that each add a
  // decision write different numbers here, git merges the DEC rows cleanly and silently
  // takes one footer, and the trunk lands stale with no conflict marker. A throw catches
  // the same invariant at generation time, where it's actionable, and costs the file
  // nothing: the row count is visible by looking at the list directly above.
  if (indexed !== decisions.size) {
    throw new Error(
      `index rendered ${indexed} of ${decisions.size} decisions — ` +
        `${decisions.size - indexed} did not reach a topic section`,
    )
  }

  out.push(
    `_**This file is GENERATED** by \`npm run gen:decisions\` —`,
    `edit \`${DIR}/DEC-*.md\`, not this file. \`npm run check:decisions\` fails on a stale index, a`,
    'duplicate id, an unknown topic, an unlanded SPEC amendment, or a reference to a decision',
    'that does not exist._',
    '',
  )
  return out.join('\n')
}

export function generate(dir = DIR, specPath = SPEC) {
  const decisions = load(dir)
  const preamble = readFileSync(PREAMBLE, 'utf8')
  const files = new Map()
  for (const [, d] of decisions) files.set(d.file, renderDecision(d))
  const specIncoming = specGraph(decisions)
  // A project with no spec still gets a working record; only the DEC→SPEC leg goes quiet.
  const spec = existsSync(specPath) ? renderSpec(readFileSync(specPath, 'utf8'), specIncoming) : null
  return { index: renderIndex(decisions, preamble), files, spec, decisions, specIncoming }
}

if (process.argv[1]?.endsWith('gen-decisions-index.mjs')) {
  const { index, files, spec, decisions, specIncoming } = generate()

  /**
   * Write only on a real change, and count every file written — including `OUT` and `SPEC`.
   *
   * Both properties were missing and they failed together. `OUT` was written unconditionally
   * and excluded from the tally, so editing `_preamble.md` regenerated the index and reported
   * `0 files rewritten` — a true sentence about the decision files and a false one about the
   * run. Caught in jig's first green build by appending a marker line to the preamble: the
   * marker reached `DECISIONS.md` while the run said nothing had been rewritten.
   *
   * The unconditional write is the same defect from the other side. Rewriting an unchanged
   * `OUT` every run churns its mtime, so "did the generator touch anything?" stops being
   * answerable from the filesystem — and this generator's whole contract with
   * `check-decisions.mjs` is that a stale index is detectable.
   */
  const written = []
  const put = (path, text) => {
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return
    writeFileSync(path, text)
    written.push(path)
  }

  for (const [file, text] of files) put(`${DIR}/${file}`, text)
  put(OUT, index)
  if (spec !== null) put(SPEC, spec)

  console.log(
    `✓ ${OUT} regenerated from ${decisions.size} decisions — ` +
      `${written.length} file${written.length === 1 ? '' : 's'} rewritten` +
      (written.length ? ` (${written.join(', ')})` : '') +
      `, ${specIncoming.size} SPEC section${specIncoming.size === 1 ? '' : 's'} annotated`,
  )
}
