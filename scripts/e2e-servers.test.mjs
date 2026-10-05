/**
 * The e2e harness drives two servers (#1169): desktop, mobile and setup on the prebuilt one
 * (`next start`), the iPhone project on `next dev`. These pin the wiring in `playwright.config.ts`,
 * because a project pointed at the wrong server still passes — it just runs slower or signs out.
 */
import { describe, expect, it } from "vitest";
import config from "../playwright.config.ts";
import { needsDevServer, SLOW_PATH_FOR } from "../e2e/slow-path.ts";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const project = (name) => config.projects.find((p) => p.name === name);
const servers = () => (Array.isArray(config.webServer) ? config.webServer : [config.webServer]);

describe("e2e servers (#1169)", () => {
  it("runs the iPhone project against next dev, on its own port", () => {
    const iphone = project("iphone");
    expect(iphone.metadata?.server).toBe("dev");
    expect(iphone.use.baseURL).toBe(`http://localhost:${PORT + 1}`);
  });

  it("runs setup, desktop and mobile against the prebuilt server", () => {
    for (const name of ["setup", "desktop", "mobile"]) {
      expect(project(name).metadata?.server, name).toBe("prebuilt");
      expect(project(name).use.baseURL, name).toBe(`http://localhost:${PORT}`);
    }
  });

  it("boots next start on the e2e port and next dev on the next one, in its own build dir", () => {
    const [prebuilt, dev] = servers();
    expect(prebuilt.command).toContain(`next start --port ${PORT}`);
    expect(prebuilt.env.E2E_PROD).toBe("1");
    expect(dev.command).toContain(`npm run dev -- --port ${PORT + 1}`);
    expect(dev.env.E2E_DEV).toBe("1");
    expect(dev.env.APP_BASE_URL).toBe(`http://localhost:${PORT + 1}`);
  });

  it("gives each project the budgets of the server it drives", () => {
    for (const p of config.projects) {
      const k = SLOW_PATH_FOR[p.metadata.server];
      expect(p.timeout, p.name).toBe(30_000 * k);
      expect(p.expect.timeout, p.name).toBe(10_000 * k);
      expect(p.use.navigationTimeout, p.name).toBe(30_000 * k);
      expect(p.use.actionTimeout, p.name).toBe(15_000 * k);
    }
    expect(SLOW_PATH_FOR.dev).toBe(2);
    expect(SLOW_PATH_FOR.prebuilt).toBe(1);
  });

  it("skips the dev server only when the named projects leave out iphone", () => {
    expect(needsDevServer(["test"])).toBe(true);
    expect(needsDevServer(["test", "--project=desktop"])).toBe(false);
    expect(needsDevServer(["test", "--project", "mobile", "--project=desktop"])).toBe(false);
    expect(needsDevServer(["test", "--project=iphone"])).toBe(true);
    expect(needsDevServer(["test", "--project", "desktop", "--project", "iphone"])).toBe(true);
    expect(needsDevServer(["test", "--project=*"])).toBe(true);
    // `--project <project-name...>` is variadic: one flag, several names.
    expect(needsDevServer(["test", "--project", "desktop", "iphone"])).toBe(true);
    expect(needsDevServer(["test", "--project", "desktop", "mobile", "--headed"])).toBe(false);
  });
});
