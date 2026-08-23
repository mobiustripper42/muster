"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { GratuityKindConfig, PriceVariation } from "@core/domain/entities.js";
import { saveOfferingAdmin, type OfferingSaveError } from "@core/admin/offering-admin.js";
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
export type OfferingErr = OfferingSaveError | "error";

/**
 * Upsert an offering (task 12.8). Auth + FormData glue over `saveOfferingAdmin`, which owns
 * validation. A blank `id` = create → mint a fresh offering id. Money arrives as DOLLARS from
 * the form and is converted to integer cents here (DEC-112); the ordered price-variations
 * list arrives as JSON from the client-island editor (order = the rule). `redirect()` throws,
 * so it lives outside the try (house convention). On success we keep the saved offering
 * selected; the `hidden` flag rides along so a Show-hidden view stays in it.
 */

/** "499", "499.00", "$1,299.5" → integer cents; NaN when unparseable (domain rejects it). */
function dollarsToCents(raw: string): number {
  const s = raw.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

/** Blank → undefined; anything else → Number (bad input becomes NaN for the domain). */
function optionalInt(raw: string): number | undefined {
  const s = raw.trim();
  return s === "" ? undefined : Number(s);
}

/** "15, 20, 25" (percent) → [1500, 2000, 2500] bps. Bad entries become NaN for the domain. */
function percentListToBps(raw: string): number[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "")
    .map((t) => (/^\d+(\.\d+)?$/.test(t) ? Math.round(Number(t) * 100) : NaN));
}

/** One gratuity kind's form row → config (or null when the kind isn't collected). */
function gratuityKindFromForm(
  fd: FormData,
  kind: "pre" | "post",
): GratuityKindConfig | null {
  const cap = kind === "pre" ? "Pre" : "Post";
  if (!fd.get(`grat${cap}`)) return null; // enable checkbox unchecked → kind not collected
  const tiersBps = percentListToBps(String(fd.get(`grat${cap}Tiers`) ?? ""));
  const defaultRaw = String(fd.get(`grat${cap}Default`) ?? "").trim();
  const defaultBps = /^\d+(\.\d+)?$/.test(defaultRaw) ? Math.round(Number(defaultRaw) * 100) : NaN;
  return { kind, tiersBps, defaultBps, required: Boolean(fd.get(`grat${cap}Required`)) };
}

export async function saveOffering(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const rawId = String(formData.get("id") ?? "").trim();
  const id = rawId || `offering-${randomUUID()}`;

  // ── Details ──
  const name = String(formData.get("name") ?? "");
  const status = String(formData.get("status") ?? "");
  const description = String(formData.get("description") ?? "");
  const locationId = String(formData.get("locationId") ?? "");
  const vesselIds = formData.getAll("vesselIds").map(String);
  const tripLengthMinutes = optionalInt(String(formData.get("tripLengthMinutes") ?? ""));
  const holdMinutes = optionalInt(String(formData.get("holdMinutes") ?? ""));
  const arriveBeforeMinutes = optionalInt(String(formData.get("arriveBeforeMinutes") ?? ""));

  // ── Schedule — the DepartureTimesEditor island owns the full list; it serializes each
  // time to a hidden `departureTime` input, so getAll() is the whole set (add + remove) ──
  const departureTimes = formData.getAll("departureTime").map(String);
  departureTimes.sort();
  const schedule = {
    seasonStart: String(formData.get("seasonStart") ?? ""),
    seasonEnd: String(formData.get("seasonEnd") ?? ""),
    weekdays: formData.getAll("weekday").map(Number),
    departureTimes,
  };

  // ── Pricing ──
  const basePriceCents = dollarsToCents(String(formData.get("basePrice") ?? ""));
  const extraGuestPriceCents = dollarsToCents(String(formData.get("extraGuestPrice") ?? ""));
  const includedGuestCount = optionalInt(String(formData.get("includedGuestCount") ?? ""));
  let priceVariations: PriceVariation[] = [];
  let variationsParse = true;
  try {
    const parsed: unknown = JSON.parse(String(formData.get("priceVariations") ?? "[]"));
    if (Array.isArray(parsed)) priceVariations = parsed as PriceVariation[];
    else variationsParse = false;
  } catch {
    variationsParse = false;
  }

  // ── Gratuity (per kind) + add-ons ──
  const gratuityKinds = [
    gratuityKindFromForm(formData, "pre"),
    gratuityKindFromForm(formData, "post"),
  ].filter((k): k is GratuityKindConfig => k !== null);

  // Add-ons are first-class now (#491) — the offering attaches existing ones by id, exactly
  // like vesselIds. The checkbox group posts each checked add-on's id.
  const addOnIds = formData.getAll("addOnIds").map(String);

  let code: OfferingErr | null = null;
  if (!variationsParse) code = "bad_variations";
  else {
    try {
      const result = await saveOfferingAdmin(getRepo(), {
        id,
        tenantId: String(TENANT_ID),
        name,
        status,
        description,
        locationId,
        vesselIds,
        schedule,
        basePriceCents,
        extraGuestPriceCents,
        priceVariations,
        gratuityKinds,
        addOnIds,
        ...(tripLengthMinutes !== undefined ? { tripLengthMinutes } : {}),
        ...(holdMinutes !== undefined ? { holdMinutes } : {}),
        ...(arriveBeforeMinutes !== undefined ? { arriveBeforeMinutes } : {}),
        ...(includedGuestCount !== undefined ? { includedGuestCount } : {}),
      });
      code = result.ok ? null : result.code;
    } catch (e) {
      // Never swallow the real cause — the generic "error" copy hides which is which.
      // A common one: the catalog migration isn't applied to this DB (missing column).
      console.error("saveOffering: saveOfferingAdmin threw", e);
      code = "error";
    }
  }

  revalidatePath("/admin/offerings");
  const hidden = formData.get("showHidden") ? "&hidden=1" : "";
  if (code) {
    // Keep what was typed (#699). This is the surface the operator actually lost work on: a
    // refused create redirected to the id minted three lines up, which matches no offering, so
    // the page substituted `visible[0]` and showed an unrelated record's data instead.
    await stashFormDraft("/admin/offerings", formData);
    redirect(`/admin/offerings?sel=${rawId || "new"}${hidden}&err=${code}`);
  }
  await clearFormDraft("/admin/offerings");
  redirect(`/admin/offerings?sel=${id}${hidden}&saved=1`);
}
