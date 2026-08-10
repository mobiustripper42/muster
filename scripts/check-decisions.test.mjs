// Tests for the decision-record generator and validator (DEC-S036).
//
// These scripts decide whether the build passes — a guard nobody tests is a guard nobody
// trusts, and this suite exists because the originating project shipped a backwards-amendment
// check that was silently inert for five ids and nobody could tell.
//
// Almost everything here runs against hand-written fixtures, not the real record, so a
// legitimate edit to a decision never turns these red. The one exception is the last block,
// which asserts the real record is valid: that IS the thing being guarded, and it is cheap.
//
// Fixtures declare their own id families rather than borrowing the project's, so the suite
// tests the MECHANISM and stays green whatever `docs/decisions/_config.json` says.
//
// Drop this file if the project has no test runner — the scripts stand alone.

import { describe, expect, it } from 'vitest'
import {
  RELATIONS,
  TOPICS,
  banner,
  compareDecisionIds,
  parseFrontmatter,
  rank,
  referencePattern,
  renderDecision,
  renderSpec,
  reverseGraph,
  sectionNumber,
  specSections,
  stripBanner,
  stripSpecBlocks,
} from './gen-decisions-index.mjs'
import { check, checkAmendmentEdge } from './check-decisions.mjs'

/** A three-family record with the families sitting between DEC-014 and DEC-015 — the shape
 *  a project gets when a side family predates the numeric main line. */
const FAM = { MSG: 14.5, ROLE: 14.5, DATA: 14.5 }

const TOPIC = TOPICS[0]

const fm = `---
id: DEC-042
title: "A title with \\"quotes\\" and: a colon"
topic: ${JSON.stringify(TOPIC)}
amends:
  - id: DEC-020
    relation: refines
    scope: "one leg only"
  - id: DEC-013
    relation: supersedes
    scope: ""
---

## DEC-042: A title

Body.
`

describe('parseFrontmatter', () => {
  it('reads scalars, unescaping quotes and tolerating colons in values', () => {
    const { meta } = parseFrontmatter(fm)
    expect(meta.id).toBe('DEC-042')
    expect(meta.title).toBe('A title with "quotes" and: a colon')
    expect(meta.topic).toBe(TOPIC)
  })

  it('reads the amends list as objects', () => {
    const { meta } = parseFrontmatter(fm)
    expect(meta.amends).toEqual([
      { id: 'DEC-020', relation: 'refines', scope: 'one leg only' },
      { id: 'DEC-013', relation: 'supersedes', scope: '' },
    ])
  })

  it('returns the body without the frontmatter block', () => {
    expect(parseFrontmatter(fm).body.trim().startsWith('## DEC-042:')).toBe(true)
  })

  it('throws rather than silently skipping a file it cannot parse', () => {
    expect(() => parseFrontmatter('no frontmatter here')).toThrow(/no frontmatter/)
    expect(() => parseFrontmatter('---\nid: DEC-001\n')).toThrow(/unterminated/)
    expect(() => parseFrontmatter('---\n!! junk\n---\n\nbody\n')).toThrow(/unparseable/)
  })
})

describe('reverseGraph', () => {
  const decisions = new Map([
    ['DEC-010', { id: 'DEC-010', amends: [] }],
    ['DEC-020', { id: 'DEC-020', amends: [{ id: 'DEC-010', relation: 'revises', scope: 'a leg' }] }],
    ['DEC-030', { id: 'DEC-030', amends: [{ id: 'DEC-010', relation: 'refines', scope: '' }] }],
  ])

  it('inverts the declared edges onto their targets', () => {
    const incoming = reverseGraph(decisions)
    expect(incoming.get('DEC-010')).toEqual([
      { from: 'DEC-020', relation: 'revises', scope: 'a leg' },
      { from: 'DEC-030', relation: 'refines', scope: '' },
    ])
  })

  it('gives an unamended decision no entry at all', () => {
    expect(reverseGraph(decisions).has('DEC-020')).toBe(false)
  })
})

