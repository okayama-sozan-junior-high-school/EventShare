import { useState } from "react";
import { getConfig } from "~/.server/config";
import { PageContainer, PageHeader } from "~/components/page-header";
import { Button } from "~/components/ui/button";
import type { Route } from "./+types/ai-connect";

export const meta = () => [{ title: "AIから使う | Event Share" }];

export async function loader({ request }: Route.LoaderArgs) {
  const config = getConfig();
  const visiting = new URL(request.url).origin;
  const configured = config.baseUrl.replace(/\/$/, "");
  return {
    endpoint: `${visiting}/mcp`,
    configuredEndpoint: `${configured}/mcp`,
    showConfigured: visiting !== configured,
    authRequired: Boolean(config.mcpAccessToken),
  };
}

const EXAMPLE = "夏休みに中学生が出られる、初心者歓迎のプログラミング系はある？過去の定番も";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "コピーしました" : "URLをコピー"}
    </Button>
  );
}

function Snippet({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

export default function AiConnect({ loaderData }: Route.ComponentProps) {
  const { endpoint, configuredEndpoint, showConfigured, authRequired } = loaderData;
  const cursor = `{
  "mcpServers": {
    "eventshare": {
      "url": "${endpoint}"
    }
  }
}`;
  const gemini = `{
  "mcpServers": {
    "eventshare": {
      "httpUrl": "${endpoint}"
    }
  }
}`;

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        title="AIから使う"
        description="ChatGPT や Claude などから、Event Share の公開イベントを検索できます。"
      />

      <div className="grid gap-4">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">できること</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>公開中のイベントを、キーワードやタグ、開催月で探す</li>
            <li>詳細、タグ、シリーズ（これまでの回）、おすすめの件数と一言を見る</li>
            <li>興味に近いイベントを、登録データに基づく根拠つきで挙げる</li>
          </ul>
          <h2 className="mt-4 font-semibold">できないこと</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>投稿、編集、ウォッチ、お気に入りなどの書き込み</li>
            <li>投稿した人や一言を書いた人の名前、メールアドレス、ユーザー ID の取得</li>
            <li>ログインしないと見られない情報の取得</li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            読み取り専用です。日程や締切は変わるので、回答に公式サイトで確認するよう書いてあります。
          </p>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">接続 URL</h2>
          <p className="mt-2 text-sm text-muted-foreground">このページを開いているサイトの MCP エンドポイントです。</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={endpoint}
              aria-label="接続 URL"
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
            />
            <CopyButton value={endpoint} />
          </div>
          {showConfigured && (
            <p className="mt-3 text-sm text-muted-foreground">
              設定上の公開 URL（<code>BETTER_AUTH_URL</code>）は{" "}
              <code className="text-foreground">{configuredEndpoint}</code> です。
            </p>
          )}
        </section>

        <section className="rounded-xl border bg-card p-5 text-sm leading-relaxed">
          <h2 className="font-semibold">クライアント別の手順</h2>
          <p className="mt-2 text-muted-foreground">
            各サービスの画面は変わることがあります。操作名が違ったら、公式ドキュメントを見てください。
          </p>

          <h3 className="mt-4 font-medium">ChatGPT</h3>
          <p className="mt-1 text-muted-foreground">
            開発者モードを有効にして、カスタムコネクタに上の URL を追加します。認証は「なし」です（トークンを設定している場合は下のヘッダーを指定します）。
          </p>
          <p className="mt-1">
            <a
              className="text-primary hover:underline"
              href="https://platform.openai.com/docs/guides/tools-remote-mcp"
              target="_blank"
              rel="noreferrer"
            >
              OpenAI のドキュメント
            </a>
          </p>

          <h3 className="mt-4 font-medium">Claude</h3>
          <p className="mt-1 text-muted-foreground">Claude Code では、次のように追加できます。</p>
          <Snippet>{`claude mcp add --transport http eventshare ${endpoint}`}</Snippet>
          <p className="mt-2 text-muted-foreground">
            claude.ai では、コネクタ設定からリモート MCP の URL を追加します。
          </p>
          <p className="mt-1">
            <a
              className="text-primary hover:underline"
              href="https://code.claude.com/docs/en/mcp"
              target="_blank"
              rel="noreferrer"
            >
              Claude Code のドキュメント
            </a>
          </p>

          <h3 className="mt-4 font-medium">Cursor</h3>
          <p className="mt-1 text-muted-foreground">
            プロジェクトの <code>.cursor/mcp.json</code> に <code>url</code> を書きます。
          </p>
          <Snippet>{cursor}</Snippet>
          <p className="mt-2">
            <a
              className="text-primary hover:underline"
              href="https://cursor.com/docs/mcp"
              target="_blank"
              rel="noreferrer"
            >
              Cursor のドキュメント
            </a>
          </p>

          <h3 className="mt-4 font-medium">Gemini CLI</h3>
          <p className="mt-1 text-muted-foreground">
            <code>settings.json</code> の <code>mcpServers</code> に <code>httpUrl</code> を書きます。一般向けの Gemini アプリからは、同じようにつながらない場合があります。
          </p>
          <Snippet>{gemini}</Snippet>
          <p className="mt-2">
            <a
              className="text-primary hover:underline"
              href="https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md"
              target="_blank"
              rel="noreferrer"
            >
              Gemini CLI のドキュメント
            </a>
          </p>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">聞き方の例</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">「{EXAMPLE}」</p>
        </section>

        <section className="rounded-xl border bg-card p-5 text-sm leading-relaxed text-muted-foreground">
          <h2 className="font-semibold text-foreground">トークンを設定している場合</h2>
          <p className="mt-2">
            運用者がシークレット <code>MCP_ACCESS_TOKEN</code> を設定しているときは、リクエストに{" "}
            <code className="text-foreground">Authorization: Bearer &lt;トークン&gt;</code>{" "}
            ヘッダーが必要です。ヘッダー名は <code>Authorization</code> です。トークンの値はこのページには出ません。
          </p>
          {authRequired && (
            <p className="mt-2 text-foreground">現在このサーバーでは、このヘッダーが必須です。</p>
          )}
        </section>

        <section className="rounded-xl border bg-card p-5 text-sm leading-relaxed text-muted-foreground">
          <h2 className="font-semibold text-foreground">手元の確認</h2>
          <p className="mt-2">
            <code>localhost</code> には、外の AI からは接続できません。公開前の確認はプレビュー環境か、cloudflared などのトンネルを使ってください。同じマシンからは MCP Inspector（<code>npx @modelcontextprotocol/inspector</code>）で <code>{endpoint}</code> に接続できます。
          </p>
        </section>
      </div>
    </PageContainer>
  );
}
