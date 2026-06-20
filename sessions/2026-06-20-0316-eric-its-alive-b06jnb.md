---
session: 21
dev: eric
slug: its-alive-b06jnb
branch: claude/its-alive-b06jnb
started: 2026-06-20T03:16:45Z
ended: 2026-06-20T11:50:11Z
points: 0
pr_numbers: [110]
status: closed
transcript: /root/.claude/projects/-home-user-muster/be5ab55e-f8be-59be-b9cc-6d06b368a18e.jsonl
---

# Session 21 — its-alive-b06jnb

<!-- Task blocks appended by /kill-this, one per task. -->

Exploration session — no shipped task. Investigated why the pilot can't run; the
output is a findings/handoff doc + WIP seed scaffolds in **draft PR #110**.

**Next Steps:**
- **Pick this up in a CLI session** (need to run code + trial-and-error the live Xola API).
- Get one real `GET /purchases/{id}` JSON — ideally a 14+ pax trip Drew hand-assigned to boat 1/2 —
  and find the **boat/resource field** on the line item. That unblocks everything.
- Rework the import to ingest **Xola events/resources, not orders**: one boat-trip = one shift, pull
  the assigned boat Resource, drop the `product → single-vessel` map (`PRODUCT_MAP`).
- Replace `db/seed-fleet.ts`'s invented vessels with the **4 real boats** (BrewBoat 1=14, 2=16,
  3=12, 4=12). Fill `db/seed-pilot-crew.ts` with real ratings/phones/MMC for the roster in the doc.
- Full detail: `docs/PILOT_IMPORT_FINDINGS.md` (in PR #110).

**Context:**
- **The pilot is BLOCKED, not deployable.** The importer collapses BrewBoat's 4 physical boats into
  one shift (keys events by `product+date+time`; one product → one invented vessel, DEC-016).
- **xlsx vs API was the wrong axis** — both share `importRecords`, so both collapse. The real axis is
  **orders vs events**. The boat lives in Xola **Resources** (a Resource on a purchase item); the
  live client (`src/import/xola-client.ts`) reads orders and drops the `event`/`experience` refs.
- The real Xola export's **`Events` sheet** already separates boats (multiple rows per date+time) and
  carries assigned **guides** — the importer never reads that sheet.
- Real crew names discovered in the export (ratings/phones/MMC still unknown): McGovern, Kelly,
  Whalen, Stoffer, Londrico, McHale, Czarnecki, Hughes, Suarez, Learman, Gerl, Berger, Neumann, Kay,
  Scaffide.
- Phase 5 retro still un-run (carried from Session 20). PR #110 is a **draft** — don't merge as-is
  (seed-fleet vessels are knowingly wrong); cherry-pick the findings doc or merge after the rework.
