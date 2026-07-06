-- 0019_drop_provisional_admins — admins are CLI-managed (`db:admin`), not seeded.
--
-- 0018 seeded a provisional launch roster with GUESSED crew ids
-- (crew-eric-stoffer / crew-brendan-mcgovern / crew-drew-johnson). But an admin's
-- id IS a real crew member's id (DEC-092), and the real crew ids + emails aren't
-- known at migration-authoring time — they come from the actual roster. So baking
-- them into a migration was wrong: prod admins get added AFTER the crew roster
-- exists, via `db:admin add --email=<addr> --handle=<h>` (resolves the real crew id).
--
-- Remove exactly those three provisional rows. Scoped to the id+handle pair 0018
-- inserted, so it never touches a real admin added by the CLI (e.g. a repointed
-- `eric` at a real crew id survives — different id, not matched). Idempotent.

delete from admins
 where (id, handle) in (
   ('crew-eric-stoffer',     'eric'),
   ('crew-brendan-mcgovern', 'brendan'),
   ('crew-drew-johnson',     'drew')
 );