describe('banner', () => {
  it('renders the relation as a past participle and carries the scope', () => {
    const text = banner([{ from: 'DEC-092', relation: 'revises', scope: 'admin is a first-class identity' }])
    expect(text).toContain('**Revised by DEC-092 — admin is a first-class identity**')
  })

  it('omits the em-dash when there is no scope', () => {
    expect(banner([{ from: 'DEC-092', relation: 'revises', scope: '' }])).toContain('**Revised by DEC-092**')
  })

  it('round-trips through stripBanner, so regenerating is idempotent', () => {
    const edges = [{ from: 'DEC-092', relation: 'revises', scope: 'x' }]
    const body = `## DEC-020: Title\n\n${banner(edges)}\n\nReal body text.\n`
    expect(stripBanner(body)).not.toContain('Revised by')
    expect(stripBanner(body)).toContain('Real body text.')
  })

  it('leaves a body with no banner untouched', () => {
    const body = '## DEC-020: Title\n\nReal body text.\n'
    expect(stripBanner(body)).toBe(body)
  })
})

describe('renderDecision', () => {
  const d = {
    id: 'DEC-020',
    title: 'A title',
    topic: TOPIC,
    amends: [],
    body: '## DEC-020: A title\n\nOriginal body.\n',
  }

  it('puts the banner directly under the heading, where a Ctrl-F reader lands', () => {
    const out = renderDecision(d, [{ from: 'DEC-092', relation: 'revises', scope: '' }])
    const lines = out.split('\n').filter(Boolean)
    expect(lines.indexOf('## DEC-020: A title')).toBeLessThan(lines.findIndex((l) => l.includes('Revised by')))
    expect(lines.findIndex((l) => l.includes('Revised by'))).toBeLessThan(lines.indexOf('Original body.'))
  })

  it('is idempotent — regenerating an already-bannered file changes nothing', () => {
    const edges = [{ from: 'DEC-092', relation: 'revises', scope: 'one leg' }]
    const once = renderDecision(d, edges)
    const twice = renderDecision({ ...d, body: parseFrontmatter(once).body }, edges)
    expect(twice).toBe(once)
  })

  it('is idempotent when the body has a double blank line of its own', () => {
    // A global blank-line collapse in stripBanner made the generator a non-fixed-point
    // here: gen:decisions writes the file, then check:decisions re-generates, collapses
    // the unrelated gap, and calls the file it just wrote stale — a red build with no
    // author error to fix.
    const gappy = { ...d, body: '## DEC-020: A title\n\nFirst para.\n\n\nSecond para, after a wide gap.\n' }
    const edges = [{ from: 'DEC-092', relation: 'revises', scope: '' }]
    const once = renderDecision(gappy, edges)
    const twice = renderDecision({ ...gappy, body: parseFrontmatter(once).body }, edges)
    expect(twice).toBe(once)
    expect(once).toContain('First para.\n\n\nSecond para')
  })

  it('drops a stale banner when the last edge to a decision is removed', () => {
    const withBanner = renderDecision(d, [{ from: 'DEC-092', relation: 'revises', scope: '' }])
    const after = renderDecision({ ...d, body: parseFrontmatter(withBanner).body }, [])
    expect(after).not.toContain('Revised by')
    expect(after).toContain('Original body.')
  })

  it('escapes quotes in the title so the frontmatter it writes parses back', () => {
    const out = renderDecision({ ...d, title: 'has "quotes"' }, [])
    expect(parseFrontmatter(out).meta.title).toBe('has "quotes"')
  })
})

