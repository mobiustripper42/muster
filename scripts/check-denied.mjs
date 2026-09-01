#!/usr/bin/env node
// Docs must not spell a command the permission policy denies.
//
// THE FAILURE THIS EXISTS FOR, and it is the reason the check is worth its own file.
//
// Seeds' `CLAUDE.md` denied `Bash(npx *)` fleet-wide and, in the same file, warned:
//
//   "Docs that spell commands as `npx <thing>` are the real trap — they read as sanctioned,
//    and the failure is a permission refusal rather than an error, so it looks like the agent
//    being difficult rather than the doc being stale."
//
// Seeds then shipped a context template containing eleven `npx` invocations, into every webapp
// project. The repo described the trap, in prose, and walked into it — which is the whole
// argument of this rebuild in one artifact. Nothing caught it for months; it was found in
// 2026-08-27 by someone happening to grep.
//
// It is a nastier failure than a wrong command, because of HOW it fails. A wrong command errors
// and gets fixed. A denied command produces a refusal, mid-task, that reads as the agent being
// obstructive — so the doc keeps its authority and the agent loses trust it should not lose.
//
// SCOPE is what jig ships and what jig loads: `CLAUDE.md`, `.claude/CLAUDE-context.md`,
// `docs/*.md` and `scaffold/**`. Not decision records, which quote denied commands to explain why
// they are denied, and not this file, which has to name `npx` to describe itself. Both are the
// same exemption: text ABOUT a deny is not an instruction to run one.
//
// Usage:  node scripts/check-denied.mjs
// Exit:   0 = no shipped doc spells a denied command; 1 = at least one does.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const POLICY = '.claude/settings.json'

/**
 * Only `Bash(...)` rules produce a command spelling. A path-scoped tool deny — the `Read` and
 * `Edit` rules covering env files and ssh keys — has no command form to find in prose, so
 * including it would mean hunting for the string `.env` in documents that legitimately discuss
 * env files. That is noise, and noise is what kills gates.
 *
 * ONLY WILDCARD RULES. `Bash(bash)` and `Bash(sh)` are exact-match rules denying the bare
 * interactive shell, and treating them as prefixes made the gate match the English word "Bash" —
 * it reported `- **JSON parsing in Bash:** Prefer …`, a line that is not a command at all. A rule
 * with no `*` denies one exact string and cannot be looked for in prose.
 */
export function deniedCommands(policyPath = POLICY) {
  if (!existsSync(policyPath)) return []
  const { permissions } = JSON.parse(readFileSync(policyPath, 'utf8'))
  return (permissions?.deny ?? [])
    .map((rule) => rule.match(/^Bash\((.+\*)\)$/)?.[1])
    .filter(Boolean)
    .map((pattern) => pattern.replace(/\s*\*+\s*$/, '').trim())
    .filter((prefix) => prefix && !prefix.startsWith('/') && prefix.length > 2 && !unsearchable(prefix))
}

/**
 * A command spelling in prose: inside a fenced block, inside backticks, or at the start of a line.
 *
 * Deliberately NOT a bare substring scan. `rm -rf` appears in this comment; "never run `npx`"
 * appears in guidance that is doing the right thing. The rule is that the command must look
 * INVOKED — first thing in a code span, a fenced line, or a shell prompt — not merely mentioned.
 *
 * MENTION VS INVOCATION IS STRUCTURAL, NOT A WORD LIST, and getting there took two wrong turns
 * worth recording because both produced a confidently wrong verdict.
 *
 * First attempt skipped any line containing a negative word. That silenced the gate on the exact
 * file it was built to catch — `npx playwright test  # … do not override` INVOKES the command,
 * and a trailing comment about worker counts made it look like guidance.
 *
 * Second attempt required the negation to come BEFORE the command. That broke the other way on
 * the shell's own text: **`npx` is denied fleet-wide** names the command first and forbids it
 * after, so a paragraph doing exactly the right thing was reported as a defect. Three lines of
 * seeds' `CLAUDE.md` were flagged for forbidding the very commands they forbid.
 *
 * The distinction neither version could see is that a code span holding ONLY the bare command is
 * naming it, and one holding arguments is running it:
 *
 *   `npx`                                  a mention — the subject of a sentence
 *   `sed -i`                               a mention
 *   `npx playwright test`                  an invocation
 *   `<e.g. npx playwright test …>`         an invocation a project is told to copy
 *
 * Inside a fenced block the question does not arise: a line beginning with the command is a
 * command, whatever the comment after it says.
 */
/**
 * Rules whose pattern begins with a wildcard — `Bash(* -m pip install *)`, `Bash(* > /dev/*)`.
 * The leading `*` is not a command name, so there is no prefix to look for in prose. They were
 * silently unmatchable while still being counted in "65 denied command prefixes", which is a
 * number that overstated coverage.
 */
export const unsearchable = (prefix) => prefix.startsWith('*')

/**
 * A word boundary is wrong when the prefix already ends in punctuation.
 *
 * `rm -rf ~` and `rm -rf ..` are the derived prefixes for two destructive deny rules, and `\b`
 * after `~` or `.` cannot match before the `/` that always follows in real use. Both rules were
 * undetectable in their canonical spelling — `rm -rf ~/.cache/foo`, `rm -rf ../build`.
 */
