-- 20261005204104_waiver_one_version_per_instant.sql — one waiver version per instant (issue #1137).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- "One version per future day" was only checked in code before the insert
-- (src/checkin/waiver-admin.ts, resolve()), so two posts for the same day landing together both
-- passed and both took effect at the same midnight, leaving "the current version" arbitrary.
-- A future version takes that day's midnight and a version dated today takes the posting
-- instant, so no two versions legitimately share an effective_from: the unique index is the
-- per-day rule, held by the store. Both adapters turn the violation into `date_taken`.
--
-- Fails if two rows already share an effective_from; check before applying to production:
--   select effective_from, count(*) from waiver_templates group by 1 having count(*) > 1;
create unique index if not exists waiver_templates_effective_from_key
  on waiver_templates (effective_from);
