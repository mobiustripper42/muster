/**
 * How a decision record is read, in one place, because two gates read them and only one knew what
 * "frozen" meant.
 *
 * A record listed in `docs/decisions-baseline.txt` and unchanged since is FROZEN: editing it fails
 * the build, so `check-decisions` skips the schema, the byte cap and the lead-in rule for it. That
 * exemption is not leniency — it is the honest consequence of a file you are not allowed to change.
 *
 * NO OTHER GATE KNEW THAT. `check-dictionary` read the same records and applied its full rule set.
 * Registering one term with a forbidden alternate in muster produced 13 failures, and 5 were inside
 * DEC-041, DEC-077 and DEC-145 — all frozen, one of them a record's own title. The sanctioned fix
 * for a frozen record is converting it to schema v1, which for three records means authoring
 * `ruling`, `claims` and `revisit_if` apiece and retitling a decision, to register one word.
 *
 * That is a rule with no compliant action, and it gets worse with corpus size rather than better:
 * muster froze 149 records, soundings 12. It is also not specific to the dictionary — it is the
 * shape of ANY check applied to a corpus containing frozen records, so the next gate anyone writes
 * inherits it unless "frozen" lives somewhere both can read.
 *
 * `check-decisions` imports these and re-exports them, so its own public surface is unchanged.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

export const BASELINE_PATH = 'docs/decisions-baseline.txt'

/**
 * Line endings and a BOM are normalized before anything looks at the text.
 *
 * SHARED BECAUSE THE TWO SCRIPTS DISAGREED. The checker required `---\n` at byte 0, so a CRLF file
 * or a leading BOM produced an empty block: `idOf` returned undefined and the record failed as
 * `not-listed` forever — while the generator's lenient split had written a correct baseline line
 * for the very same file. The same strict guard also made `hasSchemaKey` false on a CRLF v1 record,
 * routing something modern into the legacy path.
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
 *  Half-normalizing was the first bug one layer down: `frontmatterBlock` normalized while the body
 *  slice still ran on raw bytes, so a CRLF record's `indexOf('\n---\n')` missed and the "body"
 *  handed to the prose rules was very nearly the whole file, frontmatter included. */
export function recordBody(text) {
  const t = normalize(text)
  const end = t.indexOf('\n---\n', 3)
  return end === -1 ? t : t.slice(end + 5)
}

export const hasSchemaKey = (block) => /^schema:/m.test(block)
export const idOf = (block) => block.match(/^id: *(\S+)/m)?.[1]
export const sizeOf = (text) => Buffer.byteLength(text, 'utf8')
export const fingerprint = (text) => createHash('md5').update(text, 'utf8').digest('hex')

/** `Map<id, fingerprint>`. A missing file is an empty baseline, which is the correct reading for a
 *  repo that never had legacy records — not an error. */
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

/**
 * The record files any gate must leave alone, as paths.
 *
 * `frozen` and not merely `listed`: a baselined record whose bytes changed is `edited`, which
 * `check-decisions` already fails with its own message. Suppressing a second gate on it would be
 * agreeing to ignore a file somebody changed, which is the opposite of what the freeze is for.
 *
 * Takes its directories rather than importing them, so a caller that has no business knowing about
 * `docs/decisions/archive` does not acquire one.
 */
export function frozenRecords(dirs, baselinePath = BASELINE_PATH) {
  const baseline = loadBaseline(baselinePath)
  const out = new Set()
  if (!baseline.size) return out
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
      const path = `${dir}/${f}`
      const text = readFileSync(path, 'utf8')
      const id = idOf(frontmatterBlock(text))
      if (id && legacyVerdict(id, text, baseline) === 'frozen') out.add(path)
    }
  }
  return out
}
