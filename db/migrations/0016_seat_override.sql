-- 0016_seat_override — operator-added manning-override seats (8.5, SPEC §2.3).
--
-- The operator can adjust a shift's manning beyond the derived COI minimum: add a
-- required working hand (gates Crewed) or a supernumerary/trainee seat (non-gating).
-- These seats are NOT produced by `deriveSeats` (which only builds the vessel's COI
-- manning), so on the next `formShifts` re-derive a surplus REQUIRED override seat
-- would be pruned as "manning shrank." This flag marks it operator-owned so the
-- prune skips it — the shift-editor analog of `split_cut_time` surviving re-import.
-- (Supernumerary seats already survive: the prune only touches `required` seats.)
--
-- Nullable boolean, null reads as false (parity with `acquired_via`): derived seats
-- leave it null; only an operator override sets it true. Removed via `removeSeat`.

alter table seats add column override boolean; -- true = operator-added manning seat, protected from prune
