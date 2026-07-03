/**
 * SMS consent disclosure — Twilio 10DLC opt-in (BrewBoat campaign vetting).
 *
 * Shown UNCHECKED on the public crew login page (`app/(crew)/crew/page.tsx`,
 * `SmsConsentBlock`). The plain-text `SMS_CONSENT_TEXT` is what gets STORED with
 * each opt-in (`sms_consent` table) so future wording changes stay auditable —
 * **bump `SMS_CONSENT_VERSION` whenever `SMS_CONSENT_TEXT` changes.**
 *
 * The login UI renders these same words with "Privacy Policy" and "Terms" linked
 * to `SMS_CONSENT_POLICY_URL`; the two must stay in sync (the copy below is the
 * source of truth for the stored record).
 */

/** Bump on any wording change so stored consents pin the version they agreed to. */
export const SMS_CONSENT_VERSION = "v1";

/** Privacy Policy + Terms both point here (per the BrewBoat handoff). */
export const SMS_CONSENT_POLICY_URL = "https://www.brewcle.com/privacy-policy/";

/** The verbatim disclosure, frozen at this version — the exact string stored on opt-in. */
export const SMS_CONSENT_TEXT =
  "I agree to receive SMS text messages from Cleveland Cycleboats, LLC (BrewBoat) " +
  "at the mobile number on my crew record about shift availability and scheduling. " +
  "Message frequency varies. Message and data rates may apply. Reply STOP to opt out, " +
  "HELP for help. See our Privacy Policy and Terms.";

/** The checkbox's checked value — `formData.get("sms_consent") === SMS_CONSENT_FIELD_VALUE`. */
export const SMS_CONSENT_FIELD = "sms_consent";
export const SMS_CONSENT_FIELD_VALUE = "yes";
