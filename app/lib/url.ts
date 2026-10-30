/** Returns the URL only if it is an absolute http(s) URL, otherwise null. */
export function safeExternalUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|_ga$|ref$|ref_src$)/i;

/**
 * Canonical form used to compare URLs (duplicate detection / sources):
 * lower-cased host without `www.`, no fragment, no tracking params,
 * no trailing slash, sorted query.
 */
export function normalizeUrl(value: string | null | undefined) {
  const safe = safeExternalUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = new URLSearchParams(params).toString();
  const path = url.pathname.replace(/\/+$/, "");
  const port = url.port ? `:${url.port}` : "";
  return `${url.hostname}${port}${path}${url.search}`;
}

export function hostnameOf(value: string | null | undefined) {
  const safe = safeExternalUrl(value);
  return safe ? new URL(safe).hostname.replace(/^www\./, "") : null;
}
