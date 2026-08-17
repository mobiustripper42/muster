---
id: DEC-081
title: "Crew sign-in is a 6-digit email code, not a magic link — and it's the one login primitive (refines DEC-079)"
topic: "Crew self-serve, auth & admin identity"
---

## DEC-081: Crew sign-in is a 6-digit email code, not a magic link — and it's the one login primitive (refines DEC-079)

**See also** — decisions this one changed part of:
- Refines DEC-079 — the mechanism only
- Revises DEC-010 — the mechanism only — see DEC-079

**See also** — later decisions that changed part of this one:
- Refined by DEC-142 — the cap only — `attempts` per code gains a rolling per-subject failure window, and the verify response collapses to one value. The email-as-channel and code-shape legs stand

**Status:** Accepted (Phase 7, issue **7.0**). Built in two PRs: **7.0a** (the flow, dark behind a flag,
fake delivery) and **7.0b** (real email). Refines DEC-079's mechanism after building it surfaced four
things that change the shape; the goal (a self-serve front door) is unchanged.

**Decision:**
- **Code, not link.** Sign-in emails a **6-digit numeric code** the crew member pastes back, instead of a
  click-through magic link. The link's failure mode on mobile is the killer: it opens in the *email app's*
  in-app browser, not the installed PWA, so the session cookie lands in a context the crew member isn't
  using. A code never leaves the app they started in. It also deletes the prefetch-burn problem (the
  GET-peek/POST-consume dance exists only because preview bots fetch URLs) and the link-host coupling
  (`APP_BASE_URL`, DEC-057).
- **One login primitive; links are only ever deep-links.** "All login is a code" — there is never a second
  login path. The ask-relay and doorbell-ring **links stay links** because they are *addressed deep-links*
  (auth **plus** a target — answer *this* ask, open *this* thread), not bare logins; recoding them would
  regress the Phase 6 one-tap flow. Rule: **a login is always a code; a link is never a bare "log in".**
  The code primitive is built once (7.0) and reused as other logins (admin) are built — not a rip-replace.
- **Email entry, not phone entry** (changes DEC-079). Delivery is email and email is universal on the
  roster; **phone is not** (operator-managed crew like Henry have none). So the identifier you type is your
  **email** — "type your email → code in that email," what-you-type-is-where-it-goes, no phone dependency.
  Phone entry returns when SMS/Twilio gives a second channel to justify a second entry field.
- **Its own `login_codes` table, NOT `magic_tokens`.** A 6-digit code is not globally unique, and
  `magic_tokens.token_hash` is `unique` + hash-keyed — so codes are keyed by **subject** (one live code per
  subject; re-request upserts), which is also what makes attempt-capping possible (find the row by *who*,
  not by a wrong guess that hashes to nothing). Only `sha256(code)` is stored.
- **Security is the cap, not the entropy.** 6 digits + a **5-attempt ceiling** + a **10-min TTL** + a
  60s re-mint cooldown. The throttle does the work, so the code stays short and number-pad-friendly
  (`inputmode=numeric`, `autocomplete=one-time-code`). Letters/symbols were rejected: they buy entropy the
  cap makes unnecessary and cost typeability.
- **Email delivery = Resend over `fetch`, on the ChannelPort seam (7.0b).** No SDK (the env-key+`fetch`
  shape the Xola adapter already uses — no new dependency), `EMAIL_FROM` on a DKIM-verified
  **`crew.brewcle.com`** subdomain (isolates sending reputation). 7.0a delivers through `FakeChannel`
  (logs) + a dev-only `/crew/dev-code` echo (hash-only store, gated 404-in-prod like `dev-link`).
- **Flag-gated OFF in prod until 7.0b** (`CREW_SELF_SERVE`, DEC-059). `main` must stay promotable at all
  times; a login that says "check your email" and emails nothing (7.0a's fake channel) would be a broken
  prod login, so the self-serve landing ships **dark**, flipped on when real email is verified. **Sign-out
  ships live** (unflagged — it only clears the caller's own cookie).
- **Email stays nullable** (does NOT take DEC-079's "email where on file; otherwise relay" *or* a
  required-email migration). The repository contract treats crew-without-email as a supported shape, and a
  system-wide required-email change is its own task. The flow is safe regardless: an email-less crew member
  simply doesn't match → the identical generic response, no leak, no false "check your email." "Everyone
  has email" is **operator data discipline** (a candidate add-crew-form constraint), not a DB constraint
  here — which also dissolves DEC-079's email-less dead-end.

**Why:** the click-to-wrong-browser problem is magic links' #1 real-world failure for an installed-PWA crew
audience; the operator confirmed it's exactly the friction they disliked. Everything else (own table,
attempt cap, email entry, flag gate) falls out of choosing a short human secret delivered by email.

**Tradeoff / rejected:** reusing `magic_tokens` for codes (unique-hash collision); making `crew_members.email`
NOT NULL in 7.0 (breaks the contract's optional-email shape, system-wide blast radius); alphanumeric codes
(typeability cost, no security gain under the cap); phone-entry now (no SMS channel yet); recoding the
deep-links as codes (regresses the one-tap ask/ring flow). **Revisit if:** SMS lands (re-add phone entry +
SMS code channel) or the email-less gap bites (promote to a required-email task or operator-relay). **Phase:** 7 (7.0a/7.0b).
