#!/usr/bin/env node
// The third doc check (DEC-S037, from muster DEC-144). `check-decisions` guards the decision
// record and `check-context` guards the two always-loaded context files; between them sits the
// rest of `docs/*.md`, which nothing reads.
//
// The failure this exists for is not drift. It is drift that was FOUND, FIXED, and came back.
// The originating project ran a five-day doc-consistency audit whose ledger recorded four rows as
// "**Fixed** in docs/CHEATSHEET.md". They were fixed on a branch that never merged. The trunk
// still described a version-bump step that had been retired a release earlier, and still listed a
// skill that does not exist, while the audit's own ledger asserted both were repaired. A finding
// recorded as closed and isn't is worse than one never found: the next sweep skips it.
//
// So a doc audit is not a fix. It is a snapshot, and a snapshot with no ratchet behind it decays
// back to where it started while its ledger claims otherwise. That is what this file is — the
// ratchet. Catching things today is not the job; the job is that the number cannot climb back off
// zero without a red build.
//
// WHAT IT CANNOT DO, stated here rather than left to be discovered (a guard whose blind spot is
// undocumented gets trusted for things it never checked). It reads structure, never prose. "Patch
// bumps happen in /its-dead" is a false sentence about a real skill — every token in it resolves.
// Only a reader catches that, and @doc-consistency is still the tool for it. What is mechanised
// here is the half that is mechanisable: does the thing named exist, and do two statements of the
// same fact agree.
//
// Project-specific knobs — the repo slug, which docs claim to be complete rosters, which are
// historical ledgers, and which slash commands are deliberately foreign — live in
// `.claude/doc-check.json`. This file is byte-identical across projects.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { PATHISH, isClaim, resolves } from './check-context.mjs'
import { REFERENCE } from './check-decisions.mjs'
import { load } from './gen-decisions-index.mjs'

const CONFIG = '.claude/doc-check.json'

export function config(path = CONFIG) {
  if (!existsSync(path)) throw new Error(`${path} is missing — check-docs needs its roster and exemption lists`)
  return { rosters: {}, historical: {}, foreignDecs: {}, knownForeign: [], ...JSON.parse(readFileSync(path, 'utf8')) }
}

const CFG = config()

/**
 * The docs that claim to be a COMPLETE roster, and of what.
 *
 * Completeness is the claim being checked, so these are listed by name — a doc that mentions a
 * skill in passing is not asserting it has them all, and holding it to that would be the cry-wolf
 * failure `check-context` was narrowed to avoid.
 */
export const ROSTERS = CFG.rosters

/**
 * Docs exempt from the path check, each with the reason.
 *
 * This is an exemption list and not an allowlist on purpose. An allowlist means a doc added next
 * year is unchecked by default and nobody notices; an exemption list means it is checked by
 * default and skipping it takes a deliberate line right here. The ratchet has to default to ON or
 * it only ever covers what someone remembered to enrol.
 *
 * Every doc here should be a HISTORICAL LEDGER — it describes what was true at a point in time, so
 * it cites files that were later deleted, correctly. A check that reddens a doc for being right is
 * the fastest way to get the check disabled.
 */
export const HISTORICAL = CFG.historical

/** Slash commands the docs name that are deliberately not this project's — plugin skills and
 *  Claude Code built-ins. Enumerated rather than pattern-matched so adding one is a decision. */
export const KNOWN_FOREIGN = new Set(CFG.knownForeign)

/**
 * Docs exempt from the decision-reference check, each with the reason.
 *
 * For a doc that legitimately cites ANOTHER repo's record — an estate survey, a cross-project
 * handoff, a comparison. Those ids will never resolve here and are not supposed to: DEC-S025 has
 * project decisions staying unprefixed, so one repo's `DEC-046` is indistinguishable from
 * another's by shape alone. Without this the only ways out are to stop citing sibling projects
 * precisely or to disable the check, and the second is what actually happens.
 *
 * Same shape as HISTORICAL and for the same reason: exemption list, not allowlist, each entry
 * carries its justification, and every exempted path is asserted to exist.
 */
export const FOREIGN_DECS = CFG.foreignDecs

/** This repo, as it appears in an issue URL. Configured rather than shelled out of `git remote`:
 *  the check runs in CI where the remote may be rewritten, and if the repo genuinely moves, a red
 *  build pointing at every stale link is the correct outcome, not a silent re-target. */
export const REPO = CFG.repo

/** Every top-level doc, plus the shell. Subdirectories are excluded by construction, which is the
 *  intent: `docs/decisions/` is `check-decisions`' subject, an audit directory is a frozen record
 *  of findings-as-of-a-date (it cites dead paths deliberately — that is what a finding IS), and
 *  design directories are mockups. `docs/DECISIONS.md` is generated and already fully checked. */
