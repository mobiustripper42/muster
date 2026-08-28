---
session: 98
dev: eric
slug: 816-refund-schedule-stale
branch: task/816-refund-schedule-stale
started: 2026-08-27T21:43:02Z
ended:
points:
pr_numbers: [852]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/c55d0c47-cc80-59b8-ad34-3242473f31a2.jsonl
---

# Session 98 — 816-refund-schedule-stale

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: The X Shore boats import as two hulls, crewed by one captain each

**Completed:**
- `src/import/resource-map.ts` — `crew1` (captain only), two X Shore rows at COI 6, exported
  `X_SHORE_1` / `X_SHORE_2`. First boat in the fleet that isn't captain+mate.
- `src/import/resource-map.test.ts` — new, 4 cases, written first and watched fail for the right
  reason (X Shore absent from the map). The map had no test file at all before this.
- `db/seed-fleet.ts` — the console line no longer claims 4 BrewBoats.
- DEC-043 amendment — the fleet is six boats; why `Count 2` had to be split upstream; the stale
  "cited by SPEC §Fleet" pointer retired (there is no §Fleet in SPEC.md).
- Gate green: `npm run verify` exit 0, 2522 tests.

**The actual finding, which was not the new boat.** Xola modelled the operator's two identical
X Shore hulls as **one Resource with `Count 2`** — a quantity Muster cannot express, because the
resource id is the vessel axis and `formShifts` groups on `vesselId|date`. Both hulls run the same
day, so one id meant two boats sharing one shift and **one captain seat**, and `busyIntervalsFor`
would have read either hull's booking as occupying both. Muster cannot recover a distinction the
source does not make; the fix was upstream, in Xola. Operator split it into two Resources.

**A diagnostic that can't answer its own question.** The pull reported "1 unknown boat", which is
counted per unmapped **event** with no dedupe anywhere (`xola-client.ts:195` → `xola-pull.ts:194`
→ `import/page.tsx:145`). Two distinct unknown boats with one trip each also reads as "1 unknown
boat"; two trips on one unknown boat reads as "2". It cannot tell the operator how many boats are
unknown, which is the one thing it exists for. Not fixed here — needs an issue.

**Code review:** clean, 0 findings. Verified the captain-only row needs no code branch —
`deriveSeats` already iterated manning generically and nothing assumes 2 crew. Surfaced one
pre-existing loose end it correctly declined to count: DEC-086 still says "a ~4-boat fleet needs
~4 identity tokens" and `vessel-hue.ts`'s `PINNED` map covers only the BrewBoats (the new vessels
fall through to the hash fallback and render fine).

**PR:** [PR #852](https://github.com/mobiustripper42/muster/pull/852)
**Points:** 2
**Branch:** task/816-xshore-fleet
**Opened at:** 2026-08-27T22:12:00Z

**Next Steps:**

**Context:**
