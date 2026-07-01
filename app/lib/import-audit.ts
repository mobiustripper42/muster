import { randomUUID } from "node:crypto";
import { asId } from "@core/domain/ids.js";
import type {
  ImportRun,
  ImportRunItem,
  ImportRunItemKind,
  ImportRunSource,
} from "@core/import/import-audit.js";
import type { XolaPullResult } from "@core/import/xola-pull.js";
import type { Repository } from "@core/ports/repository.js";

/**
 * Assemble + persist one import-run audit record from a pull result (#128, DEC-056).
 * Edge glue: mints the id (random) + timestamp so the clock/random-free core stays
 * pure, snapshots the run-level envelope, and explodes the identity lists
 * (`import.added/updated/newlyCancelled`, `form.created/cancelledShiftIds`) into
 * per-item rows. Item ids are zero-padded so the DB's `order by id` matches the
 * in-memory adapter's insertion order. Returns the new run id.
 */
export async function persistImportRun(
  repo: Repository,
  result: XolaPullResult,
  source: ImportRunSource,
  now: Date,
): Promise<string> {
  const runId = `run-${randomUUID()}`;
  const id = asId<"ImportRunId">(runId);
  const run: ImportRun = {
    id,
    source,
    ranAt: now.toISOString(),
    window: result.window,
    summary: {
      ordersFetched: result.ordersFetched,
      eventsFetched: result.eventsFetched,
      boatedEvents: result.boatedEvents,
      excludedResources: result.excludedResources,
      recordsMapped: result.recordsMapped,
      mapSkipped: result.mapSkipped,
      eventsCreated: result.import.eventsCreated,
      reservationsAdded: result.import.reservationsAdded,
      reservationsUpdated: result.import.reservationsUpdated,
      reservationsNewlyCancelled: result.import.reservationsNewlyCancelled,
      shiftsCreated: result.form.shiftsCreated,
      shiftsCancelled: result.form.shiftsCancelled,
      seatsCreated: result.form.seatsCreated,
      seatsPruned: result.form.seatsPruned,
      seatsStranded: result.form.seatsStranded,
      unmappedResources: result.unmappedResources,
      skipped: result.import.skipped,
      warnings: result.import.warnings,
      assignments: result.assignments,
      splitDaysChanged: result.form.splitDaysChanged,
    },
  };

  const items: ImportRunItem[] = [];
  const push = (kind: ImportRunItemKind, refId: string, label: string | null) => {
    items.push({
      id: asId<"ImportRunItemId">(
        `${runId}-item-${String(items.length).padStart(4, "0")}`,
      ),
      runId: id,
      kind,
      refId,
      label,
    });
  };
  for (const r of result.import.added) push("reservation_added", r.id, r.name);
  for (const r of result.import.updated) push("reservation_updated", r.id, r.name);
  for (const r of result.import.newlyCancelled)
    push("reservation_cancelled", r.id, r.name);
  for (const sid of result.form.createdShiftIds) push("shift_created", sid, null);
  for (const sid of result.form.cancelledShiftIds)
    push("shift_cancelled", sid, null);

  await repo.saveImportRun(run, items);
  return runId;
}
