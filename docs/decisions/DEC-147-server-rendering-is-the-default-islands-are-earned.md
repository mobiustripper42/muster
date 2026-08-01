---
id: DEC-147
title: "Server-rendering is the default; a client island is earned, and feedback params carry codes not prose"
topic: "UI, brand & frontend patterns"
---

## DEC-147: Server-rendering is the default; a client island is earned, and feedback params carry codes not prose

**Nature:** A record of the record. This documents three rules the codebase has followed
since the first crew surface and **never wrote down as a decision**. Nothing changes; no
code moves. It exists because every citation of these rules points at a DEC that does not
contain them, so a reader who follows the pointer to check the rule finds an unrelated
decision and may reasonably conclude the rule isn't binding.

**Prompted by the operator (2026-08-01):** *"I dunno where we decided no JS, but we did,
and it's written down."* Both halves were right — the rules are real and recorded in
`.claude/ui-context.md`; it was the **attribution** that was wrong everywhere.

### The three rules

1. **Server-rendering is the default.** Surfaces are Server Components; forms post to
   server actions. A page does not become a client component to gain convenience.
2. **A client island is earned, contained, and says why.** `'use client'` is permitted
   for a real, visible UX win that server round-trips genuinely cannot deliver. When taken,
   the island is the smallest possible component — never a page — and its header states
   what it buys. Progressive enhancement holds where it can: the underlying form still
   posts without JS.
3. **Feedback rides redirect params as codes or ids, never prose.** The surface maps a
   code to copy server-side. This is a **security property, not a style preference**: a
   crafted URL must not be able to render attacker-chosen text on a trusted surface. It
   also keeps a stale param honest — a lingering `?err=no_crew` re-reads correctly on
   reload, where an embedded sentence would age into a lie.

### Compliance at the time of writing (measured, not assumed)

- **19 of 157** files under `app/` + `components/` carry `'use client'` — 12%.
- **All 19** carry a documented header — not one bare `'use client'`. Most state the
  client-ness and what it buys (`register-sw.tsx`: *"Client-only island; with JS off it's
  a no-op"*; `use-held.ts`, `clear-feedback-params.tsx`, `book-controls.tsx`); a few
  document what the component is for without naming why it's an island
  (`app/lib/admin-links.ts`). Naming the reason is the standard; the gap is small enough
  to close when those files are next touched.
- **Zero** redirect params carry prose. Every one is a code, an id, or a flag:
  `?err=error`, `?err=no_crew`, `?saved=1`, `?removed=1`, `?stage=code`,
  `?bailed=<shiftId>`, `?claimed=<shiftId>`. No `?msg=`, `?message=`, or `?reason=`
  anywhere.
- Form-posting server actions return `Promise<void>` with `redirect()` outside the `try`.
  The four that return a value (`recordSent`, `recordRingSent`, `recordNoticeSent`,
  `startElementsCheckout`) are island callbacks, which is rule 2's sanctioned shape rather
  than drift.

### The citation problem this fixes

**34 code sites cite DEC-026** for rules 1 and 3 — *"Server-rendered, no client JS
(DEC-026)"*, *"Feedback params carry codes/ids, never prose (DEC-026)"*. DEC-026 says
neither: it is board-ping detection-vs-delivery, lean as a manual nudge, and
reschedule/cancel rendering disabled. A further **23** sites cite DEC-026 correctly, for
those things — one number doing two jobs, one of which was never its.

The attribution was circular. **DEC-055's** own body carries the actual sentence
(*"codes/ids only, mapped to copy server-side"*) while crediting DEC-026 for it.
**DEC-042** §Relationship says *"reuses … DEC-026 (no-client-JS, codes-in-params)"*.
**DEC-133** attributes the posture to *"DEC-021/042"*; DEC-021 is Tailwind styling and
contains nothing about JS. Everyone pointed at DEC-026; DEC-026 pointed nowhere.

Checked against history rather than assumed: extracting DEC-026's own section from
`docs/DECISIONS.md` before the DEC-141 one-file-per-decision split returns **zero**
matches for the clause. It was never there — this is not a fact lost in a migration, it is
a citation that was wrong from the first use and was copied forward.

### What is deliberately NOT done

**The 34 comments are not rewritten.** A bulk find-replace through comment text is exactly
what falsified a dated incident record in #630 — a mechanical sweep cannot tell
present-tense copy from a historical quotation, and the payoff here is a more accurate
pointer in a comment, which is not worth that class of risk against 34 sites at once.
Instead: **new code cites DEC-147, and an existing comment is corrected when it is touched
for another reason.** DEC-026 carries a note pointing here, so following the wrong pointer
still lands somewhere useful.

**Relationship:** states plainly what **DEC-055** (the params-stripping island),
**DEC-085** (a no-JS core under two form factors), **DEC-089** (the pending-state island),
**DEC-097** and **DEC-133** (the booking stepper island) have each been refining. Those
DECs remain the record of their specific carve-outs; this is the default they carve out
*from*. Amends no SPEC section — SPEC specifies behavior, and this is how the behavior is
built.
