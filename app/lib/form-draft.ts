import { cookies } from "next/headers";

/**
 * A one-shot draft of a refused form submission (#699).
 *
 * **Why this exists at all.** React 19 resets every function-valued `<form action>` — a literal
 * `HTMLFormElement.reset()` in the commit phase, before the action runs (`react-dom@19.2.7`,
 * `startHostTransition` → `requestFormReset`). There is no opt-out: the exported
 * `requestFormReset` IS the function the automatic path calls. Controlled `value` survives only
 * because React mirrors it into `defaultValue` on update; `checked` and `selected` are never
 * mirrored, so checkboxes, radios and selects revert to their MOUNT values no matter how much
 * client state wraps them. A `useState` conversion buys a partial fix and hides the rest — the
 * offerings surface passed its tests for hours while silently clearing every checkbox.
 *
 * So the fix runs the other way: let the reset happen, and make sure the defaults it restores
 * are already the operator's own values. The action stashes what was submitted, the page reads
 * it back as the defaults source, and every control type is covered by the same mechanism —
 * with no client state, no island, and no JS required (DEC-147).
 *
 * **Self-limiting by three separate things**, because a draft that outlives its refusal is the
 * #699 bug wearing a different hat — a form showing you values you didn't just type:
 *  1. The page reads it only when `?err=` is present.
 *  2. It expires in 60s.
 *  3. A successful save clears it.
 *
 * Scoped by `path` to its own surface so an add-ons draft can never be read by /admin/vessels,
 * and `httpOnly` because nothing client-side has any business reading it back.
 */

const PREFIX = "form-draft-";
const TTL_SECONDS = 60;

/**
 * Cookie ceiling is 4KB per browsers, header limits below that on some hosts. Offerings with
 * many price variations is the surface that can approach it. Over the cap we drop the draft
 * rather than truncate: half a restored form is worse than none, because it looks complete.
 */
const MAX_ENCODED_BYTES = 3500;

/** The submitted values of a refused form, read as the re-rendered form's defaults. */
export type FormDraft = {
  /** Last value for a name — the single-value case (text, textarea, select, radio). */
  get(name: string): string | undefined;
  /** Every value for a name — checkbox/multi groups (`vesselIds`, `weekday`, `addOnIds`). */
  all(name: string): string[];
  /**
   * Was this control submitted? With no `value`, "is this checkbox ticked" — an unticked box
   * posts nothing, which is exactly the state that must survive. With a `value`, "is this one
   * of the group ticked".
   */
  has(name: string, value?: string): boolean;
};

/**
 * The surface key IS the route the form lives at — `/admin/vessels`, `/crew/time-off`.
 *
 * It was a bare name (`"vessels"`) with the path built as `` `/admin/${surface}` `` until #780,
 * which was correct for #699's four surfaces and silently wrong for anything outside `/admin`.
 * A cookie set with `Path=/admin/time` is never sent back to `/crew/time` (RFC 6265 §5.1.4), so
 * the stash succeeds, the read finds nothing, and the form comes back empty with every call site
 * reading as correct. The bare name also collided: `/admin/time-off` and `/crew/time-off` are
 * both "time-off", one cookie for two surfaces.
 *
 * Deriving both the path and the name from the route makes each impossible rather than merely
 * unlikely — there is no second string to keep in agreement with the first.
 */
export const draftCookiePath = (surface: string) => surface;

/** `/admin/add-ons` → `form-draft-admin-add-ons`. `/` is not a legal cookie-name char. */
export const draftCookieName = (surface: string) =>
  `${PREFIX}${surface.replace(/^\//, "").replace(/\//g, "-")}`;

/**
 * Stash the submitted form. Call on the refusal path only, before `redirect()`.
 *
 * `File` entries are skipped — this project's admin forms have none, and a file input can't be
 * repopulated from the server anyway (the browser owns that value). If one ever lands here it
 * comes back empty rather than wrong.
 */
export async function stashFormDraft(surface: string, formData: FormData): Promise<void> {
  const pairs: [string, string][] = [];
  for (const [name, value] of formData.entries()) {
    if (typeof value === "string") pairs.push([name, value]);
  }
  const encoded = Buffer.from(JSON.stringify(pairs), "utf8").toString("base64");
  const jar = await cookies();
  if (encoded.length > MAX_ENCODED_BYTES) {
    // Too big to carry. Clear rather than leave the PREVIOUS draft standing — restoring an
    // older submission's values would be the original bug with extra steps.
    jar.delete({ name: draftCookieName(surface), path: draftCookiePath(surface) });
    return;
  }
  jar.set(draftCookieName(surface), encoded, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: draftCookiePath(surface),
    maxAge: TTL_SECONDS,
  });
}

/**
 * Drop the draft. Call on the success path — the values are in the database now.
 *
 * **Deletion has to name the path the cookie was SET with.** `jar.delete("name")` compiles to
 * `set({name, value: "", expires: epoch})` with no `path` (`@edge-runtime/cookies`), and a
 * `Set-Cookie` with no `Path` defaults to the request URI's directory (RFC 6265 §5.1.4). For a
 * POST to `/admin/offerings` that is `/admin/`, which does not match the `/admin/offerings` this
 * cookie carries — so the browser stores a second, already-expired cookie in the wrong place and
 * leaves the live one alone. The delete looks like it worked and does nothing, which turns
 * "cleared on a successful save" into a promise kept only by the 60-second expiry.
 */
export async function clearFormDraft(surface: string): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: draftCookieName(surface), path: draftCookiePath(surface) });
}

/**
 * Read the draft back, or null when there isn't one. Callers gate on `?err=` being present:
 * no refusal, no restore.
 *
 * A malformed cookie reads as no draft. It can only be malformed by hand (it's `httpOnly` and
 * we wrote it), and the failure mode that matters is the safe one — the form falls back to the
 * record's own values rather than a page that won't render.
 */
export async function readFormDraft(surface: string): Promise<FormDraft | null> {
  const raw = (await cookies()).get(draftCookieName(surface))?.value;
  if (!raw) return null;

  let pairs: [string, string][];
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    if (!Array.isArray(parsed)) return null;
    pairs = parsed.filter(
      (p): p is [string, string] =>
        Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string",
    );
  } catch {
    return null;
  }
  if (pairs.length === 0) return null;

  const all = (name: string) => pairs.filter(([n]) => n === name).map(([, v]) => v);
  return {
    all,
    get: (name) => all(name).at(-1),
    has: (name, value) => (value === undefined ? all(name).length > 0 : all(name).includes(value)),
  };
}
