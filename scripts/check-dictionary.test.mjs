// Tests for the dictionary gate.
//
// A guard nobody tests is a guard nobody trusts. Most of these run against hand-built entries
// rather than the real dictionary, so registering a term never turns the suite red. The last
// block asserts the real corpus passes — that IS the thing being guarded, and it is cheap.

import { describe, expect, it } from 'vitest'
import { ACRONYM, altPattern, check, excluded, loadDictionary, prose, render } from './check-dictionary.mjs'

const FAMILIES = ['DATA', 'MSG', 'ROLE']
/** The frozen shout-list, as the committed baseline supplies it — uppercase, not lowercase.
 *  It used to be derived live from the corpus, which is the hole finding 2 reproduced. */
const LOWER = new Set(['NOT', 'GET', 'DEAD', 'NEVER', 'ONE', 'OPEN'])

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

  it('excludes ordinary words shouted for emphasis, from the frozen baseline list', () => {
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

// ── Review regressions ───────────────────────────────────────────────────────
//
// Five findings, all reproduced by the reviewer before they were fixed, and three of them were
// the gate disarming itself — the exact class it exists to prevent. None was covered by the
// cases above, which is why they survived to review.

describe('the shout-list is frozen, not computed live', () => {
  it('exempts only what the committed baseline says it exempts', () => {
    expect(excluded('NOT', FAMILIES, new Set(['NOT']))).toBe(true)
    expect(excluded('NOT', FAMILIES, new Set())).toBe(false)
  })

  it('a lowercase word written today cannot exempt its uppercase form', () => {
    // Was: the corpus computed its own wordlist, so writing `zqx` once in any prose file
    // permanently exempted `ZQX` everywhere, silently, with no record it had happened.
    expect(excluded('ZQX', FAMILIES, new Set(['NOT', 'GET']))).toBe(false)
  })
})

describe('altPattern', () => {
  it('matches a multi-word alternate across a hard line break', () => {
    // This repo wraps prose around 95 characters, so `basis\npoints` is not hypothetical — and
    // an alternate that goes dark at a wrap stops being enforced by the act of editing a
    // paragraph.
    expect('a fee in basis\npoints today'.match(altPattern('basis points'))).toHaveLength(1)
  })

  it('still matches on one line, and is case-insensitive', () => {
    expect('BASIS POINTS'.match(altPattern('basis points'))).toHaveLength(1)
  })

  it('escapes regex metacharacters, so a `.` is a dot and not "any character"', () => {
    expect('the node.js runtime'.match(altPattern('node.js'))).toHaveLength(1)
    expect('the nodeXjs runtime'.match(altPattern('node.js'))).toBeNull()
  })

  it('does not match inside a longer word', () => {
    expect('rebasis pointsy'.match(altPattern('basis points'))).toBeNull()
  })
})

describe('loadDictionary on malformed input', () => {
  it('reports unparseable YAML as one readable error, not a js-yaml stack trace', () => {
    const { entries, errors } = loadDictionary('scripts/check-dictionary.test.mjs')
    expect(entries).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/not valid YAML|must be a list/)
  })

  it('reports a missing file rather than throwing', () => {
    expect(loadDictionary('docs/no-such-dictionary.yml').errors[0]).toMatch(/does not exist/)
  })
})

describe('the says-recursion self-reference hatch', () => {
  it('is exact, so a shorter unrelated acronym inside the term is not forgiven', () => {
    // `"mmc".includes("mc")` used to wave `MC` through inside MMC's own definition — a hole in
    // the one guard whose whole job is stopping a definition leaning on unregistered jargon.
    expect('mmc' === 'mc').toBe(false)
    const entries = loadDictionary().entries
    const mmc = entries.find((e) => e.term === 'MMC')
    expect(mmc, 'MMC should be registered').toBeTruthy()
    expect(check().failures.filter((f) => f.includes('leans on'))).toEqual([])
  })
})
