/**
 * "All shifts" derivation (#100 Part A, DEC-042) — the operator's deliberate
 * full-visibility PULL surface: every shift in a date window that isn't cancelled,
 * with the facts to scan and a click-through to the cockpit. `Completed` shifts are
 * included (#570): a trip that ran is still part of the day being looked at.
 *
 * A pure read over existing derivations. The live state comes from
 * `resolveShiftStateOnRead` (the DEC-023 corollary — never trust the persisted
 * badge), and trips/pax mirror the assignment view exactly. The anti-dashboard
 * brand guardrails (default-to-today, neutral states, no auto-refresh, a SEPARATE
 * empty state from the board's ✓) live in the SURFACE, not here —
 * see app/(admin)/admin/shifts/page.tsx and DEC-042.
 */
import { isBooked, type Event, type Shift } from "../domain/entities.js";
import { TERMINAL_SHIFT_STATES } from "../domain/states.js";
import type { Repository } from "../ports/repository.js";
import { resolveShiftStateOnRead } from "../builder/tick.js";
import { suggestSplit, type SplitSuggestion } from "../builder/derive.js";

export interface AllShiftsTrip {
  /** Departure clock time, vessel-local wall-clock ("14:00"). */
  time: string;
  /** Booked pax on this trip. */
  pax: number;
}

/**
 * One seat's pip facts (9.6, DEC-086-adjacent density) — the board renders these
 * as neutral-ink pips. `roleName` is the resolved display name (glyph derivation
 * is the edge's job — role names are tenant data, so no initials minted here);
 * `filled` mirrors the `confirmedSeats` definition (state === Confirmed).
 * Supernumerary seats ARE included (unlike the required-only fill counts).
 */
export interface AllShiftsSeat {
  roleName: string;
  filled: boolean;
  supernumerary: boolean;
  /** The confirmed crew member's name, when the seat is filled (#310) — so the
   *  operator can scan WHO is on each shift, not just how many. Undefined for an
   *  open seat. */
  crewName?: string;
}

export interface AllShiftsRow {
  shiftId: string;
  /** The vessel's id — the edge keys the DEC-086 identity hue off this. */
  vesselId: string;
  vesselName: string;
  /** Operator-chosen vessel hue (DEC-086 palette index, 12.9) — authoritative for the
   *  identity dot when set; absent ⇒ the id-derived hue stands. */
  vesselHue?: number;
  /** ISO-8601 vessel-local date. */
  date: string;
  /** Live state resolved on read — Pending/Filling/Crewed/AtRisk — or the persisted
   *  terminal state verbatim for a Cancelled (#416) or Completed (#570) shift, which
   *  the seat-folding resolver cannot produce. */
  state: Shift["state"];
  /** Scheduled trips, earliest first. */
  trips: AllShiftsTrip[];
  paxTotal: number;
  requiredSeats: number;
  confirmedSeats: number;
  /** Every seat's pip facts, required AND supernumerary, deterministically
   *  sorted (roleName, then kind — required first, then seat id). */
  seats: AllShiftsSeat[];
  /**
   * A "split this?" suggestion when the shift's trips span a large mid-day gap or
   * a long day (SPEC §2.3, #204) — advisory only; `null` when contiguous. The
   * Builder (8.2) renders it; `formShifts` never auto-splits (idempotency contract).
   */
  splitSuggestion: SplitSuggestion | null;
  /** The shift's persisted state is `Cancelled` (surfaced only when the caller
   *  opts in via `includeCancelled`, #416). The surface greys the row + labels it;
   *  the default board never sets this because cancelled rows are excluded there. */
  cancelled: boolean;
  /**
   * When this row is one HALF of a manually-split vessel-day (DEC-083): `side` is
   * `A` (the canonical row carrying `splitCutTime`, trips `< cut`) or `B` (the
   * `{id}-b` sibling, trips `>= cut`); `cutTime` is the shared vessel-local "HH:MM"
   * boundary (side B borrows it from its canonical). `null` for an un-split shift.
   * The Builder pairs the two rows and never offers Split on a side (Merge is 8.4).
   */
  split: { side: "A" | "B"; cutTime: string } | null;
}

