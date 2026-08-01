/**
 * Two shared-primitive rules that nothing else asserts (#639).
 *
 * Both live in `app/globals.css`, which no unit test can reach — a stylesheet only
 * exists once a browser has parsed it, so these are e2e or they are nothing. They're
 * cheap and they guard rules that are easy to regress silently: a selector list gets
 * rewritten, or a new animation lands ungated, and nobody notices because neither
 * failure is visible to the person who caused it.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

/** `--color-accent` in `app/globals.css`. Resolved rather than hardcoded per-assertion
 *  so a palette change fails here loudly instead of drifting. */
const ACCENT = "rgb(47, 93, 134)"; // #2f5d86

test.describe("shared primitives — focus ring and reduced motion (#639)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("a focused <select> gets the app's own ring, not the browser's", async ({ page }) => {
    // /admin/payroll is the plainest surface with a real select. The rule is global;
    // this is the cheapest place to prove it applies to form controls at all.
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/payroll");

    const select = page.locator("select#period");
    await select.focus();

    const outline = await select.evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, style: s.outlineStyle, color: s.outlineColor };
    });
    expect(outline).toEqual({ width: "2px", style: "solid", color: ACCENT });
  });

  test("the accent token itself is what the ring resolves to", async ({ page }) => {
    // Guards the assertion above from going vacuous if the palette moves: if accent
    // changes, this fails and says so, rather than the ring test quietly passing
    // against a stale literal.
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/payroll");
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim(),
    );
    expect(accent).toBe("#2f5d86");
  });

  test("the pending spinner stops rotating under prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/payroll");

    // Probe the rule directly: the spinner only exists mid-submit, which is a race to
    // catch, and what's under test is the STYLESHEET, not any one button.
    const animation = await page.evaluate(() => {
      const el = document.createElement("div");
      el.className = "animate-spin";
      document.body.appendChild(el);
      const name = getComputedStyle(el).animationName;
      el.remove();
      return name;
    });
    expect(animation).toBe("none");
  });

  test("…and still rotates when motion is allowed — the rule is gated, not deleted", async ({
    page,
  }) => {
    // The negative control. Without this, removing the spin entirely would pass the
    // test above, and a pending button with no visible feedback is a worse
    // accessibility outcome than the one #639 set out to fix.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/payroll");

    const animation = await page.evaluate(() => {
      const el = document.createElement("div");
      el.className = "animate-spin";
      document.body.appendChild(el);
      const name = getComputedStyle(el).animationName;
      el.remove();
      return name;
    });
    expect(animation).not.toBe("none");
  });
});
