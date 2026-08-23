/**
 * The draft cookie has to be scoped to the surface that wrote it (#780).
 *
 * #699 shipped `form-draft.ts` for four surfaces that all live under `/admin/<name>`, and the
 * cookie's `Path` was built as `` `/admin/${surface}` `` to match. #780 extends the mechanism to
 * `/crew/time` and `/crew/time-off`, and that hardcoded prefix makes both a silent no-op: a
 * cookie set with `Path=/admin/time` is never sent back to `/crew/time` (RFC 6265 §5.1.4 path
 * matching), so the stash succeeds, the read finds nothing, and the form comes back empty with
 * every call site looking correct.
 *
 * That is the same failure the module's own docstring already documents for `delete` — a path
 * mismatch reports success and does nothing. It is worth a unit test rather than an e2e alone,
 * because the e2e can only tell you the form is empty; it cannot tell you which of the three
 * legs (stash, path, read) was the one that lied.
 *
 * The second thing pinned here is **collision**. Keyed by bare surface name, `/admin/time-off`
 * and `/crew/time-off` are both "time-off" — one cookie, two surfaces, and an admin's refused
 * entry restores into a crew member's form. There is no such pair among #699's four surfaces,
 * which is why the old key worked; #780 introduces exactly that pair, twice (`time` and
 * `time-off`).
 */
import { describe, expect, it } from "vitest";

import { draftCookieName, draftCookiePath } from "./form-draft";

describe("the draft cookie is scoped to the surface's own route (#780)", () => {
  it("paths a crew surface's cookie at that crew route, not under /admin", () => {
    expect(draftCookiePath("/crew/time")).toBe("/crew/time");
    expect(draftCookiePath("/crew/time-off")).toBe("/crew/time-off");
  });

  it("still paths the four surfaces #699 shipped exactly where they already are", () => {
    // If this moves, every shipped surface stops restoring — the regression #780 is most
    // likely to cause, since the fix re-keys call sites that currently work.
    expect(draftCookiePath("/admin/vessels")).toBe("/admin/vessels");
    expect(draftCookiePath("/admin/locations")).toBe("/admin/locations");
    expect(draftCookiePath("/admin/offerings")).toBe("/admin/offerings");
    expect(draftCookiePath("/admin/add-ons")).toBe("/admin/add-ons");
  });

  it("gives the admin and crew halves of one feature different cookies", () => {
    // The collision the bare-name key would create. Asserting they DIFFER rather than asserting
    // two literals, because what matters is that no admin draft can ever be read by a crew page.
    expect(draftCookieName("/admin/time-off")).not.toBe(draftCookieName("/crew/time-off"));
    expect(draftCookieName("/admin/time-clock")).not.toBe(draftCookieName("/crew/time"));
  });

  it("builds a cookie name a browser will accept — no slashes", () => {
    // `/` is not a valid cookie-name token character (RFC 6265 §4.1.1). A name carrying one is
    // dropped or mangled by the client, which reads downstream as "the draft expired".
    for (const surface of ["/admin/vessels", "/crew/time-off", "/admin/calendar"]) {
      expect(draftCookieName(surface)).not.toContain("/");
      expect(draftCookieName(surface)).toMatch(/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/);
    }
  });

  it("derives the name from the whole path", () => {
    expect(draftCookieName("/admin/vessels")).toBe("form-draft-admin-vessels");
    expect(draftCookieName("/admin/add-ons")).toBe("form-draft-admin-add-ons");
    expect(draftCookieName("/crew/time")).toBe("form-draft-crew-time");
  });
});

/*
 * One real cost of this change, which none of the tests above admits and which no assertion
 * would improve: re-keying RENAMES every cookie — `form-draft-vessels` becomes
 * `form-draft-admin-vessels`. A draft written by the old code is orphaned by the new. The blast
 * radius is one minute wide (the TTL) and one form deep: an operator whose save was refused in
 * the last 60 seconds before a deploy gets an empty form instead of a restored one, which is the
 * pre-#699 behaviour rather than a new failure. Not worth a migration; worth writing down.
 *
 * #699's three self-limits — read only on `?err=`, 60-second expiry, cleared on success — are
 * out of scope here and unchanged. They are asserted end-to-end in `e2e/admin-form-error.spec.ts`
 * ("a successful save spends the draft"), which is where they can actually be observed.
 */