/**
 * Every shift whose date falls in `[from, to]` (inclusive ISO date strings), sorted
 * by date then earliest departure. **Completed shifts are included** (#570) and keep
 * their state verbatim. Cancelled shifts are excluded by default — "current" means on
 * the books, not killed — but the operator can opt them in via `includeCancelled`
 * (#416) to see what got killed; they come back flagged `cancelled: true` for the
 * surface to grey.
 *
 * Per-shift `resolveShiftStateOnRead` re-reads events each call (pilot scale —
 * a handful of shifts per day window; revisit with an index if it ever grows).
 */
export async function deriveAllShifts(
  repo: Repository,
  window: { from: string; to: string },
  now: Date,
  opts?: {
    leadDays?: number;
    tz?: string;
    crewMemberId?: string;
    /** #416: keep Cancelled shifts in the result (flagged), instead of dropping
     *  them. Governs Cancelled ONLY — Completed is always included (#570).
     *  Default off (DEC-042). */
    includeCancelled?: boolean;
  },
): Promise<AllShiftsRow[]> {
  const vesselList = await repo.listVessels();
  const vesselName = new Map(vesselList.map((v) => [v.id, v.name]));
  const vesselHue = new Map(vesselList.map((v) => [v.id, v.hue]));
  // Role display names for the seat pips — resolved once here so the surface
  // needn't re-join (the assignment-view idiom).
  const roleNames = new Map(
    (await repo.listAllRoleTypes()).map((r) => [String(r.id), r.name]),
  );
  // Crew display names for the filled seats (#310) — resolved once, like the
  // vessel/role name maps, so the seat map needn't re-join per shift.
  const crewNames = new Map(
    (await repo.listCrewMembers()).map((c) => [String(c.id), c.name]),
  );
  const rows: AllShiftsRow[] = [];

  // Split marking (DEC-083): a canonical row carries `splitCutTime`; its side-B
  // sibling (`{id}-b`) does not, so borrow the cut from the canonical. Pre-map
  // canonical id → cut once (including a Cancelled canonical, filtered from the
  // rows below but still the source of side B's boundary) — O(shifts), not O(n²).
  const allShifts = await repo.listShifts();
  const cutById = new Map<string, string>();
  for (const s of allShifts) {
    if (s.splitCutTime != null) cutById.set(String(s.id), s.splitCutTime);
  }

  for (const shift of allShifts) {
    // A `Completed` shift STAYS on the board (#570 — operator's call). It used to be
    // dropped as "historical", which was free when nothing ever set the state; now
    // that the tick completes shifts, dropping them would make a trip vanish from the
    // board the same evening it ran, mid-day-view. A finished shift is still part of
    // the day you're looking at.
    // Cancelled: dropped by default (DEC-042 "current only"); opt-in via #416.
    if (shift.state === "Cancelled" && !opts?.includeCancelled) continue;
    if (shift.date < window.from || shift.date > window.to) continue;

    // Seats are read first so the crew filter (#330, DEC-042 amendment) can
    // short-circuit BEFORE the expensive per-shift state/trip/reservation
    // derivation when the requested crew member isn't seated here. Match by id
    // against the raw seat's `assignedCrewMemberId` (reliable — no name
    // collision), state ∈ {Claimed, Confirmed}: a tentative accept still means
    // "they're working it"; Asked/Open/Bailed don't bind a person to the shift.
    const allSeatRows = await repo.listSeatsForShift(shift.id);
    if (opts?.crewMemberId != null) {
      const cid = String(opts.crewMemberId);
      const seated = allSeatRows.some(
        (s) =>
          s.assignedCrewMemberId != null &&
          String(s.assignedCrewMemberId) === cid &&
          (s.state === "Claimed" || s.state === "Confirmed"),
      );
      if (!seated) continue;
    }

    // A Cancelled or Completed shift keeps its persisted state verbatim (#416, #570):
    // the resolver folds SEAT states and can only yield Pending/Filling/Crewed/AtRisk
    // (`derive.ts:652` — neither terminal state is producible from seats), so resolving
    // one here would relabel it and the row would sprout live affordances. Cancelled
    // would read Pending/Filling/AtRisk; `Completed` would read **Crewed**, which is
    // the more dangerous of the two now that the board keeps showing it — a finished
    // trip presenting as a live crewed one, complete with a "needs attention" link.
    const state =
      TERMINAL_SHIFT_STATES.has(shift.state)
        ? shift.state
        : (await resolveShiftStateOnRead(repo, shift.id, now, opts)) ?? shift.state;

    const trips: AllShiftsTrip[] = [];
    const scheduledEvents: Event[] = [];
    for (const eventId of shift.eventIds) {
      const event = await repo.getEvent(eventId);
      if (!event || event.status !== "scheduled") continue;
      scheduledEvents.push(event);
      const booked = (await repo.listReservationsForEvent(event.id)).filter(isBooked);
      trips.push({
        time: event.time,
        pax: booked.reduce((sum, r) => sum + r.partySize, 0),
      });
    }
    trips.sort((a, b) => a.time.localeCompare(b.time));

    // The pip list carries EVERY seat (a trainee reads as a dashed pip); the
    // fill counts keep their required-only definition — don't change their meaning.
    const required = allSeatRows.filter((s) => s.kind === "required");
    const seats: AllShiftsSeat[] = [...allSeatRows]
      .sort((a, b) => {
        const roleA = roleNames.get(String(a.role)) ?? String(a.role);
        const roleB = roleNames.get(String(b.role)) ?? String(b.role);
        if (roleA !== roleB) return roleA.localeCompare(roleB);
        if (a.kind !== b.kind) return a.kind === "required" ? -1 : 1;
        return String(a.id).localeCompare(String(b.id));
      })
      .map((s) => {
        const crewName =
          s.state === "Confirmed" && s.assignedCrewMemberId
            ? crewNames.get(String(s.assignedCrewMemberId))
            : undefined;
        return {
          roleName: roleNames.get(String(s.role)) ?? String(s.role),
          filled: s.state === "Confirmed",
          supernumerary: s.kind === "supernumerary",
          // Conditional include — exactOptionalPropertyTypes rejects an explicit
          // `crewName: undefined` on the optional field.
          ...(crewName !== undefined ? { crewName } : {}),
        };
      });

    const idStr = String(shift.id);
    let split: AllShiftsRow["split"] = null;
    if (shift.splitCutTime != null) {
      split = { side: "A", cutTime: shift.splitCutTime };
    } else if (idStr.endsWith("-b")) {
      const cut = cutById.get(idStr.slice(0, -2));
      if (cut != null) split = { side: "B", cutTime: cut };
    }

    const hue = vesselHue.get(shift.vesselId);
    rows.push({
      shiftId: idStr,
      vesselId: String(shift.vesselId),
      vesselName: vesselName.get(shift.vesselId) ?? String(shift.vesselId),
      ...(hue !== undefined ? { vesselHue: hue } : {}),
      date: shift.date,
      state,
      trips,
      paxTotal: trips.reduce((sum, t) => sum + t.pax, 0),
      requiredSeats: required.length,
      confirmedSeats: required.filter((s) => s.state === "Confirmed").length,
      seats,
      cancelled: shift.state === "Cancelled",
      splitSuggestion: suggestSplit(scheduledEvents, opts?.tz),
      split,
    });
  }

  rows.sort((a, b) =>
    a.date !== b.date
      ? a.date.localeCompare(b.date)
      : (a.trips[0]?.time ?? "").localeCompare(b.trips[0]?.time ?? ""),
  );
  return rows;
}
