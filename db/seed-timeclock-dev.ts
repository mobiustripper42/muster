/**
 * Dev seed for the time clock + payroll hours (13.4, #628).
 *
 * No other seed writes `time_punches`, so before this the reconcile surface only ever
 * rendered its degenerate case: every crew member estimate-only, `actualMinutes: 0`, delta
 * fully negative. The export gate, the truncation, the §2.9.8 admin marking and the
 * vessel-local bucketing were all unreachable by hand.
 *
 * **It seeds the PREVIOUS pay period, not the current one.** A punch may not claim time
 * that hasn't happened yet (`inTheFuture`, src/crew/time-clock.ts:115), so a fixture
 * anchored to the current period is only safe if today is far enough into it — and on day
 * 1 there is no past day at all. That is not hypothetical: `admin-time-clock.spec.ts` put
 * its punches on the period's first day and went red one day in fourteen, before 5pm.
 * Seeding the closed period makes every punch unconditionally past, on every day of the
 * year, with no dependence on the wall clock. Same fix, same reason.
 *
 * Seven crew, each isolating one thing the report or the CSV has to get right:
 *
 *   A. Ada    — 69 minutes, EXACTLY 1.15 hours. The regression fixture. `(minutes / 60) * 100`
 *      yields 114.99999999999999 and floors to "1.14" — a cent under, in the one column
 *      Gusto pays from. Cloud review found it in #649; this is where you see it stay fixed.
 *   B. Bo     — three ordinary 8h days. The boring row that proves the total is a total.
 *   C. Cyd    — 20:00→23:30 vessel-local. Already tomorrow in UTC, so it buckets to the
 *      wrong DAY (and on a boundary, the wrong PERIOD) the moment anything reads UTC.
 *   D. Dov    — one closed punch AND one still open. `openCount > 0` ⇒ `exportBlocked`,
 *      the button disappears and the route answers 409. Close it on /admin/time-clock and
 *      the export comes back — that round trip is the demo.
 *   E. Eze    — `origin: "admin"`. Nobody tapped anything; the row must say so (§2.9.8).
 *   F. Fen    — `adminEditedAt` set on a crew-origin punch. Someone else moved these hours.
 * **No nameless-row fixture.** `TimeClockRow.name` is nullable, and this seed originally tried
 * to produce that row — the FK refused it. `crew_member_id references crew_members(id) on
 * delete restrict` (migration `20260731180000`; the deliberately un-FK'd column is `shift_id`),
 * and the port has no crew delete at all. That branch is unreachable through Postgres, so a
 * dev fixture cannot show it to you and shouldn't pretend to.
 *
 * Ada carries no `gusto` identity on purpose — her CSV row has a blank `employee_id` and
 * will not import. Everyone else is mapped, so the blank is visible as a contrast rather
 * than as the uniform state.
 *
 * These six hold no seats, so every row is clock-only: actual hours against a zero estimate.
 * They are also the only rows in the seeded period — `db:seed:crew`'s roster is seated in the
 * current and future periods, so the estimate-only half of the union is not on screen beside
 * them. Showing both halves in one window needs a seat and a punch in the same period, which
 * is #638's fixture to build (a Confirmed seat with no punch is that issue's whole subject).
 *
 * **Not covered:** a punch spanning a DST transition. The report is DST-safe via
 * `zonedWallClockToInstant`, but a fixture can only exercise it in a period that actually
 * contains a transition — March or November. Seeding one out of period would prove nothing.
 *
 * Idempotent: fixed ids, `saveTimePunch` upserts by id, re-run freely. Re-running restores
 * Dov's open punch, so the export goes back to blocked — that is how you replay the gate.
 *
 * Run: npm run db:seed:timeclock   (DB up + migrated first)
 *      npm run db:reset:dev -- --seeds=fleet,crew,timeclock
 */
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { asId } from "../src/domain/ids.js";
import {
  PAY_PERIOD_ANCHOR,
  addDays,
  vesselDateOf,
  zonedWallClockToInstant,
} from "../src/config/tenant.js";
import { currentPeriod, periodLabel } from "../src/admin/pay-periods.js";
import type { GustoIdentity, TimePunch } from "../src/domain/entities.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MMC_GOOD = "2027-12-31";

/**
 * The most recent CLOSED period: the one containing the day before this period starts.
 * Every instant it spans is in the past, so no punch here can trip the future guard.
 */
