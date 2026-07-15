/**
 * PWA installability prerequisites (#391). The install prompt itself can't be
 * driven in a test, but its inputs can: a valid served manifest WITH screenshots
 * (Chrome's "richer install UI") and a registered service worker that has a fetch
 * handler (Android Chrome gates "Install app" on one). Guards against any of these
 * silently regressing.
 */
import { test, expect } from "./fixtures.js";

test.describe("PWA install prerequisites (#391)", () => {
  test("manifest is served with narrow + wide screenshots", async ({ page }) => {
    const m = await page.request.get("/manifest.webmanifest");
    expect(m.status()).toBe(200);
    const json = await m.json();
    const forms = (json.screenshots ?? []).map((s: { form_factor?: string }) => s.form_factor);
    expect(forms).toContain("wide");
    expect(forms).toContain("narrow");
    for (const s of json.screenshots) {
      expect((await page.request.get(s.src)).status()).toBe(200);
    }
  });

  test("the service worker serves and registers + activates", async ({ page }) => {
    expect((await page.request.get("/sw.js")).status()).toBe(200);
    await page.goto("/crew");
    const ready = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "no-api";
      return Promise.race([
        navigator.serviceWorker.ready.then((r) => (r.active ? "active" : "no-active")),
        new Promise((res) => setTimeout(() => res("timeout"), 8000)),
      ]);
    });
    expect(ready).toBe("active");
  });
});
