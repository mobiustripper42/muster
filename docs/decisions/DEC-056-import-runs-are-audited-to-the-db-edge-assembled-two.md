---
id: DEC-056
title: "Import runs are audited to the DB — edge-assembled, two-table, identity-level (#128)"
topic: "Xola ingest & import"
---

## DEC-056: Import runs are audited to the DB — edge-assembled, two-table, identity-level (#128)

**Status:** Built (Session 23, Part A).

**Decision:** Every Xola import (the manual button **and** the hourly cron) persists one durable audit
record. Two tables (migration 0007), house style — text PK, ISO-text dates, JSONB, **no FK**
(DEC-DATA-1): `import_runs` holds the run-level **summary** (counts + join diagnostics —
`unmappedResources`, `mapSkipped`, per-day assignments, stranded/pruned seats) as one JSONB blob;
`import_run_items` holds the **identity rows** (which reservations by name, which shift ids), one per
`{kind, ref_id, label}`. Adapter-side like the outbox (DEC-030): persisted through the port
(`saveImportRun`/`getImportRun`), **never read by the domain**. The core importer stays pure — it
returns the envelope (`ImportResult`/`FormResult` gained identity lists, `XolaPullResult` already
embeds them); the **edge** (`persistImportRun`) mints the run id (`crypto.randomUUID`) + timestamp +
source and saves. Item ids are zero-padded (`<run>-item-NNNN`) so the DB's `order by id` matches the
in-memory adapter's insertion order (the contract-suite parity).

**Why:** counts-in-redirect-params + diagnostics-in-Vercel-logs meant an unattended overnight **cron**
pull left no reviewable trace — "what did that run do?" was unanswerable, and the single most
actionable signal (`unmappedResources` = a new/renamed boat needing a `resource-map.ts` fix) was
`console.warn`-only. The audit gives both ingest paths a home off the logs.

**Surface (DEC-026):** the manual pull now redirects to the run's detail view
(`/admin/import/run/<id>`) — the same surface a cron run is reviewed on — replacing the one-line count
notice. The view reads **server-persisted, server-generated** data, so the codes-only-in-params rule
doesn't apply (no crafted-URL prose-injection risk).

**Scope:** Part A — audit table + persist the full envelope per run + the detailed single-run view.
**Part B (deferred):** the history-browse + drill-in list (a `listImportRuns` port method).

**Tradeoff:** identity-level capture is *new collection* in two core fns (not promoted counts) + a
child table. **Rejected:** counts-only (the status quo's blind spot); one flat table (loses per-row
identity); writing the audit in the core (would drag clock + randomness into the clock-free domain).
