/**
 * `db:own` — mark a vessel-day Muster-owned (DEC-106), or list what's owned. The
 * coexistence partition's config mechanism: Phase 11 has no admin UI (its UI is
 * throwaway), so ownership is set from the CLI. Framework-free + unit-tested; the
 * thin DB shell is `db/own-vessel-day.ts`.
 *
 *   npm run db:own -- list
 *   npm run db:own -- mark vessel-brew-2 2026-07-04
 *
 * Marking a day owned makes the importer SKIP + itemize any Xola event landing on
 * that vessel+date. Per DEC-106 sequencing, only mark a FUTURE, UNBOOKED day: the
 * importer never reaps, so flipping an already-booked day to owned strands its Xola
 * shift (the guard skips its cancels too). This command warns if it finds one.
 */
import { asId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

export class OwnCliError extends Error {}

/** Run a `db:own` subcommand against `repo`. `now` is injected for testability. */
export async function runOwnCommand(
  repo: Repository,
  argv: string[],
  now: Date = new Date(),
): Promise<string> {
  const [cmd, ...rest] = argv;

  if (cmd === "list") {
    const days = await repo.listMusterOwnedVesselDays();
    if (days.length === 0) return "No Muster-owned vessel-days.";
    return days
      .slice()
      .sort((a, b) =>
        `${a.date}|${String(a.vesselId)}`.localeCompare(
          `${b.date}|${String(b.vesselId)}`,
        ),
      )
      .map((d) => `${d.date}  ${String(d.vesselId)}  (marked ${d.markedAt})`)
      .join("\n");
  }

  if (cmd === "mark") {
    const [vesselId, date] = rest;
    if (!vesselId || !date) {
      throw new OwnCliError("usage: db:own mark <vesselId> <YYYY-MM-DD>");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new OwnCliError(`date must be YYYY-MM-DD, got '${date}'`);
    }
    // DEC-106 sequencing check: warn (don't block — operator judgment) if a LIVE Xola
    // event already sits on this vessel-day, since marking it owned strands it. Only
    // `scheduled` events matter — a long-cancelled Xola event strands nothing.
    const stranded = (await repo.listEvents()).filter(
      (e) =>
        String(e.vesselId) === vesselId &&
        e.date === date &&
        e.source === "xola" &&
        e.status === "scheduled",
    );
    await repo.markVesselDayMusterOwned(
      asId<"VesselId">(vesselId),
      date,
      now.toISOString(),
    );
    let msg = `Marked vessel-day Muster-owned: ${vesselId} ${date}`;
    if (stranded.length > 0) {
      msg +=
        `\n⚠️  WARNING: ${stranded.length} existing Xola event(s) already on this vessel-day.` +
        ` The importer now SKIPS them (incl. their cancels — DEC-106), which can strand a Xola` +
        ` shift. De-list this day in Xola and let it drain BEFORE marking it owned.`;
    }
    return msg;
  }

  throw new OwnCliError(
    `unknown command '${cmd ?? ""}'. Commands: list | mark <vesselId> <YYYY-MM-DD>`,
  );
}
