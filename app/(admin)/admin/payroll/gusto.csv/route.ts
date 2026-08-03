import {
  buildPayrollReconcile,
  gustoPayrollCsv,
  EXPORT_BLOCKED_MESSAGE,
} from "@core/admin/payroll-reconcile.js";
import { readSubject } from "../../../../lib/auth";
import { timeClockEnabled } from "../../../../lib/flags";
import { getRepo } from "../../../../lib/repo";

/**
 * GET /admin/payroll/gusto.csv?period=<from>|<to> — the ONE payroll file: identity,
 * `regular_hours` from the punch clock and `paycheck_tips` from the gratuity split, on the same
 * row (13.4/#628, operator 2026-08-02). Admin-only, same 15-column Gusto timesheet shape the
 * tips-only export already uses, so it imports the same way.
 *
 * **409 while any punch in the period is open** (§2.9.6). The page already hides the download,
 * but a URL survives a bookmark and a browser back button — and the one thing that must never
 * happen is a payroll file that is quietly short a shift. The domain refuses to build it; this
 * turns that refusal into a status code rather than a 500.
 */
export const dynamic = "force-dynamic";

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: Request): Promise<Response> {
  if (!timeClockEnabled()) {
    return new Response("Not found", { status: 404 }); // phase dark (#628)
  }
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
  const [from, to] = (new URL(req.url).searchParams.get("period") ?? "").split("|");
  if (!isDate(from) || !isDate(to)) {
    return new Response("Bad or missing ?period=YYYY-MM-DD|YYYY-MM-DD", { status: 400 });
  }

  const reconcile = await buildPayrollReconcile(getRepo(), { from, to });
  if (reconcile.exportBlocked) {
    // 409 Conflict, not 400: the request is well-formed, the DATA isn't ready. The body names
    // the fix rather than the failure — whoever hits this needs to close a punch, not debug a URL.
    return new Response(EXPORT_BLOCKED_MESSAGE, { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  return new Response(gustoPayrollCsv(reconcile), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="gusto-payroll-${from}_${to}.csv"`,
    },
  });
}
