---
id: DEC-055
title: "Transient feedback params are stripped post-render by a contained client island (#121)"
topic: "UI, brand & frontend patterns"
---

## DEC-055: Transient feedback params are stripped post-render by a contained client island (#121)

**Status:** Built (Session 23).

**Decision:** No-JS admin surfaces surface one-shot feedback via redirect search params (DEC-026 —
codes/ids only, mapped to copy server-side). On the import surface, a lingering error code in the URL
re-rendered on reload and read alarmingly (#121). A **contained `'use client'` island**
(`ClearFeedbackParams`) now strips the feedback params after first render via `history.replaceState`.
The server still renders the result/error from the params, so DEC-026's no-prose-in-the-URL security is
unchanged — the island only cleans the address bar (gone immediately, and on reload).

**Why a client island (a deliberate DEC-026 carve-out):** the App Router can't modify cookies or the
URL during a Server Component render, and the project runs no middleware — so clearing a param
post-render with zero client JS isn't possible. A ~12-line island is the smallest fix; a flash cookie
can't be cleared on reload without the same constraint, and middleware is heavier and absent. This is
the sanctioned "a real UX win earns a contained island" exception, not a retreat from the no-JS default.

**Scope:** import feedback only (its sole params are one-shot). Reusable for at-risk/outbox if their
stale-param notices ever warrant it — but only where **every** param is feedback; navigational params
(e.g. `/admin/shifts`'s date filter) must be preserved, so don't blanket-strip there.

**Tradeoff:** the import page is no longer strictly zero-JS. **Rejected:** flash cookie (racy TTL /
can't clear on reload), middleware (heavier, none exists), leaving the param (the #121 complaint).
