-- 20260719185042_reservation_extras_cents — freeze the party-fare extras on the reservation (#474).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- DEC-107 amend (12.2): Event.price is the per-departure BASE only (DEC-125); the fare the
-- customer paid is base + extra-guest charges (composeFare). The balance deriver must see the
-- extras or a deposit-mode balance undercollects by extras + tax(extras). Freeze the extras
-- portion here at booking. NULLABLE + additive + inert: absent ⇒ 0 (Xola rows, the legacy
-- seeded writeBooking path, any pre-12.2 booking) — those price exactly as before. No FK/CHECK
-- — house style (DEC-DATA-1).

alter table reservations add column if not exists extras_cents integer;
