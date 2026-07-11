"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { hashSecret, randomSecret } from "@core/auth/magic-link.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { FLASH_COOKIE } from "./flash";

/**
 * Crew calendar-feed actions (#355, DEC-098). The token is stored HASH-ONLY, so the
 * plaintext URL can never be re-shown — the mint carries the raw token to the page
 * exactly ONCE via a short-lived flash cookie, which the "done" action (or the next
 * mint) clears. Recovery == regenerate, which is also revoke/rotate.
 */

const flashOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/crew/calendar",
  maxAge: 60 * 60, // 1h — long enough to copy, short enough not to linger
};

export async function mintCalendarFeed(): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");
  const token = randomSecret();
  await getRepo().saveCalendarFeed({
    crewMemberId: asId<"CrewMemberId">(subject.id),
    tokenHash: hashSecret(token),
    createdAt: new Date().toISOString(),
  });
  // Hand the plaintext to the page once — hash-only storage can't reproduce it.
  (await cookies()).set(FLASH_COOKIE, token, flashOptions);
  redirect("/crew/calendar");
}

export async function hideCalendarUrl(): Promise<void> {
  await clearFlash();
  redirect("/crew/calendar");
}

export async function revokeCalendarFeed(): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");
  await getRepo().deleteCalendarFeed(asId<"CrewMemberId">(subject.id));
  await clearFlash();
  redirect("/crew/calendar");
}

/** Clear the show-once flash cookie. The `path` MUST match the one used at `set()`
 *  (`/crew/calendar`) — a delete keyed to the default `/` wouldn't remove a cookie
 *  stored at the sub-path, silently leaving the plaintext token readable (DEC-098
 *  show-once). */
async function clearFlash(): Promise<void> {
  (await cookies()).delete({ name: FLASH_COOKIE, path: "/crew/calendar" });
}
