---
session: 38
dev: eric
slug: eslint-setup
branch: task/eslint-setup
started: 2026-07-05T20:30:21Z
ended:
points:
pr_numbers: [273, 274]
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

## Task 2: Polish /crew/open — day + right-justified time, vessel dot, cleaner confirm copy (9.11b, #237 follow-up)

**Completed:**
- `/crew/open` post-dates the mockups (DEC-074) so it was skipped on the 9.11 reconciliation and read flat. Brought it up to the app's language:
- **Vessel hue dot** on each claim row (DEC-086): added `vesselId` to `ClaimableSeatView` (`src/crewapp/claimable-view.ts`), rendered the same `aria-hidden` dot as My-shifts/board in `ClaimRow`.
- **Row header** (`app/(crew)/crew/open/page.tsx`): day left semibold + **first-departure time bold mono right-justified on the same line**, quiet `● vessel · role` beneath — the My-shifts "when" hierarchy. My-shifts itself left untouched (operator call: pull crew/open up, don't swap formats).
- **Confirm copy**: split `confirmCopy` → `confirmLead` + `confirmFacts` (+ helpers `hasTrips`, `joinTimes`, `backAt`); lead sentence then a separate **`Currently:`** facts line (trips · call · back), middot separators, comma+ampersand trip list keeping each period (avoids AM/PM ambiguity on a mixed list), `~6 PM` cased. "Right now" → "Currently".
- e2e `crew-open.spec.ts` extended (vessel dot, summary-scoped header time, `Currently:` copy); `claimable-view.test.ts` asserts `vesselId`. 10/10 desktop + mobile, screenshots eyeballed at 375px.
- **Env note:** operator's `next dev` held Next's per-dir dev lock → Playwright couldn't start its dev server. Ran a **prod** server (`next start` + `VERCEL_ENV=preview`) on :3100 against muster_test — prod mode dodges the lock, `VERCEL_ENV=preview` keeps the dev-link route live. Recipe saved to memory ([[e2e-while-dev-lock-held]]).

**Code review:** Clean Bill of Health — traced `joinTimes`/`backAt`/`hasTrips` gating + the `!` assertions (safe: `committedWindow` sets call/back together iff trips exist), header 375px layout, summary-scoped e2e locator. No issues.
**PR:** [#274](https://github.com/mobiustripper42/muster/pull/274)
**Points:** 2
**Branch:** task/9.11b-crew-open-polish
**Opened at:** 2026-07-06T00:47:46Z

**Next Steps:**
- **File as follow-ups:** full `<Button>` primitive (admin adopts the shared glyph + radius token — the C3 boundary); **C2** the "changed since you last looked" crew cue (a *feature*, ties to `Reservation.updatedAt` / #259, not polish).
- **Spinners on prod (parked):** crew nav spinners work in dev; unverified on Vercel. If a preview shows page-to-page nav eating the spinner, add `loading.tsx` to the crew segments (no crew `loading.tsx` exists). Don't diagnose spinner/latency off the mill-dev dev server ([[dev-server-confounds-latency-observations]]).
- Remaining Phase 9: #247 (civil-hours notices — prod-Twilio blocker), #238 (nav — @architect BRAND gate), #250 (still open). Filed earlier: #256 (drop inert `locked_at` col), #259, #268, #271.

**Context:**
- **Reconciliation lesson:** the crew surfaces were *ahead* of the mockups — the gate's real output was confirming intentional supersedes, not a build backlog. Don't treat a mockup as the target when the live code post-dates it (DEC-074 open surface + §7.6 messaging had no mockup at all).
- **375px co-crew tension:** name + 3 contact buttons (Call/Text/**Message** — the in-app DM is additive per §6) don't fit one row; stack name-over-actions rather than truncate. `min-w-0`+truncate alone over-corrects (truncates short names).
- **DEC-086 identity color now reaches crew** (was board-only): vessel dot on My-shifts, co-crew role glyph on the shift card. `aria-hidden`, name/role text is the accessible answer. Single-vessel shift-card *header* gets no dot (name suffices — architect's cut).
