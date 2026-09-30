import { ipInRange, parseCidr, parseIp, type ParsedCidr } from "@core/rate-limit/ip.js";
import { CLOUDFLARE_RANGES } from "./cloudflare-ips";

/**
 * The client address behind a request (Phase 18.3a, DEC-189) — **the only place in the app that
 * reads one.** The rate limiter keys on it, and 18.4 stamps it on a signed waiver as evidence.
 *
 * **The trusted-proxy rule**, the one nginx's `real_ip` module applies and Cloudflare documents
 * ("Restoring original visitor IPs"):
 *
 *  1. `x-forwarded-for` is the address that connected to Vercel. Vercel **overwrites** it and does
 *     not pass a client-sent one through (vercel.com/docs/headers/request-headers), so a visitor
 *     cannot choose it.
 *  2. Production sits behind Cloudflare's proxy (`ops/residential-probe/README.md`), so for real
 *     traffic that address is a Cloudflare server. When it is inside Cloudflare's published ranges,
 *     the visitor's address is Cloudflare's `CF-Connecting-IP`.
 *  3. Otherwise the request reached Vercel directly — `*.vercel.app` skips Cloudflare — and
 *     `x-forwarded-for` already IS the visitor. A `CF-Connecting-IP` on such a request is ignored:
 *     anyone can write that header, and believing it would let them pick their own key.
 *
 * **No usable address → null, never a stand-in.** A null key is limited by nothing; a Cloudflare
 * address used as a key would put every guest behind that edge in one bucket.
 *
 * Moving off Vercel changes step 1's source (Caddy's `trusted_proxies` behind the same Cloudflare,
 * `docs/hosting-migration-handoff.md`), and nothing else.
 */
export function clientIpFrom(
  headers: { get(name: string): string | null },
  ranges: readonly string[] = CLOUDFLARE_RANGES,
): string | null {
  const hop = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const hopIp = parseIp(hop);
  if (!hopIp) return null;
  if (!parsedRanges(ranges).some((r) => ipInRange(hopIp, r))) return hop!;

  const visitor = headers.get("cf-connecting-ip")?.trim();
  if (!parseIp(visitor)) {
    console.warn("client-ip: a Cloudflare hop arrived without a usable CF-Connecting-IP — not limited");
    return null;
  }
  return visitor!;
}

const cache = new WeakMap<readonly string[], ParsedCidr[]>();

/** Parse a range list once per list. An unparseable entry is dropped — the shipped list is
 *  checked by `client-ip.test.ts`, so a drop here means a hand edit went wrong. */
function parsedRanges(ranges: readonly string[]): ParsedCidr[] {
  let parsed = cache.get(ranges);
  if (!parsed) {
    parsed = ranges.map(parseCidr).filter((r): r is ParsedCidr => r !== null);
    cache.set(ranges, parsed);
  }
  return parsed;
}
