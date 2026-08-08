---
id: DEC-150
title: "An already-authenticated crew member skips the tap-to-sign-in interstitial"
topic: "Crew self-serve, auth & admin identity"
amends:
  - id: DEC-030
    relation: refines
    scope: "rule 4 (prefetch-safe consume) only — the interstitial stays for every client without a matching session, and the GET still never consumes"
---

## DEC-150: An already-authenticated crew member skips the tap-to-sign-in interstitial

**Status:** Decided 2026-08-07 (Eric, from production use). Refines DEC-030 rule 4. Implemented in #696.

**Context.** DEC-030 rule 4 made `/crew/auth` GET **peek** and render a "Tap to sign in" button, with the
POST doing the consuming. The reason is sound and is not in question: relay links travel through iMessage
and Android SMS, whose link-preview bots GET a URL before the human taps, and a consuming GET would burn
every relayed link in transit.

That is a defence against a client **with no session**. The route did not distinguish one that has a valid
one, so a crew member already signed in tapped again on every ask, every doorbell ring, every notice —
which is most crew, most of the time. The operator hit it in production on a captain's-shift SMS.

**Decision.** On GET, if there is a valid session whose subject **matches the token's subject**, redirect
straight to that subject's destination — the same one the POST computes (`admin` → the At-Risk board,
`crew` → the crew app or the `thread` deep-link). Every other case falls through to the interstitial
exactly as before.

Two constraints carry this, and neither is incidental:

- **Match the subject; presence is not enough.** Signed in as someone else — a shared phone, or the
  operator opening a crew member's link — still gets the button. Auto-redirecting there would put someone
  in the wrong person's world *and look like it had worked*, which is worse than the extra tap by a wide
  margin.
- **The GET still does not consume.** Skipping the tap is a redirect, not a spend, so DEC-030 rule 4's
  no-write-on-GET property is intact. Consuming here was considered and rejected twice over: a browser
  prefetching *with* cookies would burn a link the human has not used yet — leaving a dead link that looks
  fine if their session lapsed in between — and it buys nothing, because whoever holds the phone already
  holds the cookie that makes the token redundant.

**Scope of the benefit.** This helps only where the link opens in a browser that *has* the cookie. iOS
Messages into Safari View Controller shares cookies with Safari; an in-app WKWebView keeps its own jar.
Crew landing in a fresh in-app browser genuinely are not signed in there, and the interstitial is the
correct outcome for them — not a gap in this decision.

**Revisit if:** a native app replaces SMS-delivered magic links with a persistent in-app session (parked in
`docs/FUTURE_IDEAS.md`), at which point this whole surface — interstitial included — stops being the way
crew authenticate.
