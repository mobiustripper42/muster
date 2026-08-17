---
id: DEC-092
title: "Admin becomes a first-class auth identity — per-person revoke (10.2, #283; revises DEC-020)"
topic: "Crew self-serve, auth & admin identity"
---

## DEC-092: Admin becomes a first-class auth identity — per-person revoke (10.2, #283; revises DEC-020)

**See also** — decisions this one changed part of:
- Revises DEC-020 — admin is a first-class auth identity

**Status:** Decided 2026-07-06 (Eric, Phase 10). @architect-gated.

**Decision.** Admin `subject_id` stops being a free-form operator handle (DEC-020's "admin is a
non-identity") and becomes a real id in a new `admins` table (`id, handle, name, active, created_at,
deactivated_at`; text PK, no FK, dates-as-text per DEC-DATA-1 — `db/migrations/0018_admins.sql`).
**Every admin is also crew, so `admins.id` IS that person's crew id** — an admin session is
`{kind:"admin", id:<crewId>}`, that person's crew session is `{kind:"crew", id:<crewId>}`; `kind`
disambiguates, the same string is fine (no collision). `handle` is a short mint key
(`db:mint --admin=<handle>` / `dev-link?admin=<handle>` both resolve handle→id and refuse an
unknown/inactive handle).

**Per-person revoke.** Sessions are stateless HMAC (`src/auth/session.ts`) — which is *why* the only
prior revoke lever was rotating the shared `SESSION_SECRET` (logs everyone out). `readSubject`
(`app/lib/auth.ts`) now does **one stateful lookup for admin subjects only** — `getAdmin(id)`, require
`active` — so a deprovisioned admin (flip `active=false`) dies on their next request, immediately, while
every other admin's session is untouched. **Crew subjects skip the lookup entirely**, so the magic-link
hot path (20–25 crew) stays fully stateless. Deprovision = `update admins set active=false,
deactivated_at=… where handle=$1` (documented in `docs/DEPLOY.md`); `SESSION_SECRET` rotation remains the
global break-glass. Launch admins (Eric/Brendan/Drew) are seeded in the migration; add/remove is
seed + CLI/SQL — **no admin-management UI**.

**Scope (deliberately minimal — architect-bounded).** NO roles/RBAC (all admins equal; a `role` column
is the clean seam), NO admin-management screen, NO per-admin session-version/epoch (terminal deprovision
only needs the `active` flag), NO passwords/2FA (magic-link unchanged), NO admin audit log. Each is a
future add with a seam left open. **Rejected:** a per-admin session-version column (over-builds terminal
revoke), a revocation-list table (a second source of truth for `active`), a stateful check on crew reads
(needless hot-path DB hits), an admin UI (deferred at ~3 admins), and bushel's eventual-revoke shape
(its `is_active` only blocks *new* logins — muster's readSubject check is immediate, the point of 10.2).

**Relationship.** Revises **DEC-020** (only its "admin is a free-form non-identity" clause; the "no auth
*platform*" decision still holds — nothing here adopts one). Keeps **DEC-058**'s `AuthSubjectKind`
(`admin|crew`) canon unchanged. This is the *auth* identity only — deliberately NOT unified with the
DEC-030/058 messaging "operator-as-crew" path (`OPERATOR_CREW_MEMBER_ID`), which stands until the
follow-up. **Supersedes** the "no admin entity" framing in `app/lib/operator.ts`.

**Follow-up (not this PR).** Retire the `OPERATOR_CREW_MEMBER_ID` singleton: the "from the office" /
inline-answer-in-outbox sender should key off "is this crew member an admin" against the `admins` set, so
*any* admin is the office — a DEC-030/058 messaging refactor, kept out of the auth change for reviewability.
Also parked: a crew↔admin identity switcher (FUTURE_IDEAS, 2026-07-06 — every admin is also crew).

**Revisit if:** admin roles or per-admin session-rotation (revoke-live-sessions-but-keep-the-admin) are
actually needed.
