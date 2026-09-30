/**
 * The client address behind a request (Phase 18.3a, DEC-189) — the trusted-proxy rule, the one
 * nginx's `real_ip` applies and Cloudflare documents ("Restoring original visitor IPs"):
 * believe `CF-Connecting-IP` only when the hop that reached Vercel is Cloudflare's.
 */
import { describe, expect, it } from "vitest";
import { CLOUDFLARE_RANGES, CLOUDFLARE_RANGES_COPIED } from "./cloudflare-ips";
import { clientIpFrom } from "./client-ip";
import { parseCidr } from "@core/rate-limit/ip.js";

// eslint-disable-next-line sonarjs/no-hardcoded-ip -- test fixture: two of Cloudflare's published ranges, the thing under test
const RANGES = ["173.245.48.0/20", "2400:cb00::/32"];
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- test fixture: an address inside RANGES — a Cloudflare hop
const CF_HOP = "173.245.48.5";
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- test fixture: an address inside RANGES — a Cloudflare IPv6 hop
const CF_HOP_V6 = "2400:cb00:2049::1";
const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });

describe("clientIpFrom", () => {
  it("is the address Vercel saw when the request did not come through Cloudflare", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "203.0.113.9" }), RANGES)).toBe("203.0.113.9");
  });

  it("ignores a CF-Connecting-IP sent straight to Vercel — anyone can write that header", () => {
    expect(
      clientIpFrom(headers({ "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "198.51.100.7" }), RANGES),
    ).toBe("203.0.113.9");
  });

  it("believes CF-Connecting-IP when the hop that reached Vercel is Cloudflare's", () => {
    expect(
      clientIpFrom(headers({ "x-forwarded-for": CF_HOP, "cf-connecting-ip": "198.51.100.7" }), RANGES),
    ).toBe("198.51.100.7");
    expect(
      clientIpFrom(headers({ "x-forwarded-for": CF_HOP_V6, "cf-connecting-ip": "2001:db8::5" }), RANGES),
    ).toBe("2001:db8::5");
  });

  it("reads the first address when the header carries a list", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), RANGES)).toBe("203.0.113.9");
  });

  it.each([
    ["no header at all", {}],
    ["a header that is not an address", { "x-forwarded-for": "unknown" }],
    ["a Cloudflare hop with no CF-Connecting-IP", { "x-forwarded-for": CF_HOP }],
    ["a Cloudflare hop with a junk CF-Connecting-IP", { "x-forwarded-for": CF_HOP, "cf-connecting-ip": "junk" }],
  ])("has no address for %s — never Cloudflare's own, which every guest would share", (_label, h) => {
    expect(clientIpFrom(headers(h as Record<string, string>), RANGES)).toBeNull();
  });
});

describe("the shipped Cloudflare range list", () => {
  it("is not empty, says when it was copied, and every entry is a real range", () => {
    expect(CLOUDFLARE_RANGES.length).toBeGreaterThan(0);
    expect(CLOUDFLARE_RANGES_COPIED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const r of CLOUDFLARE_RANGES) expect(parseCidr(r), r).not.toBeNull();
  });
});
