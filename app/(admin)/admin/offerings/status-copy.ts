import type { Offering } from "@core/domain/entities.js";

/**
 * Offering status → label + pill classes (DEC-123).
 *
 * **Its own module on purpose (#699).** This used to live in `offering-sections.tsx` and be
 * re-exported from there. When those sections became `"use client"`, the server-rendered page
 * header and sidebar kept importing this from a client module — and got `undefined` back, so
 * `STATUS_COPY[status].pill` threw on every render. Plain data crossing out of a client module
 * into a Server Component is not a supported direction; only components come back as references.
 *
 * The symptom is worth remembering because it looks nothing like its cause: a TypeError about
 * `.pill` on a page whose only change was adding a directive to a different file.
 */
export const STATUS_COPY: Record<Offering["status"], { label: string; pill: string }> = {
  draft: { label: "Draft", pill: "border-line bg-bg text-muted" },
  live: { label: "Live", pill: "border-ok-line bg-ok-bg text-ok" },
  hidden: { label: "Hidden", pill: "border-warn-line bg-warn-bg text-warn" },
};
