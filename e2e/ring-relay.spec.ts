/**
 * The doorbell-ring relay end-to-end (#118, DEC-073, the promotion gate):
 *  1. operator priority-broadcasts → the doorbell tick (cron) → rings land in the
 *     operator's `/admin/outbox` "New messages" section;
 *  2. a ring's thread deep-link lands the crew member IN the thread;
 *  3. a tampered `thread` param falls back to home (no open redirect).
 *
 * The enqueue/drop-on-read logic is unit + integration tested (ring-outbox-view,
 * ring-relay specs); this proves the wiring — the cron, the outbox section, and the
 * security-sensitive auth-route deep-link.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

const SHIFT_THREAD = "thread-shift-tenant-brewboat-shift-soon"; // quint's confirmed shift

test.describe("doorbell-ring relay", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("operator priority broadcast → tick → rings land in the outbox", async ({ page }) => {
    await signInAsAdmin(page, "spink");

    // Priority bypasses the 90s batch window → the tick rings immediately.
    await page.goto("/admin/messages");
    await page.getByRole("link", { name: /All staff/ }).click();
    await page.getByRole("textbox").fill("Dock moved to slip C — heads up");
    await page.getByRole("checkbox", { name: /Priority/ }).check();
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Dock moved to slip C — heads up")).toBeVisible();

    // Fire the doorbell tick (cron, bearer-gated).
    const res = await page.request.get("/api/cron/doorbell-tick", {
      headers: { authorization: "Bearer e2e-cron-secret" },
    });
    expect(res.ok()).toBeTruthy();

    // The absent all-staff crew now show as rings to relay.
    await page.goto("/admin/outbox");
    await expect(page.getByRole("heading", { name: /New messages/ })).toBeVisible();
    await expect(page.getByText("Quint")).toBeVisible();
    await expect(page.getByText("Hooper")).toBeVisible();
  });

  test("a ring deep-link lands the crew member in the thread", async ({ page }) => {
    // Mint a real crew token via the dev tool; the deep-link adds the &thread=.
    await page.goto("/crew/dev-link?crew=crew-quint");
    const secret = await page.locator('input[name="t"]').inputValue();

    await page.goto(`/crew/auth?t=${secret}&thread=${SHIFT_THREAD}`);
    await page.getByRole("button", { name: /tap to sign in/i }).click();

    await page.waitForURL(new RegExp(`/crew/threads/${SHIFT_THREAD}$`));
    await expect(page.getByRole("heading", { name: /Hops/ })).toBeVisible();
  });

  test("a tampered thread param falls back to home — no open redirect", async ({ page }) => {
    await page.goto("/crew/dev-link?crew=crew-quint");
    const secret = await page.locator('input[name="t"]').inputValue();

    await page.goto(`/crew/auth?t=${secret}&thread=${encodeURIComponent("../../evil")}`);
    await page.getByRole("button", { name: /tap to sign in/i }).click();

    // Lands on /crew (home), never a crafted path or a thread route.
    await page.waitForURL((u) => u.pathname === "/crew");
  });
});
