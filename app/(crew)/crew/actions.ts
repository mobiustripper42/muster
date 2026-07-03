"use server";

import { cookies } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { recordResponseAndConfirm } from "@core/asks/ask-loop.js";
import {
  randomCode,
  requestLoginCode as mintLoginCode,
  verifyLoginCode as checkLoginCode,
} from "@core/auth/login-code.js";
import { answeredNoticeCode } from "@core/crewapp/answered-code.js";
import { asId } from "@core/domain/ids.js";
import { endSession, readSubject, startSession } from "../../lib/auth";
import { echoLoginCodeForDev, sendLoginCodeEmail } from "../../lib/auth-delivery";
import { selfServeEnabled } from "../../lib/flags";
import {
  LOGIN_EMAIL_COOKIE,
  LOGIN_EMAIL_TTL_S,
  loginCookieOptions,
} from "../../lib/login-cookie";
import { getRepo } from "../../lib/repo";
import {
  SMS_CONSENT_FIELD,
  SMS_CONSENT_FIELD_VALUE,
  SMS_CONSENT_TEXT,
  SMS_CONSENT_VERSION,
} from "../../lib/sms-consent";
import { randomUUID } from "node:crypto";

/**
 * Answer an ask — the In/Out tap (SPEC §2.6.1). Driven by a <form action>, so it
 * works with no client JS. Guards two ways: the caller must hold a crew session,
 * AND the ask must actually be addressed to them (no answering someone else's ask
 * by forging the id). The seat-state race itself is handled downstream by
 * recordResponse's CAS (REQ-CLAIM-1). A winning "in" auto-confirms — `Claimed →
 * Confirmed` in one step (DEC-061), so "in" means committed, no operator gate.
 *
 * Feedback rides a redirect param (codes only, DEC-026), so the tap never lands
 * in silence (#161): an "in" that LOST the CAS race (someone won the seat first)
 * gets an explicit "already filled" notice instead of the card just vanishing.
 * `redirect()` throws by design and stays OUTSIDE the try.
 */
export async function respondToAsk(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") return;

  const askId = String(formData.get("askId") ?? "");
  const response = String(formData.get("response") ?? "");
  if (!askId || (response !== "accepted" && response !== "declined")) return;

  let param: string;
  try {
    const repo = getRepo();
    const ask = await repo.getAsk(asId<"AskId">(askId));
    if (!ask || ask.crewMemberId !== subject.id) {
      param = ""; // not yours (or gone) — silent reload, no notice
    } else {
      const out = await recordResponseAndConfirm(
        repo,
        asId<"AskId">(askId),
        response,
        new Date(),
      );
      // #161: distinct codes per outcome — a lost race, a double-book, and a
      // re-tap each say something different (the crew member isn't always shut out).
      param = `answered=${answeredNoticeCode(response, out)}`;
    }
  } catch (e) {
    console.error("respondToAsk failed", e);
    param = "answered=error";
  }
  redirect(param ? `/crew?${param}` : "/crew");
}

/**
 * Sign out (DEC-081) — drop the session and land on the signed-out front door.
 * Driven by a <form action>, no client JS. Always safe to ship: it only clears
 * the caller's own cookie. `redirect()` throws by design, outside any try.
 */
export async function signOut(): Promise<void> {
  await endSession();
  redirect("/crew");
}

/**
 * Step 1 of self-serve sign-in (DEC-081): take an email, mint+deliver a 6-digit
 * code to a matching roster member, and advance to the code-entry screen.
 *
 * No-enumeration is the load-bearing property: the redirect to `?stage=code` and
 * the screen it renders are IDENTICAL whether or not the email matched — only an
 * actual delivery differs, which the requester can't observe. The entered email
 * rides an httpOnly cookie (never the URL) into step 2. Feedback is codes-only on
 * the URL (DEC-026); `redirect()` stays outside the try.
 */
