---
id: DEC-093
title: "Crew ↔ admin view switcher — same-identity session re-mint (builds on DEC-092)"
topic: "Crew self-serve, auth & admin identity"
---

## DEC-093: Crew ↔ admin view switcher — same-identity session re-mint (builds on DEC-092)

**See also** — later decisions that changed part of this one:
- Corrected by DEC-148 — where the switch-to-admin control lives — the drawer on every crew route, no longer the crew home beside Sign out

**Status:** Decided 2026-07-06 (Eric, Phase 10). Realizes the parked switcher idea (FUTURE_IDEAS
2026-07-06); builds directly on DEC-092's identity model.

**Decision.** A dual-role person (every admin is also crew — DEC-092) moves between the crew app and the
admin cockpit **without re-authenticating**: because `admins.id` IS the crew id, switching is just
re-minting the *other-kind* session for the *same* id. Two server actions (`app/lib/switch-actions.ts`),
both reusing `startSession` — **no new session crypto**:
- **`switchToCrew()`** — admin → crew. **De-escalation, always allowed** (an admin is definitionally that
  crew person). Surfaced in the AdminNav header beside "Muster · date" as **"Crew view"**.
- **`switchToAdmin()`** — crew → admin. **Privilege escalation — gated on `getAdmin(id).active`** (the
  exact DEC-092 revoke check). A non-admin or revoked crew member is bounced to `/crew`, no session
  change. Surfaced on the crew home (DEC-091 hub) beside **Sign out**, shown only when the viewer is an
  active admin.

**Why this is the front door now.** With email wired in prod, crew self-serve **code login** (DEC-081)
is live — so *everyone* signs in once as crew with a code, and active admins switch up. This retires the
`db:mint --admin` magic-link dance as the normal admin path (mint stays as the out-of-band bootstrap).

**Security (flagged for the 10.3 audit).** `switchToAdmin` is the app's **one privilege-escalation seam**.
It is server-side and gated by the same `getAdmin(active)` that `readSubject` enforces on every admin
request — so a revoked admin can neither hold nor re-mint an admin session, and the crew-home control's
visibility is a convenience, not the gate (the action re-checks). No client-trusted role state.

**Rejected.** A **dual-kind session** (hold admin+crew at once) — one subject per cookie keeps the model
simple and every gate unambiguous; switching is cheap. A **client-side view toggle** — role must be
server-gated, never a client flag. Auto-escalating an admin straight to `/admin` on login — the crew code
login is the deliberate single front door; the switch is an explicit, auditable step.

**Relationship.** Builds on **DEC-092** (identity + revoke gate, reused verbatim). Compatible with
**DEC-091** (the switch is a crew-home hub entry, not new nav chrome), **DEC-081** (crew code login = the
single front door), **DEC-058** (`AuthSubjectKind` canon unchanged). Anticipates the **#293** operator-
singleton retirement (a dual-role person as "the office").

**Revisit if:** a true simultaneous dual-session (act as both at once, not switch) is ever needed.
