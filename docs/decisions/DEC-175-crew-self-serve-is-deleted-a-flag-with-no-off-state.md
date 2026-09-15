---
schema: 1
id: DEC-175
title: "CREW_SELF_SERVE is deleted — a flag with no off-state"
topic: "Crew self-serve, auth & admin identity"
status: "active"
date: "2026-09-15"
ruling: "The flag and its ten guards are gone. The code login and `/crew/open` are live everywhere. Nothing is dark behind an env var that was on in production and on in e2e."
claims:
  - kind: "file"
    target: "app/lib/flags.ts"
    note: "selfServeEnabled removed; flagOn and the other three stay"
  - kind: "file"
    target: "app/(crew)/crew/page.tsx"
    note: "the flag-off signed-out screen deleted with it"
  - kind: "file"
    target: "env.example"
    note: "EMAIL_FROM + RESEND_API_KEY decide sign-in now"
revisit_if: "A crew surface needs shipping dark again — then it gets its own flag, with an off-state something exercises"
amends_spec:
  - section: "2.7"
    scope: "the surface is no longer dark by default, and no longer coupled to the login door by one env var"
---

## DEC-175: CREW_SELF_SERVE is deleted — a flag with no off-state

DEC-081 shipped the crew code login dark, because a login saying "check your email" while emailing
nothing is a broken front door. That was right. Email got wired, the flag went on in production, and
`playwright.config.ts` had always set it — so from then on its off-branch executed nowhere.

Ten guards remained. What they bought was an untested path: nobody knew what `/crew` rendered with
the flag off, because nothing ran that way — including a second signed-out screen telling crew to
tap an operator-relayed link, a sentence DEC-174 had already made false.

Two comments had inverted too. `flags.ts` still called it "OFF by default" and `/crew/open` still
said "404 in prod until the flag flips" — a comment stating the opposite of the code is worse than
none.

**`EMAIL_FROM` and `RESEND_API_KEY` decide sign-in now**, not a flag. Unset on a prod deploy
nobody gets in at all, crew or admin, since DEC-174 made the code the only door.
