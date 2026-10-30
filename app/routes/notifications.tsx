import { Bell, CheckCheck, Settings } from "lucide-react";
import { Form, Link, useFetcher } from "react-router";
import { createDb } from "~/.server/db";
import { listNotifications, markRead } from "~/.server/services/notifications";
import { requireUser } from "~/.server/session";
import { EmptyState } from "~/components/empty-state";
import { PageContainer, PageHeader } from "~/components/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatRelative } from "~/lib/datetime";
import { NOTIFICATION_TYPE_LABEL } from "~/lib/labels";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/notifications";

export const meta = () => [{ title: "通知 | Event Share" }];

export async function loader({ context, request }: Route.LoaderArgs) {
  const user = requireUser(context, request);
  return { items: await listNotifications(createDb(), user.id) };
}

export async function action({ context, request }: Route.ActionArgs) {
  const user = requireUser(context, request);
  const form = await request.formData();
  const id = form.get("id");
  await markRead(createDb(), user.id, typeof id === "string" && id ? id : undefined);
  return { ok: true };
}

function NotificationItem({ item }: { item: Route.ComponentProps["loaderData"]["items"][number] }) {
  const fetcher = useFetcher();
  const unread = !item.readAt && !fetcher.formData;
  const markAsRead = () => {
    if (unread) fetcher.submit({ id: item.id }, { method: "post" });
  };
  const content = (
    <>
      <div className="flex items-center gap-2">
        {unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="未読" />}
        <Badge variant="secondary" className="font-normal">
          {NOTIFICATION_TYPE_LABEL[item.type]}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">{formatRelative(item.createdAt, new Date())}</span>
      </div>
      <p className={cn("mt-1.5 text-sm", unread && "font-semibold")}>{item.title}</p>
      {item.body && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{item.body}</p>}
    </>
  );
  return (
    <li className={cn("border-b last:border-b-0", unread && "bg-brand-soft/40")}>
      {item.link ? (
        <Link to={item.link} onClick={markAsRead} className="block px-4 py-3 hover:bg-accent/60">
          {content}
        </Link>
      ) : (
        <button type="button" onClick={markAsRead} className="block w-full px-4 py-3 text-left hover:bg-accent/60">
          {content}
        </button>
      )}
    </li>
  );
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  const hasUnread = items.some((i) => !i.readAt);
  return (
    <PageContainer className="max-w-2xl">
      <PageHeader
        title="通知"
        actions={
          <>
            {hasUnread && (
              <Form method="post">
                <Button variant="outline" size="sm" type="submit">
                  <CheckCheck /> すべて既読にする
                </Button>
              </Form>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link to="/settings">
                <Settings /> 通知設定
              </Link>
            </Button>
          </>
        }
      />
      {items.length > 0 ? (
        <ul className="overflow-hidden rounded-xl border bg-card">
          {items.map((item) => (
            <NotificationItem key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Bell}
          title="通知はありません"
          description="イベントをお気に入りに追加すると、締切や開催日が近づいたときにお知らせします。"
        />
      )}
    </PageContainer>
  );
}
