/**
 * View model for the admin referential-integrity diagnostic (#501).
 *
 * {@link checkIntegrity} returns a flat violation list, which is the right shape
 * for an assertion and the wrong one for a human: real rot arrives in bulk (one
 * bad backfill orphans every seat on a shift), so a flat list is dozens of rows
 * saying the same thing. This groups by entity so the operator reads "seat: 34"
 * and drills, and orders the scanned counts so "the check ran" is legible even
 * when there's nothing to report.
 *
 * Pure — no repo, no clock, no formatting of anything the page can't re-style.
 */

import type { IntegrityReport, IntegrityViolation } from "./integrity.js";

/** Violations for one entity kind, newest concern first in the caller's order. */
export interface IntegrityGroup {
  entity: string;
  count: number;
  violations: IntegrityViolation[];
}

/** One aggregate's row count — `scanned` as an ordered, renderable list. */
export interface ScannedRow {
  entity: string;
  rows: number;
}

export interface IntegrityView {
  ok: boolean;
  /** Total dangling references across every entity. */
  total: number;
  /** Grouped violations, largest group first (ties broken by entity name). */
  groups: IntegrityGroup[];
  /** Every aggregate scanned, in the report's declared order. */
  scanned: ScannedRow[];
  /** Rows walked across all aggregates — the "it actually ran" number. */
  scannedTotal: number;
}

export function buildIntegrityView(report: IntegrityReport): IntegrityView {
  const byEntity = new Map<string, IntegrityViolation[]>();
  for (const v of report.violations) {
    const list = byEntity.get(v.entity);
    if (list) list.push(v);
    else byEntity.set(v.entity, [v]);
  }

  const groups: IntegrityGroup[] = [...byEntity.entries()]
    .map(([entity, violations]) => ({
      entity,
      count: violations.length,
      violations,
    }))
    // Biggest breakage first — that's the one backfill worth chasing. Alphabetical
    // within a tie so the render is stable across runs.
    .sort((a, b) => b.count - a.count || a.entity.localeCompare(b.entity));

  const scanned: ScannedRow[] = Object.entries(report.scanned).map(
    ([entity, rows]) => ({ entity, rows }),
  );

  return {
    // Trust the report's own verdict rather than re-deriving it from the list —
    // one source of truth for "clean".
    ok: report.ok,
    total: report.violations.length,
    groups,
    scanned,
    scannedTotal: scanned.reduce((sum, s) => sum + s.rows, 0),
  };
}
