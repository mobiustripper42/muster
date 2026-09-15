import type { NextRequest } from "next/server";
import { stripTrailingSlashes } from "@core/config/base-url.js";
import { isProdDeploy } from "@core/config/deploy.js";

/**
 * The base URL for a link we are about to DELIVER, with no request in hand (#1007).
 *
 * **The question this answers once.** Six sites needed the trusted public origin on a cron,
 * webhook or server-action path — no `NextRequest`, so `baseUrl(req)` below is unavailable — and
 * each invented its own answer to an unset `APP_BASE_URL`. Five different answers: `alert.ts`
 * threw at one site and fell back to localhost at two others, `booking-confirmation.ts` skipped
 * the send at one site and returned `not_configured` at another, `sold-out-notice.ts` disabled
 * SMS and let email go. Same disease as #955 in the same three files, different variable.
 *
 * **Unset is not a misconfiguration — it is the designed state on a preview.** `APP_BASE_URL` is
 * scoped to Production only (DEC-057) so a preview's minted links resolve to the preview rather
 * than to prod, which is what DEC-057 paired the scoping with. Issue #1007 proposed
 * two branches, fatal in prod and localhost in dev, and that has no correct answer for the
 * environment where the variable is *supposed* to be missing. Hence four branches, three
 * environments.
 *
 * **`VERCEL_URL`, never the `Host` header, on the preview branch.** These callers have no request
 * to read, and `env.example:12-14` already makes the point: the cron runs with no Host header, so
 * a Host fallback is wrong exactly where nobody is watching. `VERCEL_URL` is set by the platform
 * rather than the client, so it carries none of the poisoning risk `baseUrl(req)` guards against
 * below. It was unused in this repo before this function.
 *
 * **Why prod throws rather than degrading.** A production deploy that cannot build a correct link
 * is broken, not degraded — every one of the six callers exists to deliver a link, so the same
 * deploy is silently dropping customer booking confirmations. Two `alert.ts` comments argued that
 * taking an alert down to protect a hyperlink is the wrong trade when the alert means a trip is
 * uncrewed, and that argument was right about the case it faced: before the preview branch
 * existed, an unset variable was reachable in ordinary use. It no longer is. The only remaining
 * unset-in-prod case is a broken deploy, and the throw lands somewhere harmless — the tick route
 * wraps both alert legs in their own best-effort `try`, so the cron still answers 200 and logs
 * the cause.
 *
 * Read at CALL time, not module load, for the same reason `isProdDeploy` is: a value frozen at
 * import is wrong in any process whose env is assembled after the module graph loads.
 */
export function appBaseUrl(): string {
  const configured = stripTrailingSlashes(process.env.APP_BASE_URL);
  if (configured) return configured;

  if (isProdDeploy()) {
    throw new Error(
      "APP_BASE_URL must be set on a production deploy — every delivered link would be wrong, " +
        "and there is no request Host to fall back on (env.example, DEC-057).",
    );
  }

  // Preview: point at this deployment, not at prod and not at a localhost nobody can reach.
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return stripTrailingSlashes(`https://${vercelUrl}`);

  return "http://localhost:3000";
}

/**
 * The externally-reachable base URL for building links that get DELIVERED to
 * users (magic links). Prefers the trusted `APP_BASE_URL` env; falls back to the
 * request `Host` header for zero-config local dev.
 *
 * SECURITY: the `Host` header is client-controlled. For any link that gets
 * delivered (emailed/texted), an attacker who can set `Host: evil.com` would have
 * us mint `evil.com/crew/auth?t=<token>` → tap → token theft (the classic
 * host-header / password-reset poisoning). So **production must set
 * `APP_BASE_URL`** to the real origin; the Host-header fallback is dev-only
 * convenience. Today the only caller is the dev-only link issuer (404 in prod),
 * but the real "issue + send the link" path (1.5b+) MUST route through here with
 * `APP_BASE_URL` set so the delivered link can't be host-spoofed.
 */
export function baseUrl(req: NextRequest): string {
  const configured = process.env.APP_BASE_URL;
  if (configured) return stripTrailingSlashes(configured);
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}
