import { EmailChannel } from "@core/adapters/email-channel.js";
import { asId } from "@core/domain/ids.js";
import { isProdDeploy } from "./flags";

/**
 * Login-code delivery seam (DEC-081) — server-only (no client import).
 *
 * Two paths, deliberately split so neither blocks nor leaks:
 *  - `echoLoginCodeForDev` — the non-prod log + `/crew/dev-code` echo. Synchronous
 *    and gated to non-prod, so the e2e round-trip stays deterministic and no live
 *    credential ever lands in a production log.
 *  - `sendLoginCodeEmail` — the real Resend send (7.0b). A no-op when email isn't
 *    configured, so dev/e2e fall back to the echo with no key. The caller runs it
 *    via `after()` (post-response), NOT awaited on the hot path — a network send
 *    that fires only on a roster match would otherwise make a match observably
 *    slower than a miss (a timing oracle the response-body symmetry can't hide).
 */
export interface LoginCodeDelivery {
  crewMemberId: string;
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

/** Non-prod dev/e2e affordance: log + echo the code so the round-trip is
 *  observable (the hash-only store can't reveal it). Gated to non-prod, so a
 *  prod flag-flip can never write a live credential to a production log. */
export function echoLoginCodeForDev(d: LoginCodeDelivery): void {
  if (isProdDeploy()) return;
  console.log(`[login-code] → ${d.name} <${d.email}>: ${d.code}`);
  lastCodeByEmail.set(d.email.trim().toLowerCase(), d.code);
}

interface EmailEnv {
  apiKey: string;
  from: string;
}

/** Resend config, or null when unset — null ⇒ no real send (dev/e2e fall back to
 *  the echo). Both vars required together; a half-config is treated as unset. */
export function readEmailEnv(): EmailEnv | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  return apiKey && from ? { apiKey, from } : null;
}

/** The real send (7.0b). No-op when email isn't configured. Run via `after()` —
 *  never awaited on the request hot path (see the timing note above). */
export async function sendLoginCodeEmail(d: LoginCodeDelivery): Promise<void> {
  const env = readEmailEnv();
  if (!env) {
    // In prod with the flag ON, a missing or half-set config means the crew
    // member sees "check your email" but nothing ever sends. The both-or-nothing
    // no-op is the safe behavior (never half-send), but make the misconfig
    // VISIBLE — it runs in after() (off the hot path), gated so dev/e2e stay quiet.
    if (isProdDeploy()) {
      console.error(
        "[login-code] email send skipped — set RESEND_API_KEY and EMAIL_FROM",
      );
    }
    return;
  }

  const channel = new EmailChannel({ apiKey: env.apiKey, from: env.from });
  try {
    await channel.send({
      to: { crewMemberId: asId<"CrewMemberId">(d.crewMemberId), email: d.email },
      kind: "magic_link",
      body:
        `Hi ${d.name},\n\n` +
        `Your Muster sign-in code is ${d.code}.\n\n` +
        `It expires in 10 minutes. If you didn't request it, you can ignore this email.\n\n` +
        `— Muster`,
    });
  } catch (e) {
    // Runs in after(), so a failure never reaches the crew member's response.
    // Log a CONTROLLED line — crewMemberId + reason, never the code or body —
    // instead of letting Next dump the raw rejection.
    console.error(
      `[login-code] email send failed for ${d.crewMemberId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}
