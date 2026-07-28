---
id: DEC-094
title: "Operator break-glass is CLI + runbook, not an admin UI (10.5; extends DEC-092)"
topic: "Crew self-serve, auth & admin identity"
---

## DEC-094: Operator break-glass is CLI + runbook, not an admin UI (10.5; extends DEC-092)

**Context.** Phase 10.5 was scoped as a crew-facing "support channel," but the real pre-launch need is the
*operator's* one: fast levers to fix a wedged state mid-pilot ("Speedy Gonzalez"). A survey found the
toolkit is already deep (engine pause, `db:admin` revoke, `SESSION_SECRET` rotation, Xola re-pull,
`reset-pilot`, seat overrides) — with one real gap: **no way to fix a crew member's phone/email** short of
raw SQL. A wrong phone means no SMS; a wrong email means the login code never matches — the two most likely
pilot fires. That gap also blocked `db:admin add --email` (which resolves an admin against the crew roster).

**Decision.** Close the gap with a **`db:crew` CLI** and **document the whole break-glass kit** as a runbook
in `DEPLOY.md` — no admin UI. `db:crew` mirrors `db:admin`: framework-free over the Repository port,
unit-tested on the in-memory double, run against the direct prod `DATABASE_URL`, prints the DB host it hit.

**Commands (extended past the initial `list`+`set`):** `list` / `add` / `set` / `enable` / `disable` — the
operator's whole crew-roster surface **short of delete**. A real crew record is never destroyed, only
deactivated (`disable` → `status=inactive`, reversible and audit-friendly). `add` exists because there was
otherwise **no operator path to onboard a new hire** — the seed is a hardcoded dev script and Xola import
makes reservations, not crew (the original "crew come from seed/import" assumption didn't survive the first
real hire).

**`add` must produce an *askable* crew member.** MMC is the universal hard eligibility gate (`eligibility.ts`
HARD_CREDENTIAL_TYPES); a hire with no MMC is asked for nothing. Since BrewBoat keeps no real MMC dates yet
(**DEC-044**), `add` seeds the same far-future placeholder credential the roster seed does (or a real
`--mmc` date) — otherwise a "successful" add would silently never get asked. `add` also validates ratings
against the live role types, derives `crew-<slug>` ids, and reuses `set`'s E.164 + duplicate-email guards.
`enable`/`disable` flip status through a targeted `setCrewStatus` (same lost-update safety as `set`).

**Concurrency-safe by construction.** Unlike the `admins` table (mutated only by `db:admin`), `crew_members`
is written live by the engine/cockpit (reliability, status, ratings). So `set` uses a **targeted
`updateCrewContact`** — a narrow `UPDATE` of only the touched columns via a new port method — never a
whole-row read-modify-write, which would silently revert a concurrent engine write. And it **refuses a
duplicate email** (another crew already holds it): two crew on one email makes login resolve to just one of
them — the exact failure the tool exists to prevent.

**Why no UI.** DEC-092 already deferred an admin-management UI at ~3 admins; the same logic holds for crew
contact fixes at pilot scale. A CLI + runbook is the cheaper, more auditable lever now — every command
prints the DB host it hit. Building `db:crew` is what *lets* the UI keep being deferred, rather than forcing
it.

**Scope held / seams left.** No `db:crew` **delete** (deactivate instead — a destroyed crew id would orphan
their seats/history). No per-crew session revoke — crew sessions are stateless by design (#300); the global
`SESSION_SECRET` rotation remains
the only crew-session hammer. Rollback stays "redeploy a previous Vercel build" — the DB-restore ceremony
is meaningless pre-data and is deferred to whenever live attendance data exists (the reliability loop /
Phase 11).

**Relationship.** Extends **DEC-092** (same CLI-over-UI rationale; `db:crew set --email` is the prerequisite
for `db:admin add --email`). Documents levers from **DEC-037** (Xola re-import), the engine-pause kill
switch, and the `SESSION_SECRET` global revoke. Leaves **#300** (crew-session revocation) and **#189**
(login-code per-IP throttle) as filed follow-ups.

**Revisit if:** admin/crew count outgrows a CLI (then a real roster UI), or real MMC-credential tracking
lands (then `add` takes a required expiry instead of the DEC-044 placeholder).
