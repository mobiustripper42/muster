# Audits

Read-only audits of the code against `docs/SPEC.md`, and the ledger that tracks what became of every finding. **A session fixing audit findings starts here.**

The reports are snapshots. Each one describes the code at the commit it audited and is never edited. What happened to each finding — fixed, filed, dismissed — lives in the [ledger](#ledger) below, not in the report.

## Done

| Date | Audit | Report | Commit audited | Findings (S1 / S2 / S3 / S4) |
|---|---|---|---|---|
| 2026-11-02 | Money code against §2.8 | `docs/audit/2026-11-02-money-spec-2.8.md` | `fd62b4f` (`main` + pull request #1214) | 30 (3 / 2 / 9 / 16) |
| 2026-11-03 | Capability URLs, sign-in, every server door | `docs/audit/2026-11-03-capability-urls.md` | `fd62b4f` (`main` + pull request #1214) | 20 (1 conditional / 3 / 12 / 4) |
| 2026-11-03 | Payroll against §2.9 and the tip-pool rules | `docs/audit/2026-11-03-payroll-2.9.md` | `main` at `23a556b` | 25 (1 / 7 / 5 / 12) |
| 2026-11-04 | Crewing engine against §1.1–1.4 and the crewing rules of §2.3–2.7 | `docs/audit/2026-11-04-crewing-engine.md` | `main` at `84bd0d1` | 50 (6 / 10 / 20 / 14) |
| 2026-11-12 | Silent failures, repo-wide: for every swallowed error, does a person find out | `docs/audit/2026-11-12-silent-failures.md` | `main` at `29046b6` | 62 (1 / 18 / 29 / 14) |
| 2026-11-13 | What the plan says shipped vs. what the code has | `docs/audit/2026-11-13-plan-vs-code.md` | `main` at `0c4bddf` | 46 (0 / 4 / 11 / 31) |
| 2026-11-13 | Test database vs. production database: the `Repository` port in both adapters | `docs/audit/2026-11-13-test-vs-prod-db.md` | `main` at `0c4bddf` | 37 (0 / 2 / 29 / 6) |
| 2026-11-14 | Operator-side reservations against §2.10, §3.3 and §3.4 | `docs/audit/2026-11-14-operator-reservations.md` | `main` at `0c4bddf` | 32 (1 / 5 / 19 / 7) |
| 2026-11-14 | Paired saves: two writes that must agree | `docs/audit/2026-11-14-paired-saves.md` | `main` at `0c4bddf` | 35 (1 / 7 / 12 / 15) |
| 2026-11-02 | `/code-review ultra` on pull request #1214 (16.9 self-cancel) | none — the review ran in a cloud session; its fixed findings are in pull request #1214 | — | 3 left over |

Counts are per finding, as the ledger lists them. The capability-URL report's own summary counts 1 / 4 / 12 / 5. Pull request #1220 holds the same capability-URL report, opened by mistake — close it unmerged.

Earlier audits in this folder keep their own status and are not in the ledger: `docs/audit/2026-07-25/README.md` (doc consistency, sharded) and `docs/audit/2026-08-07-cutover-phase-a.md` (cutover phase A). The §2.8 conformance audit, `docs/audit/2026-08-29-spec-2.8-conformance.md`, keeps its own citation ratchet (`npm run check:audit`), but what it left open is in the ledger since issue #1230.

## To do

Worth running, most valuable first:

1. **Messaging and scheduled jobs.** §3.1 and the delivery half of §2.6.1: what happens when a job under `app/api/cron/` runs twice, runs late or fails halfway, and when a send fails. The crewing audit covered whether an ask is made; this covers whether it arrives. Crewing S2-7 and S3-2 are the overlap.
2. **UI and copy consistency, read from the code.** Every surface against `.claude/ui-context.md` and the glossary in `docs/SPEC.md §0.4` ("trip", never "cruise"), and every surface's empty, error and loading states. A cloud session has no database, so nothing can be screenshotted; this one reads JSX.

Lower value, still open:

3. **Check-in and waivers**, against `docs/design/check-in-and-waivers.md` and `docs/design/check-in-surfaces.md`.

## Running an audit

1. **The cloud environment must install dependencies.** Add `cd muster && npm ci` to the environment's setup script (in a cloud session: the environment menu in the title bar, then Edit). Without it the container has no `node_modules`, `npm test` fails, and the session will not install them itself, because installs are the operator's call. The crewing audit hit this and fell back to a stand-in for vitest.
2. **Write the prompt from the nearest one in `docs/audit/prompts/`.** The crewing prompt is the most complete. Every prompt carries:
   - "This message is the approved plan", and no session skills.
   - The branch or commit to audit.
   - The question, then the reverse: code that decides something where the spec is silent.
   - Where the spec is, where the code starts, and what is out of scope because another audit covers it.
   - The rules: change no code; open no pull request, file no issue, post no comment; every claim cites `path:line`; tests run as `npm test -- <file>`, never `npx vitest`, which the permission policy denies; probe tests are named `*.audit-tmp.test.ts`, reproduced in the report and deleted before commit; use subagents.
   - Severity S1–S4 defined for that subject.
   - The report: `AUDIT-<name>.md` at the root of a new `audit/<name>` branch, pushed. **Pushing the branch is the whole delivery. No pull request.**
3. **Start a cloud session on `mobiustripper42/muster` and paste the prompt.** Save the prompt to `docs/audit/prompts/<date>-<name>.md` when the report comes in.
4. **When the report lands, bring it into this folder** on a docs branch:

   ```
   git fetch origin audit/<name>
   git show origin/audit/<name>:AUDIT-<name>.md > docs/audit/<YYYY-MM-DD>-<name>.md
   ```

   Add a row to [Done](#done), add its findings to the [ledger](#ledger), and open a docs pull request. Once that merges, the `audit/<name>` branch can be deleted.

## Fixing findings

- **Work from the ledger, S1 first.** Pick one row, read the finding in its report, then **re-read the code it cites on current `main`** — the line numbers are the audited commit's, and the code may have moved or already changed.
- **Each finding ends in exactly one status:**
  - `open` — not yet looked at.
  - `fixed — pull request #N` — the pull request that fixes it.
  - `issue #N` — real work bigger than one sitting. One issue may cover several findings; name them all in the issue, and give each its row's status.
  - `dismissed — <why>` — not a defect, or not worth fixing. The reason is required.
  - `duplicate of <audit> <id>` — the other row carries the work.
  - `check — <what>` — a known reason to think it is already fixed; confirm, then set a final status.
- **The pull request that fixes a finding updates its ledger row in the same diff.** Then `main` says `fixed` exactly when the fix has merged. A ledger that says "fixed" about a branch that never merged is how an earlier project's audit lied about itself (`scripts/check-docs.mjs:7-14`).
- **A fix is an ordinary task.** A behaviour change is specced in its issue and built with `/build-task`; a stale comment or spec sentence can go straight in. Several small S4 fixes can share one pull request.
- **Filing is not the default** (`.claude/CLAUDE-context.md` § Median gaps): if the fix is smaller than writing the issue, fix it.

## Ledger

Statuses are `open` unless a row says otherwise. A "same finding as" or "overlaps" note on an untriaged row is an import-time lead, not a verdict: triage confirms it, sets one row to `duplicate of …`, and buckets the pair once, at the higher of the two severities. IDs are each report's own; refer across audits as "money F5" or "crewing S2-7".

**When** is the deadline a finding has to be fixed by, set when it is triaged: `Feb 1` (before the Reservations release), `May 1` (before guests and crew are on the water), `after release`, or `—` (not triaged, or nothing left to fix). It stays when the finding is filed, so a phase plan can pick up every `Feb 1` row that is not `fixed`. The crewing and payroll tables are `after release` as a block until issue #1230 triages them (operator, 2026-11-07).

**The triage rule (issue #1230, operator, 2026-11-20):** `Feb 1` is anything on the reservations side that can lose money — money taken with no booking, a refund missed or wrong, a wrong charge or tax. `May 1` is anything guests or crew hit on the water, crew pay included. `after release` is the rest.

### Money — `docs/audit/2026-11-02-money-spec-2.8.md`

| ID | Sev | Finding | When | Status |
|---|---|---|---|---|
| F1 | S1 | A booked trip blocks its hull for its trip time, not its hold minutes | Feb 1 | open — confirmed real (operator, 2026-11-03) |
| F2 | S1 | A superseded PaymentIntent that succeeds late is a second payment and tip; no refund, nobody told | Feb 1 | open — confirmed real (operator, 2026-11-03) |
| F3 | S1 | The reconciler is not built; `docs/PROJECT_PLAN.md` marks it shipped | Feb 1 | open — confirmed real (operator, 2026-11-03) |
| F4 | S2 | A failed confirmation send keeps the claim; the customer is booked, charged and never told | Feb 1 | open |
| F5 | S2 | A failed self-service refund leaves no work item; the operator email is best-effort | Feb 1 | open |
| F6 | S3 | Booked-row readers recompute tax and balance from the live tax rate (latent S1) | Feb 1 | fixed — issue #1241: the five readers read the tax and balance frozen on the booking's invoice |
| F7 | S3 | `/book/success` tells a race loser they were refunded and texted before either happens | Feb 1 | open |
| F8 | S3 | Two concurrent self-cancel presses report a failed refund to both parties | — | check — likely fixed by pull request #1214; since issue #1228 the guard is in `cancelBookingAndRelease` |
| F9 | S3 | "Release the boat" after a self-cancel writes a second, misattributed `cancelled` row | — | fixed — pull request #1229 removed the button (issue #1228) |
| F10 | S3 | The operator's cancel tells the customer nothing; §3.3's cascade is not built | May 1 | open — issue #1212 now tells the customer on every cancel, the operator's and their own (`docs/SPEC.md §2.8.4c`); §3.3's cascade is still not built |
| F11 | S3 | The offering form says the tip is exempt from the service fee; it is in the fee base | Feb 1 | open |
| F12 | S3 | `/admin/integrity` goes red for good after cancelling an unpaid phone booking | Feb 1 | open |
| F13 | S3 | `/admin/purchases` shows a lapsed pending row as "Pending" forever | Feb 1 | open |
| F14 | S3 | `cancel_closed` says "too close to your trip" for every reason the quote is null | Feb 1 | open |
| F15 | S4 | Tax rate: spec 8%, worked example and code fallback 7.25%, nothing seeds the row | Feb 1 | open — the rate is a setting, 8% in production; do not raise the 7.25% code fallback (operator, 2026-10-10). Feb 1: confirm production's row reads 8%, no code change |
| F16 | S4 | §2.8.7 says a retry makes a second payment; the code reuses one PaymentIntent | Feb 1 | open — spec and comment sweep with F22, F23, F28 |
| F17 | S4 | The cutoff's settings-page control is not built | May 1 | open |
| F18 | S4 | An override `Event` at the asker's slot: the read exempts it, the write does not (latent S1) | after release | issue #945 (deferred) — unreachable until a per-trip override exists: issue #1228 stops a cancel leaving an unbooked Event |
| F19 | S4 | Slots under a live pending row are hidden on the operator grid, not drawn busy | May 1 | open |
| F20 | S4 | A `payment_intent.succeeded` that matches no row is acked silently | Feb 1 | open — goes with F3 |
| F21 | S4 | The customer record is created before the flip, not in step 6 | after release | open |
| F22 | S4 | Stale docstrings state the pre-DEC-196 fee base and an untaxed insurance | Feb 1 | open |
| F23 | S4 | "Nothing else is created at checkout" is broader than the code | Feb 1 | open |
| F24 | S4 | Abandonment's "how long it held the boat" is a summary, not a column | after release | open |
| F25 | S4 | "14 days" is 336 clock hours; across DST the boundary moves an hour | — | dismissed — one hour on two weekends a year, against a 14-day window (operator, 2026-11-07) |
| F26 | S4 | After a partial refund failure the customer notice quotes the whole figure | — | check — likely fixed by pull request #1214 (`cancelledNoticeFrom`) |
| F27 | S4 | The confirm's "less the $50" nets prior refunds; the terms say "$30" against a discounted insurance | Feb 1 | open |
| F28 | S4 | §3.3 says "tenant-configurable"; §2.8.4c rejects a policy engine | Feb 1 | open |
| F29 | S4 | §2.8.10's admitted balance-path defects are present as described | Feb 1 | open — goes with deposits |
| F30 | S4 | Small gaps (several, listed in the report) | — | open — one row for several items in the report; split them before bucketing |

### Ultra-review leftovers — pull request #1214

| ID | Sev | Finding | When | Status |
|---|---|---|---|---|
| U1 | — | A failed refund's only alert is a best-effort email filed as `booking_request` | Feb 1 | duplicate of money F5 |
| U2 | — | A retried refund reuses the Stripe idempotency key (`src/reservations/refund-payment.ts`, predates 16.9) | Feb 1 | open — goes with F5 |
| U3 | — | Cleanup: the cancel-and-refund sequence is written twice, the operator-email block three times, `refund=` is written and never read | after release | open |

### Capability URLs — `docs/audit/2026-11-03-capability-urls.md`

| ID | Sev | Finding | When | Status |
|---|---|---|---|---|
| A1 | S1 (conditional) | The dev-code echo is open on any non-production deploy; S1 only if one shares the production database or `SESSION_SECRET` | Feb 1 | open — not S1: production's `DATABASE_URL` is Production-only and Preview has its own `SESSION_SECRET` (Vercel env list and operator, 2026-11-07). The cleanup left: answer only in local development |
| A2 | S2 | Archived or disabled crew can sign in afresh; an existing session never re-checks | after release | open — crew-only (admin access is re-checked); with issue #1230. Until fixed, `db:admin revoke` alongside `db:crew archive` |
| A3 | S2 | A cancelled booking's leaked code cannot be revoked and works forever | May 1 | open — narrowed: a cancelled booking now hides Manage, but the link still shows name, trip, amounts and receipts, and cannot be revoked |
| A4 | S2 (conditional) | The rate limiter keys only on a forwarded header; a null key means no limit; the 40-bit trip code rests on it | May 1 | open — conditional on Vercel overwriting `x-forwarded-for` and the origin taking only Cloudflare traffic; the operator confirms |
| A5 | S3 | The crew session is a stateless bearer with no server-side revoke | after release | open — crew-only; with A2 and issue #1230 |
| A6 | S3 | The 72-hour pay link shows full phone and email, cannot be revoked, and several can be live | Feb 1 | open |
| A7 | S3 | `/b/find` has no per-client limit | May 1 | open — issue #800 |
| A8 | S3 | Every change or cancel request emails the live booking code to the operator inbox | after release | open |
| A9 | S3 | Without Twilio, the log fallback redacts `/b/<code>` but not `/p/<token>` or `/w/<code>` | after release | open — only bites with Twilio unconfigured; production has it |
| A10 | S3 | No `noindex`, no `robots.txt`, no security headers | Feb 1 | open |
| A11 | S3 | Three paths put another person's data or writes on a customer page | Feb 1 | open — read the report's three paths first; may be a privacy leak |
| A12 | S3 | `/api/guest-contact` lets any signed-in subject stamp or erase "Texted by" on any reservation | May 1 | open |
| A13 | S3 | The balance-checkout URL round-trips through the query string, rendered unvalidated | Feb 1 | open — goes with deposits and money F29 |
| A14 | S3 | `SESSION_SECRET` has no minimum length, a repo-public fallback, and also signs pay links | Feb 1 | open — hardening pull request with A16 and A17; refuse to start without a real secret |
| A15 | S3 | `/api/health` opens a database connection per anonymous request | Feb 1 | open |
| A16 | S3 | `CRON_SECRET` is compared with `!==` | Feb 1 | open — with A14 |
| A17 | S4 | `/b/<code>?error=__proto__` throws during render | Feb 1 | open — with A14 |
| A18 | S4 | `/book/success` is an unauthenticated, unlimited Stripe read | after release | open |
| A19 | S4 | `gusto.csv` answers the feature flag before the session check | after release | open |
| A20 | S4 | Stale docs and comments | Feb 1 | open — with the spec sweep (money F16) |

### Payroll — `docs/audit/2026-11-03-payroll-2.9.md`

| ID | Sev | Finding | When | Status |
|---|---|---|---|---|
| F1 | S1 | A refunded tip is still paid to the crew when the refund is not a cancellation | after release | open |
| F2 | S2 | A tip on an event that sits on no shift vanishes from the report, no warning | after release | open |
| F3 | S2 | Admin edits and deletes write no trail row | after release | open |
| F4 | S2 | The edit trail is write-only; a crew self-edit is invisible to the operator (not built) | after release | open |
| F5 | S2 | An event on two live shifts pays the tip to the later shift and the estimate to both | after release | open |
| F6 | S2 | `?period=from/to` is validated for shape only (low) | after release | open |
| F7 | S2 | `tips.csv` is still served with `TIME_CLOCK` on, so tips can be imported twice (low) | after release | open |
| F8 | S2 | The punch write and its trail row are two writes, not one transaction (low) | after release | open |
| F9 | S3 | The screen and the Gusto file round the same minutes at different units | after release | open |
| F10 | S3 | Links from `/admin/payroll` land on the wrong person for an archived crew member | after release | open |
| F11 | S3 | `adminEditedAt` survives a later crew edit | after release | open |
| F12 | S3 | Unmapped crew are in the page totals, absent from the file; a zero row goes to Gusto | after release | open |
| F13 | S3 | The Δ column says "even" while Est and Actual differ by a minute | after release | open |
| F14 | S4 | The missing-days notice counts shifts but says days | after release | open |
| F15 | S4 | Provenance wording differs by surface | after release | open |
| F16 | S4 | A non-refundable cancellation keeps the tip for the operator (spec silent) | after release | open |
| F17 | S4 | Tips are paid for in-window trips that have not run yet (spec silent) | after release | open |
| F18 | S4 | Nothing records that a period's file was sent (spec silent) | after release | open |
| F19 | S4 | `PAY_PERIOD_ANCHOR` has no validation; a future value clamps "current" | after release | open |
| F20 | S4 | A departure between 00:00 and 00:44 puts estimate and punch on different days | after release | open |
| F21 | S4 | Period membership is a string comparison that depends on `.toISOString()` everywhere | after release | open |
| F22 | S4 | A non-cancelled shift whose events are all cancelled is neither estimated nor missing | after release | open |
| F23 | S4 | `editPunch` re-opening a punch relies on the index alone | after release | open |
| F24 | S4 | Spec vocabulary is stale: `future` and `day_moved` are not in §2.9 | after release | open |
| F25 | S4 | Smaller items (several, listed in the report) | after release | open |

### Crewing engine — `docs/audit/2026-11-04-crewing-engine.md`

| ID | Sev | Finding | When | Status |
|---|---|---|---|---|
| S1-1 | S1 | Tapping "in" re-checks only double-booking; the other five eligibility rules are trusted from the ask | after release | open |
| S1-2 | S1 | A revived cancelled shift restores its old `Confirmed` crew unchecked; so does a merge after a collapsed split | after release | open |
| S1-3 | S1 | The override can put one person in two required seats; the shift reads `Crewed` | after release | open |
| S1-4 | S1 | Two concurrent commits by one person on two same-date shifts both win (issue #554, closed not planned) | after release | open |
| S1-5 | S1 | A confirmed person who goes on PTO, takes the day off, or is archived stays `Confirmed` | after release | open |
| S1-6 | S1 | The override seats someone with a lapsed MMC, on PTO, off that day, or confirmed elsewhere | after release | open |
| S2-1 | S2 | A seat left in `Claimed` is never asked, boarded, `Crewed` or `Completed` | after release | open |
| S2-2 | S2 | On a multi-trip day, the shift stops being worked once its first trip departs | after release | open |
| S2-3 | S2 | A trip booked onto a `Completed` shift is folded in and never crewed | after release | open |
| S2-4 | S2 | Seat writes from a stale read, not compare-and-swap, erase a fill that just happened | after release | open |
| S2-5 | S2 | The engine re-asks and nudges the person who bailed on that shift | after release | open |
| S2-6 | S2 | A seat made surplus by a manning cut while `Asked` stays required | after release | open |
| S2-7 | S2 | Nothing stops two ticks overlapping: double asks, scores and alerts | after release | open |
| S2-8 | S2 | A staffing horizon later than the fill deadline leaves the shift unworked and unboarded | after release | open |
| S2-9 | S2 | After everyone declines or is nudged, the shift goes quiet until the fill deadline | after release | open |
| S2-10 | S2 | A "Yes" refused as `double_booked` strands the seat `Asked`; the drip stops | after release | open |
| S3-1 | S3 | One empty-pool seat makes the whole shift `AtRisk`, and the greedy solve can call it exhausted wrongly | after release | open |
| S3-2 | S3 | A tick that throws halfway leaves asks never texted, later charged `ask_ignored` | after release | open |
| S3-3 | S3 | A live ask on a cancelled shift is charged as silence when the shift revives | after release | open |
| S3-4 | S3 | A merge or manning prune leaves asks behind; a re-split re-attaches them | after release | open |
| S3-5 | S3 | A live ask is not retired when the person commits elsewhere that day | after release | open |
| S3-6 | S3 | An ask live at departure is never swept; a "Yes" a week later still confirms | after release | open |
| S3-7 | S3 | A self-claim after the boat sailed earns +4 and +5 | after release | open |
| S3-8 | S3 | Nothing logs `no_show`; "Bailed" after completion is refused but reported as logged | after release | open |
| S3-9 | S3 | Nothing logs `shift_acknowledged` | after release | open |
| S3-10 | S3 | A double submit doubles `ask_accepted`, `ask_declined` or `shift_bailed` | after release | open |
| S3-11 | S3 | The winner's withdraw can overwrite the loser's `accepted` from a stale copy | after release | open |
| S3-12 | S3 | A withdrawn ask answered after its seat reopens bars that person from the drip | after release | open |
| S3-13 | S3 | A mid-tick reopen writes `Pending`; Tier-2 fires one cadence late | after release | open |
| S3-14 | S3 | Formation writes a tick-set `AtRisk` back to `Filling` on every run | after release | open |
| S3-15 | S3 | Board-landing de-duplication keys on a re-used shift id; Eric is not texted | after release | open |
| S3-16 | S3 | Whole-row snapshot writes can revert a concurrent split, merge or cancel (suspected) | after release | open |
| S3-17 | S3 | A shift with no scheduled trip is still dripped | after release | open |
| S3-18 | S3 | The "late bail" label fires at six days' notice or less | after release | open |
| S3-19 | S3 | The 40-event score window counts zero-weight events, flushing worked history | after release | open |
| S3-20 | S3 | A newcomer starts below everyone; no control sets the manual boost or floor | after release | open |
| S4-1 | S4 | §1.1 lists only `Crewed → Completed`; DEC-145 completes from any non-terminal state | after release | open |
| S4-2 | S4 | The §2.5 regression flag no longer fires for new bails (accepted by DEC-128) | after release | open |
| S4-3 | S4 | §2.4 and §2.5 disagree on how far out eligibility exhaustion boards | after release | open |
| S4-4 | S4 | §1.2's per-person protocol toggle was cut; `resolveProtocol` is dead | after release | open |
| S4-5 | S4 | The decline-latency bonus is not built; the ack cap applies per event | after release | open |
| S4-6 | S4 | The urgent blast asks one person for two seats when manning repeats a role | after release | open |
| S4-7 | S4 | A dry Tier-2 logs `pool_widened` on every tick | after release | open |
| S4-8 | S4 | The drip interval is 15 or 30 minutes depending on cron jitter | after release | open |
| S4-9 | S4 | Tier-2 nudges every `Open` seat and bypasses the one-boat-per-day spread | after release | open |
| S4-10 | S4 | The staffing horizon is a scalar, not a list-of-one | after release | open |
| S4-11 | S4 | Completion saves before appending events; the adapters differ on a duplicate event id | after release | open |
| S4-12 | S4 | Bail lateness is measured against the flat lead, not the weekend horizon | after release | open |
| S4-13 | S4 | Stale code comments, including the `src/builder/derive.ts` line numbers in `.claude/CLAUDE-context.md` | after release | open |
| S4-14 | S4 | Stale spec and decision cross-references | after release | open |

### Silent failures — `docs/audit/2026-11-12-silent-failures.md`

Refer to these as "silent S2-1". The report also cites about twenty findings already in this ledger (its lines 26-30) and does not re-report them.

| ID | Sev | Finding | When | Status |
|---|---|---|---|---|
| S1-1 | S1 | A self-cancel that commits, loses its acknowledgement and fails its re-read tells the customer "Nothing changed", and the refund is never sent | Feb 1 | duplicate of paired PS-1 |
| S2-1 | S2 | After an operator refund moved money then hit a database error, the screen says "Nothing moved" and a second press refunds again | — | open |
| S2-2 | S2 | A pay-link payment on a cancelled phone booking writes no payment, trail or refund row, and the customer is told "You're booked!" | — | open |
| S2-3 | S2 | The sold-out-while-paying office alert says "the customer has been told" whether or not anyone told them | — | open |
| S2-4 | S2 | When a confirmation reports nobody was told, the claim is released, the webhook answers 200 and nothing retries | — | open |
| S2-5 | S2 | A manage-page change or cancel request shows "we've sent your request to the team" whether or not the email went | — | open |
| S2-6 | S2 | The operator's cancel always prints "the crew have been told", but crew notice failures go only to a log | — | open |
| S2-7 | S2 | With Twilio unset, the sold-out notice records "Sold-out notice sent" for a message that only reached the log | — | open |
| S2-8 | S2 | Nothing notices when the cron tick stops running | — | open |
| S2-9 | S2 | A failed engine Pause/Resume shows no error: the error banner redirects to a page that drops the query | — | open |
| S2-10 | S2 | Lean, Assign and Nudge save the ask, then the relay throws and the operator is told "nothing was sent"; crew is later charged `ask_ignored` | — | open |
| S2-11 | S2 | After a merge, the banner says "N crew notified" even when the notice threw | — | open |
| S2-12 | S2 | Cockpit success banners promise a delivery the code never checks | — | open |
| S2-13 | S2 | A no-penalty remove that went through then hit an error is shown as a race, with no notice and no audit row | — | open |
| S2-14 | S2 | A manual Xola pull that fails in the database is reported as "Couldn't reach Xola — nothing was pulled" | — | open |
| S2-15 | S2 | Notices from split, merge and the Xola pull fire once, are never retried, and the screen says "done" | — | open |
| S2-16 | S2 | A crew Yes/No that fails partway closes the ask without taking the seat, and a second tap says "you're all set" | — | open |
| S2-17 | S2 | The crew check-in list draws a tick that failed to save as checked in, and may show "Everyone's aboard" | — | open |
| S2-18 | S2 | A bail that fails halfway is shown as a stale card, but the bail is already on the person's record | — | open |
| S3-1 | S3 | The At-Risk landing is recorded before the SMS is tried, so a failed send is never retried | — | open |
| S3-2 | S3 | A persistent failure to read webhook endpoints logs "UNKNOWN" every run and never alerts | — | open |
| S3-3 | S3 | A dispute alert is one SMS attempt with no deadline; inquiry and unknown disputes move no ledger row | Feb 1 | duplicate of operator OR-5 |
| S3-4 | S3 | A balance overpayment is announced by one SMS and `/admin/purchases` shows it as "paid" | — | open |
| S3-5 | S3 | Three money branches alert by one SMS and write no row: unknown hosted-session purpose, balance for a missing reservation, unusable row | — | open |
| S3-6 | S3 | When the residual-race auto-refund fails, only one SMS and a pull-only `refund_failed` row record it | — | open |
| S3-7 | S3 | A self-cancel refund that moved money then hit a ledger write throw is reported as a failed refund | — | open |
| S3-8 | S3 | If the `refund_failed` trail write is itself swallowed, the manage page says the refund is on its way | — | open |
| S3-9 | S3 | Formation failures on the booking and cancel paths go to a log at the source and wait for the next tick | — | open |
| S3-10 | S3 | An operator cancel that commits but loses its acknowledgement says "Try again"; the customer notice and re-form never run | — | open |
| S3-11 | S3 | When the revenue pages fail to load, the customer sees a notice and the operator gets only a log line | — | open |
| S3-12 | S3 | A `stripe.confirmPayment` rejection shows "you have not been charged" without knowing that | — | open |
| S3-13 | S3 | A Xola pull's own formation failures are dropped and the run page shows success | — | open |
| S3-14 | S3 | Formation fails before any vessel-day is tried, leaving a log line every tick and no alert | — | open |
| S3-15 | S3 | Waiver reminders fail at the run level with a log only, or per booking with a pull-only `waiver_reminder_failed` row | — | open |
| S3-16 | S3 | Link recovery records "sent" when every channel failed | — | open |
| S3-17 | S3 | "Texted to …" means Twilio accepted the message; there is no status callback for carrier failures | — | open |
| S3-18 | S3 | "We texted and emailed it to you too." renders on every manage-page load whether or not it was sent | — | open |
| S3-19 | S3 | A failed sign-in code still shows "a 6-digit code is on its way", so a Resend outage locks everyone out with only a log line | — | open |
| S3-20 | S3 | "✓ Texted by" records the tap, not the text, so a lost POST lets a second crew member text the customer again | — | open |
| S3-21 | S3 | "We'll be in touch about your refund" is a promise nothing tracks | — | open |
| S3-22 | S3 | When the paused flag can't be read, the At-Risk board shows "Nothing needs you right now" without the paused banner | — | open |
| S3-23 | S3 | "nothing was changed" is shown after a partial, non-transactional seat write | — | open |
| S3-24 | S3 | Crewing audit rows are dropped, so `/admin/asks` shows "nothing happened" | — | open |
| S3-25 | S3 | The customer page catch has no log line at all: the named catch binding gets past the lint rule | — | open |
| S3-26 | S3 | An operator post is dropped by a bare `return` when the target is refused, with no log line | — | open |
| S3-27 | S3 | `readShiftChangeBanner(...).catch(() => null)` has no log, so the change banner is silently missing | — | open |
| S3-28 | S3 | A failed team read shows "No shifts scheduled in this window" | — | open |
| S3-29 | S3 | The SMS-consent (10DLC) record is swallowed and nothing reads that table back | — | open |
| S4-1 | S4 | Two comments claim a guarantee the code doesn't have, about the self-cancel and operator refund failures | — | open |
| S4-2 | S4 | A failed trail read on a cancelled booking prefills the refund box with the whole refundable amount | — | open |
| S4-3 | S4 | Refund and dispute events with no PaymentIntent are acknowledged and dropped, so a dispute on such a charge reaches nobody | — | open |
| S4-4 | S4 | `payment_processing` sends an alert with no de-duplication and writes no row, though documented as unreachable | — | open |
| S4-5 | S4 | A refund on a still-`pending` row returns silently, which also swallows a dashboard refund in the money F3 case | — | open |
| S4-6 | S4 | A Stripe outage is turned into `null` and `/book/success` shows success | — | open |
| S4-7 | S4 | The pay-link commit-then-throw shape leaves intents un-retired, which leads into S2-2 | — | open |
| S4-8 | S4 | Nine small drops (trip-link line, waiver card, reissue copy, `errText` logging, recovery copy, best-effort emails, doorbell, provider-ref parse) | — | open — one row for several items; split them before bucketing |
| S4-9 | S4 | Pausing the engine also mutes At-Risk pings, and on resume every landing goes out in one SMS, undocumented | — | open |
| S4-10 | S4 | A route comment claims the admins "have already been texted" though `alertsSent` includes log-only sends | — | open |
| S4-11 | S4 | Unmanned shifts outside the formation window go to a log only | — | open |
| S4-12 | S4 | `degraded` is returned with HTTP 200, and the sheepdog check on the body can't be verified | — | open |
| S4-13 | S4 | Silent defaults: `getAdmin().catch(() => null)`, `listCrewMembers().catch(() => [])`, copy button, Postgres rollback errors, `parseJsonSetting` | — | open — one row for several items; split them before bucketing |
| S4-14 | S4 | Smaller crew and admin gaps: no-op PTO "Removed", stale check-in banner, no `error.tsx`, calendar feed 500, beacon status, `signing.ts` limit of 0 | — | open — one row for several items; split them before bucketing |

### Plan vs. code — `docs/audit/2026-11-13-plan-vs-code.md`

Refer to these as "plan S2-1". The report numbers its S4 findings as table rows 1–31 in §2 (lines 206-245), with no prefix; here they are `S4-1` to `S4-31`, in the same order. The report also cites findings already in this ledger (its lines 247-253). Its three spec-internal notes (line 243-245) and §3's eighteen undocumented features and dead-looking code (lines 255-281) carry no severity and are not rows.

| ID | Sev | Finding | When | Status |
|---|---|---|---|---|
| S2-1 | S2 | A card charge that differs from the invoice frozen on the reservation books silently as `booked`, `kind: "full"`, with no alert | — | open |
| S2-2 | S2 | The reservation pane has no "change arrival" and no way to move a booking | — | open |
| S2-3 | S2 | The admin "Message" button via the customer sender is not built | — | open |
| S2-4 | S2 | The booking success page still promises a post-trip tip after the tipping code was removed | — | open |
| S3-1 | S3 | No `payment_status` gate, no async-payment event handling, and no decision record for keeping the card lock | — | open |
| S3-2 | S3 | The "REFUND MANUALLY" alert names no amount, and the promised tests for unconfigured SMS and a throwing alert are missing | — | open |
| S3-3 | S3 | An operator edit to the offering mid-checkout can make a declined-card retry refuse as sold out, or hold a second boat | — | open |
| S3-4 | S3 | The operator write accepts off-season and off-grid slots, but no screen can reach such a slot | after release | duplicate of operator OR-6 |
| S3-5 | S3 | An unpaid phone booking cannot be discounted after it is written, contrary to §2.10.6 | after release | duplicate of operator OR-4 |
| S3-6 | S3 | The Stripe round-trip test runs only by hand, not in CI | — | open |
| S3-7 | S3 | Disputes are recorded and texted, but with no customer name, deadline, date or evidence upload | Feb 1 | duplicate of operator OR-5 |
| S3-8 | S3 | The per-booking cancel misses the reason in the notice, the full-refund default and rebook-or-credit, beyond money F10 | — | open |
| S3-9 | S3 | BrewBoat's waiver text is not seeded as v1, so confirmations may carry no sign line (suspected) | — | open |
| S3-10 | S3 | No first-contact message is sent when a crew member is added | — | open |
| S3-11 | S3 | The crew help page and `CREW_QUICKSTART.md` give sign-in instructions that are no longer true | — | open |
| S4-1 | S4 | Plan row 14.1 promises a DEC superseding DEC-109, but no such record exists | — | open |
| S4-2 | S4 | The pending-window env override promised for 14.1 is ignored on production deploys | — | open |
| S4-3 | S4 | Plan row 14.2 says the state gains `expired`, but by spec there is no such state | — | open |
| S4-4 | S4 | Plan row 14.8 says scripted abuse is distinguishable from abandonment; the spec says no field separates them | — | open |
| S4-5 | S4 | The 14.8 criterion 7 test asserts no Event, customer or code, but not "no message" | — | open |
| S4-6 | S4 | The 14.9 test's overlap case overlaps nothing, though the code is correct | — | open |
| S4-7 | S4 | Plan row 15.7 expects `purpose` to survive, but 15.6 removed it and the charge sends empty `metadata` | — | open |
| S4-8 | S4 | Plan row 15.14 says one decision record, but it shipped as two, DEC-179 and DEC-180 | — | open |
| S4-9 | S4 | Plan row 15.16 places the reconciler beside `doorbell-tick`, which is unscheduled | — | open |
| S4-10 | S4 | A comment on `stripe-payment.ts` says the metadata includes `purpose`, false since 15.6 | — | open |
| S4-11 | S4 | Plan row 16.1 says a block passes but says so, which DEC-184 superseded: a block refuses | — | open |
| S4-12 | S4 | Plan row 16.3 names `candidateVessels`, but the cutoff is a named refusal in `claimDepartureSlot` | — | open |
| S4-13 | S4 | Plan row 16.8 says a discount is not taxed and not in the fee base, which DEC-196 superseded | — | open |
| S4-14 | S4 | The contact phone setting has no screen and is set only by SQL; S3 if production has no row | — | open |
| S4-15 | S4 | Plan row 12.8 says photos, which were deferred and which the spec does not ask for | — | open |
| S4-16 | S4 | Row 12.9 lacks the take-out-of-service shortcut from the vessel and location pages; `/admin/blocks` does it | — | open |
| S4-17 | S4 | The purchases header and empty-state copy say refunds are "not wired up", though the linked pane refunds | — | open |
| S4-18 | S4 | The Phase 12 outcome says "All thirteen shipped", contradicted by S2-2, S2-3, S4-15 and S4-16 | — | open |
| S4-19 | S4 | A comment in `availability.ts` still describes `checkout_holds`, which 14.7 dropped | — | open |
| S4-20 | S4 | DEC-012 was rewritten in place instead of superseded, and the spec still speaks of the sweep as pending | — | open |
| S4-21 | S4 | The spec's crew roster screens do not exist by DEC-094, and `buildRoster` and `renderRoster` have no caller | — | open |
| S4-22 | S4 | Plan row 5.R cites `docs/PILOT_RUNBOOK.md`, which was deleted | — | open |
| S4-23 | S4 | Plan rows 8.5 and 9.3 read as shipped, but the manning override and trainee seat were withdrawn from the UI | — | open |
| S4-24 | S4 | Phase 13 cites DEC-144 for the four calls, but DEC-144 is the doc-consistency ratchet | — | open |
| S4-25 | S4 | Plan rows 6.5 and 2.2 name `tick-dev.ts` and `rankPool`, which do not exist; `tick/route.ts` cites the removed `db:tick` | — | open |
| S4-26 | S4 | Spec criterion C5 says "repeatedly", but each Postgres race test runs once per CI run | — | open |
| S4-27 | S4 | Spec criterion C26 and the spec's after-trip tip lines describe a live checkout hold and a tip that are both gone | — | open |
| S4-28 | S4 | The operator calendar hides overlapped slots, so the spec's `busy` state is not shown; money F19 covers only pending | — | open |
| S4-29 | S4 | The spec says departed slots are "counted nowhere", but the "All" chip counts them | — | open — same finding as operator OR-19 |
| S4-30 | S4 | The spec says nothing under `app/(admin)/` writes an Event, but `/admin/import` writes Xola Events | — | open |
| S4-31 | S4 | The spec excludes gift cards and codes, but checkout shows every customer "Apply gift card or discount code · Coming soon" | — | open |

### Test vs. production database — `docs/audit/2026-11-13-test-vs-prod-db.md`

Refer to these as "db S3-2". The report cites crewing S3-1, S4-11, S3-10, S2-4 and S3-16, payroll F21 and F23, and money F18 without re-reporting them. §2.5 also describes two defects that are wrong in both adapters and carry no ID: `recordRead` / `recordNotification` can move a read mark backwards, so the doorbell may ring again, and `consumeLoginCodeIfUnused` burns by subject, so a re-minted code can be burned while the user signs in with the old one.

| ID | Sev | Finding | When | Status |
|---|---|---|---|---|
| S2-1 | S2 | `listReservationsForEvent` has no `ORDER BY` in Postgres, so guest order on the crew manifest can shuffle after a re-save | — | open |
| S2-2 | S2 | `listOfferings` and other catalog lists have no `ORDER BY` in Postgres, so the public trip picker order is unspecified | — | open |
| S3-1 | S3 | `bookPendingIfHullFree` on a `lost` result leaves the created or resurrected Event behind in memory; Postgres rolls it back | — | open |
| S3-2 | S3 | The pending-overlap predicate splits at four data edges (empty `holderToken`, NULL `time`, seconds-format time, `reservedAt` text vs instant), two toward a double-book | — | open |
| S3-3 | S3 | A malformed event or candidate time throws in Postgres (22P02) but returns `lost` in memory | — | open |
| S3-4 | S3 | `savePendingIfHullFree` with an existing id overwrites the row in memory, even a `booked` one, but throws 23505 in Postgres | — | open |
| S3-5 | S3 | `bookPendingIfHullFree` stores the caller's Event `status` and `source` in memory; Postgres hard-codes `muster` and requires `scheduled` | — | open |
| S3-6 | S3 | `saveEvent` in memory has no counterpart to the `events_muster_slot_identity` unique index, so two muster rows can share a slot | — | open |
| S3-7 | S3 | `listAllReservations` has no `ORDER BY` in Postgres, so claim's reuse lookup may pick a different live row than memory | — | open |
| S3-8 | S3 | `getReservationByPaymentIntentId` and `getPaymentByIntentId` return different rows in the two adapters when an intent sits on two rows | — | open |
| S3-9 | S3 | `saveGratuity` keeps the last write in memory but the first in Postgres, changing the trail timestamp | — | open |
| S3-10 | S3 | `listPaymentsForReservation` and `listGratuitiesForReservation` order ties differently between adapters | — | open |
| S3-11 | S3 | Settings round-trip through `text` in Postgres only, so `NaN`, 2.5 and -3 read back as default or 0, and multi-key writes can land partially | — | open |
| S3-12 | S3 | Money columns are `integer` in Postgres but any JS number in memory, which accepts 100.5 and `NaN` | — | open |
| S3-13 | S3 | Foreign keys on the money tables (payments, gratuity, refund leases, customer, booking codes) exist only in Postgres | — | open |
| S3-14 | S3 | `getOrCreateCustomerByPhone` in memory can never produce the display-code collision the paid confirm retries on | — | open |
| S3-15 | S3 | `listEventsForVesselDays` with a repeated vessel-day returns duplicate rows in Postgres but de-duplicates in memory | — | open |
| S3-16 | S3 | Booking codes: `revokeBookingCode` treats an empty-string `revokedAt` differently, and `listBookingCodesForReservation` tie order differs | — | open |
| S3-17 | S3 | Check-in foreign keys exist only in Postgres, and non-deferrable guardian keys fail a minor listed before their guardian | — | open |
| S3-18 | S3 | `setDepartureCount` for a nonexistent event keeps the count in memory but loses it in Postgres | — | open |
| S3-19 | S3 | `incrementRateLimit` on an existing row replaces `expiresAt` in memory but keeps the first insert's value in Postgres | — | open |
| S3-20 | S3 | `appendAuditEvent` with a duplicate id appends twice in memory and throws in Postgres, where callers swallow the error and lose the row | — | open |
| S3-21 | S3 | `recordSmsConsent` with a duplicate id appends in memory and throws in Postgres | — | open |
| S3-22 | S3 | `appendTimePunchEdit` with a duplicate id appends twice in memory but is a no-op in Postgres | — | open |
| S3-23 | S3 | `saveTimePunch` and `appendTimePunchEdit` crew foreign keys exist only in Postgres, so memory writes orphans for a form-supplied crew id | — | open |
| S3-24 | S3 | `addCrewMemberWithCredential` never writes `gusto` in Postgres, and a duplicate id overwrites in memory but throws in Postgres | — | open |
| S3-25 | S3 | `saveSeatIfState` in Postgres leaves `override` and `shift_id` untouched, while memory replaces the whole row | — | open |
| S3-26 | S3 | `listAsksForSeat` and `listCredentialsForCrew` have no `ORDER BY`, and two callers break ties on adapter order | — | open |
| S3-27 | S3 | Admin handle and calendar-feed `token_hash` uniqueness exist only in Postgres, and `listAdmins` order differs | — | open |
| S3-28 | S3 | Login-code stored fields differ (`failed_in_window` 0 vs absent, re-mint window NULL vs the caller's) though the decisions agree | — | open |
| S3-29 | S3 | `saveImportRun`, `getImportRun` and `listShiftChanges` differ: re-saves keep dropped items, item ids sort as text, `changed_at` ties are unordered | — | open |
| S4-1 | S4 | Twelve port methods are never named in any contract suite (audit, reliability, shift-change, and `listAll*` methods) | — | open |
| S4-2 | S4 | List order is almost never asserted in the contract suite, so every order-shaped finding is invisible to it | — | open |
| S4-3 | S4 | Foreign keys and unique indexes are exercised only by the Postgres-only file, and the contract seeds parents so never sees a refusal | — | open |
| S4-4 | S4 | Concurrency is tested only in the Postgres-only file, which did not run; nothing covers `cancelPendingIfUnpaid` against `bookPendingIfHullFree` | — | open |
| S4-5 | S4 | Duplicate-id behaviour is not pinned for any append or insert method, so every duplicate-id split passes the suite | — | open |
| S4-6 | S4 | Tie order on equal timestamps is unspecified in Postgres for four list methods; no caller depends on it | — | open |

### Operator reservations — `docs/audit/2026-11-14-operator-reservations.md`

Refer to these as "operator OR-1". The report cites money and capability-URL findings already in this ledger without re-reporting them (its lines 396-414), and notes money F8 as confirmed fixed and F26 as looking fixed. It asks for decisions on OR-2, OR-4, OR-5 and OR-6 (§6).

| ID | Sev | Finding | When | Status |
|---|---|---|---|---|
| OR-1 | S1 | A payment started while the operator cancels survives the cancel; the customer is charged for a cancelled trip, refundable only in Stripe | Feb 1 | open — real work, re-checked on `main` at `c280379`. Proposed fix (not in the codebase): after `recordCheckoutAttempt` (`src/reservations/create-departure-payment-intent.ts:620`), re-read the status; if the row is no longer `pending`, cancel the intent and refuse instead of returning the secret |
| OR-2 | S2 | A block saved over an unpaid phone booking hides it from the calendar, reports no conflict, and the customer can still pay onto the blocked boat | Feb 1 | open — real work. Wanted (operator, 2026-11-21): saving a block or hold warns about an unpaid or pending booking under it, and the pay link refuses a blocked slot |
| OR-3 | S2 | The payment link books and charges a trip that has already sailed | Feb 1 | open — real work. Wanted (operator, 2026-11-21): the pay link expires once the trip starts |
| OR-4 | S2 | An existing unpaid booking cannot be discounted; the discount box is only on the booking form, so DEC-194 is not built | after release | open — real work; rare. Check how often it would come up before building (operator, 2026-11-22). Until then: cancel and rebook. plan S3-5 is the same finding |
| OR-5 | S2 | A dispute raises an SMS and a ledger mark but no admin alert with Stripe's deadline or the customer, and no evidence attach | Feb 1 | open — real work, re-checked on `main` at `c280379`. Feb 1: the dispute text carries Stripe's deadline and the customer's name (`src/adapters/stripe-payment.ts:621-627` drops the deadline). Carries from silent S3-3: the text is one attempt, and an inquiry changes no payment record. Spec: drop evidence attach from `docs/SPEC.md` §3.4 and its acceptance line; everything stays in Stripe (operator, 2026-11-22). plan S3-7 is the same finding |
| OR-6 | S2 (S4 if "starts from the calendar click" governs) | "The season, the schedule grid — passes" is unreachable because no screen offers an off-grid or out-of-season slot | after release | open — real work, the other way round: a departure that is not on the schedule is not to be booked (operator, 2026-11-22). The fix is `docs/SPEC.md` §2.10.6's "passes" row, `OPERATOR_RULES.grid` (`src/reservations/claim.ts:140`) and a record superseding DEC-184, which says the grid and season pass. A longer season is the offering's dates, and a boat off sale is a block. plan S3-4 is the same finding |
| OR-7 | S3 | The `booked` trail row for a phone sale carries no operator id; a comp or an unreached link records no admin at all | — | open |
| OR-8 | S3 | No screen shows which admin did anything; every operator trail row renders as just "Operator" | — | open |
| OR-9 | S3 | "Booked by phone" rests on one swallowed trail write and one fallible read; either failure makes the pane say "Booked online" | — | open |
| OR-10 | S3 | Creating, editing or lifting a boat-out or closure leaves no record; lifting a hold from `/admin/blocks` writes no `slot_released` | — | open |
| OR-11 | S3 | A comp reads "unpaid" on `/admin/purchases`, the bucket the code itself defines as a defect | — | open |
| OR-12 | S3 | Any refund at all turns a live, paid booking "refunded" in red and drops it from the Paid filter | — | open |
| OR-13 | S3 | An "Awaiting payment" row's Total is fare plus tax only, leaving out fee, tip and insurance, so it is not what the link asks for | — | open |
| OR-14 | S3 | Customer lifetime value ignores the discount, so a comp counts as $500 of revenue | — | open |
| OR-15 | S3 | Purchases and booking-audit rows for public pending reservations link to a pane that answers 404 | — | open |
| OR-16 | S3 | Nothing serialises a block against a claim; a block saved mid-claim and the booking both succeed | — | open |
| OR-17 | S3 | A Hold stops only its exact departure time; another offering's overlapping trip on the same boat still sells | — | open |
| OR-18 | S3 | Block counts count one boat-departure once per offering, so "Departures blocked" and the Blocked chip over-count | — | open |
| OR-19 | S3 | The calendar's "All" chip counts departed slots, which the spec says should be counted nowhere | — | open — same finding as plan S4-29 |
| OR-20 | S3 | The block conflict badge is plain text, sums the fare rather than what was paid, and its comment is stale | — | open |
| OR-21 | S3 | The operator can cancel a paid trip after it has sailed, refunding it and texting the customer | — | open |
| OR-22 | S3 | When the customer pays mid-cancel, the operator is told "Try again in a moment" instead of that the customer just paid | — | open |
| OR-23 | S3 | "The boat is free again and the crew have been told" prints whether or not either happened | — | open — same finding as silent S2-6 |
| OR-24 | S3 | A comp that failed to confirm says "Reload in a moment" but nothing retries it; the only way out is cancel and rebook | — | open |
| OR-25 | S3 | The pane's "Payment link sent" note says nothing about an email that never went when no email channel is configured | — | open |
| OR-26 | S4 | A paid booking's cancel leaves an open balance-link Checkout session payable (live only with deposits on) | — | open |
| OR-27 | S4 | `/b/<code>` itemises a discount differently from the pane and the link, though the totals agree | — | open |
| OR-28 | S4 | §2.10.6's deposit clauses are not built: the link uses a frozen `amountDueNowCents`, saves no card, and past-due balances skip Awaiting payment | — | open — re-read against Phase 19 |
| OR-29 | S4 | §2.10.2's "the words are fixed" is not what the code or the screen uses | — | open |
| OR-30 | S4 | Latent block gaps: duplicate Holds from check-then-insert, an unchecked materialised-Event branch, `saveBlockAdmin` upserting on any posted id | — | open — one row for several items; split them before bucketing |
| OR-31 | S4 | Smaller trail and record gaps: Copy link mints an unrecorded link per render, an unreached send writes no row, no created-at, a mislabelled `post` tip actor, a weak integrity check | — | open — one row for several items; split them before bucketing |
| OR-32 | S4 | An unpaid booking's name, phone, email and party size cannot be corrected; the only fix is cancel and rebook | — | open |

### Paired saves — `docs/audit/2026-11-14-paired-saves.md`

Refer to these as "paired PS-1". The report cites findings already in this ledger without re-reporting them (its lines 325-340).

| ID | Sev | Finding | When | Status |
|---|---|---|---|---|
| PS-1 | S1 | The customer's cancel commits, then the refund never runs, and nothing records that the refund is owed | Feb 1 | open — real work; silent S1-1 is the same defect (re-checked on `main` at `c280379`, issue #1230; since issue #1254 a Stripe call to cancel the balance intent also sits between the cancel and the refund, `src/reservations/cancel-reservation.ts:291`). Proposed fix (not in the codebase): write the owed refund in the cancelling transaction, and resume the refund from it on a retry or a sweep (`docs/audit/2026-11-14-paired-saves.md:53`) |
| PS-2 | S2 | A residual-race loser that was refunded stays `pending` and can later be booked as if it had paid | — | open |
| PS-3 | S2 | The operator's cancel-and-refund can crash after the cancel, leaving no refund and no customer notice | — | open |
| PS-4 | S2 | A comp flips to booked, then the confirmation claim throws; the operator is told it is not booked | — | open |
| PS-5 | S2 | The customer's best-effort `cancelled` trail row is the only source for the money screens' refund figures | — | open |
| PS-6 | S2 | A merge that dies halfway drops side B's confirmed crew without texts or audit rows | — | open |
| PS-7 | S2 | An import that dies in pass 3 leaves events `cancelled` and hides the cancellation from the operator | — | open |
| PS-8 | S2 (low impact) | The flip commits, then delivery dies, and the `booked` trail row is never written | — | open |
| PS-9 | S3 | Stripe refunds, then a local write throws, and the result is reported as "nothing moved" | — | open — overlaps silent S2-1 |
| PS-10 | S3 | A comp's $0 `pending` row is written, then the confirm fails before the flip, leaving a stuck row | — | open |
| PS-11 | S3 | Sweeping a silent ask can charge the −3 twice | — | open |
| PS-12 | S3 | A "Yes" is stamped `accepted` before the seat claim, so a failed claim uses up the answer | — | open — same finding as silent S2-16 |
| PS-13 | S3 | A bail logs the penalty and leaves the person on the seat | — | open — same finding as silent S2-18 |
| PS-14 | S3 | An At-Risk alert is marked sent before the SMS goes out | — | open — overlaps silent S3-1 |
| PS-15 | S3 | A re-form uses up crew transitions before anyone is told | — | open — same finding as silent S2-15 |
| PS-16 | S3 | A self-claim succeeds while telling the crew member it failed | — | open |
| PS-17 | S3 | A remove or bail that fails at the refresh reports `raced`, and nobody is told | — | open — same finding as silent S2-13 |
| PS-18 | S3 | A waiver-reminder window is claimed before the sends, so a crash leaves nobody reminded | — | open |
| PS-19 | S3 | A crew DM is started with three writes and no transaction | — | open |
| PS-20 | S3 | Rotating a calendar feed saves the new token, then hands it over in a cookie that can be lost | — | open |
| PS-21 | S4 | A PaymentIntent is minted, then `recordCheckoutAttempt` is lost; a changed retry is refused until the hold lapses | — | open |
| PS-22 | S4 | The reuse path raises the amount, then the re-freeze is lost; the webhook never compares charge amount with invoice | — | open — overlaps plan S2-1 |
| PS-23 | S4 | A residual-race redelivery after 24 hours could write a false `refund_failed` and a false "REFUND MANUALLY" alert | — | open |
| PS-24 | S4 | `charge.refunded` writes the ledger, then the trail row; a lost trail write is never redelivered | — | open |
| PS-25 | S4 | `markPaymentDisputed` is last-write-wins, so a late retry can set the row back to `disputed` after `won` | — | open |
| PS-26 | S4 | The in-memory `bookPendingIfHullFree` writes the Event before the refusal check, unlike Postgres, so tests can pass on unreachable state | — | open — same finding as db S3-1 |
| PS-27 | S4 | `setPaymentConfig` and `setCheckInConfig` upsert one key at a time with no transaction | — | open |
| PS-28 | S4 | `void repo.touchCalendarFeedPoll(...)` may never run on serverless; `after()` would guarantee it | — | open |
| PS-29 | S4 | A sign-in code is stored, then the email send fails silently, blocking a re-request for 60 seconds | — | open — overlaps silent S3-19 |
| PS-30 | S4 | The login code is consumed before the session cookie is set, so a cookie failure spends the code | — | open |
| PS-31 | S4 | An escalation nudge is sent, then `nudged` is logged; a lost log defeats the one-nudge cap | — | open |
| PS-32 | S4 | A `catch { rollback; throw }` whose rollback throws masks the original error | — | open |
| PS-33 | S4 | When a hold is released, the trail row is its only record, and a lost trail write loses it | — | open |
| PS-34 | S4 | The recovery trail row says `sent` whatever the channels did, because the send result is discarded | — | open — overlaps silent S3-16 |
| PS-35 | S4 | The fake `refund` dedupes on the key alone, so a same-key, different-amount refund Stripe would reject passes in tests | — | open |

### §2.8 conformance — `docs/audit/2026-08-29-spec-2.8-conformance.md`

Refer to these as "conformance C15". IDs are the report's criterion numbers. The report has no severities, so these were set when the rows were added; a duplicate takes its other row's.

Added by issue #1230, after re-checking each of the 14 criteria short of `BUILT`, and defect #825, against `main` at `6182e1c`. These were closed by then and have no row: criteria 1, 2, 6, 9, 11, 22, 23, defect #825, and 24 (task 14.3). Criterion 20's trip-time half is closed too; what it has left is C20 below. Criteria 3, 8, 10, 13, 14, 16, 17, 18 and 21 were `BUILT` in the report.

| ID | Sev | Finding | When | Status |
|---|---|---|---|---|
| C4 | S1 | A booked rival still blocks its hull by trip time (`src/reservations/write-booking.ts:140`, `src/reservations/hull-busy.ts:93`); pending rivals are measured by hold minutes now | Feb 1 | duplicate of money F1 |
| C5 | S4 | `docs/SPEC.md:1633` says the step-3 refusals run holding the hull lock; the grid, season, departed and cutoff checks run before it (`src/reservations/claim.ts:316-354`) | — | open — check whether the block and closure checks are inside the lock; if they are, this is spec wording |
| C7 | S4 | No test asserts that an abandoned checkout sends nothing; the Event, customer and booking-code halves are tested | — | open — test gap |
| C12 | S1 | A superseded payment that succeeds late resolves to its row and is never refunded | Feb 1 | duplicate of money F2 |
| C15 | S1 | The reconciler is not built | Feb 1 | duplicate of money F3 |
| C19 | S4 | A succeeded payment that matches no row (`no_row`) sends no alert (`src/reservations/booking-webhook.ts:812-827`) | Feb 1 | duplicate of money F20 |
| C19b | S4 | No test reads the amount out of an unmatched-charge alert | — | open — test gap |
| C19e | S4 | No test calls `alertMoneyProblem` with text messaging unconfigured | — | open — test gap |
| C20 | S4 | No test edits the schedule mid-checkout, and the hold-minutes test asserts the row's value, not what it occupies | — | open — test gap |
