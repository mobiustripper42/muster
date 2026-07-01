-- 0014 — manual split cut-time (#206, DEC-083, Phase 8.3a).
--
-- A manual split of a vessel-day shift is stored as ONE nullable field on the
-- CANONICAL (side-A) shift row: a vessel-local "HH:MM" cut. Its presence marks
-- the shift split and is the sole partition fact — `formShifts` re-derives the
-- two sides every pull (A = trips before the cut on the canonical id; B = trips
-- at/after the cut on `{id}-b`), so the split survives Xola re-import (Xola never
-- sees it). Null = not split (the byte-identical un-split path). Plain text, no
-- enum (DEC-ROLE-1 posture).
alter table shifts add column split_cut_time text; -- vessel-local "HH:MM" | null
