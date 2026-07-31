#!/usr/bin/env node
// The third doc check. `check-decisions` guards the decision record and `check-context` guards the
// two always-loaded context files; between them sat 4,985 lines of `docs/*.md` that nothing read.
//
// The failure this exists for is not drift. It is drift that was FOUND, FIXED, and came back.
// The 2026-07-25 audit swept the whole doc set over five days and `docs/audit/2026-07-25/README.md`
// records rows 10/26/28/45 as "**Fixed** in `docs/CHEATSHEET.md`". They were fixed on
// `task/doc-consistency-sharded`, which never merged. `main` still said patch bumps happen "in
// /its-dead on PR merge" — retired at DEC-S013 — and still listed a `/session-start-hook` skill
// that does not exist, while the audit's own ledger asserted both were repaired. A finding that is
// recorded as closed and is not is worse than one never found: the next sweep skips it.
//
// So a doc audit is not a fix. It is a snapshot, and a snapshot with no ratchet behind it decays
// back to where it started while its ledger claims otherwise. That is what this file is — the
// ratchet. Every class below was at ZERO findings when it was written (except the roster check,
// which went red immediately on the CHEATSHEET). Catching things today is not the job; the job is
// that the number cannot climb back off zero without a red build.
//
// WHAT IT CANNOT DO, stated here rather than left to be discovered (#589's lesson: a guard whose
// blind spot is undocumented gets trusted for things it never checked). It reads structure, never
// prose. "Patch bumps happen in /its-dead" is a false sentence about a real skill — every token in
// it resolves. Only a reader catches that, and @doc-consistency is still the tool for it. What is
// mechanised here is the half that is mechanisable: does the thing named exist, and do two
// statements of the same fact agree.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { PATHISH, isClaim, resolves } from './check-context.mjs'
import { REFERENCE } from './check-decisions.mjs'
import { load } from './gen-decisions-index.mjs'

/** Every top-level doc, plus the shell. Subdirectories are excluded by construction, which is the
 *  intent: `docs/decisions/` is `check-decisions`' subject, `docs/audit/` is a frozen record of
 *  findings-as-of-a-date (it cites dead paths deliberately — that is what a finding IS), and
 *  `docs/design/` is mockups. `docs/DECISIONS.md` is generated and already fully checked. */
export const DOCS = [
  ...readdirSync('docs')
    .filter((f) => f.endsWith('.md') && f !== 'DECISIONS.md')
    .sort()
    .map((f) => `docs/${f}`),
  'CLAUDE.md',
]

/**
 * The docs that claim to be a COMPLETE roster, and of what.
 *
 * Completeness is the claim being checked, so these are listed by name — a doc that mentions a
 * skill in passing is not asserting it has them all, and holding it to that would be the cry-wolf
 * failure `check-context` was narrowed to avoid.
 *
 * `CHEATSHEET.md` is skills-only because that is what it claims to be: `CLAUDE.md:20` calls it the
 * "One-page printable **skill** reference". It has no agent section and demanding one would be the
 * check inventing a requirement rather than enforcing a stated one.
 */
export const ROSTERS = {
  'CLAUDE.md': { skills: true, agents: true },
  'docs/AGENTS.md': { skills: true, agents: true },
  'docs/CHEATSHEET.md': { skills: true, agents: false },
}

/**
 * Docs exempt from the path check, each with the reason.
 *
 * This is an exemption list and not an allowlist on purpose. An allowlist means a doc added next
 * year is unchecked by default and nobody notices; an exemption list means it is checked by
 * default and skipping it takes a deliberate line right here. The ratchet has to default to ON or
 * it only ever covers what someone remembered to enrol.
 *
 * Every doc below is a HISTORICAL LEDGER — it describes what was true at a point in time, so it
 * cites files that were later deleted, correctly. Running the path check over them produces four
 * findings today and all four are false: `docs/PROJECT_PLAN.md:186` cites
 * `docs/E2E-PILOT-WALKTHROUGH.md` and annotates it "(deleted 2026-07-25)" in the same sentence,
 * and `docs/SPEC.md:805` cites `src/builder/lock.ts` inside a struck passage whose whole point is
 * that the file is gone. A check that reddens a doc for being right is the fastest way to get the
 * check disabled.
 */
export const HISTORICAL = {
  'docs/SPEC.md': 'struck passages cite the files their decisions deleted (e.g. :805 on src/builder/lock.ts)',
  'docs/PROJECT_PLAN.md': 'shipped task rows cite what they retired; :186 annotates its own deletion date',
  'docs/RETROSPECTIVES.md': 'per-phase record of what was true at phase close',
  'docs/FUTURE_IDEAS.md': 'parked ideas cite sketches and drop-lists that predate the current tree',
  'docs/SECURITY_AUDIT.md': 'findings as of an audit date, same shape as docs/audit/',
}

