import { useEffect } from "react";
import { data, Form } from "react-router";
import { toast } from "sonner";
import { createDb } from "~/.server/db";
import { DEFAULT_DUPLICATE_CONFIG, duplicateConfigSchema } from "~/.server/duplicates/score";
import { getDuplicateConfig, saveDuplicateConfig } from "~/.server/services/settings";
import { requireAdmin } from "~/.server/session";
import { AdminTitle } from "~/components/admin";
import { FormError } from "~/components/form-field";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { Route } from "./+types/settings";

export async function loader() {
  return { config: await getDuplicateConfig(createDb()), defaults: DEFAULT_DUPLICATE_CONFIG };
}

export async function action({ request, context }: Route.ActionArgs) {
  const admin = requireAdmin(context, request);
  const form = await request.formData();
  const n = (k: string) => Number(form.get(k));
  const parsed = duplicateConfigSchema.safeParse({
    weights: { title: n("title"), date: n("date"), organizer: n("organizer"), location: n("location"), description: n("description") },
    thresholds: { high: n("high"), review: n("review") },
    urlMatchBonus: n("urlMatchBonus"),
    differentEditionDays: n("differentEditionDays"),
  });
  if (!parsed.success) return data({ ok: false, error: "数値の範囲を確認してください" }, { status: 400 });
  const total = Object.values(parsed.data.weights).reduce((s, v) => s + v, 0);
  if (total !== 100) return data({ ok: false, error: `配点の合計を100点にしてください（現在 ${total}点）` }, { status: 400 });
  if (parsed.data.thresholds.review >= parsed.data.thresholds.high) {
    return data({ ok: false, error: "「確認が必要」の閾値は「重複の可能性が高い」より小さくしてください" }, { status: 400 });
  }
  await saveDuplicateConfig(createDb(), parsed.data, admin.id);
  return { ok: true, error: null };
}

export default function AdminSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { config, defaults } = loaderData;
  useEffect(() => {
    if (actionData?.ok) toast.success("設定を保存しました");
  }, [actionData]);
  const field = (name: string, label: string, value: number, def: number, max = 100) => (
    <div className="grid gap-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="number" min={0} max={max} defaultValue={value} />
      <p className="text-xs text-muted-foreground">初期値: {def}</p>
    </div>
  );
  return (
    <>
      <AdminTitle
        title="重複判定の設定"
        description="イベント投稿時の重複検出の配点と閾値です。実際のデータを見ながら調整してください。重複の可能性があっても投稿は禁止されず、投稿者に候補が表示されます。"
      />
      <Form method="post" className="grid gap-6 rounded-xl border bg-card p-5">
        <FormError message={actionData?.error} />
        <fieldset className="grid min-w-0 gap-3">
          <legend className="mb-2 font-semibold">配点（合計100点）</legend>
          <div className="grid gap-4 sm:grid-cols-5">
            {field("title", "イベント名", config.weights.title, defaults.weights.title)}
            {field("date", "開催日時", config.weights.date, defaults.weights.date)}
            {field("organizer", "主催団体", config.weights.organizer, defaults.weights.organizer)}
            {field("location", "開催場所", config.weights.location, defaults.weights.location)}
            {field("description", "概要", config.weights.description, defaults.weights.description)}
          </div>
        </fieldset>
        <fieldset className="grid min-w-0 gap-3">
          <legend className="mb-2 font-semibold">判定の目安</legend>
          <div className="grid gap-4 sm:grid-cols-4">
            {field("high", "重複の可能性が高い（以上）", config.thresholds.high, defaults.thresholds.high)}
            {field("review", "確認が必要（以上）", config.thresholds.review, defaults.thresholds.review)}
            {field("urlMatchBonus", "公式URL一致の加点", config.urlMatchBonus, defaults.urlMatchBonus)}
            {field("differentEditionDays", "別開催回とみなす日数差", config.differentEditionDays, defaults.differentEditionDays, 3650)}
          </div>
        </fieldset>
        <div>
          <Button type="submit">保存する</Button>
        </div>
      </Form>
    </>
  );
}
