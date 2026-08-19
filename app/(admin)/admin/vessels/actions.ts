"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveVesselAdmin, type VesselSaveError } from "@core/admin/vessel-admin.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * Every code this surface can put in `?err=` (#654) — the domain's validation errors plus the
 * glue codes minted here. Declared beside the `redirect()` that mints them and consumed by the
 * page's copy table, so a code with nothing to say about it is a build error rather than a silent
 * fall through to "try again in a moment".
 */
export type VesselErr = VesselSaveError | "error";

/**
 * Upsert a vessel (task 12.9). Auth + glue over `saveVesselAdmin`, which owns validation.
 * A blank `id` = create → mint a fresh vessel id; otherwise edit that row. `redirect()`
 * throws, so it lives outside the try (house convention). On success we keep the saved
 * vessel selected (`?sel=<id>`).
 *
 * `useActionState` shape (#699, DEC-147 amended 2026-08-18): a refusal is **returned**, not
 * redirected, because the redirect is what remounted the form and discarded what was typed.
 * Success still redirects. `_prev` is React's previous state, unused — each submission is judged
 * on the form it was given, never on what the last one said.
 */
export async function saveVessel(
  _prev: VesselErr | null,
  formData: FormData,
): Promise<VesselErr | null> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const rawId = String(formData.get("id") ?? "").trim();
  const id = rawId || `vessel-${randomUUID()}`;
  const name = String(formData.get("name") ?? "");
  const coiMaxPax = Number(formData.get("coiMaxPax") ?? NaN);
  const hueRaw = String(formData.get("hue") ?? "");
  const homeLocationId = String(formData.get("homeLocationId") ?? "");
  const notes = String(formData.get("notes") ?? "");

  let code: VesselErr | null = null;
  try {
    const result = await saveVesselAdmin(getRepo(), {
      id,
      name,
      coiMaxPax,
      ...(hueRaw ? { hue: Number(hueRaw) } : {}),
      ...(homeLocationId ? { homeLocationId } : {}),
      ...(notes ? { notes } : {}),
    });
    code = result.ok ? null : result.code;
  } catch {
    code = "error";
  }

  // A refusal wrote NOTHING, so there is nothing to revalidate — and revalidating would refresh
  // the RSC tree underneath the very values this change exists to protect. Both of these belong
  // strictly to the success branch now.
  if (code) return code;

  revalidatePath("/admin/vessels");
  redirect(`/admin/vessels?sel=${id}&saved=1`);
}
