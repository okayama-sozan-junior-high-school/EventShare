import { History, Loader2, MessageSquarePlus, SendHorizontal, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useRevalidator } from "react-router";
import { toast } from "sonner";
import { getAiClient } from "~/.server/ai/client";
import { greeting } from "~/.server/chat/engine";
import { listChatSessions, loadChatSession } from "~/.server/chat/store";
import { emptyState, type ChatState, type QuickReply } from "~/.server/chat/types";
import { createDb } from "~/.server/db";
import { getUser } from "~/.server/session";
import {
  RecommendationCard,
  type RecommendationCardData,
} from "~/components/chat/recommendation-card";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/chat";

export const meta = () => [{ title: "AIでイベントを探す | Event Share" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = getUser(context);
  const db = createDb();
  const hello = greeting();
  const sessionId = new URL(request.url).searchParams.get("session");
  const sessions = user ? await listChatSessions(db, user.id) : [];
  const loaded = user && sessionId ? await loadChatSession(db, user.id, sessionId, new Date()) : null;
  return {
    loggedIn: !!user,
    aiEnabled: getAiClient() !== null,
    greeting: hello,
    sessions,
    session: loaded,
    initialState: loaded?.state ?? emptyState(),
  };
}

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  recommendations?: RecommendationCardData[];
};

type ChatResponse = {
  ok: boolean;
  error: string | null;
  reply?: string;
  quickReplies?: QuickReply[];
  recommendations?: RecommendationCardData[];
  state?: ChatState;
  sessionId?: string | null;
  canSaveInterests?: boolean;
};

