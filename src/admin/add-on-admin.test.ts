/**
 * saveAddOnAdmin (#491) — validation, the create/edit upsert, active toggle, and the
 * preserve-tenant-on-edit contract. Mirrors vessel-admin.test.ts.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { AddOn } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { saveAddOnAdmin } from "./add-on-admin.js";

const base = {
  id: "addon-new",
  tenantId: "tenant-brewboat",
  label: "Extra hour",
  amountCents: 15000,
  required: false,
  active: true,
};

describe("saveAddOnAdmin — validation", () => {
  it("rejects a blank label", async () => {
    const r = await saveAddOnAdmin(new InMemoryRepository(), { ...base, label: "  " });
    expect(r).toEqual({ ok: false, code: "name_required" });
  });

  it("rejects a non-integer or negative amount", async () => {
    for (const amountCents of [-1, 150.5, NaN]) {
      const r = await saveAddOnAdmin(new InMemoryRepository(), { ...base, amountCents });
      expect(r).toEqual({ ok: false, code: "bad_amount" });
    }
  });
});

describe("saveAddOnAdmin — persistence", () => {
  it("accepts a create — trims the label, stores the globals, defaults type flat", async () => {
    const repo = new InMemoryRepository();
    const r = await saveAddOnAdmin(repo, { ...base, label: "  Extra hour  ", required: true });
    expect(r).toEqual({ ok: true, id: "addon-new" });
    const saved = await repo.getAddOn(asId<"AddOnId">("addon-new"));
    expect(saved).toMatchObject({
      label: "Extra hour",
      type: "flat",
      amountCents: 15000,
      required: true,
      active: true,
      tenantId: "tenant-brewboat",
    });
  });

  it("edits are an upsert — a zero amount is valid (a free add-on)", async () => {
    const repo = new InMemoryRepository();
    await saveAddOnAdmin(repo, base);
    const r = await saveAddOnAdmin(repo, { ...base, label: "Welcome kit", amountCents: 0 });
    expect(r.ok).toBe(true);
    const saved = await repo.getAddOn(asId<"AddOnId">("addon-new"));
    expect(saved).toMatchObject({ label: "Welcome kit", amountCents: 0 });
    expect(await repo.listAddOns()).toHaveLength(1); // upsert, not insert
  });

  it("retire is an active flip, not a delete — the row survives", async () => {
    const repo = new InMemoryRepository();
    await saveAddOnAdmin(repo, base);
    const r = await saveAddOnAdmin(repo, { ...base, active: false });
    expect(r.ok).toBe(true);
    const saved = await repo.getAddOn(asId<"AddOnId">("addon-new"));
    expect(saved?.active).toBe(false);
    expect(saved?.label).toBe("Extra hour"); // everything else kept
  });

  it("preserves the existing row's tenant on an edit (the form never carries it)", async () => {
    const repo = new InMemoryRepository();
    const otherTenant = asId<"TenantId">("tenant-other");
    const existing: AddOn = {
      id: asId<"AddOnId">("addon-1"),
      tenantId: otherTenant,
      label: "Old",
      type: "flat",
      amountCents: 100,
      required: false,
      active: true,
    };
    await repo.saveAddOn(existing);

    const r = await saveAddOnAdmin(repo, { ...base, id: "addon-1", label: "New" });
    expect(r.ok).toBe(true);
    const saved = await repo.getAddOn(existing.id);
    expect(saved?.label).toBe("New");
    expect(saved?.tenantId).toBe(otherTenant); // NOT the caller's tenant-brewboat
  });
});
