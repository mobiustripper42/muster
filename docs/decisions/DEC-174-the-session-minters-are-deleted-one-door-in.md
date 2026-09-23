---
schema: 1
id: DEC-174
title: "The session minters are deleted — one door in"
topic: "Crew self-serve, auth & admin identity"
status: "active"
date: "2026-09-15"
ruling: "`/crew/dev-link` and `db:mint` are both gone. The only way to a session is the 6-digit code at `/crew`, plus the drawer's Switch to admin for the cockpit. Nothing mints a session out of band, in any environment."
claims:
  - kind: "file"
    target: "app/lib/switch-actions.ts"
    note: "switchToAdmin — a crew session becomes an admin one"
  - kind: "file"
    target: "e2e/fixtures.ts"
    note: "the suite signs in through the code door, once per saved identity"
  - kind: "file"
    target: "app/(crew)/crew/dev-code/route.ts"
    note: "stays — echoes a code, mints nothing"
supersedes:
  - DEC-034
revisit_if: "A deployment is locked out — no admin can reach /admin, or the code cap strands crew in season"
---

## DEC-174: The session minters are deleted — one door in

`/crew/dev-link` was an unauthenticated route minting a session for any crew id or admin handle.
`db:mint` did the same from a terminal; DEC-034 built it because no production auth path existed. One does now: DEC-081's 6-digit code, plus DEC-093's switcher turning that session into an
admin one for anyone holding an active `admins` row — the operator's actual habit, not a theory.

Fresh deployment: `db:crew` and `db:admin` seed the person and the row; they sign in like everyone
else. **This narrows rather than matches** — the minters took any crew id and asked nothing else,
while the code needs an email on file, so `db:admin add --crew=` now refuses one without.

Two consequences, stated rather than discovered later. **Email is now load-bearing for admin
access**: unwire `RESEND_API_KEY` and nobody reaches `/admin`. And the login-code cap has no
bypass — `db:mint --crew=<id>` was it.

The e2e suite used dev-link in 52 of 56 specs. It now signs in through the code door.
