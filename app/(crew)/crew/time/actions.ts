"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { clockIn, clockOut } from "@core/crew/time-clock.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * Crew time clock (#626, SPEC §2.9) — go on and off the clock. Auth + glue over the
 * `clockIn` / `clockOut` domain use-cases; validation and the one-open-punch rule
 * live there and in the index beneath it, never here.
 *
 * **The subject comes from the session, never the form.** There is no crew id in
 * either payload — a crew member can only punch themselves, by construction rather
 * than by check.
 *
 * Feedback rides redirect params as codes (the DEC-055 idiom — the page maps them to
 * copy, so a crafted URL can't inject text onto a trusted surface). `redirect()`
 * throws by design → it stays OUTSIDE the try.
 */

const BACK = "/crew/time";

export async function clockInNow(): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");

  let code: string | null = null;
  try {
    // The caller mints the id (the `addMyTimeOff` convention — core mints nothing it
    // can't make deterministic). A double-tapped button mints two ids and still
    // produces one punch: `clockIn` refuses the second, and if both slip past its
    // read the partial unique index refuses the row (§2.9.4).
    const result = await clockIn(getRepo(), {
      id: asId<"TimePunchId">(`punch-${randomUUID()}`),
      crewMemberId: asId<"CrewMemberId">(subject.id),
      at: new Date(),
    });
    code = result.ok ? null : result.code;
  } catch {
    code = "error";
  }

  revalidatePath(BACK);
  redirect(code ? `${BACK}?err=${code}` : `${BACK}?in=1`);
}

export async function clockOutNow(): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");

  let code: string | null = null;
  try {
    // No punch id from the form: `clockOut` closes whatever THIS person has open,
    // and at most one can exist. A stale form can't close someone else's punch, or
    // an older one of their own.
    const result = await clockOut(
      getRepo(),
      asId<"CrewMemberId">(subject.id),
      new Date(),
    );
    code = result.ok ? null : result.code;
  } catch {
    code = "error";
  }

  revalidatePath(BACK);
  redirect(code ? `${BACK}?err=${code}` : `${BACK}?out=1`);
}
