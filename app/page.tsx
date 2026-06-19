import { redirect } from "next/navigation";
import { Notice } from "../components/ui/notice";
import { Shell } from "../components/ui/shell";
import { readSubject } from "./lib/auth";

/**
 * Root entry (#97). Session-aware so a crew member who opens the bare base URL —
 * a bookmark, a home-screen shortcut — lands on My Shifts instead of a dead M4
 * placeholder. The 14-day session cookie already keeps active crew signed in, so
 * this just routes them. The interim ahead of the parked crew "living link"
 * (FUTURE_IDEAS); pairs with telling crew to bookmark after first sign-in.
 *
 * Reading the session (cookies) makes this dynamic; `redirect()` throws by
 * design, so it stays outside any try/catch.
 */
export default async function Home() {
  const subject = await readSubject();
  if (subject?.kind === "crew") redirect("/crew");
  if (subject?.kind === "admin") redirect("/admin");

  return (
    <Shell>
      <h1 className="text-lg font-semibold text-ink">Muster</h1>
      <Notice>You’re signed out. Tap the link your operator sent to get in.</Notice>
    </Shell>
  );
}
