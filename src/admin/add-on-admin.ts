/**
 * Add-on admin upsert (#491) — the validated write door behind the /admin/add-ons settings
 * screen. Same `{ ok }`-result idiom as `saveVesselAdmin`/`saveLocationAdmin`: framework-free,
 * string-union error codes the server action maps to copy.
 *
 * An AddOn is a first-class entity (like Vessel/Location): a sellable extra (extra hour,
 * catering, photos) edited once here and ATTACHED to offerings by id. `required` is a GLOBAL
 * property of the add-on (not a per-offering setting); `active` is the DEC-123 soft-retire flag
 * — `false` drops it from the offering picker + browse, references kept. No create/edit flag —
 * the action mints an id for a create, reuses it for an edit; the tenant is preserved on edit.
 * No hard delete — retire via `active=false`.
 */
import type { AddOn } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

export interface AddOnAdminInput {
  /** The add-on id — the action mints a fresh one for a create, reuses it for an edit. */
  id: string;
  /** The owning tenant for a CREATE; an edit preserves the existing row's tenant. */
  tenantId: string;
  label: string;
  /** Integer cents (the action converts dollars → cents); must be non-negative. */
  amountCents: number;
  required: boolean;
  active: boolean;
}

export type AddOnSaveResult = { ok: true; id: string } | { ok: false; code: AddOnSaveError };
export type AddOnSaveError = "name_required" | "bad_amount";

export async function saveAddOnAdmin(
  repo: Repository,
  input: AddOnAdminInput,
): Promise<AddOnSaveResult> {
  const label = input.label.trim();
  if (!label) return { ok: false, code: "name_required" };
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    return { ok: false, code: "bad_amount" };
  }

  const id = asId<"AddOnId">(input.id);
  // Preserve the one field the form doesn't carry: an edit keeps the row's tenant.
  const existing = await repo.getAddOn(id);

  const addOn: AddOn = {
    id,
    tenantId: existing?.tenantId ?? asId<"TenantId">(input.tenantId),
    label,
    type: "flat",
    amountCents: input.amountCents,
    required: input.required,
    active: input.active,
  };
  await repo.saveAddOn(addOn);
  return { ok: true, id: input.id };
}