/** This repo, as it appears in an issue URL. Hardcoded rather than shelled out of `git remote`:
 *  the check runs in CI where the remote may be rewritten, and if the repo genuinely moves, a red
 *  build pointing at 107 stale links is the correct outcome, not a silent re-target. */
export const REPO = 'mobiustripper42/muster'

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
 * Every `DEC-NNN` in the doc set resolves to a decision file.
 *
 * `check-decisions` scans `docs/decisions/` and the generated index. That boundary was about
 * ownership, not safety — the other 148 references, in SPEC and PROJECT_PLAN and AGENTS, were
 * never checked by anything. A decision id is exactly the kind of token that survives a rewrite
 * of the sentence around it.
 */
export function checkDecRefs(docs, ids) {
  const failures = []
  for (const { path, text } of docs) {
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
 * Audit row 6 is the shape: `VELOCITY_AND_POKER_GUIDE.md` told a reader to run a throughput
 * extractor that does not exist in this repo, and `retro/SKILL.md` repeated the instruction. A
 * command in a doc is an instruction someone follows; a wrong one costs a debugging detour before
 * anyone suspects the doc.
 */
export function checkNpmScripts(docs, scripts) {
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
 * 107 of these across the doc set. `[#204](.../issues/207)` renders as a correct-looking citation
 * and no human finds it — you would have to hover all 107. It is the purest case for a script:
 * two representations of one fact, side by side, mechanically comparable, invisible to review.
 */
export function checkIssueLinks(docs, repo = REPO) {
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
 * Documented-but-absent is the obvious half: `CHEATSHEET.md:40` listed `/session-start-hook`,
 * which is not a skill in this project. Absent-from-the-roster is the half that actually bit —
 * audit row 26 found `/doc-consistency-check` in `CLAUDE.md` and `AGENTS.md` and nowhere in the
 * CHEATSHEET, the doc whose entire purpose is being the complete one-page reference. A roster
 * that is quietly missing an entry still looks authoritative, which is worse than one that names
 * something fake: nobody goes looking for what a complete list does not mention.
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
    // The reverse direction is scoped to names that LOOK like this project's own commands and
    // agents. A doc may legitimately name a plugin skill (`/stripe-projects`) or a built-in
    // (`/review`) that has no file in `.claude/`, so an unknown name is only a failure when the
    // roster presents it as one of ours — which, on these three docs, every listed name is.
    for (const n of named) {
      if (!skills.has(n) && KNOWN_FOREIGN.has(n)) continue
      if (!skills.has(n)) failures.push(`${roster} — roster lists /${n}, which has no .claude/skills/ entry`)
    }
  }
  return failures
}

/** Slash commands the docs name that are deliberately not this project's — plugin skills and
 *  Claude Code built-ins. Enumerated rather than pattern-matched so adding one is a decision. */
export const KNOWN_FOREIGN = new Set([
  'stripe-best-practices',
  'stripe-projects',
  'upgrade-stripe',
  'claude-api',
  'update-config',
  'fewer-permission-prompts',
  'keybindings-help',
  'review',
  'security-review',
  'init',
  'loop',
  'simplify',
  'config',
  'mcp',
  'help',
  'clear',
  'start-phase-note',
])

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
  return Object.keys(HISTORICAL)
    .filter((p) => !existsSync(p))
    .map((p) => `${p} — exempted from the path check in check-docs.mjs but does not exist`)
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
    .map((p) => `${p} — named in check-docs.mjs as a roster but does not exist`)
}

/**
 * @param {{path: string, text: string}[]} [sources] injected documents; defaults to the real doc
 *   set. @param {object} [world] injected disk state. Both exist so every red branch is testable —
 *   a checker whose failure paths never run is a checker nobody knows still fires (#589).
 */
export function check(sources, world) {
  const docs =
    sources ??
    DOCS.map((path) => ({ path, text: existsSync(path) ? readFileSync(path, 'utf8') : null })).filter((d) => {
      return d.text !== null
    })

  const w = world ?? {
    ids: new Set(load().keys()),
    scripts: JSON.parse(readFileSync('package.json', 'utf8')).scripts,
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
  console.log(
    `✓ docs — ${DOCS.length} docs: DEC refs, npm scripts and issue links resolve, ` +
      `skill/agent rosters match disk both ways, paths resolve (${exempt} historical ledgers exempt)`,
  )
}
