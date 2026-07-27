-- 0003_event_dock — per-event departure location for the shift card's map pin
-- (SPEC §2.6.3, #13). Per-event (not per-vessel): the same boat can leave
-- different docks on different events. Nullable text (a place name/address the
-- card encodes into a maps URL); imported events may not carry it. Same design
-- rules as 0001 — no CHECK (a vocabulary CHECK is a business rule: DEC-DATA-1) and no FK
-- (posture: DEC-131 — DEC-DATA-1 never governed constraints).

alter table events add column dock text;
