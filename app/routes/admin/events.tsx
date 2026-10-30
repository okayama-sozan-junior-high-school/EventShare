import { data, Form, Link } from "react-router";
import { createDb } from "~/.server/db";
import { adminListEvents, deleteEventPermanently, setEventStatus } from "~/.server/services/admin";
import { getEvent } from "~/.server/services/events";
import { requireAdmin } from "~/.server/session";
import { AdminTitle, StatusBadge } from "~/components/admin";
import { EmptyState } from "~/components/empty-state";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { NativeSelect } from "~/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { formatDate } from "~/lib/datetime";
import { useTimeZone } from "~/lib/hooks";
import type { Route } from "./+types/events";

export async function loader({ request }: Route.LoaderArgs) {
  const sp = new URL(request.url).searchParams;
  const q = sp.get("q")?.trim().slice(0, 100) || null;
  const status = sp.get("status");
  return { events: await adminListEvents(createDb(), q, status), q, status };
}

export async function action({ request, context }: Route.ActionArgs) {
  const admin = requireAdmin(context, request);
  const db = createDb();
  const form = await request.formData();
  const event = await getEvent(db, String(form.get("id")));
  if (!event) throw data("イベントが見つかりません", { status: 404 });
  const intent = form.get("intent");
  if (intent === "hide") await setEventStatus(db, event.id, "hidden", admin.id);
  else if (intent === "publish") await setEventStatus(db, event.id, "published", admin.id);
  else if (intent === "delete") await deleteEventPermanently(db, event.id);
  else throw data("不正なリクエストです", { status: 400 });
  return { ok: true };
}

export default function AdminEvents({ loaderData }: Route.ComponentProps) {
  const { events, q, status } = loaderData;
  const tz = useTimeZone();
  return (
    <>
      <AdminTitle title="イベント管理" description="イベントの公開・非公開・削除、編集画面への移動ができます。" />
      <Form method="get" className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={q ?? ""} placeholder="タイトル・主催者・ID" className="max-w-xs" />
        <NativeSelect name="status" defaultValue={status ?? ""} className="w-36">
          <option value="">すべて</option>
          <option value="published">公開</option>
          <option value="hidden">非公開</option>
          <option value="merged">統合済み</option>
        </NativeSelect>
        <Button type="submit" variant="outline">
          検索
        </Button>
      </Form>
      {events.length === 0 ? (
        <EmptyState title="イベントがありません" />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>イベント</TableHead>
                <TableHead className="hidden sm:table-cell">開催日</TableHead>
                <TableHead>状態</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="max-w-72">
                    <Link to={`/events/${e.id}`} className="block truncate font-medium hover:underline">
                      {e.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">投稿: {e.creatorName ?? "—"}</span>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{e.startAt ? formatDate(e.startAt, tz) : "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={e.status} />
                  </TableCell>
                  <TableCell>
                    <Form method="post" className="flex justify-end gap-1">
                      <input type="hidden" name="id" value={e.id} />
                      {e.status !== "merged" && (
                        <Button size="sm" variant="ghost" asChild>
                          <Link to={`/events/${e.id}/edit`}>編集</Link>
                        </Button>
                      )}
                      {e.status === "published" && (
                        <Button size="sm" variant="outline" name="intent" value="hide">
                          非公開
                        </Button>
                      )}
                      {e.status === "hidden" && (
                        <Button size="sm" variant="outline" name="intent" value="publish">
                          公開
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        name="intent"
                        value="delete"
                        onClick={(ev) => {
                          if (!confirm("このイベントを完全に削除しますか？コメント・いいね・履歴も削除され、元に戻せません。")) ev.preventDefault();
                        }}
                      >
                        削除
                      </Button>
                    </Form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
