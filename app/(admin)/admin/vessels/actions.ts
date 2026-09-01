"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveVesselAdmin, type VesselSaveError } from "@core/admin/vessel-admin.js";
import { asId } from "@core/domain/ids.js";
import type { RoleTypeId } from "@core/domain/ids.js";
import { readSubject } from "../../../lib/auth";
import { clearFormDraft, stashFormDraft } from "../../../lib/form-draft";
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

  // ── Crew rows: add / remove without saving (#861) ────────────────────────────
  //
  // The rule is a variable-length list on a surface with no client JS (DEC-147), so adding and
  // removing a row is a POST like everything else here. The button carries an intent, this
  // rewrites the row set, and the whole form comes back through the SAME draft machinery that
  // already survives a refused save (#699) — so a half-typed name is not lost to adding a row.
  //
  // Nothing is written on these paths. `?crew=1` is what tells the page to restore the draft, in
  // place of the `?err=` it keys off for a refusal.
  const intent = String(formData.get("intent") ?? "");
  if (intent === "add-crew" || intent.startsWith("remove-crew-")) {
    const roles = formData.getAll("crewRole").map(String);
    const counts = formData.getAll("crewCount").map(String);
    if (intent === "add-crew") {
      roles.push("");
      counts.push("1");
    } else {
      const at = Number(intent.slice("remove-crew-".length));
      // A row index the form did not render is a crafted post, not a mis-click — drop it rather
      // than splicing at NaN, which would silently remove the last row instead.
      if (Number.isInteger(at) && at >= 0 && at < roles.length && roles.length > 1) {
        roles.splice(at, 1);
        counts.splice(at, 1);
      }
    }
    formData.delete("crewRole");
    formData.delete("crewCount");
    roles.forEach((r, i) => {
      formData.append("crewRole", r);
      formData.append("crewCount", counts[i] ?? "1");
    });
    await stashFormDraft("/admin/vessels", formData);
    redirect(`/admin/vessels?sel=${rawId || "new"}&crew=1`);
  }

  const name = String(formData.get("name") ?? "");
  const coiMaxPax = Number(formData.get("coiMaxPax") ?? NaN);
  const hueRaw = String(formData.get("hue") ?? "");
  const homeLocationId = String(formData.get("homeLocationId") ?? "");
  const notes = String(formData.get("notes") ?? "");

  // A row whose role was never picked is dropped rather than sent as a blank id — an operator
  // who adds a row and saves without choosing gets "add at least one" if that was the only row,
  // which is true, instead of "unknown role", which blames them for a field they left alone.
  const crewRoles = formData.getAll("crewRole").map(String);
  const crewCounts = formData.getAll("crewCount").map(String);
  const manning = crewRoles
    .map((roleTypeId, i) => ({
      roleTypeId: asId<"RoleTypeId">(roleTypeId),
      count: Number(crewCounts[i] ?? NaN),
    }))
    .filter((m) => String(m.roleTypeId) !== "");

  let code: VesselErr | null = null;
  try {
    const result = await saveVesselAdmin(getRepo(), {
      id,
      name,
      coiMaxPax,
      manning,
      ...(hueRaw ? { hue: Number(hueRaw) } : {}),
      ...(homeLocationId ? { homeLocationId } : {}),
      ...(notes ? { notes } : {}),
    });
    code = result.ok ? null : result.code;
  } catch {
    code = "error";
  }

  revalidatePath("/admin/vessels");
  if (code) {
    // Keep what was typed (#699), and select `new` on a refused CREATE — the minted id names
    // no row, so the page can only answer that lookup with somebody else's boat.
    await stashFormDraft("/admin/vessels", formData);
    redirect(`/admin/vessels?sel=${rawId || "new"}&err=${code}`);
  }
  await clearFormDraft("/admin/vessels");
  redirect(`/admin/vessels?sel=${id}&saved=1`);
}
