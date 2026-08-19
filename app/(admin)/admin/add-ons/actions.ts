"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveAddOnAdmin, type AddOnSaveError } from "@core/admin/add-on-admin.js";
import { readSubject } from "../../../lib/auth";
import { clearFormDraft, stashFormDraft } from "../../../lib/form-draft";
import { getRepo } from "../../../lib/repo";
import { TENANT_ID } from "../../../lib/tenant";

/**
 * Every code this surface can put in `?err=` (#654) — the domain's validation errors plus the
 * glue codes minted here. Declared beside the `redirect()` that mints them and consumed by the
 * page's copy table, so a code with nothing to say about it is a build error rather than a silent
 * fall through to "try again in a moment".
 */
export type AddOnErr = AddOnSaveError | "error";

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

  let code: AddOnErr | null = null;
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
  if (code) {
    // Keep what was typed (#699) — the page reads this back as its defaults, which is the only
    // thing that survives React's unconditional form reset. `sel=new` on a refused CREATE:
    // the minted id names no row, so sending it hands the page a lookup it can only get wrong.
    await stashFormDraft("add-ons", formData);
    redirect(`/admin/add-ons?sel=${rawId || "new"}&err=${code}`);
  }
  await clearFormDraft("add-ons");
  redirect(`/admin/add-ons?sel=${id}&saved=1`);
}
