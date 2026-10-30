import { env } from "cloudflare:workers";
import { z } from "zod";
import { getConfig } from "../config";

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
  constructor(private model: string) {}

  async generateJson<T>(req: JsonRequest<T>) {
    try {
      const result = (await withTimeout(
        env.AI.run(this.model as Parameters<Ai["run"]>[0], {
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
  readonly name = "openai";
  constructor(
    private apiKey: string,
    private baseUrl: string,
    private model: string,
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
            max_tokens: req.maxTokens ?? 800,
            temperature: 0.2,
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

export function getAiClient(): AiClient | null {
  const config = getConfig();
  if (config.aiProvider === "workers-ai" && env.AI) {
    return new WorkersAiClient(config.aiModel);
  }
  if (config.aiProvider === "openai" && config.openaiApiKey) {
    return new OpenAiCompatibleClient(
      config.openaiApiKey,
      config.openaiBaseUrl,
      config.aiModel,
    );
  }
  return null;
}
