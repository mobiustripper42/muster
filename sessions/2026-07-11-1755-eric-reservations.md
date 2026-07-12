---
session: 46
dev: eric
slug: reservations
branch: feature/reservations
started: 2026-07-11T17:55:10Z
ended:
points:
pr_numbers: [382, 383, 386]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/3e406f73-c6f5-4b97-acea-59decccd4662.jsonl
---

# Session 46 — reservations (Phase 11 kickoff)

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: Phase 11.0 — reservations source partition + per-event price (closes #366)

**Completed:**
- **Precursor (this session; shipped as PR #381, merged):** grounded + @architect-**verified** the reservation model — recorded `docs/design/reservations-model.md`; landed the DEC-108/109 amendment (**whole-boat MUTEX, not `COI − Σ party sizes`**), **DEC-112** (per-event `Event.price`), **DEC-113** (insurance-as-flag, not a priced add-on); restated PROJECT_PLAN 11.0/11.1/11.3 + a P12 **admin-surfaces-unspecced** note. Grounding: `docs/design/the-booking-1.md`, `the-living-link-1.md`, Xola seller screenshots (`docs/design/xola *.png`). Business model confirmed: **whole-boat-private, one reservationist**; split-pay idea already in `the-living-link` §6/§8.
- **11.0 code (PR #382):** migration `0023` (`source` on events+reservations backfill `'xola'`, nullable `Event.price` cents, `muster_owned_vessel_days` table); `Source`/`Event.price`/`MusterOwnedVesselDay` entities (`source` required, log-day-one); postgres + in-memory read/write + 2 port methods + contract coverage; importer writes `source:'xola'` + Pass-2 **skip-and-itemize guard** (`category: "muster_owned"`, out of `placed` so Pass 3 drops reservations); **`db:own` CLI** (`list`/`mark` + DEC-106 sequencing warning); **45 crew-engine fixtures** updated for required `source`.
- `npm run verify` green (**981 tests + build**); postgres contract 64.

**Code review:** Clean — adapter parity, SQL param/column counts, importer guard all verified correct. One nit fixed: `db:own` warns only on SCHEDULED Xola events (a cancelled one strands nothing).
**⚠️ DEPLOY:** migration `0023` must be hand-applied to prod on the next migration push (additive + inert, safe anytime): `DATABASE_URL=<neon-direct> npm run db:migrate`.
**PR:** [#382](https://github.com/mobiustripper42/muster/pull/382) — into `main`. (Precursor docs: [#381](https://github.com/mobiustripper42/muster/pull/381), merged.)
**Points:** 5
**Branch:** task/11.0-source-discriminator
**Opened at:** 2026-07-12T00:47:58Z

## Task 2: Phase 11.1 — availability read model (whole-boat mutex) (closes #367)

**Completed:**
- **New `src/reservations/availability.ts`** (reservations domain area, distinct from the crew oracle):
  - `deriveAvailability(events, reservations)` — pure; per-Muster-event availability as a **whole-boat MUTEX** (`available` iff zero active `booked` `source='muster'` reservations), only `scheduled` Muster events, surfaces `Event.price` (DEC-112).
  - `canBook(event, reservations, partySize)` — the pure claim predicate (`1 ≤ party ≤ capacity` AND unclaimed) that 11.3's atomic webhook will wrap (DEC-109 mechanism unchanged).
- 11 tests (`availability.test.ts`): mutex proof (party of 4 on a 12-cap boat reads unavailable — not "8 left"), Xola/cancelled exclusion, cancelled-reservation-doesn't-claim, price surfacing, full `canBook` bounds.
- Purely additive — no migration/seed/DB touch, so no e2e-seed risk. `npm run verify` green (**992 tests + build**, +11).

**Code review:** Clean bill of health — mutex correctness, `canBook` bounds, no seat-subtraction, function parity (shared `isActiveMusterClaim`), exhaustive filtering over closed unions.
**PR:** [#383](https://github.com/mobiustripper42/muster/pull/383) — into `main`.
**Points:** 3
**Branch:** task/11.1-availability
**Opened at:** 2026-07-12T05:45:58Z

## Task 3: Phase 11.3 — booking write + atomic whole-boat claim (closes #369)

**Completed:**
- **The correctness hinge** (DEC-109, @architect-designed). Stripe-independent core; webhook deferred with 11.2. **PRs into `feature/reservations`** (behind `RESERVATIONS`), not main.
- **New port `saveReservationIfUnclaimed`** — both adapters. Postgres: `SELECT 1 FROM events … FOR UPDATE` + guarded `INSERT … WHERE NOT EXISTS(active muster reservation, id<>self) ON CONFLICT(id) DO NOTHING`, one txn — the event-row lock is the mutex, **not** a unique constraint (n:1 intact). In-memory = single-threaded twin. Source-scoped, idempotent on id.
- **Contract tests** both adapters incl. the real race (`Promise.all` two claims → exactly one winner, against real Postgres).
- **`writeBooking`** (`src/reservations/write-booking.ts` + test): `canBook` pre-check + CAS, provider-agnostic `idempotencyKey` → deterministic `ReservationId`, outcomes `booked|already|lost|unbookable`.
- Event pre-exists → zero migration. `npm run verify` green (**1013 tests + build**, +21).

**Code review:** Clean bill of health — SQL race-safety (`FOR UPDATE`, no oversell/deadlock), schema/param correctness, adapter parity, `writeBooking` outcome logic all verified. Cosmetic note (unfixed): concurrent identical-retry returns local `updatedAt` not the persisted row's — harmless.
**PR:** [#386](https://github.com/mobiustripper42/muster/pull/386) — into **`feature/reservations`**. Base≠main → CI skipped; `verify` run locally.
**Points:** 5
**Branch:** task/11.3-booking-claim
**Opened at:** 2026-07-12T14:07:36Z

**Next Steps:**
- **#382 (11.0) + #383 (11.1) merged to `main`.** **Merge #386 (11.3)** into `feature/reservations` (base≠main → CI skipped, verified locally).
- **Prod migration owed:** `0021`+`0022`+`0023` hand-apply on next push (verify 0021/0022 weren't already applied out-of-band): `DATABASE_URL=<neon-direct> npm run db:migrate`.
- **BLOCKED on Drew — 11.2 Stripe (#368):** deposit-or-full (+%), balance timing, **which Stripe account** + test/live keys + webhook secret, pilot price, refund tiers (confirm ≥14d −$50 / <14d $0 / operator-cancel full). Insurance $30→72h (11.5), tax/fee, waiver provider. **Skipped until answered.** If Drew says full-upfront, 11.2 shrinks (no balance-link).
- **Buildable without Drew:** 11.4 (booking-link + confirmation emit, #370), 11.7 (manifest hinge verify, #373), the availability+writeBooking half of 11.6. `typecheck:db` prevention still owed.
- 11.4–11.8 ride `feature/reservations` behind `RESERVATIONS` (DEC-111).

**Context:**
- **Dedicated worktree:** this session builds in `/home/eric/muster-reservations` on `feature/reservations` (off main `5bac70a`), independent of main→production. Everything rides the `RESERVATIONS` flag (DEC-111) except the inert `source` migration (11.0 → main).
- **Concurrency storm:** multiple windows open on the leftover `task/268-scrollbar-gutter` branch, each auto-firing `/its-alive`. Session 44 abandoned, Session 45 opened bare (transcript `079da17b`). This session (46) is the real reservation-build window (transcript `3e406f73`). Session points advisory per cross-machine reality.
- **Plan landed:** PR #362 merged the reservation plan to main just before this session — DEC-105–111 + Phase 11/12 (renumbered from 098–104 to dodge the calendar-feed DEC-098 collision). Don't re-merge #362.
- **Owner-gated (Drew/Spink), gates 11.2/11.5 not the phase start:** deposit %, balance timing, refund policy, which Stripe account, waiver provider. Chasing in parallel.
- **11.2 lifts Stripe charge/refund from `/home/eric/sailbook`** (sibling project) — audit on the way in.
