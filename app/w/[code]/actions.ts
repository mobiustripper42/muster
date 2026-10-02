"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { vesselDateOf } from "@core/config/tenant.js";
import {
  loadSigningScene,
  MAX_CHILDREN,
  partyFor,
  SIGNING_LIMIT,
  signAndSave,
  type DateParts,
  type SigningError,
  type SigningForm,
} from "@core/checkin/signing.js";
import { normalizeTripCode, resolveTripLink } from "@core/checkin/trip-link.js";
import { limitKeyFor, takeRateLimit } from "@core/rate-limit/rate-limit.js";
import { clientIpFrom } from "../../lib/client-ip";
import { clearFormDraft, stashFormDraft } from "../../lib/form-draft";
import { getRepo } from "../../lib/repo";
import { logSwallowed } from "../../lib/swallowed";
import { ADD_CHILD, REMOVE_CHILD } from "./child-intent";

/** Every code the sign action can put in `?err=` — the core's refusals plus the two minted here. */
export type SignErr = SigningError | "throttled" | "error";

/** The four fields every child card posts, once per card, in card order. */
const CHILD_FIELDS = ["childName", "childMonth", "childDay", "childYear"] as const;

/**
 * Sign the waiver (Phase 18.4, issue #1118). Order: **limit, then the trip, then the rules**.
 *
 * - Over the per-connection limit (DEC-189), nothing is looked up and the form comes back with
 *   everything typed.
 * - A trip that is no longer open (sailed, cancelled, gone) goes back to the page, which says so.
 * - Every rule is `signAndSave`'s (`src/checkin/signing.ts`). A refusal comes back with everything
 *   typed (the form-draft, DEC-147).
 *
 * "+ Add a minor" and Remove land here too when the browser runs no JS (the `ChildCards` island
 * handles them otherwise). They write nothing, so they come before the limit.
 *
 * Never logs the trip code or anything the guest typed. `redirect()` throws, so it stays outside
 * every try (house convention).
 */
export async function signWaiver(formData: FormData): Promise<void> {
  const code = normalizeTripCode(String(formData.get("code") ?? ""));
  if (!code) redirect("/");
  const surface = `/w/${code}`;

  // The pick rides every redirect back to the form. A pick that no longer resolves stays too:
  // dropping it would let a departure now down to one booking fill that booking in silently — the
  // swap `partyFor` refuses — so the page shows the party step again instead.
  const party = String(formData.get("party") ?? "");
  const back = (extra: Record<string, string>) =>
    `${surface}?${new URLSearchParams({ ...(party ? { party } : {}), ...extra }).toString()}`;

  // ── Child cards without JS: add or remove one, sign nothing ─────────────────────────────────
  // The whole form comes back through the same draft a refusal uses, so nothing typed is lost,
  // and `restore=1` tells the page to read it.
  const intent = String(formData.get("intent") ?? "");
  if (intent === ADD_CHILD || intent.startsWith(REMOVE_CHILD)) {
    editChildCards(formData, intent);
    await stashFormDraft(surface, formData);
    redirect(back({ restore: "1" }));
  }

  const h = await headers();
  const ip = clientIpFrom(h);
  const repo = getRepo();
  const now = new Date().toISOString();

  let outcome: { signed: string } | { err: SignErr } | { gone: true };
  try {
    const limit = await takeRateLimit(
      { repo, now: () => now, onFailure: (m) => console.error(`signWaiver: ${m}`) },
      SIGNING_LIMIT,
      limitKeyFor(ip),
    );
    if (!limit.allowed) {
      outcome = { err: "throttled" };
    } else {
      const trip = await resolveTripLink(repo, code, now);
      if (trip.state !== "open") {
        outcome = { gone: true };
      } else {
        const scene = await loadSigningScene(repo, trip.trip.eventId, now);
        const booking = partyFor(scene.reservations, party || undefined);
        if (booking === "choose") {
          // Several parties and none chosen (or one no longer booked): ask again, write nothing.
          outcome = { err: "bad_party" };
        } else {
          const result = await signAndSave(repo, readForm(formData, booking), {
            eventId: trip.trip.eventId,
            template: scene.template,
            ageOfMajority: scene.ageOfMajority,
            today: vesselDateOf(new Date(now)),
            now,
            bookedReservationIds: scene.reservations.map((r) => r.id),
            ip: ip ?? undefined,
            userAgent: h.get("user-agent")?.slice(0, 512) || undefined,
            newId: () => `guest-${randomUUID()}`,
          });
          outcome = result.ok ? { signed: String(result.signer.id) } : { err: result.code };
        }
      }
    }
  } catch (e) {
    logSwallowed("w/[code]:signWaiver", e, "a waiver signing was not saved");
    outcome = { err: "error" };
  }

  if ("gone" in outcome) redirect(surface);
  if ("signed" in outcome) {
    await clearFormDraft(surface);
    redirect(`${surface}?signed=${encodeURIComponent(outcome.signed)}`);
  }
  // A changed waiver must be agreed to again: the tick was for the old words, so it is not kept.
  if (outcome.err === "waiver_changed") formData.delete("consent");
  await stashFormDraft(surface, formData);
  // bad_party lands on the party step (the page asks again); its links carry `restore=1`, so the
  // form the guest lands on next is refilled from the draft.
  redirect(back({ err: outcome.err }));
}

/**
 * Add a blank child card, or remove the one at a position, in the posted form itself — what the
 * island does in the browser. A position the form did not render is a crafted post, and removes
 * nothing. Never past ten cards: the form stops offering the button there.
 */
function editChildCards(formData: FormData, intent: string): void {
  const columns = CHILD_FIELDS.map((f) => formData.getAll(f).map(String));
  const count = columns[0]?.length ?? 0;
  if (intent === ADD_CHILD) {
    if (count < MAX_CHILDREN) for (const c of columns) c.push("");
  } else {
    const at = Number(intent.slice(REMOVE_CHILD.length));
    if (Number.isInteger(at) && at >= 0 && at < count) for (const c of columns) c.splice(at, 1);
  }
  CHILD_FIELDS.forEach((f, i) => {
    formData.delete(f);
    for (const v of columns[i]!) formData.append(f, v);
  });
  formData.delete("intent");
}

/** A select left on its placeholder arrives as "", which must read as missing, not as 0. */
function num(v: string | undefined): number {
  return v === undefined || v === "" ? Number.NaN : Number(v);
}

function dateParts(year: string | undefined, month: string | undefined, day: string | undefined): DateParts {
  return { year: num(year), month: num(month), day: num(day) };
}

function readForm(formData: FormData, reservationId: SigningForm["reservationId"]): SigningForm {
  const text = (k: string) => String(formData.get(k) ?? "");
  const all = (k: string) => formData.getAll(k).map(String);
  // One entry per child card, in order. More than ten is passed on, not cut, so the core refuses
  // it (bad_kids_count) instead of this quietly dropping a card.
  const names = all("childName").slice(0, MAX_CHILDREN + 1);
  const [months, days, years] = [all("childMonth"), all("childDay"), all("childYear")];
  return {
    reservationId,
    // The version the form showed — checked against the one in force (`waiver_changed`).
    shownTemplateId: text("templateId"),
    adult: {
      name: text("name"),
      legalNameConfirmed: formData.get("legalName") === "yes",
      dob: dateParts(text("dobYear"), text("dobMonth"), text("dobDay")),
      email: text("email"),
      phone: text("phone"),
    },
    children: names.map((name, i) => ({ name, dob: dateParts(years[i], months[i], days[i]) })),
    consent: formData.get("consent") === "yes",
  };
}