function previousPeriod() {
  const cur = currentPeriod(PAY_PERIOD_ANCHOR, vesselDateOf(new Date()));
  return currentPeriod(PAY_PERIOD_ANCHOR, addDays(cur.start, -1));
}

const PERIOD = previousPeriod();

/** Day `n` of the seeded period (0-indexed), as `YYYY-MM-DD`. */
const day = (n: number) => addDays(PERIOD.start, n);

/**
 * A vessel-local wall clock on a period day → the UTC instant stored on the punch.
 * Wall clock in, instant out — the same direction §2.9 reads, so a punch written as
 * "20:00 on the 5th" is the thing the report has to bucket back onto the 5th.
 */
const at = (dayN: number, hhmm: string) =>
  zonedWallClockToInstant(day(dayN), hhmm).toISOString();

async function crew(id: string, name: string, gusto?: GustoIdentity) {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name,
    email: `${name.toLowerCase()}@bb.test`,
    phone: "+15555550100",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
    ...(gusto ? { gusto } : {}),
  });
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: MMC_GOOD,
  });
  return crewId;
}

const gusto = (first: string, last: string, employeeId: string): GustoIdentity => ({
  firstName: first,
  lastName: last,
  title: "Captain",
  employeeId,
});

/** One punch. `outAt: null` is a state — still on the clock — not missing data. */
async function punch(
  key: string,
  crewMemberId: ReturnType<typeof asId<"CrewMemberId">>,
  inAt: string,
  outAt: string | null,
  extra: Partial<Pick<TimePunch, "origin" | "adminEditedAt">> = {},
) {
  await repo.saveTimePunch({
    id: asId<"TimePunchId">(`punch-tc-${key}`),
    crewMemberId,
    inAt,
    outAt,
    // Auto-match tags a shift only on exactly one candidate (§2.9.2). These punches
    // deliberately have no seats, so null is what the real matcher would write anyway.
    shiftId: null,
    origin: "crew",
    adminEditedAt: null,
    ...extra,
  });
}

