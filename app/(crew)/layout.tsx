import type { ReactNode } from "react";
import { ActivityBeacon } from "./components/ActivityBeacon";

/**
 * Crew route-group layout (#117, DEC-071). Adds nothing visual — it mounts the
 * presence/read {@link ActivityBeacon} over every crew page so "this crew member is
 * in the app" (and "reading this thread") is recorded on real human view. Scoped to
 * the (crew) group: admin pages live in (admin) and don't get it (operator presence
 * is 6.8). Route handlers (dev-link, auth, activity) aren't pages, so they don't
 * render this and won't self-trigger the beacon.
 */
export default function CrewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ActivityBeacon />
    </>
  );
}
