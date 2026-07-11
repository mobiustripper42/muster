import { redirect } from "next/navigation";
import { readSubject } from "./lib/auth";

/**
 * Root entry (#97). A thin session-aware router: an operator lands on the admin
 * hub, everyone else on `/crew` — active crew (14-day cookie) get My Shifts, and a
 * signed-out visitor gets the crew-code sign-in form (DEC-081, the single front
 * door). Root itself renders nothing and never dead-ends; `/crew` owns the
 * signed-out prompt so there's exactly one sign-in surface.
 *
 * Reading the session (cookies) makes this dynamic; `redirect()` throws by
 * design, so it stays outside any try/catch.
 */
export default async function Home() {
  const subject = await readSubject();
  if (subject?.kind === "admin") redirect("/admin");
  // Crew and signed-out both go to /crew — My Shifts for the former, the sign-in
  // form for the latter. No bare-root dead-end.
  redirect("/crew");
}