try {
  await repo.saveRoleType({
    id: CAPTAIN,
    tenantId: asId<"TenantId">("tenant-brewboat"),
    name: "captain",
  });

  // A — 69 minutes. 1.15 hours exactly, and the arithmetic that got this wrong once.
  const ada = await crew("crew-tc-ada", "Ada");
  await punch("ada-69", ada, at(2, "09:00"), at(2, "10:09"));

  // B — three ordinary days. 24h flat; if the total is anything else, the sum is broken
  // before any of the interesting cases get a chance to be.
  const bo = await crew("crew-tc-bo", "Bo", gusto("Bo", "Bosun", "GU-1002"));
  await punch("bo-1", bo, at(1, "08:00"), at(1, "16:00"));
  await punch("bo-2", bo, at(3, "08:00"), at(3, "16:00"));
  await punch("bo-3", bo, at(4, "08:00"), at(4, "16:00"));

  // C — 20:00 Eastern is already tomorrow in UTC. Bucketed vessel-locally (DEC-032) this
  // is one 3.5h day; bucketed on UTC it splits across two, and on the period's last day it
  // would leave the period entirely — hours moving between paychecks.
  const cyd = await crew("crew-tc-cyd", "Cyd", gusto("Cyd", "Current", "GU-1003"));
  await punch("cyd-night", cyd, at(5, "20:00"), at(5, "23:30"));

  // D — the export gate. One closed punch so there are real hours to withhold, and one
  // open punch that withholds them. Close it on /admin/time-clock to unblock.
  const dov = await crew("crew-tc-dov", "Dov", gusto("Dov", "Dockside", "GU-1004"));
  await punch("dov-closed", dov, at(6, "07:30"), at(6, "15:45"));
  await punch("dov-open", dov, at(7, "08:00"), null);

  // E — entered by the office. Hours nobody actually punched must never be silently
  // indistinguishable from hours somebody did (§2.9.8).
  const eze = await crew("crew-tc-eze", "Eze", gusto("Eze", "Entry", "GU-1005"));
  await punch("eze-admin", eze, at(8, "09:00"), at(8, "17:00"), { origin: "admin" });

  // F — crew punched it, an admin moved it afterwards. The other half of §2.9.8: same
  // origin as an untouched punch, different provenance.
  const fen = await crew("crew-tc-fen", "Fen", gusto("Fen", "Fixed", "GU-1006"));
  await punch("fen-edited", fen, at(9, "10:00"), at(9, "18:30"), {
    adminEditedAt: at(10, "11:00"),
  });

  // Any OTHER open punch in this period also blocks the export, so "close Dov and the file
  // comes back" silently fails while one exists — and hand-testing the crew surface leaves
  // them behind routinely. Reported, never removed: deleting a punch is deleting someone's
  // hours, and #635's trail exists precisely so that can't happen quietly. Same instinct as
  // `seed-completion-dev.ts`'s `closeLiveAsks` — restore the intended state — but stopping
  // at telling you, because this data is somebody's manual test and not the seed's to bin.
  const w = {
    from: zonedWallClockToInstant(PERIOD.start, "00:00").toISOString(),
    to: zonedWallClockToInstant(addDays(PERIOD.end, 1), "00:00").toISOString(),
  };
  const strays = (await repo.listTimePunchesBetween(w.from, w.to)).filter(
    (p) => p.outAt === null && !String(p.id).startsWith("punch-tc-"),
  );

  const sel = `${PERIOD.start}|${PERIOD.end}`;
  console.log(`Seeded the time clock into the PREVIOUS pay period — ${periodLabel(PERIOD)}.`);
  console.log("Previous, not current: every punch is then unconditionally in the past, so this");
  console.log("seed behaves the same on day 1 of a period as on day 13.\n");
  console.log("SIX CREW, one concern each. All clock-only (they hold no seats), so every row");
  console.log("shows actual hours against a zero estimate — a positive delta.\n");
  console.log("These six are the ONLY rows in this period: db:seed:crew's roster is seated in");
  console.log("the current and future periods, not this one, so the estimate-only half of the");
  console.log("union isn't on screen here. To see both halves at once you need a seat and a");
  console.log("punch in the same window — which is #638's fixture, not this one's.\n");
  console.log(`  Ada   ${day(2)}  09:00-10:09          69 min = 1.15h EXACTLY`);
  console.log("        → THE ONE THAT MATTERS. (minutes/60)*100 floors this to 1.14 — a cent");
  console.log("          under, in the column Gusto pays from. Ada also has NO gusto identity,");
  console.log("          so her employee_id is blank and her row alone won't import.");
  console.log(`  Bo    ${day(1)}, ${day(3)}, ${day(4)}  08:00-16:00   1440 min = 24.00h`);
  console.log("        → the boring row. If this isn't 24.00 the sum is broken before anything");
  console.log("          interesting gets a chance to be.");
  console.log(`  Cyd   ${day(5)}  20:00-23:30 ET      210 min = 3.50h`);
  console.log(`        → that is 00:00-03:30 UTC on ${day(6)}. It must file under ${day(5)}.`);
  console.log("          Anywhere else and something is reading UTC instead of vessel-local.");
  console.log(`  Dov   ${day(6)}  07:30-15:45         495 min = 8.25h`);
  console.log(`        + ${day(7)}  08:00 → STILL OPEN   → this is what blocks the export.`);
  console.log(`  Eze   ${day(8)}  09:00-17:00         480 min = 8.00h, origin: admin`);
  console.log("        → must render as office-entered. Nobody tapped anything (§2.9.8).");
  console.log(`  Fen   ${day(9)}  10:00-18:30         510 min = 8.50h, adminEditedAt set`);
  console.log("        → crew punched it, an admin moved it. The other half of §2.9.8.\n");
  console.log("WALKTHROUGH, in order:\n");
  console.log(`  1. /admin/payroll?period=${sel}`);
  console.log("     Exactly the six rows above. NO download button — Dov is open.");
  console.log(`  2. /admin/payroll/gusto.csv?period=${sel}`);
  console.log("     Straight into the address bar. Answers 409, not a file. The guard is in the");
  console.log("     domain, not just hidden in the UI.");
  console.log("  3. /admin/time-clock — close EVERY open punch in the period, not just Dov's");
  console.log("     (see below if the seed found others).");
  console.log("  4. Reload the payroll page. The download is back.");
  console.log("  5. Download it. Ada's regular_hours reads 1.15, not 1.14. Her employee_id is");
  console.log("     blank; everyone else's is filled.");

  if (strays.length > 0) {
    console.log(
      `\n⚠ ${strays.length} OTHER open punch${strays.length === 1 ? "" : "es"} in this period — ` +
        "the export stays blocked until these are closed too, not just Dov's:",
    );
    for (const p of strays) {
      console.log(`    ${p.id}  crew=${p.crewMemberId}  in=${p.inAt}  origin=${p.origin}`);
    }
    console.log("  Left alone on purpose — they're real punches, close them on /admin/time-clock.");
  }
} finally {
  await repo.close();
}
