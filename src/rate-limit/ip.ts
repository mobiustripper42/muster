/**
 * IP address parsing for the rate limiter (Phase 18.3a, DEC-189) — enough to key a client and to
 * test an address against a CIDR range, and nothing more. Pure; no DNS, no `node:net`.
 *
 * Addresses become a (version, 32- or 128-bit integer) pair, so a range test is a mask compare.
 * Hand-rolled because the rule it serves is small and fully testable, and a dependency for it would
 * be a supply-chain door onto the one function that decides whose traffic is whose.
 */

export interface ParsedIp {
  version: 4 | 6;
  value: bigint;
}

export interface ParsedCidr extends ParsedIp {
  prefix: number;
}

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseV4(s: string): bigint | null {
  const m = V4.exec(s);
  if (!m) return null;
  let v = 0n;
  for (const part of m.slice(1)) {
    const n = Number(part);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

function parseV6(s: string): bigint | null {
  const doubled = s.split("::");
  if (doubled.length > 2) return null;
  const side = (x: string | undefined): string[] | null => {
    if (!x) return [];
    const parts = x.split(":");
    const out: string[] = [];
    for (const [i, p] of parts.entries()) {
      // An embedded IPv4 tail (`::ffff:1.2.3.4`) is two 16-bit groups.
      if (i === parts.length - 1 && p.includes(".")) {
        const v4 = parseV4(p);
        if (v4 === null) return null;
        out.push(((v4 >> 16n) & 0xffffn).toString(16), (v4 & 0xffffn).toString(16));
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(p)) return null;
        out.push(p);
      }
    }
    return out;
  };
  const head = side(doubled[0]);
  const tail = side(doubled[1]);
  if (!head || !tail) return null;
  let groups: string[];
  if (doubled.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n);
}

/** An address as a number, or null when it is not one. Surrounding whitespace is ignored. */
export function parseIp(raw: string | null | undefined): ParsedIp | null {
  const s = raw?.trim();
  if (!s) return null;
  if (s.includes(":")) {
    const v = parseV6(s);
    return v === null ? null : { version: 6, value: v };
  }
  const v = parseV4(s);
  return v === null ? null : { version: 4, value: v };
}

/** `a.b.c.d/n` or `x:y::/n`, or null when it is not a range. */
export function parseCidr(raw: string): ParsedCidr | null {
  const [addr, len, extra] = raw.trim().split("/");
  if (extra !== undefined || len === undefined || !/^\d{1,3}$/.test(len)) return null;
  const ip = parseIp(addr);
  const prefix = Number(len);
  if (!ip || prefix > (ip.version === 4 ? 32 : 128)) return null;
  return { ...ip, prefix };
}

/** Is `ip` inside `range`? Different versions never match. */
export function ipInRange(ip: ParsedIp, range: ParsedCidr): boolean {
  if (ip.version !== range.version) return false;
  const bits = BigInt(ip.version === 4 ? 32 : 128);
  const host = bits - BigInt(range.prefix);
  return ip.value >> host === range.value >> host;
}

/** `::ffff:a.b.c.d` — an IPv4 address carried in IPv6 form — as the IPv4 address it is. */
export function unwrapMappedV4(ip: ParsedIp): ParsedIp {
  if (ip.version === 6 && ip.value >> 32n === 0xffffn) return { version: 4, value: ip.value & 0xffffffffn };
  return ip;
}

/** The standard text form: dotted IPv4, or IPv6 groups in lowercase without leading zeros. */
export function formatIp(ip: ParsedIp): string {
  if (ip.version === 4) {
    return [24n, 16n, 8n, 0n].map((s) => ((ip.value >> s) & 0xffn).toString()).join(".");
  }
  const groups: string[] = [];
  for (let i = 7; i >= 0; i--) groups.push(((ip.value >> BigInt(i * 16)) & 0xffffn).toString(16));
  return groups.join(":");
}
