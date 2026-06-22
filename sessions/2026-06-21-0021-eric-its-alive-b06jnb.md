---
session: 22
dev: eric
slug: its-alive-b06jnb
branch: claude/its-alive-b06jnb
started: 2026-06-21T00:21:15Z
ended:
points:
pr_numbers: [110]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/182202e7-7637-47a8-97b5-90528c70d8a9.jsonl
---

# Session 22 — its-alive-b06jnb

<!-- Task blocks appended by /kill-this, one per task. -->

Picking up the Session 21 handoff (draft PR #110) on its own branch — unblock the
pilot import. CLI session on the dev box (can run code; live Xola calls go through
the operator since outbound HTTP is blocked here).

## Task 1: Events-driven Xola import — boat from the event's Resource (DEC-043)

**Completed:**
- Diagnosed the live Xola model via operator-run probes (no outbound HTTP here): boat = `event.resourceUsages[].resource.id`; cancels are explicit status-700 rows; `event.start` is local wall-clock under a `Z` suffix.
- `src/import/resource-map.ts` (4 real boats by resource id, Duffy excluded) replaces `product-map.ts`; `xola-client.ts` adds `fetchEvents` + `eventVesselMap` + the orders⨝events join; `import-reservations.ts` keys events on the real `event.id` (vessel from booked record or stored event); `xola-pull.ts` two-feed join + per-pull assignment summary; `form-shifts.ts` cancels relocated-away shifts.
- Retired the xlsx upload (`xlsx-extract.ts` + `product-map.ts` deleted; `/admin/import` pull-only + unknown-boat warning).
- Seeds: real 4-boat fleet + 21 crew (real captain/mate split, placeholder MMC per DEC-044, `PILOT_GUIDES` env).
- DEC-043 + DEC-044; `PILOT_IMPORT_FINDINGS.md` → resolved. G1–G9 reconcile harness (caught + fixed a reassignment-orphan bug in `form-shifts.ts`). `npm run verify` green (493 tests).

**Code review:** Solid, nothing blocked merge. Actioned: scan all event `resourceUsages` for the boat (not index 0) + 2 stale doc-comments. Noted as pilot-scale non-issues: the O(events×records) skip-scan + a 4xx-reads-as-"try again" copy nuance.
**PR:** [#110](https://github.com/mobiustripper42/muster/pull/110)
**Points:** 8
**Branch:** claude/its-alive-b06jnb
**Opened at:** 2026-06-22T02:27:15Z

**Next Steps:**
- **Crew-notify (next task / own PR):** "trip added to a crewed boat-day → notify the crew." The engine already auto-covers it (no new ask — test G3.MULTI); the missing piece is a **one-way-notify primitive** — the web-link outbox is ask-bound (`OutboxEntry` needs `askId`/`seatId`; `web-link-channel.ts:73` hard-rejects no-ask sends). Relax that + a notice kind + outbox/crew-view render. Crew-cancel + "shift changed" nudges reuse it.
- **Operator data:** real MMC expiries replace the `2099-12-31` placeholder as collected; a `XolaPullResult.unmappedResources` hit = a new/renamed boat to add to `resource-map.ts`.
- **Deploy:** seed fleet + crew on prod, then operator does a live "Pull from Xola now"; `main` still 3 commits ahead of `production` (`/promote-production` candidate).

**Context:**
- Started on `production` (deploy branch); moved to the PR #110 branch to continue
  the handoff. `main` is 3 commits ahead of `production` (deploy-doc PR #109) — a
  `/promote-production` candidate, not blocking.
- Session 21's "Phase 5 retro un-run" note was stale — retro ran, v0.7.0 tagged.
