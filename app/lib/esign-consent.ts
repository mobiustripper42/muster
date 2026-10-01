/**
 * The e-sign consent on the waiver signing page (Phase 18.4) — one short line beside the checkbox,
 * and the operator's full consent text behind "What does this mean?" (spec §A1: one checkbox, the
 * long form behind a link).
 *
 * `ESIGN_CONSENT_TEXT` is the operator's current wording, word for word (operator, 2026-09-30:
 * "this is what we are currently showing"). Only its placement changed. It is legal text: change it
 * deliberately, and the change is on the record in this file's history — the same way the SMS
 * opt-in wording lives in `sms-consent.ts`.
 */

/** Beside the checkbox. */
export const ESIGN_CONSENT_LINE = "I agree to sign electronically instead of on paper.";

/** Behind "What does this mean?". Verbatim. */
export const ESIGN_CONSENT_TEXT =
  "By checking here, you are consenting to the use of your electronic signature in lieu of an " +
  "original signature on paper. You have the right to request that you sign a paper copy instead. " +
  "By checking here, you are waiving that right. After consent, you may, upon written request to " +
  "us, obtain a paper copy of an electronic record. No fee will be charged for such copy and no " +
  "special hardware or software is required to view it. Your agreement to use an electronic " +
  "signature with us for any documents will continue until such time as you notify us in writing " +
  "that you no longer wish to use an electronic signature. There is no penalty for withdrawing your " +
  "consent. You should always make sure that we have a current email address in order to contact " +
  "you regarding any changes, if necessary.";
