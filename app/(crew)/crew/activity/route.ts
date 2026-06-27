import { asId } from "@core/domain/ids.js";
import { threadMembership } from "@core/crewapp/thread-list.js";
import { readSubject } from "../../../lib/auth";
import { getRepo, getPresence } from "../../../lib/repo";
import { TENANT_ID } from "../../../lib/tenant";

/**
 * The activity beacon endpoint (#117, DEC-071) — the server half of the DEC-055
 * client island. A crew page POSTs here on real human view; we record **presence**
 * (DEC-047 — the doorbell's §7.1/§7.6 keystone, otherwise every member reads
 * `absent` and the present-suppression / in-app-toast branches stay dark), and,
 * when the body names a thread the subject is a member of, **read-state** (DEC-069,
 * cancel-on-read). Recording on this observed POST — not a server GET render — is
 * what keeps prefetch / link-unfurl / bfcache from silencing a real ring.
 */
export async function POST(req: Request): Promise<Response> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") return new Response(null, { status: 204 });

  const now = new Date();
  const nowIso = now.toISOString();
  await getPresence().recordActivity(subject, nowIso);

  let threadId: string | undefined;
  try {
    const data: unknown = await req.json();
    if (data && typeof (data as { threadId?: unknown }).threadId === "string") {
      threadId = (data as { threadId: string }).threadId;
    }
  } catch {
    // no body / not JSON — presence-only beacon (a non-thread crew page).
  }

  if (threadId) {
    const repo = getRepo();
    const member = await threadMembership(
      repo,
      asId<"ThreadId">(threadId),
      asId<"CrewMemberId">(subject.id),
      TENANT_ID,
      now,
    );
    if (member) {
      await repo.recordRead(asId<"ThreadId">(threadId), subject, nowIso);
    }
  }

  return new Response(null, { status: 204 });
}