describe('amends_spec parsing', () => {
  const withSpec = `---
id: DEC-061
title: "A title"
topic: ${JSON.stringify(TOPIC)}
amends:
  - id: DEC-007
    relation: retires
    scope: "one leg"
amends_spec:
  - section: "2.4"
    scope: "the confirm step is gone"
  - section: "2.6"
    scope: "the acceptance is now automatic"
---

## DEC-061: A title

Body.
`

  it('reads both lists, keyed on the open list rather than the first field', () => {
    const { meta } = parseFrontmatter(withSpec)
    expect(meta.amends).toEqual([{ id: 'DEC-007', relation: 'retires', scope: 'one leg' }])
    expect(meta.amends_spec).toEqual([
      { section: '2.4', scope: 'the confirm step is gone' },
      { section: '2.6', scope: 'the acceptance is now automatic' },
    ])
  })

  it('gives a decision with neither list two empty lists, not undefined', () => {
    const { meta } = parseFrontmatter('---\nid: DEC-001\ntitle: "T"\ntopic: "X"\n---\n\nBody.\n')
    expect(meta.amends).toEqual([])
    expect(meta.amends_spec).toEqual([])
  })

  it('throws on a list item that opens before any list key', () => {
    expect(() => parseFrontmatter('---\nid: DEC-001\n  - section: "2.4"\n---\n\nBody.\n')).toThrow(/outside any list/)
  })

  it('round-trips through renderDecision', () => {
    const { meta, body } = parseFrontmatter(withSpec)
    const out = renderDecision({ ...meta, body }, [])
    expect(parseFrontmatter(out).meta.amends_spec).toEqual(meta.amends_spec)
  })

  it('normalizes the section sign, so §2.4 and 2.4 are the same anchor', () => {
    expect(sectionNumber('§2.4')).toBe('2.4')
    expect(sectionNumber('2.4')).toBe('2.4')
  })
})

describe('specSections', () => {
  const spec = ['# 0. Overview', 'text', '## 0.4 Glossary', 'text', '### 2.6.1 The ask', '## 2.6 Crew App'].join('\n')

  it('resolves every numbered heading depth, with or without the trailing dot', () => {
    const s = specSections(spec)
    expect(s.get('0')).toBe(0)
    expect(s.get('0.4')).toBe(2)
    expect(s.get('2.6.1')).toBe(4)
    expect(s.get('2.6')).toBe(5)
  })

  it('ignores unnumbered headings, whose text is prose that gets reworded', () => {
    expect(specSections('## Booking availability — a computed set').size).toBe(0)
  })
})

describe('renderSpec', () => {
  const spec = ['# 1. Substrate', '', 'Text about the substrate.', '', '## 1.3 Availability', '', 'Old prose.', ''].join(
    '\n',
  )
  const edges = new Map([['1.3', [{ from: 'DEC-140', scope: 'two mechanisms, not one rule engine' }]]])

  it("puts the block under the amended section's heading, not at the top of the file", () => {
    const out = renderSpec(spec, edges).split('\n')
    expect(out.indexOf('## 1.3 Availability')).toBeLessThan(out.findIndex((l) => l.includes('Amended by DEC-140')))
    expect(out.findIndex((l) => l.includes('Amended by DEC-140'))).toBeLessThan(out.indexOf('Old prose.'))
  })

  it('is a fixed point — regenerating an already-annotated spec changes nothing', () => {
    const once = renderSpec(spec, edges)
    expect(renderSpec(once, edges)).toBe(once)
  })

  it('strips back to the pristine spec exactly, so the insertion is fully reversible', () => {
    expect(stripSpecBlocks(renderSpec(spec, edges))).toBe(spec)
  })

  it('drops the block when the declaration is removed', () => {
    expect(renderSpec(renderSpec(spec, edges), new Map())).toBe(spec)
  })

  it('leaves the file alone when an anchor does not resolve — check() reports it instead', () => {
    expect(renderSpec(spec, new Map([['9.9', [{ from: 'DEC-001', scope: 'x' }]]]))).toBe(spec)
  })

  it('fails the freshness comparison when a declared amendment never landed', () => {
    // THE negative control: a decision declares it amends §1.3, the spec says nothing about
    // it, and `check()` compares the regenerated text against the file on disk. Before this
    // check existed, that claim lived in prose and nothing anywhere noticed it had not landed.
    expect(renderSpec(spec, edges)).not.toBe(spec)
  })
})

