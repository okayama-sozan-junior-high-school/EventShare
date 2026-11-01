import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getConfig } from "~/.server/config";
import { checkRateLimit } from "~/.server/rate-limit";
import { applySecurityHeaders, createNonce } from "~/.server/security";
import { bearerAuthorized, createMcpServer } from "./server";
import { createDbDataSource } from "./tools";

const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_MESSAGE =
  "短時間にリクエストが集中しています。しばらく待ってから再度お試しください。";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function finish(response: Response) {
  return applySecurityHeaders(withCors(response), {
    nonce: createNonce(),
    production: import.meta.env.PROD,
  });
}

function json(status: number, message: string, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({ ok: false, error: message }), { status, headers });
}

/**
 * Stateless Streamable HTTP entry for `/mcp`.
 * Wired ahead of the cookie CSRF check — this endpoint ignores cookies.
 */
export async function handleMcpRequest(request: Request) {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return finish(new Response(null, { status: 204 }));
  if (method === "GET") {
    return finish(
      json(
        405,
        "このエンドポイントはステートレスです。SSE（サーバー送信イベント）には対応していません。POST で JSON-RPC を送ってください。",
        { Allow: "POST, OPTIONS" },
      ),
    );
  }
  if (method !== "POST") {
    return finish(json(405, "POST のみ受け付けます。", { Allow: "POST, OPTIONS" }));
  }

  const config = getConfig();
  if (!bearerAuthorized(request.headers.get("authorization"), config.mcpAccessToken)) {
    return finish(
      json(401, "Authorization: Bearer トークンが必要です。", {
        "WWW-Authenticate": 'Bearer realm="mcp"',
      }),
    );
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await checkRateLimit("mcp", ip))) {
    return finish(json(429, RATE_LIMIT_MESSAGE));
  }

  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    return finish(json(413, "リクエスト本文が 64KB を超えています。"));
  }

  const now = new Date();
  const server = createMcpServer({
    source: createDbDataSource({ now, timeZone: config.timeZone }),
    origin: new URL(request.url).origin,
    timeZone: config.timeZone,
    now,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY_BYTES,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return finish(response);
  } catch (error) {
    console.log(
      JSON.stringify({
        source: "mcp",
        error: error instanceof Error ? error.name : "Error",
      }),
    );
    return finish(json(500, "MCP リクエストを処理できませんでした。"));
  } finally {
    await server.close().catch(() => undefined);
  }
}
