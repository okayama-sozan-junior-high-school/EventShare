import { checkResolvedHost, checkUrl, dohResolver, type Resolver } from "./ssrf";

export const USER_AGENT =
  "EventShareBot/1.0 (+school event sharing service; fetches a single page on user request)";

export class FetchBlockedError extends Error {}

export type SafeFetchOptions = {
  resolver?: Resolver;
  fetchImpl?: typeof fetch;
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept: string;
  allowedTypes: RegExp;
};

export type SafeFetchResult = {
  url: URL;
  contentType: string;
  bytes: Uint8Array;
};

async function readLimited(res: Response, maxBytes: number) {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new FetchBlockedError("ファイルが大きすぎます");
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchBlockedError("ファイルが大きすぎます");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Fetch an external URL with SSRF protections: every hop (including
 * redirects) is validated and resolved before the request is sent.
 */
export async function safeFetch(
  input: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const resolver = options.resolver ?? dohResolver;
  const doFetch = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? 3;
  let current = input;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = checkUrl(current);
    if (!check.ok) throw new FetchBlockedError(check.reason);
    const resolved = await checkResolvedHost(check.url.hostname, resolver);
    if (!resolved.ok) throw new FetchBlockedError(resolved.reason);

    const res = await doFetch(check.url.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent": USER_AGENT,
        accept: options.accept,
        "accept-language": "ja,en;q=0.8",
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new FetchBlockedError("リダイレクト先が不明です");
      current = new URL(location, check.url).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new FetchBlockedError(`ページを取得できませんでした（HTTP ${res.status}）`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!options.allowedTypes.test(contentType)) {
      await res.body?.cancel();
      throw new FetchBlockedError("対応していない種類のページです");
    }
    return {
      url: check.url,
      contentType,
      bytes: await readLimited(res, options.maxBytes),
    };
  }
  throw new FetchBlockedError("リダイレクトが多すぎます");
}

/** Decode HTML bytes honoring the charset from headers or <meta>. */
export function decodeHtml(bytes: Uint8Array, contentType: string) {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
  const head = new TextDecoder("utf-8").decode(bytes.slice(0, 2048));
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const charset = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
