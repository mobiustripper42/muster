"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveLocationAdmin } from "@core/admin/location-admin.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * Upsert a location (task 12.9). Auth + glue over `saveLocationAdmin` (owns validation). Blank
 * `id` = create → mint a fresh location id; otherwise edit. `redirect()` throws → outside try.
 */
export async function saveLocation(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const rawId = String(formData.get("id") ?? "").trim();
  const id = rawId || `location-${randomUUID()}`;
  const name = String(formData.get("name") ?? "");
  const pickupDescription = String(formData.get("pickupDescription") ?? "");
  const pickupLink = String(formData.get("pickupLink") ?? "");
  const routeDescription = String(formData.get("routeDescription") ?? "");

  let code: string | null = null;
  try {
    const result = await saveLocationAdmin(getRepo(), {
      id,
      name,
      pickupDescription,
      routeDescription,
      ...(pickupLink ? { pickupLink } : {}),
    });
    code = result.ok ? null : result.code;
  } catch {
    code = "error";
  }

  revalidatePath("/admin/locations");
  redirect(code ? `/admin/locations?sel=${id}&err=${code}` : `/admin/locations?sel=${id}&saved=1`);
}
