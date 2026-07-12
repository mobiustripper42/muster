---
session: 46
dev: eric
slug: reservations
branch: feature/reservations
started: 2026-07-11T17:55:10Z
ended:
points:
pr_numbers: [382]
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

**Next Steps:**
- **Merge #382** once CI green → then migration `0023` hand-applied to prod on the next push (with any other pending: 0021/0022 from S43 if not yet applied — verify).
- **11.1 — availability read model = whole-boat MUTEX** (bookable iff no active `source='muster'` reservation AND party ≤ `Event.capacity`; **not** `Σ party sizes`); surface `Event.price`; pure deriver **distinct from the crew oracle**; additive/safe on main (#367, body corrected).
- **11.3** claim predicate restated to the mutex (#369). **11.2 Stripe** owner-gated (Drew): deposit %, balance timing, refund policy, **which Stripe account** — lifts from `/home/eric/sailbook`.
- Phase 11 issues #366–#374 exist (`/start-phase` ran). Build rides `feature/reservations` behind `RESERVATIONS` flag EXCEPT 11.0/11.1 (additive, land on main).

**Context:**
- **Dedicated worktree:** this session builds in `/home/eric/muster-reservations` on `feature/reservations` (off main `5bac70a`), independent of main→production. Everything rides the `RESERVATIONS` flag (DEC-111) except the inert `source` migration (11.0 → main).
- **Concurrency storm:** multiple windows open on the leftover `task/268-scrollbar-gutter` branch, each auto-firing `/its-alive`. Session 44 abandoned, Session 45 opened bare (transcript `079da17b`). This session (46) is the real reservation-build window (transcript `3e406f73`). Session points advisory per cross-machine reality.
- **Plan landed:** PR #362 merged the reservation plan to main just before this session — DEC-105–111 + Phase 11/12 (renumbered from 098–104 to dodge the calendar-feed DEC-098 collision). Don't re-merge #362.
- **Owner-gated (Drew/Spink), gates 11.2/11.5 not the phase start:** deposit %, balance timing, refund policy, which Stripe account, waiver provider. Chasing in parallel.
- **11.2 lifts Stripe charge/refund from `/home/eric/sailbook`** (sibling project) — audit on the way in.
