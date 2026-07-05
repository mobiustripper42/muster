---
session: 38
dev: eric
slug: eslint-setup
branch: task/eslint-setup
started: 2026-07-05T20:30:21Z
ended:
points:
pr_numbers: [273]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/e8236a0e-69f4-48e9-8829-2b9396bda84e.jsonl
---

# Session 38 — eslint-setup

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: Crew app design reconciliation + polish (Phase 9.11, #237)

**Completed:**
- Ran the reconciliation *gate* first (the task's own structure): two-lens pass — `@ui-reviewer` (design-system/a11y/375px) + a frontend-design/aesthetic read — of the 5 live crew surfaces vs the crew mockups (`crewapp.jsx`/`Crew App.html`/`mobileapp.jsx`; `assignmobile`/`mobiledetail` are *admin* mobile, out of scope). Finding: the live surfaces are mostly **ahead** of the mockups — most deltas were supersede-confirmations (live calmer, DEC-backed: DEC-008 no-band, DEC-039 no push-eyebrow, DEC-026/039 no-JS bail, DEC-042 open-surface guardrails). Operator chose "whole thing, one PR, keep it an 8."
- `@architect`-gated the one design decision (crew-side identity color): **both GO**, in-bounds under DEC-086, no new DEC — two render-site amendments.
- **a11y (A):** `/crew/open` filter chips/date inputs/Show → `min-h-[44px]`; shift-card qualifier text `text-faint`→`text-muted` (WCAG AA); thread compose `aria-label`; `VersionTag` on the login/SignedOut screen.
- **voice (B):** calm empty-shifts copy (dropped ⚓ kitsch, kept the push-model reassurance); credential line gained an honest "the office updates your record once you renew" clause instead of the mockup's dead "How to renew" CTA (no renewal destination exists — no-stub).
- **identity (C1, DEC-086):** vessel hue dot on `/crew` My-shifts rows (`vesselHueClass`, `aria-hidden`); co-crew role glyph + label on the shift card — added `role` to the shift-card `CoCrewView` VM with a memoized `roleResolver` shared with `viewerRole`; added `vesselId` to `MyShiftView`. New shared primitives `components/ui/back-link.tsx` (44px, replaces 4 dupes) + `components/ui/role-glyph.tsx`.
- **primitives (C3):** crew button radius normalized `rounded-lg`→`rounded-card`; shared BackLink across open/shift/threads×2.
- Screenshot caught "Hooper"→"Hoop…" truncation on the co-crew row → restacked (name/role over actions) so short names never truncate at 375px.
- New `e2e/crew-reconciliation.spec.ts` (vessel dot, empty state, co-crew role) — 6/6 desktop + mobile (added to the mobile Playwright whitelist per DEC-085). Two DEC-086 render-site amendments in `docs/DECISIONS.md`.

**Code review:** Clean bill of health — no findings above nitpick. VM fields always populated, resolver memo correct, both glyphs `aria-hidden` w/ text as accessible answer, all 4 BackLink sites wired, sweeps surgical (no chevron collateral).
**PR:** [#273](https://github.com/mobiustripper42/muster/pull/273)
**Points:** 8
**Branch:** task/9.11-crew-reconciliation
**Opened at:** 2026-07-05T22:03:34Z

**Next Steps:**
- **File as follow-ups:** full `<Button>` primitive (admin adopts the shared glyph + radius token — the C3 boundary); **C2** the "changed since you last looked" crew cue (a *feature*, ties to `Reservation.updatedAt` / #259, not polish).
- Remaining Phase 9: #247 (civil-hours notices — prod-Twilio blocker), #238 (nav — @architect BRAND gate), #250 (still open). Filed earlier: #256 (drop inert `locked_at` col), #259, #268, #271.

**Context:**
- **Reconciliation lesson:** the crew surfaces were *ahead* of the mockups — the gate's real output was confirming intentional supersedes, not a build backlog. Don't treat a mockup as the target when the live code post-dates it (DEC-074 open surface + §7.6 messaging had no mockup at all).
- **375px co-crew tension:** name + 3 contact buttons (Call/Text/**Message** — the in-app DM is additive per §6) don't fit one row; stack name-over-actions rather than truncate. `min-w-0`+truncate alone over-corrects (truncates short names).
- **DEC-086 identity color now reaches crew** (was board-only): vessel dot on My-shifts, co-crew role glyph on the shift card. `aria-hidden`, name/role text is the accessible answer. Single-vessel shift-card *header* gets no dot (name suffices — architect's cut).
