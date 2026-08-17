---
id: DEC-010
title: "Crew auth is magic-link passwordless; crew don't self-register"
topic: "Crew self-serve, auth & admin identity"
---

## DEC-010: Crew auth is magic-link passwordless; crew don't self-register

**See also** — later decisions that changed part of this one:
- Revised by DEC-079 — the mechanism only — the crew front door is phone-entry → roster lookup → 6-digit code, not magic-link. The passwordless and no-self-registration legs stand
- Revised by DEC-081 — the mechanism only — see DEC-079

**Decision:** Crew authenticate via **magic-link, no passwords**; the link drops them straight onto
the relevant ask/card. Crew records are **operator-created** (no self-registration). Admin (Spink)
gets a real authenticated login; exact admin mechanism is a build-phase detail.
**Why:** A forgotten password is a ghosted shift; casual crew won't manage credentials (SPEC §2.6.1,
§3.2).
**Tradeoff:** Magic-link delivery depends on the notification channel's reliability (ties to the
native-vs-PWA question, DEC-TBD).
**Revisit if:** Channel reliability proves insufficient at the infrastructure stage.
