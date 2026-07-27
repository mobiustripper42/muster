-- 20260719011405_crew_gusto_identity — crew→Gusto payroll identity (task 12.3b, DEC-124).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- The Gusto timesheet identity for the gratuity payroll report (12.3b) lives ON the crew row
-- — Muster owns crew records natively, so there's no separate map file (unlike the extractor's
-- guide-gusto-map.json). Single nullable jsonb ({firstName,lastName,title,employeeId}); cleaner
-- than four loose string columns and it's exactly what the CSV needs. Absent ⇒ that crew
-- member's tips warn + their CSV row won't import (no employeeId). Additive + inert; seeded
-- from the roster via db:crew. House style (DEC-DATA-1): jsonb like ratings/manning, no CHECK.

alter table crew_members add column if not exists gusto jsonb;
