/**
 * The pending-email cookie (DEC-080) — one source of truth for the wire contract
 * between the request action (writes it) and the signed-out page (reads it). A
 * bare literal in two places would silently desync on a rename.
 *
 * Carries the entered email across the request→verify step so it never rides the
 * URL. httpOnly, short-lived (matches the code TTL).
 */
export const LOGIN_EMAIL_COOKIE = "muster_login_email";
export const LOGIN_EMAIL_TTL_S = 600;

export function loginCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
