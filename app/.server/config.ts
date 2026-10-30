import { env } from "cloudflare:workers";

type OptionalSecrets = {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
};

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export type AiProviderName = "workers-ai" | "openai" | "none";

/** Typed, validated view over Worker vars / secrets. */
export function getConfig() {
  const optional = env as unknown as OptionalSecrets;
  const aiProvider = (["workers-ai", "openai", "none"] as const).includes(
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
    openaiApiKey: optional.OPENAI_API_KEY,
    openaiBaseUrl: optional.OPENAI_BASE_URL || "https://api.openai.com/v1",
  } as const;
}

export type AppConfig = ReturnType<typeof getConfig>;
