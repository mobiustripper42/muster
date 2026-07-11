import {
  ShiftCockpit,
  type CockpitSearch,
} from "../../../../../components/assignment/shift-cockpit";
import { Shell } from "../../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../../components/admin/admin-signed-out";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";

/**
 * Standalone cockpit host (DEC-085 pane mechanics) — the mobile drill-in and
 * the deep-link target (At-Risk "needs attention ↗", outbox threads). A thin
 * wrapper: auth + Shell + the shared cockpit body, which the board's desktop
 * right pane (`/admin/shifts?sel=`) also renders. `ctx={null}` marks this host,
 * so action redirects come back here.
 *
 * The old hardcoded "← At-Risk board" back-link is DROPPED (9.7): it lied when
 * the entry was All-shifts/outbox, and the AdminNav covers wayfinding. Width is
 * the unified 3xl (9.8 — board and cockpit no longer disagree).
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
    return <AdminSignedOut subject={subject} />;
  }

  const { shiftId: raw } = await params;
  const sp = await searchParams;
  // Operator name → the guest intro text's sender (#345). Resolved here from the
  // gate's subject; best-effort (a hiccup just omits the name).
  const senderName = (await getRepo().getAdmin(subject.id).catch(() => null))?.name;

  return (
    <Shell width="3xl">
      <ShiftCockpit
        shiftId={decodeURIComponent(raw)}
        sp={sp}
        ctx={null}
        headingLevel="h1"
        senderName={senderName}
      />
    </Shell>
  );
}