const boundary = (cmd) => (/\w$/.test(cmd) ? '\\b' : '')

/**
 * A command spelling in prose: run inside a fenced or indented code block, or invoked inside a
 * code span.
 *
 * MENTION VS INVOCATION IS STRUCTURAL, NOT A WORD LIST, and getting there took two wrong turns
 * worth recording because both produced a confidently wrong verdict.
 *
 * First attempt skipped any line containing a negative word. That silenced the gate on the exact
 * file it was built to catch — `npx playwright test  # … do not override` INVOKES the command,
 * and a trailing comment about worker counts made it look like guidance.
 *
 * Second attempt required the negation to come BEFORE the command. That broke the other way on
 * the shell's own text: **`npx` is denied fleet-wide** names the command first and forbids it
 * after, so a paragraph doing exactly the right thing was reported as a defect.
 *
 * The distinction neither version could see is that a code span holding ONLY the bare command is
 * naming it, and one holding arguments is running it:
 *
 *   `npx`                          a mention — the subject of a sentence
 *   `npx playwright test`          an invocation
 *
 * INSIDE A BLOCK, POSITION IS NOT ENOUGH EITHER. Anchoring at the start of the line missed every
 * real shape a command appears in: `cd app && npx playwright test`, `- run: npm install` in a CI
 * snippet, a piped command. A block line is a command line, so the command is looked for after
 * any shell or YAML boundary on it, not only at column zero.
 */
