# Shard D — Reservations & import

> **CLOSED BY DELETION, 2026-07-25.** Every document this shard indicted — `OPERATOR_MANUAL.md`,
> `E2E-PILOT-WALKTHROUGH.md`, `PILOT_RUNBOOK.md`, `PILOT_IMPORT_FINDINGS.md` — was **deleted** by the
> operator rather than repaired, along with 14 duplicated Xola screenshots (7.4 MB). The pilot ran
> for about a week and ended long ago; "this is only for the pilot" had become a standing tax on
> every doc read since.
>
> **The fixes this shard made were discarded** — they repaired files removed hours later. That is
> the cost of auditing before asking whether the corpus should exist. **Lesson 10 below.**
>
> This ledger is retained as the *evidence* for the deletion: it is the record of how far those
> documents had drifted (a retired upload procedure, a readiness gate whose four blockers were all
> resolved) and therefore why removing them beat maintaining them. Findings D2/D3 — the manual's
> "no payments" on the branch where Stripe takes money — died with the file and need no fix.
> A fresh operator manual gets written once reservations lands.

**Subject:** how real data gets in (Xola import) and how the operator is told to run the system —
the operator-facing procedural docs.

**Audited tree:** `main` @ `5a66e51`, checked against `feature/reservations` @ `a6250ba` (the code
superset). Findings are marked where the correct tree differs.

> **Which-tree check (lesson 4).** All four primary docs are **byte-identical** across trees
> (`OPERATOR_MANUAL.md` 380, `E2E-PILOT-WALKTHROUGH.md` 300, `PILOT_RUNBOOK.md` 114,
> `PILOT_IMPORT_FINDINGS.md` 64). The *code* they describe does not split evenly: import lives on
> `main` and forward-merges; payments and the customer booking flow exist **only** on
> `feature/reservations`. So D2/D3 are true against `feature/reservations` and *not yet* true
> against `main` — they are marked, and their fixes belong on that branch.

