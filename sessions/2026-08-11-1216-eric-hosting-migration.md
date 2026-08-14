---
session: 83
dev: eric
slug: hosting-migration
branch: task/dec-126-import-scope
started: 2026-08-11T12:16:52Z
ended: 2026-08-14T03:29:36Z
points: 0
pr_numbers: []
status: closed
transcript: /home/eric/.claude/projects/-home-eric-muster/0c2c0a81-350d-4911-86cc-a6094039ec44.jsonl
---

# Session 83 — hosting-migration

<!-- Task blocks appended by /kill-this, one per task. -->

## Outcome: the migration was cancelled, and the investigation is why

No code shipped, no PR, 0 points. What this session produced is eight commits of corrections to
`docs/HOSTING_MIGRATION.md` and a decision **not to self-host** (2026-08-13). The Neon-off-Vercel
move may still happen on its own.

**Phase B, steps 1–6, all worked:**

- **1 done.** Neon over MCP; **Vercel over the CLI, not MCP** — `/mcp` through Remote Control
  authorizes the CC Desktop process, whose token store a terminal session can't see.
- **2 open.** `vercel env pull` prints `[Sensitive]`, so there is no export — every secret must be
  re-sourced from whatever issued it. Inventory is complete in the runbook; the values are not
  collected.
- **3 done.** Production builds on **Node 24.x**, not the 22 the runbook claimed. Plan tier **Pro**.
- **4 open.** Migration ledger read (45 in prod vs 46 on disk); PITR 24h. Connection strings not
  collected.
- **5 done.** `CREW_SELF_SERVE`=1, `TIME_CLOCK`=1, `MESSAGING` and `RESERVATIONS` unset (off).
- **6 done.** No Neon project transfer out of a Vercel-managed org, and no claim link — so the
  move, if it happens, is dump-and-restore.

**Next Steps:**
- **Self-hosting is off.** Three things need a disposition and none were done: close or re-scope
  **issue #445 "move off vercel"**; decide what `docs/HOSTING_MIGRATION.md` becomes (its Phase B
  findings are true regardless of the migration); and write up the Neon move separately if it's
  still wanted — it's Phase D + E and needs no box.
- **issue #736** filed (flag value asymmetry) and deliberately **not fixed** — "we do need it
  fixed, not right now."
- Phase B steps 2 and 4 stay open, and only matter if the Neon move happens.

**Context:**
- **The cert-renewal trap is already monitored — do not re-raise it as a gap.** `sheepdog.yaml`
  target `muster-origin-cert` checks the **Vercel origin** cert (`connectTo:
  efabc4ee1912cd0a.vercel-dns-016.com`, `host` as SNI), `warnDays: 21`, every 6h. `notAfter
  2026-09-23`, first at-risk renewal ≈ **2026-08-24**, so a silent renewal failure warns ~Sep 2
  with three weeks of runway. I called this "unmitigated" during the session and was wrong.
- **The original problem is recorded in issue #436 and `ops/residential-probe/README.md`**, not in
  any session file — intermittent `ERR_SSL_PROTOCOL_ERROR` / `ERR_CONNECTION_CLOSED` from
  residential networks against Vercel's edge POPs, invisible to datacenter curl. Already fixed by
  flipping Cloudflare to orange-cloud Full (Strict). issue #445's body just says "TLS issue
  detailed in cc session" and that transcript is gone (oldest JSONL on disk is 2026-07-24).
- **A literal `process.env.NAME` grep misses a whole class of vars.** `src/builder/derive.ts:79-129`
  and `src/config/tenant.ts:184-261` read env as `process.env[name]` through helpers, hiding 15
  tuning vars. I published a checklist as authoritative without them; `vercel env ls` caught it.
- **14 of the env vars on Vercel are dead** — `POSTGRES_*`, `PG*`, `NEON_PROJECT_ID`, auto-injected
  by the Neon integration and read by nothing. The app reads `DATABASE_URL` only.
- **`RESERVATIONS` tests `=== "true"`; the other three flags test `=== "1"`** (issue #736).
- **`20260810011500_payment_intent_lookup.sql` is still unapplied in production** — carried over
  from session 81 and confirmed against the live ledger.
- **Process, honestly: this session went badly and mostly on me.** I restated Eric's instructions
  as something slightly different three separate times, talked far more than I acted, and kept
  handing him infrastructure decisions — pool size, one process or two, MCP vs CLI — after he'd
  said he isn't a sysadmin. A menu of options is not neutral; it's work pushed back onto him. The
  correction he asked for: **make the infra call, state it in one line, and only surface decisions
  that are actually about the business** — money, downtime he'd feel, data he can't lose.
- Concurrent with Session 82 all session. All six PRs opened in this window (#733–#739) belong to
  that session, not this one. This session pushed **8 commits straight to `main`**, every one of
  them `docs/HOSTING_MIGRATION.md` only, with Eric's standing approval for direct pushes.