describe('rank and comparison', () => {
  it('places a declared family at the position its config gives it', () => {
    expect(compareDecisionIds('DEC-014', 'DEC-DATA-1', FAM)).toBeLessThan(0)
    expect(compareDecisionIds('DEC-DATA-1', 'DEC-015', FAM)).toBeLessThan(0)
    expect(compareDecisionIds('DEC-MSG-1', 'DEC-142', FAM)).toBeLessThan(0)
  })

  it('orders within a family by its trailing number', () => {
    expect(compareDecisionIds('DEC-MSG-1', 'DEC-MSG-3', FAM)).toBeLessThan(0)
    expect(compareDecisionIds('DEC-MSG-3', 'DEC-MSG-1', FAM)).toBeGreaterThan(0)
  })

  it('accepts the un-hyphenated spelling, so a DEC-S001-style record ranks', () => {
    expect(rank('DEC-S019', { S: 0 })).toEqual({ n: 0, family: 'S', seq: 19 })
    expect(compareDecisionIds('DEC-S019', 'DEC-S020', { S: 0 })).toBeLessThan(0)
  })

  it('abstains across families rather than inventing an order document position cannot support', () => {
    expect(compareDecisionIds('DEC-MSG-2', 'DEC-ROLE-1', FAM)).toBeNull()
    expect(compareDecisionIds('DEC-DATA-1', 'DEC-MSG-1', FAM)).toBeNull()
  })

  it('abstains on DEC-TBD, which is a container of open questions and has no date', () => {
    expect(rank('DEC-TBD', FAM)).toBeNull()
    expect(compareDecisionIds('DEC-TBD', 'DEC-001', FAM)).toBeNull()
  })

  it('abstains on an id family nobody declared, instead of passing silently', () => {
    // The guard's whole failure mode: it used to bail out without a word whenever an id
    // failed the numeric shape, so it never ran once for a record built on prefixed ids.
    expect(rank('DEC-S019', FAM)).toBeNull()
    expect(compareDecisionIds('DEC-S019', 'DEC-S020', FAM)).toBeNull()
  })
})

describe('referencePattern', () => {
  it('matches declared families and the numeric main line', () => {
    const re = referencePattern(FAM)
    expect('see DEC-042 and DEC-MSG-2 and DEC-TBD'.match(re)).toEqual(['DEC-042', 'DEC-MSG-2', 'DEC-TBD'])
  })

  it("does not match another repo's undeclared series", () => {
    expect('see DEC-S019'.match(referencePattern(FAM))).toBeNull()
  })

  it('matches an un-hyphenated family when it is declared', () => {
    expect('see DEC-S019'.match(referencePattern({ S: 0 }))).toEqual(['DEC-S019'])
  })
})

describe('checkAmendmentEdge', () => {
  it('passes an amendment pointing at an earlier decision', () => {
    expect(checkAmendmentEdge('DEC-142', 'DEC-081')).toBeNull()
  })

  it('catches a numeric amendment pointing forwards, or at itself', () => {
    expect(checkAmendmentEdge('DEC-081', 'DEC-142')).toMatch(/points backwards/)
    expect(checkAmendmentEdge('DEC-042', 'DEC-042')).toMatch(/points backwards/)
  })
})

describe('vocabulary', () => {
  it('renders every relation as a distinct past participle', () => {
    const rendered = Object.values(RELATIONS)
    expect(new Set(rendered).size).toBe(rendered.length)
  })

  it('reserves the strike-through for `supersedes` alone', () => {
    // An audit of 138 decisions found zero fully superseded, so a strike is the rare case.
    // If a second relation ever earns one, the index renderer's total/partial split has to
    // change with it.
    expect(RELATIONS.supersedes).toBe('superseded by')
    expect(Object.keys(RELATIONS).filter((r) => r === 'supersedes')).toHaveLength(1)
  })
})

describe('the real record', () => {
  it('is valid — no stale index, dangling reference, unknown topic, or bad edge', () => {
    expect(check()).toEqual([])
  })
})
