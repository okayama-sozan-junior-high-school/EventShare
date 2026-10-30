import { eq } from "drizzle-orm";
import { data, Form, Link } from "react-router";
import { createDb } from "~/.server/db";
import { comments } from "~/.server/db/schema";
import { adminListComments } from "~/.server/services/admin";
import { setCommentStatus } from "~/.server/services/interactions";
import { requireAdmin } from "~/.server/session";
import { AdminTitle, StatusBadge } from "~/components/admin";
import { EmptyState } from "~/components/empty-state";
import { Button } from "~/components/ui/button";
import { NativeSelect } from "~/components/ui/native-select";
import { formatDateTime } from "~/lib/datetime";
import { useTimeZone } from "~/lib/hooks";
import type { Route } from "./+types/comments";

export async function loader({ request }: Route.LoaderArgs) {
  const status = new URL(request.url).searchParams.get("status");
  return { comments: await adminListComments(createDb(), status), status };
}

export async function action({ request, context }: Route.ActionArgs) {
  requireAdmin(context, request);
  const db = createDb();
  const form = await request.formData();
  const comment = await db.query.comments.findFirst({ where: eq(comments.id, String(form.get("id"))) });
  if (!comment) throw data("コメントが見つかりません", { status: 404 });
  const status = form.get("intent") === "restore" ? "visible" : "hidden";
  await setCommentStatus(db, comment.id, comment.eventId, status);
  return { ok: true };
}

export default function AdminComments({ loaderData }: Route.ComponentProps) {
  const tz = useTimeZone();
  return (
    <>
      <AdminTitle
        title="コメント管理"
        actions={
          <Form method="get" className="flex gap-2" onChange={(e) => e.currentTarget.requestSubmit()}>
            <NativeSelect name="status" defaultValue={loaderData.status ?? ""} aria-label="状態" className="w-36">
              <option value="">すべて</option>
              <option value="visible">表示中</option>
              <option value="hidden">非公開</option>
              <option value="deleted">削除済み</option>
            </NativeSelect>
          </Form>
        }
      />
      {loaderData.comments.length === 0 ? (
        <EmptyState title="コメントはありません" />
      ) : (
        <ul className="grid gap-2">
          {loaderData.comments.map((c) => (
            <li key={c.id} className="rounded-xl border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge status={c.status} />
                <Link to={`/users/${c.userId}`} className="font-medium text-foreground hover:underline">
                  {c.userName}
                </Link>
                <span>→</span>
                <Link to={`/events/${c.eventId}#comments`} className="truncate hover:underline">
                  {c.eventTitle}
                </Link>
                <span className="ml-auto">{formatDateTime(c.createdAt, tz)}</span>
              </div>
              <p className="mt-1.5 text-sm whitespace-pre-wrap">{c.body}</p>
              <Form method="post" className="mt-2 flex justify-end">
                <input type="hidden" name="id" value={c.id} />
                {c.status === "visible" ? (
                  <Button size="sm" variant="outline" name="intent" value="hide">
                    非公開にする
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" name="intent" value="restore">
                    表示に戻す
                  </Button>
                )}
              </Form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
