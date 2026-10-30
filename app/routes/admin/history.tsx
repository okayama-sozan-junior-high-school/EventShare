import { Form, Link } from "react-router";
import { createDb } from "~/.server/db";
import { recentHistory } from "~/.server/services/admin";
import { EVENT_FIELD_LABEL } from "~/.server/validation/event";
import { AdminTitle } from "~/components/admin";
import { EmptyState } from "~/components/empty-state";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatDateTime } from "~/lib/datetime";
import { useTimeZone } from "~/lib/hooks";
import type { Route } from "./+types/history";

const TYPE_LABEL = {
  create: "投稿",
  add_info: "情報追加",
  edit: "編集",
  merge: "統合",
  moderate: "管理者操作",
} as const;

export async function loader({ request }: Route.LoaderArgs) {
  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) || null;
  return { items: await recentHistory(createDb(), q), q, labels: EVENT_FIELD_LABEL };
}

function show(v: unknown) {
  if (v === null || v === undefined || v === "") return "（なし）";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

export default function AdminHistory({ loaderData }: Route.ComponentProps) {
  const { items, q, labels } = loaderData;
  const tz = useTimeZone();
  return (
    <>
      <AdminTitle title="投稿・編集履歴" description="誰がいつ、どのイベントのどの項目を変更したかを確認できます。" />
      <Form method="get" className="mb-4 flex gap-2">
        <Input name="q" defaultValue={q ?? ""} placeholder="イベント名・ユーザー名" className="max-w-xs" />
        <Button type="submit" variant="outline">
          検索
        </Button>
      </Form>
      {items.length === 0 ? (
        <EmptyState title="履歴はありません" />
      ) : (
        <ol className="grid gap-2">
          {items.map((h) => (
            <li key={h.id} className="rounded-xl border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{TYPE_LABEL[h.type]}</Badge>
                <Link to={`/events/${h.eventId}`} className="font-medium hover:underline">
                  {h.eventTitle}
                </Link>
                <span className="ml-auto text-xs text-muted-foreground">
                  {h.userName ?? "不明"} ・ {formatDateTime(h.createdAt, tz)}
                </span>
              </div>
              {h.changes && Object.keys(h.changes).length > 0 && (
                <ul className="mt-2 grid gap-0.5 text-xs">
                  {Object.entries(h.changes).map(([field, change]) => (
                    <li key={field} className="break-all">
                      <span className="font-medium">{labels[field as keyof typeof labels] ?? field}</span>: {show(change.from)} →{" "}
                      {show(change.to)}
                    </li>
                  ))}
                </ul>
              )}
              {h.note && <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">{h.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
