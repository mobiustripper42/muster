"use client";

import { useEffect } from "react";

/**
 * Strips one-shot feedback query params off /admin/import after first render
 * (#121, DEC-055). The server still renders the pull result / error from the
 * redirect params (codes-only → mapped to copy server-side, so DEC-026's
 * no-prose-in-the-URL security holds); this just cleans the address bar so the
 * code doesn't sit there or re-render on reload. A contained client island — the
 * only no-middleware way to clear a param post-render in the App Router. The
 * import page's only params are feedback (xpull/xerr/counts), so clearing them
 * all is safe; navigational params (none here) would need to be preserved.
 */
export function ClearFeedbackParams() {
  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  return null;
}
