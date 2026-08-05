"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveLocationAdmin, type LocationSaveError } from "@core/admin/location-admin.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * Every code this surface can put in `?err=` (#654) — the domain's validation errors plus the
 * glue codes minted here. Declared beside the `redirect()` that mints them, and consumed by the
 * page's copy table, so a code with nothing to say about it is a build error rather than a
 * silent fall through to "try again in a moment".
 */
export type LocationErr = LocationSaveError | "error";

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

  let code: LocationErr | null = null;
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
