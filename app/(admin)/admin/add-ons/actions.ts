"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveAddOnAdmin } from "@core/admin/add-on-admin.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { TENANT_ID } from "../../../lib/tenant";

/**
 * Upsert an add-on (#491). Auth + FormData glue over `saveAddOnAdmin`, which owns validation.
 * A blank `id` = create → mint a fresh add-on id; otherwise edit that row. Money arrives as
 * DOLLARS from the form and is converted to integer cents here (DEC-112). `redirect()` throws,
 * so it lives outside the try (house convention). On success we keep the saved add-on selected.
 */

/** "150", "150.00", "$1,299.5" → integer cents; NaN when unparseable (domain rejects it). */
function dollarsToCents(raw: string): number {
  const s = raw.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

export async function saveAddOn(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const rawId = String(formData.get("id") ?? "").trim();
  const id = rawId || `addon-${randomUUID()}`;
  const label = String(formData.get("label") ?? "");
  const amountCents = dollarsToCents(String(formData.get("amount") ?? ""));
  const required = Boolean(formData.get("required"));
  const active = Boolean(formData.get("active"));

  let code: string | null = null;
  try {
    const result = await saveAddOnAdmin(getRepo(), {
      id,
      tenantId: String(TENANT_ID),
      label,
      amountCents,
      required,
      active,
    });
    code = result.ok ? null : result.code;
  } catch {
    code = "error";
  }

  revalidatePath("/admin/add-ons");
  redirect(code ? `/admin/add-ons?sel=${id}&err=${code}` : `/admin/add-ons?sel=${id}&saved=1`);
}
