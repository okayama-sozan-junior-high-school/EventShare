import { APIError } from "better-auth/api";
import { data, Form, Link } from "react-router";
import { getAuth } from "~/.server/auth";
import { createDb } from "~/.server/db";
import { adminListUsers } from "~/.server/services/admin";
import { requireAdmin } from "~/.server/session";
import { AdminTitle, StatusBadge } from "~/components/admin";
import { FormError } from "~/components/form-field";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { formatDate } from "~/lib/datetime";
import { useCurrentUser, useTimeZone } from "~/lib/hooks";
import type { Route } from "./+types/users";

export async function loader({ request }: Route.LoaderArgs) {
  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) || null;
  return { users: await adminListUsers(createDb(), q), q };
}

export async function action({ request, context }: Route.ActionArgs) {
  const admin = requireAdmin(context, request);
  const form = await request.formData();
  const userId = String(form.get("userId"));
  const intent = String(form.get("intent"));
  if (userId === admin.id) {
    return data({ error: "自分自身の権限や状態は変更できません" }, { status: 400 });
  }
  const api = getAuth().api;
  const headers = request.headers;
  try {
    switch (intent) {
      case "make_admin":
        await api.setRole({ body: { userId, role: "admin" }, headers });
        break;
      case "make_user":
        await api.setRole({ body: { userId, role: "user" }, headers });
        break;
      case "ban":
        await api.banUser({
          body: { userId, banReason: String(form.get("reason") ?? "").slice(0, 200) || "利用ガイドライン違反" },
          headers,
        });
        break;
      case "unban":
        await api.unbanUser({ body: { userId }, headers });
        break;
      case "revoke_sessions":
        await api.revokeUserSessions({ body: { userId }, headers });
        break;
      default:
        throw data("不正なリクエストです", { status: 400 });
    }
  } catch (error) {
    if (error instanceof APIError) {
      return data({ error: error.body?.message ?? "操作に失敗しました" }, { status: 400 });
    }
    throw error;
  }
  return { error: null };
}

export default function AdminUsers({ loaderData, actionData }: Route.ComponentProps) {
  const { users, q } = loaderData;
  const tz = useTimeZone();
  const me = useCurrentUser();
  return (
    <>
      <AdminTitle title="ユーザー管理" description="権限の変更、利用停止、ログイン中のセッションの無効化ができます。" />
      <Form method="get" className="mb-4 flex gap-2">
        <Input name="q" defaultValue={q ?? ""} placeholder="表示名・メールアドレス" className="max-w-xs" />
        <Button type="submit" variant="outline">
          検索
        </Button>
      </Form>
      <FormError message={actionData?.error} />
      <div className="mt-2 rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ユーザー</TableHead>
              <TableHead className="hidden md:table-cell">登録日</TableHead>
              <TableHead>状態</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="max-w-64">
                  <Link to={`/users/${u.id}`} className="font-medium hover:underline">
                    {u.name}
                  </Link>
                  {u.role === "admin" && <Badge className="ml-2">管理者</Badge>}
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">{formatDate(u.createdAt, tz)}</TableCell>
                <TableCell>
                  <StatusBadge status={u.banned ? "banned" : "active"} />
                  {u.banned && u.banReason && <p className="mt-1 text-xs text-muted-foreground">{u.banReason}</p>}
                </TableCell>
                <TableCell>
                  {u.id === me?.id ? (
                    <p className="text-right text-xs text-muted-foreground">（自分）</p>
                  ) : (
                    <Form method="post" className="flex flex-wrap justify-end gap-1">
                      <input type="hidden" name="userId" value={u.id} />
                      {u.role === "admin" ? (
                        <Button size="sm" variant="ghost" name="intent" value="make_user">
                          一般に戻す
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          name="intent"
                          value="make_admin"
                          onClick={(e) => {
                            if (!confirm(`${u.name} さんを管理者にしますか？`)) e.preventDefault();
                          }}
                        >
                          管理者にする
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" name="intent" value="revoke_sessions">
                        ログアウトさせる
                      </Button>
                      {u.banned ? (
                        <Button size="sm" variant="outline" name="intent" value="unban">
                          停止を解除
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="destructive"
                          name="intent"
                          value="ban"
                          onClick={(e) => {
                            if (!confirm(`${u.name} さんを利用停止にしますか？`)) e.preventDefault();
                          }}
                        >
                          利用停止
                        </Button>
                      )}
                    </Form>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