**Primary docs:** `docs/OPERATOR_MANUAL.md`, `docs/E2E-PILOT-WALKTHROUGH.md`, `docs/PILOT_RUNBOOK.md`,
`docs/PILOT_IMPORT_FINDINGS.md`.
**Checked against:** `app/(admin)/admin/import/*`, `app/api/cron/xola-pull/`, `src/reservations/*`,
`src/asks/claim.ts`, `src/domain/states.ts`, `e2e/`, `vercel.json`, `docs/SECURITY_AUDIT.md`.

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| D1 | `OPERATOR_MANUAL.md:137` | "Load the week's Xola reservations: **upload the export**, preview and validate it, import." | `app/(admin)/admin/import/page.tsx:18` — "**The xlsx upload is retired** (can't resolve a boat)." The screen is a *pull from Xola now* button over `pullFromXola`; the `/events ⨝ /orders` pull runs hourly (`app/api/cron/xola-pull/`). `importXlsx` no longer exists in `src/` | CODE-CONTRADICTS | doc-wrong |
| D2 | `OPERATOR_MANUAL.md:375` | "**No customer-facing anything.** No guest portal, **no payments**, no booking feed — Xola still owns the customer side. Muster is the crew half only." | 13 payment/checkout/webhook modules in `src/reservations/` on `feature/reservations`; Phase 11 shipped Stripe deposit + balance + webhook booking write (DEC-107/109), Phase 12 is the customer UI | CODE-CONTRADICTS | doc-wrong *(fix on `feature/reservations`)* |
| D3 | `OPERATOR_MANUAL.md:372` | "No reschedule / cancel cascades… Handle reschedule and cancel **by phone** with the customer for now (**they're parked with payments**)." | Payments are no longer parked (D2). DEC-135 ships cancel/change as an **out-of-band request emailed to the operator** via a `booking_request` `MessageKind` — not a phone call | MISMATCH | doc-wrong *(fix on `feature/reservations`)* |
| D4 | `E2E-PILOT-WALKTHROUGH.md:252-270` | "What this walkthrough does **not** cover… **must be resolved before real crew test**" — four claims: no hosted deploy (`mill-dev` over Tailscale only) · no production auth path (#70) · no automated e2e (#65) · no real reservation import (reads a Xola `.xlsx` via `importXlsx`, "core-only, no upload UI and no runner script") | **All four false.** `origin/production` exists + `vercel.json` + `DEPLOY.md`; `SECURITY_AUDIT.md` records "DEC-081 crew code login **now live in prod**"; `e2e/` holds 47 files with a `playwright.config`; `importXlsx` is gone and `/admin/import` is a real UI | CODE-CONTRADICTS | doc-wrong |
| D5 | `OPERATOR_MANUAL.md:330-343` (Seat mermaid) | `Claimed --> Confirmed: held by a person` — drawn as a distinct step | DEC-061 auto-advances `Asked → Claimed → Confirmed` in **one** operation; `src/asks/claim.ts:141` — "the Held/Claimed tier pending operator confirm. **That tier is NOT built**". SPEC §1.2 carries the DEC-061 supersession note; the manual does not | MISMATCH | doc-wrong |
| D6 | `OPERATOR_MANUAL.md:302-317` (Shift mermaid) | Cancelled edges drawn from `Pending` and `Filling` only | `SPEC.md:185` — "`Cancelled` — reachable from **every** pre-Completed state." `Crewed --> Cancelled` and `AtRisk --> Cancelled` are legal; the diagram has `AtRisk --> Cancelled` but omits `Crewed --> Cancelled` | MISMATCH | doc-wrong |
| D7 | `docs/xola *.png` (14 files) | — | **Identical blobs** to `docs/design/xola *.png`, and the `docs/` copies are **referenced by nothing**. 7,420,843 bytes of duplicated binaries in the repo | MISMATCH | **decision** (a delete, not an edit) |

## Severity read

**D1 and D4 are the ones that matter, and they fail the same way: these are the *procedural* docs.**
Everything else in this audit has been a reference doc being wrong. `OPERATOR_MANUAL.md` and
`E2E-PILOT-WALKTHROUGH.md` are instructions someone follows step by step.

**D1 is the sharpest.** The Import section is three sentences long and describes the one screen it
covers procedurally — and the procedure is retired. An operator following it looks for an upload
control that does not exist, on the screen whose own source comment says "the xlsx upload is
retired." This is the operator manual being wrong about the operator's job.

**D4 is the largest single block of stale text found in this audit.** A section headed "must be
resolved before real crew test" lists four blockers, **all four of which are resolved** — the app is
deployed with a `production` branch, code-login is live in prod, Playwright exists with 47 files, and
the xlsx import path it describes has been replaced by an API pull with a UI. The document still
presents the project as pre-deploy slice-1. Anyone using it to judge readiness gets a picture roughly
a full phase out of date.

**D2/D3 are the `feature/reservations` blind spot, and they are the most operationally dangerous
sentence in the doc set:** "no payments." That manual is byte-identical on the branch where Stripe
takes real money. It is correct on `main` today and becomes false the moment the branch merges back —
which is why the fix belongs on the branch, not here.

**D5/D6 are diagram drift** — low stakes, cheap, and the kind of thing that only matters when someone
reasons from the picture instead of the code.

**D7 is not a doc error, it is 7.4 MB of duplicated binaries**, and deleting files is a different
class of action from editing prose. Flagged, not done. The `docs/design/` copies are the referenced
set; the `docs/` copies appear to be an earlier drop that was never cleaned up when the design folder
was organised. Recommend deleting the `docs/` copies — but that is your call, and it wants a glance
at `git log` for the two paths first.

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| Shift states + meanings (Pending / Filling / Crewed / At-Risk / Completed / Cancelled) | `OPERATOR_MANUAL.md:319-325` | `src/domain/states.ts:11-18` — prose matches |
| "A **Crewed** shift isn't final until the trip runs" — bail drops it to Filling or At-Risk | `OPERATOR_MANUAL.md:322-325` | SPEC §1.1 transitions; both bail edges present and correctly conditioned |
| Seat states + meanings | `OPERATOR_MANUAL.md:345-347` | `states.ts:33-40` — five states, correct |
| Import feeds shift derivation ("that builds the events and shifts the engine then works") | `OPERATOR_MANUAL.md:138` | True — `src/builder/derive.ts` is source-agnostic. Only the *upload* half of D1 is wrong |
| Multiple admins supported, each via `db:admin`; At-Risk alerts text them all | `OPERATOR_MANUAL.md:377` | Consistent with DEC-092 / `0018_admins.sql` (shard B) |
| The four Xola screenshot sets under `docs/design/` | — | Referenced; these are the live copies. Only the `docs/` duplicates are orphaned |

## Coverage — what this shard read

- **Read in full:** `OPERATOR_MANUAL.md` §"What's not built yet", §"The two state machines",
  §3 Import, and its section index; `E2E-PILOT-WALKTHROUGH.md` §"What this walkthrough does not
  cover" and its section index.
- **Read structurally only (headings + targeted greps):** the rest of `OPERATOR_MANUAL.md` — notably
  §"The spine — how a booking becomes a crewed trip" (47-83), §"Playbook — how do I…" (142-250),
  §"The concepts behind the buttons" (252-296), §"Glossary" (346-365).
- **NOT read:** `PILOT_RUNBOOK.md` (114 lines) and `PILOT_IMPORT_FINDINGS.md` (64 lines) — **both in
  this shard's declared corpus.** `E2E-PILOT-WALKTHROUGH.md` Parts 0-7 (47-251) also unread.
- **Not read:** `SPEC.md` §3.5 Coexistence, §2.2 Event Admin — the latter belongs to shard C2.

**This shard is not complete.** ~480 of its ~858 corpus lines went unread, and the two PILOT docs
were skipped entirely. Given that the two sections I *did* read end-to-end (D1, D4) both turned out
to be substantially stale, the unread remainder should be assumed to hold more, not less. **Recommend
a shard D2 over `PILOT_RUNBOOK.md`, `PILOT_IMPORT_FINDINGS.md`, and the walkthrough's Parts 0-7** —
and, on the evidence so far, running it with a sweep agent rather than in-context.

## Cost

In-context, and this is where that stops being the right call. The corpus is procedural prose rather
than grep-reachable structure, so coverage came from reading rather than searching — which is exactly
the shape shard F's lesson was about. D and C2 are the two remaining shards that should use an agent.
