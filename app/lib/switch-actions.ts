"use server";

import { redirect } from "next/navigation";
import { getRepo } from "./repo";
import { endSession, readSubject, startSession } from "./auth";

/**
 * Crew ↔ admin view switching for a dual-role person (DEC-093). Every admin is
 * also crew (DEC-092 — `admins.id` IS the crew id), so switching surfaces is just
 * re-minting the OTHER-kind session for the SAME id — no re-auth. One login (a
 * crew code) reaches both apps: log in as crew, switch up to admin.
 *
 * Session-minting server actions, so they're a security seam — see `switchToAdmin`.
 */

/**
 * Admin → crew. De-escalation: an admin is definitionally that crew person, so
 * this is always allowed. Bounces to /crew if the caller isn't actually an admin
 * (nothing to switch from).
 */
export async function switchToCrew(): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/crew");
  await startSession({ kind: "crew", id: subject.id });
  redirect("/crew");
}

/**
 * Crew → admin. **Privilege escalation** — gated on the DEC-092 revoke check: mint
 * an admin session ONLY if the caller's crew id is an ACTIVE admin. A non-admin or
 * deactivated crew member is bounced back to /crew with no session change. This is
 * the one escalation seam in the app; the gate is the SAME `getAdmin(active)` that
 * `readSubject` enforces on every admin request, so a revoked admin can neither
 * hold nor re-mint an admin session. (Flagged for the 10.3 security audit.)
 */
export async function switchToAdmin(): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");
  const admin = await getRepo().getAdmin(subject.id);
  if (!admin || !admin.active) redirect("/crew");
  await startSession({ kind: "admin", id: subject.id });
  redirect("/admin");
}

/**
 * Sign out from the admin side (#709) — drop the session and land on the ADMIN front door.
 *
 * A sibling of `signOut` in `app/(crew)/crew/actions.ts` rather than a parameter on it. The two
 * differ only in where they land, and a shared `redirect(to)` argument is a landing page a
 * caller can get wrong — including a caller that passes one from a request. Two callers, two
 * fixed destinations, nothing to pass.
 *
 * Until now there was **no way for an admin to sign out at all**, at any width: the only sign-out
 * in the codebase was the crew drawer's, so an admin had to switch to crew view first. Clearing
 * your own cookie is always safe, so there is no gate here beyond ending the session.
 */
export async function signOutAdmin(): Promise<void> {
  await endSession();
  redirect("/admin");
}
