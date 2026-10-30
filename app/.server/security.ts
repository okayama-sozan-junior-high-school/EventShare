const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence for cookie-authenticated mutations. Session cookies are
 * SameSite=Lax already; additionally reject cross-origin browser requests.
 */
export function isCrossSiteMutation(request: Request) {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return false;
  const selfOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin !== selfOrigin;
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
}

export function createNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function applySecurityHeaders(
  response: Response,
  options: { nonce: string; production: boolean },
) {
  // Some responses (e.g. redirects from fetch) have immutable headers.
  const res = new Response(response.body, response);
  const h = res.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("X-Frame-Options", "DENY");
  h.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );
  if (options.production) {
    h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    const type = h.get("content-type") ?? "";
    if (type.includes("text/html") && !h.has("Content-Security-Policy")) {
      h.set("Content-Security-Policy", contentSecurityPolicy(options.nonce));
    }
  }
  return res;
}
