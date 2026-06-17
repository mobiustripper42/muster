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
5. **[copy/minor] Relabel shift-card "Be there (call)" → "Shift Start" (1.7).** `app/(crew)/crew/shift/[shiftId]/page.tsx:141` (the green `callTime` box, paired with "First departure" at :149). **User decision (operator domain knowledge): "call" is not used by anyone on the BrewBoat team, and "Be there" reads as vague ("be where?"). "Shift Start" is clearest for them.** Note for whoever implements: this is the load-bearing call-vs-departure distinction (SPEC §2.6.3 AC, "#1 dock confusion") — only the label changes, not the derived value; verify "Shift Start" still reads as distinct from / earlier than "First departure" in context. Label only — no logic change.
6. **[copy/minor] Kill "seat" jargon + fix unanswerable bail copy (1.10).** `app/(crew)/crew/shift/[shiftId]/page.tsx:270` (body) + `:281` (button). Crew don't sit; "seat" is internal-model jargon (it stays in the domain + the operator cockpit `seat-card.tsx`, which crew never see — this is crew-copy only). Also the old body asked crew to judge "if there's still plenty of time" — info they can't see (the staffing horizon is operator-side; confirmed: bail rail `actions.ts:27` has **no time gate**, a drop always goes through, lateness is only logged/reacted-to, never blocking). **User decision:**
   - Body → *"This gives up your spot on a shift you confirmed. The sooner you tell us, the easier it is to refill — so if you can't make it, drop it now."* (drops the unanswerable conditional; uses "your spot," not "seat" — "shift" alone over-claims since a shift holds 2 crew and survives the drop.)
   - Button "Drop this seat" → *"Drop this shift."*
   Label/copy only — no logic change.
7. **[enhancement — supersedes #6] Horizon-aware bail copy (1.10).** Bail confirm text should branch on how much notice the drop gives, so an imminent drop reads firmer and pushes the human call. **User decision: two bands**, keyed off the existing **staffing horizon** (reuse DEC-028's notice-shortfall — no new constant). Folds #6 in as the graceful branch:
   - **Graceful** (notice ≥ horizon — time to refill): *"This gives up your spot on a shift you confirmed. The sooner you tell us, the easier it is to refill — so if you can't make it, drop it now."*
   - **Late** (inside the horizon — little/no time to refill): *"This shift is soon — dropping now may not leave time to refill it. We'll still try, but call your operator right away so they can react."*
   Build: expose a lateness/horizon flag on the `shift-card.ts` view model (reuse DEC-028), branch copy in `app/(crew)/crew/shift/[shiftId]/page.tsx`, and surface operator contact on the card so "call your operator" is actionable. Warrants a DEC + `@architect` look (new crew-facing data flow). Still no time gate — both bands let the drop through.
8. **[copy/doc — walkthrough bug] 1.13 setup steps are out of order (`docs/E2E-PILOT-WALKTHROUGH.md:128`).** Current: *"Re-run `db:seed:atrisk` so eligible captains exist, full-wipe + `db:seed:crew`, then bail again"* — a full-wipe AFTER seeding atrisk erases the captains it just added, so following it literally reproduces the crew-only (rest-Bailed) state, not the re-ask contrast. Cost real confusion this run (user expected the board, saw nothing → it was actually correct re-ask behavior, masked by the bad instruction). Fix: reorder to wipe → seed BOTH, e.g. *"Full-wipe, then seed crew **and** atrisk so eligible captains exist (`down -v` … `db:migrate && db:seed:crew && db:seed:atrisk`), then bail again."*

**Next Steps:**
- File findings 1–4 as GitHub issues (`e2e` + `bug`; #4 also `crew`/major) — held at user request; GitHub MCP was disconnected at the time.
- Continue walkthrough from step 0.3 (operator sign-in via `/crew/dev-link?admin=spink`).

**Context:**
- Health clean (`violationCount: 0`) only after a full `docker compose down -v` wipe + re-seed. The 158 violations were accumulated orphans in a stale volume, not a code regression.
