-- 0003_event_dock — per-event departure location for the shift card's map pin
-- (SPEC §2.6.3, #13). Per-event (not per-vessel): the same boat can leave
-- different docks on different events. Nullable text (a place name/address the
-- card encodes into a maps URL); imported events may not carry it. Same design
-- rules as 0001 — no FK/CHECK, integrity is the service layer's (DEC-DATA-1).

alter table events add column dock text;
