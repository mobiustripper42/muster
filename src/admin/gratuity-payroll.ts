/**
 * Gratuity payroll report (Phase 12.3b, DEC-124) — Muster's OWN Gusto tip report for
 * Muster-side tips, LIFTED from `xola-tip-extractor`'s proven split (`api/lib/split.js`,
 * DEC-002/017) and mapped onto Muster's native data. **Muster-side only** — the Xola tip reader
 * / union stays deferred to Xola-sunset (DEC-124 amendment); this emits a report the operator
 * hand-combines with the extractor's during the drain.
 *
 * Improves on the extractor in one way: it is **integer-cent native** (Muster stores cents), so
 * the even split is exact with a deterministic remainder distribution — no float `round2`.
 *
 * Denominator = the payroll seat idiom (`buildPayrollReport`): an event's gratuity pool splits
 * among the crew on that event's **shift's Confirmed + required** seats (deduped) — the same
 * "who worked this trip" set the hours report pays.
 */
import { isBooked, type Gratuity, type GustoIdentity } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";

// ── Pure split ───────────────────────────────────────────────────────────────

export interface GratuitySplitInput {
  /** Gratuities to split (caller filters to in-window, booked). */
  gratuities: readonly Gratuity[];
  /** eventId → the distinct crew that worked it (the split denominator). */
  crewByEvent: ReadonlyMap<string, readonly string[]>;
}
export interface CrewGratuity {
  crewMemberId: string;
  cents: number;
}
export interface EventGratuity {
  eventId: string;
  poolCents: number;
  crewCount: number;
}
export interface GratuitySplit {
  perCrew: CrewGratuity[];
  byEvent: EventGratuity[];
  warnings: string[];
  totalCents: number;
}

/**
 * Even split per event among its crew (DEC-002), integer cents. Remainder is distributed
 * DETERMINISTICALLY: crew sorted lexically, the first `pool % n` of them get one extra cent —
 * so every cent is allocated and the result is reproducible (a contract-test invariant). An
 * event with a pool but zero crew → a warning, unsplit (money surfaced, never silently dropped).
 */
export function splitGratuity(input: GratuitySplitInput): GratuitySplit {
  const poolByEvent = new Map<string, number>();
  for (const g of input.gratuities) {
    const k = String(g.eventId);
    poolByEvent.set(k, (poolByEvent.get(k) ?? 0) + g.amountCents);
  }

  const perCrewMap = new Map<string, number>();
  const byEvent: EventGratuity[] = [];
  const warnings: string[] = [];
  let totalCents = 0;

  for (const eventId of [...poolByEvent.keys()].sort()) {
    const poolCents = poolByEvent.get(eventId)!;
    const crew = [...(input.crewByEvent.get(eventId) ?? [])].map(String).sort();
    byEvent.push({ eventId, poolCents, crewCount: crew.length });
    if (poolCents <= 0) continue;
    if (crew.length === 0) {
      warnings.push(`event ${eventId} has $${(poolCents / 100).toFixed(2)} in gratuity but no confirmed crew — unsplit`);
      continue;
    }
    const per = Math.floor(poolCents / crew.length);
    const rem = poolCents % crew.length; // the first `rem` (lexical) crew get +1¢
    crew.forEach((cid, i) => {
      perCrewMap.set(cid, (perCrewMap.get(cid) ?? 0) + per + (i < rem ? 1 : 0));
    });
    totalCents += poolCents;
  }

  const perCrew = [...perCrewMap.entries()]
    .map(([crewMemberId, cents]) => ({ crewMemberId, cents }))
    .sort((a, b) => a.crewMemberId.localeCompare(b.crewMemberId));
  return { perCrew, byEvent, warnings, totalCents };
}

// ── Report wiring (reads the repo) ───────────────────────────────────────────