export const DOCS = [
  ...(existsSync('docs')
    ? readdirSync('docs')
        .filter((f) => f.endsWith('.md') && f !== 'DECISIONS.md')
        .sort()
        .map((f) => `docs/${f}`)
    : []),
  'CLAUDE.md',
]

const NPM_SCRIPT = /`npm run ([a-z][a-z0-9:-]*)`/g
const ISSUE_LINK = /\[(?:PR )?#(\d+)\]\((https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/(issues|pull)\/(\d+))\)/g

/** A slash-command mention. Two forms because the docs have two registers: `CLAUDE.md` and
 *  `AGENTS.md` write `` `/kill-this` `` in tables, `CHEATSHEET.md` is a plain-text printable card
 *  with no backticks at all. The negative lookahead is what keeps `/admin/shifts` and
 *  `/crew/calendar` — routes, not commands — out of the roster. */
const SLASH_COMMAND = /(?:`\/([a-z][a-z0-9-]*)`|(?:^|[\s(])\/([a-z][a-z0-9-]*)(?![\w/-]))/gm

const AGENT_MENTION = /@([a-z][a-z0-9-]*)/g

/** One failure line, in the `path:line — what` shape both sibling checks emit, so a red build
 *  reads the same however it was triggered. */
const at = (doc, i) => `${doc}:${i + 1}`

/**
 * Every decision id in the doc set resolves to a decision file.
 *
 * `check-decisions` scans `docs/decisions/` and the generated index. That boundary was about
 * ownership, not safety — the references in SPEC and PROJECT_PLAN and AGENTS were never checked by
 * anything. A decision id is exactly the kind of token that survives a rewrite of the sentence
 * around it.
 */
export function checkDecRefs(docs, ids) {
  const failures = []
  for (const { path, text } of docs) {
    if (path in FOREIGN_DECS) continue
    text.split('\n').forEach((line, i) => {
      for (const ref of line.matchAll(REFERENCE)) {
        if (!ids.has(ref[0])) failures.push(`${at(path, i)} — cites ${ref[0]}, which has no decision file`)
      }
    })
  }
  return failures
}

/**
 * Every `npm run X` names a real script.
 *
 * The originating shape: a guide told a reader to run a throughput extractor that does not exist
 * in that repo, and a skill file repeated the instruction. A command in a doc is an instruction
 * someone follows; a wrong one costs a debugging detour before anyone suspects the doc.
 */
export function checkNpmScripts(docs, scripts) {
  // A project with no package.json makes no `npm run` claims worth checking against nothing.
  if (!scripts) return []
  const failures = []
  for (const { path, text } of docs) {
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(NPM_SCRIPT)) {
        if (!(m[1] in scripts)) failures.push(`${at(path, i)} — cites \`npm run ${m[1]}\`, which is not a script`)
      }
    })
  }
  return failures
}

/**
 * A linked issue's display text matches the issue its URL opens, and the URL is this repo.
 *
 * `[#204](.../issues/207)` renders as a correct-looking citation and no human finds it — you
 * would have to hover all of them. It is the purest case for a script: two representations of one
 * fact, side by side, mechanically comparable, invisible to review.
 */
export function checkIssueLinks(docs, repo = REPO) {
  if (!repo) return []
  const failures = []
  for (const { path, text } of docs) {
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(ISSUE_LINK)) {
        const [, shown, , slug, kind, target] = m
        if (slug !== repo) failures.push(`${at(path, i)} — #${shown} links to ${slug}, not ${repo}`)
        else if (shown !== target) failures.push(`${at(path, i)} — reads #${shown} but links to ${kind}/${target}`)
      }
    })
  }
  return failures
}

/**
 * The skill and agent rosters agree with what is on disk, in BOTH directions.
 *
 * Documented-but-absent is the obvious half. Absent-from-the-roster is the half that actually bit:
 * a skill present in two docs and missing from the CHEATSHEET, the doc whose entire purpose is
 * being the complete one-page reference. A roster that is quietly missing an entry still looks
 * authoritative, which is worse than one that names something fake — nobody goes looking for what
 * a complete list does not mention.
 */
