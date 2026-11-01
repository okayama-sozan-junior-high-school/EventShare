import { env } from "cloudflare:workers";

type OptionalSecrets = {
  GROQ_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  MCP_ACCESS_TOKEN?: string;
};

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export type AiProviderName = "groq" | "workers-ai" | "openai" | "none";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/** Typed, validated view over Worker vars / secrets. */
export function getConfig() {
  const optional = env as unknown as OptionalSecrets;
  const aiProvider = (["groq", "workers-ai", "openai", "none"] as const).includes(
    env.AI_PROVIDER as AiProviderName,
  )
    ? (env.AI_PROVIDER as AiProviderName)
    : "none";

  return {
    baseUrl: env.BETTER_AUTH_URL,
    timeZone: env.APP_TIMEZONE || "Asia/Tokyo",
    signupMode: (env.SIGNUP_MODE as string) === "domain" ? ("domain" as const) : ("open" as const),
    schoolEmailDomains: list(env.SCHOOL_EMAIL_DOMAINS),
    aiProvider,
    aiModel: env.AI_MODEL,
    groqApiKey: optional.GROQ_API_KEY,
    openaiApiKey: optional.OPENAI_API_KEY,
    openaiBaseUrl: optional.OPENAI_BASE_URL || "https://api.openai.com/v1",
    /** When set, `/mcp` requires `Authorization: Bearer <token>`. */
    mcpAccessToken: optional.MCP_ACCESS_TOKEN || undefined,
  } as const;
}

export type AppConfig = ReturnType<typeof getConfig>;