export interface GustoTipRow {
  crewMemberId: string;
  name: string;
  tipCents: number;
  /** Absent ⇒ no Gusto mapping — warned, and excluded from the importable CSV. */
  gusto?: GustoIdentity;
}
export interface GratuityPayroll {
  rows: GustoTipRow[];
  warnings: string[];
  totalCents: number;
}

/**
 * Build the gratuity payroll for a pay-period window (inclusive ISO dates). Only **booked**
 * reservations' gratuities count, only for events on non-cancelled shifts IN the window.
 */
export async function buildGratuityPayroll(
  repo: Repository,
  window: { from: string; to: string },
): Promise<GratuityPayroll> {
  // 1. Window's events → their crew (the seat-idiom denominator).
  const crewByEvent = new Map<string, string[]>();
  const eventsInWindow = new Set<string>();
  for (const shift of await repo.listShifts()) {
    if (shift.state === "Cancelled") continue;
    if (shift.date < window.from || shift.date > window.to) continue;
    const crew = new Set<string>();
    for (const seat of await repo.listSeatsForShift(shift.id)) {
      if (seat.state === "Confirmed" && seat.kind === "required" && seat.assignedCrewMemberId) {
        crew.add(String(seat.assignedCrewMemberId));
      }
    }
    for (const eventId of shift.eventIds) {
      eventsInWindow.add(String(eventId));
      crewByEvent.set(String(eventId), [...crew]);
    }
  }

  // 2. Gratuities in window, on booked reservations only.
  const bookedResIds = new Set(
    (await repo.listAllReservations())
      .filter(isBooked)
      .map((r) => String(r.id)),
  );
  const gratuities = (await repo.listAllGratuities()).filter(
    (g) => eventsInWindow.has(String(g.eventId)) && bookedResIds.has(String(g.reservationId)),
  );

  // 3. Split, then join the Gusto identity (warn + exclude the unmapped from the CSV).
  const split = splitGratuity({ gratuities, crewByEvent });
  const crewById = new Map(
    (await repo.listCrewMembers()).map((c) => [String(c.id), c]),
  );
  const warnings = [...split.warnings];
  const rows: GustoTipRow[] = split.perCrew.map((pc) => {
    const c = crewById.get(pc.crewMemberId);
    const name = c?.name ?? "(unknown)";
    if (!c?.gusto?.employeeId) {
      warnings.push(`${name} has $${(pc.cents / 100).toFixed(2)} in tips but no Gusto mapping — row won't import`);
    }
    return { crewMemberId: pc.crewMemberId, name, tipCents: pc.cents, ...(c?.gusto ? { gusto: c.gusto } : {}) };
  });
  return { rows, warnings, totalCents: split.totalCents };
}

// ── Gusto CSV ────────────────────────────────────────────────────────────────

/** The extractor's exact 15-column Gusto timesheet header (lifted verbatim). */
export const GUSTO_CSV_HEADER =
  "last_name,first_name,title,gusto_employee_id,regular_hours,overtime_hours,double_overtime_hours,missed_break_hours,bonus,commission,paycheck_tips,cash_tips,correction_payment,reimbursement,personal_note";

/** RFC-4180 field escape — quote if it contains a comma, quote, or newline. */
function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * The Gusto timesheet CSV — identity + `paycheck_tips` (Gusto wants DOLLARS, 2dp; the one
 * cents→dollars conversion), every other column blank. Rows with NO Gusto identity are excluded
 * (they can't import — surfaced via the report's warnings instead of a blank-key row).
 */
export function gustoTipsCsv(rows: readonly GustoTipRow[]): string {
  const lines = [GUSTO_CSV_HEADER];
  for (const r of rows) {
    if (!r.gusto?.employeeId) continue;
    const dollars = (r.tipCents / 100).toFixed(2);
    lines.push(
      [
        csvField(r.gusto.lastName),
        csvField(r.gusto.firstName),
        csvField(r.gusto.title),
        csvField(r.gusto.employeeId),
        "", "", "", "", "", "", // regular…commission
        dollars, // paycheck_tips
        "", "", "", "", // cash_tips…personal_note
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
