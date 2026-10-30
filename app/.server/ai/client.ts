import { env } from "cloudflare:workers";
import { z } from "zod";
import { getConfig, GROQ_BASE_URL } from "../config";

export type JsonRequest<T> = {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  timeoutMs?: number;
};

export interface AiClient {
  readonly name: string;
  /** Returns validated JSON or null on any failure (callers must fall back). */
  generateJson<T>(req: JsonRequest<T>): Promise<T | null>;
}

function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("AI request timed out")), ms),
    ),
  ]);
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function jsonSchemaOf(schema: z.ZodType) {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return rest;
}

class WorkersAiClient implements AiClient {
  readonly name = "workers-ai";
  constructor(
    private binding: Ai,
    private model: string,
  ) {}

  async generateJson<T>(req: JsonRequest<T>) {
    try {
      const result = (await withTimeout(
        this.binding.run(this.model as Parameters<Ai["run"]>[0], {
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          response_format: { type: "json_schema", json_schema: jsonSchemaOf(req.schema) },
          max_tokens: req.maxTokens ?? 800,
          temperature: 0.2,
        } as never),
        req.timeoutMs ?? 20_000,
      )) as { response?: unknown };
      const parsed = req.schema.safeParse(parseJson(result?.response));
      return parsed.success ? parsed.data : null;
    } catch (error) {
      console.warn("Workers AI request failed:", (error as Error).message);
      return null;
    }
  }
}

class OpenAiCompatibleClient implements AiClient {
  constructor(
    readonly name: string,
    private apiKey: string,
    private baseUrl: string,
    private model: string,
    private extra: Record<string, unknown> = {},
    private tokenField: "max_tokens" | "max_completion_tokens" = "max_tokens",
  ) {}

  async generateJson<T>(req: JsonRequest<T>) {
    try {
      const res = await withTimeout(
        fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
            response_format: {
              type: "json_schema",
              json_schema: { name: "result", schema: jsonSchemaOf(req.schema) },
            },
            [this.tokenField]: req.maxTokens ?? 800,
            temperature: 0.2,
            ...this.extra,
          }),
        }),
        req.timeoutMs ?? 20_000,
      );
      if (!res.ok) {
        console.warn("LLM API request failed with status", res.status);
        return null;
      }
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const parsed = req.schema.safeParse(parseJson(body.choices?.[0]?.message?.content));
      return parsed.success ? parsed.data : null;
    } catch (error) {
      console.warn("LLM API request failed:", (error as Error).message);
      return null;
    }
  }
}

/** Qwen stays in instruct mode. GPT-OSS has no "none", so keep reasoning short. */
function groqExtras(model: string): Record<string, unknown> {
  if (model.startsWith("qwen/")) {
    return { reasoning_effort: "none", reasoning_format: "hidden" };
  }
  if (model.startsWith("openai/gpt-oss")) {
    return { reasoning_effort: "low", reasoning_format: "hidden" };
  }
  return {};
}

export function getAiClient(): AiClient | null {
  const config = getConfig();
  if (config.aiProvider === "groq" && config.groqApiKey) {
    return new OpenAiCompatibleClient(
      "groq",
      config.groqApiKey,
      GROQ_BASE_URL,
      config.aiModel,
      groqExtras(config.aiModel),
      "max_completion_tokens",
    );
  }
  const workersAi = (env as unknown as { AI?: Ai }).AI;
  if (config.aiProvider === "workers-ai" && workersAi) {
    return new WorkersAiClient(workersAi, config.aiModel);
  }
  if (config.aiProvider === "openai" && config.openaiApiKey) {
    return new OpenAiCompatibleClient(
      "openai",
      config.openaiApiKey,
      config.openaiBaseUrl,
      config.aiModel,
    );
  }
  return null;
}