const spellings = (text, cmd) => {
  const out = []
  const esc = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const b = boundary(cmd)
  const lines = text.split('\n')
  let fenced = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; continue }

    // A four-space (or tab) indented block is a code block in markdown and was never examined —
    // not fenced, not a code span, so unreachable by both branches.
    const indented = !fenced && /^(?: {4}|\t)/.test(line) && line.trim() !== ''

    if (fenced || indented) {
      // Start of line, or after a shell operator, a `$`/`#` prompt, or a YAML `run:` key.
      if (new RegExp('(?:^|[|&;]|\\$\\s|#\\s|\\brun:)\\s*' + esc + b, 'i').test(line)) out.push(i + 1)
      continue
    }

    // Every code span on the line, so one mention does not mask an invocation later in the same
    // sentence. `[^`\n]*` keeps a span from running past its closing backtick into the next.
    for (const m0 of line.matchAll(/`([^`\n]*)`/g)) {
      const span = m0[1]
      /**
       * A negation IMMEDIATELY before the span, and the width is the whole safety argument.
       *
       * Scanning the line for a negative word was the first version and it silenced the gate on
       * the file it was built for: `npx playwright test  # … do not override` invokes the command
       * and a comment about worker counts read as guidance. Requiring the negation to precede the
       * command was the second, and it flagged `**\`npx\` is denied fleet-wide**` — a paragraph
       * doing the right thing — because the sentence names the command first.
       *
       * The structural rule below already excludes bare mentions, which is what those two were
       * really reaching for. What is left is the narrow case it cannot see: `Never run
       * \`npx playwright test\``, guidance that spells the full invocation. Twenty-four characters
       * of lookbehind covers "never run", "do not use", "instead of" and nothing a sentence away.
       */
      if (/\b(never|do not|don't|avoid|instead of|rather than)\b[^`]{0,24}$/i.test(line.slice(0, m0.index))) continue
      // A permission rule quoted as itself. `Bash(npx *)` is the deny entry, and the wildcard
      // reads as an argument, so the paragraph that documents a deny gets reported for it.
      if (/^\s*(?:Bash|Read|Edit|Write|Glob|Grep)\s*\(/.test(span)) continue
      const m = new RegExp('(?:^|[|&;]\\s*)' + esc + b + '(.*)$', 'i').exec(span)
      if (!m) continue
      // Arguments after the command make it an invocation. A trailing `>` or quote is the
      // placeholder's own punctuation, not an argument.
      if (m[1].replace(/[>\'")\s.]+$/, '').trim()) { out.push(i + 1); break }
    }
  }
  return out
}

const walk = (dir) =>
  !existsSync(dir)
    ? []
    : readdirSync(dir).flatMap((e) => {
        const p = join(dir, e)
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : []
      })

/** Shipped or always-loaded. `docs/decisions/` is excluded: a record explaining a deny quotes it. */
export function scope() {
  return [
    'CLAUDE.md',
    '.claude/CLAUDE-context.md',
    ...(existsSync('docs') ? readdirSync('docs').filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`) : []),
    ...walk('scaffold'),
    ...walk('.claude/skills'),
    ...walk('.claude/agents'),
  ].filter((p) => existsSync(p))
}

/**
 * A runbook is documentation aimed at a PERSON, and this gate was built against jig's own docs,
 * which have none.
 *
 * Muster was the first repo it met one in: nine `curl` smoke checks against a live domain and
 * three quick-start installs, across `docs/DEPLOY.md`, `docs/HOSTING_MIGRATION.md` and
 * `docs/RUNNING.md`. None of them had a compliant spelling. There is no npm script to wrap a
 * smoke check against production in, and no rewording clears the finding because the match is
 * structural on purpose — inside a fence, a line beginning with the command IS the command. The
 * only way out was deleting the code fence, which makes the runbook worse. The gate was right
 * that the string is there and wrong that its presence is a defect.
 *
 * The declaration lives in `.claude/doc-check.json` because that file already exists, is
 * project-owned, and already carries per-file exemptions with reasons under `historical`. One
 * place a project says what its gates may skip beats a second mechanism with its own syntax.
 */
const CONFIG = '.claude/doc-check.json'

const runbooksOf = (configPath) =>
  existsSync(configPath) ? (JSON.parse(readFileSync(configPath, 'utf8')).runbooks ?? {}) : {}

/**
 * The exemption list has to justify itself on every run.
 *
 * `check-docs.mjs` names the risk out loud — "reusing an exemption because it happens to silence
 * the right lines is how an exemption list stops meaning anything" — and that is the objection to
 * every per-file exemption ever written, including this one. An entry that exempts nothing fails,
 * so the list cannot outlive the lines it was written for: clean up the last `curl` in a file and
 * the gate tells you the entry is now a lie, in the same run.
 */
export function runbookProblems(configPath = CONFIG, files = scope(), policyPath = POLICY) {
  const denied = deniedCommands(policyPath)
  const out = []
  for (const [path, reason] of Object.entries(runbooksOf(configPath))) {
    if (!existsSync(path)) {
      out.push(`${configPath} — runbook \`${path}\` does not exist`)
      continue
    }
    /**
     * An entry for a file this gate never reads exempts nothing and would have validated
     * forever — the same rot the rule below exists to stop, one step earlier. `docs/decisions/`
     * is the live case: out of scope on purpose, because a record quotes a denied command to
     * explain why it is denied, so an entry naming one looks justified and does nothing.
     */
    if (!files.includes(path)) {
      out.push(`${configPath} — runbook \`${path}\` is not gated by this check, so declaring it exempts nothing`)
      continue
    }
    if (!String(reason ?? '').trim()) {
      out.push(`${configPath} — runbook \`${path}\` has no reason. Say who runs these steps and why they cannot be a script`)
      continue
    }
    const text = readFileSync(path, 'utf8')
    if (!denied.some((cmd) => spellings(text, cmd).length)) {
      out.push(`${configPath} — runbook \`${path}\` exempts nothing; no denied command is spelled there. Remove the entry`)
    }
  }
  return out
}

export function check(policyPath = POLICY, files = scope(), configPath = CONFIG) {
  const denied = deniedCommands(policyPath)
  const runbooks = runbooksOf(configPath)
  const problems = []
  for (const path of files) {
    // Whole-file, and deliberately: a runbook is a document whose commands are all performed by a
    // person, so exempting it line by line would mean re-declaring every step. The cost is that a
    // denied command added to a declared file later inherits the pass without re-justification —
    // acceptable for a runbook, and the reason to declare the runbook rather than the directory.
    if (path in runbooks) continue
    const text = readFileSync(path, 'utf8')
    for (const cmd of denied) {
      for (const line of spellings(text, cmd)) {
        problems.push(`${path}:${line} — spells \`${cmd}\`, which the permission policy denies`)
      }
    }
  }
  return { denied, problems }
}

if (process.argv[1]?.endsWith('check-denied.mjs')) {
  if (!existsSync(POLICY)) {
    console.error(`✗ denied commands — ${POLICY} is missing; nothing to check against`)
    process.exit(1)
  }
  const { denied, problems } = check()
  const stale = runbookProblems()
  // An empty deny list is not a clean bill of health, it is a check with nothing to check. The
  // existsSync guard above covers a missing policy file; a policy whose `deny` was emptied or
  // renamed printed "0 denied command prefixes" and exited 0.
  if (!denied.length) {
    console.error(`✗ denied commands — ${POLICY} has no \`Bash(...)\` deny rules; there is nothing to check against`)
    process.exit(1)
  }
  const declared = Object.keys(runbooksOf(CONFIG)).length
  if (!problems.length && !stale.length) {
    // The runbook count is printed, never implied. A gate that silently skips files reads exactly
    // like a gate with nothing to find, and the difference is the whole reason to declare them.
    const rb = declared ? `, ${declared} runbook${declared === 1 ? '' : 's'} declared in ${CONFIG}` : ''
    console.log(`✓ denied commands — no shipped doc spells any of the ${denied.length} denied command prefixes${rb}`)
    process.exit(0)
  }
  console.error(`✗ denied commands — ${problems.length + stale.length} problem(s):\n`)
  for (const p of [...problems, ...stale]) console.error(`  ${p}`)
  console.error(
    `\nA denied command in a doc reads as sanctioned and fails as a permission refusal, so it looks\n` +
      `like the agent being difficult rather than the doc being stale. Spell it as an npm script or\n` +
      `a direct path, or say plainly that it is denied.\n`
  )
  process.exit(1)
}
