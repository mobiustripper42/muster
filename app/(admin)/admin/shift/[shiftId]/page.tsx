import Link from "next/link";
import {
  ShiftCockpit,
  type CockpitSearch,
} from "../../../../../components/assignment/shift-cockpit";
import { Notice } from "../../../../../components/ui/notice";
import { Shell } from "../../../../../components/ui/shell";
import { readSubject } from "../../../../lib/auth";

/**
 * Standalone cockpit host (DEC-085 pane mechanics) — the mobile drill-in and
 * the deep-link target (At-Risk "needs attention ↗", outbox threads). A thin
 * wrapper: auth + Shell + the shared cockpit body, which the board's desktop
 * right pane (`/admin/shifts?sel=`) also renders. `ctx={null}` marks this host,
 * so action redirects come back here.
 */

export const dynamic = "force-dynamic";

export default async function ShiftCockpitPage({
  params,
  searchParams,
}: {
  params: Promise<{ shiftId: string }>;
  searchParams: Promise<CockpitSearch>;
}) {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") {
    return (
      <Shell width="2xl">
        <Notice>You’re signed out. Tap an operator magic link to get in.</Notice>
      </Shell>
    );
  }

  const { shiftId: raw } = await params;
  const sp = await searchParams;

  return (
    <Shell width="2xl">
      <Link href="/admin/at-risk" className="text-xs font-semibold text-accent">
        ← At-Risk board
      </Link>
      <ShiftCockpit
        shiftId={decodeURIComponent(raw)}
        sp={sp}
        ctx={null}
        headingLevel="h1"
      />
    </Shell>
  );
}
