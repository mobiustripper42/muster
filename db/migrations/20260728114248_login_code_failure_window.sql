-- 20260728114248_login_code_failure_window — bound brute force ACROSS re-mints (#522 sweep 2).
--
-- `attempts` (0012) caps guesses per CODE. It is not a bound on the subject, because a
-- re-mint upserts the row with `attempts = 0` — so the sustained rate was MAX_ATTEMPTS per
-- RESEND_COOLDOWN_MS forever: ~7,200 guesses/day against a 10^6 space, in parallel across
-- every roster email, with no per-IP limit anywhere in the app. 0012's own header is honest
-- that security rests on the cap; this is the missing half of that cap.
--
-- It matters more than the arithmetic suggests because admins are crew (DEC-092) and a crew
-- session escalates to the full cockpit in one click (`switchToAdmin`). Guessing one 6-digit
-- code reached the operator account, not just a crew view.
--
-- Two columns, both surviving the re-mint upsert that resets `attempts`:
--   failed_since      — start of the current rolling window (ISO-8601 UTC text, house style)
--   failed_in_window  — failed verifies accumulated across every code minted in that window
--
-- Nullable with no default rather than `not null default 0`: an existing row predates the
-- window and should start one on its next failure, not claim a window it never had. The
-- service layer owns the rolling reset (DEC-DATA-1) — no trigger, no expression index.
--
-- Deliberately NOT per-IP. Per-IP doesn't lock a real crew member out, but it's evaded with
-- one proxy, and it needs request-scoped state the domain core can't see without breaking
-- the port boundary. Per-subject is the honest trade and its cost is stated in DEC-142: a
-- burned window is an account-lockout DoS. The cap is set generously for that reason.

alter table login_codes add column if not exists failed_since     text;
alter table login_codes add column if not exists failed_in_window integer;
