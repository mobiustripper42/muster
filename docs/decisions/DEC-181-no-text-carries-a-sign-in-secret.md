---
schema: 1
id: DEC-181
title: "No text carries a sign-in secret — the code is the only door"
topic: "Crew self-serve, auth & admin identity"
status: "active"
date: "2026-09-23"
ruling: "Every crew text carries a plain link — `/crew`, or the thread for a ring — with no secret. A signed-in crew member lands there; a signed-out one meets the 6-digit code. `/crew/auth` and `magic_tokens` are gone."
claims:
  - kind: "file"
    target: "src/adapters/twilio-channel.ts"
    note: "the ask, notice and ring links carry no secret"
  - kind: "spec"
    target: "2.6.1"
  - kind: "spec"
    target: "3.2"
supersedes:
  - DEC-150
revisit_if: "Crew routinely meet the code door when tapping an ask — sessions lapsing faster than the 14-day sliding window assumes"
amends_spec:
  - section: "2.6.1"
    scope: "the ask's link lands a signed-in crew member on Yes/No; a signed-out one signs in with the code first — 'no login' now means 'no password'"
  - section: "3.2"
    scope: "one passwordless entry, the 6-digit code; action links are plain deep-links, never a login"
---

## DEC-181: No text carries a sign-in secret — the code is the only door

DEC-081 made the code the one *login* but kept ask and ring links as addressed deep-links with a
one-time token inside. That was a second door: its own table, expiry, replay guard, prefetch-safe
interstitial (DEC-150), and a credential in every text and dev log line.

Operator, 2026-09-16: *"Adds security complexity for what seems like zero added value."* Crew are
normally signed in — the session is 14 days and renews in use — so the token bought one tap for a
crew member whose session had lapsed, at the cost of a whole second authentication path.

Dropping the link altogether was rejected: it is the ask's call to action, and a text saying "open
Muster" loses it for everyone to save a secret no one needs.

Retires DEC-081's "links carry auth" leg only; its code primitive stands.
