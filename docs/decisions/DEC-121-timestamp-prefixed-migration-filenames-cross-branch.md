---
id: DEC-121
title: "Timestamp-prefixed migration filenames — cross-branch collision made structurally impossible (refines DEC-020)"
topic: "Deployment, infra & versioning"
amends:
  - id: DEC-020
    relation: refines
    scope: "timestamp-prefixed migration filenames"
---

## DEC-121: Timestamp-prefixed migration filenames — cross-branch collision made structurally impossible (refines DEC-020)

**Status:** Decided 2026-07-15 (Eric + @architect).

**Decision.** New migrations use **`YYYYMMDDHHMMSS_name.sql`** (UTC, 14 digits, no separators).
Existing `00NN_` files (`0001`–`0025`) stay as-is. Project-wide, effective immediately: **no new
numbered migration is ever authored again, on any branch.** Generate only via
`npm run db:new-migration <name>` (`db/new-migration.ts`) — UTC stamp, slugified name, +1s bump on a
same-second collision, writes a stub, prints the path.

**Why.** `db/migrate.ts` orders migrations by lexicographic **filename** sort and keys idempotency on
the filename PK in `_migrations` — it never parses the sequence number (nothing in the repo does). So
the `00NN` integer was never load-bearing, only its sort position. Sequential numbers collide across
divergent branches with no cross-branch reservation: the long-lived `feature/reservations` branch
(DEC-059; Phase 11+12) and occasional parallel task branches on `main` both re-collide by design —
we hit it when `feature`'s `0024_payments`/`0025_reservation_waiver` landed on the same numbers as
`main`'s `0024_audit_events` (#400) + `0025_crew_weekdays_off` (#427), and renumbering only pushed the
clash one step forward. Timestamps give unique names with zero coordination. Every `00NN_` (`'0'`)
sorts before every timestamp (`'2'`) — `main` will never reach a 4-digit number ≥ 2000 — so numbered
files always apply first, in order, then timestamped files in chronological order. Valid apply order
because `main` migrations never depend on `feature` ones, and `feature` absorbs `main` via periodic
merges so its migrations always sit atop `main`'s schema.

**Holds:** the `/promote-production` migration-ledger drift gate (#282) diffs `_migrations` filenames
against repo basenames **as a set** — the naming scheme is irrelevant to set membership, and the
`order by filename` there is display-only. `feature` migrations stay off `main` until the single P12
merge (DEC-059), so they can't trip the gate early. The runner is **forward-only** (no
down-migrations); timestamps don't change that.

**Transition gotcha (one-time):** renaming an **already-applied** file mints a new filename → the
runner sees the old name in `_migrations` and **re-runs the DDL**. The already-renamed reservations
pair (`payments`, `reservation_waiver`) must be reconciled on each `feature` dev DB — reset, or
`update _migrations set filename=…` to the final name — before the next `db:migrate`. Prod never saw
them (feature branch, DEC-059), so prod is clean.

**Rejected:** feature-branch-only scope (leaves the `main` parallel-task collision unsolved — same
root cause); renumbering the reservations pair again (stopgap — `main`'s next number re-collides);
hand-typed timestamps (the helper removes the only failure mode); local-time stamps (cross-dev/DST
inversion vs. real authoring order).

**Refines** DEC-020 (the runner). **Touches** DEC-059 (long-lived feature branches) and the #282
drift gate. **Revise if:** a migration framework is adopted, or the runner ever orders by anything
other than filename sort.
