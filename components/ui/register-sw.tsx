"use client";

import { useEffect } from "react";

/**
 * Registers the minimal service worker (`public/sw.js`) — required for the PWA
 * install prompt on Android Chrome (#391). Client-only island; with JS off it's a
 * no-op (the SW just doesn't register, nothing else changes). Best-effort: a
 * registration failure is swallowed — it must never affect the page.
 */
export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
