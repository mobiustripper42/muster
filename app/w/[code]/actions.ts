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
  type SigningError,
  type SigningForm,
  type SigningPath,
} from "@core/checkin/signing.js";
import { normalizeTripCode, resolveTripLink } from "@core/checkin/trip-link.js";
import { limitKeyFor, takeRateLimit } from "@core/rate-limit/rate-limit.js";
import { clientIpFrom } from "../../lib/client-ip";
import { clearFormDraft, stashFormDraft } from "../../lib/form-draft";
import { getRepo } from "../../lib/repo";
import { logSwallowed } from "../../lib/swallowed";

/** Every code the sign action can put in `?err=` — the core's refusals plus the two minted here. */
export type SignErr = SigningError | "throttled" | "error";

/**
 * Sign the waiver (Phase 18.4, issue #1118). Order: **limit, then the trip, then the rules**.
 *
 * - Over the per-connection limit (DEC-189), nothing is looked up and the form comes back with
 *   everything typed.
 * - A trip that is no longer open (sailed, cancelled, gone) goes back to the page, which says so.
 * - Every rule is `signAndSave`'s (`src/checkin/signing.ts`). A refusal comes back with everything
 *   typed (the form-draft, DEC-147).
 *
 * Never logs the trip code or anything the guest typed. `redirect()` throws, so it stays outside
 * every try (house convention).
 */
export async function signWaiver(formData: FormData): Promise<void> {
  const code = normalizeTripCode(String(formData.get("code") ?? ""));
  if (!code) redirect("/");
  const surface = `/w/${code}`;

  const path = readPath(formData.get("for"));
  const party = String(formData.get("party") ?? "");
  const kids = path === "me" ? 0 : readKids(formData.get("kids"));
  const stepQuery = (extra: string) => {
    const q = new URLSearchParams();
    if (path) q.set("for", path);
    if (party) q.set("party", party);
    if (kids) q.set("kids", String(kids));
    return `${surface}?${q.toString()}${q.size ? "&" : ""}${extra}`;
  };
  if (!path) redirect(surface);

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
          const result = await signAndSave(repo, readForm(formData, path, kids, booking), {
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
  // A party that no longer resolves goes back to the party step. The stale pick stays in the URL:
  // dropping it would let a departure now down to one booking fill that booking in silently — the
  // swap `partyFor` refuses. The kid count is kept, and the party links there carry `restore=1`,
  // so the form the guest lands on next is refilled from the draft.
  if (outcome.err === "bad_party") {
    const q = new URLSearchParams({ for: path, party, err: "bad_party" });
    if (kids) q.set("kids", String(kids));
    redirect(`${surface}?${q.toString()}`);
  }
  redirect(stepQuery(`err=${outcome.err}`));
}

function readPath(raw: FormDataEntryValue | null): SigningPath | null {
  return raw === "me" || raw === "kids" || raw === "child" ? raw : null;
}

function readKids(raw: FormDataEntryValue | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_CHILDREN ? n : 0;
}

/** A select left on its placeholder arrives as "", which must read as missing, not as 0. */
function num(formData: FormData, key: string): number {
  const v = String(formData.get(key) ?? "");
  return v === "" ? Number.NaN : Number(v);
}

function readForm(
  formData: FormData,
  path: SigningPath,
  kids: number,
  reservationId: SigningForm["reservationId"],
): SigningForm {
  const text = (k: string) => String(formData.get(k) ?? "");
  return {
    path,
    reservationId,
    // The version the form showed — checked against the one in force (`waiver_changed`).
    shownTemplateId: text("templateId"),
    adult: {
      name: text("name"),
      legalNameConfirmed: formData.get("legalName") === "yes",
      dob: { year: num(formData, "dobYear"), month: num(formData, "dobMonth"), day: num(formData, "dobDay") },
      email: text("email"),
      phone: text("phone"),
    },
    children: Array.from({ length: kids }, (_, i) => ({
      name: text(`childName${i}`),
      dob: { year: num(formData, `childYear${i}`), month: num(formData, `childMonth${i}`), day: num(formData, `childDay${i}`) },
    })),
    consent: formData.get("consent") === "yes",
  };
}
