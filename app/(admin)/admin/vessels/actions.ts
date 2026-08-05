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
 */
export async function saveVessel(formData: FormData): Promise<void> {
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

  revalidatePath("/admin/vessels");
  redirect(code ? `/admin/vessels?sel=${id}&err=${code}` : `/admin/vessels?sel=${id}&saved=1`);
}
