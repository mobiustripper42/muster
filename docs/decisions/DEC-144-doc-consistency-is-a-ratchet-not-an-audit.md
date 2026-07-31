---
id: DEC-144
title: "Doc consistency is a ratchet in `verify`, not an audit"
topic: "Core architecture & engine mechanics"
---

## DEC-144: Doc consistency is a ratchet in `verify`, not an audit

**Decision:** Mechanically checkable doc claims are checked on every task gate, by three scripts
chained at the head of `npm run verify`: `check:decisions` (the decision record), `check:context`
(the always-loaded context files), `check:docs` (every top-level `docs/*.md`). A claim that a
script can check is never left to a sweep, a reviewer, or a calendar. `@doc-consistency` keeps the
half no script can reach — characterization — and stays ad-hoc and report-only.

**Two rules follow, and they are the durable part:**

1. **Docs carry decisions, rationale and pointers — never inventory.** Rationale does not rot. A
   pointer (`ls src/adapters/*-channel.ts`) sends the reader to the truth instead of copying it,
   and it is checkable. A prose snapshot of current state is stale the day the code moves.
2. **A doc that claims completeness is checked for completeness in both directions.** A roster
   missing a row still reads as authoritative, and nobody goes looking for what a complete list
   does not mention.

### Why

**An audit is a snapshot; a snapshot with no ratchet decays back while its ledger says otherwise.**
The 2026-07-25 audit swept 9,281 doc lines over five days across seventeen shards. Its own README
records rows 10/26/28/45 as "**Fixed** in `docs/CHEATSHEET.md`". They were fixed on
`task/doc-consistency-sharded`, which never merged. Nine months of workflow evolution later `main`
still told a reader that patch bumps happen "automatic in /its-dead on PR merge" — a model retired
at DEC-S013 — and still listed a `/session-start-hook` skill with no file behind it, while the
audit's ledger asserted both repaired. **A finding recorded as closed and not closed is worse than
one never found: the next sweep skips it.** That is the failure this decision exists for, and no
amount of additional sweeping addresses it.

**The corollary is a doc-writing habit, and it is the point.** Cite a full path
(`src/adapters/twilio-channel.ts`) and it gets checked; write a bare filename and it does not.
Link an issue and the link is verified against its own text; write a bare `#204` and nothing is
asserted. The check does not make careless docs safe — it makes precise docs *cheap to trust*, and
that asymmetry is what changes how they get written.

**Narrow on purpose, and the misses are the price.** `check-context`'s first draft produced 16
findings, 15 of them noise, and a check that cries wolf gets muted — at which point it is worse
than no check, because the docs claim coverage. So a span must be rooted in a real top-level
directory to count as a claim about this repo, `<angle brackets>` mark a deliberate placeholder,
and a slash-name is a command only where it cannot be a route.

**Historical ledgers are exempt from the path check, by name and with a reason.** `SPEC.md`,
`PROJECT_PLAN.md`, `RETROSPECTIVES.md`, `FUTURE_IDEAS.md` and `SECURITY_AUDIT.md` describe what was
true at a point in time, so they cite deleted files *correctly* — `PROJECT_PLAN.md:186` annotates
its own "(deleted 2026-07-25)" in the same sentence. Running the check over them yields four
findings, all false. **It is an exemption list and not an allowlist**: a doc added next year is
checked by default and skipping it costs a deliberate line, because a ratchet that defaults to OFF
only ever covers what someone remembered to enrol.

**Every class was at zero the day it was written, except the one that was not.** Catching things
today is not the job — the count not climbing back off zero is. The roster check went red on first
run against exactly the two CHEATSHEET defects the audit had recorded as fixed, which is the whole
thesis demonstrated on the first execution.

### What it does not do

It reads **structure, never prose**. "Patch bumps happen in /its-dead" is a false sentence in which
every token resolves — a real skill, spelled correctly, that does not do that. No script catches
it; only a reader does. Stating this here matters more than the code, because a guard whose blind
spot is undocumented gets trusted for things it never checked (#589) — the same failure that let
`check-context` ship blind to the `ls `-prefixed pointer its own comment held up as the example.

**Issue *state* is deliberately out.** Whether a `[x]` in `PROJECT_PLAN.md` matches a closed issue
needs the network, and the per-task gate stays offline and fast. That belongs at `/retro`, which
already reconciles the plan against reality.

**Phase point totals are deliberately out.** The audit verified all five by hand and found them
correct; the totals are written in prose ("24 planned → 28 shipped", "~55 pts", "16 tasks, 86
points") and a parser for that produces noise, not findings.
