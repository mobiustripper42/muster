#!/usr/bin/env node
// Writes `docs/decisions-baseline.txt` — the legacy corpus as it stood when the schema gate
// arrived. One line per record: id, then a fingerprint of the whole file.
//
// Run ONCE, at adoption. Not wired into `verify` and not run again. Re-running it would sweep up
// whatever forgot its `schema:` key since, which is the gate quietly disarming itself — the same
// warning `gen-dictionary-baseline.mjs` carries, for the same reason.
//
// WHAT THE FINGERPRINT IS FOR, and it is not tamper-proofing. A listed record is frozen: needing
// to change one is the signal to convert it to schema v1, splitting it if it turns out to be
// several decisions. Without the fingerprint, "legacy" would mean a file that can be edited
// forever with no gate reading it, which is the corner this repo keeps finding things rotting in.
//
// Records ALREADY carrying `schema:` are skipped, so this can never grandfather a v1 record — the
// generator has no way to weaken a record that already opted in.

// EVERY SHARED NAME BELOW IS SHARED ON PURPOSE. Review found this script and the checker
// disagreeing twice — on which directories hold records, and on how to find the frontmatter — and
// both disagreements rejected an untouched legacy record as `not-listed`. `RECORD_DIRS` and
// `frontmatterBlock` come from the checker so the two cannot drift again.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { BASELINE_PATH, RECORD_DIRS, fingerprint, frontmatterBlock, hasSchemaKey, idOf } from './check-decisions.mjs'

if (!RECORD_DIRS.some((d) => existsSync(d))) {
  console.error(`✗ ${RECORD_DIRS[0]} does not exist — nothing to baseline`)
  process.exit(1)
}

const lines = []
let skipped = 0
for (const dir of RECORD_DIRS) {
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md') && f !== '_preamble.md').sort()) {
    const text = readFileSync(`${dir}/${f}`, 'utf8')
    const block = frontmatterBlock(text)
    if (hasSchemaKey(block)) { skipped++; continue }
    const id = idOf(block)
    if (!id) {
      console.error(`✗ ${dir}/${f} — no \`id:\` in frontmatter, so it cannot be baselined`)
      process.exit(1)
    }
    lines.push(`${id}  ${fingerprint(text)}`)
  }
}
lines.sort()

const header = [
  '# Legacy decision records, frozen at adoption of the schema v1 gate.',
  '#',
  '# Generated ONCE by scripts/gen-decisions-baseline.mjs. Do not re-run it and do not add lines',
  '# by hand: a record here is exempt from the schema, the byte cap and the lead-in rule, and the',
  '# whole point is that getting on this list is a diff somebody reads.',
  '#',
  '# These files are FROZEN. Editing one fails the build. To change a legacy decision, convert it',
  '# to schema v1 — splitting it if it is really several decisions — and delete its line here.',
  '',
]
writeFileSync(BASELINE_PATH, header.concat(lines, '').join('\n'))
console.log(
  `✓ ${BASELINE_PATH} — ${lines.length} legacy record${lines.length === 1 ? '' : 's'} frozen` +
    (skipped ? `, ${skipped} already on schema v1 and left alone` : ''),
)