export function checkRosters(docs, { skills, agents }) {
  const failures = []
  const byPath = new Map(docs.map((d) => [d.path, d]))
  for (const [roster, claims] of Object.entries(ROSTERS)) {
    const doc = byPath.get(roster)
    // A roster absent from the documents in hand is not this function's business — it checks
    // TEXT against DISK. Whether the file exists at all is a fact about disk, and lives in
    // `checkRosterDocsExist` so that both can be exercised on injected fixtures without one
    // firing spuriously for the other's reason.
    if (!doc) continue
    const named = new Set()
    for (const m of doc.text.matchAll(SLASH_COMMAND)) named.add(m[1] ?? m[2])
    const mentioned = new Set([...doc.text.matchAll(AGENT_MENTION)].map((m) => m[1]))

    if (claims.skills)
      for (const s of skills) if (!named.has(s)) failures.push(`${roster} — roster omits /${s}, which exists on disk`)
    if (claims.agents)
      for (const a of agents) if (!mentioned.has(a)) failures.push(`${roster} — roster omits @${a}, which exists on disk`)
    // The reverse direction is scoped to names that LOOK like this project's own commands. A doc
    // may legitimately name a plugin skill (`/stripe-projects`) or a built-in (`/review`) that has
    // no file in `.claude/`, so an unknown name is only a failure when the roster presents it as
    // one of ours.
    for (const n of named) {
      if (!skills.has(n) && KNOWN_FOREIGN.has(n)) continue
      if (!skills.has(n)) failures.push(`${roster} — roster lists /${n}, which has no .claude/skills/ entry`)
    }
  }
  return failures
}

/**
 * Every repo path cited in a non-historical doc resolves. Same rule, same resolver, and the same
 * narrowness as `check-context` — a span must be rooted in a real top-level directory to count as
 * a claim, so bare filenames and git refs are ignored and `<angle brackets>` mark a placeholder.
 */
export function checkPaths(docs) {
  const failures = []
  for (const { path, text } of docs) {
    if (path in HISTORICAL) continue
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(PATHISH)) {
        const raw = m[1]
        if (!isClaim(raw)) continue
        if (!resolves(raw)) failures.push(`${at(path, i)} — cites \`${raw}\`, which does not exist`)
      }
    })
  }
  return failures
}

/**
 * Every exempted doc still exists.
 *
 * Without this, renaming a doc silently carries its exemption into the void while the new file
 * quietly enters the checked set — or worse, a doc gets exempted, deleted, and the entry sits
 * there implying a file that reviewers assume is covered by a documented exception. An exemption
 * list nobody can trust is a list that grows.
 */
export function checkExemptions() {
  return [
    ...Object.keys(HISTORICAL)
      .filter((p) => !existsSync(p))
      .map((p) => `${p} — exempted from the path check in ${CONFIG} but does not exist`),
    ...Object.keys(FOREIGN_DECS)
      .filter((p) => !existsSync(p))
      .map((p) => `${p} — exempted from the decision-reference check in ${CONFIG} but does not exist`),
  ]
}

/**
 * Every doc declared a roster still exists.
 *
 * `DOCS` is read off the filesystem, so deleting `CHEATSHEET.md` would not fail anything — the
 * roster check would simply find nothing to check and report clean. That is the silent hole this
 * whole file exists to close, so the completeness claim needs its own assertion rather than
 * riding on a doc happening to be present.
 */
export function checkRosterDocsExist() {
  return Object.keys(ROSTERS)
    .filter((p) => !existsSync(p))
    .map((p) => `${p} — named in ${CONFIG} as a roster but does not exist`)
}

/**
 * @param {{path: string, text: string}[]} [sources] injected documents; defaults to the real doc
 *   set. @param {object} [world] injected disk state. Both exist so every red branch is testable —
 *   a checker whose failure paths never run is a checker nobody knows still fires.
 */
export function check(sources, world) {
  const docs =
    sources ??
    DOCS.map((path) => ({ path, text: existsSync(path) ? readFileSync(path, 'utf8') : null })).filter((d) => {
      return d.text !== null
    })

  const w = world ?? {
    ids: new Set(load().keys()),
    scripts: existsSync('package.json') ? JSON.parse(readFileSync('package.json', 'utf8')).scripts : null,
    skills: new Set(readdirSync('.claude/skills')),
    agents: new Set(readdirSync('.claude/agents').map((f) => f.replace(/\.md$/, ''))),
  }

  return [
    ...(sources ? [] : [...checkExemptions(), ...checkRosterDocsExist()]),
    ...checkDecRefs(docs, w.ids),
    ...checkNpmScripts(docs, w.scripts),
    ...checkIssueLinks(docs),
    ...checkRosters(docs, w),
    ...checkPaths(docs),
  ]
}

if (process.argv[1]?.endsWith('check-docs.mjs')) {
  const failures = check()
  if (failures.length) {
    console.error(`✗ docs — ${failures.length} inconsistenc${failures.length === 1 ? 'y' : 'ies'}:\n`)
    for (const f of failures) console.error(`  ${f}`)
    console.error('')
    process.exit(1)
  }
  const exempt = Object.keys(HISTORICAL).length
  const foreign = Object.keys(FOREIGN_DECS).length
  console.log(
    `✓ docs — ${DOCS.length} docs: DEC refs, npm scripts and issue links resolve, ` +
      `skill/agent rosters match disk both ways, paths resolve ` +
      `(${exempt} historical ledger${exempt === 1 ? '' : 's'} exempt` +
      `${foreign ? `, ${foreign} citing another repo's record` : ''})`,
  )
}
