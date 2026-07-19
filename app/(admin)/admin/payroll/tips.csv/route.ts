import { buildGratuityPayroll, gustoTipsCsv } from "@core/admin/gratuity-payroll.js";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";

/**
 * GET /admin/payroll/tips.csv?period=<from>|<to> — the Gusto timesheet CSV of Muster-side
 * gratuity for the pay period (12.3b, DEC-124). Admin-only. Streams the 15-column format
 * `gustoTipsCsv` builds (unmapped crew are excluded — they surface as warnings on the page).
 */
export const dynamic = "force-dynamic";

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: Request): Promise<Response> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
  const [from, to] = (new URL(req.url).searchParams.get("period") ?? "").split("|");
  if (!isDate(from) || !isDate(to)) {
    return new Response("Bad or missing ?period=YYYY-MM-DD|YYYY-MM-DD", { status: 400 });
  }
  const payroll = await buildGratuityPayroll(getRepo(), { from, to });
  return new Response(gustoTipsCsv(payroll.rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="gusto-tips-${from}_${to}.csv"`,
    },
  });
}
