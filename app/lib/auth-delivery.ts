import { isProdDeploy } from "./flags";

/**
 * Login-code delivery seam (DEC-081) — server-only (no client import). 7.0a
 * delivers through the fake channel: the code is logged + echoed (non-prod only),
 * not emailed — exactly how the magic link is "delivered" in dev
 * (fake-channel.ts). 7.0b swaps the BODY of `deliverLoginCode` for an
 * `EmailChannel` (Resend over `fetch`, `EMAIL_FROM` on a DKIM-verified
 * `crew.brewcle.com`); the signature is the stable seam, so the action above it
 * never changes.
 *
 * 7.0b TIMING (enumeration): the real email send must NOT be `await`ed on the
 * request hot path — a network call that runs only on a roster match makes a
 * match observably slower than a miss (a timing oracle the response-body
 * symmetry can't hide). Fire-and-forget / enqueue the send, and/or do equivalent
 * throwaway work on the miss path. See requestLoginCode + the code-review note.
 */
export interface LoginCodeDelivery {
  email: string;
  name: string;
  code: string;
}

/**
 * Dev-only echo of the last code per email — the `/crew/dev-code` route reads it
 * so e2e (and a dev by hand) can complete the round-trip the hash-only store
 * can't reveal. Same risk class + gating as the dev-link issuer (404 in prod).
 * Module-level state, fine in the single-process `next dev`/preview; meaningless
 * in prod (where the flag is off and the echo route 404s anyway).
 */
// On globalThis, NOT a module-level const: Next bundles the action and the
// /crew/dev-code route separately, so a plain module singleton would give each
// its own Map and the echo would always read empty. globalThis is shared across
// bundles in the one dev/preview process.
const lastCodeByEmail: Map<string, string> = ((
  globalThis as { __loginCodeEcho?: Map<string, string> }
).__loginCodeEcho ??= new Map());

export function peekLastLoginCode(email: string): string | undefined {
  return lastCodeByEmail.get(email.trim().toLowerCase());
}

export async function deliverLoginCode(d: LoginCodeDelivery): Promise<void> {
  // 7.0b: the real email send goes HERE (runs in every environment).

  // Non-prod dev/e2e affordance: log + echo the code so the round-trip is
  // observable (the hash-only store can't reveal it). BOTH side-effects gated to
  // non-prod, so a 7.0b prod flag-flip that lands before the real send is wired
  // can never write a live credential to a production log. Same gate as the
  // /crew/dev-code route reads against.
  if (!isProdDeploy()) {
    // eslint-disable-next-line no-console
    console.log(`[login-code] → ${d.name} <${d.email}>: ${d.code}`);
    lastCodeByEmail.set(d.email.trim().toLowerCase(), d.code);
  }
}
