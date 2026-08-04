"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { addPunch, deletePunch, editPunch } from "@core/crew/time-clock.js";
import { addDays, zonedWallClockToInstant } from "@core/config/tenant.js";
import { readSubject } from "../../../lib/auth";
import { timeClockEnabled } from "../../../lib/flags";
import { getRepo } from "../../../lib/repo";

/**
 * The repair bench's write half (#627, SPEC §2.9.5). Auth + glue over `addPunch` /
 * `editPunch` / `deletePunch`; the validation (`out_before_in`, the immutable day, the
 * one-open-punch rule) lives in the domain and is NOT restated here — that's the AC.
 *
 * **Admin-gated, and that is the whole authorization story**: unlike the crew surface,
 * these deliberately act on someone else's punches. The gate is `kind === "admin"`.
 *
 * **Every door checks `timeClockEnabled()` (#628)** — a server action is a POST endpoint, and a
 * kill switch that only hides nav links is the #621 defect.
 *
 * Times arrive as vessel-local wall clock from `<input type="time">` and are converted
 * with `zonedWallClockToInstant` (DEC-032) — never `new Date(string)`, which would read
 * them as the server's zone. Feedback rides redirect params as codes (DEC-026).
 * `redirect()` throws by design → OUTSIDE the try.
 */

const BACK = "/admin/time-clock";

/** Rebuild the caller's view from the form so a redirect lands where they were. */
function backTo(formData: FormData): string {
  const view = String(formData.get("view") ?? "");
  const params = new URLSearchParams();
  if (view === "day") {
    params.set("day", String(formData.get("day") ?? ""));
  } else {
    params.set("crew", String(formData.get("crew") ?? ""));
    params.set("period", String(formData.get("period") ?? ""));
  }
  return `${BACK}?${params.toString()}`;
}

async function requireAdmin(): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");
}

/**
 * A wall-clock `HH:MM` on a vessel-local day → an instant. Null when the field is
 * blank, which is how an OPEN punch is expressed (a missed clock-in corrected
 * mid-shift is legitimately still running).
 */
function instantOf(day: string, time: string): Date | null {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  return zonedWallClockToInstant(day, time);
}

/**
 * The out-time's instant, honouring the form's explicit "ends next day" box.
 *
 * A punch belongs to the vessel-local day its `inAt` falls on (§2.9.6) — so an evening
 * trip that lands at 02:00 is ONE punch on the earlier day, and its `outAt` is on the
 * next calendar day. There is one date field, so the form has to be able to say that.
 *
 * **Explicit, not inferred.** Rolling the day forward automatically whenever
 * `out < in` would silently turn a typo — 17:00 in, 09:00 out — into a paid sixteen
 * hours. On a surface whose output is a paycheck, a mistake must stay an error
 * (`out_before_in`); the operator asserts the overnight case deliberately.
 */
function outInstantOf(day: string, time: string, nextDay: boolean): Date | null {
  return instantOf(nextDay ? addDays(day, 1) : day, time);
}

export async function addPunchAction(formData: FormData): Promise<void> {
  if (!timeClockEnabled()) redirect("/admin"); // phase dark (#628)
  await requireAdmin();
  const back = backTo(formData);
  const day = String(formData.get("punchDay") ?? "");
  const crewMemberId = String(formData.get("crewMemberId") ?? "");
  const inAt = instantOf(day, String(formData.get("inTime") ?? ""));
  const outAt = outInstantOf(
    day,
    String(formData.get("outTime") ?? ""),
    formData.get("outNextDay") === "1",
  );

  let code: string | null = null;
  if (!crewMemberId || !/^\d{4}-\d{2}-\d{2}$/.test(day) || inAt === null) {
    code = "bad_input";
  } else {
    try {
      const result = await addPunch(getRepo(), {
        id: asId<"TimePunchId">(`punch-${randomUUID()}`),
        crewMemberId: asId<"CrewMemberId">(crewMemberId),
        inAt,
        outAt,
      });
      code = result.ok ? null : result.code;
    } catch {
      code = "error";
    }
  }

  revalidatePath(BACK);
  if (!code) redirect(`${back}&added=1`);
  // A refused add must not wipe what was typed — the operator would have to re-enter
  // three fields to fix one of them. The attempted values ride back as structured
  // params (a date, two `HH:MM`s, an id — shapes the page re-validates before echoing,
  // never free text), and the form re-renders with them.
  const retry = new URLSearchParams({
    err: code,
    aday: day,
    ain: String(formData.get("inTime") ?? ""),
    aout: String(formData.get("outTime") ?? ""),
    anext: formData.get("outNextDay") === "1" ? "1" : "",
    acrew: crewMemberId,
  });
  redirect(`${back}&${retry.toString()}`);
}

export async function editPunchAction(formData: FormData): Promise<void> {
  if (!timeClockEnabled()) redirect("/admin"); // phase dark (#628)
  await requireAdmin();
  const back = backTo(formData);
  const id = String(formData.get("punchId") ?? "");
  // The day comes from the punch being edited, not from an input — there is no date
  // field, and the domain refuses a cross-midnight move anyway (`day_moved`).
  const day = String(formData.get("punchDay") ?? "");
  const inAt = instantOf(day, String(formData.get("inTime") ?? ""));
  const outAt = outInstantOf(
    day,
    String(formData.get("outTime") ?? ""),
    formData.get("outNextDay") === "1",
  );

  let code: string | null = null;
  if (!id || inAt === null) {
    code = "bad_input";
  } else {
    try {
      const result = await editPunch(getRepo(), asId<"TimePunchId">(id), {
        inAt,
        // A blank out-time re-OPENS the punch — the operator undoing a wrong close.
        outAt,
        now: new Date(),
      });
      code = result.ok ? null : result.code;
    } catch {
      code = "error";
    }
  }

  revalidatePath(BACK);
  redirect(code ? `${back}&err=${code}` : `${back}&saved=1`);
}

export async function deletePunchAction(formData: FormData): Promise<void> {
  if (!timeClockEnabled()) redirect("/admin"); // phase dark (#628)
  await requireAdmin();
  const back = backTo(formData);
  const id = String(formData.get("punchId") ?? "");

  let code: string | null = null;
  try {
    if (id) await deletePunch(getRepo(), asId<"TimePunchId">(id));
  } catch {
    code = "error";
  }

  revalidatePath(BACK);
  redirect(code ? `${back}&err=${code}` : `${back}&deleted=1`);
}
