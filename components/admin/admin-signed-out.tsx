import { redirect } from "next/navigation";
import type { AuthSubject } from "@core/auth/magic-link.js";
import { getRepo } from "../../app/lib/repo";
import { switchToAdmin } from "../../app/lib/switch-actions";
import { AppLink } from "../ui/app-link";
import { Notice } from "../ui/notice";
import { Shell } from "../ui/shell";
import { SubmitButton } from "../ui/submit-button";

/**
 * The gate fallback every admin surface renders when the caller isn't an admin
 * (#352). It used to be a per-page `SignedOut()` that always said "tap a magic
 * link" — a dead end for the common case: the operator is signed in AS CREW
 * (every admin is also crew, DEC-092/093) and just needs to switch up. This
 * component branches on WHO the caller actually is so the message is actionable:
 *
 *  - **crew who is an active admin** → the switch-up control (the operator's case).
 *  - **crew, not an admin** → not their surface; redirect straight to their crew
 *    home (no dead-end message, no naming who the surface belongs to).
 *  - **no session at all** → sign in (the crew-code login at `/crew` is the front
 *    door, DEC-081 — then switch up).
 *
 * Async because the dual-role case needs the DEC-092 active-admin check; this is
 * the cold error path, not a hot render, so the extra `getAdmin` read is fine.
 */
export async function AdminSignedOut({
  subject,
}: {
  subject: AuthSubject | null;
}) {
  if (subject?.kind === "crew") {
    // Same active-admin gate `readSubject`/`switchToAdmin` enforce (DEC-092) —
    // only offer the escalation to someone who could actually take it.
    const admin = await getRepo()
      .getAdmin(subject.id)
      .catch(() => null);
    if (admin?.active) {
      return (
        <Shell width="3xl">
          <h1 className="text-lg font-semibold text-ink">Muster · Admin</h1>
          <Notice>
            You’re signed in as crew. Switch up to the admin cockpit to reach this
            surface.
          </Notice>
          <form action={switchToAdmin}>
            <SubmitButton className="rounded-card border border-accent bg-card px-4 py-2 text-sm font-semibold text-accent shadow-sm">
              Switch to admin →
            </SubmitButton>
          </form>
        </Shell>
      );
    }
    // Signed in as crew, but not an admin — not their surface. Send them straight
    // to their crew home rather than showing a dead-end "not for you" message.
    redirect("/crew");
  }

  // No session — sign in via the crew-code front door, then switch up.
  return (
    <Shell width="3xl">
      <h1 className="text-lg font-semibold text-ink">Muster · Admin</h1>
      <Notice>
        You’re signed out.{" "}
        <AppLink href="/crew" className="font-semibold underline">
          Sign in →
        </AppLink>
      </Notice>
    </Shell>
  );
}
