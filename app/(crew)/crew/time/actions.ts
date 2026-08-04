"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { clockIn, clockOut } from "@core/crew/time-clock.js";
import { addOwnPunch, deleteOwnPunch, editOwnPunch } from "@core/crew/time-clock-crew.js";
import { addDays, zonedWallClockToInstant } from "@core/config/tenant.js";
import { readSubject } from "../../../lib/auth";
import { timeClockEnabled } from "../../../lib/flags";
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
 * **Every door checks `timeClockEnabled()` (#628).** A server action is a POST endpoint: gating
 * the page and not these would leave the whole clock writable by anyone who kept a form around,
 * which is the #621 shape — a kill switch that hides its links and kills nothing.
 *
 * Feedback rides redirect params as codes (DEC-026 — codes/ids only, mapped to copy
 * server-side, so a crafted URL can't inject text onto a trusted surface), matching
 * the citation the sibling `time-off/actions.ts` uses rather than adding a third
 * variant. `redirect()` throws by design → it stays OUTSIDE the try.
 */

const BACK = "/crew/time";

export async function clockInNow(): Promise<void> {
  if (!timeClockEnabled()) redirect("/crew"); // phase dark (#628) — the door isn't there
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
  if (!timeClockEnabled()) redirect("/crew"); // phase dark (#628) — the door isn't there
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

// ── Their own edits (#635, SPEC §2.9.8) ─────────────────────────────────────
// The crew member corrects their own record. Ownership, the required reason and the
// trail all live in `time-clock-crew.ts`; these are auth + glue and nothing else.
//
// **The subject still comes only from the session.** A punch id arrives from the form
// — it has to — but a forged one naming someone else's punch comes back `gone`, the
// same answer a nonexistent id gets, so it can't be used to discover whose is whose.

/** A wall-clock `HH:MM` on a vessel-local day → an instant. Null when blank. */
function instantOf(day: string, time: string): Date | null {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  return zonedWallClockToInstant(day, time);
}

/** Honours the explicit "ends next day" box — an evening trip landing at 02:00 is one
 *  punch on the earlier day. Never inferred from `out < in`, which would turn a typo
 *  into paid hours (the #627 reasoning, same form). */
function outInstantOf(day: string, time: string, nextDay: boolean): Date | null {
  return instantOf(nextDay ? addDays(day, 1) : day, time);
}

/** Back to the row they were working on, not the top of the list. */
function backToRow(punchId: string, param: string): string {
  return `${BACK}?${param}#punch-${punchId}`;
}

export async function editMyPunch(formData: FormData): Promise<void> {
  if (!timeClockEnabled()) redirect("/crew"); // phase dark (#628) — the door isn't there
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");
  const punchId = String(formData.get("punchId") ?? "");
  const day = String(formData.get("punchDay") ?? "");
  const inAt = instantOf(day, String(formData.get("inTime") ?? ""));
  const outAt = outInstantOf(
    day,
    String(formData.get("outTime") ?? ""),
    formData.get("outNextDay") === "1",
  );

  let code: string | null = null;
  if (!punchId || inAt === null) {
    code = "bad_input";
  } else {
    try {
      const result = await editOwnPunch(getRepo(), {
        editId: asId<"TimePunchEditId">(`punchedit-${randomUUID()}`),
        punchId: asId<"TimePunchId">(punchId),
        crewMemberId: asId<"CrewMemberId">(subject.id),
        inAt,
        outAt,
        reason: String(formData.get("reason") ?? ""),
        now: new Date(),
      });
      code = result.ok ? null : result.code;
    } catch {
      code = "error";
    }
  }

  revalidatePath(BACK);
  // On refusal the editor stays OPEN on that row, so the reason they typed and the
  // field they got wrong are both still in front of them.
  redirect(
    code
      ? backToRow(punchId, `edit=${encodeURIComponent(punchId)}&err=${code}`)
      : backToRow(punchId, "saved=1"),
  );
}

export async function addMyPunch(formData: FormData): Promise<void> {
  if (!timeClockEnabled()) redirect("/crew"); // phase dark (#628) — the door isn't there
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");
  const id = `punch-${randomUUID()}`;
  const day = String(formData.get("punchDay") ?? "");
  const inAt = instantOf(day, String(formData.get("inTime") ?? ""));
  const outAt = outInstantOf(
    day,
    String(formData.get("outTime") ?? ""),
    formData.get("outNextDay") === "1",
  );

  let code: string | null = null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || inAt === null) {
    code = "bad_input";
  } else {
    try {
      const result = await addOwnPunch(getRepo(), {
        id: asId<"TimePunchId">(id),
        editId: asId<"TimePunchEditId">(`punchedit-${randomUUID()}`),
        crewMemberId: asId<"CrewMemberId">(subject.id),
        inAt,
        outAt,
        reason: String(formData.get("reason") ?? ""),
        now: new Date(),
      });
      code = result.ok ? null : result.code;
    } catch {
      code = "error";
    }
  }

  revalidatePath(BACK);
  redirect(code ? `${BACK}?add=1&err=${code}` : backToRow(id, "added=1"));
}

export async function deleteMyPunch(formData: FormData): Promise<void> {
  if (!timeClockEnabled()) redirect("/crew"); // phase dark (#628) — the door isn't there
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");
  const punchId = String(formData.get("punchId") ?? "");

  let code: string | null = null;
  try {
    const result = await deleteOwnPunch(getRepo(), {
      editId: asId<"TimePunchEditId">(`punchedit-${randomUUID()}`),
      punchId: asId<"TimePunchId">(punchId),
      crewMemberId: asId<"CrewMemberId">(subject.id),
      reason: String(formData.get("reason") ?? ""),
      now: new Date(),
    });
    code = result.ok ? null : result.code;
  } catch {
    code = "error";
  }

  revalidatePath(BACK);
  redirect(
    code
      ? backToRow(punchId, `edit=${encodeURIComponent(punchId)}&err=${code}`)
      : `${BACK}?deleted=1`,
  );
}
