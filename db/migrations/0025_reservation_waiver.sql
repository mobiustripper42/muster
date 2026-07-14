-- 11.5 (DEC-110) — liability-waiver consent on the Muster-sold reservation.
-- Minimal consent record (checkbox + linked terms + timestamp), NOT a waiver
-- subsystem; a real provider integration is P12. Both columns nullable:
-- source='xola' reservations (Xola owns its own waiver) and any pre-11.5 Muster
-- booking carry neither. Dates-as-text, ISO-8601 UTC (the reservations.updated_at
-- convention). Additive + inert — safe to apply any time.
alter table reservations
  add column waiver_consent_at text,  -- ISO-8601 UTC instant the customer agreed
  add column waiver_version    text;  -- terms version consented to (server-authoritative)
