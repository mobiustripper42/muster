---
id: DEC-079
title: "Crew-initiated sign-in + sign-out — the self-serve front door (a small addition, not a re-architecture)"
topic: "Crew self-serve, auth & admin identity"
---

## DEC-079: Crew-initiated sign-in + sign-out — the self-serve front door (a small addition, not a re-architecture)

**See also** — decisions this one changed part of:
- Revises DEC-010 — the mechanism only — the crew front door is phone-entry → roster lookup → 6-digit code, not magic-link. The passwordless and no-self-registration legs stand

**See also** — later decisions that changed part of this one:
- Refined by DEC-081 — the mechanism only

**Status:** Accepted (Phase 7, issue **7.0** — sequenced *before* the 7.3 browse surface, which is
unreachable without it). Surfaced while reviewing this handoff: self-serve breaks the assumption that
every crew entry is an operator-relayed, action-scoped link (DEC-030/073). A crew member opening the app
*on their own initiative* to browse open shifts has **no link source**.

**What already exists (do not rebuild):** `app/lib/auth.ts` runs a real **14-day sliding session
cookie** (httpOnly, `sameSite=lax`, renewed inside the last 3 days) minted on magic-link consumption
(`/crew/auth` POST, prefetch-safe GET-peek / POST-consume). **`endSession()` — sign-out — already
exists** as a function. The `magic_tokens` mint/verify core (single-use CAS, hashed secret) is built. The
gap is purely the *self-initiated entry point* and a *button* for the existing sign-out.

**Decision:**
- **Sign-out button** — wire the existing `endSession()` to a tap in the crew shell. Trivial; matters now
  (shared/family phones; a standing 14-day session worth being able to drop).
- **Signed-out crew landing with self-service sign-in** — phone entry → mint a magic link → deliver →
  the existing POST-consume path mints the session. **Crew do NOT self-register** (§3.2): the phone must
  match a roster `crew_members.phone`; an unknown phone returns a **generic** "if you're on the crew, a
  link is on its way — otherwise check with the operator" (no enumeration leak of roster membership).
  **Rate-limit** the mint endpoint (anti-spam/enumeration).
- **Delivery channel — MVP = lean on the 14-day session, automated SMS deferred.** The whole current
  model deliberately avoids automated outbound SMS (operator hand-relays every link — the web-link model,
  DEC-030/073). A crew-initiated "text me a link" button *is* automated outbound SMS = the A2P **10DLC**
  trigger (the Sailbook thread; BrewBoat on Sole-Proprietor/Telegram fallback). MVP avoids forcing that:
  crew tap one operator-relayed link, **install the PWA / bookmark**, and stay signed in for 14 days
  (renewed every visit), so a fresh self-service link is needed only on expiry / new device / cleared
  cookies — rare. **Email the link** (`crew_members.email`, nullable) where on file as the non-SMS
  fallback. Automated SMS sign-in links ride the eventual Twilio/10DLC cutover, not this phase.
- **Admin auth is separate and unchanged** (§3.2 "a real authenticated login"); this DEC is crew-side only.

**Why:** The session/auth core is already correctly shaped — this is additive UI + one mint-and-deliver
path, not a re-architecture. Deferring automated SMS keeps Phase 7 from being held hostage by the 10DLC
timeline while still giving crew a working front door (relayed-link-once + long session + email fallback).

**Tradeoff:** Until automated SMS lands, a crew member with an expired session and no email on file needs
an operator-relayed link to get back in — acceptable at pilot scale; the 14-day sliding window makes it
infrequent. **Rejected:** automated SMS sign-in links in MVP (forces the 10DLC decision prematurely);
crew self-registration (violates §3.2 — roster is operator-created); revealing whether a phone matched
(roster-membership enumeration leak); building sign-in as a per-action link only (the very gap self-serve
exposes). **Revisit if:** the relayed-link-once + long-session path proves too leaky (crew locked out too
often) → promote to automated SMS as the forcing function for the Twilio/10DLC cutover. **Phase:** 7 (7.0).
