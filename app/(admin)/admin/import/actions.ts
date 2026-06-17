"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formShifts } from "@core/builder/form-shifts.js";
import { importReservations } from "@core/import/import-reservations.js";
import { readXlsxSheet } from "@core/import/xlsx-extract.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/** A week of Xola reservations is tiny; this is the upload hard cap (DEC-037). */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Every .xlsx is a zip — "PK\x03\x04". Checked on the bytes, never the extension. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/**
 * Import a Xola **Reservations** .xlsx (5.4a, DEC-037). Single-step: parse →
 * `importReservations` (events + reservations) → `formShifts` (shifts + seats) →
 * the board is live. Admin-gated; the file is parsed **server-side in memory**
 * (no temp file, never reaches the client). Idempotent — re-importing a week
 * updates in place, never duplicates.
 *
 * Feedback rides redirect params as CODES/counts only (DEC-026): a crafted URL
 * can't inject text into Spink's surface. Quarantined product **names** go to
 * server logs for the dev — there's no operator product-mapping UI to act on them,
 * so the visible "N skipped" count + the dev's log read is the pilot answer.
 */
export async function runImport(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin/import");

  // Upload guards run before any parse. redirect() throws, so these early-outs
  // never fall through.
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect("/admin/import?err=no_file");
  if (file.size > MAX_UPLOAD_BYTES) redirect("/admin/import?err=too_big");

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length < 4 || !ZIP_MAGIC.every((b, i) => buf[i] === b)) {
    redirect("/admin/import?err=bad_type");
  }

  // redirect() works by throwing, so it lives OUTSIDE the try — only parse/import
  // is guarded (a bad zip or repo outage → a mapped notice, not a 500).
  let params: string;
  try {
    const rows = readXlsxSheet(buf, "Reservations");
    const repo = getRepo();
    const now = new Date();
    const imp = await importReservations(repo, rows, now);
    const form = await formShifts(repo, { now });

    // The quarantine list goes to server logs (Vercel function logs) for the dev;
    // the operator can't remap a product from the UI, so names off the surface.
    if (imp.skipped.length) {
      console.warn(
        `[import] ${imp.skipped.length} row(s) skipped:`,
        imp.skipped.map((s) => s.reason),
      );
    }
    if (imp.warnings.length) console.warn("[import] warnings:", imp.warnings);

    params = new URLSearchParams({
      ok: "1",
      added: String(imp.reservationsAdded),
      updated: String(imp.reservationsUpdated),
      cancelled: String(imp.reservationsNewlyCancelled),
      events: String(imp.eventsCreated),
      shifts: String(form.shiftsCreated),
      shiftsCancelled: String(form.shiftsCancelled),
      skipped: String(imp.skipped.length),
      warn: String(imp.warnings.length),
    }).toString();
  } catch (e) {
    // A bad workbook (not a zip / no Reservations sheet) reads differently from a
    // repo outage, but both mean "nothing landed, try again".
    const code =
      e instanceof Error && /sheet|zip|xlsx/i.test(e.message)
        ? "parse_error"
        : "unavailable";
    redirect(`/admin/import?err=${code}`);
  }
  revalidatePath("/admin/at-risk"); // new shifts should show on the board
  redirect(`/admin/import?${params}`);
}
