import { redirect } from "next/navigation";

/**
 * `/admin` — lands on the shifts board (#586/#603).
 *
 * This was a hub: a page of link cards plus the engine pause control. It existed because the
 * nav didn't cover everything, and it is exactly why five surfaces went missing — time off,
 * audit, payroll, integrity check and the pause control lived HERE and nowhere else, so they
 * were reachable only if you happened to land on this page. Two menus that each needed hand-
 * editing is how a list drifts; keeping both would have meant maintaining the drift.
 *
 * The nav now carries every surface, grouped by cadence, and the pause control has its own page
 * at `/admin/settings`. That leaves a hub with nothing in it that isn't in the bar above it.
 *
 * It redirects rather than 404s because `/admin` is a real entry point: `app/page.tsx` sends a
 * signed-in admin here, `switch-actions.ts` returns here from the crew app, the not-found route
 * bounces unmatched `/admin/*` here, and it's the URL people have in their history. It goes to
 * the shifts board because that is where the operator works — his words: "i look at the shift
 * board all the time. constantly."
 *
 * No auth gate here on purpose: the redirect target gates itself, like every admin surface
 * (there's no middleware). Gating twice would only change which page renders the signed-out
 * notice.
 */
export default function AdminHome(): never {
  redirect("/admin/shifts");
}