export async function requestLoginCode(formData: FormData): Promise<void> {
  if (!selfServeEnabled()) redirect("/crew");

  const email = String(formData.get("email") ?? "").trim();
  // SMS opt-in (Twilio 10DLC): voluntary, NEVER gates login — just a checkbox we
  // record if it was ticked. Read before the try so it's in scope for the relay.
  const consented =
    formData.get(SMS_CONSENT_FIELD) === SMS_CONSENT_FIELD_VALUE;
  // A blank submit isn't an enumeration probe — just re-show the email step.
  if (!email) redirect("/crew");

  try {
    const result = await mintLoginCode(
      getRepo(),
      { email },
      { now: new Date(), mintCode: randomCode },
    );
    if (result.outcome === "deliver") {
      const d = {
        crewMemberId: result.subject.id,
        email: result.recipientEmail,
        name: result.recipientName,
        code: result.code,
      };
      echoLoginCodeForDev(d); // non-prod: instant log + dev-code echo
      // Real email runs AFTER the response (Vercel keeps the fn alive). Off the
      // hot path so a match doesn't return slower than a miss — the timing-oracle
      // half of no-enumeration (DEC-081). Errors stay inside the callback.
      after(() => sendLoginCodeEmail(d));
      // Record the SMS opt-in only on a roster match (an unknown email has no
      // number to consent for) and only AFTER the response — same no-enumeration
      // discipline as the email send. Best-effort: swallowed so it never blocks login.
      if (consented) {
        after(() => recordConsentBestEffort(result.subject.id, result.recipientEmail));
      }
    }
  } catch (e) {
    // A delivery/DB hiccup must not reveal more than the generic path — log and
    // fall through to the same code screen (a wrong/absent code just won't verify).
    console.error("requestLoginCode failed", e);
  }

  (await cookies()).set(
    LOGIN_EMAIL_COOKIE,
    email,
    loginCookieOptions(LOGIN_EMAIL_TTL_S),
  );
  redirect("/crew?stage=code");
}

/**
 * Best-effort SMS-consent record (Twilio 10DLC opt-in). Off the hot path (called
 * via `after`, so it can't add a timing signal vs the no-match path) and fully
 * swallowed — a missing table (migration 0017 not yet applied) or any other error
 * must NEVER break login or hold the public page hostage. The stored phone is the
 * roster number the crew member is consenting for ("SMS to my number on file").
 */
async function recordConsentBestEffort(
  crewSubjectId: string,
  email: string,
): Promise<void> {
  try {
    const repo = getRepo();
    const crewMemberId = asId<"CrewMemberId">(crewSubjectId);
    const crew = await repo.getCrewMember(crewMemberId);
    await repo.recordSmsConsent({
      id: asId<"SmsConsentId">(randomUUID()),
      crewMemberId,
      email,
      phone: crew?.phone ?? null,
      disclosureVersion: SMS_CONSENT_VERSION,
      disclosureText: SMS_CONSENT_TEXT,
      consentedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("recordConsentBestEffort failed", e);
  }
}

/**
 * Step 2 of self-serve sign-in (DEC-081): verify the pasted code against the
 * email carried in the cookie. A correct code mints the session; a wrong one
 * counts against the attempt cap. `locked`/`expired` send the crew member back
 * to the start; `invalid` keeps them on the code screen to retry.
 */
export async function verifyLoginCode(formData: FormData): Promise<void> {
  if (!selfServeEnabled()) redirect("/crew");

  const jar = await cookies();
  const email = jar.get(LOGIN_EMAIL_COOKIE)?.value ?? "";
  const code = String(formData.get("code") ?? "").trim();
  if (!email) redirect("/crew");

  // Domain call inside the try; every redirect() (it throws by design) stays
  // OUTSIDE it, or the success redirect would be swallowed as an error.
  let result: Awaited<ReturnType<typeof checkLoginCode>> | null = null;
  try {
    result = await checkLoginCode(getRepo(), { email, code }, { now: new Date() });
  } catch (e) {
    console.error("verifyLoginCode failed", e);
  }

  if (result?.ok) {
    await startSession(result.subject); // cookie write, not a throw
    jar.delete(LOGIN_EMAIL_COOKIE);
    redirect("/crew");
  }

  // A dead code (locked/expired) restarts the flow; a wrong one stays put.
  const reason = result && !result.ok ? result.reason : "invalid";
  if (reason === "locked" || reason === "expired") {
    jar.delete(LOGIN_EMAIL_COOKIE);
    redirect(`/crew?err=${reason}`);
  }
  redirect("/crew?stage=code&err=invalid");
}
