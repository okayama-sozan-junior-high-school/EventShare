import { eq } from "drizzle-orm";
import { data, Form } from "react-router";
import { z } from "zod";
import { createDb } from "~/.server/db";
import { categories } from "~/.server/db/schema";
import { listAllCategories } from "~/.server/services/admin";
import { requireAdmin } from "~/.server/session";
import { flattenErrors, formDataToObject, optionalText } from "~/.server/validation/common";
import { AdminTitle } from "~/components/admin";
import { FormError } from "~/components/form-field";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { Route } from "./+types/categories";

const categorySchema = z.object({
  name: z.string().trim().min(1, "名前を入力してください").max(30),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{1,40}$/, "スラッグは半角英小文字・数字・ハイフンで入力してください"),
  description: optionalText(200),
  sortOrder: z.coerce.number().int().min(0).max(100000).catch(500),
});

export async function loader() {
  return { categories: await listAllCategories(createDb()) };
}

export async function action({ request, context }: Route.ActionArgs) {
  requireAdmin(context, request);
  const db = createDb();
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "toggle") {
    const id = Number(form.get("id"));
    const current = await db.query.categories.findFirst({ where: eq(categories.id, id) });
    if (!current) throw data("カテゴリが見つかりません", { status: 404 });
    await db.update(categories).set({ isActive: !current.isActive }).where(eq(categories.id, id));
    return { error: null };
  }

  const parsed = categorySchema.safeParse(formDataToObject(form));
  if (!parsed.success) {
    return data({ error: Object.values(flattenErrors(parsed.error))[0] }, { status: 400 });
  }
  try {
    if (intent === "create") {
      await db.insert(categories).values(parsed.data);
    } else if (intent === "update") {
      await db.update(categories).set(parsed.data).where(eq(categories.id, Number(form.get("id"))));
    }
  } catch {
    return data({ error: "同じスラッグのカテゴリが既にあります" }, { status: 400 });
  }
  return { error: null };
}

export default function AdminCategories({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <>
      <AdminTitle
        title="カテゴリ管理"
        description="カテゴリの追加・名前の変更・並び順の変更ができます。使用中のカテゴリは削除せず「無効」にしてください。"
      />
      <FormError message={actionData?.error} />
      <div className="mt-3 grid gap-2">
        {loaderData.categories.map((c) => (
          <Form key={c.id} method="post" className="grid items-end gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_1fr_80px_auto]">
            <input type="hidden" name="id" value={c.id} />
            <div className="grid gap-1">
              <Label htmlFor={`name-${c.id}`} className="text-xs">
                名前（{c.eventCount}件のイベント）
              </Label>
              <Input id={`name-${c.id}`} name="name" defaultValue={c.name} maxLength={30} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`slug-${c.id}`} className="text-xs">
                スラッグ（URL用）
              </Label>
              <Input id={`slug-${c.id}`} name="slug" defaultValue={c.slug} maxLength={40} />
              <input type="hidden" name="description" value={c.description ?? ""} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`order-${c.id}`} className="text-xs">
                並び順
              </Label>
              <Input id={`order-${c.id}`} name="sortOrder" type="number" defaultValue={c.sortOrder} />
            </div>
            <div className="flex gap-1">
              <Button type="submit" size="sm" name="intent" value="update" variant="outline">
                保存
              </Button>
              <Button type="submit" size="sm" name="intent" value="toggle" variant={c.isActive ? "ghost" : "secondary"}>
                {c.isActive ? "無効にする" : "有効にする"}
              </Button>
            </div>
          </Form>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">カテゴリを追加</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="new-name">名前</Label>
              <Input id="new-name" name="name" maxLength={30} required />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="new-slug">スラッグ</Label>
              <Input id="new-slug" name="slug" maxLength={40} placeholder="例: robotics" required />
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="new-desc">説明（任意）</Label>
              <Input id="new-desc" name="description" maxLength={200} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="new-order">並び順</Label>
              <Input id="new-order" name="sortOrder" type="number" defaultValue={500} />
            </div>
            <div className="flex items-end">
              <Button type="submit" name="intent" value="create">
                追加
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </>
  );
}
