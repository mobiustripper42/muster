// Tests for the dictionary gate.
//
// A guard nobody tests is a guard nobody trusts. Most of these run against hand-built entries
// rather than the real dictionary, so registering a term never turns the suite red. The last
// block asserts the real corpus passes — that IS the thing being guarded, and it is cheap.

import { describe, expect, it } from 'vitest'
import { ACRONYM, check, excluded, loadDictionary, prose, render } from './check-dictionary.mjs'

const FAMILIES = ['DATA', 'MSG', 'ROLE']
const LOWER = new Set(['not', 'get', 'dead', 'never', 'one', 'open'])

describe('prose', () => {
  it('strips fenced blocks, inline code and links — a backticked identifier is code', () => {
    expect(prose('a ```\nZQX\n``` b')).not.toMatch(/ZQX/)
    expect(prose('a `payment_method_types` b')).not.toMatch(/payment_method_types/)
    expect(prose('see https://example.com/ABC b')).not.toMatch(/ABC/)
  })

  it('leaves ordinary prose alone', () => {
    expect(prose('The SMS goes out.')).toContain('SMS')
  })
})

describe('the three approved exclusions', () => {
  // Measured before they were written: without these the rule fires 3,006 times on a corpus
  // that is entirely grandfathered, 2,026 of them (67%) on things that are not vocabulary.
  it('excludes record and requirement ids — `DEC` matched inside every DEC-107, 1,713 times', () => {
    expect(excluded('DEC', FAMILIES, LOWER)).toBe(true)
    expect(excluded('REQ', FAMILIES, LOWER)).toBe(true)
    expect(excluded('DATA-1', FAMILIES, LOWER)).toBe(true)
    expect(excluded('MSG-3', FAMILIES, LOWER)).toBe(true)
  })

  it('excludes doc filenames — a filename is not a term', () => {
    for (const f of ['SPEC', 'CLAUDE', 'BRAND', 'DECISIONS']) expect(excluded(f, FAMILIES, LOWER)).toBe(true)
  })

  it('excludes ordinary words shouted for emphasis, using the corpus as its own wordlist', () => {
    for (const w of ['NOT', 'GET', 'DEAD', 'NEVER', 'ONE']) expect(excluded(w, FAMILIES, LOWER)).toBe(true)
  })

  it('does NOT exclude a real acronym', () => {
    for (const a of ['SAQ-A', 'MMC', 'COI', 'CAS', 'RLS', 'ZQX']) expect(excluded(a, FAMILIES, LOWER)).toBe(false)
  })

  it('the id exclusion is anchored, so a real term starting with those letters still gates', () => {
    // `DECK` must not be waved through just because `DEC` is excluded.
    expect(excluded('DECK', FAMILIES, LOWER)).toBe(false)
    expect(excluded('REQS', FAMILIES, LOWER)).toBe(false)
  })
})

describe('the acronym shape', () => {
  it('matches what the spec asks for', () => {
    expect('SAQ-A 3DS bps CAS'.match(ACRONYM)).toEqual(['SAQ-A', '3DS', 'CAS'])
  })

  it('does not match a lowercase or mixed-case word', () => {
    expect('bps offSession Stripe'.match(ACRONYM)).toBeNull()
  })
})

describe('loadDictionary', () => {
  it('is the real file, and it validates', () => {
    const { entries, errors } = loadDictionary()
    expect(errors).toEqual([])
    expect(entries.length).toBeGreaterThan(0)
  })

  it('every says line is inside the 160-character limit', () => {
    for (const e of loadDictionary().entries) {
      expect(e.says.length, `\`${e.term}\` says is ${e.says.length}`).toBeLessThanOrEqual(160)
    }
  })

  it('every entry carries exactly the three keys', () => {
    for (const e of loadDictionary().entries) {
      expect(Object.keys(e).sort()).toEqual(['not', 'says', 'term'])
    }
  })
})

describe('render', () => {
  const entries = [
    { term: 'zulu', says: 'last alphabetically', not: [] },
    { term: 'Alpha', says: 'first alphabetically', not: ['first'] },
  ]

  it('alphabetizes case-insensitively, so `Alpha` precedes `zulu`', () => {
    const out = render(entries)
    expect(out.indexOf('**Alpha**')).toBeLessThan(out.indexOf('**zulu**'))
  })

  it('is a fixed point — regenerating rewrites nothing', () => {
    expect(render(entries)).toBe(render(entries))
  })

  it('renders an empty `not` as a dash rather than an empty cell', () => {
    expect(render(entries)).toContain('| **zulu** | last alphabetically | — |')
  })
})

describe('the real corpus', () => {
  it('passes — no unregistered vocabulary, no forbidden alternate outside the baseline', () => {
    expect(check().failures).toEqual([])
  })

  it('reports its pre-existing alternates as warnings rather than failing on them', () => {
    // Registering `CAS` with `not: [compare-and-swap]` lights up old documents. That list is
    // the drift the dictionary exists to find, so it must never be the thing that stops a
    // commit — a gate that punishes registering a term is a gate nobody registers terms in.
    const { warnings, failures } = check()
    expect(failures).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.join(' ')).toMatch(/forbidden alternate/)
  })
})