function Bubble({ message }: { message: Message }) {
  const mine = message.role === "user";
  return (
    <div className={cn("flex gap-3", mine && "justify-end")}>
      {!mine && (
        <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <Sparkles className="size-4" aria-hidden />
        </span>
      )}
      <div className={cn("grid max-w-[85%] gap-3", mine && "justify-items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
            mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-tl-sm border bg-card",
          )}
        >
          {message.content}
        </div>
        {message.recommendations && message.recommendations.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {message.recommendations.map((r) => (
              <RecommendationCard key={r.event.id} rec={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Chat({ loaderData }: Route.ComponentProps) {
  const { loggedIn, aiEnabled, greeting, sessions, session, initialState } = loaderData;
  const fetcher = useFetcher<ChatResponse>();
  const interestFetcher = useFetcher<{ ok: boolean; error: string | null }>();
  const deleteFetcher = useFetcher();
  const revalidator = useRevalidator();
  const initialMessages: Message[] = [
    { id: "greeting", role: "assistant", content: greeting.reply },
    ...(session?.messages ?? []).map((m) => ({ ...m, recommendations: m.recommendations })),
  ];
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [state, setState] = useState<ChatState>(initialState);
  const [sessionId, setSessionId] = useState<string | null>(session?.id ?? null);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>(session ? [] : greeting.quickReplies);
  const [canSave, setCanSave] = useState(false);
  const [input, setInput] = useState("");
  const handled = useRef<ChatResponse | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const d = fetcher.data;
    if (fetcher.state !== "idle" || !d || handled.current === d) return;
    handled.current = d;
    if (!d.ok) {
      toast.error(d.error ?? "エラーが発生しました");
      return;
    }
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "assistant", content: d.reply ?? "", recommendations: d.recommendations },
    ]);
    if (d.state) setState(d.state);
    setQuickReplies(d.quickReplies ?? []);
    setCanSave(!!d.canSaveInterests);
    if (d.sessionId && d.sessionId !== sessionId) {
      setSessionId(d.sessionId);
      window.history.replaceState(null, "", `/chat?session=${d.sessionId}`);
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, sessionId, revalidator]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);

  useEffect(() => {
    if (interestFetcher.state === "idle" && interestFetcher.data?.ok) {
      toast.success("興味・関心をプロフィールに保存しました");
      setCanSave(false);
    }
  }, [interestFetcher.state, interestFetcher.data]);

  function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: message }]);
    setQuickReplies([]);
    setInput("");
    fetcher.submit(
      { message, state: JSON.stringify(state), sessionId: sessionId ?? "" },
      { method: "post", action: "/api/chat" },
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[240px_1fr]">
      <aside className="hidden lg:block" aria-label="会話履歴">
        <Button variant="outline" className="w-full justify-start" asChild>
          <a href="/chat">
            <MessageSquarePlus /> 新しい会話
          </a>
        </Button>
        {loggedIn ? (
          <div className="mt-4">
            <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground">
              <History className="size-3.5" aria-hidden /> 最近の会話
            </p>
            {sessions.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">まだ会話はありません</p>
            ) : (
              <ul className="grid gap-0.5">
                {sessions.map((s) => (
                  <li key={s.id} className="group flex items-center">
                    <a
                      href={`/chat?session=${s.id}`}
                      className={cn(
                        "flex-1 truncate rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                        s.id === sessionId && "bg-accent font-medium",
                      )}
                    >
                      {s.title}
                    </a>
                    <deleteFetcher.Form method="post" action="/api/chat">
                      <input type="hidden" name="intent" value="delete_session" />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label="この会話を削除">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </deleteFetcher.Form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <Link to="/login?redirectTo=/chat" className="font-medium text-primary hover:underline">
              ログイン
            </Link>
            すると、会話履歴と興味・関心を保存できます。
          </p>
        )}
      </aside>

      <section className="flex min-h-[calc(100dvh-10rem)] flex-col rounded-2xl border bg-muted/30" aria-label="AIチャット">
        <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <Sparkles className="size-5 text-primary" aria-hidden />
          <h1 className="font-bold">AIでイベントを探す</h1>
          <Link to="/ai-connect" className="ml-auto text-xs text-primary hover:underline">
            AIから使う
          </Link>
          <span className="text-xs text-muted-foreground">
            {aiEnabled ? "登録済みのイベントだけを紹介します" : "簡易モード（AI未接続・ルールベースで検索）"}
          </span>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4" aria-live="polite">
          {messages.map((m) => (
            <Bubble key={m.id} message={m} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 pl-11 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> イベントを探しています…
            </div>
          )}
          {canSave && loggedIn && (
            <Alert className="ml-11 w-auto">
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>今回の興味・関心をプロフィールに保存しますか？おすすめや通知に使われます。</span>
                <interestFetcher.Form method="post" action="/api/chat">
                  <input type="hidden" name="intent" value="save_interests" />
                  <input type="hidden" name="state" value={JSON.stringify(state)} />
                  <Button size="sm" type="submit" disabled={interestFetcher.state !== "idle"}>
                    保存する
                  </Button>
                </interestFetcher.Form>
                <Button size="sm" variant="ghost" onClick={() => setCanSave(false)}>
                  保存しない
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {!loggedIn && messages.some((m) => m.recommendations?.length) && (
            <p className="pl-11 text-xs text-muted-foreground">
              会話の履歴や興味・関心を保存したい場合は
              <Link to="/signup?redirectTo=/chat" className="mx-1 font-medium text-primary hover:underline">
                新規登録
              </Link>
              ・
              <Link to="/login?redirectTo=/chat" className="mx-1 font-medium text-primary hover:underline">
                ログイン
              </Link>
              してください。
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t bg-background/80 p-3">
          {quickReplies.length > 0 && !busy && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {quickReplies.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => send(q.message)}
                  className="rounded-full border border-primary/30 bg-card px-3 py-1 text-sm text-primary transition hover:bg-brand-soft"
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              maxLength={500}
              placeholder="例: AIを使って何か作ってみたい（Enterで送信）"
              aria-label="メッセージ"
              className="max-h-40 min-h-11 resize-none bg-card"
            />
            <Button type="submit" size="icon" className="size-11 shrink-0" disabled={!input.trim() || busy} aria-label="送信">
              <SendHorizontal />
            </Button>
          </form>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            AIはデータベースに登録されたイベントだけを紹介します。個人情報（名前・学校名・連絡先など）は入力しないでください。
          </p>
        </div>
      </section>
    </div>
  );
}
