import { data, Form } from "react-router";
import { z } from "zod";
import { createDb } from "~/.server/db";
import { TAG_FACET_VALUES } from "~/.server/db/schema";
import { enforceRateLimit } from "~/.server/rate-limit";
import { listAllTags, mergeTags, toggleTagStatus, updateTagFacet } from "~/.server/services/tags";
import { requireAdmin } from "~/.server/session";
import { AdminTitle, StatusBadge } from "~/components/admin";
import { FormError } from "~/components/form-field";
import { Button } from "~/components/ui/button";
import { NativeSelect } from "~/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { TAG_FACETS, TAG_FACET_ORDER } from "~/lib/tags";
import type { Route } from "./+types/tags";

const idSchema = z.coerce.number().int().positive();

export async function loader() {
  return { tags: await listAllTags(createDb()) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const admin = requireAdmin(context, request);
  await enforceRateLimit("write", admin.id);
  const db = createDb();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = idSchema.safeParse(form.get("id") ?? form.get("sourceId"));
  if (!id.success) return data({ error: "タグが見つかりません" }, { status: 400 });

  if (intent === "facet") {
    const facet = z.enum(TAG_FACET_VALUES).safeParse(form.get("facet"));
    if (!facet.success) return data({ error: "面の指定が正しくありません" }, { status: 400 });
    await updateTagFacet(db, id.data, facet.data);
    return { error: null };
  }

  if (intent === "toggle") {
    const ok = await toggleTagStatus(db, id.data);
    if (!ok) return data({ error: "タグが見つかりません" }, { status: 400 });
    return { error: null };
  }

  if (intent === "merge") {
    const target = idSchema.safeParse(form.get("targetId"));
    if (!target.success) return data({ error: "統合先のタグを選んでください" }, { status: 400 });
    const result = await mergeTags(db, id.data, target.data);
    if (result === "same") return data({ error: "同じタグには統合できません" }, { status: 400 });
    if (result === "missing") return data({ error: "タグが見つかりません" }, { status: 400 });
    return { error: null };
  }

  return data({ error: "不正なリクエストです" }, { status: 400 });
}

export default function AdminTags({ loaderData, actionData }: Route.ComponentProps) {
  const { tags } = loaderData;
  return (
    <>
      <AdminTitle
        title="タグ管理"
        description="面の変更、非表示、別のタグへの統合ができます。統合すると付け替えが1回で済み、元のタグは削除されます。"
      />
      <FormError message={actionData?.error} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>タグ</TableHead>
            <TableHead>面</TableHead>
            <TableHead>状態</TableHead>
            <TableHead>利用数</TableHead>
            <TableHead>統合</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tags.map((tag) => (
            <TableRow key={tag.id}>
              <TableCell className="font-medium whitespace-normal">{tag.name}</TableCell>
              <TableCell>
                <Form method="post" className="flex items-center gap-2">
                  <input type="hidden" name="id" value={tag.id} />
                  <div className="w-36">
                    <NativeSelect name="facet" defaultValue={tag.facet} aria-label={`${tag.name}の面`}>
                      {TAG_FACET_ORDER.map((facet) => (
                        <option key={facet} value={facet}>
                          {TAG_FACETS[facet]}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <Button type="submit" name="intent" value="facet" size="sm" variant="outline">
                    変更
                  </Button>
                </Form>
              </TableCell>
              <TableCell>
                <Form
                  method="post"
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    if (tag.status === "active" && !confirm(`「${tag.name}」を非表示にしますか？`)) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="id" value={tag.id} />
                  <StatusBadge status={tag.status} />
                  <Button type="submit" name="intent" value="toggle" size="sm" variant="ghost">
                    {tag.status === "active" ? "非表示" : "再表示"}
                  </Button>
                </Form>
              </TableCell>
              <TableCell>{tag.useCount}</TableCell>
              <TableCell>
                <Form
                  method="post"
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    const select = event.currentTarget.elements.namedItem("targetId");
                    const label =
                      select instanceof HTMLSelectElement ? select.selectedOptions[0]?.text : "";
                    if (!confirm(`「${tag.name}」を「${label}」に統合しますか？元のタグは削除されます。`)) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="sourceId" value={tag.id} />
                  <div className="w-40">
                    <NativeSelect name="targetId" defaultValue="" required aria-label={`${tag.name}の統合先`}>
                      <option value="" disabled>
                        統合先
                      </option>
                      {tags
                        .filter((other) => other.id !== tag.id)
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.name}
                          </option>
                        ))}
                    </NativeSelect>
                  </div>
                  <Button type="submit" name="intent" value="merge" size="sm" variant="outline">
                    統合
                  </Button>
                </Form>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
