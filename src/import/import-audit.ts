/**
 * Import-run audit model (#128, DEC-056).
 *
 * One durable record per import run — the manual "Pull from Xola now" button AND
 * the hourly cron. Before this, a run reported counts in redirect params and wrote
 * the rich join diagnostics (`unmappedResources`, `mapSkipped`, per-day
 * assignments, stranded seats) only to Vercel logs — so an unattended overnight
 * cron pull left no reviewable trace. This persists the whole envelope.
 *
 * Two parts, mirroring the DDL (0007): the run-level **summary** (counts +
 * diagnostics that aren't per-row) snapshots as one JSONB blob on `import_runs`;
 * the **identity rows** (which reservations/shifts) explode into `import_run_items`
 * so each names a name/id, not just a tally. Adapter-side state like the outbox
 * (DEC-030): persisted through the port, never read by the domain — the importer
 * returns the envelope, the EDGE assembles + stamps the run (id/time/source stay
 * out of the clock-free core).
 */

import type { ImportRunId, ImportRunItemId } from "../domain/ids.js";
import type { SkippedRow } from "./import-reservations.js";
import type { DayAssignments } from "./xola-pull.js";

export type ImportRunSource = "manual-pull" | "cron";

/** Run-level snapshot — the counts + join diagnostics that aren't per-row. The
 * per-reservation / per-shift identity lives in `ImportRunItem`. */
export interface ImportRunSummary {
  ordersFetched: number;
  eventsFetched: number;
  boatedEvents: number;
  excludedResources: number;
  recordsMapped: number;
  mapSkipped: number;
  eventsCreated: number;
  reservationsAdded: number;
  reservationsUpdated: number;
  reservationsNewlyCancelled: number;
  shiftsCreated: number;
  shiftsCancelled: number;
  seatsCreated: number;
  seatsPruned: number;
  seatsStranded: number;
  /** UNKNOWN/renamed boat resource ids — the single most actionable alert. */
  unmappedResources: SkippedRow[];
  /** Rows dropped during import (boat-less / window-truncated). */
  skipped: SkippedRow[];
  warnings: string[];
  /** Per-day boat→times — the "why is Brew 3 on Saturday?" review surface. */
  assignments: DayAssignments[];
  /** Canonical shift ids of SPLIT vessel-days whose trip composition this pull
   * changed (DEC-083) — the Builder View's "changed in the last pull — check the
   * split" cue reads the latest run's list. Empty on most runs. */
  splitDaysChanged: string[];
}

export interface ImportRun {
  id: ImportRunId;
  source: ImportRunSource;
  /** ISO-8601 UTC — when the run executed. */
  ranAt: string;
  /** The pulled `[start, end]` window (API). */
  window: { start: string; end: string };
  summary: ImportRunSummary;
}

export type ImportRunItemKind =
  | "reservation_added"
  | "reservation_updated"
  | "reservation_cancelled"
  | "shift_created"
  | "shift_cancelled";

/** One identity row of a run — a named reservation or a shift id. */
export interface ImportRunItem {
  id: ImportRunItemId;
  runId: ImportRunId;
  kind: ImportRunItemKind;
  /** Reservation id or shift id. */
  refId: string;
  /** Customer name for reservations; null for shifts. */
  label: string | null;
}
