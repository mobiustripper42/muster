import type { NextRequest } from "next/server";
import { stripTrailingSlashes } from "@core/config/base-url.js";

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
