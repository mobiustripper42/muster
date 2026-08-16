/**
 * The checkout holder token (#575) — who a checkout hold belongs to.
 *
 * **Why possession and not identity.** The first cut of this keyed hold reuse on the buyer's
 * email or phone, so that a customer retrying a declined card got their own boat back instead of
 * taking a second one. `/security-review` killed it: those fields are typed into a public,
 * unauthenticated form, so "who I am" was whatever the submitter said it was. Two exploits fell
 * straight out — supply a victim's email and you were handed *their* hold and a PaymentIntent on
 * the boat they were buying; supply it with an absurd guest count and the fit-revalidation branch
 * deleted their hold outright. A stranger's email address is not a secret, and it was the entire
 * authorization check.
 *
 * So the hold belongs to a **browser session**, proven by holding an opaque token, not to a
 * claimed identity. Knowing someone's email buys nothing; you would have to steal their cookie,
 * at which point their hold is the least of it.
 *
 * The token is meaningless on its own — it identifies nothing, links to nothing, and expires with
 * the hold it guards. It is deliberately NOT the customer identity: `customers/identity.ts` still
 * owns that, and the two must not be conflated again.
 */

import { randomBytes } from "node:crypto";

/** 32 bytes of CSPRNG as base64url. Sized like a session id, because that is what it is —
 *  guessing one lets you take over a stranger's in-flight checkout. */
export function mintHolderToken(bytes: (n: number) => Buffer = randomBytes): string {
  return bytes(32).toString("base64url");
}

/** Anchored — a token is exactly what `mintHolderToken` emits, or it is not a token. Keeps a
 *  crafted cookie from reaching the comparison as a lookalike. */
const HOLDER_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isHolderToken(value: string | undefined | null): boolean {
  return typeof value === "string" && HOLDER_TOKEN_RE.test(value);
}
