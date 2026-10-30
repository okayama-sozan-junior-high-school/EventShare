/**
 * SSRF protection for user-supplied URLs.
 *
 * Only http(s) on default ports, no credentials, no internal hostnames, and
 * every resolved address must be public. Redirects are re-validated hop by
 * hop by the fetcher.
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
  ".corp",
];

function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

export function isPrivateIPv4(ip: string) {
  const p = parseIPv4(ip);
  if (!p) return false;
  const [a, b, c] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function expandIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  if (addr.startsWith("[") && addr.endsWith("]")) addr = addr.slice(1, -1);
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);

  // Embedded IPv4 (e.g. ::ffff:127.0.0.1)
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (v4) {
    const p = parseIPv4(v4[1]);
    if (!p) return null;
    addr = `${addr.slice(0, -v4[1].length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

export function isPrivateIPv6(ip: string) {
  const g = expandIPv6(ip);
  if (!g) return false;
  const allZeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);
  const embeddedV4 = () =>
    `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;

  if (allZeroPrefix(8)) return true; // ::
  if (allZeroPrefix(7) && g[7] === 1) return true; // ::1
  if (allZeroPrefix(5) && g[5] === 0xffff) return isPrivateIPv4(embeddedV4()); // ::ffff:0:0/96
  if (allZeroPrefix(6)) return true; // deprecated IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateIPv4(embeddedV4()); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2002) return isPrivateIPv4(`${g[1] >> 8}.${g[1] & 0xff}.${g[2] >> 8}.${g[2] & 0xff}`); // 6to4
  return false;
}

export function isIpLiteral(host: string) {
  return parseIPv4(host) !== null || host.includes(":") || host.startsWith("[");
}

export function isPrivateAddress(ip: string) {
  return parseIPv4(ip) ? isPrivateIPv4(ip) : isPrivateIPv6(ip);
}

/** Static checks that do not need DNS. */
export function checkUrl(input: string | URL): UrlCheck {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "URLの形式が正しくありません" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "http または https のURLのみ取得できます" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "認証情報を含むURLは使用できません" };
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { ok: false, reason: "標準以外のポート番号は使用できません" };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || !host.includes(".")) {
    return { ok: false, reason: "このホストにはアクセスできません" };
  }
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "このホストにはアクセスできません" };
  }
  if (isIpLiteral(host)) {
    // Public IP literals are also refused: event pages have domain names.
    return { ok: false, reason: "IPアドレスを直接指定したURLは使用できません" };
  }
  return { ok: true, url };
}

export type Resolver = (hostname: string) => Promise<string[]>;

/** DNS-over-HTTPS resolver (A + AAAA) via Cloudflare's public resolver. */
export const dohResolver: Resolver = async (hostname) => {
  const query = async (type: "A" | "AAAA") => {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
      {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!res.ok) throw new Error("DNS lookup failed");
    const body = (await res.json()) as {
      Answer?: { type: number; data: string }[];
    };
    return (body.Answer ?? [])
      .filter((a) => a.type === 1 || a.type === 28)
      .map((a) => a.data);
  };
  const [a, aaaa] = await Promise.all([query("A"), query("AAAA")]);
  return [...a, ...aaaa];
};

export async function checkResolvedHost(
  hostname: string,
  resolver: Resolver,
): Promise<UrlCheck | { ok: true }> {
  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    return { ok: false, reason: "ホスト名を解決できませんでした" };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: "ホスト名を解決できませんでした" };
  }
  if (addresses.some(isPrivateAddress)) {
    return { ok: false, reason: "内部ネットワークのアドレスにはアクセスできません" };
  }
  return { ok: true };
}
