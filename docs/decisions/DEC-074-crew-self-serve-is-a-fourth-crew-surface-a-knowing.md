---
id: DEC-074
title: "Crew self-serve is a fourth crew surface — a knowing, recorded exception to \"insultingly small\""
topic: "Crew self-serve, auth & admin identity"
---

## DEC-074: Crew self-serve is a fourth crew surface — a knowing, recorded exception to "insultingly small"

**Status:** Accepted (Phase 7). Reverses BRAND "insultingly small (crew app) — the crew member's
entire world is three surfaces." A crew member named the exception (asked for shift-picking back);
recorded as one, the same way DEC-042's all-shifts view was an operator-named pull exception.

**Decision:**
- A **crew-facing pull surface** (`/crew/open` or similar) lists **Open required seats the viewer is
  eligible for** and lets them claim one. This is the 4th crew surface (alongside ask / my-shifts /
  shift-card). Recorded as a deliberate exception, not a drift.
- **It is NOT a positive-availability calendar** (BRAND §"No positive-availability calendar … suppression
  only"). The crew member claims a **specific, already-formed shift** that exists because trips are
  booked — they are not declaring abstract future availability. The suppression-only oracle (§1.3,
  PTO windows) is untouched; this surface reads *through* it (a suppressed person sees nothing in their
  PTO window). State this distinction explicitly so the surface isn't mistaken for the parked
  availability calendar.
- **Inherits DEC-042's anti-anxiety guardrails verbatim:** default filter = today (+ "this weekend" /
  range presets), forward window clamped to `[today, today+45d]`, **no auto-refresh / no polling / no
  live counts**, `force-dynamic` render on navigation only, **neutral ink not colour** (warm/bad tokens
  stay reserved for the At-Risk board). A bare row count for orientation is fine; a per-state scoreboard
  is not.

**Why:** The "three surfaces" rule guards against friction and stale info, not against a surface crew
actively want. Restoring a loved workflow that *removes* operator toil (mates self-fill; the Sunday
text-blast dies) is squarely on-mission. Framing it as a DEC-042-style recorded exception keeps the
brand discipline honest rather than silently eroded.

**Tradeoff:** A 4th crew surface (the thing BRAND warns against) — accepted because it's pull, opt-in,
and inherits the proven guardrails. Crew can now cherry-pick the good shifts, leaving dregs to the
cascade — *desired* here (the eager people self-serving is the win; the cascade was always the tool for
the rest). **Rejected:** an availability calendar (the parked §4 feature — wrong shape, declares
abstract availability not concrete claims); leaving crewing push-only (ignores explicit crew demand +
keeps the mate toil that never needed to exist). **Revisit if:** cherry-picking strands hard shifts such
that the cascade's captain-fill gets *worse*, not just unchanged. **Phase:** 7.
