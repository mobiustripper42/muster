-- 0022_drop_shifts_locked_at — remove the inert `shifts.locked_at` column (#256).
--
-- `locked_at` was a Phase-8 review/lock artifact (a "this shift has been reviewed /
-- locked" stamp). Locking was CUT: Xola is the source of truth for bookings and
-- their changes, so a "reviewed/locked" stamp over Xola-derived data is meaningless
-- ("Muster sits next to Xola — no locking"; Phase 8 dropped the review/approve
-- ceremony). The column has had NO reader or writer since — the `Shift` entity and
-- both adapters never touch it — so this is dead schema. Post-#215 cleanup.
--
-- `if exists` keeps it idempotent (a re-run / an env where it was already dropped
-- is a no-op). Different table from the in-flight 0021 (`calendar_feeds`), and it
-- depends on nothing there, so the two apply in either order.

alter table shifts drop column if exists locked_at;
