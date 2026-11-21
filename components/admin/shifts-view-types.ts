/** Shared vocabulary for the all-shifts view and its extracted pieces
 * (`shifts-filter`, `shift-row`). Kept in one place so page.tsx (the
 * orchestrator, which produces both) and the child components agree on the
 * union without importing from each other or from the route file. */

/** View ↔ Edit mode (DEC-083). */
export type Mode = "view" | "edit";

/** The resolved date-window kind — drives the active filter chip + scope label. One home,
 *  `src/admin/date-window.ts` (issue #1142); `past` and `all` are Purchases-only. */
export type { Scope } from "@core/admin/date-window.js";
