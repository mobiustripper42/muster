import { asId } from "@core/domain/ids.js";
import type { TenantId } from "@core/domain/ids.js";

/**
 * The active tenant's id (#117, DEC-071).
 *
 * Threads are tenant-scoped — their deterministic ids embed the tenant
 * (`standingThreadId` / `dmThreadId`) — so the first surface to *construct* a
 * thread id (the crew messaging UI) is the first to need this app-side. Held the
 * same way as `OPERATOR_CREW_MEMBER_ID`: one documented, env-overridable VALUE,
 * not a lookup — the single-subject, single-tenant posture (DEC-020). A
 * tenant-config table is a multi-tenant-era concern. The dev default matches the
 * seeds (`tenant-brewboat`).
 */
export const TENANT_ID: TenantId = asId<"TenantId">(
  process.env.TENANT_ID ?? "tenant-brewboat",
);
