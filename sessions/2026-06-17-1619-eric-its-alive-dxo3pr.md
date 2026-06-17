---
session: 17
dev: eric
slug: its-alive-dxo3pr
branch: claude/its-alive-dxo3pr
started: 2026-06-17T16:19:26Z
ended:
points:
pr_numbers: []
status: open
transcript: /root/.claude/projects/-home-user-muster/f63485a5-d75c-5edf-9391-99ce14a697d8.jsonl
---

# Session 17 — its-alive-dxo3pr

<!-- Task blocks appended by /kill-this, one per task. -->

**Walkthrough findings (HELD — to file as `e2e` + `bug` issues):**
1. **[minor/copy] 0.1 setup chain doesn't wipe.** Running a pass on top of an existing Docker volume accumulates orphan rows → 0.2 `/api/health` failed `degraded`, `integrity.ok: false`, `violationCount: 158`. A full `docker compose down -v` wipe cleared it to `violationCount: 0`. Fix: doc should make the wipe the default clean-slate before a run (not just a destructive-test reset), or seeds should clear. Integrity check itself is correct — this was stale-volume cruft, not a seed/code bug.
2. **[minor] `db:up` doesn't wait for Postgres readiness.** The documented `npm run db:up && npm run db:migrate` chain ECONNRESETs on a cold/fresh-volume start (container "started" ≠ "accepting connections"). Workaround: split the commands (manual gap) or `sleep 3` between up and migrate. Fix: `pg_isready` wait or compose healthcheck + `--wait`.
3. **[copy/minor] Ask-card eyebrow `Muster · now` is static (1.3).** `app/(crew)/crew/page.tsx:168-170` hardcodes the string — "now" is not derived from `ask.sentAt`, so a stale ask still reads "now" (misleading). User verdict: it should either show a real date/time or be removed; "Muster" is superfluous on a crew-facing card. Decide: drop the eyebrow, or replace with the ask's actual sent time.
4. **[MAJOR — core crew loop] Tapping In gives no feedback; claimed shift never appears in My Shifts (1.4).** `recordResponse` sets the seat to `Claimed` (`src/asks/ask-loop.ts:237`), but My Shifts lists `Confirmed`-only (`src/crewapp/crew-view.ts:111-113`), so a just-claimed shift only surfaces after the operator confirms it (cockpit 3.4). Ask vanishes, nothing lands → crew can't tell their "In" registered. **User decision: code bug — My Shifts should include `Claimed` seats.** Fix: widen the crew-view filter to `Confirmed || Claimed` (still scoped to `assignedCrewMemberId === me` + `date >= today`), and label a Claimed row in the UI (e.g. "awaiting confirmation") so it's distinct from a locked Confirmed seat. Touches `crew-view.ts` (`MyShiftView` may need a state/status field) + `app/(crew)/crew/page.tsx` My Shifts render. Add/extend `crew-view.test.ts`. Worth a DEC note on Claimed-vs-Confirmed visibility in the crew app.

**Next Steps:**
- File findings 1–4 as GitHub issues (`e2e` + `bug`; #4 also `crew`/major) — held at user request; GitHub MCP was disconnected at the time.
- Continue walkthrough from step 0.3 (operator sign-in via `/crew/dev-link?admin=spink`).

**Context:**
- Health clean (`violationCount: 0`) only after a full `docker compose down -v` wipe + re-seed. The 158 violations were accumulated orphans in a stale volume, not a code regression.
