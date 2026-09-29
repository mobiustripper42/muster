-- 20260929031317_drop_reservation_terms_consent.sql — drop the checkout box's consent stamp (issue #1112).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- `waiver_consent_at` / `waiver_version` (20260715024323_reservation_waiver.sql, DEC-110) recorded
-- the tick on the checkout's one box, named as a liability waiver. It was never the waiver — that is
-- its own module, signed per guest (docs/design/check-in-and-waivers.md). The box is now the
-- cancellation terms, and the operator decided (2026-09-28) it gates Book & pay and records nothing:
-- a stored click or a "v1" label would be kept for a dispute nobody has had, and the label never
-- proved which words were shown.
--
-- Production holds no Muster reservations — reservations have not been released (operator,
-- 2026-09-28) — so nothing real is dropped. Dev and test rows lose a timestamp nothing reads.
--
-- No index, constraint or foreign key names either column. Reversal, if ever needed:
-- `add column waiver_consent_at text, add column waiver_version text` (the 0715 migration).

alter table reservations
  drop column if exists waiver_consent_at,
  drop column if exists waiver_version;
