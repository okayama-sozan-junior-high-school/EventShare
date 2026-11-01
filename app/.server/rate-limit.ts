import { env } from "cloudflare:workers";
import { data } from "react-router";

export type RateLimitKind = "auth" | "write" | "ai" | "fetch" | "mcp";

function binding(kind: RateLimitKind): RateLimit | undefined {
  switch (kind) {
    case "auth":
      return env.RL_AUTH;
    case "write":
      return env.RL_WRITE;
    case "ai":
      return env.RL_AI;
    case "fetch":
      return env.RL_FETCH;
    case "mcp":
      return env.RL_MCP;
  }
}

/** Returns false when the caller exceeded the limit for `kind`. */
export async function checkRateLimit(kind: RateLimitKind, key: string) {
  const limiter = binding(kind);
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key: `${kind}:${key}` });
    return success;
  } catch {
    // Fail open: rate limiting must never take the site down.
    return true;
  }
}

export async function enforceRateLimit(kind: RateLimitKind, key: string) {
  if (!(await checkRateLimit(kind, key))) {
    throw data(
      "短時間にリクエストが集中しています。しばらく待ってから再度お試しください。",
      { status: 429 },
    );
  }
}
