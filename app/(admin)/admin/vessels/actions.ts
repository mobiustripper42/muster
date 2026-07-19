"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveVesselAdmin } from "@core/admin/vessel-admin.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

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

  let code: string | null = null;
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
