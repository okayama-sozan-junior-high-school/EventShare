import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import { getConfig } from "./.server/config";
import { requestInfoContext, sessionContext } from "./.server/context";
import { createDb } from "./.server/db";
import { unreadCount } from "./.server/services/notifications";
import { loadSession } from "./.server/session";
import { SiteFooter } from "./components/site-footer";
import { SiteHeader } from "./components/site-header";
import { Button } from "./components/ui/button";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import "./app.css";

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }) => {
    context.set(sessionContext, await loadSession(request));
  },
];

export async function loader({ context }: Route.LoaderArgs) {
  const session = context.get(sessionContext);
  const { nonce } = context.get(requestInfoContext);
  const { timeZone } = getConfig();
  const user = session?.user;
  return {
    nonce,
    timeZone,
    user: user
      ? {
          id: user.id,
          name: user.name,
          role: user.role ?? "user",
        }
      : null,
    unread: user ? await unreadCount(createDb(), user.id) : 0,
  };
}

export function meta() {
  return [
    { title: "Event Share — 学校外のイベントを見つけて、共有しよう" },
    {
      name: "description",
      content:
        "Event Share は、学校の生徒が学校外のイベント・コンテスト・勉強会の情報を共有し、新しい挑戦を見つけるためのサービスです。",
    },
  ];
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const nonce = data?.nonce;
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#3b4fd8" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh">
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <TooltipProvider>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader user={loaderData.user} unread={loaderData.unread} />
        <main className="flex-1">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
      <Toaster position="top-center" />
    </TooltipProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "エラーが発生しました";
  let details = "時間をおいて再度お試しください。";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "ページが見つかりません";
      details = "URLが間違っているか、ページが削除された可能性があります。";
    } else if (error.status === 403) {
      title = "アクセスできません";
      details = typeof error.data === "string" ? error.data : "この操作の権限がありません。";
    } else if (error.status === 429) {
      title = "リクエストが多すぎます";
      details = typeof error.data === "string" ? error.data : details;
    } else if (typeof error.data === "string") {
      details = error.data;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold text-primary">Event Share</p>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-muted-foreground">{details}</p>
      <Button asChild>
        <Link to="/">トップページへ戻る</Link>
      </Button>
      {stack && (
        <pre className="w-full overflow-x-auto rounded-md bg-muted p-4 text-left text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
