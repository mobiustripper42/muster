---
session: 22
dev: eric
slug: its-alive-b06jnb
branch: claude/its-alive-b06jnb
started: 2026-06-21T00:21:15Z
ended:
points:
pr_numbers: []
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/182202e7-7637-47a8-97b5-90528c70d8a9.jsonl
---

# Session 22 — its-alive-b06jnb

<!-- Task blocks appended by /kill-this, one per task. -->

Picking up the Session 21 handoff (draft PR #110) on its own branch — unblock the
pilot import. CLI session on the dev box (can run code; live Xola calls go through
the operator since outbound HTTP is blocked here).

**Next Steps:**
- Diagnostic: pin where Xola exposes the assigned boat (a Resource on a purchase
  item). Current `/orders` pull drops `event`/`experience` refs — trial-and-error
  live calls to find the field.
- Then: rework `xola-client.ts` so one boat-trip = one shift; replace
  `seed-fleet.ts` invented vessels with the 4 real boats; test + ship PR #110.

**Context:**
- Started on `production` (deploy branch); moved to the PR #110 branch to continue
  the handoff. `main` is 3 commits ahead of `production` (deploy-doc PR #109) — a
  `/promote-production` candidate, not blocking.
- Session 21's "Phase 5 retro un-run" note was stale — retro ran, v0.7.0 tagged.
