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
| 2026-11-02 | `/code-review ultra` on pull request #1214 (16.9 self-cancel) | none — the review ran in a cloud session; its fixed findings are in pull request #1214 | — | 3 left over |

Counts are per finding, as the ledger lists them. The capability-URL report's own summary counts 1 / 4 / 12 / 5. Pull request #1220 holds the same capability-URL report, opened by mistake — close it unmerged.

Earlier audits in this folder keep their own status and are not in the ledger: `docs/audit/2026-07-25/README.md` (doc consistency, sharded), `docs/audit/2026-08-07-cutover-phase-a.md` (cutover phase A), `docs/audit/2026-08-29-spec-2.8-conformance.md` (§2.8 and §2.10 conformance, with its own citation ratchet, `npm run check:audit`).

## To do

Worth running, most valuable first:

1. **Test database vs. production database.** Every unit test runs on the in-memory adapter; production runs Postgres. Does every method on the `Repository` port (`src/ports/repository.ts`) behave the same in both adapters — ordering, nulls, conditional writes, locks, duplicate keys? Money F18, crewing S3-1 and crewing S4-11 each found one place they differ.
2. **Silent failures, repo-wide.** For every error the code catches or swallows (`logSwallowed` and hand-rolled equivalents), does a person ever find out? Money F2, F4, F5 and payroll F2 are this shape, found piecemeal.
3. **Messaging and scheduled jobs.** §3.1 and the delivery half of §2.6.1: what happens when a job under `app/api/cron/` runs twice, runs late or fails halfway, and when a send fails. The crewing audit covered whether an ask is made; this covers whether it arrives. Crewing S2-7 and S3-2 are the overlap.
4. **What the plan says shipped vs. what the code has.** Every `[x]` in `docs/PROJECT_PLAN.md` and every acceptance criterion in `docs/SPEC.md`. Money F3 (the reconciler, marked shipped and not built) is the known case.
5. **UI and copy consistency, read from the code.** Every surface against `.claude/ui-context.md` and the glossary in `docs/SPEC.md §0.4` ("trip", never "cruise"), and every surface's empty, error and loading states. A cloud session has no database, so nothing can be screenshotted; this one reads JSX.

Lower value, still open:

6. **Operator-side reservations**, `docs/SPEC.md §2.10`, §3.3 and §3.4, beyond the money paths already covered.
7. **Check-in and waivers**, against `docs/design/check-in-and-waivers.md` and `docs/design/check-in-surfaces.md`.
8. **Two saves in a row that must agree.** Every place the core writes one row and then another, where a failure between them leaves the two disagreeing, and whether each pair should be one write. The worked example is the cancel: it used to cancel the booking and then release its boat as two saves, and issue #1228 made them one (`cancelBookingAndRelease` in `src/ports/repository.ts`).

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

Statuses are `open` unless a row says otherwise. IDs are each report's own; refer across audits as "money F5" or "crewing S2-7".

**When** is the deadline a finding has to be fixed by, set when it is triaged: `Feb 1` (before the Reservations release), `May 1` (before guests and crew are on the water), `after release`, or `—` (not triaged, or nothing left to fix). It stays when the finding is filed, so a phase plan can pick up every `Feb 1` row that is not `fixed`. The crewing and payroll tables are `after release` as a block until issue #1230 triages them (operator, 2026-11-07).

### Money — `docs/audit/2026-11-02-money-spec-2.8.md`

| ID | Sev | Finding | When | Status |
|---|---|---|---|---|
| F1 | S1 | A booked trip blocks its hull for its trip time, not its hold minutes | Feb 1 | open — confirmed real (operator, 2026-11-03) |
| F2 | S1 | A superseded PaymentIntent that succeeds late is a second payment and tip; no refund, nobody told | Feb 1 | open — confirmed real (operator, 2026-11-03) |
| F3 | S1 | The reconciler is not built; `docs/PROJECT_PLAN.md` marks it shipped | Feb 1 | open — confirmed real (operator, 2026-11-03) |
| F4 | S2 | A failed confirmation send keeps the claim; the customer is booked, charged and never told | Feb 1 | open |
| F5 | S2 | A failed self-service refund leaves no work item; the operator email is best-effort | Feb 1 | open |
| F6 | S3 | Booked-row readers recompute tax and balance from the live tax rate (latent S1) | Feb 1 | open |
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
